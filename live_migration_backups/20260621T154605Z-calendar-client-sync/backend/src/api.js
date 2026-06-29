"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiRouter = void 0;
const express_1 = require("express");
const managesieve_1 = require("./managesieve");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("./db");
const auth_1 = require("./auth");
const config_1 = require("./config");
const sieve_compiler_1 = require("./sieve-compiler");
const search_index_1 = require("./search-index");
exports.apiRouter = (0, express_1.Router)();
const requireAuth = auth_1.requireSession;
const requireAdmin = auth_1.requireAdminSession;
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
    const { from, to, subject, html, text, draftUid } = req.body;
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
    const { from, to, subject, html, text, draftUid } = req.body;
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
        await imap.messageAction(folder, uids, action, targetFolder);
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
        res.json({ success: true });
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
        const [rows] = await db_1.pool.query('SELECT id, name, email FROM contacts WHERE username = ?', [user]);
        res.json({ success: true, contacts: rows });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/contacts', requireAuth, async (req, res) => {
    const user = req.user.username;
    const { name, email } = req.body;
    if (!name || !email)
        return res.status(400).json({ success: false, error: 'Name and email required' });
    try {
        await db_1.pool.query('INSERT INTO contacts (username, name, email) VALUES (?, ?, ?)', [user, name, email]);
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
// Admin Endpoints
exports.apiRouter.get('/admin/domains', requireAuth, requireAdmin, async (req, res) => {
    try {
        const [rows] = await db_1.pool.query('SELECT domain, description, aliases, mailboxes, maxquota, quota, transport, backupmx, created, modified, active, verify_token FROM domain WHERE domain != "ALL"');
        res.json({ success: true, data: rows });
    }
    catch (err) {
        console.error('Database Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/admin/domains', requireAuth, requireAdmin, async (req, res) => {
    const { domain, maxquota = 0, quota = 0 } = req.body;
    try {
        await db_1.pool.query('INSERT INTO domain (domain, maxquota, quota, created, modified) VALUES (?, ?, ?, NOW(), NOW())', [domain, maxquota, quota]);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.delete('/admin/domains/:domain', requireAuth, requireAdmin, async (req, res) => {
    try {
        await db_1.pool.query('DELETE FROM domain WHERE domain = ?', [req.params.domain]);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
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
    const { username } = req.body;
    try {
        // Copy password from mailbox if they exist, otherwise use dummy password
        const [mbRows] = await db_1.pool.query('SELECT password FROM mailbox WHERE username = ?', [username]);
        const pass = mbRows.length > 0 ? mbRows[0].password : '';
        await db_1.pool.query('INSERT INTO admin (username, password, created, modified) VALUES (?, ?, NOW(), NOW()) ON DUPLICATE KEY UPDATE active=1', [username, pass]);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.delete('/admin/admins/:username', requireAuth, requireAdmin, async (req, res) => {
    try {
        await db_1.pool.query('DELETE FROM admin WHERE username = ?', [req.params.username]);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// Audit Logs
exports.apiRouter.get('/admin/logs', requireAuth, requireAdmin, async (req, res) => {
    try {
        const [rows] = await db_1.pool.query('SELECT id, timestamp, username, domain, action, data FROM log ORDER BY timestamp DESC LIMIT 100');
        res.json({ success: true, data: rows });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/admin/mailboxes', requireAuth, requireAdmin, async (req, res) => {
    try {
        const [rows] = await db_1.pool.query('SELECT username, password, name, maildir, quota, local_part, domain, created, modified, active, phone, email_other, token, token_validity FROM mailbox');
        res.json({ success: true, data: rows });
    }
    catch (err) {
        console.error('Database Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/admin/mailboxes', requireAuth, requireAdmin, async (req, res) => {
    const { username, domain, name, password, quota = 0 } = req.body;
    const fullEmail = `${username}@${domain}`;
    try {
        // Need to hash password properly. Use simple hash for mock.
        const hash = `{SHA512-CRYPT}$6$mock$mockhash`;
        await db_1.pool.query('INSERT INTO mailbox (username, password, name, maildir, quota, local_part, domain, created, modified) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())', [fullEmail, hash, name, `${domain}/${username}/`, quota, username, domain]);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.delete('/admin/mailboxes/:username', requireAuth, requireAdmin, async (req, res) => {
    try {
        await db_1.pool.query('DELETE FROM mailbox WHERE username = ?', [req.params.username]);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/admin/aliases', requireAuth, requireAdmin, async (req, res) => {
    try {
        const [rows] = await db_1.pool.query('SELECT address, goto, domain, created, modified, active FROM alias');
        res.json({ success: true, data: rows });
    }
    catch (err) {
        console.error('Database Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/admin/aliases', requireAuth, requireAdmin, async (req, res) => {
    const { address, domain, goto } = req.body;
    try {
        await db_1.pool.query('INSERT INTO alias (address, goto, domain, created, modified) VALUES (?, ?, ?, NOW(), NOW())', [address, goto, domain]);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
const crypto_1 = __importDefault(require("crypto"));
const child_process_1 = require("child_process");
const util_1 = __importDefault(require("util"));
const execPromise = util_1.default.promisify(child_process_1.exec);
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
        res.json({ success: true, raw_key });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.delete('/admin/apikeys/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        await db_1.pool.query('DELETE FROM api_keys WHERE id = ?', [req.params.id]);
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
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
//# sourceMappingURL=api.js.map