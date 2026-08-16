"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActiveSyncPingWaitRegistry = exports.ActiveSyncPingSupersededError = exports.ActiveSyncPingAbortedError = exports.ActiveSyncPingConfigCache = exports.activeSyncPingScopePrefix = exports.ACTIVE_SYNC_PING_POLL_INTERVAL_MS = exports.ACTIVE_SYNC_PING_MAX_ACTIVE_WAITS_PER_SCOPE = exports.ACTIVE_SYNC_PING_MAX_ACTIVE_WAITS_PER_OWNER = exports.ACTIVE_SYNC_PING_MAX_ACTIVE_WAITS = exports.ACTIVE_SYNC_PING_CONFIG_TTL_MS = exports.ACTIVE_SYNC_PING_MAX_CACHED_CONFIGS_PER_OWNER = exports.ACTIVE_SYNC_PING_MAX_CACHED_CONFIGS = exports.ACTIVE_SYNC_PING_MAX_REQUEST_BYTES = exports.ACTIVE_SYNC_PING_MAX_FOLDERS = exports.ACTIVE_SYNC_PING_MAX_HEARTBEAT_SECONDS = exports.ACTIVE_SYNC_PING_MIN_HEARTBEAT_SECONDS = void 0;
exports.activeSyncPingHasAdditions = activeSyncPingHasAdditions;
exports.activeSyncPingMailCursorNeedsSnapshot = activeSyncPingMailCursorNeedsSnapshot;
exports.evaluateActiveSyncPingChanges = evaluateActiveSyncPingChanges;
exports.startActiveSyncPingWait = startActiveSyncPingWait;
exports.waitForActiveSyncPing = waitForActiveSyncPing;
exports.parseActiveSyncPingRequest = parseActiveSyncPingRequest;
exports.resolveActiveSyncPingFolders = resolveActiveSyncPingFolders;
exports.activeSyncPingResponseNode = activeSyncPingResponseNode;
const crypto_1 = require("crypto");
const node_perf_hooks_1 = require("node:perf_hooks");
exports.ACTIVE_SYNC_PING_MIN_HEARTBEAT_SECONDS = 60;
exports.ACTIVE_SYNC_PING_MAX_HEARTBEAT_SECONDS = 900;
exports.ACTIVE_SYNC_PING_MAX_FOLDERS = 32;
exports.ACTIVE_SYNC_PING_MAX_REQUEST_BYTES = 32 * 1024;
exports.ACTIVE_SYNC_PING_MAX_CACHED_CONFIGS = 4096;
exports.ACTIVE_SYNC_PING_MAX_CACHED_CONFIGS_PER_OWNER = 64;
exports.ACTIVE_SYNC_PING_CONFIG_TTL_MS = 24 * 60 * 60 * 1000;
exports.ACTIVE_SYNC_PING_MAX_ACTIVE_WAITS = 64;
exports.ACTIVE_SYNC_PING_MAX_ACTIVE_WAITS_PER_OWNER = 8;
exports.ACTIVE_SYNC_PING_MAX_ACTIVE_WAITS_PER_SCOPE = 2;
exports.ACTIVE_SYNC_PING_POLL_INTERVAL_MS = 15_000;
const cloneConfig = (config) => ({
    heartbeatSeconds: config.heartbeatSeconds,
    folders: config.folders.map(folder => ({ ...folder })),
});
const validConfig = (config) => {
    if (!Number.isInteger(config.heartbeatSeconds)
        || config.heartbeatSeconds < exports.ACTIVE_SYNC_PING_MIN_HEARTBEAT_SECONDS
        || config.heartbeatSeconds > exports.ACTIVE_SYNC_PING_MAX_HEARTBEAT_SECONDS
        || !Array.isArray(config.folders) || config.folders.length < 1
        || config.folders.length > exports.ACTIVE_SYNC_PING_MAX_FOLDERS)
        return false;
    const seen = new Set();
    for (const folder of config.folders) {
        if (!folder || typeof folder.id !== 'string'
            || Buffer.byteLength(folder.id, 'utf8') < 1
            || Buffer.byteLength(folder.id, 'utf8') > 64
            || /[\u0000-\u001f\u007f]/.test(folder.id)
            || !['Email', 'Calendar', 'Contacts'].includes(folder.className)
            || seen.has(folder.id))
            return false;
        seen.add(folder.id);
    }
    return true;
};
const pingScopeIdentity = (owner, deviceId) => {
    if (typeof owner !== 'string' || typeof deviceId !== 'string'
        || Buffer.byteLength(owner, 'utf8') < 1 || Buffer.byteLength(owner, 'utf8') > 320
        || !/^[A-Za-z0-9]{1,32}$/.test(deviceId)
        || /[\u0000-\u001f\u007f]/.test(owner + deviceId))
        return null;
    const ownerHash = (0, crypto_1.createHash)('sha256').update(owner).digest('hex');
    const key = (0, crypto_1.createHash)('sha256').update(ownerHash).update('\0').update(deviceId).digest('hex');
    return { key, ownerHash };
};
const activeSyncPingScopePrefix = (owner, deviceId) => pingScopeIdentity(owner, deviceId)?.key.slice(0, 12) || 'invalid';
exports.activeSyncPingScopePrefix = activeSyncPingScopePrefix;
class ActiveSyncPingConfigCache {
    entries = new Map();
    maxEntries;
    maxEntriesPerOwner;
    ttlMs;
    now;
    constructor(options = {}) {
        this.maxEntries = options.maxEntries ?? exports.ACTIVE_SYNC_PING_MAX_CACHED_CONFIGS;
        this.maxEntriesPerOwner = options.maxEntriesPerOwner
            ?? Math.min(exports.ACTIVE_SYNC_PING_MAX_CACHED_CONFIGS_PER_OWNER, this.maxEntries);
        this.ttlMs = options.ttlMs ?? exports.ACTIVE_SYNC_PING_CONFIG_TTL_MS;
        this.now = options.now ?? Date.now;
        if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1
            || !Number.isInteger(this.maxEntriesPerOwner) || this.maxEntriesPerOwner < 1
            || this.maxEntriesPerOwner > this.maxEntries
            || !Number.isInteger(this.ttlMs) || this.ttlMs < 1) {
            throw new Error('Invalid ActiveSync Ping cache bounds');
        }
    }
    pruneExpired(now) {
        for (const [key, entry] of this.entries) {
            if (entry.expiresAt <= now)
                this.entries.delete(key);
        }
    }
    get size() {
        this.pruneExpired(this.now());
        return this.entries.size;
    }
    get(owner, deviceId) {
        const scope = pingScopeIdentity(owner, deviceId);
        if (!scope)
            return null;
        const now = this.now();
        this.pruneExpired(now);
        const entry = this.entries.get(scope.key);
        if (!entry)
            return null;
        return cloneConfig(entry.config);
    }
    set(owner, deviceId, config) {
        const scope = pingScopeIdentity(owner, deviceId);
        if (!scope || !validConfig(config))
            return false;
        const now = this.now();
        this.pruneExpired(now);
        this.entries.delete(scope.key);
        while (Array.from(this.entries.values()).filter(entry => entry.ownerHash === scope.ownerHash).length
            >= this.maxEntriesPerOwner) {
            const oldestOwnerEntry = Array.from(this.entries.entries())
                .find(([, entry]) => entry.ownerHash === scope.ownerHash)?.[0];
            if (!oldestOwnerEntry)
                break;
            this.entries.delete(oldestOwnerEntry);
        }
        while (this.entries.size >= this.maxEntries) {
            const oldest = this.entries.keys().next().value;
            if (typeof oldest !== 'string')
                break;
            this.entries.delete(oldest);
        }
        this.entries.set(scope.key, {
            config: cloneConfig(config),
            expiresAt: now + this.ttlMs,
            ownerHash: scope.ownerHash,
        });
        return true;
    }
    delete(owner, deviceId) {
        const scope = pingScopeIdentity(owner, deviceId);
        if (scope)
            this.entries.delete(scope.key);
    }
}
exports.ActiveSyncPingConfigCache = ActiveSyncPingConfigCache;
class ActiveSyncPingAbortedError extends Error {
    constructor(message = 'ActiveSync Ping was aborted') {
        super(message);
        this.name = 'ActiveSyncPingAbortedError';
    }
}
exports.ActiveSyncPingAbortedError = ActiveSyncPingAbortedError;
class ActiveSyncPingSupersededError extends ActiveSyncPingAbortedError {
    constructor() {
        super('ActiveSync Ping was superseded by a newer request');
        this.name = 'ActiveSyncPingSupersededError';
    }
}
exports.ActiveSyncPingSupersededError = ActiveSyncPingSupersededError;
class ActiveSyncPingWaitRegistry {
    waits = new Map();
    currentByScope = new Map();
    latestActivatedGenerationByScope = new Map();
    nextGeneration = 1;
    maxActive;
    maxActivePerOwner;
    maxActivePerScope;
    constructor(options = {}) {
        this.maxActive = options.maxActive ?? exports.ACTIVE_SYNC_PING_MAX_ACTIVE_WAITS;
        this.maxActivePerOwner = options.maxActivePerOwner
            ?? Math.min(exports.ACTIVE_SYNC_PING_MAX_ACTIVE_WAITS_PER_OWNER, this.maxActive);
        this.maxActivePerScope = options.maxActivePerScope
            ?? Math.min(exports.ACTIVE_SYNC_PING_MAX_ACTIVE_WAITS_PER_SCOPE, this.maxActivePerOwner);
        if (!Number.isInteger(this.maxActive) || this.maxActive < 1
            || !Number.isInteger(this.maxActivePerOwner) || this.maxActivePerOwner < 1
            || this.maxActivePerOwner > this.maxActive
            || !Number.isInteger(this.maxActivePerScope) || this.maxActivePerScope < 1
            || this.maxActivePerScope > this.maxActivePerOwner) {
            throw new Error('Invalid ActiveSync Ping wait bounds');
        }
    }
    get activeCount() {
        return this.waits.size;
    }
    reserve(owner, deviceId) {
        const scope = pingScopeIdentity(owner, deviceId);
        if (!scope)
            return null;
        const ownerWaits = Array.from(this.waits.values())
            .filter(wait => wait.ownerHash === scope.ownerHash).length;
        const scopeWaits = Array.from(this.waits.values())
            .filter(wait => wait.scopeKey === scope.key).length;
        if (this.waits.size >= this.maxActive
            || ownerWaits >= this.maxActivePerOwner
            || scopeWaits >= this.maxActivePerScope)
            return null;
        const token = Symbol('active-sync-ping-wait');
        const controller = new AbortController();
        const generation = this.nextGeneration++;
        this.waits.set(token, {
            scopeKey: scope.key,
            ownerHash: scope.ownerHash,
            token,
            controller,
            active: false,
            generation,
        });
        let released = false;
        let activated = false;
        const release = () => {
            if (released)
                return;
            released = true;
            this.waits.delete(token);
            if (this.currentByScope.get(scope.key) === token)
                this.currentByScope.delete(scope.key);
            if (!Array.from(this.waits.values()).some(wait => wait.scopeKey === scope.key)) {
                this.latestActivatedGenerationByScope.delete(scope.key);
            }
        };
        const abort = (reason) => controller.abort(reason ?? new ActiveSyncPingAbortedError());
        return {
            signal: controller.signal,
            abort,
            release,
            activate: () => {
                if (released || activated || controller.signal.aborted) {
                    release();
                    return null;
                }
                activated = true;
                if (generation < (this.latestActivatedGenerationByScope.get(scope.key) || 0)) {
                    release();
                    return null;
                }
                const previousToken = this.currentByScope.get(scope.key);
                const previous = previousToken ? this.waits.get(previousToken) : undefined;
                previous?.controller.abort(new ActiveSyncPingSupersededError());
                const entry = this.waits.get(token);
                if (!entry)
                    return null;
                entry.active = true;
                this.latestActivatedGenerationByScope.set(scope.key, generation);
                this.currentByScope.set(scope.key, token);
                return { signal: controller.signal, abort, release };
            },
        };
    }
    acquire(owner, deviceId) {
        return this.reserve(owner, deviceId)?.activate() || null;
    }
    abortAll(reason = new ActiveSyncPingAbortedError('ActiveSync Ping service is stopping')) {
        for (const wait of this.waits.values())
            wait.controller.abort(reason);
    }
}
exports.ActiveSyncPingWaitRegistry = ActiveSyncPingWaitRegistry;
function activeSyncPingHasAdditions(knownItemIds, currentItemIds, maximumItems) {
    if (!Number.isInteger(maximumItems) || maximumItems < 1
        || !Array.isArray(knownItemIds) || knownItemIds.length > maximumItems
        || !Array.isArray(currentItemIds) || currentItemIds.length > maximumItems) {
        throw new Error('ActiveSync Ping item set exceeds its collection bound');
    }
    const known = new Set();
    for (const id of knownItemIds) {
        if (typeof id !== 'string' || Buffer.byteLength(id, 'utf8') < 1
            || Buffer.byteLength(id, 'utf8') > 128 || known.has(id)) {
            throw new Error('ActiveSync Ping known item set is malformed');
        }
        known.add(id);
    }
    const current = new Set();
    let hasAdditions = false;
    for (const id of currentItemIds) {
        if (typeof id !== 'string' || Buffer.byteLength(id, 'utf8') < 1
            || Buffer.byteLength(id, 'utf8') > 128 || current.has(id)) {
            throw new Error('ActiveSync Ping current item set is malformed');
        }
        current.add(id);
        if (!known.has(id))
            hasAdditions = true;
    }
    return hasAdditions;
}
function activeSyncPingMailCursorNeedsSnapshot(syncModseq, liveModseq, lastProbedModseq) {
    if (!/^\d+$/.test(syncModseq) || !/^\d+$/.test(liveModseq)
        || lastProbedModseq !== undefined && !/^\d+$/.test(lastProbedModseq)) {
        throw new Error('ActiveSync Ping mailbox cursor is malformed');
    }
    return liveModseq === '0' || liveModseq !== syncModseq && liveModseq !== lastProbedModseq;
}
async function evaluateActiveSyncPingChanges(folders, signal, loadSnapshots) {
    if (signal?.aborted)
        throw new ActiveSyncPingAbortedError();
    const snapshots = await loadSnapshots(folders.map(folder => ({ ...folder })), signal);
    if (signal?.aborted)
        throw new ActiveSyncPingAbortedError();
    if (!Array.isArray(snapshots) || snapshots.length !== folders.length) {
        throw new Error('ActiveSync Ping snapshot set is incomplete');
    }
    const byFolder = new Map();
    for (const snapshot of snapshots) {
        if (!snapshot || typeof snapshot.folderId !== 'string' || byFolder.has(snapshot.folderId)
            || typeof snapshot.exists !== 'boolean'
            || typeof snapshot.initialized !== 'boolean'
            || typeof snapshot.hasAdditions !== 'boolean') {
            throw new Error('ActiveSync Ping snapshot is malformed');
        }
        byFolder.set(snapshot.folderId, snapshot);
    }
    const changed = [];
    for (const folder of folders) {
        const snapshot = byFolder.get(folder.id);
        if (!snapshot)
            throw new Error('ActiveSync Ping snapshot folder is unexpected');
        if (!snapshot.exists)
            return { kind: 'hierarchy' };
        if (!snapshot.initialized || snapshot.hasAdditions)
            changed.push(folder.id);
    }
    return changed.length ? { kind: 'changed', folderIds: changed } : { kind: 'none' };
}
const defaultPingScheduler = {
    now: () => node_perf_hooks_1.performance.now(),
    setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimeout: timer => clearTimeout(timer),
};
function startActiveSyncPingWait(options) {
    const scheduler = options.scheduler ?? defaultPingScheduler;
    const pollIntervalMs = options.pollIntervalMs ?? exports.ACTIVE_SYNC_PING_POLL_INTERVAL_MS;
    if (!Number.isInteger(options.heartbeatSeconds)
        || options.heartbeatSeconds < exports.ACTIVE_SYNC_PING_MIN_HEARTBEAT_SECONDS
        || options.heartbeatSeconds > exports.ACTIVE_SYNC_PING_MAX_HEARTBEAT_SECONDS
        || !Array.isArray(options.folders) || options.folders.length < 1
        || options.folders.length > exports.ACTIVE_SYNC_PING_MAX_FOLDERS
        || !Number.isInteger(pollIntervalMs) || pollIntervalMs < 1_000) {
        return {
            response: Promise.resolve({ status: '8' }),
            drained: Promise.resolve(),
        };
    }
    const monitored = new Set(options.folders.map(folder => folder.id));
    if (monitored.size !== options.folders.length) {
        return {
            response: Promise.resolve({ status: '8' }),
            drained: Promise.resolve(),
        };
    }
    const deadline = scheduler.now() + options.heartbeatSeconds * 1000;
    let resolveDrained;
    const drained = new Promise(resolve => { resolveDrained = resolve; });
    const probeController = new AbortController();
    let responseSettled = false;
    let inFlightPolls = 0;
    let pollTimer = null;
    let deadlineTimer = null;
    const response = new Promise((resolve, reject) => {
        let settled = false;
        const maybeDrain = () => {
            if (responseSettled && inFlightPolls === 0
                && pollTimer === null && deadlineTimer === null)
                resolveDrained();
        };
        const cleanup = () => {
            if (pollTimer !== null)
                scheduler.clearTimeout(pollTimer);
            if (deadlineTimer !== null)
                scheduler.clearTimeout(deadlineTimer);
            pollTimer = null;
            deadlineTimer = null;
            options.signal?.removeEventListener('abort', onAbort);
            responseSettled = true;
            maybeDrain();
        };
        const finish = (response) => {
            if (settled)
                return;
            settled = true;
            cleanup();
            resolve(response);
        };
        const fail = (error) => {
            if (settled)
                return;
            settled = true;
            cleanup();
            reject(error);
        };
        const onAbort = () => {
            const reason = options.signal?.reason;
            const error = reason instanceof ActiveSyncPingAbortedError
                ? reason
                : new ActiveSyncPingAbortedError();
            probeController.abort(error);
            fail(error);
        };
        const onDeadline = () => {
            deadlineTimer = null;
            finish({ status: inFlightPolls > 0 ? '8' : '1' });
            probeController.abort(new ActiveSyncPingAbortedError('ActiveSync Ping heartbeat expired'));
        };
        const poll = async () => {
            if (settled)
                return;
            let result;
            inFlightPolls += 1;
            try {
                result = await options.poll(options.folders.map(folder => ({ ...folder })), probeController.signal);
            }
            catch {
                if (!settled)
                    finish({ status: '8' });
                return;
            }
            finally {
                inFlightPolls -= 1;
                maybeDrain();
            }
            if (settled)
                return;
            if (result?.kind === 'hierarchy') {
                finish({ status: '7' });
                return;
            }
            if (result?.kind === 'changed') {
                const changed = new Set(result.folderIds);
                if (changed.size < 1 || result.folderIds.some(id => !monitored.has(id))) {
                    finish({ status: '8' });
                    return;
                }
                finish({
                    status: '2',
                    folders: options.folders.filter(folder => changed.has(folder.id)).map(folder => folder.id),
                });
                return;
            }
            if (result?.kind !== 'none') {
                finish({ status: '8' });
                return;
            }
            const remaining = deadline - scheduler.now();
            if (remaining <= 0) {
                finish({ status: '1' });
                return;
            }
            pollTimer = scheduler.setTimeout(() => {
                pollTimer = null;
                void poll();
            }, Math.min(pollIntervalMs, remaining));
        };
        if (options.signal?.aborted) {
            onAbort();
            return;
        }
        options.signal?.addEventListener('abort', onAbort, { once: true });
        deadlineTimer = scheduler.setTimeout(onDeadline, options.heartbeatSeconds * 1000);
        void poll();
    });
    return { response, drained };
}
function waitForActiveSyncPing(options) {
    return startActiveSyncPingWait(options).response;
}
const hasContent = (node) => node.content !== undefined && node.content !== null;
const isLeaf = (node, tag) => node.tag === tag && node.page === 13 && hasContent(node) && !node.children?.length;
const safeText = (node, maxBytes) => {
    if (typeof node.content !== 'string')
        return null;
    if (Buffer.byteLength(node.content, 'utf8') < 1 || Buffer.byteLength(node.content, 'utf8') > maxBytes)
        return null;
    if (/[\u0000-\u001f\u007f]/.test(node.content))
        return null;
    return node.content;
};
const parseHeartbeat = (node) => {
    if (!isLeaf(node, 'HeartbeatInterval') || typeof node.content !== 'string') {
        return { ok: false, response: { status: '4' } };
    }
    const value = node.content.trim();
    if (!/^[+-]?[0-9]+$/.test(value)) {
        return { ok: false, response: { status: '4' } };
    }
    const negative = value.startsWith('-');
    const digits = value.replace(/^[+-]/, '').replace(/^0+/, '') || '0';
    if (negative || digits.length < 2
        || (digits.length === 2 && digits < String(exports.ACTIVE_SYNC_PING_MIN_HEARTBEAT_SECONDS))) {
        return {
            ok: false,
            response: { status: '5', heartbeatSeconds: exports.ACTIVE_SYNC_PING_MIN_HEARTBEAT_SECONDS },
        };
    }
    if (digits.length > 3
        || (digits.length === 3 && digits > String(exports.ACTIVE_SYNC_PING_MAX_HEARTBEAT_SECONDS))) {
        return {
            ok: false,
            response: { status: '5', heartbeatSeconds: exports.ACTIVE_SYNC_PING_MAX_HEARTBEAT_SECONDS },
        };
    }
    return Number(digits);
};
const parseFolders = (node) => {
    if (node.tag !== 'Folders' || node.page !== 13 || hasContent(node)
        || !Array.isArray(node.children) || node.children.length < 1) {
        return { ok: false, response: { status: '4' } };
    }
    const folders = [];
    const seen = new Set();
    for (const folder of node.children) {
        if (folder.tag !== 'Folder' || folder.page !== 13 || hasContent(folder)
            || !Array.isArray(folder.children) || folder.children.length !== 2) {
            return { ok: false, response: { status: '4' } };
        }
        const idNodes = folder.children.filter(child => child.tag === 'Id');
        const classNodes = folder.children.filter(child => child.tag === 'Class');
        if (idNodes.length !== 1 || classNodes.length !== 1
            || !isLeaf(idNodes[0], 'Id') || !isLeaf(classNodes[0], 'Class')) {
            return { ok: false, response: { status: '4' } };
        }
        const [idNode] = idNodes;
        const [classNode] = classNodes;
        const id = safeText(idNode, 64);
        const className = safeText(classNode, 16);
        if (!id || !className || !['Email', 'Calendar', 'Contacts'].includes(className) || seen.has(id)) {
            return { ok: false, response: { status: '4' } };
        }
        seen.add(id);
        folders.push({ id, className: className });
    }
    if (folders.length > exports.ACTIVE_SYNC_PING_MAX_FOLDERS) {
        return {
            ok: false,
            response: { status: '6', maxFolders: exports.ACTIVE_SYNC_PING_MAX_FOLDERS },
        };
    }
    return folders;
};
function parseActiveSyncPingRequest(decoded, cached) {
    if (!decoded) {
        return cached
            ? {
                ok: true,
                config: {
                    heartbeatSeconds: cached.heartbeatSeconds,
                    folders: cached.folders.map(folder => ({ ...folder })),
                },
            }
            : { ok: false, response: { status: '3' } };
    }
    if (decoded.tag !== 'Ping' || decoded.page !== 13 || hasContent(decoded)
        || !Array.isArray(decoded.children)) {
        return { ok: false, response: { status: '4' } };
    }
    if (decoded.children.length < 1)
        return { ok: false, response: { status: '3' } };
    const heartbeatNodes = decoded.children.filter(node => node.tag === 'HeartbeatInterval');
    const folderNodes = decoded.children.filter(node => node.tag === 'Folders');
    if (heartbeatNodes.length > 1 || folderNodes.length > 1
        || heartbeatNodes.length + folderNodes.length !== decoded.children.length) {
        return { ok: false, response: { status: '4' } };
    }
    let heartbeatSeconds = cached?.heartbeatSeconds;
    if (heartbeatNodes.length === 1) {
        const heartbeat = parseHeartbeat(heartbeatNodes[0]);
        if (typeof heartbeat !== 'number')
            return heartbeat;
        heartbeatSeconds = heartbeat;
    }
    let folders = cached?.folders;
    if (folderNodes.length === 1) {
        const parsedFolders = parseFolders(folderNodes[0]);
        if (!Array.isArray(parsedFolders))
            return parsedFolders;
        folders = parsedFolders;
    }
    if (!heartbeatSeconds || !folders?.length)
        return { ok: false, response: { status: '3' } };
    return {
        ok: true,
        config: { heartbeatSeconds, folders: folders.map(folder => ({ ...folder })) },
    };
}
const validResolvedFolder = (folder) => {
    if (folder.kind === 'contacts') {
        return folder.id === 'contacts' && folder.className === 'Contacts';
    }
    if (folder.kind === 'calendar') {
        return folder.className === 'Calendar' && Number.isSafeInteger(folder.calendarId)
            && folder.calendarId > 0 && folder.id === `cal-${folder.calendarId}`;
    }
    return folder.className === 'Email' && /^m-[0-9a-f]{62}$/.test(folder.id)
        && Buffer.byteLength(folder.folderPath, 'utf8') >= 1
        && Buffer.byteLength(folder.folderPath, 'utf8') <= 512
        && !/[\u0000-\u001f\u007f]/.test(folder.folderPath);
};
function resolveActiveSyncPingFolders(requested, available) {
    const byId = new Map();
    for (const folder of available) {
        if (!validResolvedFolder(folder) || byId.has(folder.id)) {
            return { ok: false, response: { status: '8' } };
        }
        byId.set(folder.id, folder);
    }
    const folders = [];
    for (const requestedFolder of requested) {
        const resolved = byId.get(requestedFolder.id);
        if (!resolved)
            return { ok: false, response: { status: '7' } };
        if (resolved.className !== requestedFolder.className) {
            return { ok: false, response: { status: '4' } };
        }
        folders.push({ ...resolved });
    }
    return { ok: true, folders };
}
function activeSyncPingResponseNode(response) {
    return {
        tag: 'Ping',
        page: 13,
        children: [
            { tag: 'Status', page: 13, content: response.status, children: [] },
            ...(response.status === '2' ? [{
                    tag: 'Folders',
                    page: 13,
                    children: response.folders.map(id => ({ tag: 'Folder', page: 13, content: id, children: [] })),
                }] : []),
            ...(response.status === '5'
                ? [{ tag: 'HeartbeatInterval', page: 13, content: String(response.heartbeatSeconds), children: [] }]
                : []),
            ...(response.status === '6'
                ? [{ tag: 'MaxFolders', page: 13, content: String(response.maxFolders), children: [] }]
                : []),
        ],
    };
}
//# sourceMappingURL=eas-ping.js.map