"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveMailSyncState = exports.deleteMailSyncState = exports.loadMailSyncState = exports.parseMailSyncKnownItems = exports.ensureEasMailSyncSchema = exports.mailSyncReplayResponse = exports.effectiveMailSyncWindow = exports.MAIL_SYNC_STATE_TTL_MS = exports.MAX_MAIL_SYNC_PARTNERSHIPS_PER_USER = exports.MAX_MAIL_SYNC_USER_BYTES = exports.MAX_MAIL_SYNC_ROW_BYTES = exports.MAX_MAIL_SYNC_COMMANDS_BYTES = exports.MAX_MAIL_SYNC_KNOWN_ITEMS_BYTES = exports.MAX_MAIL_SYNC_KNOWN_ITEMS = exports.MAX_MAIL_SYNC_SOURCE_BYTES = exports.MAX_MAIL_SYNC_RESPONSE_BYTES = exports.MAX_MAIL_SYNC_REPLAY_BYTES = exports.createMailSyncKey = exports.validateActiveSyncDeviceId = exports.mailSyncRequestHash = exports.mailSyncScopeHash = exports.MailSyncStateError = void 0;
exports.resolveActiveSyncWindowSize = resolveActiveSyncWindowSize;
exports.normalizeMailSyncOptions = normalizeMailSyncOptions;
exports.filterTypeCutoff = filterTypeCutoff;
exports.truncateUtf8Body = truncateUtf8Body;
exports.activeSyncMailApplicationData = activeSyncMailApplicationData;
exports.computeMailSyncDelta = computeMailSyncDelta;
exports.validateMailClientCommands = validateMailClientCommands;
exports.assertMailSyncRowBound = assertMailSyncRowBound;
exports.withMailSyncScopeLock = withMailSyncScopeLock;
const crypto_1 = require("crypto");
const mailparser_1 = require("mailparser");
const db_1 = require("./db");
const eas_sync_1 = require("./eas-sync");
const eas_protocol_1 = require("./eas-protocol");
class MailSyncStateError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MailSyncStateError';
    }
}
exports.MailSyncStateError = MailSyncStateError;
const DEFAULT_OPTIONS = {
    filterType: 0,
    windowSize: 100,
    bodyType: 1,
    truncationSize: 500,
};
const MAX_MAIL_SYNC_BODY_BYTES = 7 * 1024 * 1024;
function resolveActiveSyncWindowSize(syncKey, value, persistedWindowSize) {
    const fallback = syncKey === '0' ? DEFAULT_OPTIONS.windowSize : persistedWindowSize ?? DEFAULT_OPTIONS.windowSize;
    return (0, eas_sync_1.normalizeActiveSyncWindowSize)(value, fallback);
}
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
    const windowSize = (0, eas_sync_1.normalizeActiveSyncWindowSize)(values.windowSize, fallback.windowSize);
    const requestedBodyType = integerOption(values.bodyType, fallback.bodyType);
    const bodyType = [1, 2, 4].includes(requestedBodyType) ? requestedBodyType : fallback.bodyType;
    const bodyPreferenceSpecified = values.bodyType !== undefined && values.bodyType !== null && values.bodyType !== '';
    const truncationSizeSpecified = values.truncationSize !== undefined && values.truncationSize !== null && values.truncationSize !== '';
    const truncationFallback = bodyPreferenceSpecified && !truncationSizeSpecified
        ? MAX_MAIL_SYNC_BODY_BYTES
        : fallback.truncationSize;
    const requestedTruncation = integerOption(values.truncationSize, truncationFallback);
    const truncationSize = Math.max(0, Math.min(MAX_MAIL_SYNC_BODY_BYTES, requestedTruncation));
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
    const safeValue = value.replace(/\0/g, '\uFFFD');
    const source = Buffer.from(safeValue, 'utf8');
    const limit = Math.max(0, maxBytes);
    if (source.length <= limit) {
        return { data: safeValue, estimatedDataSize: source.length, truncated: false };
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
const boundedMailText = (value, maxBytes = 64 * 1024) => truncateUtf8Body(String(value || ''), maxBytes).data;
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
        { tag: 'To', page: 2, content: boundedMailText(parsed.to?.text) },
        { tag: 'From', page: 2, content: boundedMailText(parsed.from?.text) },
        { tag: 'Subject', page: 2, content: boundedMailText(parsed.subject || message.envelope?.subject) },
        { tag: 'DateReceived', page: 2, content: receivedAt.toISOString() },
        { tag: 'DisplayTo', page: 2, content: boundedMailText(parsed.to?.text) },
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
    const minimumUid = input.filterType === 0 ? 1 : (input.minimumUid || 1);
    const additions = input.eligibleUids
        .filter(uid => uid >= minimumUid && known[String(uid)] === undefined)
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
exports.MAX_MAIL_SYNC_REPLAY_BYTES = 8 * 1024 * 1024;
exports.MAX_MAIL_SYNC_RESPONSE_BYTES = exports.MAX_MAIL_SYNC_REPLAY_BYTES;
exports.MAX_MAIL_SYNC_SOURCE_BYTES = 7 * 1024 * 1024;
exports.MAX_MAIL_SYNC_KNOWN_ITEMS = 100_000;
exports.MAX_MAIL_SYNC_KNOWN_ITEMS_BYTES = 4 * 1024 * 1024;
exports.MAX_MAIL_SYNC_COMMANDS_BYTES = 256 * 1024;
exports.MAX_MAIL_SYNC_ROW_BYTES = 13 * 1024 * 1024;
exports.MAX_MAIL_SYNC_USER_BYTES = 64 * 1024 * 1024;
exports.MAX_MAIL_SYNC_PARTNERSHIPS_PER_USER = 1_024;
exports.MAIL_SYNC_STATE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const isMailSyncKey = (value) => /^oms-mail-[0-9a-f]{48}$/.test(value);
const canonicalDecimal = (value, maxDigits = 20) => typeof value === 'string' && new RegExp(`^(?:0|[1-9][0-9]{0,${maxDigits - 1}})$`).test(value);
function validateMailClientCommands(commands, collectionId) {
    if (!Array.isArray(commands) || commands.length > 512)
        return { ok: false };
    const seen = new Set();
    const scalar = (node) => node && (!node.children || node.children.length === 0)
        && typeof node.content === 'string' && !/[\u0000-\u001f\u007f]/.test(node.content);
    for (const command of commands) {
        if (!command || command.page !== 0 || command.content !== undefined && command.content !== null
            || !Array.isArray(command.children))
            return { ok: false };
        if (!['Fetch', 'Change', 'Delete'].includes(command.tag))
            return { ok: false };
        const serverIdNode = command.children[0];
        if (serverIdNode?.tag !== 'ServerId' || serverIdNode?.page !== 0 || !scalar(serverIdNode)
            || Buffer.byteLength(serverIdNode.content, 'utf8') > 64
            || (0, eas_protocol_1.activeSyncMailMessageUid)(collectionId, serverIdNode.content) === null)
            return { ok: false };
        const identity = `${command.tag}:${serverIdNode.content}`;
        if (seen.has(identity))
            return { ok: false };
        seen.add(identity);
        if (command.tag === 'Change') {
            const appData = command.children[1];
            if (command.children.length !== 2 || appData?.tag !== 'ApplicationData' || appData?.page !== 0
                || appData.content !== undefined && appData.content !== null || !Array.isArray(appData.children)
                || appData.children.length !== 1)
                return { ok: false };
            const read = appData.children[0];
            if (read?.tag !== 'Read' || read?.page !== 2 || !scalar(read) || !/^[01]$/.test(read.content))
                return { ok: false };
        }
        else if (command.children.length !== 1) {
            return { ok: false };
        }
    }
    return { ok: true };
}
function assertMailSyncRowBound(knownItems, commands, response) {
    const bytes = Buffer.byteLength(knownItems, 'utf8') + Buffer.byteLength(commands, 'utf8') + (response?.length || 0);
    if (bytes > exports.MAX_MAIL_SYNC_ROW_BYTES)
        throw new MailSyncStateError('Mail sync state exceeds its aggregate row bound');
}
const effectiveMailSyncWindow = (options, reservedBodyItems = 0) => {
    const perItemSourceBytes = Math.max(1, Math.min(MAX_MAIL_SYNC_BODY_BYTES + 256 * 1024, options.truncationSize + 256 * 1024));
    const bodyItemBudget = Math.max(1, Math.floor(exports.MAX_MAIL_SYNC_SOURCE_BYTES / perItemSourceBytes));
    return Math.max(0, Math.min(options.windowSize, bodyItemBudget - reservedBodyItems));
};
exports.effectiveMailSyncWindow = effectiveMailSyncWindow;
const mailSyncReplayResponse = (state, syncKey, requestHash, now = new Date()) => {
    if (!state?.lastResponse || state.previousSyncKey !== syncKey || state.lastRequestHash !== requestHash)
        return null;
    const age = now.getTime() - state.updatedAt.getTime();
    if (age > (syncKey === '0' ? 2 : 10) * 60 * 1000)
        return null;
    return Buffer.from(state.lastResponse);
};
exports.mailSyncReplayResponse = mailSyncReplayResponse;
let schemaPromise = null;
const ensureEasMailSyncSchema = async () => {
    if (!schemaPromise) {
        schemaPromise = (async () => {
            await db_1.pool.query(`
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
                window_size SMALLINT UNSIGNED NOT NULL DEFAULT 100,
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
            `);
        })().catch(err => {
            schemaPromise = null;
            throw err;
        });
    }
    return schemaPromise;
};
exports.ensureEasMailSyncSchema = ensureEasMailSyncSchema;
const parseMailSyncKnownItems = (value) => {
    try {
        const parsed = JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : String(value));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            throw new Error('invalid');
        if (Object.keys(parsed).length > exports.MAX_MAIL_SYNC_KNOWN_ITEMS
            || Buffer.byteLength(JSON.stringify(parsed), 'utf8') > exports.MAX_MAIL_SYNC_KNOWN_ITEMS_BYTES) {
            throw new Error('invalid');
        }
        const result = {};
        for (const [uid, read] of Object.entries(parsed)) {
            if (!/^[1-9][0-9]{0,15}$/.test(uid) || !Number.isSafeInteger(Number(uid))
                || ![0, 1].includes(Number(read)))
                throw new Error('invalid');
            result[uid] = Number(read) === 1 ? 1 : 0;
        }
        return result;
    }
    catch {
        throw new MailSyncStateError('Mail known item state is malformed');
    }
};
exports.parseMailSyncKnownItems = parseMailSyncKnownItems;
const parseCommands = (value) => {
    try {
        const serialized = Buffer.isBuffer(value) ? value.toString('utf8') : String(value);
        if (Buffer.byteLength(serialized, 'utf8') > exports.MAX_MAIL_SYNC_COMMANDS_BYTES)
            throw new Error('invalid');
        const parsed = JSON.parse(serialized);
        if (!Array.isArray(parsed) || parsed.length > 512 || parsed.some(command => !command || !Number.isSafeInteger(command.uid) || command.uid < 1
            || !['Add', 'Change', 'Delete', 'SoftDelete'].includes(command.type)
            || command.isRead !== undefined && ![0, 1].includes(command.isRead)))
            throw new Error('invalid');
        return parsed;
    }
    catch {
        throw new MailSyncStateError('Mail command replay state is malformed');
    }
};
const loadMailSyncState = async (username, deviceId, collectionId) => {
    await (0, exports.ensureEasMailSyncSchema)();
    const scopeHash = (0, exports.mailSyncScopeHash)(username, deviceId, collectionId);
    const connection = await db_1.pool.getConnection();
    let transactionStarted = false;
    let connectionUsable = true;
    try {
        try {
            await connection.beginTransaction();
            transactionStarted = true;
        }
        catch (error) {
            connectionUsable = false;
            throw error;
        }
        const [metadataRows] = await connection.query(`SELECT scope_hash, username, device_id, collection_id, current_sync_key, previous_sync_key,
                    uid_validity, highest_modseq, minimum_uid, filter_type, window_size, body_type,
                    truncation_size, last_more_available, last_request_hash, updated_at,
                    OCTET_LENGTH(known_items) AS known_items_bytes,
                    OCTET_LENGTH(last_commands) AS last_commands_bytes,
                    COALESCE(OCTET_LENGTH(last_response), 0) AS last_response_bytes
             FROM eas_mail_sync_states WHERE scope_hash = ? LIMIT 1 FOR UPDATE`, [scopeHash]);
        if (!metadataRows.length) {
            await connection.commit();
            transactionStarted = false;
            return null;
        }
        const metadata = metadataRows[0];
        const payloadLengths = [
            ['known_items', metadata.known_items_bytes, exports.MAX_MAIL_SYNC_KNOWN_ITEMS_BYTES],
            ['last_commands', metadata.last_commands_bytes, exports.MAX_MAIL_SYNC_COMMANDS_BYTES],
            ['last_response', metadata.last_response_bytes, exports.MAX_MAIL_SYNC_REPLAY_BYTES],
        ];
        let payloadBytes = 0;
        for (const [field, rawBytes, maximum] of payloadLengths) {
            if ((typeof rawBytes !== 'number' && typeof rawBytes !== 'string')
                || !/^\d+$/.test(String(rawBytes))) {
                throw new MailSyncStateError(`Mail sync state ${field} length is malformed`);
            }
            const bytes = Number(rawBytes);
            if (!Number.isSafeInteger(bytes) || bytes < 0) {
                throw new MailSyncStateError(`Mail sync state ${field} length is malformed`);
            }
            if (bytes > maximum)
                throw new MailSyncStateError(`Mail sync state ${field} is too large`);
            payloadBytes += bytes;
        }
        if (payloadBytes > exports.MAX_MAIL_SYNC_ROW_BYTES) {
            throw new MailSyncStateError('Mail sync state row is too large');
        }
        const [payloadRows] = await connection.query(`SELECT known_items, last_commands, last_response
             FROM eas_mail_sync_states
             WHERE scope_hash = ?
               AND OCTET_LENGTH(known_items) = ?
               AND OCTET_LENGTH(last_commands) = ?
               AND COALESCE(OCTET_LENGTH(last_response), 0) = ?
             LIMIT 1`, [scopeHash, ...payloadLengths.map(([, rawBytes]) => Number(rawBytes))]);
        if (payloadRows.length !== 1) {
            throw new MailSyncStateError('Mail sync state changed while its payload was loading');
        }
        const row = { ...metadata, ...payloadRows[0] };
        if (String(row.scope_hash) !== scopeHash || String(row.username) !== username
            || String(row.device_id) !== deviceId || String(row.collection_id) !== collectionId) {
            throw new MailSyncStateError('Mail sync state scope is invalid');
        }
        const currentSyncKey = String(row.current_sync_key);
        const previousSyncKey = row.previous_sync_key ? String(row.previous_sync_key) : null;
        if (!isMailSyncKey(currentSyncKey)
            || (previousSyncKey !== null && previousSyncKey !== '0' && !isMailSyncKey(previousSyncKey))) {
            throw new MailSyncStateError('Mail sync state key is invalid');
        }
        const lastResponse = row.last_response ? Buffer.from(row.last_response) : null;
        if (lastResponse && lastResponse.length > exports.MAX_MAIL_SYNC_REPLAY_BYTES) {
            throw new MailSyncStateError('Mail replay response is too large');
        }
        const lastRequestHash = row.last_request_hash === null ? null : String(row.last_request_hash);
        if (lastRequestHash !== null && !/^[0-9a-f]{64}$/.test(lastRequestHash)) {
            throw new MailSyncStateError('Mail replay request hash is invalid');
        }
        const uidValidity = String(row.uid_validity ?? '');
        const highestModseq = String(row.highest_modseq ?? '');
        const minimumUid = Number(row.minimum_uid);
        if (!canonicalDecimal(uidValidity) || !canonicalDecimal(highestModseq)
            || !Number.isSafeInteger(minimumUid) || minimumUid < 1) {
            throw new MailSyncStateError('Mail mailbox cursor state is invalid');
        }
        const updatedAt = new Date(row.updated_at);
        if (!Number.isFinite(updatedAt.getTime()) || Date.now() - updatedAt.getTime() > exports.MAIL_SYNC_STATE_TTL_MS) {
            throw new MailSyncStateError('Mail sync state timestamp is invalid or expired');
        }
        const filterType = Number(row.filter_type);
        const windowSize = Number(row.window_size);
        const bodyType = Number(row.body_type);
        const truncationSize = Number(row.truncation_size);
        if (!Number.isInteger(filterType) || filterType < 0 || filterType > 5
            || !Number.isInteger(windowSize) || windowSize < 1 || windowSize > 512
            || ![1, 2, 4].includes(bodyType)
            || !Number.isInteger(truncationSize) || truncationSize < 0 || truncationSize > MAX_MAIL_SYNC_BODY_BYTES) {
            throw new MailSyncStateError('Mail sync state options are invalid');
        }
        const knownItems = (0, exports.parseMailSyncKnownItems)(row.known_items);
        const lastCommands = parseCommands(row.last_commands);
        assertMailSyncRowBound(JSON.stringify(knownItems), JSON.stringify(lastCommands), lastResponse);
        const result = {
            scopeHash,
            username: String(row.username),
            deviceId: String(row.device_id),
            collectionId: String(row.collection_id),
            currentSyncKey,
            previousSyncKey,
            uidValidity,
            highestModseq,
            minimumUid,
            filterType,
            windowSize,
            bodyType,
            truncationSize,
            knownItems,
            lastCommands,
            lastMoreAvailable: Number(row.last_more_available) === 1,
            lastRequestHash,
            lastResponse,
            updatedAt,
        };
        await connection.commit();
        transactionStarted = false;
        return result;
    }
    catch (error) {
        if (transactionStarted) {
            try {
                await connection.rollback();
            }
            catch {
                console.error('[EAS] Mail sync state load rollback failed; destroying connection');
                connectionUsable = false;
            }
        }
        throw error;
    }
    finally {
        if (connectionUsable)
            connection.release();
        else
            connection.destroy();
    }
};
exports.loadMailSyncState = loadMailSyncState;
const deleteMailSyncState = async (username, deviceId, collectionId) => {
    await (0, exports.ensureEasMailSyncSchema)();
    const scopeHash = (0, exports.mailSyncScopeHash)(username, deviceId, collectionId);
    await db_1.pool.query('DELETE FROM eas_mail_sync_states WHERE scope_hash = ? AND username = ? AND device_id = ? AND collection_id = ?', [scopeHash, username, deviceId, collectionId]);
};
exports.deleteMailSyncState = deleteMailSyncState;
const saveMailSyncState = async (state) => {
    await (0, exports.ensureEasMailSyncSchema)();
    if (state.scopeHash !== (0, exports.mailSyncScopeHash)(state.username, state.deviceId, state.collectionId)
        || !isMailSyncKey(state.currentSyncKey)
        || (state.previousSyncKey !== null && state.previousSyncKey !== '0' && !isMailSyncKey(state.previousSyncKey))
        || Buffer.byteLength(state.collectionId, 'utf8') > 64
        || !canonicalDecimal(state.uidValidity) || !canonicalDecimal(state.highestModseq)
        || !Number.isSafeInteger(state.minimumUid) || state.minimumUid < 1
        || state.lastRequestHash !== null && !/^[0-9a-f]{64}$/.test(state.lastRequestHash)) {
        throw new MailSyncStateError('Mail sync state identity is invalid');
    }
    const knownItems = JSON.stringify(state.knownItems);
    const commands = JSON.stringify(state.lastCommands);
    if (Object.keys(state.knownItems).length > exports.MAX_MAIL_SYNC_KNOWN_ITEMS
        || Buffer.byteLength(knownItems, 'utf8') > exports.MAX_MAIL_SYNC_KNOWN_ITEMS_BYTES
        || state.lastCommands.length > 512 || Buffer.byteLength(commands, 'utf8') > exports.MAX_MAIL_SYNC_COMMANDS_BYTES
        || state.lastCommands.some(command => !Number.isSafeInteger(command.uid) || command.uid < 1
            || !['Add', 'Change', 'Delete', 'SoftDelete'].includes(command.type)
            || command.isRead !== undefined && ![0, 1].includes(command.isRead))
        || (state.lastResponse && state.lastResponse.length > exports.MAX_MAIL_SYNC_REPLAY_BYTES)) {
        throw new MailSyncStateError('Mail sync state exceeds its storage bound');
    }
    (0, exports.parseMailSyncKnownItems)(knownItems);
    assertMailSyncRowBound(knownItems, commands, state.lastResponse);
    const rowBytes = Buffer.byteLength(knownItems, 'utf8') + Buffer.byteLength(commands, 'utf8') + (state.lastResponse?.length || 0);
    const connection = await db_1.pool.getConnection();
    const quotaLock = `oms-mail-${(0, crypto_1.createHash)('sha256').update(state.username).digest('hex').slice(0, 47)}`;
    let lockAcquired = false;
    let transactionStarted = false;
    let committed = false;
    let connectionUsable = true;
    let failure = null;
    try {
        let lockRows;
        try {
            [lockRows] = await connection.query('SELECT GET_LOCK(?, 10) AS acquired', [quotaLock]);
        }
        catch (error) {
            connectionUsable = false;
            throw error;
        }
        const lockResult = lockRows?.[0]?.acquired;
        if (lockResult === 1 || lockResult === '1') {
            lockAcquired = true;
        }
        else if (lockResult === 0 || lockResult === '0') {
            throw new MailSyncStateError('Mail quota lock was unavailable');
        }
        else {
            connectionUsable = false;
            throw new MailSyncStateError('Mail quota lock acquisition was indeterminate');
        }
        try {
            await connection.beginTransaction();
            transactionStarted = true;
        }
        catch (error) {
            connectionUsable = false;
            throw error;
        }
        await connection.query('DELETE FROM eas_mail_sync_states WHERE updated_at < DATE_SUB(NOW(), INTERVAL 180 DAY)');
        const [partnershipRows] = await connection.query('SELECT COUNT(*) AS count FROM eas_mail_sync_states WHERE username = ? AND scope_hash <> ?', [state.username, state.scopeHash]);
        if (Number(partnershipRows[0]?.count || 0) >= exports.MAX_MAIL_SYNC_PARTNERSHIPS_PER_USER) {
            throw new MailSyncStateError('Mail sync partnership count exceeds its bound');
        }
        const [byteRows] = await connection.query(`SELECT COALESCE(SUM(OCTET_LENGTH(known_items) + OCTET_LENGTH(last_commands)
                + COALESCE(OCTET_LENGTH(last_response), 0)), 0) AS bytes
             FROM eas_mail_sync_states WHERE username = ? AND scope_hash <> ?`, [state.username, state.scopeHash]);
        if (Number(byteRows[0]?.bytes || 0) + rowBytes > exports.MAX_MAIL_SYNC_USER_BYTES) {
            throw new MailSyncStateError('Mail sync user storage exceeds its aggregate bound');
        }
        await connection.query(`
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
            knownItems,
            commands,
            state.lastMoreAvailable ? 1 : 0,
            state.lastRequestHash,
            state.lastResponse,
        ]);
        await connection.commit();
        transactionStarted = false;
        committed = true;
    }
    catch (error) {
        failure = error;
        if (transactionStarted) {
            try {
                await connection.rollback();
                transactionStarted = false;
            }
            catch {
                console.error('[EAS] Mail sync state rollback failed; destroying connection');
                connectionUsable = false;
            }
        }
    }
    finally {
        if (lockAcquired && connectionUsable) {
            try {
                const [releaseRows] = await connection.query('SELECT RELEASE_LOCK(?) AS released', [quotaLock]);
                if (releaseRows?.[0]?.released !== 1 && releaseRows?.[0]?.released !== '1') {
                    throw new MailSyncStateError('Mail quota lock release failed');
                }
            }
            catch (error) {
                connectionUsable = false;
                if (committed) {
                    console.error('[EAS] Mail sync state lock release failed after commit; destroying connection');
                }
                else if (!failure) {
                    failure = error;
                }
            }
        }
        if (connectionUsable)
            connection.release();
        else
            connection.destroy();
    }
    if (failure)
        throw failure;
};
exports.saveMailSyncState = saveMailSyncState;
async function withMailSyncScopeLock(scopeHash, operation) {
    if (!/^[0-9a-f]{64}$/.test(scopeHash))
        throw new MailSyncStateError('Mail sync scope lock identity is invalid');
    const connection = await db_1.pool.getConnection();
    const lockName = `oms-mail-sync-${scopeHash.slice(0, 48)}`;
    let acquired = false;
    let connectionUsable = true;
    let result;
    let failure = null;
    try {
        let lockRows;
        try {
            [lockRows] = await connection.query('SELECT GET_LOCK(?, 10) AS acquired', [lockName]);
        }
        catch (error) {
            connectionUsable = false;
            throw error;
        }
        const value = lockRows?.[0]?.acquired;
        if (value === 1 || value === '1')
            acquired = true;
        else if (value === 0 || value === '0')
            throw new MailSyncStateError('Mail sync scope lock was unavailable');
        else {
            connectionUsable = false;
            throw new MailSyncStateError('Mail sync scope lock acquisition was indeterminate');
        }
        result = await operation();
    }
    catch (error) {
        failure = error;
    }
    finally {
        if (acquired && connectionUsable) {
            try {
                const [releaseRows] = await connection.query('SELECT RELEASE_LOCK(?) AS released', [lockName]);
                const released = releaseRows?.[0]?.released;
                if (released !== 1 && released !== '1') {
                    throw new MailSyncStateError('Mail sync scope lock release failed');
                }
            }
            catch (error) {
                connectionUsable = false;
                if (!failure)
                    failure = error;
            }
        }
        if (connectionUsable)
            connection.release();
        else
            connection.destroy();
    }
    if (failure)
        throw failure;
    return result;
}
//# sourceMappingURL=eas-mail-sync.js.map