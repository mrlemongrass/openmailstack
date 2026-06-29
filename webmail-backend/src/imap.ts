import { ImapFlow, type SearchObject } from 'imapflow';
import { imapConfig } from './config';

export type MailSearchField = 'all' | 'from' | 'to' | 'subject' | 'body' | 'unread' | 'starred' | 'attachments';

export class ImapService {
    public client: ImapFlow;

    constructor(user: string, pass: string) {
        const masterUser = imapConfig.masterUser;
        const masterPass = imapConfig.masterPass;
        const authUser = (masterUser && masterPass) ? `${user}*${masterUser}` : user;
        const authPass = (masterUser && masterPass) ? masterPass : pass;
        this.client = new ImapFlow({
            host: imapConfig.host,
            port: imapConfig.port,
            secure: imapConfig.secure,
            tls: {
                rejectUnauthorized: imapConfig.rejectUnauthorized,
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
                results.push({ path: f.path, unseen: status.unseen || 0 });
            } catch (e) {
                results.push({ path: f.path, unseen: 0 });
            }
        }
        return results;
    }

    async getMessages(folderPath: string, minUid?: number, fetchOlderThan?: number) {
        const mbx = await this.client.mailboxOpen(folderPath);
        const messages: any[] = [];
        
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
        } else if (fetchOlderThan && fetchOlderThan > 1) {
            // Backward sync: Fetch older messages for pagination
            const uids = await this.client.search({ uid: `1:${fetchOlderThan - 1}` }, { uid: true });
            if (Array.isArray(uids) && uids.length > 0) {
                const batchUids = uids.slice(-25); // Get up to 25 older messages
                lowestUid = Math.min(...batchUids);
                if (uids.length > 25) moreAvailable = true;
                
                for await (let msg of this.client.fetch(batchUids, { envelope: true, source: true, uid: true, flags: true }, { uid: true })) {
                    messages.push({
                        uid: msg.uid,
                        flags: Array.from(msg.flags || []),
                        envelope: msg.envelope,
                        source: msg.source
                    });
                }
            }
        } else {
            // Initial sync: Fetch newest 25 messages
            const start = Math.max(1, count - 24);
            if (start > 1) moreAvailable = true;
            
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

    async getChangedFlags(folderPath: string, sinceModseq: string) {
        const mbx = await this.client.mailboxOpen(folderPath);
        const changed: Array<{uid: number, flags: string[]}> = [];
        const highestModseq = mbx.highestModseq ? mbx.highestModseq.toString() : sinceModseq;
        
        try {
            if (mbx.highestModseq && BigInt(sinceModseq) > 0n) {
                for await (let msg of this.client.fetch('1:*', { uid: true, flags: true }, { changedSince: BigInt(sinceModseq), uid: true })) {
                    changed.push({ uid: msg.uid, flags: Array.from(msg.flags || []) });
                }
            }
        } catch (e) {
            console.error("Error in getChangedFlags:", e);
        }
        await this.client.mailboxClose();
        return { changed, highestModseq };
    }

    private buildSearchQuery(query: string, field: MailSearchField): SearchObject {
        if (field === 'from') return { from: query };
        if (field === 'to') return { to: query };
        if (field === 'subject') return { subject: query };
        if (field === 'body') return { body: query };
        if (field === 'unread') return { seen: false };
        if (field === 'starred') return { flagged: true };
        if (field === 'attachments') return { text: query };

        const searchQuery: SearchObject = {};
        const terms: string[] = [];
        const tokens = query.match(/"[^"]+"|\S+/g) || [];

        for (const token of tokens) {
            const normalized = token.toLowerCase();
            const value = token.replace(/^"|"$/g, '');

            if (normalized === 'is:unread' || normalized === 'label:unread') {
                searchQuery.seen = false;
            } else if (normalized === 'is:read') {
                searchQuery.seen = true;
            } else if (normalized === 'is:starred' || normalized === 'is:flagged') {
                searchQuery.flagged = true;
            } else if (normalized === 'is:unstarred' || normalized === '-is:starred' || normalized === '-is:flagged') {
                searchQuery.flagged = false;
            } else if (normalized.startsWith('from:') && token.length > 5) {
                searchQuery.from = token.slice(5).replace(/^"|"$/g, '');
            } else if (normalized.startsWith('to:') && token.length > 3) {
                searchQuery.to = token.slice(3).replace(/^"|"$/g, '');
            } else if (normalized.startsWith('subject:') && token.length > 8) {
                searchQuery.subject = token.slice(8).replace(/^"|"$/g, '');
            } else {
                terms.push(value);
            }
        }

        if (terms.length > 0) {
            searchQuery.text = terms.join(' ');
        }

        return Object.keys(searchQuery).length > 0 ? searchQuery : { text: query };
    }

    async searchMessages(folderPaths: string[], query: string, field: MailSearchField = 'all', limit = 50) {
        const results: any[] = [];
        const searchQuery = this.buildSearchQuery(query, field);
        const perFolderLimit = Math.max(10, Math.min(limit, 25));

        for (const folderPath of folderPaths) {
            if (results.length >= limit) break;

            try {
                await this.client.mailboxOpen(folderPath);
                const found = await this.client.search(searchQuery, { uid: true });
                if (!Array.isArray(found) || found.length === 0) {
                    await this.client.mailboxClose();
                    continue;
                }

                const batchUids = found.slice(-perFolderLimit);
                for await (let msg of this.client.fetch(batchUids, { envelope: true, source: true, uid: true, flags: true }, { uid: true })) {
                    results.push({
                        folder: folderPath,
                        uid: msg.uid,
                        flags: Array.from(msg.flags || []),
                        envelope: msg.envelope,
                        source: msg.source
                    });
                }
                await this.client.mailboxClose();
            } catch (err) {
                try { await this.client.mailboxClose(); } catch (e) {}
                console.error(`Failed to search folder ${folderPath}:`, err);
            }
        }

        return results.slice(0, limit);
    }

    async getRecentMessagesForIndex(folderPath: string, limit = 100) {
        const mbx = await this.client.mailboxOpen(folderPath);
        const messages: any[] = [];
        const count = mbx.exists;
        const cappedLimit = Math.max(1, Math.min(limit, 250));

        try {
            if (count === 0) return messages;
            const start = Math.max(1, count - cappedLimit + 1);

            for await (let msg of this.client.fetch(`${start}:*`, { envelope: true, source: true, uid: true, flags: true })) {
                messages.push({
                    uid: msg.uid,
                    flags: Array.from(msg.flags || []),
                    envelope: msg.envelope,
                    source: msg.source
                });
            }
        } finally {
            await this.client.mailboxClose();
        }

        return messages;
    }

    async getMessagesSinceUid(folderPath: string, minUid: number, limit = 100) {
        await this.client.mailboxOpen(folderPath);
        const messages: any[] = [];
        const cappedLimit = Math.max(1, Math.min(limit, 250));

        try {
            const found = await this.client.search({ uid: `${Math.max(1, minUid)}:*` }, { uid: true });
            if (!Array.isArray(found) || found.length === 0) return messages;

            const batchUids = found.filter(uid => uid >= minUid).slice(0, cappedLimit);
            if (batchUids.length === 0) return messages;

            for await (let msg of this.client.fetch(batchUids, { envelope: true, source: true, uid: true, flags: true }, { uid: true })) {
                messages.push({
                    uid: msg.uid,
                    flags: Array.from(msg.flags || []),
                    envelope: msg.envelope,
                    source: msg.source
                });
            }
        } finally {
            await this.client.mailboxClose();
        }

        return messages;
    }

    async getQuota() {
        try {
            return await this.client.getQuota();
        } catch (e) {
            console.error('Failed to get quota:', e);
            return null;
        }
    }

    async getMessageByUid(folderPath: string, uid: number) {
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

    async appendMessage(folderPath: string, content: string | Buffer, flags?: string[]) {
        await this.client.append(folderPath, content, flags);
    }

    async moveMessage(sourceFolder: string, targetFolder: string, uid: number) {
        await this.client.mailboxOpen(sourceFolder);
        await this.client.messageMove(uid.toString(), targetFolder, { uid: true });
        await this.client.mailboxClose();
    }

    async messageAction(folderPath: string, uids: number[], action: 'delete' | 'archive' | 'spam' | 'move' | 'read' | 'unread' | 'star' | 'unstar', targetFolder?: string) {
        if (uids.length === 0) return null;
        
        await this.client.mailboxOpen(folderPath);
        const sequence = uids.join(',');
        
        try {
            if (action === 'delete') {
                // Try to move to Trash first
                let trashFolder = 'Trash';
                const folders = await this.client.list();
                const existingTrash = folders.find(f => f.path.toLowerCase() === 'trash');
                if (!existingTrash) {
                    try { await this.client.mailboxCreate('Trash'); } catch(e) {}
                } else {
                    trashFolder = existingTrash.path;
                }
                const moveResult = await this.client.messageMove(sequence, trashFolder, { uid: true });
                return { targetFolder: trashFolder, uidMap: moveResult && moveResult.uidMap ? Object.fromEntries(moveResult.uidMap) : null };
            } else if (action === 'archive') {
                let archFolder = 'Archive';
                const folders = await this.client.list();
                const existing = folders.find(f => f.path.toLowerCase() === 'archive');
                if (!existing) {
                    try { await this.client.mailboxCreate('Archive'); } catch(e) {}
                } else {
                    archFolder = existing.path;
                }
                const moveResult = await this.client.messageMove(sequence, archFolder, { uid: true });
                return { targetFolder: archFolder, uidMap: moveResult && moveResult.uidMap ? Object.fromEntries(moveResult.uidMap) : null };
            } else if (action === 'spam') {
                let junkFolder = 'Junk';
                const folders = await this.client.list();
                const existing = folders.find(f => f.path.toLowerCase() === 'junk');
                if (!existing) {
                    try { await this.client.mailboxCreate('Junk'); } catch(e) {}
                } else {
                    junkFolder = existing.path;
                }
                const moveResult = await this.client.messageMove(sequence, junkFolder, { uid: true });
                return { targetFolder: junkFolder, uidMap: moveResult && moveResult.uidMap ? Object.fromEntries(moveResult.uidMap) : null };
            } else if (action === 'move' && targetFolder) {
                const moveResult = await this.client.messageMove(sequence, targetFolder, { uid: true });
                return { targetFolder, uidMap: moveResult && moveResult.uidMap ? Object.fromEntries(moveResult.uidMap) : null };
            } else if (action === 'read') {
                await this.client.messageFlagsAdd(sequence, ['\\Seen'], { uid: true });
            } else if (action === 'unread') {
                await this.client.messageFlagsRemove(sequence, ['\\Seen'], { uid: true });
            } else if (action === 'star') {
                await this.client.messageFlagsAdd(sequence, ['\\Flagged'], { uid: true });
            } else if (action === 'unstar') {
                await this.client.messageFlagsRemove(sequence, ['\\Flagged'], { uid: true });
            }
            return null;
        } finally {
            await this.client.mailboxClose();
        }
    }
}
