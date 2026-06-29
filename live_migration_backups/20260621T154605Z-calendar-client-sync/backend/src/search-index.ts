import { pool } from './db';
import type { MailSearchField } from './imap';

export type IndexedMailSearchField = MailSearchField | 'attachments';

export interface MailSearchIndexRow {
    folder: string;
    uid: number;
    messageId?: string;
    subject: string;
    sender: string;
    recipients: string;
    sentAt?: Date | string | null;
    preview: string;
    bodyText: string;
    attachmentNames: string;
    isRead: boolean;
    isStarred: boolean;
}

export interface MailSearchIndexStatus {
    indexedCount: number;
    lastIndexedAt: Date | string | null;
}

export interface SavedMailSearch {
    id: number;
    name: string;
    query: string;
    field: IndexedMailSearchField;
    scope: 'folder' | 'all';
    folder: string;
    createdAt: Date | string;
    updatedAt: Date | string;
}

let schemaPromise: Promise<void> | null = null;

export const ensureMailSearchSchema = async () => {
    if (!schemaPromise) {
        schemaPromise = (async () => {
            await pool.query(`
            CREATE TABLE IF NOT EXISTS mail_search_index (
                id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(255) NOT NULL,
                folder VARCHAR(255) NOT NULL,
                uid BIGINT UNSIGNED NOT NULL,
                message_id VARCHAR(512) NULL,
                subject TEXT NULL,
                sender TEXT NULL,
                recipients TEXT NULL,
                sent_at DATETIME NULL,
                preview TEXT NULL,
                body_text MEDIUMTEXT NULL,
                attachment_names TEXT NULL,
                is_read TINYINT(1) NOT NULL DEFAULT 0,
                is_starred TINYINT(1) NOT NULL DEFAULT 0,
                indexed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_user_folder_uid (username, folder, uid),
                KEY idx_user_folder_date (username, folder, sent_at),
                KEY idx_user_date (username, sent_at),
                KEY idx_user_flags (username, is_read, is_starred),
                FULLTEXT KEY ft_mail_search (subject, sender, recipients, body_text, attachment_names)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS mail_saved_searches (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(255) NOT NULL,
                    name VARCHAR(80) NOT NULL,
                    query VARCHAR(256) NOT NULL DEFAULT '',
                    field VARCHAR(32) NOT NULL DEFAULT 'all',
                    scope VARCHAR(16) NOT NULL DEFAULT 'folder',
                    folder VARCHAR(255) NOT NULL DEFAULT 'INBOX',
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    KEY idx_user_updated (username, updated_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
        })();
    }

    return schemaPromise;
};

const trimForIndex = (value: string | null | undefined, maxLength: number) => {
    if (!value) return '';
    return value.length > maxLength ? value.slice(0, maxLength) : value;
};

const toMysqlDate = (value: Date | string | null | undefined) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 19).replace('T', ' ');
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

const tokenize = (query: string) => query.match(/"[^"]+"|\S+/g) || [];

const cleanTokenValue = (value: string) => value.replace(/^"|"$/g, '').trim();

interface ParsedSearchExpression {
    terms: string[];
    from: string[];
    to: string[];
    subject: string[];
    isRead?: boolean;
    isStarred?: boolean;
}

const parseMailSearchExpression = (query: string): ParsedSearchExpression => {
    const parsed: ParsedSearchExpression = {
        terms: [],
        from: [],
        to: [],
        subject: []
    };

    for (const token of tokenize(query)) {
        const normalized = token.toLowerCase();
        if (normalized === 'is:unread' || normalized === 'label:unread') {
            parsed.isRead = false;
        } else if (normalized === 'is:read') {
            parsed.isRead = true;
        } else if (normalized === 'is:starred' || normalized === 'is:flagged') {
            parsed.isStarred = true;
        } else if (normalized === 'is:unstarred' || normalized === '-is:starred' || normalized === '-is:flagged') {
            parsed.isStarred = false;
        } else if (normalized.startsWith('from:') && token.length > 5) {
            parsed.from.push(cleanTokenValue(token.slice(5)));
        } else if (normalized.startsWith('to:') && token.length > 3) {
            parsed.to.push(cleanTokenValue(token.slice(3)));
        } else if (normalized.startsWith('subject:') && token.length > 8) {
            parsed.subject.push(cleanTokenValue(token.slice(8)));
        } else {
            const value = cleanTokenValue(token);
            if (value) parsed.terms.push(value);
        }
    }

    return parsed;
};

const addLikeCondition = (conditions: string[], params: unknown[], column: string, value: string) => {
    if (!value) return;
    conditions.push(`${column} LIKE ?`);
    params.push(`%${escapeLike(value)}%`);
};

const addAnyColumnLikeCondition = (conditions: string[], params: unknown[], columns: string[], value: string) => {
    if (!value) return;
    const like = `%${escapeLike(value)}%`;
    conditions.push(`(${columns.map(column => `${column} LIKE ?`).join(' OR ')})`);
    params.push(...columns.map(() => like));
};

export const upsertMailSearchRows = async (username: string, rows: MailSearchIndexRow[]) => {
    if (rows.length === 0) return 0;
    await ensureMailSearchSchema();

    const values = rows.map(row => [
        username,
        trimForIndex(row.folder, 255),
        row.uid,
        trimForIndex(row.messageId, 512) || null,
        trimForIndex(row.subject, 4096),
        trimForIndex(row.sender, 4096),
        trimForIndex(row.recipients, 4096),
        toMysqlDate(row.sentAt),
        trimForIndex(row.preview, 1024),
        trimForIndex(row.bodyText, 1024 * 1024),
        trimForIndex(row.attachmentNames, 4096),
        row.isRead ? 1 : 0,
        row.isStarred ? 1 : 0
    ]);

    await pool.query(
        `INSERT INTO mail_search_index
            (username, folder, uid, message_id, subject, sender, recipients, sent_at, preview, body_text, attachment_names, is_read, is_starred)
         VALUES ?
         ON DUPLICATE KEY UPDATE
            message_id = VALUES(message_id),
            subject = VALUES(subject),
            sender = VALUES(sender),
            recipients = VALUES(recipients),
            sent_at = VALUES(sent_at),
            preview = VALUES(preview),
            body_text = VALUES(body_text),
            attachment_names = VALUES(attachment_names),
            is_read = VALUES(is_read),
            is_starred = VALUES(is_starred),
            indexed_at = CURRENT_TIMESTAMP`,
        [values]
    );

    return rows.length;
};

export const deleteMailSearchRows = async (username: string, folder: string, uids: number[]) => {
    if (uids.length === 0) return;
    await ensureMailSearchSchema();
    await pool.query(
        'DELETE FROM mail_search_index WHERE username = ? AND folder = ? AND uid IN (?)',
        [username, folder, uids]
    );
};

export const updateMailSearchFlags = async (
    username: string,
    folder: string,
    uids: number[],
    updates: { isRead?: boolean; isStarred?: boolean }
) => {
    if (uids.length === 0) return;
    await ensureMailSearchSchema();

    const assignments: string[] = [];
    const params: unknown[] = [];
    if (typeof updates.isRead === 'boolean') {
        assignments.push('is_read = ?');
        params.push(updates.isRead ? 1 : 0);
    }
    if (typeof updates.isStarred === 'boolean') {
        assignments.push('is_starred = ?');
        params.push(updates.isStarred ? 1 : 0);
    }
    if (assignments.length === 0) return;

    await pool.query(
        `UPDATE mail_search_index
         SET ${assignments.join(', ')}, indexed_at = CURRENT_TIMESTAMP
         WHERE username = ? AND folder = ? AND uid IN (?)`,
        [...params, username, folder, uids]
    );
};

export const getMailSearchIndexStatus = async (username: string): Promise<MailSearchIndexStatus> => {
    await ensureMailSearchSchema();
    const [rows]: any = await pool.query(
        'SELECT COUNT(*) AS indexedCount, MAX(indexed_at) AS lastIndexedAt FROM mail_search_index WHERE username = ?',
        [username]
    );

    return {
        indexedCount: Number(rows?.[0]?.indexedCount || 0),
        lastIndexedAt: rows?.[0]?.lastIndexedAt || null
    };
};

export const getMaxIndexedUid = async (username: string, folder: string) => {
    await ensureMailSearchSchema();
    const [rows]: any = await pool.query(
        'SELECT MAX(uid) AS maxUid FROM mail_search_index WHERE username = ? AND folder = ?',
        [username, folder]
    );
    return Number(rows?.[0]?.maxUid || 0);
};

const rowToSavedMailSearch = (row: any): SavedMailSearch => ({
    id: Number(row.id),
    name: row.name || '',
    query: row.query || '',
    field: row.field || 'all',
    scope: row.scope === 'all' ? 'all' : 'folder',
    folder: row.folder || 'INBOX',
    createdAt: row.created_at,
    updatedAt: row.updated_at
});

export const listSavedMailSearches = async (username: string) => {
    await ensureMailSearchSchema();
    const [rows]: any = await pool.query(
        `SELECT id, name, query, field, scope, folder, created_at, updated_at
         FROM mail_saved_searches
         WHERE username = ?
         ORDER BY updated_at DESC, id DESC
         LIMIT 50`,
        [username]
    );
    return rows.map(rowToSavedMailSearch);
};

export const createSavedMailSearch = async (
    username: string,
    search: {
        name: string;
        query: string;
        field: IndexedMailSearchField;
        scope: 'folder' | 'all';
        folder: string;
    }
) => {
    await ensureMailSearchSchema();
    const [result]: any = await pool.query(
        `INSERT INTO mail_saved_searches (username, name, query, field, scope, folder)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
            username,
            trimForIndex(search.name, 80),
            trimForIndex(search.query, 256),
            search.field,
            search.scope,
            trimForIndex(search.folder, 255)
        ]
    );

    const [rows]: any = await pool.query(
        `SELECT id, name, query, field, scope, folder, created_at, updated_at
         FROM mail_saved_searches
         WHERE username = ? AND id = ?`,
        [username, result.insertId]
    );

    return rowToSavedMailSearch(rows[0]);
};

export const deleteSavedMailSearch = async (username: string, id: number) => {
    await ensureMailSearchSchema();
    const [result]: any = await pool.query(
        'DELETE FROM mail_saved_searches WHERE username = ? AND id = ?',
        [username, id]
    );
    return result.affectedRows > 0;
};

export const searchMailIndex = async (
    username: string,
    options: {
        query: string;
        field: IndexedMailSearchField;
        scope: 'folder' | 'all';
        folder: string;
        limit: number;
    }
) => {
    await ensureMailSearchSchema();

    const field = options.field;
    const where: string[] = ['username = ?'];
    const whereParams: unknown[] = [username];
    const fullTextColumns = ['subject', 'sender', 'recipients', 'body_text', 'attachment_names'];
    let scoreExpression = '0';
    const scoreParams: unknown[] = [];

    if (options.scope !== 'all') {
        where.push('folder = ?');
        whereParams.push(options.folder);
    }

    const parsed = parseMailSearchExpression(options.query);
    if (field === 'unread') parsed.isRead = false;
    if (field === 'starred') parsed.isStarred = true;

    if (typeof parsed.isRead === 'boolean') {
        where.push('is_read = ?');
        whereParams.push(parsed.isRead ? 1 : 0);
    }
    if (typeof parsed.isStarred === 'boolean') {
        where.push('is_starred = ?');
        whereParams.push(parsed.isStarred ? 1 : 0);
    }

    for (const value of parsed.from) addLikeCondition(where, whereParams, 'sender', value);
    for (const value of parsed.to) addLikeCondition(where, whereParams, 'recipients', value);
    for (const value of parsed.subject) addLikeCondition(where, whereParams, 'subject', value);

    const freeTerms = field === 'all' || field === 'unread' || field === 'starred'
        ? parsed.terms
        : [options.query].filter(Boolean);

    if (freeTerms.length > 0) {
        const fullTextQuery = freeTerms.join(' ');
        scoreExpression = 'MATCH(subject, sender, recipients, body_text, attachment_names) AGAINST (? IN NATURAL LANGUAGE MODE)';
        scoreParams.push(fullTextQuery);
    }

    for (const term of freeTerms) {
        if (field === 'from') addLikeCondition(where, whereParams, 'sender', term);
        else if (field === 'to') addLikeCondition(where, whereParams, 'recipients', term);
        else if (field === 'subject') addLikeCondition(where, whereParams, 'subject', term);
        else if (field === 'body') addLikeCondition(where, whereParams, 'body_text', term);
        else if (field === 'attachments') addLikeCondition(where, whereParams, 'attachment_names', term);
        else addAnyColumnLikeCondition(where, whereParams, fullTextColumns, term);
    }

    const [rows]: any = await pool.query(
        `SELECT
            folder,
            uid,
            subject,
            sender,
            recipients,
            sent_at AS sentAt,
            preview,
            is_read AS isRead,
            is_starred AS isStarred,
            attachment_names IS NOT NULL AND attachment_names <> '' AS hasAttachments,
            ${scoreExpression} AS score
         FROM mail_search_index
         WHERE ${where.join(' AND ')}
         ORDER BY score DESC, sent_at DESC, uid DESC
         LIMIT ?`,
        [...scoreParams, ...whereParams, options.limit]
    );

    return rows.map((row: any) => ({
        folder: row.folder,
        uid: Number(row.uid),
        subject: row.subject || '(No Subject)',
        from: row.sender || '',
        to: row.recipients || '',
        date: row.sentAt || '',
        isRead: !!row.isRead,
        isStarred: !!row.isStarred,
        hasAttachments: !!row.hasAttachments,
        preview: row.preview || ''
    }));
};
