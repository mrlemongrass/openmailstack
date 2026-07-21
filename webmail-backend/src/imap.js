"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImapService = void 0;
const imapflow_1 = require("imapflow");
const config_1 = require("./config");
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
    async getFolders() {
        const folders = await this.client.list();
        const results = [];
        for (const f of folders) {
            try {
                const status = await this.client.status(f.path, { unseen: true });
                results.push({ path: f.path, delimiter: f.delimiter, unseen: status.unseen || 0 });
            }
            catch (e) {
                results.push({ path: f.path, delimiter: f.delimiter, unseen: 0 });
            }
        }
        return results;
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
    async searchMessages(folderPaths, query, field = 'all', limit = 50) {
        const searchQuery = this.buildSearchQuery(query, field);
        const cappedLimit = Math.max(1, Math.min(limit, 100));
        const candidates = [];
        const failedFolders = [];
        const partialFolders = new Set();
        const verifyAttachments = field === 'attachments' || /(?:^|\s)has:attachment(?:\s|$)/i.test(query);
        for (const folderPath of folderPaths) {
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
            try {
                await this.client.mailboxOpen(folderPath);
                try {
                    for (const candidate of folderMessages) {
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
        try {
            const found = await this.client.search({ uid: `${Math.max(1, minUid)}:*` }, { uid: true });
            if (!Array.isArray(found) || found.length === 0)
                return messages;
            const batchUids = found.filter(uid => uid >= minUid).slice(0, cappedLimit);
            if (batchUids.length === 0)
                return messages;
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
        return messages;
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
    async getMessageByUid(folderPath, uid) {
        const mbx = await this.client.mailboxOpen(folderPath);
        let result = null;
        for await (let msg of this.client.fetch(uid.toString(), { envelope: true, source: true, uid: true, flags: true }, { uid: true })) {
            result = {
                uid: msg.uid,
                flags: Array.from(msg.flags || []),
                envelope: msg.envelope,
                source: msg.source
            };
            break;
        }
        await this.client.mailboxClose();
        return result;
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