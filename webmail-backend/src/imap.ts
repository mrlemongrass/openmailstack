import crypto from 'crypto';
import { ImapFlow, type SearchObject } from 'imapflow';
import { imapConfig } from './config';
import type {
    RuleCopyLedger,
    RuleCopyLedgerAction,
} from './rule-run-ledger';

export type MailSearchField = 'all' | 'from' | 'to' | 'subject' | 'body' | 'unread' | 'starred' | 'attachments';

export interface ActiveSyncMailSnapshot {
    uidValidity: string;
    highestModseq: string;
    allUids: number[];
    eligibleUids: number[];
    changedReadFlags: Record<string, 0 | 1>;
}

export interface ActiveSyncMailMessage {
    uid: number;
    flags: string[];
    envelope: any;
    internalDate?: Date;
    size: number;
    source: Buffer;
    sourceComplete: boolean;
}

export interface RuleRunRawMessage {
    uid: number;
    envelope: any;
    size: number;
    source?: Buffer;
    sourceComplete: boolean;
}

export interface RuleMovePlan {
    uid: number;
    moveFolders: string[];
}

export interface RuleMoveApplyResult {
    affected: number;
    copied: number;
    moved: number;
    movedUids: number[];
}

export class RuleMoveApplyError extends Error {
    constructor(
        public result: RuleMoveApplyResult,
        cause: unknown,
        public retrySafe = true,
        public pendingCopies: RuleCopyLedgerAction[] = [],
    ) {
        super(retrySafe
            ? 'A mailbox operation interrupted the rule run. Apply again to reconcile safely, then run a new preview.'
            : 'A copy operation was interrupted and was not repeated to prevent duplicate mail. Check the preview destinations, then run a new preview.');
        this.name = 'RuleMoveApplyError';
        (this as Error & { cause?: unknown }).cause = cause;
    }
}

export class MailboxMutationError extends Error {
    constructor(
        public code: string,
        public statusCode: number,
        message: string,
    ) {
        super(message);
        this.name = 'MailboxMutationError';
    }
}

const SPECIAL_USE_FLAGS = new Set([
    '\\all',
    '\\archive',
    '\\drafts',
    '\\flagged',
    '\\important',
    '\\inbox',
    '\\junk',
    '\\sent',
    '\\trash',
]);
const MARK_READ_UID_BATCH_SIZE = 500;

function mailboxSpecialUse(folder: any): string | undefined {
    if (typeof folder?.specialUse === 'string' && folder.specialUse) return folder.specialUse;
    return Array.from(folder?.flags || [], flag => String(flag))
        .find(flag => SPECIAL_USE_FLAGS.has(flag.toLowerCase()));
}

export class ImapService {
    public client: ImapFlow;

