"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiRouter = void 0;
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const util_1 = __importDefault(require("util"));
const managesieve_1 = require("./managesieve");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("./db");
const auth_1 = require("./auth");
const config_1 = require("./config");
const sieve_compiler_1 = require("./sieve-compiler");
const search_index_1 = require("./search-index");
const user_settings_1 = require("./user-settings");
const admin_settings_1 = require("./admin-settings");
const branding_1 = require("./branding");
exports.apiRouter = (0, express_1.Router)();
const requireAuth = auth_1.requireSession;
const requireAdmin = auth_1.requireAdminSession;
const execPromise = util_1.default.promisify(child_process_1.exec);
const withTransaction = async (callback) => {
    const connection = await db_1.pool.getConnection();
    try {
        await connection.beginTransaction();
        const result = await callback(connection);
        await connection.commit();
        return result;
    }
    catch (err) {
        await connection.rollback();
        throw err;
    }
    finally {
        connection.release();
    }
};
const getAddressText = (value) => value?.text || '';
const getAttachmentNames = (parsed) => {
    if (!Array.isArray(parsed.attachments))
        return '';
    return parsed.attachments
        .map((attachment) => attachment?.filename)
        .filter(Boolean)
        .join('\n');
};
const getVisibleAttachments = (parsed) => {
    if (!Array.isArray(parsed.attachments))
        return [];
    return parsed.attachments.filter((attachment) => (attachment && (attachment.filename || attachment.contentDisposition === 'attachment' || !attachment.related)));
};
const isPreviewableAttachment = (contentType) => (contentType.startsWith('image/') ||
    contentType.startsWith('text/') ||
    contentType === 'application/pdf');
