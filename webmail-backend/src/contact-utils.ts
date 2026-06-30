import { createHash } from 'crypto';
import { pool } from './db';

export interface ContactRow {
    id: number;
    username: string;
    name: string;
    email: string;
    phone?: string;
    vcard_data?: string;
    dav_uid?: string;
    sync_token?: number;
    updated_at?: string | Date;
    emails_json?: any;
    phones_json?: any;
    addresses_json?: any;
    job_title?: string;
    organization?: string;
    notes?: string;
    labels_json?: any;
    photo_url?: string;
    is_favorite?: number;
    prefix?: string;
    first_name?: string;
    middle_name?: string;
    last_name?: string;
    suffix?: string;
    nickname?: string;
    department?: string;
    birthday?: string;
    website_url?: string;
}

export interface ContactLabelRow {
    id: number;
    username: string;
    name: string;
    color: string;
}

export interface ParsedVCardContact {
    name: string;
    email: string;
    phone: string;
    emails?: string[];
    phones?: string[];
    organization?: string;
    title?: string;
    note?: string;
    address?: string;
    lastName?: string;
    firstName?: string;
    middleName?: string;
    prefix?: string;
    suffix?: string;
}

let schemaPromise: Promise<void> | null = null;

export async function ensureContactsSchema(): Promise<void> {
    if (!schemaPromise) {
        schemaPromise = (async () => {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS contacts (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(255) NOT NULL,
                    name VARCHAR(255) NOT NULL DEFAULT '',
                    email VARCHAR(255) NOT NULL DEFAULT '',
                    phone VARCHAR(64) NOT NULL DEFAULT '',
                    vcard_data MEDIUMTEXT NULL,
                    dav_uid VARCHAR(255) NULL,
                    sync_token BIGINT UNSIGNED NOT NULL DEFAULT 1,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    emails_json JSON NULL,
                    phones_json JSON NULL,
                    addresses_json JSON NULL,
                    job_title VARCHAR(255) NULL,
                    organization VARCHAR(255) NULL,
                    notes TEXT NULL,
                    labels_json JSON NULL,
                    KEY idx_contacts_username (username),
                    KEY idx_contacts_user_dav_uid (username, dav_uid)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS contact_labels (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(255) NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    color VARCHAR(32) NOT NULL DEFAULT '#60a5fa',
                    KEY idx_contact_labels_username (username)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            const [columns]: any = await pool.query('SHOW COLUMNS FROM contacts');
            const columnNames = new Set(columns.map((column: any) => column.Field));
            if (!columnNames.has('phone')) {
                await pool.query("ALTER TABLE contacts ADD COLUMN phone VARCHAR(64) NOT NULL DEFAULT '' AFTER email");
            }
            if (!columnNames.has('vcard_data')) {
                await pool.query('ALTER TABLE contacts ADD COLUMN vcard_data MEDIUMTEXT NULL AFTER phone');
            }
            if (!columnNames.has('dav_uid')) {
                await pool.query('ALTER TABLE contacts ADD COLUMN dav_uid VARCHAR(255) NULL AFTER vcard_data');
            }
            if (!columnNames.has('sync_token')) {
                await pool.query('ALTER TABLE contacts ADD COLUMN sync_token BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER dav_uid');
            }
            if (!columnNames.has('created_at')) {
                await pool.query('ALTER TABLE contacts ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER sync_token');
            }
            if (!columnNames.has('updated_at')) {
                await pool.query('ALTER TABLE contacts ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at');
            }
            if (!columnNames.has('emails_json')) {
                await pool.query('ALTER TABLE contacts ADD COLUMN emails_json JSON NULL AFTER updated_at');
            }
            if (!columnNames.has('phones_json')) {
                await pool.query('ALTER TABLE contacts ADD COLUMN phones_json JSON NULL AFTER emails_json');
            }
            if (!columnNames.has('addresses_json')) {
                await pool.query('ALTER TABLE contacts ADD COLUMN addresses_json JSON NULL AFTER phones_json');
            }
            if (!columnNames.has('job_title')) {
                await pool.query('ALTER TABLE contacts ADD COLUMN job_title VARCHAR(255) NULL AFTER addresses_json');
            }
            if (!columnNames.has('organization')) {
                await pool.query('ALTER TABLE contacts ADD COLUMN organization VARCHAR(255) NULL AFTER job_title');
            }
            if (!columnNames.has('notes')) {
                await pool.query('ALTER TABLE contacts ADD COLUMN notes TEXT NULL AFTER organization');
            }
            if (!columnNames.has('labels_json')) {
                await pool.query('ALTER TABLE contacts ADD COLUMN labels_json JSON NULL AFTER notes');
            }
            if (!columnNames.has('photo_url')) {
                await pool.query('ALTER TABLE contacts ADD COLUMN photo_url MEDIUMTEXT NULL AFTER labels_json');
            }
            if (!columnNames.has('is_favorite')) {
                await pool.query('ALTER TABLE contacts ADD COLUMN is_favorite TINYINT(1) NOT NULL DEFAULT 0 AFTER photo_url');
            }
            const structuredCols = [
                ['prefix', 'VARCHAR(32) NULL AFTER is_favorite'],
                ['first_name', 'VARCHAR(128) NULL AFTER prefix'],
                ['middle_name', 'VARCHAR(128) NULL AFTER first_name'],
                ['last_name', 'VARCHAR(128) NULL AFTER middle_name'],
                ['suffix', 'VARCHAR(32) NULL AFTER last_name'],
                ['nickname', 'VARCHAR(128) NULL AFTER suffix'],
                ['department', 'VARCHAR(255) NULL AFTER nickname'],
                ['birthday', 'VARCHAR(16) NULL AFTER department'],
                ['website_url', 'VARCHAR(500) NULL AFTER birthday'],
            ];
            for (const [col, def] of structuredCols) {
                if (!columnNames.has(col)) {
                    await pool.query(`ALTER TABLE contacts ADD COLUMN ${col} ${def}`);
                }
            }

            if (!columnNames.has('deleted_at')) {
                await pool.query('ALTER TABLE contacts ADD COLUMN deleted_at TIMESTAMP NULL AFTER website_url');
            }

            await pool.query(`
                CREATE TABLE IF NOT EXISTS contact_groups (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(255) NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    color VARCHAR(32) NOT NULL DEFAULT '#60a5fa',
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    KEY idx_contact_groups_username (username)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            await pool.query(`
                CREATE TABLE IF NOT EXISTS contact_group_members (
                    group_id INT NOT NULL,
                    contact_id INT NOT NULL,
                    PRIMARY KEY (group_id, contact_id),
                    KEY idx_group_members_contact (contact_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            const [indexes]: any = await pool.query("SHOW INDEX FROM contacts WHERE Key_name = 'idx_contacts_user_dav_uid'");
            if (indexes.length === 0) {
                await pool.query('ALTER TABLE contacts ADD KEY idx_contacts_user_dav_uid (username, dav_uid)');
            }

            await pool.query("UPDATE contacts SET dav_uid = CONCAT('contact-', id) WHERE dav_uid IS NULL OR dav_uid = ''");
        })();
    }

    return schemaPromise;
}

export function xmlEscape(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function vcardEscape(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,');
}

function vcardUnescape(value: string): string {
    return value
        .replace(/\\n/gi, '\n')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\\\/g, '\\');
}

function unfoldVCard(vcard: string): string[] {
    return vcard
        .replace(/\r\n[ \t]/g, '')
        .replace(/\n[ \t]/g, '')
        .replace(/\r/g, '\n')
        .split('\n')
        .map(line => line.trimEnd())
        .filter(Boolean);
}

function firstVCardValue(lines: string[], propertyName: string): string {
    const upperName = propertyName.toUpperCase();
    const line = lines.find(candidate => {
        const separatorIndex = candidate.indexOf(':');
        if (separatorIndex < 0) return false;
        const raw = candidate.slice(0, separatorIndex);
        // Strip group prefix (e.g. "item1.EMAIL" -> "EMAIL") before matching
        const baseName = raw.split(';')[0].toUpperCase();
        const dotIndex = baseName.indexOf('.');
        const name = dotIndex >= 0 ? baseName.slice(dotIndex + 1) : baseName;
        return name === upperName;
    });
    if (!line) return '';
    const separatorIndex = line.indexOf(':');
    return vcardUnescape(line.slice(separatorIndex + 1).trim());
}

function vCardAddress(lines: string[]): string {
    const vals: string[] = [];
    for (const line of lines) {
        const propUpper = line.split(':')[0].split(';')[0].toUpperCase();
        if (propUpper !== 'ADR') continue;
        const val = firstVCardValue([line], 'ADR');
        const parts = val.split(';').filter(Boolean);
        if (parts.length > 0) vals.push(parts.join(', '));
    }
    return vals.join(' | ') || '';
}

function allVCardValues(lines: string[], propertyName: string): string[] {
    const upperName = propertyName.toUpperCase();
    const results: string[] = [];
    for (const candidate of lines) {
        const separatorIndex = candidate.indexOf(':');
        if (separatorIndex < 0) continue;
        const raw = candidate.slice(0, separatorIndex);
        const baseName = raw.split(';')[0].toUpperCase();
        const dotIndex = baseName.indexOf('.');
        const name = dotIndex >= 0 ? baseName.slice(dotIndex + 1) : baseName;
        if (name === upperName) {
            results.push(vcardUnescape(candidate.slice(separatorIndex + 1).trim()));
        }
    }
    return results;
}

export function parseVCard(vcard: string): ParsedVCardContact {
    const lines = unfoldVCard(vcard);
    const fn = firstVCardValue(lines, 'FN');
    const nRaw = firstVCardValue(lines, 'N');
    // Parse structured N: LastName;FirstName;MiddleName;Prefix;Suffix
    const nParts = nRaw.split(';').map(s => vcardUnescape(s.trim()));
    const lastName = nParts[0] || '';
    const firstName = nParts[1] || '';
    const middleName = nParts[2] || '';
    const prefix = nParts[3] || '';
    const suffix = nParts[4] || '';
    const fallbackName = [prefix, firstName, middleName, lastName, suffix].filter(Boolean).join(' ');

    // Extract all emails and phones (iOS uses item1.EMAIL, item2.EMAIL, etc.)
    const emails = allVCardValues(lines, 'EMAIL');
    const phones = allVCardValues(lines, 'TEL');
    const primaryEmail = emails[0] || '';
    const primaryPhone = phones[0] || '';

    return {
        name: fn || fallbackName,
        email: primaryEmail,
        phone: primaryPhone,
        lastName: lastName || undefined,
        firstName: firstName || undefined,
        middleName: middleName || undefined,
        prefix: prefix || undefined,
        suffix: suffix || undefined,
        emails: emails.length > 1 ? emails : [],
        phones: phones.length > 1 ? phones : [],
        organization: firstVCardValue(lines, 'ORG'),
        title: firstVCardValue(lines, 'TITLE'),
        note: firstVCardValue(lines, 'NOTE'),
        address: vCardAddress(lines)
    };
}

export function normalizeDavUid(raw: string): string {
    const cleaned = decodeURIComponent(raw)
        .replace(/\.vcf$/i, '')
        .replace(/[^A-Za-z0-9._~-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 180);
    return cleaned || `contact-${Date.now()}`;
}

export function getContactDavUid(contact: ContactRow): string {
    return contact.dav_uid || `contact-${contact.id}`;
}

export function getContactHref(user: string, contact: ContactRow): string {
    return `/carddav/addressbooks/${user}/personal/${encodeURIComponent(getContactDavUid(contact))}.vcf`;
}

export function normalizeVCardData(vcard: string, davUid: string, fallback: ParsedVCardContact): string {
    const trimmed = vcard.trim();
    let lines = trimmed && /^BEGIN:VCARD/i.test(trimmed)
        ? unfoldVCard(trimmed)
        : [];

    if (lines.length === 0) {
        lines = [
            'BEGIN:VCARD',
            'VERSION:3.0',
            `UID:${vcardEscape(davUid)}`,
            `FN:${vcardEscape(fallback.name || fallback.email || 'Unnamed Contact')}`,
            `N:${vcardEscape(fallback.name || '')};;;;`,
        ];
        if (fallback.email) lines.push(`EMAIL;TYPE=INTERNET:${vcardEscape(fallback.email)}`);
        if (fallback.phone) lines.push(`TEL;TYPE=CELL:${vcardEscape(fallback.phone)}`);
        lines.push('END:VCARD');
    } else if (!lines.some(line => line.toUpperCase().startsWith('UID:') || line.toUpperCase().startsWith('UID;'))) {
        const versionIndex = lines.findIndex(line => line.toUpperCase().startsWith('VERSION:'));
        lines.splice(versionIndex >= 0 ? versionIndex + 1 : 1, 0, `UID:${vcardEscape(davUid)}`);
    }

    return `${lines.join('\r\n')}\r\n`;
}

export function patchVCardData(vcard: string, davUid: string, updates: any): string {
    const trimmed = (vcard || '').trim();
    let lines = trimmed && /^BEGIN:VCARD/i.test(trimmed) ? unfoldVCard(trimmed) : ['BEGIN:VCARD', 'VERSION:3.0', 'END:VCARD'];
    
    if (!lines.some(line => line.toUpperCase().startsWith('UID:') || line.toUpperCase().startsWith('UID;'))) {
        const versionIndex = lines.findIndex(line => line.toUpperCase().startsWith('VERSION:'));
        lines.splice(versionIndex >= 0 ? versionIndex + 1 : 1, 0, `UID:${vcardEscape(davUid)}`);
    }

    const firstName = updates.first_name || '';
    const lastName = updates.last_name || '';
    const middleName = updates.middle_name || '';
    const prefix = updates.prefix || '';
    const suffix = updates.suffix || '';

    let newLines: string[] = [];
    let existingN = ['', '', '', '', ''];
    const nLine = lines.find(l => l.toUpperCase().startsWith('N:') || l.toUpperCase().startsWith('N;'));
    if (nLine) {
        const val = nLine.slice(nLine.indexOf(':') + 1);
        const parts = val.split(/(?<!\\);/).map(vcardUnescape);
        for (let i = 0; i < 5; i++) if (parts[i]) existingN[i] = parts[i];
    }

    if (lastName) existingN[0] = lastName;
    if (firstName) existingN[1] = firstName;
    if (middleName) existingN[2] = middleName;
    if (prefix) existingN[3] = prefix;
    if (suffix) existingN[4] = suffix;

    for (const line of lines) {
        if (line.toUpperCase().startsWith('BEGIN:') || line.toUpperCase().startsWith('END:') || line.toUpperCase().startsWith('VERSION:') || line.toUpperCase().startsWith('UID:')) {
            newLines.push(line);
            continue;
        }
        const propUpper = line.split(':')[0].split(';')[0].toUpperCase();
        if (['FN', 'N', 'EMAIL', 'TEL', 'ORG', 'TITLE', 'NOTE'].includes(propUpper)) {
            continue; // We will insert these manually at the end
        }
        newLines.push(line);
    }

    const endIndex = newLines.findIndex(l => l.toUpperCase() === 'END:VCARD');
    const insertAt = endIndex >= 0 ? endIndex : newLines.length;
    
    newLines.splice(insertAt, 0, `FN:${vcardEscape(updates.name || '')}`);
    newLines.splice(insertAt + 1, 0, `N:${existingN.map(vcardEscape).join(';')}`);
    
    const emails = Array.isArray(updates.emails_json) && updates.emails_json.length > 0 ? updates.emails_json : (updates.email ? [{ value: updates.email, type: 'INTERNET' }] : []);
    for (const email of emails) {
        if (email.value) newLines.splice(insertAt + 2, 0, `EMAIL;TYPE=${email.type || 'INTERNET'}:${vcardEscape(email.value)}`);
    }
    
    const phones = Array.isArray(updates.phones_json) && updates.phones_json.length > 0 ? updates.phones_json : (updates.phone ? [{ value: updates.phone, type: 'CELL' }] : []);
    for (const phone of phones) {
        if (phone.value) newLines.splice(insertAt + 2, 0, `TEL;TYPE=${phone.type || 'CELL'}:${vcardEscape(phone.value)}`);
    }

    if (updates.organization) newLines.splice(insertAt + 2, 0, `ORG:${vcardEscape(updates.organization)}`);
    if (updates.job_title) newLines.splice(insertAt + 2, 0, `TITLE:${vcardEscape(updates.job_title)}`);
    if (updates.notes) newLines.splice(insertAt + 2, 0, `NOTE:${vcardEscape(updates.notes)}`);
    if (updates.photo_url && /^data:image\//.test(updates.photo_url)) newLines.splice(insertAt + 2, 0, `PHOTO;ENCODING=BASE64;TYPE=JPEG:${(updates.photo_url as string).replace(/^data:image\/[^;]+;base64,/, '')}`);

    if (endIndex < 0) newLines.push('END:VCARD');
    return `${newLines.join('\r\n')}\r\n`;
}

export function contactEtag(contact: ContactRow): string {
    const hash = createHash('sha1');
    hash.update(String(contact.id));
    hash.update('\0');
    hash.update(getContactDavUid(contact));
    hash.update('\0');
    hash.update(contact.name || '');
    hash.update('\0');
    hash.update(contact.email || '');
    hash.update('\0');
    hash.update(contact.phone || '');
    hash.update('\0');
    hash.update(contact.vcard_data || '');
    hash.update('\0');
    hash.update(contact.updated_at instanceof Date ? contact.updated_at.toISOString() : String(contact.updated_at || ''));
    return `"${hash.digest('hex')}"`;
}

export async function listContacts(user: string): Promise<ContactRow[]> {
    await ensureContactsSchema();
    const [rows]: any = await pool.query(
        'SELECT * FROM contacts WHERE username = ? ORDER BY is_favorite DESC, name ASC, email ASC, id ASC',
        [user]
    );
    return rows;
}

export async function getContactByDavUid(user: string, davUid: string): Promise<ContactRow | null> {
    await ensureContactsSchema();
    const [rows]: any = await pool.query(
        'SELECT * FROM contacts WHERE username = ? AND dav_uid = ? ORDER BY id ASC LIMIT 1',
        [user, davUid]
    );
    return rows.length > 0 ? rows[0] : null;
}

export async function saveContactFromVCard(user: string, davUid: string, vcard: string): Promise<{ contact: ContactRow; created: boolean }> {
    await ensureContactsSchema();
    const parsed = parseVCard(vcard);
    const normalized = normalizeVCardData(vcard, davUid, parsed);
    const existing = await getContactByDavUid(user, davUid);

    if (existing) {
        await pool.query(
            `UPDATE contacts
             SET name = ?, email = ?, phone = ?, vcard_data = ?, sync_token = sync_token + 1
             WHERE id = ? AND username = ?`,
            [parsed.name || '', parsed.email || '', parsed.phone || '', normalized, existing.id, user]
        );
        const updated = await getContactByDavUid(user, davUid);
        return { contact: updated!, created: false };
    }

    const [result]: any = await pool.query(
        `INSERT INTO contacts (username, name, email, phone, vcard_data, dav_uid, sync_token)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [user, parsed.name || '', parsed.email || '', parsed.phone || '', normalized, davUid]
    );
    const [rows]: any = await pool.query('SELECT * FROM contacts WHERE id = ?', [result.insertId]);
    return { contact: rows[0], created: true };
}

export async function deleteContactByDavUid(user: string, davUid: string): Promise<boolean> {
    await ensureContactsSchema();
    const [result]: any = await pool.query('DELETE FROM contacts WHERE username = ? AND dav_uid = ?', [user, davUid]);
    return result.affectedRows > 0;
}

export async function addressBookSyncToken(user: string): Promise<string> {
    await ensureContactsSchema();
    const [rows]: any = await pool.query(
        `SELECT COUNT(*) AS contact_count,
                COALESCE(MAX(sync_token), 1) AS max_sync_token,
                COALESCE(UNIX_TIMESTAMP(MAX(updated_at)), 1) AS max_updated_at
         FROM contacts
         WHERE username = ?`,
        [user]
    );
    const row = rows[0] || {};
    return `${row.contact_count || 0}-${row.max_sync_token || 1}-${row.max_updated_at || 1}`;
}

export function contactVCard(contact: ContactRow): string {
    const davUid = getContactDavUid(contact);
    const fallback = {
        name: contact.name || '',
        email: contact.email || '',
        phone: contact.phone || ''
    };
    return normalizeVCardData(contact.vcard_data || '', davUid, fallback);
}