    constructor(user: string, pass: string, useMasterCredentials = true) {
        const masterUser = useMasterCredentials ? imapConfig.masterUser : '';
        const masterPass = useMasterCredentials ? imapConfig.masterPass : '';
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

    close() {
        this.client.close();
    }

    async getFolders(): Promise<any[]> {
        const folders = await this.client.list({ statusQuery: { unseen: true } });
        return folders.map(f => {
            const specialUse = mailboxSpecialUse(f);
            return {
                path: f.path,
                delimiter: f.delimiter,
                unseen: Number(f.status?.unseen || 0),
                ...(specialUse ? { specialUse } : {}),
                ...(f.flags?.has('\\Noselect') ? { disabled: true } : {}),
            };
        });
    }

    private async preserveSubscriptionsAfterMailboxRename(
        folders: any[],
        sourcePath: string,
        delimiter: string,
        destinationPath: string,
        action: 'move' | 'rename',
    ) {
        for (const folder of folders) {
            const belongsToRenamedTree = folder.path === sourcePath
                || Boolean(delimiter && folder.path.startsWith(`${sourcePath}${delimiter}`));
            if (!belongsToRenamedTree || !folder.subscribed) continue;
            const renamedPath = `${destinationPath}${folder.path.slice(sourcePath.length)}`;
            try {
                await this.client.mailboxSubscribe(renamedPath);
                await this.client.mailboxUnsubscribe(folder.path);
            } catch (err) {
                console.error(`Failed to preserve mailbox subscription after folder ${action}`, {
                    errorType: err instanceof Error ? err.name : 'UnknownError',
                });
            }
        }
    }

    async createFolder(parentPath: string | null | undefined, requestedName: string) {
        if (parentPath !== null && parentPath !== undefined && typeof parentPath !== 'string') {
            throw new MailboxMutationError('INVALID_PARENT_FOLDER', 400, 'Choose a valid parent folder.');
        }
        const parent = typeof parentPath === 'string' ? parentPath.trim() : null;
        const name = typeof requestedName === 'string' ? requestedName.trim() : '';
        if (parent !== null && (!parent || /[\u0000-\u001f\u007f]/u.test(parent))) {
            throw new MailboxMutationError('INVALID_PARENT_FOLDER', 400, 'Choose a valid parent folder.');
        }
        if (parent?.toUpperCase() === 'SCHEDULED') {
            throw new MailboxMutationError(
                'VIRTUAL_FOLDER_UNSUPPORTED',
                409,
                'Scheduled is a virtual folder and cannot contain subfolders.',
            );
        }
        if (!name || Array.from(name).length > 255 || /[\u0000-\u001f\u007f]/u.test(name)) {
            throw new MailboxMutationError(
                'INVALID_FOLDER_NAME',
                400,
                'Enter a folder name between 1 and 255 characters.',
            );
        }
        if (parent === null && name.toUpperCase() === 'SCHEDULED') {
            throw new MailboxMutationError(
                'VIRTUAL_FOLDER_UNSUPPORTED',
                409,
                'Scheduled is reserved and cannot be used as a top-level folder name.',
            );
        }

        const folders = await this.client.list();
        const parentFolder = parent === null
            ? null
            : folders.find(folder => (
                folder.path === parent
                || (parent.toUpperCase() === 'INBOX' && folder.path.toUpperCase() === 'INBOX')
            ));
        if (parent !== null && !parentFolder) {
            throw new MailboxMutationError(
                'PARENT_FOLDER_NOT_FOUND',
                404,
                'The parent folder no longer exists. Refresh Mail and try again.',
            );
        }

        if (parentFolder?.flags?.has('\\Noselect')) {
            throw new MailboxMutationError(
                'INVALID_PARENT_FOLDER',
                409,
                'That folder cannot contain subfolders.',
            );
        }

        const delimiter = typeof parentFolder?.delimiter === 'string'
            ? parentFolder.delimiter
            : folders.find(folder => typeof folder.delimiter === 'string')?.delimiter || '';
        if (parentFolder && !delimiter) {
            throw new MailboxMutationError(
                'FOLDER_HIERARCHY_UNAVAILABLE',
                409,
                'This mail server does not support subfolders here.',
            );
        }
        if (delimiter && name.includes(delimiter)) {
            throw new MailboxMutationError(
                'INVALID_FOLDER_NAME',
                400,
                `Folder names cannot contain "${delimiter}".`,
            );
        }

        const result = await this.client.mailboxCreate(parentFolder ? [parentFolder.path, name] : [name]);
        if (!result.created) {
            throw new MailboxMutationError(
                'FOLDER_EXISTS',
                409,
                'A folder with that name already exists.',
            );
        }
        return { path: result.path, delimiter, unseen: 0 };
    }

    async moveFolder(requestedPath: string, requestedParent: string | null | undefined) {
        if (requestedParent !== null && requestedParent !== undefined && typeof requestedParent !== 'string') {
            throw new MailboxMutationError(
                'INVALID_FOLDER_DESTINATION',
                400,
                'Choose a valid destination folder.',
            );
        }
        const path = typeof requestedPath === 'string' ? requestedPath.trim() : '';
        const parent = typeof requestedParent === 'string' ? requestedParent.trim() : null;
        if (!path || /[\u0000-\u001f\u007f]/u.test(path)) {
            throw new MailboxMutationError('INVALID_FOLDER', 400, 'Choose a valid folder to move.');
        }
        if (parent !== null && (!parent || /[\u0000-\u001f\u007f]/u.test(parent))) {
            throw new MailboxMutationError('INVALID_FOLDER_DESTINATION', 400, 'Choose a valid destination folder.');
        }
        if (path.toUpperCase() === 'SCHEDULED' || parent?.toUpperCase() === 'SCHEDULED') {
            throw new MailboxMutationError(
                'VIRTUAL_FOLDER_UNSUPPORTED',
                409,
                'Scheduled is a virtual folder and cannot be moved or contain folders.',
            );
        }

        const folders = await this.client.list();
        const source = folders.find(folder => (
            folder.path === path
            || (path.toUpperCase() === 'INBOX' && folder.path.toUpperCase() === 'INBOX')
        ));
        if (!source) {
            throw new MailboxMutationError(
                'FOLDER_NOT_FOUND',
                404,
                'The folder no longer exists. Refresh Mail and try again.',
            );
        }
        if (source.path.toUpperCase() === 'INBOX' || mailboxSpecialUse(source)) {
            throw new MailboxMutationError(
                'PROTECTED_FOLDER',
                409,
                'System folders cannot be moved.',
            );
        }
        if (source.flags?.has('\\Noselect')) {
            throw new MailboxMutationError('INVALID_FOLDER', 409, 'That folder cannot be moved.');
        }

        const sourceDelimiter = typeof source.delimiter === 'string' ? source.delimiter : '';
        const leaf = sourceDelimiter && source.path.includes(sourceDelimiter)
            ? source.path.slice(source.path.lastIndexOf(sourceDelimiter) + sourceDelimiter.length)
            : source.path;
        if (parent === null && leaf.toUpperCase() === 'SCHEDULED') {
            throw new MailboxMutationError(
                'VIRTUAL_FOLDER_UNSUPPORTED',
                409,
                'Scheduled is reserved and cannot be used as a top-level folder name.',
            );
        }
        const parentFolder = parent === null
            ? null
            : folders.find(folder => (
                folder.path === parent
                || (parent.toUpperCase() === 'INBOX' && folder.path.toUpperCase() === 'INBOX')
            ));
        if (parent !== null && !parentFolder) {
            throw new MailboxMutationError(
                'PARENT_FOLDER_NOT_FOUND',
                404,
                'The destination folder no longer exists. Refresh Mail and try again.',
            );
        }
        if (parentFolder?.flags?.has('\\Noselect')) {
            throw new MailboxMutationError(
                'INVALID_FOLDER_DESTINATION',
                409,
                'That folder cannot contain subfolders.',
            );
        }

        const delimiter = typeof parentFolder?.delimiter === 'string'
            ? parentFolder.delimiter
            : sourceDelimiter;
        if (parentFolder && !delimiter) {
            throw new MailboxMutationError(
                'FOLDER_HIERARCHY_UNAVAILABLE',
                409,
                'This mail server does not support subfolders here.',
            );
        }
        if (
            parentFolder
            && (parentFolder.path === source.path
                || (sourceDelimiter && parentFolder.path.startsWith(`${source.path}${sourceDelimiter}`)))
        ) {
            throw new MailboxMutationError(
                'INVALID_FOLDER_DESTINATION',
                409,
                'A folder cannot be moved into itself or one of its subfolders.',
            );
        }

        const destinationPath = parentFolder ? `${parentFolder.path}${delimiter}${leaf}` : leaf;
        if (destinationPath === source.path) {
            throw new MailboxMutationError(
                'INVALID_FOLDER_DESTINATION',
                409,
                'That folder is already in this location.',
            );
        }
        if (folders.some(folder => folder.path === destinationPath)) {
            throw new MailboxMutationError(
                'FOLDER_EXISTS',
                409,
                'A folder with that name already exists in the destination.',
            );
        }

        const result = await this.client.mailboxRename(
            source.path,
            parentFolder ? [parentFolder.path, leaf] : [leaf],
        );
        await this.preserveSubscriptionsAfterMailboxRename(
            folders,
            source.path,
            sourceDelimiter,
            result.newPath,
            'move',
        );
        return {
            previousPath: source.path,
            folder: {
                path: result.newPath,
                delimiter,
                unseen: Number(source.status?.unseen || 0),
            },
        };
    }

    async renameFolder(requestedPath: string, requestedName: string) {
        const path = typeof requestedPath === 'string' ? requestedPath.trim() : '';
        const name = typeof requestedName === 'string' ? requestedName.trim() : '';
        if (!path || /[\u0000-\u001f\u007f]/u.test(path)) {
            throw new MailboxMutationError('INVALID_FOLDER', 400, 'Choose a valid folder to rename.');
        }
        if (!name || Array.from(name).length > 255 || /[\u0000-\u001f\u007f]/u.test(name)) {
            throw new MailboxMutationError(
                'INVALID_FOLDER_NAME',
                400,
                'Enter a folder name between 1 and 255 characters.',
            );
        }
        if (path.toUpperCase() === 'SCHEDULED') {
            throw new MailboxMutationError(
                'VIRTUAL_FOLDER_UNSUPPORTED',
                409,
                'Scheduled is a virtual folder and cannot be renamed.',
            );
        }

        const folders = await this.client.list();
        const source = folders.find(folder => (
            folder.path === path
            || (path.toUpperCase() === 'INBOX' && folder.path.toUpperCase() === 'INBOX')
        ));
        if (!source) {
            throw new MailboxMutationError(
                'FOLDER_NOT_FOUND',
                404,
                'The folder no longer exists. Refresh Mail and try again.',
            );
        }
        if (source.path.toUpperCase() === 'INBOX' || mailboxSpecialUse(source)) {
            throw new MailboxMutationError(
                'PROTECTED_FOLDER',
                409,
                'System folders cannot be renamed.',
            );
        }
        if (source.flags?.has('\\Noselect')) {
            throw new MailboxMutationError('INVALID_FOLDER', 409, 'That folder cannot be renamed.');
        }

        const delimiter = typeof source.delimiter === 'string' ? source.delimiter : '';
        if (delimiter && name.includes(delimiter)) {
            throw new MailboxMutationError(
                'INVALID_FOLDER_NAME',
                400,
                `Folder names cannot contain "${delimiter}".`,
            );
        }
        const parentPath = delimiter && source.path.includes(delimiter)
            ? source.path.slice(0, source.path.lastIndexOf(delimiter))
            : null;
        if (parentPath === null) {
            if (name.toUpperCase() === 'INBOX') {
                throw new MailboxMutationError(
                    'PROTECTED_FOLDER',
                    409,
                    'Inbox is reserved and cannot be used as a top-level folder name.',
                );
            }
            if (name.toUpperCase() === 'SCHEDULED') {
                throw new MailboxMutationError(
                    'VIRTUAL_FOLDER_UNSUPPORTED',
                    409,
                    'Scheduled is reserved and cannot be used as a top-level folder name.',
                );
            }
        }

        const destinationPath = parentPath ? `${parentPath}${delimiter}${name}` : name;
        if (destinationPath === source.path) {
            throw new MailboxMutationError(
                'FOLDER_NAME_UNCHANGED',
                409,
                'Enter a different folder name.',
            );
        }
        if (folders.some(folder => folder.path === destinationPath)) {
            throw new MailboxMutationError(
                'FOLDER_EXISTS',
                409,
                'A folder with that name already exists in this location.',
            );
        }

        const result = await this.client.mailboxRename(
            source.path,
            parentPath ? [parentPath, name] : [name],
        );
        await this.preserveSubscriptionsAfterMailboxRename(
            folders,
            source.path,
            delimiter,
            result.newPath,
            'rename',
        );
        return {
            previousPath: source.path,
            folder: {
                path: result.newPath,
                delimiter,
                unseen: Number(source.status?.unseen || 0),
            },
        };
    }

    async deleteFolder(requestedPath: string) {
        const path = typeof requestedPath === 'string' ? requestedPath.trim() : '';
        if (!path || /[\u0000-\u001f\u007f]/u.test(path)) {
            throw new MailboxMutationError('INVALID_FOLDER', 400, 'Choose a valid folder to delete.');
        }
        if (path.toUpperCase() === 'SCHEDULED') {
            throw new MailboxMutationError(
                'VIRTUAL_FOLDER_UNSUPPORTED',
                409,
                'Scheduled is a virtual folder and cannot be deleted.',
            );
        }

        const folders = await this.client.list();
        const source = folders.find(folder => (
            folder.path === path
            || (path.toUpperCase() === 'INBOX' && folder.path.toUpperCase() === 'INBOX')
        ));
        if (!source) {
            throw new MailboxMutationError(
                'FOLDER_NOT_FOUND',
                404,
                'The folder no longer exists. Refresh Mail and try again.',
            );
        }
        if (source.path.toUpperCase() === 'INBOX' || mailboxSpecialUse(source)) {
            throw new MailboxMutationError(
                'PROTECTED_FOLDER',
                409,
                'System folders cannot be deleted.',
            );
        }
        if (source.flags?.has('\\Noselect')) {
            throw new MailboxMutationError('INVALID_FOLDER', 409, 'That folder cannot be deleted.');
        }

        const delimiter = typeof source.delimiter === 'string' ? source.delimiter : '';
        if (delimiter && folders.some(folder => folder.path.startsWith(`${source.path}${delimiter}`))) {
            throw new MailboxMutationError(
                'FOLDER_HAS_CHILDREN',
                409,
                'Move or delete this folder’s subfolders first.',
            );
        }

        const result = await this.client.mailboxDelete(source.path);
        try {
            await this.client.mailboxUnsubscribe(source.path);
        } catch (err) {
            console.error('Failed to remove mailbox subscription after folder deletion', {
                errorType: err instanceof Error ? err.name : 'UnknownError',
            });
        }
        return { deletedPath: result?.path || source.path };
    }

    async markFolderRead(requestedPath: string) {
        const path = typeof requestedPath === 'string' ? requestedPath.trim() : '';
        if (!path || /[\u0000-\u001f\u007f]/u.test(path)) {
            throw new MailboxMutationError('INVALID_FOLDER', 400, 'Choose a valid folder to mark as read.');
        }
        if (path.toUpperCase() === 'SCHEDULED') {
            throw new MailboxMutationError(
                'VIRTUAL_FOLDER_UNSUPPORTED',
                409,
                'Scheduled messages cannot be marked as read.',
            );
        }

        const folders = await this.client.list();
        const source = folders.find(folder => (
            folder.path === path
            || (path.toUpperCase() === 'INBOX' && folder.path.toUpperCase() === 'INBOX')
        ));
        if (!source) {
            throw new MailboxMutationError(
                'FOLDER_NOT_FOUND',
                404,
                'The folder no longer exists. Refresh Mail and try again.',
            );
        }
        if (source.flags?.has('\\Noselect')) {
            throw new MailboxMutationError('INVALID_FOLDER', 409, 'That folder cannot contain messages.');
        }

        const lock = await this.client.getMailboxLock(source.path);
        try {
            const mailbox = this.client.mailbox;
            if (!mailbox) throw new Error('The folder could not be selected.');
            const maxUid = Math.max(0, Math.trunc(Number(mailbox.uidNext || 0)) - 1);
            if (maxUid === 0) return { path: source.path, marked: 0, maxUid, markedUids: [] };

            const found = await this.client.search(
                { uid: `1:${maxUid}`, seen: false },
                { uid: true },
            );
            const unreadUids = [...new Set(Array.isArray(found)
                ? found.filter(uid => Number.isInteger(uid) && uid > 0 && uid <= maxUid)
                : [])].sort((left, right) => left - right);
            for (let offset = 0; offset < unreadUids.length; offset += MARK_READ_UID_BATCH_SIZE) {
                await this.client.messageFlagsAdd(
                    unreadUids.slice(offset, offset + MARK_READ_UID_BATCH_SIZE).join(','),
                    ['\\Seen'],
                    { uid: true },
                );
            }
            return {
                path: source.path,
                marked: unreadUids.length,
                maxUid,
                markedUids: unreadUids,
            };
        } finally {
            lock.release();
        }
    }

    async getMessageIdentities(folderPath: string) {
        const mailbox = await this.client.mailboxOpen(folderPath);
        const messages: any[] = [];
        try {
            if (mailbox.exists === 0) return messages;
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
        } finally {
            await this.client.mailboxClose();
        }
    }

    async getSearchFolderSnapshot() {
        const folders = await this.client.list({
            statusQuery: { uidNext: true, uidValidity: true },
        });
        const folderPaths: string[] = [];
        const uidNextByFolder = new Map<string, number>();
        const uidValidityByFolder = new Map<string, string>();
        const failedFolders: string[] = [];

        for (const folder of folders) {
            if (folder.flags?.has('\\Noselect')) continue;
            folderPaths.push(folder.path);
            const uidNext = Number(folder.status?.uidNext || 0);
            const uidValidity = String(folder.status?.uidValidity || '');
            if (uidNext > 0 && uidValidity) {
                uidNextByFolder.set(folder.path, uidNext);
                uidValidityByFolder.set(folder.path, uidValidity);
            } else {
                failedFolders.push(folder.path);
            }
        }

        return { folderPaths, uidNextByFolder, uidValidityByFolder, failedFolders };
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

    async getRuleRunBatch(
        folderPath: string,
        cursor = 0,
        maxUid?: number,
        batchSize = 100,
        includeBody = false,
        readState: 'all' | 'unread' | 'read' = 'all',
    ) {
        const mbx = await this.client.mailboxOpen(folderPath);
        try {
            const snapshotMaxUid = Number.isInteger(maxUid)
                ? Math.max(0, Number(maxUid))
                : Math.max(0, Number(mbx.uidNext || 1) - 1);
            if (cursor >= snapshotMaxUid) {
                return {
                    messages: [] as RuleRunRawMessage[],
                    nextCursor: snapshotMaxUid,
                    maxUid: snapshotMaxUid,
                    uidValidity: String(mbx.uidValidity || ''),
                    done: true,
                };
            }

            const cappedBatchSize = Math.max(1, Math.min(batchSize, 200));
            const scanEnd = Math.min(
                snapshotMaxUid,
                cursor + Math.max(200, cappedBatchSize * 4),
            );
            const searchQuery: any = { uid: `${Math.max(1, cursor + 1)}:${scanEnd}` };
            if (readState === 'unread') searchQuery.seen = false;
            if (readState === 'read') searchQuery.seen = true;
            const found = await this.client.search(searchQuery, { uid: true });
            const candidates = (Array.isArray(found) ? found : [])
                .filter(uid => uid > cursor && uid <= scanEnd)
                .sort((a, b) => a - b);
            const batchUids = candidates.slice(0, cappedBatchSize);
            const messages: RuleRunRawMessage[] = [];

            if (batchUids.length > 0) {
                const fetchQuery: any = { uid: true, envelope: true, size: true };
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
        } finally {
            await this.client.mailboxClose();
        }
    }

    async applyRuleMoves(
        folderPath: string,
        plans: RuleMovePlan[],
        operationKey: string,
        ledger: RuleCopyLedger,
    ) {
        const affected = new Set<number>();
        const result: RuleMoveApplyResult = { affected: 0, copied: 0, moved: 0, movedUids: [] };
        const normalizedPlans = plans
            .map(plan => ({
                uid: plan.uid,
                destinations: plan.moveFolders
                    .filter(destination => destination && destination !== folderPath)
                    .reduce<string[]>((ordered, destination) => (
                        [...ordered.filter(current => current !== destination), destination]
                    ), []),
            }))
            .filter(plan => Number.isInteger(plan.uid) && plan.uid > 0 && plan.destinations.length > 0);
        const copyActions: RuleCopyLedgerAction[] = normalizedPlans.flatMap(plan => (
            plan.destinations.slice(0, -1).map(destination => ({
                actionKey: crypto
                    .createHash('sha256')
                    .update(`${operationKey}\0${plan.uid}\0${destination}`)
                    .digest('hex'),
                operationKey,
                uid: plan.uid,
                destination,
            }))
        ));
        const actionsByUid = new Map<number, RuleCopyLedgerAction[]>();
        for (const action of copyActions) {
            actionsByUid.set(action.uid, [...(actionsByUid.get(action.uid) || []), action]);
        }
        let mailboxOpen = false;
        let operationError: RuleMoveApplyError | null = null;
        try {
            await this.client.mailboxOpen(folderPath);
            mailboxOpen = true;
            const requestedUids = [...new Set(normalizedPlans.map(plan => plan.uid))];
            const found = requestedUids.length > 0
                ? await this.client.search({ uid: requestedUids.join(',') }, { uid: true })
                : [];
            if (!Array.isArray(found)) throw new Error('Unable to verify rule-run source messages.');
            const existingUids = new Set(found.map(Number));
            const missingUids = requestedUids.filter(uid => !existingUids.has(uid));
            const missingActions = missingUids.flatMap(uid => actionsByUid.get(uid) || []);
            if (missingActions.length > 0) await ledger.clear(missingActions);
            result.movedUids.push(...missingUids);

            const pendingCopies = await ledger.pendingForSourceUids([...existingUids]);
            if (pendingCopies.length > 0) {
                pendingCopies.forEach(action => affected.add(action.uid));
                throw new RuleMoveApplyError(
                    result,
                    new Error('A prior copy result is still uncertain.'),
                    false,
                    pendingCopies,
                );
            }

            const existingCopyActions = copyActions.filter(action => existingUids.has(action.uid));
            const copiesByDestination = new Map<string, RuleCopyLedgerAction[]>();
            for (const action of existingCopyActions) {
                copiesByDestination.set(
                    action.destination,
                    [...(copiesByDestination.get(action.destination) || []), action],
                );
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
                    throw new RuleMoveApplyError(
                        result,
                        new Error('A prior copy result is still uncertain.'),
                        false,
                        reservation.pending,
                    );
                }
                const ready = actions.filter(action => reservation.ready.has(action.actionKey));
                if (ready.length === 0) continue;
                ready.forEach(action => affected.add(action.uid));
                let copied: unknown;
                try {
                    copied = await this.client.messageCopy(
                        ready.map(action => action.uid).join(','),
                        destination,
                        { uid: true },
                    );
                } catch (err) {
                    throw new RuleMoveApplyError(result, err, false, ready);
                }
                if (!copied) {
                    throw new RuleMoveApplyError(
                        result,
                        new Error('Unable to confirm a continued rule copy.'),
                        false,
                        ready,
                    );
                }
                try {
                    await ledger.complete(ready, reservation.token);
                } catch (err) {
                    throw new RuleMoveApplyError(result, err, false, ready);
                }
                result.copied += ready.length;
            }

            const movesByDestination = new Map<string, number[]>();
            for (const plan of normalizedPlans) {
                if (!existingUids.has(plan.uid)) continue;
                const destination = plan.destinations.at(-1);
                if (!destination) continue;
                movesByDestination.set(
                    destination,
                    [...(movesByDestination.get(destination) || []), plan.uid],
                );
            }
            for (const [destination, uids] of movesByDestination) {
                try {
                    const moved = await this.client.messageMove(
                        uids.join(','),
                        destination,
                        { uid: true },
                    );
                    if (!moved) throw new Error('Unable to move rule-matched messages.');
                    result.moved += uids.length;
                    result.movedUids.push(...uids);
                    uids.forEach(uid => affected.add(uid));
                } catch (err) {
                    const remaining = await this.client.search(
                        { uid: uids.join(',') },
                        { uid: true },
                    );
                    if (Array.isArray(remaining)) {
                        const remainingSet = new Set(remaining.map(Number));
                        const reconciled = uids.filter(uid => !remainingSet.has(uid));
                        result.moved += reconciled.length;
                        result.movedUids.push(...reconciled);
                        reconciled.forEach(uid => affected.add(uid));
                        const reconciledActions = reconciled.flatMap(uid => actionsByUid.get(uid) || []);
                        if (reconciledActions.length > 0) {
                            try { await ledger.clear(reconciledActions); } catch {}
                        }
                    }
                    throw err;
                }
                const movedActions = uids.flatMap(uid => actionsByUid.get(uid) || []);
                if (movedActions.length > 0) {
                    try {
                        await ledger.clear(movedActions);
                    } catch (err) {
                        console.warn('Failed to clear completed rule-copy ledger rows:', err);
                    }
                }
            }
        } catch (err) {
            result.affected = affected.size;
            operationError = err instanceof RuleMoveApplyError
                ? err
                : new RuleMoveApplyError(result, err);
        } finally {
            if (mailboxOpen) {
                try {
                    await this.client.mailboxClose();
                } catch (err) {
                    result.affected = affected.size;
                    operationError ||= new RuleMoveApplyError(result, err);
                }
            }
        }

        if (operationError) throw operationError;
        result.affected = affected.size;
        return result;
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

    async getActiveSyncMailboxCursor(folderPath: string): Promise<{
        uidValidity: string;
        highestModseq: string;
    }> {
        const mailbox = await this.client.mailboxOpen(folderPath, { readOnly: true });
        try {
            return {
                uidValidity: String(mailbox.uidValidity || '0'),
                highestModseq: String(mailbox.highestModseq || '0'),
            };
        } finally {
            await this.client.mailboxClose();
        }
    }

    async getActiveSyncMailSnapshot(
        folderPath: string,
        cutoff: Date | null,
        sinceModseq: string,
        knownUids: number[],
        forceFullSnapshot = false,
    ): Promise<ActiveSyncMailSnapshot> {
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
                const exact: number[] = [];
                if (Array.isArray(candidates) && candidates.length > 0) {
                    for await (const msg of this.client.fetch(candidates, { uid: true, internalDate: true }, { uid: true })) {
                        if (msg.internalDate && new Date(msg.internalDate).getTime() >= cutoff.getTime()) exact.push(msg.uid);
                    }
                }
                eligibleUids = exact;
            }

            const changedReadFlags: Record<string, 0 | 1> = {};
            if (mbx.highestModseq && parsedModseq > 0n && parsedModseq <= mbx.highestModseq) {
                for await (const msg of this.client.fetch('1:*', { uid: true, flags: true }, { changedSince: parsedModseq, uid: true })) {
                    changedReadFlags[String(msg.uid)] = msg.flags?.has('\\Seen') ? 1 : 0;
                }
            } else if (knownUids.length > 0) {
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
        } finally {
            await this.client.mailboxClose();
        }
    }

    async getActiveSyncMessages(
        folderPath: string,
        uids: number[],
        maxSourceBytes: number,
    ): Promise<ActiveSyncMailMessage[]> {
        if (uids.length === 0) return [];
        await this.client.mailboxOpen(folderPath);
        const messages = new Map<number, ActiveSyncMailMessage>();
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
        } finally {
            await this.client.mailboxClose();
        }
        return uids.map(uid => messages.get(uid)).filter((message): message is ActiveSyncMailMessage => Boolean(message));
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
            } else if (normalized === 'has:attachment') {
                searchQuery.or = [
                    { body: 'Content-Disposition: attachment' },
                    { body: 'filename=' },
                ];
            } else if (normalized.startsWith('before:') && token.length > 7) {
                const date = new Date(`${token.slice(7).replace(/^"|"$/g, '')}T00:00:00.000Z`);
                if (Number.isNaN(date.getTime())) terms.push(value);
                else searchQuery.sentBefore = date;
            } else if (normalized.startsWith('after:') && token.length > 6) {
                const date = new Date(`${token.slice(6).replace(/^"|"$/g, '')}T00:00:00.000Z`);
                if (Number.isNaN(date.getTime())) terms.push(value);
                else searchQuery.sentSince = date;
            } else {
                terms.push(value);
            }
        }

