"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ruleRunPreviewSelectionStore = exports.RuleRunPreviewSelectionStore = exports.parseRuleRunMessageSelection = exports.MAX_RULE_RUN_STORED_PREVIEW_MESSAGES_PER_OWNER = exports.MAX_RULE_RUN_STORED_PREVIEW_MESSAGES = exports.MAX_RULE_RUN_PREVIEW_MESSAGES = exports.MAX_RULE_RUN_PREVIEW_SELECTION_ENTRIES_PER_OWNER = exports.MAX_RULE_RUN_PREVIEW_SELECTION_ENTRIES = exports.RULE_RUN_PREVIEW_SELECTION_TTL_MS = exports.RuleRunPreviewSelectionUnavailableError = void 0;
const crypto_1 = __importDefault(require("crypto"));
class RuleRunPreviewSelectionUnavailableError extends Error {
    constructor() {
        super('The selected rule run expired before messages could be applied.');
        this.name = 'RuleRunPreviewSelectionUnavailableError';
    }
}
exports.RuleRunPreviewSelectionUnavailableError = RuleRunPreviewSelectionUnavailableError;
exports.RULE_RUN_PREVIEW_SELECTION_TTL_MS = 30 * 60 * 1000;
exports.MAX_RULE_RUN_PREVIEW_SELECTION_ENTRIES = 128;
exports.MAX_RULE_RUN_PREVIEW_SELECTION_ENTRIES_PER_OWNER = 32;
exports.MAX_RULE_RUN_PREVIEW_MESSAGES = 100000;
exports.MAX_RULE_RUN_STORED_PREVIEW_MESSAGES = 250000;
exports.MAX_RULE_RUN_STORED_PREVIEW_MESSAGES_PER_OWNER = 150000;
const parseRuleRunMessageSelection = (value, limits) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const candidate = value;
    if (candidate.mode !== 'allExcept' && candidate.mode !== 'only')
        return null;
    if (!Array.isArray(candidate.groups) || candidate.groups.length > limits.maxGroups)
        return null;
    const messages = [];
    const folders = new Set();
    let messageCount = 0;
    for (const rawGroup of candidate.groups) {
        if (!rawGroup || typeof rawGroup !== 'object' || Array.isArray(rawGroup))
            return null;
        const group = rawGroup;
        if (typeof group.folder !== 'string'
            || !group.folder
            || group.folder.length > 512
            || /[\u0000-\u001f\u007f]/.test(group.folder)
            || folders.has(group.folder)
            || !Array.isArray(group.uids)
            || group.uids.length < 1
            || group.uids.length > limits.maxMessages - messageCount)
            return null;
        const uids = new Set();
        for (const rawUid of group.uids) {
            if (typeof rawUid !== 'number'
                || !Number.isInteger(rawUid)
                || rawUid < 1
                || rawUid > 0xffffffff
                || uids.has(rawUid))
                return null;
            uids.add(rawUid);
            messages.push({ folder: group.folder, uid: rawUid });
        }
        folders.add(group.folder);
        messageCount += group.uids.length;
    }
    return { mode: candidate.mode, messages };
};
exports.parseRuleRunMessageSelection = parseRuleRunMessageSelection;
const addMessages = (target, messages) => {
    let added = 0;
    for (const message of messages) {
        let folderUids = target.get(message.folder);
        if (!folderUids) {
            folderUids = new Set();
            target.set(message.folder, folderUids);
        }
        const sizeBefore = folderUids.size;
        folderUids.add(message.uid);
        if (folderUids.size > sizeBefore)
            added += 1;
    }
    return added;
};
const hasMessage = (messagesByFolder, folder, uid) => messagesByFolder.get(folder)?.has(uid) === true;
const sameMessages = (left, right) => {
    if (left.size !== right.size)
        return false;
    for (const [folder, leftUids] of left) {
        const rightUids = right.get(folder);
        if (!rightUids || leftUids.size !== rightUids.size)
            return false;
        for (const uid of leftUids) {
            if (!rightUids.has(uid))
                return false;
        }
    }
    return true;
};
const invertMessages = (source, excluded) => {
    const messagesByFolder = new Map();
    let messageCount = 0;
    for (const [folder, sourceUids] of source) {
        const excludedUids = excluded.get(folder);
        for (const uid of sourceUids) {
            if (excludedUids?.has(uid))
                continue;
            let folderUids = messagesByFolder.get(folder);
            if (!folderUids) {
                folderUids = new Set();
                messagesByFolder.set(folder, folderUids);
            }
            folderUids.add(uid);
            messageCount += 1;
        }
    }
    return { messagesByFolder, messageCount };
};
class RuleRunPreviewSelectionStore {
    entries = new Map();
    ttlMs;
    maxEntries;
    maxEntriesPerOwner;
    maxMessagesPerEntry;
    maxStoredMessages;
    maxStoredMessagesPerOwner;
    now;
    createToken;
    constructor(options = {}) {
        this.ttlMs = options.ttlMs ?? exports.RULE_RUN_PREVIEW_SELECTION_TTL_MS;
        this.maxEntries = options.maxEntries ?? exports.MAX_RULE_RUN_PREVIEW_SELECTION_ENTRIES;
        this.maxEntriesPerOwner = Math.min(options.maxEntriesPerOwner ?? exports.MAX_RULE_RUN_PREVIEW_SELECTION_ENTRIES_PER_OWNER, this.maxEntries);
        this.maxMessagesPerEntry = options.maxMessagesPerEntry ?? exports.MAX_RULE_RUN_PREVIEW_MESSAGES;
        this.maxStoredMessages = options.maxStoredMessages ?? exports.MAX_RULE_RUN_STORED_PREVIEW_MESSAGES;
        this.maxStoredMessagesPerOwner = Math.min(options.maxStoredMessagesPerOwner ?? exports.MAX_RULE_RUN_STORED_PREVIEW_MESSAGES_PER_OWNER, this.maxStoredMessages);
        this.now = options.now ?? (() => Date.now());
        this.createToken = options.createToken ?? (() => crypto_1.default.randomBytes(24).toString('base64url'));
    }
    deleteEntry(token) {
        const entry = this.entries.get(token);
        entry?.inFlightApply?.resolve({
            status: 409,
            response: {
                success: false,
                error: 'The selected rule run expired before its result was recorded. Review the mailbox before trying again.',
            },
        });
        this.entries.delete(token);
    }
    pruneExpired() {
        const now = this.now();
        for (const [token, entry] of this.entries) {
            if (entry.expiresAt <= now)
                this.deleteEntry(token);
        }
    }
    storedMessageCount(owner) {
        let count = 0;
        for (const entry of this.entries.values()) {
            if (owner && entry.owner !== owner)
                continue;
            count += entry.matchedCount + (entry.selection?.messageCount || 0);
        }
        return count;
    }
    evictOldest(exceptToken, owner) {
        for (const [token, entry] of this.entries) {
            if (token === exceptToken)
                continue;
            if (owner && entry.owner !== owner)
                continue;
            const protectedEntry = !entry.complete
                || Boolean(entry.selection && !entry.applyComplete)
                || Boolean(entry.applyComplete && entry.lastApplyResult);
            if (protectedEntry)
                continue;
            this.deleteEntry(token);
            return true;
        }
        return false;
    }
    getEntry(token, owner, binding) {
        this.pruneExpired();
        const entry = this.entries.get(token);
        if (!entry || entry.owner !== owner || entry.binding !== binding)
            return null;
        entry.expiresAt = this.now() + this.ttlMs;
        return entry;
    }
    create(owner, binding) {
        this.pruneExpired();
        const ownerEntryCount = () => Array.from(this.entries.values())
            .filter(entry => entry.owner === owner).length;
        while (ownerEntryCount() >= this.maxEntriesPerOwner) {
            if (!this.evictOldest(undefined, owner))
                return null;
        }
        while (this.entries.size >= this.maxEntries) {
            if (!this.evictOldest())
                return null;
        }
        let token = this.createToken();
        while (this.entries.has(token))
            token = this.createToken();
        this.entries.set(token, {
            owner,
            binding,
            expiresAt: this.now() + this.ttlMs,
            matchedByFolder: new Map(),
            actionableByFolder: new Map(),
            matchedCount: 0,
            complete: false,
            applyComplete: false,
        });
        return token;
    }
    state(token, owner, binding) {
        const entry = this.getEntry(token, owner, binding);
        return entry ? {
            complete: entry.complete,
            applyStarted: Boolean(entry.selection),
            applyComplete: entry.applyComplete,
            matchedCount: entry.matchedCount,
        } : null;
    }
    append(token, owner, binding, matchedMessages, actionableMessages) {
        const entry = this.getEntry(token, owner, binding);
        if (!entry || entry.complete || entry.selection)
            return false;
        const batchMatchedByFolder = new Map();
        addMessages(batchMatchedByFolder, matchedMessages);
        if (actionableMessages.some(message => (!hasMessage(batchMatchedByFolder, message.folder, message.uid)
            && !hasMessage(entry.matchedByFolder, message.folder, message.uid))))
            return false;
        const additions = [];
        for (const [folder, uids] of batchMatchedByFolder) {
            for (const uid of uids) {
                if (!hasMessage(entry.matchedByFolder, folder, uid))
                    additions.push({ folder, uid });
            }
        }
        if (entry.matchedCount + additions.length > this.maxMessagesPerEntry)
            return false;
        while (this.storedMessageCount(owner) + additions.length > this.maxStoredMessagesPerOwner
            && this.evictOldest(token, owner)) { }
        if (this.storedMessageCount(owner) + additions.length > this.maxStoredMessagesPerOwner) {
            return false;
        }
        while (this.storedMessageCount() + additions.length > this.maxStoredMessages
            && this.evictOldest(token)) { }
        if (this.storedMessageCount() + additions.length > this.maxStoredMessages)
            return false;
        entry.matchedCount += addMessages(entry.matchedByFolder, matchedMessages);
        addMessages(entry.actionableByFolder, actionableMessages);
        return true;
    }
    markPreviewComplete(token, owner, binding) {
        const entry = this.getEntry(token, owner, binding);
        if (!entry || entry.selection)
            return false;
        entry.complete = true;
        return true;
    }
    containsMatched(token, owner, binding, folder, uid) {
        const entry = this.getEntry(token, owner, binding);
        return Boolean(entry?.complete && hasMessage(entry.matchedByFolder, folder, uid));
    }
    containsActionable(token, owner, binding, folder, uid) {
        const entry = this.getEntry(token, owner, binding);
        return Boolean(entry?.complete && hasMessage(entry.actionableByFolder, folder, uid));
    }
    beginApply(token, owner, binding, mode, messages) {
        const entry = this.getEntry(token, owner, binding);
        if (!entry?.complete || entry.applyComplete)
            return false;
        if (messages.some(message => !hasMessage(entry.actionableByFolder, message.folder, message.uid))) {
            return false;
        }
        let normalizedMode = mode;
        let messagesByFolder = new Map();
        let messageCount = addMessages(messagesByFolder, messages);
        if (messageCount !== messages.length || messageCount > this.maxMessagesPerEntry)
            return false;
        let actionableCount = 0;
        for (const uids of entry.actionableByFolder.values())
            actionableCount += uids.size;
        if (messageCount > actionableCount - messageCount) {
            normalizedMode = mode === 'only' ? 'allExcept' : 'only';
            ({ messagesByFolder, messageCount } = invertMessages(entry.actionableByFolder, messagesByFolder));
        }
        if (entry.selection) {
            return entry.selection.mode === normalizedMode
                && entry.selection.messageCount === messageCount
                && sameMessages(entry.selection.messagesByFolder, messagesByFolder);
        }
        while (this.storedMessageCount(owner) + messageCount > this.maxStoredMessagesPerOwner
            && this.evictOldest(token, owner)) { }
        if (this.storedMessageCount(owner) + messageCount > this.maxStoredMessagesPerOwner) {
            return false;
        }
        while (this.storedMessageCount() + messageCount > this.maxStoredMessages
            && this.evictOldest(token)) { }
        if (this.storedMessageCount() + messageCount > this.maxStoredMessages)
            return false;
        entry.selection = { mode: normalizedMode, messagesByFolder, messageCount };
        return true;
    }
    createApplySelector(token, owner, binding) {
        const entry = this.getEntry(token, owner, binding);
        if (!entry?.complete || !entry.selection || entry.applyComplete)
            return null;
        const selection = entry.selection;
        return (folder, uid) => {
            if (this.entries.get(token) !== entry || entry.applyComplete) {
                throw new RuleRunPreviewSelectionUnavailableError();
            }
            if (!hasMessage(entry.actionableByFolder, folder, uid))
                return false;
            const listed = hasMessage(selection.messagesByFolder, folder, uid);
            return selection.mode === 'only' ? listed : !listed;
        };
    }
    isSelected(token, owner, binding, folder, uid) {
        return this.createApplySelector(token, owner, binding)?.(folder, uid) === true;
    }
    assertApplyActive(token, owner, binding) {
        const entry = this.getEntry(token, owner, binding);
        if (!entry?.complete || !entry.selection || entry.applyComplete) {
            throw new RuleRunPreviewSelectionUnavailableError();
        }
    }
    claimApplyRequest(token, owner, binding, requestKey) {
        const entry = this.getEntry(token, owner, binding);
        if (!entry)
            return { kind: 'unavailable' };
        if (entry.lastApplyResult?.requestKey === requestKey) {
            return { kind: 'replay', result: entry.lastApplyResult.result };
        }
        if (entry.inFlightApply) {
            return entry.inFlightApply.requestKey === requestKey
                ? { kind: 'pending', result: entry.inFlightApply.result }
                : { kind: 'unavailable' };
        }
        if (!entry.complete || !entry.selection || entry.applyComplete) {
            return { kind: 'unavailable' };
        }
        let resolve;
        const result = new Promise(resolveResult => {
            resolve = resolveResult;
        });
        entry.inFlightApply = { requestKey, result, resolve };
        return { kind: 'claimed' };
    }
    finishApplyRequest(token, owner, binding, requestKey, result, options) {
        const entry = this.getEntry(token, owner, binding);
        if (!entry?.inFlightApply || entry.inFlightApply.requestKey !== requestKey)
            return false;
        const resolve = entry.inFlightApply.resolve;
        entry.inFlightApply = undefined;
        if (options.retain)
            entry.lastApplyResult = { requestKey, result };
        if (options.applyComplete) {
            entry.applyComplete = true;
            entry.matchedByFolder.clear();
            entry.actionableByFolder.clear();
            entry.matchedCount = 0;
            entry.selection?.messagesByFolder.clear();
            entry.selection = undefined;
        }
        resolve(result);
        return true;
    }
    replayApplyResult(token, owner, binding, requestKey) {
        const entry = this.getEntry(token, owner, binding);
        const recorded = entry?.lastApplyResult;
        return recorded?.requestKey === requestKey ? recorded.result : null;
    }
}
exports.RuleRunPreviewSelectionStore = RuleRunPreviewSelectionStore;
exports.ruleRunPreviewSelectionStore = new RuleRunPreviewSelectionStore();
//# sourceMappingURL=rule-run-preview-selection.js.map