const sanitizeAttachmentFilename = (filename) => filename.replace(/[\r\n"]/g, '').trim() || 'attachment';
const encodeAttachmentFilename = (filename) => {
    const cleaned = sanitizeAttachmentFilename(filename);
    return `filename="${cleaned.replace(/\\/g, '\\\\')}"; filename*=UTF-8''${encodeURIComponent(cleaned)}`;
};
const getAttachmentMetadata = (parsed) => getVisibleAttachments(parsed).map((attachment, index) => {
    const contentType = attachment.contentType || 'application/octet-stream';
    return {
        id: index,
        filename: attachment.filename || `attachment-${index + 1}`,
        contentType,
        size: attachment.size || attachment.content?.length || 0,
        disposition: attachment.contentDisposition || 'attachment',
        previewable: isPreviewableAttachment(contentType)
    };
});
const parsedMailToSummary = (folder, msg, parsed, previewLength = 100) => ({
    folder,
    uid: msg.uid,
    subject: parsed.subject || '(No Subject)',
    from: getAddressText(parsed.from),
    to: getAddressText(parsed.to),
    date: parsed.date,
    isRead: msg.flags.includes('\\Seen'),
    isStarred: msg.flags.includes('\\Flagged'),
    hasAttachments: getVisibleAttachments(parsed).length > 0,
    preview: parsed.text ? parsed.text.substring(0, previewLength) : ''
});
const parsedMailToIndexRow = (folder, msg, parsed) => ({
    folder,
    uid: msg.uid,
    messageId: parsed.messageId || '',
    subject: parsed.subject || '(No Subject)',
    sender: getAddressText(parsed.from),
    recipients: [getAddressText(parsed.to), getAddressText(parsed.cc), getAddressText(parsed.bcc)].filter(Boolean).join(', '),
    sentAt: parsed.date || null,
    preview: parsed.text ? parsed.text.substring(0, 180) : '',
    bodyText: parsed.text || '',
    attachmentNames: getAttachmentNames(parsed),
    isRead: msg.flags.includes('\\Seen'),
    isStarred: msg.flags.includes('\\Flagged')
});
const allowedSearchFields = ['all', 'from', 'to', 'subject', 'body', 'attachments', 'unread', 'starred'];
const isBlankAllowedSearchField = (field) => ['unread', 'starred'].includes(field);
const domainPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const localPartPattern = /^[a-z0-9._%+-]+$/i;
const normalizeDomainInput = (value) => String(value || '').trim().toLowerCase();
const normalizeEmailInput = (value) => String(value || '').trim().toLowerCase();
const parseQuotaBytes = (value, fallbackBytes = 0) => {
    if (value === undefined || value === null || value === '')
        return fallbackBytes;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < -1)
        return fallbackBytes;
    if (numeric === -1)
        return -1;
    return Math.round(numeric * 1048576);
};
const requireValidDomain = (value) => {
    const domain = normalizeDomainInput(value);
    if (!domainPattern.test(domain)) {
        throw new Error('Invalid domain format');
    }
    return domain;
};
const requireValidLocalPart = (value) => {
    const localPart = String(value || '').trim().toLowerCase();
    if (!localPartPattern.test(localPart)) {
        throw new Error('Invalid username format');
    }
    return localPart;
};
const requireValidMailbox = (value) => {
    const email = normalizeEmailInput(value);
    const [localPart, domain, ...extra] = email.split('@');
    if (!localPart || !domain || extra.length > 0 || !localPartPattern.test(localPart) || !domainPattern.test(domain)) {
        throw new Error('Invalid email address');
    }
    return `${localPart}@${domain}`;
};
const getDomainDefaultQuota = async (domain) => {
    const [rows] = await db_1.pool.query('SELECT quota FROM domain WHERE domain = ? LIMIT 1', [domain]);
    return rows.length > 0 ? Number(rows[0].quota || 0) : 0;
};
const quotaInputToBytes = async (value, domain, fallbackBytes = 0) => {
    const parsed = parseQuotaBytes(value, fallbackBytes);
    if (parsed === -1)
        return getDomainDefaultQuota(domain);
    return Math.max(0, parsed);
};
const hashMailboxPassword = async (password) => {
    if (!password)
        throw new Error('Password is required');
    const hash = await bcryptjs_1.default.hash(password, 12);
    return hash.replace('$2b$', '$2y$');
};
const deriveDomainFromAddress = (address) => {
    if (address.startsWith('@'))
        return address.slice(1);
    const parts = address.split('@');
    return parts[1] || '';
};
const normalizeAliasTargets = (value) => {
    const targets = String(value || '')
        .split(/[\n,]+/)
        .map(target => target.trim())
        .filter(Boolean)
        .map(target => requireValidMailbox(target))
        .join(',');
    if (!targets) {
        throw new Error('Alias targets are required');
    }
    return targets;
};
const normalizeAliasAddress = (value, fallbackDomain) => {
    const rawAddress = normalizeEmailInput(value);
    const domain = fallbackDomain ? requireValidDomain(fallbackDomain) : '';
    if (!rawAddress) {
        throw new Error('Alias address is required');
    }
    if (rawAddress.startsWith('@')) {
        const catchAllDomain = requireValidDomain(rawAddress.slice(1) || domain);
        return `@${catchAllDomain}`;
    }
    if (rawAddress.includes('@')) {
        return requireValidMailbox(rawAddress);
    }
    if (!domain) {
        throw new Error('Alias domain is required');
    }
    return `${requireValidLocalPart(rawAddress)}@${domain}`;
};
const adminErrorStatus = (err) => {
    if (err?.code === 'ER_DUP_ENTRY')
        return 409;
    if (err?.message && /invalid|required|cannot|missing|target domain must/i.test(err.message))
        return 400;
    return 500;
};
let adminAuditSchemaPromise = null;
const ensureAdminAuditSchema = async () => {
    if (!adminAuditSchemaPromise) {
        adminAuditSchemaPromise = (async () => {
            await db_1.pool.query(`
                CREATE TABLE IF NOT EXISTS webmail_admin_audit (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    actor VARCHAR(255) NOT NULL,
                    action VARCHAR(128) NOT NULL,
                    target_type VARCHAR(64) NOT NULL DEFAULT '',
                    target_id VARCHAR(255) NOT NULL DEFAULT '',
                    target_domain VARCHAR(255) NOT NULL DEFAULT '',
                    details TEXT NULL,
                    ip_address VARCHAR(64) NOT NULL DEFAULT '',
                    KEY idx_admin_audit_created (created_at),
                    KEY idx_admin_audit_actor (actor),
                    KEY idx_admin_audit_target (target_type, target_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
        })();
    }
    return adminAuditSchemaPromise;
};
const auditDetails = (details = {}) => {
    const serialized = JSON.stringify(details);
    return serialized.length > 2000 ? serialized.slice(0, 1997) + '...' : serialized;
};
const auditDomainFromTarget = (targetId) => targetId.includes('@') ? targetId.split('@').pop() || '' : targetId;
const logAdminAction = async (req, action, targetType, targetId, details = {}) => {
    try {
        await ensureAdminAuditSchema();
        const actor = req.user?.username || 'unknown';
        const normalizedTargetId = String(targetId || '').slice(0, 255);
        const targetDomain = String(details.domain || auditDomainFromTarget(normalizedTargetId)).slice(0, 255);
        await db_1.pool.query(`INSERT INTO webmail_admin_audit
                (actor, action, target_type, target_id, target_domain, details, ip_address)
             VALUES (?, ?, ?, ?, ?, ?, ?)`, [
            actor,
            action.slice(0, 128),
            targetType.slice(0, 64),
            normalizedTargetId,
            targetDomain,
            auditDetails(details),
            String(req.ip || req.socket?.remoteAddress || '').slice(0, 64),
        ]);
    }
    catch (err) {
        console.error('Failed to write admin audit log:', err);
    }
};
let mailboxProfileSchemaPromise = null;
const ensureMailboxProfileSchema = async () => {
    if (!mailboxProfileSchemaPromise) {
        mailboxProfileSchemaPromise = (async () => {
            await db_1.pool.query(`
                CREATE TABLE IF NOT EXISTS webmail_mailbox_profiles (
                    username VARCHAR(255) NOT NULL PRIMARY KEY,
                    company VARCHAR(255) NOT NULL DEFAULT '',
                    job_title VARCHAR(255) NOT NULL DEFAULT '',
                    street_address VARCHAR(255) NOT NULL DEFAULT '',
                    city VARCHAR(128) NOT NULL DEFAULT '',
                    region VARCHAR(128) NOT NULL DEFAULT '',
                    postal_code VARCHAR(64) NOT NULL DEFAULT '',
                    country VARCHAR(128) NOT NULL DEFAULT '',
                    notes TEXT NULL,
                    show_in_directory TINYINT(1) NOT NULL DEFAULT 1,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    updated_by VARCHAR(255) NOT NULL DEFAULT '',
                    KEY idx_mailbox_profiles_directory (show_in_directory, username)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            const [columns] = await db_1.pool.query('SHOW COLUMNS FROM webmail_mailbox_profiles');
            const columnNames = new Set(columns.map((column) => column.Field));
            const missingColumns = [
                ['company', "ALTER TABLE webmail_mailbox_profiles ADD COLUMN company VARCHAR(255) NOT NULL DEFAULT '' AFTER username"],
                ['job_title', "ALTER TABLE webmail_mailbox_profiles ADD COLUMN job_title VARCHAR(255) NOT NULL DEFAULT '' AFTER company"],
                ['street_address', "ALTER TABLE webmail_mailbox_profiles ADD COLUMN street_address VARCHAR(255) NOT NULL DEFAULT '' AFTER job_title"],
                ['city', "ALTER TABLE webmail_mailbox_profiles ADD COLUMN city VARCHAR(128) NOT NULL DEFAULT '' AFTER street_address"],
                ['region', "ALTER TABLE webmail_mailbox_profiles ADD COLUMN region VARCHAR(128) NOT NULL DEFAULT '' AFTER city"],
                ['postal_code', "ALTER TABLE webmail_mailbox_profiles ADD COLUMN postal_code VARCHAR(64) NOT NULL DEFAULT '' AFTER region"],
                ['country', "ALTER TABLE webmail_mailbox_profiles ADD COLUMN country VARCHAR(128) NOT NULL DEFAULT '' AFTER postal_code"],
                ['notes', 'ALTER TABLE webmail_mailbox_profiles ADD COLUMN notes TEXT NULL AFTER country'],
                ['show_in_directory', 'ALTER TABLE webmail_mailbox_profiles ADD COLUMN show_in_directory TINYINT(1) NOT NULL DEFAULT 1 AFTER notes'],
                ['updated_by', "ALTER TABLE webmail_mailbox_profiles ADD COLUMN updated_by VARCHAR(255) NOT NULL DEFAULT '' AFTER updated_at"],
            ];
            for (const [columnName, statement] of missingColumns) {
                if (!columnNames.has(columnName)) {
                    await db_1.pool.query(statement);
                }
            }
        })();
    }
    return mailboxProfileSchemaPromise;
};
const cleanTextInput = (value, maxLength = 255) => (String(value || '').trim().slice(0, maxLength));
const normalizeOptionalEmailInput = (value) => {
    const email = normalizeEmailInput(value);
    return email ? requireValidMailbox(email) : '';
};
const hasBodyField = (body, field) => Object.prototype.hasOwnProperty.call(body || {}, field);
const hasMailboxProfileFields = (body) => [
    'company',
    'job_title',
    'street_address',
    'address',
    'city',
    'region',
    'postal_code',
    'country',
    'notes',
    'show_in_directory'
].some(field => hasBodyField(body, field));
const mailboxProfileValues = (body, updatedBy) => ({
    company: cleanTextInput(body?.company),
    jobTitle: cleanTextInput(body?.job_title, 255),
    streetAddress: cleanTextInput(body?.street_address ?? body?.address, 255),
    city: cleanTextInput(body?.city, 128),
    region: cleanTextInput(body?.region, 128),
    postalCode: cleanTextInput(body?.postal_code, 64),
    country: cleanTextInput(body?.country, 128),
    notes: cleanTextInput(body?.notes, 2000),
    showInDirectory: body?.show_in_directory === 0 || body?.show_in_directory === false ? 0 : 1,
    updatedBy,
});
const upsertMailboxProfile = async (connection, username, body, updatedBy) => {
    const profile = mailboxProfileValues(body, updatedBy);
    await connection.query(`INSERT INTO webmail_mailbox_profiles
            (username, company, job_title, street_address, city, region, postal_code, country, notes, show_in_directory, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            company = VALUES(company),
            job_title = VALUES(job_title),
            street_address = VALUES(street_address),
            city = VALUES(city),
            region = VALUES(region),
            postal_code = VALUES(postal_code),
            country = VALUES(country),
            notes = VALUES(notes),
            show_in_directory = VALUES(show_in_directory),
            updated_by = VALUES(updated_by)`, [
        username,
        profile.company,
        profile.jobTitle,
        profile.streetAddress,
        profile.city,
        profile.region,
        profile.postalCode,
        profile.country,
        profile.notes,
        profile.showInDirectory,
        profile.updatedBy,
    ]);
};
exports.apiRouter.get('/branding', async (_req, res) => {
    try {
        const settings = await (0, branding_1.getBrandingSettings)();
        res.json({ success: true, settings });
    }
    catch (err) {
        console.error('Failed to load branding settings:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const normalizedUsername = (0, config_1.normalizeMailboxUsername)(username || '');
    try {
        const [rows] = await db_1.pool.query('SELECT password FROM mailbox WHERE username = ? AND active = 1', [normalizedUsername]);
        if (rows.length === 0) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
        const dbHash = rows[0].password;
        // Dovecot sometimes stores bcrypt hashes starting with $2y$
        let isValid = false;
        if (dbHash.startsWith('$2y$') || dbHash.startsWith('$2a$') || dbHash.startsWith('$2b$')) {
            isValid = await bcryptjs_1.default.compare(password, dbHash);
        }
        else {
            // For now, if it's some other format we can't parse easily with bcryptjs, we'll reject or mock
            // In a real scenario we'd handle Dovecot SHA512-CRYPT
            isValid = false;
        }
        if (isValid) {
            // Check if user is an admin
            const [adminRows] = await db_1.pool.query('SELECT 1 FROM admin WHERE username = ? AND active = 1', [normalizedUsername]);
            const isAdmin = adminRows.length > 0;
            await (0, auth_1.createSession)(res, { username: normalizedUsername, password, isAdmin });
            res.json({ success: true, isAdmin, username: normalizedUsername });
        }
        else {
            res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/auth/logout', async (req, res) => {
    await (0, auth_1.clearSession)(req, res);
    res.json({ success: true });
});
exports.apiRouter.get('/auth/me', requireAuth, (req, res) => {
    res.json({ success: true, user: { username: req.user.username, isAdmin: req.user.isAdmin } });
});
exports.apiRouter.get('/rules', requireAuth, async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    try {
        const client = new managesieve_1.ManageSieveClient(config_1.sieveConfig.host, config_1.sieveConfig.port);
        await client.connect();
        await client.login(user, pass);
        let script = '';
        try {
            script = await client.getScript('webmail');
        }
        catch (e) {
            // Script might not exist yet
        }
        await client.logout();
        const jsonData = (0, sieve_compiler_1.extractJsonFromSieve)(script);
        res.json(jsonData);
    }
    catch (err) {
        console.error('Failed to get rules:', err);
        res.status(500).json({ error: err.message });
    }
});
exports.apiRouter.post('/rules', requireAuth, async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    try {
        const jsonData = req.body;
        const scriptContent = (0, sieve_compiler_1.compileSieve)(jsonData);
        const client = new managesieve_1.ManageSieveClient(config_1.sieveConfig.host, config_1.sieveConfig.port);
        await client.connect();
        await client.login(user, pass);
        await client.putScript('webmail', scriptContent);
        await client.setActive('webmail');
        await client.logout();
        res.json({ success: true, message: 'Rules updated and activated' });
    }
    catch (err) {
        console.error('Failed to save rules:', err);
        res.status(500).json({ error: err.message });
    }
});
exports.apiRouter.get('/folders', requireAuth, async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    try {
        const { ImapService } = require('./imap');
        const imap = new ImapService(user, pass);
        await imap.connect();
        const folders = await imap.getFolders();
        await imap.logout();
        res.json({ success: true, folders });
    }
    catch (err) {
        console.error('Failed to fetch folders:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/events', requireAuth, async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const user = req.user.username;
    const pass = req.user.password;
    const folder = req.query.folder || 'INBOX';
    const { ImapService } = require('./imap');
    const imap = new ImapService(user, pass);
    try {
        await imap.connect();
        let isClosed = false;
        req.on('close', async () => {
            isClosed = true;
            try {
                await imap.logout();
            }
            catch (e) { }
        });
        // Start listening to the folder
        const lock = await imap.client.getMailboxLock(folder);
        const onExists = () => {
            if (!isClosed)
                res.write(`data: ${JSON.stringify({ type: 'newMessage', folder })}\n\n`);
        };
        const onFlags = () => {
            if (!isClosed)
                res.write(`data: ${JSON.stringify({ type: 'flagsUpdate', folder })}\n\n`);
        };
        imap.client.on('exists', onExists);
        imap.client.on('flags', onFlags);
        // Optional: Send a ping every 15 seconds to keep connection alive
        const pingInterval = setInterval(() => {
            if (!isClosed)
                res.write(': ping\n\n');
        }, 15000);
        req.on('close', () => {
            clearInterval(pingInterval);
            imap.client.removeListener('exists', onExists);
            imap.client.removeListener('flags', onFlags);
            lock.release();
        });
    }
    catch (e) {
        console.error('SSE Error:', e);
        res.end();
    }
});
exports.apiRouter.get('/folders/:folder/messages', requireAuth, async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const folder = req.params.folder;
    const olderThan = parseInt(String(req.query.olderThan || ''), 10);
    const fetchOlderThan = Number.isFinite(olderThan) && olderThan > 1 ? olderThan : undefined;
    try {
        const { ImapService } = require('./imap');
        const simpleParser = require('mailparser').simpleParser;
        const imap = new ImapService(user, pass);
        await imap.connect();
        const { messages, uidNext, lowestUid, moreAvailable } = await imap.getMessages(folder, undefined, fetchOlderThan);
        await imap.logout();
        const parsedMessages = [];
        const indexRows = [];
        for (let msg of messages) {
            const parsed = await simpleParser(msg.source);
            const summary = parsedMailToSummary(folder, msg, parsed);
            parsedMessages.push(summary);
            indexRows.push(parsedMailToIndexRow(folder, msg, parsed));
        }
        try {
            await (0, search_index_1.upsertMailSearchRows)(user, indexRows);
        }
        catch (indexErr) {
            console.error('Failed to update mail search index:', indexErr);
        }
        res.json({
            success: true,
            messages: parsedMessages.reverse(),
            uidNext,
            lowestUid,
            moreAvailable
        });
    }
    catch (err) {
        console.error('Failed to fetch messages:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/messages/search/index/status', requireAuth, async (req, res) => {
    try {
        const status = await (0, search_index_1.getMailSearchIndexStatus)(req.user.username);
        res.json({ success: true, ...status });
    }
    catch (err) {
        console.error('Failed to get mail search index status:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/messages/search/index/sync', requireAuth, async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const scope = req.body?.scope === 'all' ? 'all' : 'folder';
    const folder = String(req.body?.folder || 'INBOX');
    const requestedLimit = Math.max(1, Math.min(parseInt(String(req.body?.limit || (scope === 'all' ? '40' : '100')), 10) || 100, 250));
    const perFolderLimit = scope === 'all' ? Math.min(requestedLimit, 40) : requestedLimit;
    const { ImapService } = require('./imap');
    const simpleParser = require('mailparser').simpleParser;
    const imap = new ImapService(user, pass);
    try {
        await imap.connect();
        const folderPaths = scope === 'all'
            ? (await imap.getFolders()).map((f) => f.path)
            : [folder];
        let indexed = 0;
        for (const folderPath of folderPaths) {
            const maxUid = await (0, search_index_1.getMaxIndexedUid)(user, folderPath);
            const messages = maxUid > 0
                ? await imap.getMessagesSinceUid(folderPath, maxUid + 1, perFolderLimit)
                : await imap.getRecentMessagesForIndex(folderPath, Math.min(perFolderLimit, 50));
            const rows = [];
            for (const msg of messages) {
                const parsed = await simpleParser(msg.source);
                rows.push(parsedMailToIndexRow(folderPath, msg, parsed));
            }
            indexed += await (0, search_index_1.upsertMailSearchRows)(user, rows);
        }
        res.json({ success: true, indexed, folders: folderPaths.length, perFolderLimit, mode: 'incremental' });
    }
    catch (err) {
        console.error('Failed to synchronize mail search index:', err);
        res.status(500).json({ success: false, error: err.message });
    }
    finally {
        try {
            await imap.logout();
        }
        catch (e) { }
    }
});
exports.apiRouter.post('/messages/search/index', requireAuth, async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const scope = req.body?.scope === 'all' ? 'all' : 'folder';
    const folder = String(req.body?.folder || 'INBOX');
    const requestedLimit = Math.max(1, Math.min(parseInt(String(req.body?.limit || (scope === 'all' ? '50' : '200')), 10) || 50, 250));
    const perFolderLimit = scope === 'all' ? Math.min(requestedLimit, 75) : requestedLimit;
    const { ImapService } = require('./imap');
    const simpleParser = require('mailparser').simpleParser;
    const imap = new ImapService(user, pass);
    try {
        await imap.connect();
        const folderPaths = scope === 'all'
            ? (await imap.getFolders()).map((f) => f.path)
            : [folder];
        let indexed = 0;
        for (const folderPath of folderPaths) {
            const messages = await imap.getRecentMessagesForIndex(folderPath, perFolderLimit);
            const rows = [];
            for (const msg of messages) {
                const parsed = await simpleParser(msg.source);
                rows.push(parsedMailToIndexRow(folderPath, msg, parsed));
            }
            indexed += await (0, search_index_1.upsertMailSearchRows)(user, rows);
        }
        res.json({ success: true, indexed, folders: folderPaths.length, perFolderLimit });
    }
    catch (err) {
        console.error('Failed to rebuild mail search index:', err);
        res.status(500).json({ success: false, error: err.message });
    }
    finally {
        try {
            await imap.logout();
        }
        catch (e) { }
    }
});
exports.apiRouter.get('/messages/search/saved', requireAuth, async (req, res) => {
    try {
        const savedSearches = await (0, search_index_1.listSavedMailSearches)(req.user.username);
        res.json({ success: true, savedSearches });
    }
    catch (err) {
        console.error('Failed to list saved mail searches:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/messages/search/saved', requireAuth, async (req, res) => {
    const name = String(req.body?.name || '').trim();
    const query = String(req.body?.query || '').trim();
    const field = allowedSearchFields.includes(req.body?.field) ? req.body.field : 'all';
    const scope = req.body?.scope === 'all' ? 'all' : 'folder';
    const folder = String(req.body?.folder || 'INBOX');
    if (name.length < 1 || name.length > 80) {
        return res.status(400).json({ success: false, error: 'Saved search name must be 1-80 characters.' });
    }
    if (!isBlankAllowedSearchField(field) && query.length < 2) {
        return res.status(400).json({ success: false, error: 'Search query must be at least 2 characters.' });
    }
    if (query.length > 128) {
        return res.status(400).json({ success: false, error: 'Search query is too long.' });
    }
    try {
        const savedSearch = await (0, search_index_1.createSavedMailSearch)(req.user.username, { name, query, field, scope, folder });
        res.json({ success: true, savedSearch });
    }
    catch (err) {
        console.error('Failed to save mail search:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.delete('/messages/search/saved/:id', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id < 1) {
        return res.status(400).json({ success: false, error: 'Invalid saved search id.' });
    }
    try {
        const deleted = await (0, search_index_1.deleteSavedMailSearch)(req.user.username, id);
        res.json({ success: true, deleted });
    }
    catch (err) {
        console.error('Failed to delete saved mail search:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/messages/search', requireAuth, async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const query = String(req.query.q || '').trim();
    const field = allowedSearchFields.includes(req.query.field) ? req.query.field : 'all';
    const scope = req.query.scope === 'all' ? 'all' : 'folder';
    const folder = String(req.query.folder || 'INBOX');
    const limit = Math.max(1, Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 100));
    if (!isBlankAllowedSearchField(field) && query.length < 2) {
        return res.status(400).json({ success: false, error: 'Search query must be at least 2 characters.' });
    }
    if (query.length > 128) {
        return res.status(400).json({ success: false, error: 'Search query is too long.' });
    }
    const { ImapService } = require('./imap');
    const simpleParser = require('mailparser').simpleParser;
    const imap = new ImapService(user, pass);
    try {
        const indexedMessages = await (0, search_index_1.searchMailIndex)(user, { query, field, scope, folder, limit });
        if (indexedMessages.length > 0 || field === 'attachments') {
            return res.json({ success: true, messages: indexedMessages, query, scope, field, source: 'index' });
        }
        await imap.connect();
        const folderPaths = scope === 'all'
            ? (await imap.getFolders()).map((f) => f.path)
            : [folder];
        const results = await imap.searchMessages(folderPaths, query, field, limit);
        const parsedMessages = [];
        const indexRows = [];
        for (let msg of results) {
            const parsed = await simpleParser(msg.source);
            parsedMessages.push(parsedMailToSummary(msg.folder, msg, parsed, 180));
            indexRows.push(parsedMailToIndexRow(msg.folder, msg, parsed));
        }
        try {
            await (0, search_index_1.upsertMailSearchRows)(user, indexRows);
        }
        catch (indexErr) {
            console.error('Failed to update mail search index from IMAP search:', indexErr);
        }
        parsedMessages.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
        res.json({ success: true, messages: parsedMessages.slice(0, limit), query, scope, field, source: 'imap' });
    }
    catch (err) {
        console.error('Failed to search messages:', err);
        res.status(500).json({ success: false, error: err.message });
    }
    finally {
        try {
            await imap.logout();
        }
        catch (e) { }
    }
});
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config_1.serverConfig.uploadLimitBytes } });
exports.apiRouter.post('/messages/send', requireAuth, upload.array('attachments'), async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const { from, to, cc, bcc, replyTo, subject, html, text, draftUid } = req.body;
    const files = req.files || [];
    try {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
            host: config_1.smtpConfig.host,
            port: config_1.smtpConfig.port,
            secure: config_1.smtpConfig.secure,
            auth: { user, pass },
            tls: { rejectUnauthorized: config_1.smtpConfig.rejectUnauthorized }
        });
        // Ensure "from" is valid. If it's just an email, format it. If we can get a name, use it.
        // If the user didn't specify from or it's empty, default to their username.
        const senderEmail = from || user;
        const [mailboxRows] = await db_1.pool.query('SELECT name FROM mailbox WHERE username = ?', [user]);
        const senderName = mailboxRows.length > 0 && mailboxRows[0].name ? mailboxRows[0].name : '';
        const fromHeader = senderName ? `"${senderName}" <${senderEmail}>` : senderEmail;
        const mailOptions = {
            from: fromHeader,
            to,
            cc,
            bcc,
            replyTo,
            subject,
            text,
            html,
            attachments: files.map((f) => ({
                filename: f.originalname,
                content: f.buffer
            }))
        };
        const info = await transporter.sendMail(mailOptions);
        if (to) {
            const emails = to.split(',').map((e) => e.trim());
            for (const email of emails) {
                if (email) {
                    const match = email.match(/(.*)<(.+)>/);
                    let contactName = '';
                    let contactEmail = email;
                    if (match) {
                        contactName = match[1].replace(/"/g, '').trim();
                        contactEmail = match[2].trim();
                    }
                    if (!contactName)
                        contactName = contactEmail.split('@')[0];
                    try {
                        await db_1.pool.query('INSERT IGNORE INTO contacts (username, name, email) VALUES (?, ?, ?)', [user, contactName, contactEmail]);
                    }
                    catch (e) { }
                }
            }
        }
        const { ImapService } = require('./imap');
        const imap = new ImapService(user, pass);
        await imap.connect();
        const folders = await imap.getFolders();
        let sentFolder = folders.find((f) => f.path.toLowerCase().includes('sent'))?.path;
        if (!sentFolder) {
            try {
                await imap.client.mailboxCreate('Sent');
            }
            catch (e) { }
            sentFolder = 'Sent';
        }
        const MailComposer = require('nodemailer/lib/mail-composer');
        const mail = new MailComposer(mailOptions);
        const rawMessage = await mail.compile().build();
        await imap.appendMessage(sentFolder, rawMessage, ['\\Seen']);
        // Delete draft if one exists
        if (draftUid) {
            let draftsFolder = folders.find((f) => f.path.toLowerCase().includes('draft'))?.path;
            if (draftsFolder) {
                try {
                    await imap.messageAction(draftsFolder, [parseInt(draftUid, 10)], 'delete');
                }
                catch (e) {
                    console.error('Failed to delete sent draft', e);
                }
            }
        }
        await imap.logout();
        res.json({ success: true });
    }
    catch (err) {
        console.error('Failed to parse message:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/messages/draft', requireAuth, upload.array('attachments'), async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const { from, to, cc, bcc, replyTo, subject, html, text, draftUid } = req.body;
    const files = req.files || [];
    try {
        const nodemailer = require('nodemailer');
        const senderEmail = from || user;
        const [mailboxRows] = await db_1.pool.query('SELECT name FROM mailbox WHERE username = ?', [user]);
        const senderName = mailboxRows.length > 0 && mailboxRows[0].name ? mailboxRows[0].name : '';
        const fromHeader = senderName ? `"${senderName}" <${senderEmail}>` : senderEmail;
        const mailOptions = {
            from: fromHeader,
            to: to || '',
            cc: cc || '',
            bcc: bcc || '',
            replyTo: replyTo || '',
            subject: subject || 'No Subject',
            text: text || '',
            html: html || '',
            attachments: files.map((f) => ({
                filename: f.originalname,
                content: f.buffer
            }))
        };
        const { ImapService } = require('./imap');
        const imap = new ImapService(user, pass);
        await imap.connect();
        const folders = await imap.getFolders();
        let draftsFolder = folders.find((f) => f.path.toLowerCase().includes('draft'))?.path;
        if (!draftsFolder) {
            try {
                await imap.client.mailboxCreate('Drafts');
            }
            catch (e) { }
            draftsFolder = 'Drafts';
        }
        const MailComposer = require('nodemailer/lib/mail-composer');
        const mail = new MailComposer(mailOptions);
        const rawMessage = await mail.compile().build();
        // If there's a previous draft, delete it
        if (draftUid) {
            try {
                await imap.messageAction(draftsFolder, [parseInt(draftUid, 10)], 'delete');
            }
            catch (e) {
                console.error('Failed to delete old draft', e);
            }
        }
        const appendRes = await imap.client.append(draftsFolder, rawMessage, ['\\Draft', '\\Seen']);
        await imap.logout();
        res.json({ success: true, draftUid: appendRes.uid });
    }
    catch (err) {
        console.error('Failed to save draft:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/messages/action', requireAuth, async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const { folder, uids, action, targetFolder } = req.body;
    const allowedActions = ['delete', 'archive', 'spam', 'move', 'read', 'unread', 'star', 'unstar'];
    if (!folder || !uids || !Array.isArray(uids) || uids.length === 0 || !allowedActions.includes(action)) {
        return res.status(400).json({ success: false, error: 'Missing required parameters' });
    }
    try {
        const { ImapService } = require('./imap');
        const imap = new ImapService(user, pass);
        await imap.connect();
        const actionResult = await imap.messageAction(folder, uids, action, targetFolder);
        await imap.logout();
        try {
            if (action === 'read') {
                await (0, search_index_1.updateMailSearchFlags)(user, folder, uids, { isRead: true });
            }
            else if (action === 'unread') {
                await (0, search_index_1.updateMailSearchFlags)(user, folder, uids, { isRead: false });
            }
            else if (action === 'star') {
                await (0, search_index_1.updateMailSearchFlags)(user, folder, uids, { isStarred: true });
            }
            else if (action === 'unstar') {
                await (0, search_index_1.updateMailSearchFlags)(user, folder, uids, { isStarred: false });
            }
            else {
                await (0, search_index_1.deleteMailSearchRows)(user, folder, uids);
            }
        }
        catch (indexErr) {
            console.error('Failed to update mail search index after message action:', indexErr);
        }
        const uidMap = actionResult?.uidMap || null;
        const undoUids = uidMap
            ? uids.map((uid) => Number(uidMap[String(uid)] || uidMap[uid])).filter((uid) => Number.isFinite(uid))
            : [];
        res.json({
            success: true,
            targetFolder: actionResult?.targetFolder,
            undoUids,
        });
    }
    catch (err) {
        console.error('Failed to perform action:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/folders/:folder/messages/:uid/attachments/:attachmentId', requireAuth, async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const folder = req.params.folder;
    const uid = parseInt(req.params.uid, 10);
    const attachmentId = parseInt(req.params.attachmentId, 10);
    const forceDownload = req.query.download === '1';
    if (!Number.isFinite(uid) || uid < 1 || !Number.isFinite(attachmentId) || attachmentId < 0) {
        return res.status(400).json({ success: false, error: 'Invalid attachment request' });
    }
    const { ImapService } = require('./imap');
    const simpleParser = require('mailparser').simpleParser;
    const imap = new ImapService(user, pass);
    try {
        await imap.connect();
        const msg = await imap.getMessageByUid(folder, uid);
        await imap.logout();
        if (!msg)
            return res.status(404).json({ success: false, error: 'Message not found' });
        const parsed = await simpleParser(msg.source);
        const attachments = getVisibleAttachments(parsed);
        const attachment = attachments[attachmentId];
        if (!attachment || !attachment.content) {
            return res.status(404).json({ success: false, error: 'Attachment not found' });
        }
        const contentType = attachment.contentType || 'application/octet-stream';
        const filename = attachment.filename || `attachment-${attachmentId + 1}`;
        const disposition = forceDownload || !isPreviewableAttachment(contentType) ? 'attachment' : 'inline';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', attachment.content.length);
        res.setHeader('Content-Disposition', `${disposition}; ${encodeAttachmentFilename(filename)}`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.send(attachment.content);
    }
    catch (err) {
        console.error('Failed to fetch attachment:', err);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
    finally {
        try {
            await imap.logout();
        }
        catch (e) { }
    }
});
exports.apiRouter.get('/folders/:folder/messages/:uid', requireAuth, async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const folder = req.params.folder;
    const uid = parseInt(req.params.uid);
    try {
        const { ImapService } = require('./imap');
        const simpleParser = require('mailparser').simpleParser;
        const imap = new ImapService(user, pass);
        await imap.connect();
        const msg = await imap.getMessageByUid(folder, uid);
        await imap.logout();
        if (!msg)
            return res.status(404).json({ success: false, error: 'Not found' });
        const parsed = await simpleParser(msg.source);
        res.json({
            success: true,
            message: {
                uid: msg.uid,
                subject: parsed.subject || '(No Subject)',
                from: parsed.from?.text || '',
                to: parsed.to?.text || '',
                date: parsed.date,
                html: parsed.html || parsed.textAsHtml,
                text: parsed.text,
                isRead: msg.flags.includes('\\Seen'),
                isStarred: msg.flags.includes('\\Flagged'),
                hasAttachments: getVisibleAttachments(parsed).length > 0,
                attachments: getAttachmentMetadata(parsed)
            }
        });
    }
    catch (err) {
        console.error('Failed to fetch message:', err);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});
exports.apiRouter.get('/user/identities', requireAuth, async (req, res) => {
    try {
        const username = req.user.username;
        const [mailboxRows] = await db_1.pool.query('SELECT name FROM mailbox WHERE username = ?', [username]);
        const name = mailboxRows.length > 0 ? mailboxRows[0].name : '';
        const [aliasRows] = await db_1.pool.query('SELECT address FROM alias WHERE goto LIKE ? AND active = 1', [`%${username}%`]);
        const aliases = aliasRows.map((row) => row.address).filter((addr) => addr !== username);
        res.json({ success: true, name, address: username, aliases });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/contacts', requireAuth, async (req, res) => {
    const user = req.user.username;
    try {
        const [rows] = await db_1.pool.query('SELECT id, name, email, phone FROM contacts WHERE username = ?', [user]);
        res.json({ success: true, contacts: rows });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/directory', requireAuth, async (_req, res) => {
    try {
        await ensureMailboxProfileSchema();
        const [rows] = await db_1.pool.query(`
            SELECT
                m.username AS email,
                m.name,
                m.phone,
                m.email_other,
                p.company,
                p.job_title,
                p.street_address,
                p.city,
                p.region,
                p.postal_code,
                p.country,
                p.notes
            FROM mailbox m
            LEFT JOIN webmail_mailbox_profiles p ON p.username = m.username
            WHERE m.active = 1
              AND COALESCE(p.show_in_directory, 1) = 1
            ORDER BY m.name ASC, m.username ASC
        `);
        res.json({
            success: true,
            contacts: rows.map((row) => ({
                id: `directory:${row.email}`,
                name: row.name || row.email,
                email: row.email,
                phone: row.phone || '',
                alternateEmail: row.email_other || '',
                company: row.company || '',
                jobTitle: row.job_title || '',
                address: [row.street_address, row.city, row.region, row.postal_code, row.country].filter(Boolean).join(', '),
                notes: row.notes || '',
                source: 'directory',
            })),
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/contacts', requireAuth, async (req, res) => {
    const user = req.user.username;
    const { name, email, phone } = req.body;
    if (!name || !email)
        return res.status(400).json({ success: false, error: 'Name and email required' });
    try {
        await db_1.pool.query('INSERT INTO contacts (username, name, email, phone) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), phone = VALUES(phone)', [user, cleanTextInput(name), requireValidMailbox(email), cleanTextInput(phone, 30)]);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/settings/forwarding', requireAuth, async (req, res) => {
    const user = req.user.username;
    try {
        const [rows] = await db_1.pool.query('SELECT goto FROM alias WHERE address = ?', [user]);
        res.json({ success: true, goto: rows.length > 0 ? rows[0].goto : '' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/settings/forwarding', requireAuth, async (req, res) => {
    const user = req.user.username;
    const { goto } = req.body;
    try {
        await db_1.pool.query('UPDATE alias SET goto = ?, modified = NOW() WHERE address = ?', [goto, user]);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/settings/:namespace', requireAuth, async (req, res) => {
    const namespace = req.params.namespace;
    if (!(0, user_settings_1.isSettingsNamespace)(namespace)) {
        return res.status(404).json({ success: false, error: 'Unknown settings namespace' });
    }
    try {
        const settings = await (0, user_settings_1.getUserSettings)(req.user.username, namespace);
        res.json({ success: true, namespace, settings });
    }
    catch (err) {
        console.error('Failed to load user settings:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.put('/settings/:namespace', requireAuth, async (req, res) => {
    const namespace = req.params.namespace;
    if (!(0, user_settings_1.isSettingsNamespace)(namespace)) {
        return res.status(404).json({ success: false, error: 'Unknown settings namespace' });
    }
    try {
        const settings = await (0, user_settings_1.saveUserSettings)(req.user.username, namespace, req.body?.settings);
        res.json({ success: true, namespace, settings });
    }
    catch (err) {
        console.error('Failed to save user settings:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
// Admin Endpoints
exports.apiRouter.get('/admin/branding', requireAuth, requireAdmin, async (_req, res) => {
    try {
        const settings = await (0, branding_1.getBrandingSettings)();
        res.json({ success: true, settings });
    }
    catch (err) {
        console.error('Failed to load admin branding settings:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.put('/admin/branding', requireAuth, requireAdmin, async (req, res) => {
    try {
        const settings = await (0, branding_1.saveBrandingSettings)(req.body?.settings, req.user.username);
        await logAdminAction(req, 'branding.update', 'branding', 'global', {
            appName: settings.appName,
            companyName: settings.companyName,
            imagesUpdated: ['appIconDataUrl', 'faviconDataUrl', 'loginLogoDataUrl', 'loginBackgroundDataUrl']
                .filter((key) => Object.prototype.hasOwnProperty.call(req.body?.settings || {}, key)),
        });
        res.json({ success: true, settings });
    }
    catch (err) {
        console.error('Failed to save admin branding settings:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/admin/settings/:namespace', requireAuth, requireAdmin, async (req, res) => {
    const namespace = req.params.namespace;
    if (!(0, admin_settings_1.isAdminSettingsNamespace)(namespace)) {
        return res.status(404).json({ success: false, error: 'Unknown admin settings namespace' });
    }
    try {
        const settings = await (0, admin_settings_1.getAdminSettings)(namespace);
        res.json({ success: true, namespace, settings });
    }
    catch (err) {
        console.error('Failed to load admin settings:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.put('/admin/settings/:namespace', requireAuth, requireAdmin, async (req, res) => {
    const namespace = req.params.namespace;
    if (!(0, admin_settings_1.isAdminSettingsNamespace)(namespace)) {
        return res.status(404).json({ success: false, error: 'Unknown admin settings namespace' });
    }
    try {
        const settings = await (0, admin_settings_1.saveAdminSettings)(namespace, req.body?.settings, req.user.username);
        await logAdminAction(req, `settings.${namespace}.update`, 'admin_settings', namespace, { namespace });
        res.json({ success: true, namespace, settings });
    }
    catch (err) {
        console.error('Failed to save admin settings:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/admin/domains', requireAuth, requireAdmin, async (req, res) => {
    try {
        const [rows] = await db_1.pool.query(`
            SELECT
                d.domain,
                d.description,
                d.aliases,
                d.mailboxes,
                d.maxquota,
                d.quota,
                d.transport,
                d.backupmx,
                d.created,
                d.modified,
                d.active,
                dv.token AS verify_token
            FROM domain d
            LEFT JOIN domain_verification dv ON dv.domain = d.domain
            WHERE d.domain != "ALL"
        `);
        res.json({ success: true, data: rows });
    }
    catch (err) {
        console.error('Database Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/admin/domains', requireAuth, requireAdmin, async (req, res) => {
    try {
        const domain = requireValidDomain(req.body?.domain);
        const maxquota = Math.max(0, parseQuotaBytes(req.body?.maxquota, 0));
        const quota = Math.max(0, parseQuotaBytes(req.body?.quota, 0));
        await db_1.pool.query('INSERT INTO domain (domain, description, maxquota, quota, transport, active, created, modified) VALUES (?, "", ?, ?, "virtual", 1, NOW(), NOW())', [domain, maxquota, quota]);
        await logAdminAction(req, 'domain.create', 'domain', domain, { domain, maxquota, quota });
        res.json({ success: true });
    }
    catch (err) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/admin/domains/:domain/dns', requireAuth, requireAdmin, async (req, res) => {
    try {
        const domain = requireValidDomain(req.params.domain);
        let mailHost = os_1.default.hostname();
        try {
            mailHost = new URL(config_1.serverConfig.publicBaseUrl || `https://${config_1.serverConfig.defaultDomain || os_1.default.hostname()}`).hostname || mailHost;
        }
        catch {
            mailHost = config_1.serverConfig.defaultDomain || mailHost;
        }
        const records = [
            { type: 'MX', name: '@', value: `10 ${mailHost}.`, description: 'Mail exchanger' },
            { type: 'TXT', name: '@', value: `v=spf1 mx a:${mailHost} -all`, description: 'SPF record' },
            { type: 'TXT', name: '_dmarc', value: 'v=DMARC1; p=quarantine; sp=quarantine; adkim=r; aspf=r;', description: 'DMARC record' },
        ];
        const dkimPath = `/var/lib/rspamd/dkim/${domain}.pub`;
        if (fs_1.default.existsSync(dkimPath)) {
            const publicKey = fs_1.default.readFileSync(dkimPath, 'utf8');
            const match = publicKey.match(/\(\s*([^)]+)\s*\)/s);
            const value = match ? match[1].replace(/["\s]/g, '') : publicKey.replace(/-----[^-]+-----|\s/g, '');
            records.push({ type: 'TXT', name: 'mail._domainkey', value, description: 'DKIM public key' });
        }
        else {
            records.push({ type: 'TXT', name: 'mail._domainkey', value: 'Pending generation... (check back later)', description: 'DKIM public key' });
        }
        const [verificationRows] = await db_1.pool.query('SELECT token FROM domain_verification WHERE domain = ? LIMIT 1', [domain]);
        if (verificationRows.length > 0) {
            records.push({
                type: 'TXT',
                name: '_openmailstack',
                value: `openmailstack-verify=${verificationRows[0].token}`,
                description: 'Domain verification',
            });
        }
        res.json({ success: true, data: records });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.delete('/admin/domains/:domain', requireAuth, requireAdmin, async (req, res) => {
    try {
        const domain = requireValidDomain(req.params.domain);
        await withTransaction(async (connection) => {
            await connection.query('DELETE FROM mailbox WHERE domain = ?', [domain]);
            await connection.query('DELETE FROM alias WHERE domain = ?', [domain]);
            await connection.query('DELETE FROM alias_domain WHERE alias_domain = ? OR target_domain = ?', [domain, domain]);
            await connection.query('DELETE FROM domain_admins WHERE domain = ?', [domain]);
            await connection.query('DELETE FROM domain_verification WHERE domain = ?', [domain]);
            await connection.query('DELETE FROM domain WHERE domain = ?', [domain]);
        });
        await logAdminAction(req, 'domain.delete', 'domain', domain, { domain });
        res.json({ success: true });
    }
    catch (err) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});
// Admins
exports.apiRouter.get('/admin/admins', requireAuth, requireAdmin, async (req, res) => {
    try {
        const [rows] = await db_1.pool.query('SELECT username, created, modified, active, superadmin FROM admin');
        res.json({ success: true, data: rows });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/admin/admins', requireAuth, requireAdmin, async (req, res) => {
    try {
        const username = requireValidMailbox(req.body?.username);
        // Copy password from mailbox if they exist, otherwise use dummy password
        const [mbRows] = await db_1.pool.query('SELECT password FROM mailbox WHERE username = ?', [username]);
        const pass = mbRows.length > 0 ? mbRows[0].password : '';
        await db_1.pool.query('INSERT INTO admin (username, password, created, modified) VALUES (?, ?, NOW(), NOW()) ON DUPLICATE KEY UPDATE active=1', [username, pass]);
        await logAdminAction(req, 'admin.promote', 'admin', username, { username });
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.delete('/admin/admins/:username', requireAuth, requireAdmin, async (req, res) => {
    try {
        const username = requireValidMailbox(req.params.username);
        await db_1.pool.query('DELETE FROM admin WHERE username = ?', [username]);
        await logAdminAction(req, 'admin.demote', 'admin', username, { username });
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// Audit Logs
exports.apiRouter.get('/admin/logs', requireAuth, requireAdmin, async (req, res) => {
    try {
        await ensureAdminAuditSchema();
        const [rows] = await db_1.pool.query(`
            SELECT
                id,
                created_at AS timestamp,
                actor AS username,
                target_domain AS domain,
                action,
                details AS data
            FROM webmail_admin_audit
            ORDER BY created_at DESC
            LIMIT 100
        `);
        res.json({ success: true, data: rows });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/admin/mailboxes', requireAuth, requireAdmin, async (req, res) => {
    try {
        await ensureMailboxProfileSchema();
        const [rows] = await db_1.pool.query(`
            SELECT
                m.username,
                m.name,
                m.maildir,
                m.quota,
                m.local_part,
                m.domain,
                m.created,
                m.modified,
                m.active,
                m.phone,
                m.email_other,
                m.token,
                m.token_validity,
                p.company,
                p.job_title,
                p.street_address,
                p.city,
                p.region,
                p.postal_code,
                p.country,
                p.notes,
                COALESCE(p.show_in_directory, 1) AS show_in_directory
            FROM mailbox m
            LEFT JOIN webmail_mailbox_profiles p ON p.username = m.username
            ORDER BY m.domain ASC, m.username ASC
        `);
        res.json({ success: true, data: rows });
    }
    catch (err) {
        console.error('Database Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/admin/mailboxes', requireAuth, requireAdmin, async (req, res) => {
    try {
        await ensureMailboxProfileSchema();
        const localPart = requireValidLocalPart(req.body?.username);
        const domain = requireValidDomain(req.body?.domain);
        const fullEmail = `${localPart}@${domain}`;
        const name = String(req.body?.name || '').trim();
        const quota = await quotaInputToBytes(req.body?.quota, domain, 0);
        const hash = await hashMailboxPassword(String(req.body?.password || ''));
        const phone = cleanTextInput(req.body?.phone, 30);
        const emailOther = normalizeOptionalEmailInput(req.body?.email_other || req.body?.alternate_email);
        await withTransaction(async (connection) => {
            await connection.query('INSERT INTO mailbox (username, password, name, maildir, quota, local_part, domain, active, phone, email_other, created, modified) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NOW(), NOW())', [fullEmail, hash, name, `${domain}/${localPart}/`, quota, localPart, domain, phone, emailOther]);
            await connection.query('INSERT INTO alias (address, goto, domain, active, created, modified) VALUES (?, ?, ?, 1, NOW(), NOW()) ON DUPLICATE KEY UPDATE goto = VALUES(goto), active = 1, modified = NOW()', [fullEmail, fullEmail, domain]);
            if (hasMailboxProfileFields(req.body)) {
                await upsertMailboxProfile(connection, fullEmail, req.body, req.user.username);
            }
        });
        await logAdminAction(req, 'mailbox.create', 'mailbox', fullEmail, {
            domain,
            name,
            quota,
            hasProfile: hasMailboxProfileFields(req.body),
        });
        res.json({ success: true });
    }
    catch (err) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});
exports.apiRouter.put('/admin/mailboxes/:username', requireAuth, requireAdmin, async (req, res) => {
    try {
        await ensureMailboxProfileSchema();
        const oldUsername = requireValidMailbox(req.params.username);
        const newUsername = requireValidMailbox(req.body?.username || oldUsername);
        if (newUsername !== oldUsername) {
            return res.status(400).json({ success: false, error: 'Mailbox renaming is not available from this admin panel yet' });
        }
        const domain = oldUsername.split('@')[1];
        const name = String(req.body?.name || '').trim();
        const quota = await quotaInputToBytes(req.body?.quota, domain, 0);
        const active = req.body?.active === 0 || req.body?.active === false ? 0 : 1;
        const [existingRows] = await db_1.pool.query('SELECT phone, email_other FROM mailbox WHERE username = ? LIMIT 1', [oldUsername]);
        if (existingRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Mailbox not found' });
        }
        const hasPhone = hasBodyField(req.body, 'phone');
        const hasEmailOther = hasBodyField(req.body, 'email_other') || hasBodyField(req.body, 'alternate_email');
        const phone = hasPhone ? cleanTextInput(req.body?.phone, 30) : existingRows[0].phone || '';
        const emailOther = hasEmailOther ? normalizeOptionalEmailInput(req.body?.email_other || req.body?.alternate_email) : existingRows[0].email_other || '';
        await withTransaction(async (connection) => {
            await connection.query('UPDATE mailbox SET name = ?, quota = ?, active = ?, phone = ?, email_other = ?, modified = NOW() WHERE username = ?', [name, quota, active, phone, emailOther, oldUsername]);
            await connection.query('UPDATE alias SET active = ?, modified = NOW() WHERE address = ? AND goto = ?', [active, oldUsername, oldUsername]);
            if (hasMailboxProfileFields(req.body)) {
                await upsertMailboxProfile(connection, oldUsername, req.body, req.user.username);
            }
        });
        await logAdminAction(req, 'mailbox.update', 'mailbox', oldUsername, {
            domain,
            name,
            quota,
            active,
            profileUpdated: hasMailboxProfileFields(req.body),
        });
        res.json({ success: true });
    }
    catch (err) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/admin/mailboxes/:username/password', requireAuth, requireAdmin, async (req, res) => {
    try {
        const username = requireValidMailbox(req.params.username);
        const hash = await hashMailboxPassword(String(req.body?.password || ''));
        await withTransaction(async (connection) => {
            await connection.query('UPDATE mailbox SET password = ?, modified = NOW() WHERE username = ?', [hash, username]);
            await connection.query('UPDATE admin SET password = ?, modified = NOW() WHERE username = ?', [hash, username]);
        });
        await logAdminAction(req, 'mailbox.password_reset', 'mailbox', username);
        res.json({ success: true });
    }
    catch (err) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});
exports.apiRouter.delete('/admin/mailboxes/:username', requireAuth, requireAdmin, async (req, res) => {
    try {
        const username = requireValidMailbox(req.params.username);
        await withTransaction(async (connection) => {
            await connection.query('DELETE FROM mailbox WHERE username = ?', [username]);
            await connection.query('DELETE FROM alias WHERE address = ? AND goto = ?', [username, username]);
        });
        await logAdminAction(req, 'mailbox.delete', 'mailbox', username);
        res.json({ success: true });
    }
    catch (err) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/admin/aliases', requireAuth, requireAdmin, async (req, res) => {
    try {
        const [rows] = await db_1.pool.query(`
            SELECT address, goto, domain, created, modified, active
            FROM alias
            WHERE address != goto
            ORDER BY domain ASC, address ASC
        `);
        res.json({ success: true, data: rows });
    }
    catch (err) {
        console.error('Database Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/admin/aliases', requireAuth, requireAdmin, async (req, res) => {
    try {
        const address = normalizeAliasAddress(req.body?.address, req.body?.domain);
        const domain = deriveDomainFromAddress(address);
        const goto = normalizeAliasTargets(req.body?.goto);
        await db_1.pool.query('INSERT INTO alias (address, goto, domain, active, created, modified) VALUES (?, ?, ?, 1, NOW(), NOW())', [address, goto, domain]);
        await logAdminAction(req, 'alias.create', 'alias', address, {
            domain,
            targetCount: goto.split(',').filter(Boolean).length,
        });
        res.json({ success: true });
    }
    catch (err) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});
exports.apiRouter.put('/admin/aliases/:address', requireAuth, requireAdmin, async (req, res) => {
    try {
        const oldAddress = normalizeAliasAddress(req.params.address);
        const address = normalizeAliasAddress(req.body?.address || oldAddress, req.body?.domain);
        const domain = deriveDomainFromAddress(address);
        const goto = normalizeAliasTargets(req.body?.goto);
        const [result] = await db_1.pool.query('UPDATE alias SET address = ?, goto = ?, domain = ?, modified = NOW() WHERE address = ?', [address, goto, domain, oldAddress]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Alias not found' });
        }
        await logAdminAction(req, 'alias.update', 'alias', address, {
            domain,
            previousAddress: oldAddress,
            targetCount: goto.split(',').filter(Boolean).length,
        });
        res.json({ success: true });
    }
    catch (err) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});
exports.apiRouter.delete('/admin/aliases/:address', requireAuth, requireAdmin, async (req, res) => {
    try {
        const address = normalizeAliasAddress(req.params.address);
        await db_1.pool.query('DELETE FROM alias WHERE address = ?', [address]);
        await logAdminAction(req, 'alias.delete', 'alias', address);
        res.json({ success: true });
    }
    catch (err) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/admin/routing', requireAuth, requireAdmin, async (_req, res) => {
    try {
        const [rows] = await db_1.pool.query(`
            SELECT alias_domain, target_domain, created, modified, active
            FROM alias_domain
            ORDER BY alias_domain ASC
        `);
        res.json({ success: true, data: rows });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/admin/routing', requireAuth, requireAdmin, async (req, res) => {
    try {
        const aliasDomain = requireValidDomain(req.body?.alias_domain);
        const targetDomain = requireValidDomain(req.body?.target_domain);
        if (aliasDomain === targetDomain) {
            return res.status(400).json({ success: false, error: 'Target domain must be different from alias domain' });
        }
        const [domainRows] = await db_1.pool.query('SELECT 1 FROM domain WHERE domain = ? LIMIT 1', [targetDomain]);
        if (domainRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Target domain not found' });
        }
        await db_1.pool.query('INSERT INTO alias_domain (alias_domain, target_domain, active, created, modified) VALUES (?, ?, 1, NOW(), NOW())', [aliasDomain, targetDomain]);
        await logAdminAction(req, 'routing.create', 'routing', aliasDomain, {
            domain: aliasDomain,
            targetDomain,
        });
        res.json({ success: true });
    }
    catch (err) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});
exports.apiRouter.delete('/admin/routing/:aliasDomain', requireAuth, requireAdmin, async (req, res) => {
    try {
        const aliasDomain = requireValidDomain(req.params.aliasDomain);
        await db_1.pool.query('DELETE FROM alias_domain WHERE alias_domain = ?', [aliasDomain]);
        await logAdminAction(req, 'routing.delete', 'routing', aliasDomain, { domain: aliasDomain });
        res.json({ success: true });
    }
    catch (err) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/admin/apikeys', requireAuth, requireAdmin, async (req, res) => {
    try {
        const [rows] = await db_1.pool.query('SELECT id, description, created_at, last_used FROM api_keys ORDER BY created_at DESC');
        res.json({ success: true, data: rows });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/admin/apikeys', requireAuth, requireAdmin, async (req, res) => {
    const { description } = req.body;
    try {
        const raw_key = 'sk_' + crypto_1.default.randomBytes(32).toString('hex');
        const key_hash = await bcryptjs_1.default.hash(raw_key, 10);
        await db_1.pool.query('INSERT INTO api_keys (description, key_hash, created_at) VALUES (?, ?, NOW())', [description, key_hash]);
        await logAdminAction(req, 'apikey.create', 'api_key', String(description || '').slice(0, 255), {
            description: String(description || '').slice(0, 255),
        });
        res.json({ success: true, raw_key });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.delete('/admin/apikeys/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        await db_1.pool.query('DELETE FROM api_keys WHERE id = ?', [req.params.id]);
        await logAdminAction(req, 'apikey.delete', 'api_key', String(req.params.id || ''));
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/admin/updates', requireAuth, requireAdmin, async (req, res) => {
    try {
        const components = {};
        try {
            const { stdout } = await execPromise("nginx -v 2>&1 | awk -F/ '{print $2}' | awk '{print $1}'");
            components.Nginx = stdout.trim();
        }
        catch (e) {
            components.Nginx = 'Not Installed';
        }
        try {
            const { stdout } = await execPromise("postconf -h mail_version 2>/dev/null");
            components.Postfix = stdout.trim();
        }
        catch (e) {
            components.Postfix = 'Not Installed';
        }
        try {
            const { stdout } = await execPromise("dovecot --version 2>/dev/null | awk '{print $1}'");
            components.Dovecot = stdout.trim();
        }
        catch (e) {
            components.Dovecot = 'Not Installed';
        }
        res.json({
            success: true,
            current_version: '1.2.0',
            latest_version: '1.2.0',
            has_update: false,
            components
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/admin/spam_policies', requireAuth, requireAdmin, async (req, res) => {
    try {
        const [rows] = await db_1.pool.query('SELECT rules_json FROM global_spam_rules WHERE id = 1');
        const rules = rows.length > 0 ? rows[0].rules_json : null;
        res.json({ success: true, rules: rules ? JSON.parse(rules) : null });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/admin/spam_policies', requireAuth, requireAdmin, async (req, res) => {
    const { rules } = req.body;
    try {
        const rulesStr = JSON.stringify(rules);
        await db_1.pool.query('INSERT INTO global_spam_rules (id, rules_json) VALUES (1, ?) ON DUPLICATE KEY UPDATE rules_json = ?', [rulesStr, rulesStr]);
        await logAdminAction(req, 'spam_policy.update', 'spam_policy', 'global', {
            bytes: Buffer.byteLength(rulesStr, 'utf8'),
        });
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
//# sourceMappingURL=api.js.map