        if (terms.length > 0) {
            searchQuery.text = terms.join(' ');
        }

        return Object.keys(searchQuery).length > 0 ? searchQuery : { text: query };
    }

    async searchMessages(
        folderPaths: string[],
        query: string,
        field: MailSearchField = 'all',
        limit = 50,
        shouldStop: () => boolean = () => false,
    ) {
        const searchQuery = this.buildSearchQuery(query, field);
        const cappedLimit = Math.max(1, Math.min(limit, 100));
        const candidates: any[] = [];
        const failedFolders: string[] = [];
        const partialFolders = new Set<string>();
        const verifyAttachments = field === 'attachments' || /(?:^|\s)has:attachment(?:\s|$)/i.test(query);

        for (const folderPath of folderPaths) {
            if (shouldStop()) break;
            try {
                await this.client.mailboxOpen(folderPath);
                try {
                    const found = await this.client.search(searchQuery, { uid: true });
                    if (!Array.isArray(found) || found.length === 0) continue;

                    if (verifyAttachments && found.length > cappedLimit) partialFolders.add(folderPath);
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
                } finally {
                    await this.client.mailboxClose();
                }
            } catch (err) {
                try { await this.client.mailboxClose(); } catch (e) {}
                failedFolders.push(folderPath);
                console.error(`Failed to search folder ${folderPath}:`, err);
            }
        }

        const selected = candidates
            .sort((a, b) => (
                new Date(b.envelope?.date || 0).getTime() - new Date(a.envelope?.date || 0).getTime()
                || b.uid - a.uid
            ))
            .slice(0, cappedLimit);
        if (!verifyAttachments) {
            return { messages: selected, failedFolders, partialFolders: [...partialFolders] };
        }

        const maxMessageBytes = 1024 * 1024;
        let remainingBytes = 8 * 1024 * 1024;
        const messages: any[] = [];
        const selectedByFolder = new Map<string, any[]>();
        for (const message of selected) {
            const folderMessages = selectedByFolder.get(message.folder) || [];
            folderMessages.push(message);
            selectedByFolder.set(message.folder, folderMessages);
        }
        for (const [folderPath, folderMessages] of selectedByFolder) {
            if (shouldStop()) break;
            try {
                await this.client.mailboxOpen(folderPath);
                try {
                    for (const candidate of folderMessages) {
                        if (shouldStop()) break;
                        const size = candidate.size || maxMessageBytes;
                        if (size > maxMessageBytes || size > remainingBytes) {
                            partialFolders.add(folderPath);
                            continue;
                        }
                        for await (const message of this.client.fetch(
                            [candidate.uid],
                            { source: { start: 0, maxLength: size }, uid: true, size: true },
                            { uid: true },
                        )) {
                            const source = message.source || Buffer.alloc(0);
                            if (source.length < Number(message.size || size)) {
                                partialFolders.add(folderPath);
                                continue;
                            }
                            remainingBytes -= source.length;
                            messages.push({ ...candidate, source });
                        }
                    }
                } finally {
                    await this.client.mailboxClose();
                }
            } catch (err) {
                try { await this.client.mailboxClose(); } catch (e) {}
                if (!failedFolders.includes(folderPath)) failedFolders.push(folderPath);
                console.error(`Failed to verify attachment search results in folder ${folderPath}:`, err);
            }
        }
        return { messages, failedFolders, partialFolders: [...partialFolders] };
    }

    async getExistingUidStates(folderPath: string, uids: number[]) {
        const candidates = [...new Set(uids.filter(uid => Number.isInteger(uid) && uid > 0))];
        if (candidates.length === 0) return [];

        await this.client.mailboxOpen(folderPath);
        try {
            const messages: Array<{ uid: number; flags: string[] }> = [];
            for await (const message of this.client.fetch(candidates, { uid: true, flags: true }, { uid: true })) {
                messages.push({ uid: message.uid, flags: Array.from(message.flags || []) });
            }
            return messages;
        } finally {
            await this.client.mailboxClose();
        }
    }

    async getFolderUidNext(folderPaths: string[]) {
        const snapshot = await this.getSearchFolderSnapshot();
        const uidNextByFolder = new Map<string, number>();
        const uidValidityByFolder = new Map<string, string>();
        const failedFolders: string[] = [];
        for (const folderPath of new Set(folderPaths)) {
            const uidNext = snapshot.uidNextByFolder.get(folderPath);
            const uidValidity = snapshot.uidValidityByFolder.get(folderPath);
            if (uidNext !== undefined && uidValidity) {
                uidNextByFolder.set(folderPath, uidNext);
                uidValidityByFolder.set(folderPath, uidValidity);
            } else {
                failedFolders.push(folderPath);
            }
        }
        return { uidNextByFolder, uidValidityByFolder, failedFolders };
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
        let moreAvailable = false;

        try {
            const found = await this.client.search({ uid: `${Math.max(1, minUid)}:*` }, { uid: true });
            if (!Array.isArray(found) || found.length === 0) return { messages, moreAvailable: false };

            const matchingUids = found.filter(uid => uid >= minUid);
            const batchUids = matchingUids.slice(0, cappedLimit);
            moreAvailable = matchingUids.length > batchUids.length;
            if (batchUids.length === 0) return { messages, moreAvailable: false };

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

        return { messages, moreAvailable };
    }

    async getQuota() {
        try {
            return await this.client.getQuota();
        } catch (e) {
            console.error('Failed to get quota:', e);
            return null;
        }
    }

    async getMessageByUid(folderPath: string, uid: number, maxSourceBytes?: number) {
        await this.client.mailboxOpen(folderPath);
        try {
            const bounded = Number.isFinite(maxSourceBytes) && Number(maxSourceBytes) > 0;
            const sourceLimit = bounded ? Math.max(1, Math.floor(Number(maxSourceBytes))) : 0;
            const query: any = {
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
        } finally {
            await this.client.mailboxClose();
        }
    }

    async appendMessage(folderPath: string, content: string | Buffer, flags?: string[]) {
        await this.client.append(folderPath, content, flags);
    }

    async moveMessage(sourceFolder: string, targetFolder: string, uid: number) {
        await this.client.mailboxOpen(sourceFolder);
        await this.client.messageMove(uid.toString(), targetFolder, { uid: true });
        await this.client.mailboxClose();
    }

    async messageAction(folderPath: string, uids: number[], action: 'delete' | 'hardDelete' | 'archive' | 'spam' | 'move' | 'read' | 'unread' | 'star' | 'unstar', targetFolder?: string) {
        if (uids.length === 0) return null;
        
        await this.client.mailboxOpen(folderPath);
        const sequence = uids.join(',');
        
        try {
            if (action === 'hardDelete') {
                await this.client.messageDelete(sequence, { uid: true });
                return null;
            } else if (action === 'delete') {
                // Try to move to Trash first
                let trashFolder = 'Trash';
                const folders = await this.client.list();
                const existingTrash = folders.find(f => f.path.toLowerCase() === 'trash');
                if (!existingTrash) {
                    try { await this.client.mailboxCreate('Trash'); } catch(e) {}
                } else {
                    trashFolder = existingTrash.path;
                }
                if (folderPath.toLowerCase() === trashFolder.toLowerCase()) {
                    await this.client.messageDelete(sequence, { uid: true });
                    return null;
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
                const existing = folders.find(f => (
                    typeof f.specialUse === 'string' && f.specialUse.toLowerCase() === '\\junk'
                )) || folders.find(f => mailboxSpecialUse(f)?.toLowerCase() === '\\junk')
                    || folders.find(f => f.path.toLowerCase() === 'junk');
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
