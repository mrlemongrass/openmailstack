"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deletePimSyncState = exports.deletePimSyncStateOnConnection = exports.savePimSyncState = exports.savePimSyncStateOnConnection = exports.loadPimSyncState = exports.loadPimSyncStateOnConnection = exports.pimSqlLockName = exports.ensureEasPimSyncSchema = exports.pimQuarantineFingerprint = exports.pimSyncReplayResponse = exports.pimSyncStateDisposition = exports.createPimSyncKey = exports.pimWireServerId = exports.pimSyncRequestHash = exports.pimSyncScopeHash = exports.pimItemFingerprint = exports.PimSyncStateError = exports.PimSyncLimitError = exports.PIM_QUARANTINE_PREFIX = exports.PIM_SYNC_STATE_TTL_MS = exports.MAX_PIM_SYNC_PARTNERSHIPS_PER_USER = exports.MAX_PIM_SYNC_USER_BYTES = exports.MAX_PIM_SYNC_ROW_BYTES = exports.MAX_PIM_SYNC_COMMANDS_BYTES = exports.MAX_PIM_SYNC_RESPONSE_BYTES = exports.MAX_PIM_SYNC_REPLAY_BYTES = exports.MAX_PIM_SYNC_CLIENT_COMMANDS = exports.MAX_PIM_SNAPSHOT_SOURCE_BYTES = exports.MAX_PIM_ITEM_SOURCE_BYTES = exports.MAX_PIM_KNOWN_ITEMS_BYTES = exports.MAX_PIM_KNOWN_ITEMS = void 0;
exports.parsePimSupportedProperties = parsePimSupportedProperties;
exports.pimOmittedFieldsToClear = pimOmittedFieldsToClear;
exports.serializePimSupportedFields = serializePimSupportedFields;
exports.parsePimSupportedFields = parsePimSupportedFields;
exports.assertPimKnownItemsBound = assertPimKnownItemsBound;
exports.parsePimKnownItems = parsePimKnownItems;
exports.deterministicPimAddServerId = deterministicPimAddServerId;
exports.validatePimClientCommands = validatePimClientCommands;
exports.computePimSyncDelta = computePimSyncDelta;
exports.pimQuarantineCommand = pimQuarantineCommand;
exports.normalizePimQuarantineState = normalizePimQuarantineState;
exports.assertPimSnapshotBound = assertPimSnapshotBound;
exports.loadBoundedContactPimSnapshot = loadBoundedContactPimSnapshot;
exports.loadBoundedCalendarPimSnapshot = loadBoundedCalendarPimSnapshot;
exports.advancePimKnownItems = advancePimKnownItems;
exports.fitPimSyncCommandsToByteBudget = fitPimSyncCommandsToByteBudget;
exports.assertPimSyncRowBound = assertPimSyncRowBound;
exports.applyAcceptedPimWrites = applyAcceptedPimWrites;
exports.withPimSqlTransaction = withPimSqlTransaction;
exports.withPimSyncScopeLock = withPimSyncScopeLock;
exports.withPimCollectionLock = withPimCollectionLock;
const crypto_1 = require("crypto");
const db_1 = require("./db");
const contact_utils_1 = require("./contact-utils");
exports.MAX_PIM_KNOWN_ITEMS = 50_000;
exports.MAX_PIM_KNOWN_ITEMS_BYTES = 8 * 1024 * 1024;
exports.MAX_PIM_ITEM_SOURCE_BYTES = 16 * 1024 * 1024;
exports.MAX_PIM_SNAPSHOT_SOURCE_BYTES = 512 * 1024 * 1024;
exports.MAX_PIM_SYNC_CLIENT_COMMANDS = 512;
exports.MAX_PIM_SYNC_REPLAY_BYTES = 4 * 1024 * 1024;
exports.MAX_PIM_SYNC_RESPONSE_BYTES = exports.MAX_PIM_SYNC_REPLAY_BYTES;
exports.MAX_PIM_SYNC_COMMANDS_BYTES = 1024 * 1024;
exports.MAX_PIM_SYNC_ROW_BYTES = 14 * 1024 * 1024;
exports.MAX_PIM_SYNC_USER_BYTES = 32 * 1024 * 1024;
exports.MAX_PIM_SYNC_PARTNERSHIPS_PER_USER = 256;
exports.PIM_SYNC_STATE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
exports.PIM_QUARANTINE_PREFIX = 'q:';
class PimSyncLimitError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PimSyncLimitError';
    }
}
exports.PimSyncLimitError = PimSyncLimitError;
class PimSyncStateError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PimSyncStateError';
    }
}
exports.PimSyncStateError = PimSyncStateError;
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const cloneKnownItems = (value) => Object.assign(Object.create(null), value);
const CONTACT_SUPPORTED_PAGE_ONE = new Set([
    'Anniversary', 'AssistantName', 'AssistantPhoneNumber', 'Birthday',
    'Business2PhoneNumber', 'BusinessAddressCity', 'BusinessAddressCountry', 'BusinessAddressPostalCode',
    'BusinessAddressState', 'BusinessAddressStreet', 'BusinessFaxNumber', 'BusinessPhoneNumber', 'CarPhoneNumber',
    'Categories', 'Children', 'CompanyName', 'Department', 'Email1Address', 'Email2Address', 'Email3Address',
    'FileAs', 'FirstName', 'Home2PhoneNumber', 'HomeAddressCity', 'HomeAddressCountry', 'HomeAddressPostalCode',
    'HomeAddressState', 'HomeAddressStreet', 'HomeFaxNumber', 'HomePhoneNumber', 'JobTitle', 'LastName',
    'MiddleName', 'MobilePhoneNumber', 'OfficeLocation', 'OtherAddressCity', 'OtherAddressCountry',
    'OtherAddressPostalCode', 'OtherAddressState', 'OtherAddressStreet', 'PagerNumber', 'RadioPhoneNumber',
    'Spouse', 'Suffix', 'Title', 'WebPage', 'YomiCompanyName', 'YomiFirstName', 'YomiLastName', 'Picture',
]);
const CONTACT_SUPPORTED_PAGE_TWELVE = new Set([
    'CustomerId', 'GovernmentId', 'IMAddress', 'IMAddress2', 'IMAddress3', 'ManagerName',
    'CompanyMainPhone', 'AccountName', 'NickName', 'MMS',
]);
const CALENDAR_SUPPORTED_PAGE_FOUR = new Set([
    'DtStamp', 'Categories', 'Sensitivity', 'BusyStatus', 'UID', 'TimeZone', 'StartTime', 'Subject',
    'Location', 'EndTime', 'Recurrence', 'AllDayEvent', 'Reminder', 'Exceptions', 'Attendees',
    'OrganizerName', 'OrganizerEmail', 'MeetingStatus', 'ResponseRequested', 'DisallowNewTimeProposal',
]);
const CALENDAR_REQUIRED_SUPPORTED_PAGE_FOUR = new Set([
    '4:DtStamp', '4:Categories', '4:Sensitivity', '4:BusyStatus', '4:UID', '4:TimeZone',
    '4:StartTime', '4:Subject', '4:Location', '4:EndTime', '4:Recurrence', '4:AllDayEvent',
    '4:Reminder', '4:Exceptions',
]);
const ALWAYS_GHOSTED_FIELDS = new Set([
    '1:Body', '1:BodySize', '1:BodyTruncated', '1:Picture', '4:Exceptions', '17:Body',
]);
const allowedSupportedFields = (dataClass) => {
    const fields = new Set();
    if (dataClass === 'Contacts') {
        for (const tag of CONTACT_SUPPORTED_PAGE_ONE)
            fields.add(`1:${tag}`);
        for (const tag of CONTACT_SUPPORTED_PAGE_TWELVE)
            fields.add(`12:${tag}`);
    }
    else {
        for (const tag of CALENDAR_SUPPORTED_PAGE_FOUR)
            fields.add(`4:${tag}`);
    }
    fields.add('17:Body');
    return fields;
};
const pimDataClassForCollection = (collectionId) => {
    if (collectionId === 'contacts')
        return 'Contacts';
    if (/^cal-[1-9][0-9]{0,18}$/.test(collectionId))
        return 'Calendar';
    throw new PimSyncStateError('PIM sync state has an invalid collection');
};
const validateSupportedFieldsForCollection = (collectionId, fields) => {
    const allowed = allowedSupportedFields(pimDataClassForCollection(collectionId));
    if (fields.some(identity => !allowed.has(identity))) {
        throw new PimSyncStateError('PIM Supported state does not match its collection');
    }
};
function parsePimSupportedProperties(collection, dataClass) {
    const nodes = collection?.children?.filter((node) => node?.page === 0 && node.tag === 'Supported') || [];
    if (nodes.length === 0)
        return { ok: true, value: { wasPresent: false, fields: [] } };
    if (nodes.length !== 1)
        return { ok: false };
    const node = nodes[0];
    if (node.content !== undefined && node.content !== null || !Array.isArray(node.children) || node.children.length > 128) {
        return { ok: false };
    }
    const allowed = allowedSupportedFields(dataClass);
    const fields = new Set();
    for (const child of node.children) {
        const identity = `${child?.page}:${child?.tag}`;
        if (!allowed.has(identity) || fields.has(identity)
            || child.content !== undefined && child.content !== null && child.content !== ''
            || !Array.isArray(child.children) || child.children.length !== 0) {
            return { ok: false };
        }
        fields.add(identity);
    }
    if (dataClass === 'Calendar'
        && [...CALENDAR_REQUIRED_SUPPORTED_PAGE_FOUR].some(identity => !fields.has(identity))) {
        return { ok: false };
    }
    return { ok: true, value: { wasPresent: true, fields: [...fields].sort() } };
}
function pimOmittedFieldsToClear(applicationData, dataClass, supported) {
    const candidates = supported.wasPresent ? new Set(supported.fields) : allowedSupportedFields(dataClass);
    const present = new Set((applicationData?.children || []).map((node) => `${node?.page}:${node?.tag}`));
    return new Set([...candidates].filter(identity => !present.has(identity) && !ALWAYS_GHOSTED_FIELDS.has(identity)));
}
function serializePimSupportedFields(fields) {
    if (!Array.isArray(fields) || fields.length > 128)
        throw new PimSyncStateError('PIM Supported state is malformed');
    const unique = new Set();
    for (const identity of fields) {
        if (typeof identity !== 'string' || !/^(?:1|4|12|17):[A-Za-z][A-Za-z0-9]{0,63}$/.test(identity)
            || unique.has(identity))
            throw new PimSyncStateError('PIM Supported state is malformed');
        unique.add(identity);
    }
    const serialized = JSON.stringify([...unique].sort());
    if (Buffer.byteLength(serialized, 'utf8') > 8192)
        throw new PimSyncLimitError('PIM Supported state is too large');
    return serialized;
}
function parsePimSupportedFields(value) {
    let parsed;
    try {
        parsed = JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : String(value));
    }
    catch {
        throw new PimSyncStateError('PIM Supported state is malformed');
    }
    if (!Array.isArray(parsed))
        throw new PimSyncStateError('PIM Supported state is malformed');
    serializePimSupportedFields(parsed);
    return [...parsed].sort();
}
function assertPimKnownItemsBound(knownItems) {
    if (!isRecord(knownItems))
        throw new PimSyncStateError('PIM known items must be an object');
    const entries = Object.entries(knownItems);
    if (entries.length > exports.MAX_PIM_KNOWN_ITEMS) {
        throw new PimSyncLimitError(`PIM known item count exceeds ${exports.MAX_PIM_KNOWN_ITEMS}`);
    }
    const serialized = JSON.stringify(knownItems);
    if (Buffer.byteLength(serialized, 'utf8') > exports.MAX_PIM_KNOWN_ITEMS_BYTES) {
        throw new PimSyncLimitError(`PIM known item state exceeds ${exports.MAX_PIM_KNOWN_ITEMS_BYTES} bytes`);
    }
    for (const [serverId, fingerprint] of entries) {
        if (!serverId || serverId.length > 64 || typeof fingerprint !== 'string' || !fingerprint || fingerprint.length > 128) {
            throw new PimSyncStateError('PIM known item state contains an invalid entry');
        }
    }
    return serialized;
}
function parsePimKnownItems(value) {
    let parsed;
    try {
        parsed = JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : String(value));
    }
    catch {
        throw new PimSyncStateError('PIM known item state is malformed');
    }
    if (!isRecord(parsed))
        throw new PimSyncStateError('PIM known item state is malformed');
    const knownItems = cloneKnownItems(parsed);
    assertPimKnownItemsBound(knownItems);
    return knownItems;
}
const assertPimCommandsBound = (commands) => {
    if (!Array.isArray(commands) || commands.length > exports.MAX_PIM_SYNC_CLIENT_COMMANDS) {
        throw new PimSyncStateError('PIM command replay state is malformed');
    }
    for (const command of commands) {
        if (!command || !['Add', 'Change', 'Delete'].includes(command.type)
            || typeof command.serverId !== 'string' || !command.serverId || command.serverId.length > 64
            || typeof command.fingerprint !== 'string' || !command.fingerprint) {
            throw new PimSyncStateError('PIM command replay state is malformed');
        }
    }
    const serialized = JSON.stringify(commands);
    if (Buffer.byteLength(serialized, 'utf8') > exports.MAX_PIM_SYNC_COMMANDS_BYTES) {
        throw new PimSyncLimitError('PIM command replay state is too large');
    }
    return serialized;
};
const parsePimCommands = (value) => {
    let parsed;
    try {
        parsed = JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : String(value));
    }
    catch {
        throw new PimSyncStateError('PIM command replay state is malformed');
    }
    if (!Array.isArray(parsed))
        throw new PimSyncStateError('PIM command replay state is malformed');
    assertPimCommandsBound(parsed);
    return parsed;
};
const pimItemFingerprint = (serverId, version) => (0, crypto_1.createHash)('sha256').update(serverId).update('\0').update(version).digest('hex');
exports.pimItemFingerprint = pimItemFingerprint;
const pimSyncScopeHash = (username, deviceId, collectionId) => (0, crypto_1.createHash)('sha256').update(username).update('\0').update(deviceId).update('\0').update(collectionId).digest('hex');
exports.pimSyncScopeHash = pimSyncScopeHash;
const pimSyncRequestHash = (requestBody) => (0, crypto_1.createHash)('sha256').update(requestBody).digest('hex');
exports.pimSyncRequestHash = pimSyncRequestHash;
const pimWireServerId = (collectionId, sourceId) => (0, crypto_1.createHash)('sha256').update(collectionId).update('\0').update(sourceId).digest('hex');
exports.pimWireServerId = pimWireServerId;
const createPimSyncKey = () => `oms-pim-${(0, crypto_1.randomBytes)(24).toString('hex')}`;
exports.createPimSyncKey = createPimSyncKey;
const isPimSyncKey = (value) => /^oms-pim-[0-9a-f]{48}$/.test(value);
function deterministicPimAddServerId(scopeHash, syncKey, clientId) {
    const bytes = (0, crypto_1.createHash)('sha256')
        .update(scopeHash)
        .update('\0')
        .update(syncKey)
        .update('\0')
        .update(clientId)
        .digest()
        .subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function validatePimClientCommands(commands, dataClass) {
    if (!Array.isArray(commands) || commands.length > exports.MAX_PIM_SYNC_CLIENT_COMMANDS)
        return { ok: false };
    const clientIds = new Set();
    const serverIds = new Set();
    const scalar = (node, allowEmpty = false, maxBytes = 1024 * 1024, multiline = false) => node && (!node.children || node.children.length === 0)
        && (node.content === undefined && allowEmpty
            || typeof node.content === 'string'
                && Buffer.byteLength(node.content, 'utf8') <= maxBytes
                && !(multiline
                    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
                    : /[\u0000-\u001f\u007f]/).test(node.content)
                && (allowEmpty || node.content.length > 0));
    const applicationData = (node) => {
        if (!node || node.tag !== 'ApplicationData' || node.page !== 0
            || node.content !== undefined && node.content !== null || !Array.isArray(node.children)
            || node.children.length < 1 || node.children.length > 256)
            return false;
        const seen = new Set();
        const expectedPage = dataClass === 'Contacts' ? 1 : 4;
        for (const child of node.children) {
            const identity = `${child?.page}:${child?.tag}`;
            if (!child?.tag || seen.has(identity))
                return false;
            seen.add(identity);
            if (child.tag === 'Body') {
                if (child.page !== 17 || !Array.isArray(child.children) || child.content !== undefined && child.content !== null)
                    return false;
                const bodySeen = new Set();
                if (child.children.length < 1 || child.children.length > 8)
                    return false;
                for (const bodyChild of child.children) {
                    if (bodyChild?.page !== 17 || bodySeen.has(bodyChild.tag)
                        || !['Type', 'Data', 'EstimatedDataSize', 'Truncated', 'NativeBodyType'].includes(bodyChild?.tag)
                        || !scalar(bodyChild, true, 1024 * 1024, bodyChild.tag === 'Data'))
                        return false;
                    bodySeen.add(bodyChild.tag);
                }
                continue;
            }
            if (child.page !== expectedPage && !(dataClass === 'Contacts' && child.page === 12))
                return false;
            if (dataClass === 'Calendar' && child.tag === 'Categories') {
                if (!Array.isArray(child.children) || child.content !== undefined && child.content !== null
                    || child.children.length > 128
                    || child.children.some((category) => category?.page !== 4 || category.tag !== 'Category'
                        || !scalar(category, true, 4096)))
                    return false;
                continue;
            }
            const container = dataClass === 'Calendar' && ['Recurrence', 'Exceptions', 'Attendees', 'Categories'].includes(child.tag)
                || dataClass === 'Contacts' && ['Categories', 'Children'].includes(child.tag);
            if (container ? (!Array.isArray(child.children) || child.content !== undefined && child.content !== null) : !scalar(child, true))
                return false;
        }
        return true;
    };
    for (const command of commands) {
        if (!command || command.page !== 0 || command.content !== undefined && command.content !== null
            || !Array.isArray(command.children))
            return { ok: false };
        const shape = command.children.map((child) => `${child?.page}:${child?.tag}`);
        if (command.tag === 'Add') {
            const classOffset = shape[0] === '0:Class' ? 1 : 0;
            if (classOffset && (!scalar(command.children[0]) || String(command.children[0].content) !== dataClass))
                return { ok: false };
            if (shape.slice(classOffset).join(',') !== '0:ClientId,0:ApplicationData'
                || !scalar(command.children[classOffset]) || !applicationData(command.children[classOffset + 1]))
                return { ok: false };
            const clientId = String(command.children[classOffset].content);
            if (!/^[A-Za-z0-9]{1,64}$/.test(clientId) || clientIds.has(clientId))
                return { ok: false };
            clientIds.add(clientId);
        }
        else if (command.tag === 'Change') {
            const instanceOffset = shape[1] === '17:InstanceId' ? 1 : 0;
            if (shape.join(',') !== (instanceOffset
                ? '0:ServerId,17:InstanceId,0:ApplicationData'
                : '0:ServerId,0:ApplicationData')
                || !scalar(command.children[0])
                || instanceOffset && !scalar(command.children[1])
                || !applicationData(command.children[1 + instanceOffset]))
                return { ok: false };
            const serverId = String(command.children[0].content);
            if (!/^[0-9a-f]{64}$/.test(serverId) || serverIds.has(serverId))
                return { ok: false };
            serverIds.add(serverId);
        }
        else if (command.tag === 'Delete') {
            const hasInstance = shape.length === 2;
            if (shape.join(',') !== (hasInstance ? '0:ServerId,17:InstanceId' : '0:ServerId')
                || !scalar(command.children[0]) || hasInstance && !scalar(command.children[1]))
                return { ok: false };
            const serverId = String(command.children[0].content);
            if (!/^[0-9a-f]{64}$/.test(serverId) || serverIds.has(serverId))
                return { ok: false };
            serverIds.add(serverId);
        }
        else {
            return { ok: false };
        }
    }
    return { ok: true };
}
const pimSyncStateDisposition = (state, syncKey, now = new Date()) => {
    if (syncKey === '0')
        return 'prime';
    if (state?.updatedAt && now.getTime() - state.updatedAt.getTime() > exports.PIM_SYNC_STATE_TTL_MS)
        return 'stale';
    if (state?.currentSyncKey === syncKey)
        return 'current';
    return 'stale';
};
exports.pimSyncStateDisposition = pimSyncStateDisposition;
const pimSyncReplayResponse = (state, syncKey, requestHash, now = new Date()) => {
    if (!state?.lastResponse || state.previousSyncKey !== syncKey || state.lastRequestHash !== requestHash)
        return null;
    if (now.getTime() - state.updatedAt.getTime() > exports.PIM_SYNC_STATE_TTL_MS)
        return null;
    const age = now.getTime() - state.updatedAt.getTime();
    if (age > (syncKey === '0' ? 2 : 10) * 60 * 1000)
        return null;
    return Buffer.from(state.lastResponse);
};
exports.pimSyncReplayResponse = pimSyncReplayResponse;
function computePimSyncDelta(input) {
    assertPimKnownItemsBound(input.knownItems);
    if (!Array.isArray(input.snapshot))
        throw new PimSyncStateError('PIM snapshot is malformed');
    const snapshotById = assertPimSnapshotBound(input.snapshot);
    const pending = [];
    for (const serverId of Object.keys(input.knownItems).sort()) {
        if (!snapshotById.has(serverId)) {
            pending.push({ type: 'Delete', serverId, fingerprint: input.knownItems[serverId] });
        }
    }
    for (const [serverId, fingerprint] of [...snapshotById.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const knownFingerprint = hasOwn(input.knownItems, serverId) ? input.knownItems[serverId] : undefined;
        if (knownFingerprint === undefined)
            pending.push({ type: 'Add', serverId, fingerprint });
        else if (knownFingerprint !== fingerprint)
            pending.push({ type: 'Change', serverId, fingerprint });
    }
    const windowSize = Math.max(0, Math.min(512, Math.trunc(input.windowSize)));
    const commands = pending.slice(0, windowSize);
    const nextKnownItems = cloneKnownItems(input.knownItems);
    for (const command of commands) {
        if (command.type === 'Delete')
            delete nextKnownItems[command.serverId];
        else
            nextKnownItems[command.serverId] = command.fingerprint;
    }
    assertPimKnownItemsBound(nextKnownItems);
    return { commands, nextKnownItems, moreAvailable: pending.length > commands.length };
}
const pimQuarantineFingerprint = (sourceFingerprint) => {
    if (!/^[a-f0-9]{64}$/i.test(sourceFingerprint)) {
        throw new PimSyncStateError('PIM quarantine fingerprint is invalid');
    }
    return `${exports.PIM_QUARANTINE_PREFIX}${sourceFingerprint.toLowerCase()}`;
};
exports.pimQuarantineFingerprint = pimQuarantineFingerprint;
function pimQuarantineCommand(command, knownItems) {
    const fingerprint = (0, exports.pimQuarantineFingerprint)(command.fingerprint);
    const wasDelivered = hasOwn(knownItems, command.serverId)
        && !knownItems[command.serverId].startsWith(exports.PIM_QUARANTINE_PREFIX);
    return {
        fingerprint,
        wireCommand: wasDelivered ? { ...command, type: 'Delete', fingerprint } : null,
    };
}
function normalizePimQuarantineState(knownItems, snapshot) {
    assertPimKnownItemsBound(knownItems);
    const nextKnown = cloneKnownItems(knownItems);
    const snapshotById = new Map(snapshot.map(item => [item.serverId, item]));
    const nextSnapshot = snapshot.map(item => {
        const known = nextKnown[item.serverId];
        if (!known?.startsWith(exports.PIM_QUARANTINE_PREFIX))
            return item;
        const quarantined = (0, exports.pimQuarantineFingerprint)(item.fingerprint);
        if (known === quarantined)
            return { ...item, fingerprint: known };
        delete nextKnown[item.serverId];
        return item;
    });
    for (const [serverId, fingerprint] of Object.entries(nextKnown)) {
        if (fingerprint.startsWith(exports.PIM_QUARANTINE_PREFIX) && !snapshotById.has(serverId)) {
            delete nextKnown[serverId];
        }
    }
    assertPimKnownItemsBound(nextKnown);
    assertPimSnapshotBound(nextSnapshot);
    return { knownItems: nextKnown, snapshot: nextSnapshot };
}
function assertPimSnapshotBound(snapshot) {
    if (!Array.isArray(snapshot))
        throw new PimSyncStateError('PIM snapshot is malformed');
    const snapshotById = new Map();
    for (const item of snapshot) {
        if (!item || typeof item.serverId !== 'string' || !item.serverId || item.serverId.length > 64
            || typeof item.fingerprint !== 'string' || !item.fingerprint) {
            throw new PimSyncStateError('PIM snapshot contains an invalid item');
        }
        if (snapshotById.has(item.serverId))
            throw new PimSyncStateError('PIM snapshot contains duplicate identities');
        snapshotById.set(item.serverId, item.fingerprint);
    }
    assertPimKnownItemsBound(Object.fromEntries(snapshotById));
    return snapshotById;
}
function boundedSnapshotAggregate(rows) {
    const count = Number(rows[0]?.item_count);
    const bytes = Number(rows[0]?.source_bytes || 0);
    if (!Number.isSafeInteger(count) || count < 0 || count > exports.MAX_PIM_KNOWN_ITEMS) {
        throw new PimSyncLimitError(`PIM item count exceeds ${exports.MAX_PIM_KNOWN_ITEMS}`);
    }
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > exports.MAX_PIM_SNAPSHOT_SOURCE_BYTES) {
        throw new PimSyncLimitError(`PIM snapshot source exceeds ${exports.MAX_PIM_SNAPSHOT_SOURCE_BYTES} bytes`);
    }
    return { count, bytes };
}
function boundedSnapshotMetadata(rows, expectedCount, collectionId, sourceIdForRow, versionTokenForRow) {
    if (rows.length !== expectedCount || rows.length > exports.MAX_PIM_KNOWN_ITEMS) {
        throw new PimSyncStateError('PIM snapshot changed while metadata was loading');
    }
    const items = [];
    const byServerId = new Map();
    for (const row of rows) {
        const sourceId = sourceIdForRow(row);
        const sourceVersion = String(row?.source_version || '');
        const sourceBytes = Number(row?.source_bytes || 0);
        if (!sourceId || !/^[1-9][0-9]{0,19}$/.test(sourceVersion)
            || !Number.isSafeInteger(sourceBytes) || sourceBytes < 0
            || sourceBytes > exports.MAX_PIM_ITEM_SOURCE_BYTES) {
            throw new PimSyncLimitError('PIM item metadata exceeds its source bound');
        }
        const serverId = (0, exports.pimWireServerId)(collectionId, sourceId);
        const metadata = {
            serverId,
            sourceId,
            sourceBytes,
            fingerprint: (0, exports.pimItemFingerprint)(serverId, sourceVersion),
            versionToken: versionTokenForRow?.(row),
        };
        items.push(metadata);
        byServerId.set(serverId, metadata);
    }
    assertPimSnapshotBound(items);
    return { items, byServerId };
}
async function loadBoundedContactPimSnapshot(connection, username, collectionId) {
    const sourceBytes = (0, contact_utils_1.easContactSourceBytesExpression)();
    const [aggregateRows] = await connection.query(`SELECT COUNT(*) AS item_count,
                COALESCE(SUM(${sourceBytes}), 0) AS source_bytes
         FROM contacts WHERE username = ? AND deleted_at IS NULL`, [username]);
    const aggregate = boundedSnapshotAggregate(aggregateRows);
    const [rows] = await connection.query(`SELECT id, dav_uid, sync_token AS source_version,
                ${sourceBytes} AS source_bytes
         FROM contacts
         WHERE username = ? AND deleted_at IS NULL
         ORDER BY id ASC
         LIMIT ${exports.MAX_PIM_KNOWN_ITEMS + 1}`, [username]);
    return boundedSnapshotMetadata(rows, aggregate.count, collectionId, row => String(row.dav_uid || `contact-${row.id}`), row => Number.isSafeInteger(Number(row.source_version)) ? Number(row.source_version) : undefined);
}
async function loadBoundedCalendarPimSnapshot(connection, calendarId, collectionId) {
    const [aggregateRows] = await connection.query(`SELECT COUNT(*) AS item_count,
                COALESCE(SUM(OCTET_LENGTH(COALESCE(ical_data, ''))), 0) AS source_bytes
         FROM events WHERE calendar_id = ?`, [calendarId]);
    const aggregate = boundedSnapshotAggregate(aggregateRows);
    const [rows] = await connection.query(`SELECT resource_name, sync_token AS source_version,
                OCTET_LENGTH(COALESCE(ical_data, '')) AS source_bytes
         FROM events
         WHERE calendar_id = ?
         ORDER BY resource_name ASC
         LIMIT ${exports.MAX_PIM_KNOWN_ITEMS + 1}`, [calendarId]);
    return boundedSnapshotMetadata(rows, aggregate.count, collectionId, row => String(row.resource_name || ''));
}
function advancePimKnownItems(knownItems, commands) {
    const nextKnownItems = cloneKnownItems(knownItems);
    for (const command of commands) {
        if (command.type === 'Delete')
            delete nextKnownItems[command.serverId];
        else
            nextKnownItems[command.serverId] = command.fingerprint;
    }
    assertPimKnownItemsBound(nextKnownItems);
    return nextKnownItems;
}
function fitPimSyncCommandsToByteBudget(commands, encodedCommandBytes, baseResponseBytes, maxBytes = exports.MAX_PIM_SYNC_RESPONSE_BYTES) {
    if (commands.length !== encodedCommandBytes.length || baseResponseBytes > maxBytes) {
        throw new PimSyncLimitError('PIM response exceeds the encoded byte budget');
    }
    let totalBytes = baseResponseBytes;
    let count = 0;
    for (const bytes of encodedCommandBytes) {
        if (!Number.isInteger(bytes) || bytes < 0)
            throw new PimSyncStateError('PIM encoded command size is invalid');
        if (totalBytes + bytes > maxBytes) {
            if (count === 0)
                throw new PimSyncLimitError('A PIM item exceeds the encoded byte budget');
            break;
        }
        totalBytes += bytes;
        count += 1;
    }
    return { commands: commands.slice(0, count), moreAvailable: count < commands.length };
}
function assertPimSyncRowBound(knownItems, commands, response, supportedFields = '[]') {
    if (Buffer.byteLength(knownItems, 'utf8') + Buffer.byteLength(commands, 'utf8')
        + Buffer.byteLength(supportedFields, 'utf8') + (response?.length || 0) > exports.MAX_PIM_SYNC_ROW_BYTES) {
        throw new PimSyncLimitError('PIM sync state row exceeds its aggregate storage bound');
    }
}
function applyAcceptedPimWrites(knownItems, acceptedUpserts, acceptedDeletes) {
    assertPimKnownItemsBound(knownItems);
    const nextKnownItems = cloneKnownItems(knownItems);
    for (const serverId of acceptedDeletes)
        delete nextKnownItems[serverId];
    for (const [serverId, fingerprint] of Object.entries(acceptedUpserts)) {
        if (!serverId || !fingerprint)
            throw new PimSyncStateError('Accepted PIM write fingerprint is invalid');
        nextKnownItems[serverId] = fingerprint;
    }
    assertPimKnownItemsBound(nextKnownItems);
    return nextKnownItems;
}
let schemaPromise = null;
const ensureEasPimSyncSchema = async () => {
    if (!schemaPromise) {
        schemaPromise = (async () => {
            await db_1.pool.query(`
            CREATE TABLE IF NOT EXISTS eas_pim_sync_states (
                scope_hash CHAR(64) NOT NULL PRIMARY KEY,
                username VARCHAR(255) NOT NULL,
                device_id VARCHAR(128) NOT NULL,
                collection_id VARCHAR(512) NOT NULL,
                current_sync_key VARCHAR(96) NOT NULL,
                previous_sync_key VARCHAR(96) NULL,
                window_size SMALLINT UNSIGNED NOT NULL DEFAULT 100,
                supported_was_present TINYINT(1) NOT NULL DEFAULT 1,
                supported_fields VARCHAR(8192) NOT NULL DEFAULT '[]',
                known_items MEDIUMTEXT NOT NULL,
                last_commands MEDIUMTEXT NOT NULL,
                last_more_available TINYINT(1) NOT NULL DEFAULT 0,
                last_request_hash CHAR(64) NULL,
                last_response MEDIUMBLOB NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY idx_eas_pim_device (username, device_id),
                KEY idx_eas_pim_updated (updated_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            const [columns] = await db_1.pool.query('SHOW COLUMNS FROM eas_pim_sync_states');
            const names = new Set(columns.map((column) => String(column.Field)));
            if (!names.has('supported_was_present')) {
                await db_1.pool.query('ALTER TABLE eas_pim_sync_states ADD COLUMN supported_was_present TINYINT(1) NOT NULL DEFAULT 1 AFTER window_size');
            }
            if (!names.has('supported_fields')) {
                await db_1.pool.query("ALTER TABLE eas_pim_sync_states ADD COLUMN supported_fields VARCHAR(8192) NOT NULL DEFAULT '[]' AFTER supported_was_present");
            }
        })().catch(err => {
            schemaPromise = null;
            throw err;
        });
    }
    return schemaPromise;
};
exports.ensureEasPimSyncSchema = ensureEasPimSyncSchema;
const pimSqlLockName = (username) => `oms-pim-${(0, crypto_1.createHash)('sha256').update(username.trim().toLowerCase()).digest('hex').slice(0, 48)}`;
exports.pimSqlLockName = pimSqlLockName;
async function withPimSqlTransaction(username, operation, secondaryLock) {
    await (0, exports.ensureEasPimSyncSchema)();
    const connection = await db_1.pool.getConnection();
    const pimLock = (0, exports.pimSqlLockName)(username);
    let pimLockAcquired = false;
    let secondaryLockAcquired = false;
    let secondaryLease;
    let transactionStarted = false;
    let committed = false;
    let connectionUsable = true;
    let result;
    let failure = null;
    try {
        let lockRows;
        try {
            [lockRows] = await connection.query('SELECT GET_LOCK(?, 10) AS acquired', [pimLock]);
        }
        catch (error) {
            connectionUsable = false;
            console.error('[EAS] PIM primary lock acquisition failed; discarding connection');
            throw error;
        }
        if (Number(lockRows[0]?.acquired || 0) !== 1)
            throw new PimSyncStateError('PIM transaction lock was unavailable');
        pimLockAcquired = true;
        if (secondaryLock) {
            try {
                secondaryLease = await secondaryLock.acquire(connection);
            }
            catch (error) {
                connectionUsable = false;
                console.error('[EAS] PIM secondary lock acquisition failed; discarding connection');
                throw error;
            }
            secondaryLockAcquired = true;
        }
        await connection.beginTransaction();
        transactionStarted = true;
        result = await operation(connection);
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
                connectionUsable = false;
            }
        }
    }
    finally {
        if (secondaryLock && secondaryLockAcquired) {
            try {
                await secondaryLock.release(connection, secondaryLease);
            }
            catch (error) {
                if (!failure && !committed)
                    failure = error;
                else if (committed)
                    console.error('[EAS] PIM secondary lock release failed after commit');
                connectionUsable = false;
            }
        }
        if (pimLockAcquired) {
            try {
                const [releaseRows] = await connection.query('SELECT RELEASE_LOCK(?) AS released', [pimLock]);
                if (Number(releaseRows[0]?.released || 0) !== 1) {
                    throw new PimSyncStateError('PIM transaction lock release failed');
                }
            }
            catch (error) {
                if (!failure && !committed)
                    failure = error;
                else if (committed)
                    console.error('[EAS] PIM transaction lock release failed after commit');
                connectionUsable = false;
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
async function loadPimSyncStateWithExecutor(executor, username, deviceId, collectionId) {
    const scopeHash = (0, exports.pimSyncScopeHash)(username, deviceId, collectionId);
    const [metadataRows] = await executor.query(`SELECT scope_hash, username, device_id, collection_id, current_sync_key, previous_sync_key,
                window_size, supported_was_present, last_more_available, last_request_hash, updated_at,
                OCTET_LENGTH(known_items) AS known_items_bytes,
                OCTET_LENGTH(last_commands) AS last_commands_bytes,
                OCTET_LENGTH(supported_fields) AS supported_fields_bytes,
                COALESCE(OCTET_LENGTH(last_response), 0) AS last_response_bytes
         FROM eas_pim_sync_states WHERE scope_hash = ? LIMIT 1 FOR UPDATE`, [scopeHash]);
    if (!metadataRows.length)
        return null;
    const metadata = metadataRows[0];
    const payloadLengths = [
        ['known_items', metadata.known_items_bytes, exports.MAX_PIM_KNOWN_ITEMS_BYTES],
        ['last_commands', metadata.last_commands_bytes, exports.MAX_PIM_SYNC_COMMANDS_BYTES],
        ['supported_fields', metadata.supported_fields_bytes, 8192],
        ['last_response', metadata.last_response_bytes, exports.MAX_PIM_SYNC_REPLAY_BYTES],
    ];
    let payloadBytes = 0;
    for (const [field, rawBytes, maximum] of payloadLengths) {
        if ((typeof rawBytes !== 'number' && typeof rawBytes !== 'string')
            || !/^\d+$/.test(String(rawBytes))) {
            throw new PimSyncStateError(`PIM sync state ${field} length is malformed`);
        }
        const bytes = Number(rawBytes);
        if (!Number.isSafeInteger(bytes) || bytes < 0) {
            throw new PimSyncStateError(`PIM sync state ${field} length is malformed`);
        }
        if (bytes > maximum)
            throw new PimSyncLimitError(`PIM sync state ${field} is too large`);
        payloadBytes += bytes;
    }
    if (payloadBytes > exports.MAX_PIM_SYNC_ROW_BYTES) {
        throw new PimSyncLimitError('PIM sync state row is too large');
    }
    const [payloadRows] = await executor.query(`SELECT known_items, last_commands, supported_fields, last_response
         FROM eas_pim_sync_states
         WHERE scope_hash = ?
           AND OCTET_LENGTH(known_items) = ?
           AND OCTET_LENGTH(last_commands) = ?
           AND OCTET_LENGTH(supported_fields) = ?
           AND COALESCE(OCTET_LENGTH(last_response), 0) = ?
         LIMIT 1`, [scopeHash, ...payloadLengths.map(([, rawBytes]) => Number(rawBytes))]);
    if (payloadRows.length !== 1) {
        throw new PimSyncStateError('PIM sync state changed while its payload was loading');
    }
    const row = { ...metadata, ...payloadRows[0] };
    if (String(row.username) !== username || String(row.device_id) !== deviceId
        || String(row.collection_id) !== collectionId || String(row.scope_hash) !== scopeHash) {
        throw new PimSyncStateError('PIM sync state scope does not match its lookup key');
    }
    const currentSyncKey = String(row.current_sync_key);
    const previousSyncKey = row.previous_sync_key ? String(row.previous_sync_key) : null;
    if (!isPimSyncKey(currentSyncKey)
        || (previousSyncKey !== null && previousSyncKey !== '0' && !isPimSyncKey(previousSyncKey))) {
        throw new PimSyncStateError('PIM sync state contains an invalid key');
    }
    const lastResponse = row.last_response ? Buffer.from(row.last_response) : null;
    if (lastResponse && lastResponse.length > exports.MAX_PIM_SYNC_REPLAY_BYTES) {
        throw new PimSyncLimitError('PIM replay response is too large');
    }
    const updatedAt = new Date(row.updated_at);
    if (!Number.isFinite(updatedAt.getTime()))
        throw new PimSyncStateError('PIM sync state has an invalid timestamp');
    const windowSize = Number(row.window_size);
    if (!Number.isInteger(windowSize) || windowSize < 1 || windowSize > 512) {
        throw new PimSyncStateError('PIM sync state has an invalid window size');
    }
    const lastRequestHash = row.last_request_hash ? String(row.last_request_hash) : null;
    if (lastRequestHash !== null && !/^[0-9a-f]{64}$/.test(lastRequestHash)) {
        throw new PimSyncStateError('PIM sync state has an invalid request hash');
    }
    const knownItems = parsePimKnownItems(row.known_items);
    const lastCommands = parsePimCommands(row.last_commands);
    const supportedWasPresentValue = Number(row.supported_was_present);
    if (supportedWasPresentValue !== 0 && supportedWasPresentValue !== 1) {
        throw new PimSyncStateError('PIM Supported state is malformed');
    }
    const supportedWasPresent = supportedWasPresentValue === 1;
    const supportedFields = parsePimSupportedFields(row.supported_fields);
    validateSupportedFieldsForCollection(collectionId, supportedFields);
    if (!supportedWasPresent && supportedFields.length > 0) {
        throw new PimSyncStateError('PIM Supported state is malformed');
    }
    const serializedSupportedFields = serializePimSupportedFields(supportedFields);
    assertPimSyncRowBound(JSON.stringify(knownItems), JSON.stringify(lastCommands), lastResponse, serializedSupportedFields);
    return {
        scopeHash,
        username: String(row.username),
        deviceId: String(row.device_id),
        collectionId: String(row.collection_id),
        currentSyncKey,
        previousSyncKey,
        windowSize,
        supportedWasPresent,
        supportedFields,
        knownItems,
        lastCommands,
        lastMoreAvailable: Number(row.last_more_available) === 1,
        lastRequestHash,
        lastResponse,
        updatedAt,
    };
}
const loadPimSyncStateOnConnection = async (connection, username, deviceId, collectionId) => loadPimSyncStateWithExecutor(connection, username, deviceId, collectionId);
exports.loadPimSyncStateOnConnection = loadPimSyncStateOnConnection;
const loadPimSyncState = async (username, deviceId, collectionId) => withPimSqlTransaction(username, connection => (0, exports.loadPimSyncStateOnConnection)(connection, username, deviceId, collectionId));
exports.loadPimSyncState = loadPimSyncState;
const savePimSyncStateOnConnection = async (connection, state) => {
    if (state.scopeHash !== (0, exports.pimSyncScopeHash)(state.username, state.deviceId, state.collectionId)
        || Buffer.byteLength(state.deviceId, 'utf8') > 32
        || Buffer.byteLength(state.collectionId, 'utf8') > 64
        || state.lastRequestHash !== null && !/^[0-9a-f]{64}$/.test(state.lastRequestHash)) {
        throw new PimSyncStateError('PIM sync state scope does not match its identity');
    }
    if (!isPimSyncKey(state.currentSyncKey)
        || (state.previousSyncKey !== null && state.previousSyncKey !== '0' && !isPimSyncKey(state.previousSyncKey))) {
        throw new PimSyncStateError('PIM sync state contains an invalid key');
    }
    if (!Number.isInteger(state.windowSize) || state.windowSize < 1 || state.windowSize > 512) {
        throw new PimSyncStateError('PIM sync state has an invalid window size');
    }
    if (typeof state.supportedWasPresent !== 'boolean') {
        throw new PimSyncStateError('PIM Supported state is malformed');
    }
    const supportedFields = serializePimSupportedFields(state.supportedFields);
    validateSupportedFieldsForCollection(state.collectionId, state.supportedFields);
    if (!state.supportedWasPresent && state.supportedFields.length > 0) {
        throw new PimSyncStateError('PIM Supported state is malformed');
    }
    const knownItems = assertPimKnownItemsBound(state.knownItems);
    const lastCommands = assertPimCommandsBound(state.lastCommands);
    if (state.lastResponse && state.lastResponse.length > exports.MAX_PIM_SYNC_REPLAY_BYTES) {
        throw new PimSyncLimitError('PIM replay response is too large');
    }
    assertPimSyncRowBound(knownItems, lastCommands, state.lastResponse, supportedFields);
    const rowBytes = Buffer.byteLength(knownItems, 'utf8') + Buffer.byteLength(lastCommands, 'utf8')
        + Buffer.byteLength(supportedFields, 'utf8') + (state.lastResponse?.length || 0);
    await connection.query('DELETE FROM eas_pim_sync_states WHERE username = ? AND updated_at < DATE_SUB(NOW(), INTERVAL 180 DAY)', [state.username]);
    const [partnershipRows] = await connection.query('SELECT COUNT(*) AS count FROM eas_pim_sync_states WHERE username = ? AND scope_hash <> ?', [state.username, state.scopeHash]);
    if (Number(partnershipRows[0]?.count || 0) >= exports.MAX_PIM_SYNC_PARTNERSHIPS_PER_USER) {
        throw new PimSyncLimitError(`PIM partnership count exceeds ${exports.MAX_PIM_SYNC_PARTNERSHIPS_PER_USER}`);
    }
    const [byteRows] = await connection.query(`SELECT COALESCE(SUM(OCTET_LENGTH(known_items) + OCTET_LENGTH(last_commands)
            + OCTET_LENGTH(supported_fields)
            + COALESCE(OCTET_LENGTH(last_response), 0)), 0) AS bytes
         FROM eas_pim_sync_states WHERE username = ? AND scope_hash <> ?`, [state.username, state.scopeHash]);
    if (Number(byteRows[0]?.bytes || 0) + rowBytes > exports.MAX_PIM_SYNC_USER_BYTES) {
        throw new PimSyncLimitError('PIM user storage exceeds its aggregate bound');
    }
    await connection.query(`
        INSERT INTO eas_pim_sync_states (
            scope_hash, username, device_id, collection_id, current_sync_key, previous_sync_key,
            window_size, supported_was_present, supported_fields, known_items, last_commands,
            last_more_available, last_request_hash, last_response
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            username = VALUES(username), device_id = VALUES(device_id), collection_id = VALUES(collection_id),
            current_sync_key = VALUES(current_sync_key), previous_sync_key = VALUES(previous_sync_key),
            window_size = VALUES(window_size), supported_was_present = VALUES(supported_was_present),
            supported_fields = VALUES(supported_fields), known_items = VALUES(known_items),
            last_commands = VALUES(last_commands), last_more_available = VALUES(last_more_available),
            last_request_hash = VALUES(last_request_hash), last_response = VALUES(last_response)
        `, [
        state.scopeHash,
        state.username,
        state.deviceId,
        state.collectionId,
        state.currentSyncKey,
        state.previousSyncKey,
        state.windowSize,
        state.supportedWasPresent ? 1 : 0,
        supportedFields,
        knownItems,
        lastCommands,
        state.lastMoreAvailable ? 1 : 0,
        state.lastRequestHash,
        state.lastResponse,
    ]);
};
exports.savePimSyncStateOnConnection = savePimSyncStateOnConnection;
const savePimSyncState = async (state) => withPimSqlTransaction(state.username, connection => (0, exports.savePimSyncStateOnConnection)(connection, state));
exports.savePimSyncState = savePimSyncState;
const deletePimSyncStateOnConnection = async (connection, username, deviceId, collectionId) => {
    const scopeHash = (0, exports.pimSyncScopeHash)(username, deviceId, collectionId);
    await connection.query('DELETE FROM eas_pim_sync_states WHERE scope_hash = ? AND username = ? AND device_id = ? AND collection_id = ?', [scopeHash, username, deviceId, collectionId]);
};
exports.deletePimSyncStateOnConnection = deletePimSyncStateOnConnection;
const deletePimSyncState = async (username, deviceId, collectionId) => {
    await withPimSqlTransaction(username, connection => (0, exports.deletePimSyncStateOnConnection)(connection, username, deviceId, collectionId));
};
exports.deletePimSyncState = deletePimSyncState;
const scopeLocks = new Map();
async function withPimSyncScopeLock(scopeHash, operation) {
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
const collectionLocks = new Map();
async function withPimCollectionLock(collectionKey, operation) {
    const previous = collectionLocks.get(collectionKey) || Promise.resolve();
    let release = () => { };
    const current = new Promise(resolve => { release = resolve; });
    const queued = previous.then(() => current);
    collectionLocks.set(collectionKey, queued);
    await previous;
    try {
        return await operation();
    }
    finally {
        release();
        if (collectionLocks.get(collectionKey) === queued)
            collectionLocks.delete(collectionKey);
    }
}
//# sourceMappingURL=eas-pim-sync.js.map