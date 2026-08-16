"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImapService = exports.RuleMoveApplyError = void 0;
const crypto_1 = __importDefault(require("crypto"));
const imapflow_1 = require("imapflow");
const config_1 = require("./config");
class RuleMoveApplyError extends Error {
    result;
    retrySafe;
    pendingCopies;
    constructor(result, cause, retrySafe = true, pendingCopies = []) {
        super(retrySafe
            ? 'A mailbox operation interrupted the rule run. Apply again to reconcile safely, then run a new preview.'
            : 'A copy operation was interrupted and was not repeated to prevent duplicate mail. Check the preview destinations, then run a new preview.');
        this.result = result;
        this.retrySafe = retrySafe;
        this.pendingCopies = pendingCopies;
        this.name = 'RuleMoveApplyError';
        this.cause = cause;
    }
}
exports.RuleMoveApplyError = RuleMoveApplyError;
class ImapService {
    client;
    constructor(user, pass, useMasterCredentials = true) {
        const masterUser = useMasterCredentials ? config_1.imapConfig.masterUser : '';
        const masterPass = useMasterCredentials ? config_1.imapConfig.masterPass : '';
        const authUser = (masterUser && masterPass) ? `${user}*${masterUser}` : user;
        const authPass = (masterUser && masterPass) ? masterPass : pass;
        this.client = new imapflow_1.ImapFlow({
            host: config_1.imapConfig.host,
            port: config_1.imapConfig.port,
            secure: config_1.imapConfig.secure,
            tls: {
                rejectUnauthorized: config_1.imapConfig.rejectUnauthorized,
                checkServerIdentity: () => undefined
            },
            auth: { user: authUser, pass: authPass },
            logger: false
        });
    }
    async connect() {
        await this.client.connect();
    }
    async logout() {
        await this.client.logout();
    }
    close() {
        this.client.close();
    }
    async getFolders() {
        const folders = await this.client.list({ statusQuery: { unseen: true } });
        return folders.map(f => ({
            path: f.path,
            delimiter: f.delimiter,
            unseen: Number(f.status?.unseen || 0),
        }));
    }
    async getMessageIdentities(folderPath) {
        const mailbox = await this.client.mailboxOpen(folderPath);
        const messages = [];
        try {
            if (mailbox.exists === 0)
                return messages;
            for await (const message of this.client.fetch('1:*', {
                envelope: true,
                uid: true,
                flags: true,
            })) {
                messages.push({
                    uid: message.uid,
                    flags: Array.from(message.flags || []),
                    envelope: message.envelope,
                });
            }
            return messages;
        }
        finally {
            await this.client.mailboxClose();
        }
    }
    async getSearchFolderSnapshot() {
        const folders = await this.client.list({
            statusQuery: { uidNext: true, uidValidity: true },
        });
        const folderPaths = [];
        const uidNextByFolder = new Map();
        const uidValidityByFolder = new Map();
        const failedFolders = [];
        for (const folder of folders) {
            if (folder.flags?.has('\\Noselect'))
                continue;
            folderPaths.push(folder.path);
            const uidNext = Number(folder.status?.uidNext || 0);
            const uidValidity = String(folder.status?.uidValidity || '');
            if (uidNext > 0 && uidValidity) {
                uidNextByFolder.set(folder.path, uidNext);
                uidValidityByFolder.set(folder.path, uidValidity);
            }
            else {
                failedFolders.push(folder.path);
            }
        }
        return { folderPaths, uidNextByFolder, uidValidityByFolder, failedFolders };
    }
    async getMessages(folderPath, minUid, fetchOlderThan) {
        const mbx = await this.client.mailboxOpen(folderPath);
        const messages = [];
        const count = mbx.exists;
        const currentUidNext = mbx.uidNext;
        const highestModseq = mbx.highestModseq ? mbx.highestModseq.toString() : "0";
        let lowestUid = -1;
        let moreAvailable = false;
        if (count === 0) {
            await this.client.mailboxClose();
            return { messages: [], uidNext: currentUidNext, highestModseq, lowestUid: 0, moreAvailable: false };
        }
        if (minUid && minUid > 0) {
            // Forward sync: Fetch new messages
            let sequence = `${minUid}:*`;
            for await (let msg of this.client.fetch(sequence, { envelope: true, source: true, uid: true, flags: true }, { uid: true })) {
                if (msg.uid >= minUid) {
                    messages.push({
                        uid: msg.uid,
                        flags: Array.from(msg.flags || []),
                        envelope: msg.envelope,
                        source: msg.source
                    });
                }
            }
        }
        else if (fetchOlderThan && fetchOlderThan > 1) {
            // Backward sync: Fetch older messages for pagination
            const uids = await this.client.search({ uid: `1:${fetchOlderThan - 1}` }, { uid: true });
            if (Array.isArray(uids) && uids.length > 0) {
                const batchUids = uids.slice(-25); // Get up to 25 older messages
                lowestUid = Math.min(...batchUids);
                if (uids.length > 25)
                    moreAvailable = true;
                for await (let msg of this.client.fetch(batchUids, { envelope: true, source: true, uid: true, flags: true }, { uid: true })) {
                    messages.push({
                        uid: msg.uid,
                        flags: Array.from(msg.flags || []),
                        envelope: msg.envelope,
                        source: msg.source
                    });
                }
            }
        }
        else {
            // Initial sync: Fetch newest 25 messages
            const start = Math.max(1, count - 24);
            if (start > 1)
                moreAvailable = true;
            for await (let msg of this.client.fetch(`${start}:*`, { envelope: true, source: true, uid: true, flags: true })) {
                messages.push({
                    uid: msg.uid,
                    flags: Array.from(msg.flags || []),
                    envelope: msg.envelope,
                    source: msg.source
                });
            }
        }
        if (lowestUid === -1 && messages.length > 0) {
            lowestUid = Math.min(...messages.map(m => m.uid));
        }
        await this.client.mailboxClose();
        return { messages, uidNext: currentUidNext, highestModseq, lowestUid, moreAvailable };
    }
    async getRuleRunBatch(folderPath, cursor = 0, maxUid, batchSize = 100, includeBody = false) {
        const mbx = await this.client.mailboxOpen(folderPath);
        try {
            const snapshotMaxUid = Number.isInteger(maxUid)
                ? Math.max(0, Number(maxUid))
                : Math.max(0, Number(mbx.uidNext || 1) - 1);
            if (cursor >= snapshotMaxUid) {
                return {
                    messages: [],
                    nextCursor: snapshotMaxUid,
                    maxUid: snapshotMaxUid,
                    uidValidity: String(mbx.uidValidity || ''),
                    done: true,
                };
            }
            const cappedBatchSize = Math.max(1, Math.min(batchSize, 200));
            const scanEnd = Math.min(snapshotMaxUid, cursor + Math.max(200, cappedBatchSize * 4));
            const found = await this.client.search({ uid: `${Math.max(1, cursor + 1)}:${scanEnd}` }, { uid: true });
            const candidates = (Array.isArray(found) ? found : [])
                .filter(uid => uid > cursor && uid <= scanEnd)
                .sort((a, b) => a - b);
            const batchUids = candidates.slice(0, cappedBatchSize);
            const messages = [];
            if (batchUids.length > 0) {
                const fetchQuery = { uid: true, envelope: true, size: true };
                if (includeBody) {
                    fetchQuery.source = { start: 0, maxLength: 1024 * 1024 };
                }
                for await (const message of this.client.fetch(batchUids, fetchQuery, { uid: true })) {
                    const size = Number(message.size || message.source?.length || 0);
                    messages.push({
                        uid: message.uid,
                        envelope: message.envelope,
                        size,
                        source: message.source,
                        sourceComplete: !includeBody || Boolean(message.source && message.source.length >= size),
                    });
                }
            }
            const nextCursor = candidates.length > batchUids.length
                ? batchUids.at(-1) || cursor
                : scanEnd;
            return {
                messages,
                nextCursor,
                maxUid: snapshotMaxUid,
                uidValidity: String(mbx.uidValidity || ''),
                done: nextCursor >= snapshotMaxUid,
            };
        }
        finally {
            await this.client.mailboxClose();
        }
    }
    async applyRuleMoves(folderPath, plans, operationKey, ledger) {
        const affected = new Set();
        const result = { affected: 0, copied: 0, moved: 0, movedUids: [] };
        const normalizedPlans = plans
            .map(plan => ({
            uid: plan.uid,
            destinations: plan.moveFolders
                .filter(destination => destination && destination !== folderPath)
                .reduce((ordered, destination) => ([...ordered.filter(current => current !== destination), destination]), []),
        }))
            .filter(plan => Number.isInteger(plan.uid) && plan.uid > 0 && plan.destinations.length > 0);
        const copyActions = normalizedPlans.flatMap(plan => (plan.destinations.slice(0, -1).map(destination => ({
            actionKey: crypto_1.default
                .createHash('sha256')
                .update(`${operationKey}\0${plan.uid}\0${destination}`)
                .digest('hex'),
            operationKey,
            uid: plan.uid,
            destination,
        }))));
        const actionsByUid = new Map();
        for (const action of copyActions) {
            actionsByUid.set(action.uid, [...(actionsByUid.get(action.uid) || []), action]);
        }
        let mailboxOpen = false;
        let operationError = null;
        try {
            await this.client.mailboxOpen(folderPath);
            mailboxOpen = true;
            const requestedUids = [...new Set(normalizedPlans.map(plan => plan.uid))];
            const found = requestedUids.length > 0
                ? await this.client.search({ uid: requestedUids.join(',') }, { uid: true })
                : [];
            if (!Array.isArray(found))
                throw new Error('Unable to verify rule-run source messages.');
            const existingUids = new Set(found.map(Number));
            const missingUids = requestedUids.filter(uid => !existingUids.has(uid));
            const missingActions = missingUids.flatMap(uid => actionsByUid.get(uid) || []);
            if (missingActions.length > 0)
                await ledger.clear(missingActions);
            result.movedUids.push(...missingUids);
            const pendingCopies = await ledger.pendingForSourceUids([...existingUids]);
            if (pendingCopies.length > 0) {
                pendingCopies.forEach(action => affected.add(action.uid));
                throw new RuleMoveApplyError(result, new Error('A prior copy result is still uncertain.'), false, pendingCopies);
            }
            const existingCopyActions = copyActions.filter(action => existingUids.has(action.uid));
            const copiesByDestination = new Map();
            for (const action of existingCopyActions) {
                copiesByDestination.set(action.destination, [...(copiesByDestination.get(action.destination) || []), action]);
            }
            for (const [destination, actions] of copiesByDestination) {
                const reservation = await ledger.reserve(actions);
                const completed = actions.filter(action => reservation.completed.has(action.actionKey));
                for (const action of completed) {
                    result.copied += 1;
                    affected.add(action.uid);
                }
                if (reservation.blocked.size > 0) {
                    actions.forEach(action => affected.add(action.uid));
                    throw new RuleMoveApplyError(result, new Error('A prior copy result is still uncertain.'), false, reservation.pending);
                }
                const ready = actions.filter(action => reservation.ready.has(action.actionKey));
                if (ready.length === 0)
                    continue;
                ready.forEach(action => affected.add(action.uid));
                let copied;
                try {
                    copied = await this.client.messageCopy(ready.map(action => action.uid).join(','), destination, { uid: true });
                }
                catch (err) {
                    throw new RuleMoveApplyError(result, err, false, ready);
                }
                if (!copied) {
                    throw new RuleMoveApplyError(result, new Error('Unable to confirm a continued rule copy.'), false, ready);
                }
                try {
                    await ledger.complete(ready, reservation.token);
                }
                catch (err) {
                    throw new RuleMoveApplyError(result, err, false, ready);
                }
                result.copied += ready.length;
            }
            const movesByDestination = new Map();
            for (const plan of normalizedPlans) {
                if (!existingUids.has(plan.uid))
                    continue;
                const destination = plan.destinations.at(-1);
                if (!destination)
                    continue;
                movesByDestination.set(destination, [...(movesByDestination.get(destination) || []), plan.uid]);
            }
            for (const [destination, uids] of movesByDestination) {
                try {
                    const moved = await this.client.messageMove(uids.join(','), destination, { uid: true });
                    if (!moved)
                        throw new Error('Unable to move rule-matched messages.');
                    result.moved += uids.length;
                    result.movedUids.push(...uids);
                    uids.forEach(uid => affected.add(uid));
                }
                catch (err) {
                    const remaining = await this.client.search({ uid: uids.join(',') }, { uid: true });
                    if (Array.isArray(remaining)) {
                        const remainingSet = new Set(remaining.map(Number));
                        const reconciled = uids.filter(uid => !remainingSet.has(uid));
                        result.moved += reconciled.length;
                        result.movedUids.push(...reconciled);
                        reconciled.forEach(uid => affected.add(uid));
                        const reconciledActions = reconciled.flatMap(uid => actionsByUid.get(uid) || []);
                        if (reconciledActions.length > 0) {
                            try {
                                await ledger.clear(reconciledActions);
                            }
                            catch { }
                        }
                    }
                    throw err;
                }
                const movedActions = uids.flatMap(uid => actionsByUid.get(uid) || []);
                if (movedActions.length > 0) {
                    try {
                        await ledger.clear(movedActions);
                    }
                    catch (err) {
                        console.warn('Failed to clear completed rule-copy ledger rows:', err);
                    }
                }
            }
        }
        catch (err) {
            result.affected = affected.size;
            operationError = err instanceof RuleMoveApplyError
                ? err
                : new RuleMoveApplyError(result, err);
        }
        finally {
            if (mailboxOpen) {
                try {
                    await this.client.mailboxClose();
                }
                catch (err) {
                    result.affected = affected.size;
                    operationError ||= new RuleMoveApplyError(result, err);
                }
            }
        }
        if (operationError)
            throw operationError;
        result.affected = affected.size;
        return result;
    }
    async getChangedFlags(folderPath, sinceModseq) {
        const mbx = await this.client.mailboxOpen(folderPath);
        const changed = [];
        const highestModseq = mbx.highestModseq ? mbx.highestModseq.toString() : sinceModseq;
        try {
            if (mbx.highestModseq && BigInt(sinceModseq) > 0n) {
                for await (let msg of this.client.fetch('1:*', { uid: true, flags: true }, { changedSince: BigInt(sinceModseq), uid: true })) {
                    changed.push({ uid: msg.uid, flags: Array.from(msg.flags || []) });
                }
            }
        }
        catch (e) {
            console.error("Error in getChangedFlags:", e);
        }
        await this.client.mailboxClose();
        return { changed, highestModseq };
    }
    async getActiveSyncMailboxCursor(folderPath) {
        const mailbox = await this.client.mailboxOpen(folderPath, { readOnly: true });
        try {
            return {
                uidValidity: String(mailbox.uidValidity || '0'),
                highestModseq: String(mailbox.highestModseq || '0'),
            };
        }
        finally {
            await this.client.mailboxClose();
        }
    }
    async getActiveSyncMailSnapshot(folderPath, cutoff, sinceModseq, knownUids, forceFullSnapshot = false) {
        const mbx = await this.client.mailboxOpen(folderPath);
        try {
            const parsedModseq = /^\d+$/.test(sinceModseq) ? BigInt(sinceModseq) : 0n;
            if (!forceFullSnapshot && !cutoff && mbx.highestModseq && parsedModseq > 0n && parsedModseq === mbx.highestModseq) {
                return {
                    uidValidity: mbx.uidValidity.toString(),
                    highestModseq: mbx.highestModseq.toString(),
                    allUids: knownUids,
                    eligibleUids: knownUids,
                    changedReadFlags: {},
                };
            }
            const found = await this.client.search({ all: true }, { uid: true });
            const allUids = Array.isArray(found) ? found : [];
            let eligibleUids = allUids;
            if (cutoff) {
                const candidates = await this.client.search({ since: cutoff }, { uid: true });
                const exact = [];
                if (Array.isArray(candidates) && candidates.length > 0) {
                    for await (const msg of this.client.fetch(candidates, { uid: true, internalDate: true }, { uid: true })) {
                        if (msg.internalDate && new Date(msg.internalDate).getTime() >= cutoff.getTime())
                            exact.push(msg.uid);
                    }
                }
                eligibleUids = exact;
            }
            const changedReadFlags = {};
            if (mbx.highestModseq && parsedModseq > 0n && parsedModseq <= mbx.highestModseq) {
                for await (const msg of this.client.fetch('1:*', { uid: true, flags: true }, { changedSince: parsedModseq, uid: true })) {
                    changedReadFlags[String(msg.uid)] = msg.flags?.has('\\Seen') ? 1 : 0;
                }
            }
            else if (knownUids.length > 0) {
                const allUidSet = new Set(allUids);
                const existingKnown = knownUids.filter(uid => allUidSet.has(uid));
                if (existingKnown.length > 0) {
                    for await (const msg of this.client.fetch(existingKnown, { uid: true, flags: true }, { uid: true })) {
                        changedReadFlags[String(msg.uid)] = msg.flags?.has('\\Seen') ? 1 : 0;
                    }
                }
            }
            return {
                uidValidity: mbx.uidValidity.toString(),
                highestModseq: mbx.highestModseq?.toString() || sinceModseq || '0',
                allUids,
                eligibleUids,
                changedReadFlags,
            };
        }
        finally {
            await this.client.mailboxClose();
        }
    }
    async getActiveSyncMessages(folderPath, uids, maxSourceBytes) {
        if (uids.length === 0)
            return [];
        await this.client.mailboxOpen(folderPath);
        const messages = new Map();
        try {
            const cappedSourceBytes = Math.max(1, Math.min(10 * 1024 * 1024 + 256 * 1024, maxSourceBytes));
            for await (const msg of this.client.fetch(uids, {
                uid: true,
                flags: true,
                envelope: true,
                internalDate: true,
                size: true,
                source: { start: 0, maxLength: cappedSourceBytes },
            }, { uid: true })) {
                const source = msg.source || Buffer.alloc(0);
                const size = Number(msg.size || source.length);
                messages.set(msg.uid, {
                    uid: msg.uid,
                    flags: Array.from(msg.flags || []),
                    envelope: msg.envelope,
                    internalDate: msg.internalDate ? new Date(msg.internalDate) : undefined,
                    size,
                    source,
                    sourceComplete: source.length >= size,
                });
            }
        }
        finally {
            await this.client.mailboxClose();
        }
        return uids.map(uid => messages.get(uid)).filter((message) => Boolean(message));
    }
    buildSearchQuery(query, field) {
        if (field === 'from')
            return { from: query };
        if (field === 'to')
            return { to: query };
        if (field === 'subject')
            return { subject: query };
        if (field === 'body')
            return { body: query };
        if (field === 'unread')
            return { seen: false };
        if (field === 'starred')
            return { flagged: true };
        if (field === 'attachments')
            return { text: query };
        const searchQuery = {};
        const terms = [];
        const tokens = query.match(/"[^"]+"|\S+/g) || [];
        for (const token of tokens) {
            const normalized = token.toLowerCase();
            const value = token.replace(/^"|"$/g, '');
            if (normalized === 'is:unread' || normalized === 'label:unread') {
                searchQuery.seen = false;
            }
            else if (normalized === 'is:read') {
                searchQuery.seen = true;
            }
            else if (normalized === 'is:starred' || normalized === 'is:flagged') {
                searchQuery.flagged = true;
            }
            else if (normalized === 'is:unstarred' || normalized === '-is:starred' || normalized === '-is:flagged') {
                searchQuery.flagged = false;
            }
            else if (normalized.startsWith('from:') && token.length > 5) {
                searchQuery.from = token.slice(5).replace(/^"|"$/g, '');
            }
            else if (normalized.startsWith('to:') && token.length > 3) {
                searchQuery.to = token.slice(3).replace(/^"|"$/g, '');
            }
            else if (normalized.startsWith('subject:') && token.length > 8) {
                searchQuery.subject = token.slice(8).replace(/^"|"$/g, '');
            }
            else if (normalized === 'has:attachment') {
                searchQuery.or = [
                    { body: 'Content-Disposition: attachment' },
                    { body: 'filename=' },
                ];
            }
            else if (normalized.startsWith('before:') && token.length > 7) {
                const date = new Date(`${token.slice(7).replace(/^"|"$/g, '')}T00:00:00.000Z`);
                if (Number.isNaN(date.getTime()))
                    terms.push(value);
                else
                    searchQuery.sentBefore = date;
            }
            else if (normalized.startsWith('after:') && token.length > 6) {
                const date = new Date(`${token.slice(6).replace(/^"|"$/g, '')}T00:00:00.000Z`);
                if (Number.isNaN(date.getTime()))
                    terms.push(value);
                else
                    searchQuery.sentSince = date;
            }
            else {
                terms.push(value);
            }
        }
        if (terms.length > 0) {
            searchQuery.text = terms.join(' ');
        }
        return Object.keys(searchQuery).length > 0 ? searchQuery : { text: query };
    }
    async searchMessages(folderPaths, query, field = 'all', limit = 50, shouldStop = () => false) {
        const searchQuery = this.buildSearchQuery(query, field);
        const cappedLimit = Math.max(1, Math.min(limit, 100));
        const candidates = [];
        const failedFolders = [];
        const partialFolders = new Set();
        const verifyAttachments = field === 'attachments' || /(?:^|\s)has:attachment(?:\s|$)/i.test(query);
        for (const folderPath of folderPaths) {
            if (shouldStop())
                break;
            try {
                await this.client.mailboxOpen(folderPath);
                try {
                    const found = await this.client.search(searchQuery, { uid: true });
                    if (!Array.isArray(found) || found.length === 0)
                        continue;
                    if (verifyAttachments && found.length > cappedLimit)
                        partialFolders.add(folderPath);
                    const batchUids = found.slice(-cappedLimit);
                    for await (let msg of this.client.fetch(batchUids, { envelope: true, uid: true, flags: true, size: true }, { uid: true })) {
                        candidates.push({
                            folder: folderPath,
                            uid: msg.uid,
                            flags: Array.from(msg.flags || []),
                            envelope: msg.envelope,
                            size: Number(msg.size || 0),
                        });
                    }
                }
                finally {
                    await this.client.mailboxClose();
                }
            }
            catch (err) {
                try {
                    await this.client.mailboxClose();
                }
                catch (e) { }
                failedFolders.push(folderPath);
                console.error(`Failed to search folder ${folderPath}:`, err);
            }
        }
        const selected = candidates
            .sort((a, b) => (new Date(b.envelope?.date || 0).getTime() - new Date(a.envelope?.date || 0).getTime()
            || b.uid - a.uid))
            .slice(0, cappedLimit);
        if (!verifyAttachments) {
            return { messages: selected, failedFolders, partialFolders: [...partialFolders] };
        }
        const maxMessageBytes = 1024 * 1024;
        let remainingBytes = 8 * 1024 * 1024;
        const messages = [];
        const selectedByFolder = new Map();
        for (const message of selected) {
            const folderMessages = selectedByFolder.get(message.folder) || [];
            folderMessages.push(message);
            selectedByFolder.set(message.folder, folderMessages);
        }
        for (const [folderPath, folderMessages] of selectedByFolder) {
            if (shouldStop())
                break;
            try {
                await this.client.mailboxOpen(folderPath);
                try {
                    for (const candidate of folderMessages) {
                        if (shouldStop())
                            break;
                        const size = candidate.size || maxMessageBytes;
                        if (size > maxMessageBytes || size > remainingBytes) {
                            partialFolders.add(folderPath);
                            continue;
                        }
                        for await (const message of this.client.fetch([candidate.uid], { source: { start: 0, maxLength: size }, uid: true, size: true }, { uid: true })) {
                            const source = message.source || Buffer.alloc(0);
                            if (source.length < Number(message.size || size)) {
                                partialFolders.add(folderPath);
                                continue;
                            }
                            remainingBytes -= source.length;
                            messages.push({ ...candidate, source });
                        }
                    }
                }
                finally {
                    await this.client.mailboxClose();
                }
            }
            catch (err) {
                try {
                    await this.client.mailboxClose();
                }
                catch (e) { }
                if (!failedFolders.includes(folderPath))
                    failedFolders.push(folderPath);
                console.error(`Failed to verify attachment search results in folder ${folderPath}:`, err);
            }
        }
        return { messages, failedFolders, partialFolders: [...partialFolders] };
    }
    async getExistingUidStates(folderPath, uids) {
        const candidates = [...new Set(uids.filter(uid => Number.isInteger(uid) && uid > 0))];
        if (candidates.length === 0)
            return [];
        await this.client.mailboxOpen(folderPath);
        try {
            const messages = [];
            for await (const message of this.client.fetch(candidates, { uid: true, flags: true }, { uid: true })) {
                messages.push({ uid: message.uid, flags: Array.from(message.flags || []) });
            }
            return messages;
        }
        finally {
            await this.client.mailboxClose();
        }
    }
    async getFolderUidNext(folderPaths) {
        const uidNextByFolder = new Map();
        const uidValidityByFolder = new Map();
        const failedFolders = [];
        for (const folderPath of folderPaths) {
            try {
                const status = await this.client.status(folderPath, { uidNext: true, uidValidity: true });
                uidNextByFolder.set(folderPath, Number(status.uidNext || 1));
                uidValidityByFolder.set(folderPath, String(status.uidValidity || ''));
            }
            catch (err) {
                failedFolders.push(folderPath);
                console.error(`Failed to read search coverage for folder ${folderPath}:`, err);
            }
        }
        return { uidNextByFolder, uidValidityByFolder, failedFolders };
    }
    async getRecentMessagesForIndex(folderPath, limit = 100) {
        const mbx = await this.client.mailboxOpen(folderPath);
        const messages = [];
        const count = mbx.exists;
        const cappedLimit = Math.max(1, Math.min(limit, 250));
        try {
            if (count === 0)
                return messages;
            const start = Math.max(1, count - cappedLimit + 1);
            for await (let msg of this.client.fetch(`${start}:*`, { envelope: true, source: true, uid: true, flags: true })) {
                messages.push({
                    uid: msg.uid,
                    flags: Array.from(msg.flags || []),
                    envelope: msg.envelope,
                    source: msg.source
                });
            }
        }
        finally {
            await this.client.mailboxClose();
        }
        return messages;
    }
    async getMessagesSinceUid(folderPath, minUid, limit = 100) {
        await this.client.mailboxOpen(folderPath);
        const messages = [];
        const cappedLimit = Math.max(1, Math.min(limit, 250));
        let moreAvailable = false;
        try {
            const found = await this.client.search({ uid: `${Math.max(1, minUid)}:*` }, { uid: true });
            if (!Array.isArray(found) || found.length === 0)
                return { messages, moreAvailable: false };
            const matchingUids = found.filter(uid => uid >= minUid);
            const batchUids = matchingUids.slice(0, cappedLimit);
            moreAvailable = matchingUids.length > batchUids.length;
            if (batchUids.length === 0)
                return { messages, moreAvailable: false };
            for await (let msg of this.client.fetch(batchUids, { envelope: true, source: true, uid: true, flags: true }, { uid: true })) {
                messages.push({
                    uid: msg.uid,
                    flags: Array.from(msg.flags || []),
                    envelope: msg.envelope,
                    source: msg.source
                });
            }
        }
        finally {
            await this.client.mailboxClose();
        }
        return { messages, moreAvailable };
    }
    async getQuota() {
        try {
            return await this.client.getQuota();
        }
        catch (e) {
            console.error('Failed to get quota:', e);
            return null;
        }
    }
    async getMessageByUid(folderPath, uid, maxSourceBytes) {
        await this.client.mailboxOpen(folderPath);
        try {
            const bounded = Number.isFinite(maxSourceBytes) && Number(maxSourceBytes) > 0;
            const sourceLimit = bounded ? Math.max(1, Math.floor(Number(maxSourceBytes))) : 0;
            const query = {
                envelope: true,
                source: bounded ? { start: 0, maxLength: sourceLimit } : true,
                size: true,
                uid: true,
                flags: true,
            };
            for await (const msg of this.client.fetch(uid.toString(), query, { uid: true })) {
                const source = msg.source || Buffer.alloc(0);
                const reportedSize = Number(msg.size);
                const hasReportedSize = Number.isFinite(reportedSize) && reportedSize >= 0;
                const size = hasReportedSize ? reportedSize : source.length;
                return {
                    uid: msg.uid,
                    flags: Array.from(msg.flags || []),
                    envelope: msg.envelope,
                    source,
                    size,
                    sourceComplete: !bounded
                        || (hasReportedSize ? source.length >= reportedSize : source.length < sourceLimit),
                };
            }
            return null;
        }
        finally {
            await this.client.mailboxClose();
        }
    }
    async appendMessage(folderPath, content, flags) {
        await this.client.append(folderPath, content, flags);
    }
    async moveMessage(sourceFolder, targetFolder, uid) {
        await this.client.mailboxOpen(sourceFolder);
        await this.client.messageMove(uid.toString(), targetFolder, { uid: true });
        await this.client.mailboxClose();
    }
    async messageAction(folderPath, uids, action, targetFolder) {
        if (uids.length === 0)
            return null;
        await this.client.mailboxOpen(folderPath);
        const sequence = uids.join(',');
        try {
            if (action === 'hardDelete') {
                await this.client.messageDelete(sequence, { uid: true });
                return null;
            }
            else if (action === 'delete') {
                // Try to move to Trash first
                let trashFolder = 'Trash';
                const folders = await this.client.list();
                const existingTrash = folders.find(f => f.path.toLowerCase() === 'trash');
                if (!existingTrash) {
                    try {
                        await this.client.mailboxCreate('Trash');
                    }
                    catch (e) { }
                }
                else {
                    trashFolder = existingTrash.path;
                }
                if (folderPath.toLowerCase() === trashFolder.toLowerCase()) {
                    await this.client.messageDelete(sequence, { uid: true });
                    return null;
                }
                const moveResult = await this.client.messageMove(sequence, trashFolder, { uid: true });
                return { targetFolder: trashFolder, uidMap: moveResult && moveResult.uidMap ? Object.fromEntries(moveResult.uidMap) : null };
            }
            else if (action === 'archive') {
                let archFolder = 'Archive';
                const folders = await this.client.list();
                const existing = folders.find(f => f.path.toLowerCase() === 'archive');
                if (!existing) {
                    try {
                        await this.client.mailboxCreate('Archive');
                    }
                    catch (e) { }
                }
                else {
                    archFolder = existing.path;
                }
                const moveResult = await this.client.messageMove(sequence, archFolder, { uid: true });
                return { targetFolder: archFolder, uidMap: moveResult && moveResult.uidMap ? Object.fromEntries(moveResult.uidMap) : null };
            }
            else if (action === 'spam') {
                let junkFolder = 'Junk';
                const folders = await this.client.list();
                const existing = folders.find(f => f.path.toLowerCase() === 'junk');
                if (!existing) {
                    try {
                        await this.client.mailboxCreate('Junk');
                    }
                    catch (e) { }
                }
                else {
                    junkFolder = existing.path;
                }
                const moveResult = await this.client.messageMove(sequence, junkFolder, { uid: true });
                return { targetFolder: junkFolder, uidMap: moveResult && moveResult.uidMap ? Object.fromEntries(moveResult.uidMap) : null };
            }
            else if (action === 'move' && targetFolder) {
                const moveResult = await this.client.messageMove(sequence, targetFolder, { uid: true });
                return { targetFolder, uidMap: moveResult && moveResult.uidMap ? Object.fromEntries(moveResult.uidMap) : null };
            }
            else if (action === 'read') {
                await this.client.messageFlagsAdd(sequence, ['\\Seen'], { uid: true });
            }
            else if (action === 'unread') {
                await this.client.messageFlagsRemove(sequence, ['\\Seen'], { uid: true });
            }
            else if (action === 'star') {
                await this.client.messageFlagsAdd(sequence, ['\\Flagged'], { uid: true });
            }
            else if (action === 'unstar') {
                await this.client.messageFlagsRemove(sequence, ['\\Flagged'], { uid: true });
            }
            return null;
        }
        finally {
            await this.client.mailboxClose();
        }
    }
}
exports.ImapService = ImapService;
//# sourceMappingURL=imap.js.map