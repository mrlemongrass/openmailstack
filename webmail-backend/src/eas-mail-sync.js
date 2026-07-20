"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveMailSyncState = exports.loadMailSyncState = exports.ensureEasMailSyncSchema = exports.mailSyncReplayResponse = exports.effectiveMailSyncWindow = exports.MAX_MAIL_SYNC_SOURCE_BYTES = exports.MAX_MAIL_SYNC_REPLAY_BYTES = exports.createMailSyncKey = exports.validateActiveSyncDeviceId = exports.mailSyncRequestHash = exports.mailSyncScopeHash = void 0;
exports.normalizeMailSyncOptions = normalizeMailSyncOptions;
exports.filterTypeCutoff = filterTypeCutoff;
exports.truncateUtf8Body = truncateUtf8Body;
exports.activeSyncMailApplicationData = activeSyncMailApplicationData;
exports.computeMailSyncDelta = computeMailSyncDelta;
exports.withMailSyncScopeLock = withMailSyncScopeLock;
const crypto_1 = require("crypto");
const mailparser_1 = require("mailparser");
const db_1 = require("./db");
const DEFAULT_OPTIONS = {
    filterType: 0,
    windowSize: 25,
    bodyType: 1,
    truncationSize: 500,
};
const integerOption = (value, fallback) => {
    if (value === undefined || value === null || value === '')
        return fallback;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : fallback;
};
function normalizeMailSyncOptions(values, fallback = DEFAULT_OPTIONS) {
    const filterType = integerOption(values.filterType, fallback.filterType);
    if (filterType < 0 || filterType > 5) {
        throw new Error(`Unsupported Email FilterType ${filterType}`);
    }
    const requestedWindow = integerOption(values.windowSize, fallback.windowSize);
    const windowSize = Math.max(1, Math.min(512, requestedWindow));
    const requestedBodyType = integerOption(values.bodyType, fallback.bodyType);
    const bodyType = [1, 2, 4].includes(requestedBodyType) ? requestedBodyType : fallback.bodyType;
    const requestedTruncation = integerOption(values.truncationSize, fallback.truncationSize);
    const truncationSize = Math.max(0, Math.min(10 * 1024 * 1024, requestedTruncation));
    return { filterType, windowSize, bodyType, truncationSize };
}
function filterTypeCutoff(filterType, now = new Date()) {
    if (filterType === 0)
        return null;
    if (filterType === 5) {
        const cutoff = new Date(now);
        cutoff.setUTCMonth(cutoff.getUTCMonth() - 1);
        return cutoff;
    }
    const daysByFilter = { 1: 1, 2: 3, 3: 7, 4: 14 };
    const days = daysByFilter[filterType];
    if (!days)
        throw new Error(`Unsupported Email FilterType ${filterType}`);
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
function truncateUtf8Body(value, maxBytes) {
    const source = Buffer.from(value, 'utf8');
    const limit = Math.max(0, maxBytes);
    if (source.length <= limit) {
        return { data: value, estimatedDataSize: source.length, truncated: false };
    }
    let end = Math.min(limit, source.length);
    while (end > 0 && (source[end] & 0xC0) === 0x80)
        end -= 1;
    const data = source.subarray(0, end).toString('utf8');
    return { data, estimatedDataSize: source.length, truncated: true };
}
const escapeHtml = (value) => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
async function activeSyncMailApplicationData(message, options) {
    const parsed = await (0, mailparser_1.simpleParser)(message.source);
    let body = parsed.text || '';
    if (options.bodyType === 2) {
        body = typeof parsed.html === 'string' ? parsed.html : `<pre>${escapeHtml(body)}</pre>`;
    }
    else if (options.bodyType === 4) {
        body = message.source.toString('utf8');
    }
    const truncatedBody = truncateUtf8Body(body, options.truncationSize);
    const estimatedDataSize = options.bodyType === 4 || !message.sourceComplete
        ? Math.max(message.size, truncatedBody.estimatedDataSize)
        : truncatedBody.estimatedDataSize;
    const isTruncated = truncatedBody.truncated || !message.sourceComplete;
    const receivedAt = message.internalDate || parsed.date || message.envelope?.date || new Date();
    return [
        { tag: 'To', page: 2, content: parsed.to?.text || '' },
        { tag: 'From', page: 2, content: parsed.from?.text || '' },
        { tag: 'Subject', page: 2, content: parsed.subject || message.envelope?.subject || '' },
        { tag: 'DateReceived', page: 2, content: receivedAt.toISOString() },
        { tag: 'DisplayTo', page: 2, content: parsed.to?.text || '' },
        { tag: 'Read', page: 2, content: message.flags.includes('\\Seen') ? '1' : '0' },
        { tag: 'MessageClass', page: 2, content: 'IPM.Note' },
        { tag: 'Body', page: 17, children: [
                { tag: 'Type', page: 17, content: String(options.bodyType) },
                { tag: 'Data', page: 17, content: truncatedBody.data },
                { tag: 'EstimatedDataSize', page: 17, content: String(estimatedDataSize) },
                ...(isTruncated ? [{ tag: 'Truncated', page: 17, content: '1' }] : []),
            ] },
    ];
}
function computeMailSyncDelta(input) {
    const all = new Set(input.allUids.map(String));
    const eligible = new Set(input.eligibleUids.map(String));
    const known = { ...input.knownItems };
    const pending = [];
    const knownUids = Object.keys(known).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    for (const uid of knownUids) {
        const key = String(uid);
        if (!all.has(key))
            pending.push({ type: 'Delete', uid });
    }
    for (const uid of knownUids) {
        const key = String(uid);
        if (all.has(key) && !eligible.has(key))
            pending.push({ type: 'SoftDelete', uid });
    }
    for (const uid of knownUids) {
        const key = String(uid);
        const changed = input.changedReadFlags[key];
        if (eligible.has(key) && changed !== undefined && known[key] !== changed) {
            pending.push({ type: 'Change', uid, isRead: changed });
        }
    }
    const additions = input.eligibleUids
        .filter(uid => uid >= (input.minimumUid || 1) && known[String(uid)] === undefined)
        .sort((a, b) => b - a);
    for (const uid of additions) {
        pending.push({ type: 'Add', uid });
    }
    const commands = pending.slice(0, Math.max(0, input.windowSize));
    for (const command of commands) {
        const key = String(command.uid);
        if (command.type === 'Delete' || command.type === 'SoftDelete') {
            delete known[key];
        }
        else if (command.type === 'Change') {
            known[key] = command.isRead ?? known[key] ?? 0;
        }
        else {
            known[key] = command.isRead ?? 0;
        }
    }
    return {
        commands,
        nextKnownItems: known,
        moreAvailable: pending.length > commands.length,
    };
}
const mailSyncScopeHash = (username, deviceId, collectionId) => (0, crypto_1.createHash)('sha256').update(username).update('\0').update(deviceId).update('\0').update(collectionId).digest('hex');
exports.mailSyncScopeHash = mailSyncScopeHash;
const mailSyncRequestHash = (requestBody) => (0, crypto_1.createHash)('sha256').update(requestBody).digest('hex');
exports.mailSyncRequestHash = mailSyncRequestHash;
const validateActiveSyncDeviceId = (value) => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9]{1,32}$/.test(value))
        return null;
    return value;
};
exports.validateActiveSyncDeviceId = validateActiveSyncDeviceId;
const createMailSyncKey = () => `oms-mail-${(0, crypto_1.randomBytes)(24).toString('hex')}`;
exports.createMailSyncKey = createMailSyncKey;
exports.MAX_MAIL_SYNC_REPLAY_BYTES = 16 * 1024 * 1024 - 1;
exports.MAX_MAIL_SYNC_SOURCE_BYTES = 16 * 1024 * 1024;
const effectiveMailSyncWindow = (options, reservedBodyItems = 0) => {
    const perItemSourceBytes = Math.max(1, Math.min(10 * 1024 * 1024 + 256 * 1024, options.truncationSize + 256 * 1024));
    const bodyItemBudget = Math.max(1, Math.floor(exports.MAX_MAIL_SYNC_SOURCE_BYTES / perItemSourceBytes));
    return Math.max(0, Math.min(options.windowSize, bodyItemBudget - reservedBodyItems));
};
exports.effectiveMailSyncWindow = effectiveMailSyncWindow;
const mailSyncReplayResponse = (state, syncKey, requestHash, now = new Date()) => {
    if (!state?.lastResponse || state.previousSyncKey !== syncKey || state.lastRequestHash !== requestHash)
        return null;
    if (syncKey === '0' && now.getTime() - state.updatedAt.getTime() > 2 * 60 * 1000)
        return null;
    return Buffer.from(state.lastResponse);
};
exports.mailSyncReplayResponse = mailSyncReplayResponse;
let schemaPromise = null;
const ensureEasMailSyncSchema = async () => {
    if (!schemaPromise) {
        schemaPromise = db_1.pool.query(`
            CREATE TABLE IF NOT EXISTS eas_mail_sync_states (
                scope_hash CHAR(64) NOT NULL PRIMARY KEY,
                username VARCHAR(255) NOT NULL,
                device_id VARCHAR(128) NOT NULL,
                collection_id VARCHAR(512) NOT NULL,
                current_sync_key VARCHAR(96) NOT NULL,
                previous_sync_key VARCHAR(96) NULL,
                uid_validity VARCHAR(64) NOT NULL DEFAULT '0',
                highest_modseq VARCHAR(64) NOT NULL DEFAULT '0',
                minimum_uid BIGINT UNSIGNED NOT NULL DEFAULT 1,
                filter_type TINYINT UNSIGNED NOT NULL DEFAULT 0,
                window_size SMALLINT UNSIGNED NOT NULL DEFAULT 25,
                body_type TINYINT UNSIGNED NOT NULL DEFAULT 1,
                truncation_size INT UNSIGNED NOT NULL DEFAULT 500,
                known_items MEDIUMTEXT NOT NULL,
                last_commands MEDIUMTEXT NOT NULL,
                last_more_available TINYINT(1) NOT NULL DEFAULT 0,
                last_request_hash CHAR(64) NULL,
                last_response MEDIUMBLOB NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY idx_eas_mail_device (username, device_id),
                KEY idx_eas_mail_updated (updated_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `).then(() => undefined).catch(err => {
            schemaPromise = null;
            throw err;
        });
    }
    return schemaPromise;
};
exports.ensureEasMailSyncSchema = ensureEasMailSyncSchema;
const parseKnownItems = (value) => {
    try {
        const parsed = JSON.parse(String(value || '{}'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            return {};
        const result = {};
        for (const [uid, read] of Object.entries(parsed)) {
            if (/^\d+$/.test(uid))
                result[uid] = Number(read) === 1 ? 1 : 0;
        }
        return result;
    }
    catch {
        return {};
    }
};
const parseCommands = (value) => {
    try {
        const parsed = JSON.parse(String(value || '[]'));
        if (!Array.isArray(parsed))
            return [];
        return parsed.filter(command => command && Number.isInteger(command.uid) && ['Add', 'Change', 'Delete', 'SoftDelete'].includes(command.type));
    }
    catch {
        return [];
    }
};
const loadMailSyncState = async (username, deviceId, collectionId) => {
    await (0, exports.ensureEasMailSyncSchema)();
    const scopeHash = (0, exports.mailSyncScopeHash)(username, deviceId, collectionId);
    const [rows] = await db_1.pool.query('SELECT * FROM eas_mail_sync_states WHERE scope_hash = ? LIMIT 1', [scopeHash]);
    if (!rows.length)
        return null;
    const row = rows[0];
    return {
        scopeHash,
        username: row.username,
        deviceId: row.device_id,
        collectionId: row.collection_id,
        currentSyncKey: row.current_sync_key,
        previousSyncKey: row.previous_sync_key || null,
        uidValidity: String(row.uid_validity || '0'),
        highestModseq: String(row.highest_modseq || '0'),
        minimumUid: Math.max(1, Number(row.minimum_uid || 1)),
        filterType: Number(row.filter_type),
        windowSize: Number(row.window_size),
        bodyType: Number(row.body_type),
        truncationSize: Number(row.truncation_size),
        knownItems: parseKnownItems(row.known_items),
        lastCommands: parseCommands(row.last_commands),
        lastMoreAvailable: Number(row.last_more_available) === 1,
        lastRequestHash: row.last_request_hash || null,
        lastResponse: row.last_response ? Buffer.from(row.last_response) : null,
        updatedAt: new Date(row.updated_at),
    };
};
exports.loadMailSyncState = loadMailSyncState;
const saveMailSyncState = async (state) => {
    await (0, exports.ensureEasMailSyncSchema)();
    await db_1.pool.query(`
        INSERT INTO eas_mail_sync_states (
            scope_hash, username, device_id, collection_id, current_sync_key, previous_sync_key,
            uid_validity, highest_modseq, filter_type, window_size, body_type, truncation_size,
            minimum_uid, known_items, last_commands, last_more_available, last_request_hash, last_response
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            username = VALUES(username), device_id = VALUES(device_id), collection_id = VALUES(collection_id),
            current_sync_key = VALUES(current_sync_key), previous_sync_key = VALUES(previous_sync_key),
            uid_validity = VALUES(uid_validity), highest_modseq = VALUES(highest_modseq),
            minimum_uid = VALUES(minimum_uid),
            filter_type = VALUES(filter_type), window_size = VALUES(window_size), body_type = VALUES(body_type),
            truncation_size = VALUES(truncation_size), known_items = VALUES(known_items),
            last_commands = VALUES(last_commands), last_more_available = VALUES(last_more_available),
            last_request_hash = VALUES(last_request_hash), last_response = VALUES(last_response)
    `, [
        state.scopeHash,
        state.username,
        state.deviceId,
        state.collectionId,
        state.currentSyncKey,
        state.previousSyncKey,
        state.uidValidity,
        state.highestModseq,
        state.filterType,
        state.windowSize,
        state.bodyType,
        state.truncationSize,
        state.minimumUid,
        JSON.stringify(state.knownItems),
        JSON.stringify(state.lastCommands),
        state.lastMoreAvailable ? 1 : 0,
        state.lastRequestHash,
        state.lastResponse,
    ]);
};
exports.saveMailSyncState = saveMailSyncState;
const scopeLocks = new Map();
async function withMailSyncScopeLock(scopeHash, operation) {
    const previous = scopeLocks.get(scopeHash) || Promise.resolve();
    let release = () => { };
    const current = new Promise(resolve => { release = resolve; });
    const queued = previous.then(() => current);
    scopeLocks.set(scopeHash, queued);
    await previous;
    try {
        return await operation();
    }
    finally {
        release();
        if (scopeLocks.get(scopeHash) === queued)
            scopeLocks.delete(scopeHash);
    }
}
//# sourceMappingURL=eas-mail-sync.js.map