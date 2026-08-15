import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import express from 'express';
import bodyParser from 'body-parser';
import { WbxmlParser } from './wbxml/parser';
import { WbxmlWriter } from './wbxml/writer';
import { ImapService } from './imap';
import { apiRouter } from './api';
import cors from 'cors';
import nodemailer from 'nodemailer';
import { pool } from './db';
import { getPublicBaseUrl, normalizeMailboxUsername, serverConfig, smtpTransportOptions } from './config';
import { rateLimit, securityHeaders } from './security';
import { ensureMailSearchSchema } from './search-index';
import { ensureUserSettingsSchema } from './user-settings';
import { ensureAdminSettingsSchema } from './admin-settings';
import { ensureBrandingSchema } from './branding';
import { ensureCalendarSchema, ensureDefaultCalendar, getCalendarFolderSyncKey, getVisibleCalendars } from './calendar-utils';
import { repairAllBirthdayCalendarProjections } from './birthday-calendar';
import { startApplicationAfterRequiredMigrations } from './application-startup';
import {
    acquireContactMutationLock,
    deleteContactByDavUidOnConnection,
    ensureContactsSchema,
    getEasContactByDavUidOnConnection,
    normalizeDavUid,
    releaseContactMutationLock,
    saveContactFromVCardOnConnection,
    type ContactMutationLockLease,
} from './contact-utils';
import { ensureNotesSchema, ensureRemindersSchema, ensureAttachmentsSchema } from './notes-utils';
import {
    ActiveSyncContactFieldError,
    ActiveSyncContactPictureError,
    activeSyncContactApplicationDataToVCard,
    contactToActiveSyncApplicationData,
} from './eas-contacts';
import { ActiveSyncCalendarFieldError, activeSyncCalendarApplicationDataToIcal, canWriteActiveSyncCalendar, normalizeCalendarEventUid, resolveActiveSyncCalendarAccessRole } from './eas-calendar';
import { projectStoredCalendarPimCommand } from './eas-calendar-sync-projection';
import {
    acquireActiveSyncCalendarLock,
    deleteActiveSyncCalendarEventInTransaction,
    releaseActiveSyncCalendarLock,
    saveActiveSyncCalendarEventInTransaction,
    type ActiveSyncCalendarLockLease,
} from './eas-calendar-persistence';
import {
    parseActiveSyncGetChanges,
    singleActiveSyncCollection,
    validateActiveSyncCollectionRequest,
} from './eas-sync';
import {
    activeSyncMailApplicationData,
    computeMailSyncDelta,
    createMailSyncKey,
    deleteMailSyncState,
    effectiveMailSyncWindow,
    ensureEasMailSyncSchema,
    filterTypeCutoff,
    loadMailSyncState,
    mailSyncReplayResponse,
    mailSyncRequestHash,
    mailSyncScopeHash,
    MAX_MAIL_SYNC_REPLAY_BYTES,
    MAX_MAIL_SYNC_RESPONSE_BYTES,
    MailSyncStateError,
    normalizeMailSyncOptions,
    resolveActiveSyncWindowSize,
    saveMailSyncState,
    validateMailClientCommands,
    validateActiveSyncDeviceId,
    withMailSyncScopeLock,
    type MailSyncCommand,
    type MailSyncKnownItems,
    type StoredMailSyncState,
} from './eas-mail-sync';
import {
    MAX_PIM_SYNC_RESPONSE_BYTES,
    MAX_PIM_ITEM_SOURCE_BYTES,
    PimSyncLimitError,
    PimSyncStateError,
    applyAcceptedPimWrites,
    advancePimKnownItems,
    assertPimKnownItemsBound,
    computePimSyncDelta,
    createPimSyncKey,
    deletePimSyncStateOnConnection,
    deterministicPimAddServerId,
    ensureEasPimSyncSchema,
    loadPimSyncStateOnConnection,
    loadBoundedCalendarPimSnapshot,
    loadBoundedContactPimSnapshot,
    normalizePimQuarantineState,
    pimOmittedFieldsToClear,
    pimSyncReplayResponse,
    pimSyncRequestHash,
    pimSyncScopeHash,
    pimSyncStateDisposition,
    pimWireServerId,
    parsePimSupportedProperties,
    savePimSyncStateOnConnection,
    validatePimClientCommands,
    withPimSqlTransaction,
    withPimSyncScopeLock,
    type PimSnapshotMetadata,
    type PimSyncCommand,
    type StoredPimSyncState,
} from './eas-pim-sync';
import { buildActiveSyncSendMailEnvelope, extractActiveSyncSendMailMime } from './eas-send';
import {
    ACTIVE_SYNC_ADVERTISED_COMMANDS,
    ACTIVE_SYNC_MAX_REQUEST_BYTES,
    ACTIVE_SYNC_UNSUPPORTED_COMMANDS,
    activeSyncMailCollectionId,
    activeSyncMailMessageServerId,
    activeSyncMailMessageUid,
    activeSyncMailParentId,
    activeSyncRequestLogSummary,
    classifyActiveSyncCollection,
    isActiveSyncAuthenticationFailure,
    parseActiveSyncFolderSyncRequest,
    resolveActiveSyncMailFolderPath,
    staticActiveSyncServiceFolders,
    unsupportedSyncCollectionResponse,
} from './eas-protocol';
import {
    ITEM_OPERATIONS_MAX_AGGREGATE_SOURCE_BYTES,
    ITEM_OPERATIONS_MAX_BODY_BYTES,
    ITEM_OPERATIONS_MAX_FETCHES,
    ITEM_OPERATIONS_MAX_RESPONSE_BODY_BYTES,
    itemOperationsBodyAllowance,
    itemOperationsFetchRequest,
    itemOperationsFetchError,
    itemOperationsFetchBodyBytes,
    itemOperationsFetchSuccess,
    itemOperationsMailboxTarget,
    itemOperationsRequestFetches,
    itemOperationsSourceAllowance,
} from './eas-item-operations';
import { startSearchWorker } from './search-worker';
import { ensureScheduledEmailsSchema, startScheduledSender } from './scheduled-send';
import { ensureCalendarSubscriptionSchema, startCalendarSubscriptionWorker } from './calendar-subscription';
import { schedulerRouter } from './scheduler/router';
import { getSession, initializeSessionStore, requireSession } from './auth';
import { ensureAccountSecuritySchema } from './account-security';
import { createMozillaAutoconfigRouter } from './mail-autoconfig';
import { installNotesSignalingServer } from './notes-collaboration';

const app = express();
const server = http.createServer(app);
export const io = new SocketIOServer(server, {
    cors: { origin: true, credentials: true }
});

installNotesSignalingServer(server, {
    enabled: serverConfig.notesCollaborationEnabled,
    secret: serverConfig.sessionSecret,
    authenticate: async request => {
        const session = await getSession(request);
        return session ? { owner: session.username, sessionId: session.id } : null;
    },
});

io.on('connection', (socket) => {
    socket.on('join', async () => {
        try {
            const session = await getSession(socket.request);
            if (session?.username) {
                socket.join(session.username);
            }
        } catch (err) {
            if (process.env.NODE_ENV !== 'test') {
                console.error('Failed to authorize socket join:', err);
            }
        }
    });
});
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(securityHeaders);
app.use('/Microsoft-Server-ActiveSync', bodyParser.raw({
    type: () => true,
    limit: `${ACTIVE_SYNC_MAX_REQUEST_BYTES}b`,
}));
app.use(express.json({ limit: `${serverConfig.uploadLimitBytes}b` }));
app.use(bodyParser.raw({
    type: (req: any) => {
        const contentType = String(req.headers['content-type'] || '').toLowerCase();
        return !req.url.startsWith('/api/')
            && !req.url.startsWith('/Microsoft-Server-ActiveSync')
            && !contentType.includes('multipart/form-data');
    },
    limit: `${serverConfig.uploadLimitBytes}b`
}));

import * as path from 'path';
app.use('/uploads', (req, res, next) => {
    requireSession(req, res, () => {
        next();
    });
}, express.static(path.join(__dirname, '..', 'uploads')));

import caldavRouter from './caldav';
import carddavRouter from './carddav';
import { appsApiRouter } from './apps-api';

const CONTACTS_COLLECTION_ID = 'contacts';

const nodeText = (node: any): string => node?.content ? node.content.toString() : '';
const childNode = (node: any, tag: string): any => node?.children?.find((child: any) => child.tag === tag);
const childText = (node: any, tag: string): string => nodeText(childNode(node, tag));
const firstNonEmpty = (...values: string[]): string => values.map(value => value.trim()).find(Boolean) || '';

function activeSyncCollectionResponseBuffer(
    collectionId: string,
    syncKey: string,
    status: string,
    responses: any[] = [],
    commands: any[] = [],
    moreAvailable = false,
): Buffer {
    const writer = new WbxmlWriter();
    writer.writeNode({
        tag: 'Sync', page: 0, children: [{
            tag: 'Collections', page: 0, children: [{
                tag: 'Collection', page: 0, children: [
                    { tag: 'SyncKey', page: 0, content: syncKey },
                    { tag: 'CollectionId', page: 0, content: collectionId },
                    { tag: 'Status', page: 0, content: status },
                    ...(moreAvailable ? [{ tag: 'MoreAvailable', page: 0, children: [] }] : []),
                    ...(responses.length ? [{ tag: 'Responses', page: 0, children: responses }] : []),
                    ...(commands.length ? [{ tag: 'Commands', page: 0, children: commands }] : []),
                ],
            }],
        }],
    });
    return writer.getBuffer();
}

function activeSyncRootStatusBuffer(status: string): Buffer {
    const writer = new WbxmlWriter();
    writer.writeNode({ tag: 'Sync', page: 0, children: [{ tag: 'Status', page: 0, content: status }] });
    return writer.getBuffer();
}

function activeSyncNodeEncodedBytes(node: any): number {
    const writer = new WbxmlWriter();
    writer.writeNode(node);
    return writer.getBuffer().length;
}

async function renderPimCommandPage(
    commands: PimSyncCommand[],
    baseResponseBytes: number,
    render: (command: PimSyncCommand) => any | Promise<any>,
): Promise<{ commands: PimSyncCommand[]; nodes: any[]; moreAvailable: boolean }> {
    const emitted: PimSyncCommand[] = [];
    const nodes: any[] = [];
    let used = baseResponseBytes + 16;
    for (const command of commands) {
        const rendered = await render(command);
        const wrapped = rendered && typeof rendered === 'object' && Object.hasOwn(rendered, 'pimNode');
        const node = wrapped ? rendered.pimNode : rendered;
        const effectiveCommand = wrapped && rendered.command ? rendered.command : command;
        if (!node) {
            if (wrapped) rendered.accept?.();
            continue;
        }
        const bytes = activeSyncNodeEncodedBytes(node);
        if (used + bytes > MAX_PIM_SYNC_RESPONSE_BYTES) {
            if (emitted.length === 0) throw new PimSyncLimitError('A PIM item exceeds the encoded response byte budget');
            return { commands: emitted, nodes, moreAvailable: true };
        }
        if (wrapped) rendered.accept?.();
        emitted.push(effectiveCommand);
        nodes.push(node);
        used += bytes;
    }
    return { commands: emitted, nodes, moreAvailable: false };
}

function boundedActiveSyncText(value: unknown, maxBytes = 8192): string {
    const source = Buffer.from(String(value || '').replace(/\0/g, '\uFFFD'), 'utf8');
    if (source.length <= maxBytes) return source.toString('utf8');
    let end = maxBytes;
    while (end > 0 && (source[end] & 0xC0) === 0x80) end -= 1;
    return source.subarray(0, end).toString('utf8');
}

function isContactsCollection(collectionId: string): boolean {
    return collectionId === CONTACTS_COLLECTION_ID;
}

app.use('/api/auth/login', rateLimit(15 * 60 * 1000, 20));
app.use('/api', cors({ credentials: true, origin: true }), apiRouter);
app.use('/api/apps', cors({ credentials: true, origin: true }), appsApiRouter);
app.use('/api', cors({ credentials: true, origin: true }), schedulerRouter);
app.use('/caldav', caldavRouter);

app.all('/', (req, res, next) => {
    if (req.method === 'PROPFIND') {
        res.redirect(301, '/carddav/');
        return;
    }
    next();
});

app.use('/carddav', carddavRouter);

app.all('/.well-known/caldav', (req, res) => {
    res.redirect(301, '/caldav/');
});

app.all('/.well-known/carddav', (req, res) => {
    res.redirect(301, '/carddav/');
});

const autoconfigDomain = serverConfig.defaultDomain || 'example.invalid';
const autoconfigMailHostname = serverConfig.publicBaseUrl
    ? new URL(serverConfig.publicBaseUrl).hostname
    : `mail.${autoconfigDomain}`;
app.use(createMozillaAutoconfigRouter({
    domain: serverConfig.defaultDomain || 'example.invalid',
    mailHostname: autoconfigMailHostname,
}));

app.all(['/autodiscover/autodiscover.xml', '/Autodiscover/Autodiscover.xml'], (req, res) => {
    let email = serverConfig.defaultDomain ? `user@${serverConfig.defaultDomain}` : 'user@example.invalid';
    if (req.body && req.body.length > 0) {
        const bodyStr = req.body.toString('utf8');
        const match = bodyStr.match(/<EMailAddress>(.*?)<\/EMailAddress>/i);
        if (match) email = match[1];
    }
    const publicBaseUrl = getPublicBaseUrl(req);
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/responseschema/2006">
  <Response xmlns="http://schemas.microsoft.com/exchange/autodiscover/mobilesync/responseschema/2006">
    <Culture>en:us</Culture>
    <User>
      <DisplayName>${email.split('@')[0]}</DisplayName>
      <EMailAddress>${email}</EMailAddress>
    </User>
    <Action>
      <Settings>
        <Server>
          <Type>MobileSync</Type>
          <Url>${publicBaseUrl}/Microsoft-Server-ActiveSync</Url>
          <Name>${publicBaseUrl}/Microsoft-Server-ActiveSync</Name>
        </Server>
      </Settings>
    </Action>
  </Response>
</Autodiscover>`;
    res.set('Content-Type', 'text/xml');
    res.status(200).send(xml);
});

app.all(['/Microsoft-Server-ActiveSync'], async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.set('MS-Server-ActiveSync', '14.1');
        res.set('MS-ASProtocolVersions', '14.0,14.1');
        res.set('MS-ASProtocolCommands', ACTIVE_SYNC_ADVERTISED_COMMANDS.join(','));
        res.set('Public', 'OPTIONS,POST');
        return res.status(200).send();
    }

    const requestBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (requestBody.length > ACTIVE_SYNC_MAX_REQUEST_BYTES) return res.status(413).send();
    
    // Helper to get auth from header
    function getAuthCredentials() {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Basic ')) {
            const b64 = authHeader.split(' ')[1];
            const parts = Buffer.from(b64 || '', 'base64').toString().split(':');
            let user = parts.shift() || '';
            const pass = parts.join(':');
            
            user = normalizeMailboxUsername(user);
            
            return { user, pass };
        }
        return null;
    }

    // Check command and respond
    const cmd = String(req.query.Cmd || '');
    const requestCredentials = getAuthCredentials();
    if (!requestCredentials) return res.status(401).send();
    const authenticationImap = new ImapService(requestCredentials.user, requestCredentials.pass, false);
    try {
        await authenticationImap.connect();
    } catch (error) {
        return res.status(isActiveSyncAuthenticationFailure(error) ? 401 : 503).send();
    } finally {
        try { await authenticationImap.logout(); } catch {}
    }

    let decodedForStructure: any = null;
    let requestParseFailed = false;
    if (requestBody.length > 0) {
        try {
            decodedForStructure = new WbxmlParser(requestBody).parse();
        } catch {
            requestParseFailed = true;
        }
    }
    console.log('[EAS] Request', JSON.stringify(activeSyncRequestLogSummary(
        req.method,
        cmd,
        requestBody.length,
        decodedForStructure,
        requestParseFailed,
    )));
    if (requestParseFailed) return res.status(400).send();
    if ((ACTIVE_SYNC_UNSUPPORTED_COMMANDS as readonly string[]).includes(cmd)) {
        return res.status(501).send();
    }

    if (cmd === 'FolderSync') {
        const folderRequest = parseActiveSyncFolderSyncRequest(decodedForStructure);
        const folderStatus = (status: string) => {
            const writer = new WbxmlWriter();
            writer.writeNode({
                tag: 'FolderSync', page: 7, children: [{ tag: 'Status', page: 7, content: status }],
            });
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(writer.getBuffer());
        };
        if (!folderRequest.ok) return folderStatus('10');
        const syncKey = folderRequest.syncKey;

        let responseAst: any;

        const creds = getAuthCredentials();
        if (!creds) {
            return res.status(401).send();
        }

        try {
            const imap = new ImapService(creds.user, creds.pass);
            let folders: any[];
            try {
                await imap.connect();
                folders = await imap.getFolders();
            } finally {
                try { await imap.logout(); } catch {}
            }
            const folderDescriptors: Array<{ serverId: string; displayName: string; type: string }> = [];

            const mailNodes = folders.map((f: any) => {
                const path = f.path;
                // Type mapping
                let type = "12"; // User-created Mail folder
                if (path.toUpperCase() === 'INBOX') type = "2";
                else if (path.toUpperCase() === 'DRAFTS') type = "3";
                else if (path.toUpperCase() === 'TRASH' || path.toUpperCase() === 'DELETED MESSAGES') type = "4";
                else if (path.toUpperCase() === 'SENT' || path.toUpperCase() === 'SENT MESSAGES') type = "5";
                else if (path.toUpperCase() === 'JUNK') type = "12";

                // Calculate parent / display name
                let parentId = "0";
                let displayName = path;
                const delimiter = typeof f.delimiter === 'string' ? f.delimiter : '';
                if (delimiter && path.includes(delimiter)) {
                    displayName = path.slice(path.lastIndexOf(delimiter) + delimiter.length);
                    parentId = activeSyncMailParentId({ path, delimiter });
                }

                displayName = boundedActiveSyncText(displayName);
                const serverId = activeSyncMailCollectionId(path);
                folderDescriptors.push({ serverId, displayName, type });

                return { tag: "Add", page: 7, children: [
                    { tag: "ServerId", page: 7, content: serverId },
                    { tag: "ParentId", page: 7, content: parentId },
                    { tag: "DisplayName", page: 7, content: displayName },
                    { tag: "Type", page: 7, content: type }
                ]};
            });

            const staticFolders = staticActiveSyncServiceFolders();
            const serviceFolders = staticFolders.map(folder => ({
                tag: 'Add', page: 7, children: [
                    { tag: 'ServerId', page: 7, content: folder.serverId },
                    { tag: 'ParentId', page: 7, content: folder.parentId },
                    { tag: 'DisplayName', page: 7, content: folder.displayName },
                    { tag: 'Type', page: 7, content: folder.type },
                ],
            }));
            folderDescriptors.push(...staticFolders.map(folder => ({
                serverId: folder.serverId,
                displayName: folder.displayName,
                type: folder.type,
            })));

            const defaultCalendar = await ensureDefaultCalendar(creds.user);
            const cals = await getVisibleCalendars(creds.user);
            for (const cal of cals) {
                const serverId = `cal-${cal.id}`;
                const displayName = boundedActiveSyncText(cal.name);
                const type = String(cal.id) === String(defaultCalendar.id) ? '8' : '13';
                folderDescriptors.push({ serverId, displayName, type });
                serviceFolders.push({
                    tag: "Add", page: 7, children: [
                        { tag: "ServerId", page: 7, content: serverId },
                        { tag: "ParentId", page: 7, content: "0" },
                        { tag: "DisplayName", page: 7, content: displayName },
                        { tag: "Type", page: 7, content: type }
                    ]
                });
            }

            const allNodes = [...mailNodes, ...serviceFolders];
            const currentSyncKey = getCalendarFolderSyncKey(folderDescriptors);

            if (syncKey !== "0" && syncKey === currentSyncKey) {
                console.log('[EAS] FolderSync hierarchy unchanged');
                responseAst = {
                    tag: "FolderSync",
                    page: 7,
                    children: [
                        { tag: "Status", page: 7, content: "1" },
                        { tag: "SyncKey", page: 7, content: currentSyncKey }
                    ]
                };
            } else if (syncKey !== "0") {
                console.log('[EAS] FolderSync rejected a stale hierarchy key');
                responseAst = {
                    tag: "FolderSync",
                    page: 7,
                    children: [
                        { tag: "Status", page: 7, content: "9" }
                    ]
                };
            } else {
                console.log(`[EAS] FolderSync returning ${allNodes.length} folders`);
                responseAst = {
                    tag: "FolderSync",
                    page: 7,
                    children: [
                        { tag: "Status", page: 7, content: "1" },
                        { tag: "SyncKey", page: 7, content: currentSyncKey },
                        { tag: "Changes", page: 7, children: [
                            { tag: "Count", page: 7, content: allNodes.length.toString() },
                            ...allNodes
                        ]}
                    ]
                };
            }
        } catch (err: any) {
            console.error('[EAS] FolderSync failed');
            if (isActiveSyncAuthenticationFailure(err)) return res.status(401).send();
            return folderStatus('6');
        }

        const writer = new WbxmlWriter();
        writer.writeNode(responseAst);
        const outBuffer = writer.getBuffer();
        
        console.log("Sending FolderSync response.");
        res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
        return res.status(200).send(outBuffer);
    }

    if (cmd === 'FolderCreate') {
        const auth = getAuthCredentials();
        if (!auth) return res.status(401).send();
        const decoded = new WbxmlParser(req.body).parse();
        const parentId = childText(decoded, 'ParentId') || '0';
        const displayName = childText(decoded, 'DisplayName') || 'New Folder';
        try {
            const imap = new ImapService(auth.user, auth.pass);
            await imap.connect();
            const separator = '/';
            const parentPath = parentId === '0' ? '' : parentId;
            const folderPath = parentPath ? `${parentPath}${separator}${displayName}` : displayName;
            await imap.client.mailboxCreate(folderPath);
            await imap.logout();
            const writer = new WbxmlWriter();
            writer.writeNode({
                tag: 'FolderCreate', page: 7, children: [
                    { tag: 'Status', page: 7, content: '1' },
                    { tag: 'ServerId', page: 7, content: folderPath },
                    { tag: 'ParentId', page: 7, content: parentId },
                    { tag: 'DisplayName', page: 7, content: displayName },
                    { tag: 'Type', page: 7, content: '1' }
                ]
            });
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(writer.getBuffer());
        } catch (e: any) {
            const writer = new WbxmlWriter();
            writer.writeNode({ tag: 'FolderCreate', page: 7, children: [{ tag: 'Status', page: 7, content: '8' }] });
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(writer.getBuffer());
        }
    }

    if (cmd === 'FolderDelete') {
        const auth = getAuthCredentials();
        if (!auth) return res.status(401).send();
        const decoded = new WbxmlParser(req.body).parse();
        const serverId = childText(decoded, 'ServerId') || '';
        try {
            const imap = new ImapService(auth.user, auth.pass);
            await imap.connect();
            await imap.client.mailboxDelete(serverId);
            await imap.logout();
            const writer = new WbxmlWriter();
            writer.writeNode({ tag: 'FolderDelete', page: 7, children: [{ tag: 'Status', page: 7, content: '1' }] });
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(writer.getBuffer());
        } catch (e: any) {
            const writer = new WbxmlWriter();
            writer.writeNode({ tag: 'FolderDelete', page: 7, children: [{ tag: 'Status', page: 7, content: '8' }] });
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(writer.getBuffer());
        }
    }

    if (cmd === 'FolderUpdate') {
        const auth = getAuthCredentials();
        if (!auth) return res.status(401).send();
        const decoded = new WbxmlParser(req.body).parse();
        const serverId = childText(decoded, 'ServerId') || '';
        const newName = childText(decoded, 'DisplayName') || '';
        try {
            const imap = new ImapService(auth.user, auth.pass);
            await imap.connect();
            const separator = '/';
            const parts = serverId.split(separator);
            parts[parts.length - 1] = newName;
            const newPath = parts.join(separator);
            await imap.client.mailboxRename(serverId, newPath);
            await imap.logout();
            const writer = new WbxmlWriter();
            writer.writeNode({ tag: 'FolderUpdate', page: 7, children: [
                { tag: 'Status', page: 7, content: '1' },
                { tag: 'ServerId', page: 7, content: newPath },
                { tag: 'DisplayName', page: 7, content: newName }
            ]});
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(writer.getBuffer());
        } catch (e: any) {
            const writer = new WbxmlWriter();
            writer.writeNode({ tag: 'FolderUpdate', page: 7, children: [{ tag: 'Status', page: 7, content: '8' }] });
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(writer.getBuffer());
        }
    }

    if (cmd === 'Provision') {
        let policyKey = "0";
        try {
            if (req.body && req.body.length > 0) {
                const parser = new WbxmlParser(req.body);
                const decoded = parser.parse();
                const polNode = decoded?.children?.find((c:any) => c.tag === 'Policies')
                                        ?.children?.find((c:any) => c.tag === 'Policy');
                if (polNode) {
                    const keyNode = polNode.children?.find((c:any) => c.tag === 'PolicyKey');
                    if (keyNode && keyNode.content) policyKey = keyNode.content.toString();
                }
            }
        } catch (e) {}

        let responseAst;
        if (policyKey === "0" || policyKey === "") {
            responseAst = {
                tag: "Provision", page: 14, children: [
                    { tag: "Status", page: 14, content: "1" },
                    { tag: "Policies", page: 14, children: [
                        { tag: "Policy", page: 14, children: [
                            { tag: "PolicyType", page: 14, content: "MS-EAS-Provisioning-WBXML" },
                            { tag: "Status", page: 14, content: "1" },
                            { tag: "PolicyKey", page: 14, content: "1234567890" },
                            { tag: "Data", page: 14, children: [
                                { tag: "EASProvisionDoc", page: 14, children: [
                                    { tag: "AllowBrowser", page: 14, content: "1" },
                                    { tag: "AllowCamera", page: 14, content: "1" }
                                ]}
                            ]}
                        ]}
                    ]}
                ]
            };
        } else {
            responseAst = {
                tag: "Provision", page: 14, children: [
                    { tag: "Status", page: 14, content: "1" },
                    { tag: "Policies", page: 14, children: [
                        { tag: "Policy", page: 14, children: [
                            { tag: "PolicyType", page: 14, content: "MS-EAS-Provisioning-WBXML" },
                            { tag: "Status", page: 14, content: "1" },
                            { tag: "PolicyKey", page: 14, content: policyKey }
                        ]}
                    ]}
                ]
            };
        }
        const writer = new WbxmlWriter();
        writer.writeNode(responseAst);
        res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
        return res.status(200).send(writer.getBuffer());
    }

    if (cmd === 'Sync') {
        const collectionResult = singleActiveSyncCollection(decodedForStructure);
        if (collectionResult.ok === false) {
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(activeSyncRootStatusBuffer(collectionResult.status));
        }
        const syncCollectionNode = collectionResult.collection;
        if (!validateActiveSyncCollectionRequest(syncCollectionNode).ok) {
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(activeSyncRootStatusBuffer('4'));
        }
        const collectionId = childText(syncCollectionNode, 'CollectionId');
        const syncKeyNode = childNode(syncCollectionNode, 'SyncKey');
        const syncKey = nodeText(syncKeyNode);
        if (!collectionId || !syncKeyNode || !syncKey) {
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(activeSyncRootStatusBuffer('4'));
        }

        if (isContactsCollection(collectionId)) {
            const creds = getAuthCredentials();
            if (!creds) return res.status(401).send();
            const deviceId = validateActiveSyncDeviceId(req.query.DeviceId);
            if (!deviceId) return res.status(400).send();
            const scopeHash = pimSyncScopeHash(creds.user, deviceId, collectionId);
            const requestHash = pimSyncRequestHash(requestBody);
            const sendContactsStatus = (status: string, responseSyncKey = syncKey) => {
                res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                return res.status(200).send(activeSyncCollectionResponseBuffer(collectionId, responseSyncKey, status));
            };
            const supported = syncKey === '0'
                ? parsePimSupportedProperties(syncCollectionNode, 'Contacts')
                : { ok: true as const, value: { wasPresent: false, fields: [] as string[] } };
            if (!supported.ok) return sendContactsStatus('4');
            await ensureContactsSchema();

            return withPimSyncScopeLock(scopeHash, async () => {
                const contactEvents: Array<{ davUid: string; deleted?: boolean }> = [];
                try {
                    const result = await withPimSqlTransaction(creds.user, async connection => {
                    const contactsStatusBuffer = (status: string, responseSyncKey = syncKey) =>
                        activeSyncCollectionResponseBuffer(collectionId, responseSyncKey, status);
                    let state: StoredPimSyncState | null;
                    try {
                        state = await loadPimSyncStateOnConnection(connection, creds.user, deviceId, collectionId);
                    } catch (error) {
                        if (!(error instanceof PimSyncLimitError || error instanceof PimSyncStateError)) throw error;
                        if (syncKey !== '0') return { responseBuffer: contactsStatusBuffer('3'), commandCount: 0, responseCount: 0 };
                        await deletePimSyncStateOnConnection(connection, creds.user, deviceId, collectionId);
                        state = null;
                    }
                    const replayResponse = pimSyncReplayResponse(state, syncKey, requestHash);
                    if (replayResponse) {
                        return { responseBuffer: replayResponse, commandCount: 0, responseCount: 0 };
                    }
                    if (pimSyncStateDisposition(state, syncKey) === 'stale') {
                        return { responseBuffer: contactsStatusBuffer('3'), commandCount: 0, responseCount: 0 };
                    }

                    const commandContainers = syncCollectionNode.children?.filter((node: any) => node.tag === 'Commands') || [];
                    const commandsNode = commandContainers[0];
                    const requestCommands = commandsNode?.children || [];
                    const getChanges = parseActiveSyncGetChanges(syncKey, childNode(syncCollectionNode, 'GetChanges'));
                    let windowSize: number;
                    try {
                        windowSize = resolveActiveSyncWindowSize(
                            syncKey,
                            childNode(syncCollectionNode, 'WindowSize') ? childText(syncCollectionNode, 'WindowSize') : undefined,
                            state?.windowSize,
                        );
                    } catch {
                        return { responseBuffer: contactsStatusBuffer('4'), commandCount: 0, responseCount: 0 };
                    }
                    if (!getChanges.ok || commandContainers.length > 1
                        || (commandsNode && !Array.isArray(commandsNode.children))
                        || !validatePimClientCommands(requestCommands, 'Contacts').ok) {
                        return { responseBuffer: contactsStatusBuffer('4'), commandCount: 0, responseCount: 0 };
                    }

                    if (syncKey === '0') {
                        if (commandsNode) return { responseBuffer: contactsStatusBuffer('4'), commandCount: 0, responseCount: 0 };
                        const nextSyncKey = createPimSyncKey();
                        const responseBuffer = activeSyncCollectionResponseBuffer(collectionId, nextSyncKey, '1');
                        state = {
                            scopeHash,
                            username: creds.user,
                            deviceId,
                            collectionId,
                            currentSyncKey: nextSyncKey,
                            previousSyncKey: '0',
                            windowSize,
                            supportedWasPresent: supported.value.wasPresent,
                            supportedFields: supported.value.fields,
                            knownItems: {},
                            lastCommands: [],
                            lastMoreAvailable: false,
                            lastRequestHash: requestHash,
                            lastResponse: responseBuffer,
                            updatedAt: new Date(),
                        } satisfies StoredPimSyncState;
                        await savePimSyncStateOnConnection(connection, state);
                        return { responseBuffer, commandCount: 0, responseCount: 0 };
                    }

                    const contactsBefore = await loadBoundedContactPimSnapshot(connection, creds.user, collectionId);
                    const snapshotBefore = contactsBefore.items;
                    const prospectiveKnown = Object.fromEntries(snapshotBefore.map(item => [item.serverId, item.fingerprint]));
                    for (const command of requestCommands.filter((node: any) => node.tag === 'Add')) {
                        const clientId = childText(command, 'ClientId');
                        if (clientId && childNode(command, 'ApplicationData')) {
                            const sourceId = deterministicPimAddServerId(scopeHash, syncKey, clientId);
                            prospectiveKnown[pimWireServerId(collectionId, sourceId)] = 'pending';
                        }
                    }
                    assertPimKnownItemsBound(prospectiveKnown);

                    const responses: any[] = [];
                    const acceptedUpsertIds = new Set<string>();
                    const acceptedDeletes: string[] = [];
                    const contactsByWireId = contactsBefore.byServerId;
                    for (const commandNode of requestCommands) {
                        const applicationData = childNode(commandNode, 'ApplicationData');
                        const instanceId = childText(commandNode, 'InstanceId');
                        if (instanceId) {
                            responses.push({ tag: commandNode.tag, page: 0, children: [
                                { tag: 'ServerId', page: 0, content: childText(commandNode, 'ServerId') },
                                { tag: 'Status', page: 0, content: '6' },
                            ] });
                            continue;
                        }
                        if (commandNode.tag === 'Add') {
                            const clientId = childText(commandNode, 'ClientId');
                            if (!clientId || !applicationData) {
                                responses.push({ tag: 'Add', page: 0, children: [
                                    ...(clientId ? [{ tag: 'ClientId', page: 0, content: clientId }] : []),
                                    { tag: 'Status', page: 0, content: '8' },
                                ] });
                                continue;
                            }
                            const davUid = deterministicPimAddServerId(scopeHash, syncKey, clientId);
                            const serverId = pimWireServerId(collectionId, davUid);
                            let vcard: string;
                            try {
                                vcard = activeSyncContactApplicationDataToVCard(davUid, applicationData);
                            } catch (error) {
                                if (!(error instanceof ActiveSyncContactPictureError || error instanceof ActiveSyncContactFieldError)) throw error;
                                responses.push({ tag: 'Add', page: 0, children: [
                                    { tag: 'ClientId', page: 0, content: clientId },
                                    { tag: 'Status', page: 0, content: '6' },
                                ] });
                                continue;
                            }
                            const saved = await saveContactFromVCardOnConnection(
                                connection, creds.user, davUid, vcard, null,
                            );
                            if (!saved) {
                                responses.push({ tag: 'Add', page: 0, children: [
                                    { tag: 'ClientId', page: 0, content: clientId },
                                    { tag: 'Status', page: 0, content: '7' },
                                ] });
                                continue;
                            }
                            acceptedUpsertIds.add(serverId);
                            contactEvents.push({ davUid });
                            responses.push({ tag: 'Add', page: 0, children: [
                                { tag: 'ClientId', page: 0, content: clientId },
                                { tag: 'ServerId', page: 0, content: serverId },
                                { tag: 'Status', page: 0, content: '1' },
                            ] });
                        } else if (commandNode.tag === 'Change') {
                            const serverId = childText(commandNode, 'ServerId');
                            const existingMetadata = contactsByWireId.get(serverId);
                            if (!serverId || !applicationData || !existingMetadata) {
                                responses.push({ tag: 'Change', page: 0, children: [
                                    ...(serverId ? [{ tag: 'ServerId', page: 0, content: serverId }] : []),
                                    { tag: 'Status', page: 0, content: '8' },
                                ] });
                                continue;
                            }
                            const davUid = existingMetadata.sourceId;
                            const existingContact = existingMetadata.versionToken === undefined
                                ? null
                                : await getEasContactByDavUidOnConnection(
                                    connection,
                                    creds.user,
                                    davUid,
                                    existingMetadata.versionToken,
                                    existingMetadata.sourceBytes,
                                );
                            if (!existingContact) throw new PimSyncStateError('PIM contact snapshot changed during mutation');
                            let vcard: string;
                            try {
                                vcard = activeSyncContactApplicationDataToVCard(
                                    davUid,
                                    applicationData,
                                    existingContact.vcard_data || '',
                                    pimOmittedFieldsToClear(applicationData, 'Contacts', {
                                        wasPresent: state!.supportedWasPresent,
                                        fields: state!.supportedFields,
                                    }),
                                );
                            } catch (error) {
                                if (!(error instanceof ActiveSyncContactPictureError || error instanceof ActiveSyncContactFieldError)) throw error;
                                responses.push({ tag: 'Change', page: 0, children: [
                                    { tag: 'ServerId', page: 0, content: serverId },
                                    { tag: 'Status', page: 0, content: '6' },
                                ] });
                                continue;
                            }
                            const saved = await saveContactFromVCardOnConnection(
                                connection, creds.user, davUid, vcard, existingMetadata.versionToken ?? null,
                            );
                            if (!saved) {
                                responses.push({ tag: 'Change', page: 0, children: [
                                    { tag: 'ServerId', page: 0, content: serverId },
                                    { tag: 'Status', page: 0, content: '7' },
                                ] });
                                continue;
                            }
                            acceptedUpsertIds.add(serverId);
                            contactEvents.push({ davUid });
                        } else {
                            const serverId = childText(commandNode, 'ServerId');
                            const existingMetadata = contactsByWireId.get(serverId);
                            const davUid = existingMetadata?.sourceId || '';
                            if (!serverId || !existingMetadata || existingMetadata.versionToken === undefined) {
                                responses.push({ tag: 'Delete', page: 0, children: [
                                    ...(serverId ? [{ tag: 'ServerId', page: 0, content: serverId }] : []),
                                    { tag: 'Status', page: 0, content: '8' },
                                ] });
                                continue;
                            }
                            if (!await deleteContactByDavUidOnConnection(
                                connection, creds.user, davUid, existingMetadata.versionToken,
                            )) {
                                responses.push({ tag: 'Delete', page: 0, children: [
                                    { tag: 'ServerId', page: 0, content: serverId },
                                    { tag: 'Status', page: 0, content: '7' },
                                ] });
                                continue;
                            }
                            acceptedDeletes.push(serverId);
                            contactEvents.push({ davUid, deleted: true });
                        }
                    }

                    const contactsAfter = await loadBoundedContactPimSnapshot(connection, creds.user, collectionId);
                    const snapshotAfter = contactsAfter.items;
                    const acceptedUpserts: Record<string, string> = Object.create(null);
                    for (const serverId of acceptedUpsertIds) {
                        const metadata = contactsAfter.byServerId.get(serverId);
                        if (!metadata) throw new PimSyncStateError('Accepted PIM contact is missing after mutation');
                        acceptedUpserts[serverId] = metadata.fingerprint;
                    }
                    let nextKnownItems = applyAcceptedPimWrites(
                        state!.knownItems,
                        acceptedUpserts,
                        acceptedDeletes,
                    );
                    const knownBeforeServerCommands = nextKnownItems;
                    let serverCommands: PimSyncCommand[] = [];
                    let moreAvailable = false;
                    if (getChanges.value) {
                        const delta = computePimSyncDelta({ knownItems: nextKnownItems, snapshot: snapshotAfter, windowSize });
                        serverCommands = delta.commands;
                        moreAvailable = delta.moreAvailable;
                    }
                    const renderContactCommand = async (command: PimSyncCommand) => {
                        if (command.type === 'Delete') {
                            return { tag: 'Delete', page: 0, children: [{ tag: 'ServerId', page: 0, content: command.serverId }] };
                        }
                        const metadata = contactsAfter.byServerId.get(command.serverId);
                        if (!metadata) throw new PimSyncStateError('PIM contact snapshot changed while rendering');
                        const contact = metadata.versionToken === undefined
                            ? null
                            : await getEasContactByDavUidOnConnection(
                                connection,
                                creds.user,
                                metadata.sourceId,
                                metadata.versionToken,
                                metadata.sourceBytes,
                            );
                        if (!contact) throw new PimSyncStateError('PIM contact snapshot changed while rendering');
                        return { tag: command.type, page: 0, children: [
                            { tag: 'ServerId', page: 0, content: command.serverId },
                            { tag: 'ApplicationData', page: 0, children: contactToActiveSyncApplicationData(contact, contact.vcard_data || '') },
                        ] };
                    };
                    const nextSyncKey = createPimSyncKey();
                    const baseResponseBytes = activeSyncCollectionResponseBuffer(
                        collectionId, nextSyncKey, '1', responses, [], true,
                    ).length;
                    const page = await renderPimCommandPage(serverCommands, baseResponseBytes, renderContactCommand);
                    serverCommands = page.commands;
                    const commandNodes = page.nodes;
                    moreAvailable = moreAvailable || page.moreAvailable;
                    nextKnownItems = advancePimKnownItems(knownBeforeServerCommands, serverCommands);
                    const responseBuffer = activeSyncCollectionResponseBuffer(
                        collectionId, nextSyncKey, '1', responses, commandNodes, moreAvailable,
                    );
                    if (responseBuffer.length > MAX_PIM_SYNC_RESPONSE_BYTES) {
                        throw new PimSyncLimitError('PIM response exceeds the encoded byte budget');
                    }
                    state = {
                        ...state!,
                        currentSyncKey: nextSyncKey,
                        previousSyncKey: syncKey,
                        windowSize,
                        knownItems: nextKnownItems,
                        lastCommands: serverCommands,
                        lastMoreAvailable: moreAvailable,
                        lastRequestHash: requestHash,
                        lastResponse: responseBuffer,
                        updatedAt: new Date(),
                    };
                    await savePimSyncStateOnConnection(connection, state);
                    return { responseBuffer, commandCount: commandNodes.length, responseCount: responses.length };
                    }, {
                        acquire: connection => acquireContactMutationLock(connection, creds.user),
                        release: (connection, lease) => releaseContactMutationLock(
                            connection, lease as ContactMutationLockLease,
                        ),
                    });
                    for (const event of contactEvents) io.to(creds.user).emit('contacts_updated', event);
                    console.log(`[EAS] Contacts Sync returning ${result.commandCount} commands and ${result.responseCount} responses`);
                    res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                    return res.status(200).send(result.responseBuffer);
                } catch (error) {
                    const expected = error instanceof PimSyncLimitError || error instanceof PimSyncStateError;
                    console.error(`[EAS] Contacts Sync failed (${expected ? error.name : 'unexpected'})`);
                    return sendContactsStatus('5');
                }
            });
        }

        if (collectionId.startsWith('cal-')) {
            const creds = getAuthCredentials();
            if (!creds) return res.status(401).send();
            const deviceId = validateActiveSyncDeviceId(req.query.DeviceId);
            if (!deviceId) return res.status(400).send();
            await ensureCalendarSchema();
            const scopeHash = pimSyncScopeHash(creds.user, deviceId, collectionId);
            const requestHash = pimSyncRequestHash(requestBody);
            const sendCalendarStatus = (status: string, responseSyncKey = syncKey) => {
                res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                return res.status(200).send(activeSyncCollectionResponseBuffer(collectionId, responseSyncKey, status));
            };
            const supported = syncKey === '0'
                ? parsePimSupportedProperties(syncCollectionNode, 'Calendar')
                : { ok: true as const, value: { wasPresent: false, fields: [] as string[] } };
            if (!supported.ok) return sendCalendarStatus('4');
            const calendarId = Number(collectionId.slice(4));

            return withPimSyncScopeLock(scopeHash, async () => {
                try {
                    const result = await withPimSqlTransaction(creds.user, async connection => {
                    const calendarStatusBuffer = (status: string, responseSyncKey = syncKey) =>
                        activeSyncCollectionResponseBuffer(collectionId, responseSyncKey, status);
                    const [calendarRows]: any = await connection.query(
                        `SELECT c.id, c.user_id, c.dav_slug, c.subscribed_url, cs.permission
                         FROM calendars c
                         LEFT JOIN calendar_shares cs
                           ON cs.calendar_id = c.id AND cs.shared_with_user_id = ?
                         WHERE c.id = ?
                         LIMIT 1 FOR UPDATE`,
                        [creds.user, calendarId],
                    );
                    const accessRole = resolveActiveSyncCalendarAccessRole(calendarRows[0], creds.user);
                    if (!accessRole) {
                        await deletePimSyncStateOnConnection(connection, creds.user, deviceId, collectionId);
                        return { responseBuffer: calendarStatusBuffer('8'), commandCount: 0, responseCount: 0, calendarChanged: false };
                    }
                    let state: StoredPimSyncState | null;
                    try {
                        state = await loadPimSyncStateOnConnection(connection, creds.user, deviceId, collectionId);
                    } catch (error) {
                        if (!(error instanceof PimSyncLimitError || error instanceof PimSyncStateError)) throw error;
                        if (syncKey !== '0') {
                            return { responseBuffer: calendarStatusBuffer('3'), commandCount: 0, responseCount: 0, calendarChanged: false };
                        }
                        await deletePimSyncStateOnConnection(connection, creds.user, deviceId, collectionId);
                        state = null;
                    }
                    const replayResponse = pimSyncReplayResponse(state, syncKey, requestHash);
                    if (replayResponse) {
                        return { responseBuffer: replayResponse, commandCount: 0, responseCount: 0, calendarChanged: false };
                    }
                    if (pimSyncStateDisposition(state, syncKey) === 'stale') {
                        return { responseBuffer: calendarStatusBuffer('3'), commandCount: 0, responseCount: 0, calendarChanged: false };
                    }

                    const commandContainers = syncCollectionNode.children?.filter((node: any) => node.tag === 'Commands') || [];
                    const commandsNode = commandContainers[0];
                    const requestCommands = commandsNode?.children || [];
                    const getChanges = parseActiveSyncGetChanges(syncKey, childNode(syncCollectionNode, 'GetChanges'));
                    let windowSize: number;
                    try {
                        windowSize = resolveActiveSyncWindowSize(
                            syncKey,
                            childNode(syncCollectionNode, 'WindowSize') ? childText(syncCollectionNode, 'WindowSize') : undefined,
                            state?.windowSize,
                        );
                    } catch {
                        return { responseBuffer: calendarStatusBuffer('4'), commandCount: 0, responseCount: 0, calendarChanged: false };
                    }
                    if (!getChanges.ok || commandContainers.length > 1
                        || (commandsNode && !Array.isArray(commandsNode.children))
                        || !validatePimClientCommands(requestCommands, 'Calendar').ok) {
                        return { responseBuffer: calendarStatusBuffer('4'), commandCount: 0, responseCount: 0, calendarChanged: false };
                    }

                    if (syncKey === '0') {
                        if (commandsNode) {
                            return { responseBuffer: calendarStatusBuffer('4'), commandCount: 0, responseCount: 0, calendarChanged: false };
                        }
                        const nextSyncKey = createPimSyncKey();
                        const responseBuffer = activeSyncCollectionResponseBuffer(collectionId, nextSyncKey, '1');
                        state = {
                            scopeHash,
                            username: creds.user,
                            deviceId,
                            collectionId,
                            currentSyncKey: nextSyncKey,
                            previousSyncKey: '0',
                            windowSize,
                            supportedWasPresent: supported.value.wasPresent,
                            supportedFields: supported.value.fields,
                            knownItems: {},
                            lastCommands: [],
                            lastMoreAvailable: false,
                            lastRequestHash: requestHash,
                            lastResponse: responseBuffer,
                            updatedAt: new Date(),
                        } satisfies StoredPimSyncState;
                        await savePimSyncStateOnConnection(connection, state);
                        return { responseBuffer, commandCount: 0, responseCount: 0, calendarChanged: false };
                    }

                    const eventsBefore = await loadBoundedCalendarPimSnapshot(connection, calendarId, collectionId);
                    const snapshotBefore = eventsBefore.items;
                    const prospectiveKnown = Object.fromEntries(snapshotBefore.map(item => [item.serverId, item.fingerprint]));
                    for (const command of requestCommands.filter((node: any) => node.tag === 'Add')) {
                        const clientId = childText(command, 'ClientId');
                        if (clientId && childNode(command, 'ApplicationData')) {
                            const sourceId = deterministicPimAddServerId(scopeHash, syncKey, clientId);
                            prospectiveKnown[pimWireServerId(collectionId, sourceId)] = 'pending';
                        }
                    }
                    assertPimKnownItemsBound(prospectiveKnown);

                    const responses: any[] = [];
                    const acceptedUpsertIds = new Set<string>();
                    const acceptedDeletes: string[] = [];
                    const eventsBeforeById = eventsBefore.byServerId;
                    const loadCalendarEvent = async (metadata: PimSnapshotMetadata): Promise<any> => {
                        const [rows]: any = await connection.query(
                            `SELECT uid, resource_name, ical_data FROM events
                             WHERE calendar_id = ? AND BINARY resource_name = BINARY ? LIMIT 1`,
                            [calendarId, metadata.sourceId],
                        );
                        const event = rows[0];
                        if (!event) throw new PimSyncStateError('PIM calendar snapshot changed while loading an item');
                        if (Buffer.byteLength(String(event.ical_data || ''), 'utf8') > MAX_PIM_ITEM_SOURCE_BYTES) {
                            throw new PimSyncLimitError('PIM calendar item exceeds its source bound');
                        }
                        return event;
                    };
                    let calendarChanged = false;
                    for (const commandNode of requestCommands) {
                        const applicationData = childNode(commandNode, 'ApplicationData');
                        const clientId = childText(commandNode, 'ClientId');
                        const requestedServerId = childText(commandNode, 'ServerId');
                        const instanceId = childText(commandNode, 'InstanceId');
                        if (instanceId) {
                            responses.push({ tag: commandNode.tag, page: 0, children: [
                                { tag: 'ServerId', page: 0, content: requestedServerId },
                                { tag: 'Status', page: 0, content: '6' },
                            ] });
                            continue;
                        }
                        if (!canWriteActiveSyncCalendar(accessRole)) {
                            responses.push({ tag: commandNode.tag, page: 0, children: [
                                ...(clientId ? [{ tag: 'ClientId', page: 0, content: clientId }] : []),
                                ...(requestedServerId ? [{ tag: 'ServerId', page: 0, content: requestedServerId }] : []),
                                { tag: 'Status', page: 0, content: '8' },
                            ] });
                            continue;
                        }

                        if (commandNode.tag === 'Add') {
                            if (!clientId || !applicationData) {
                                responses.push({ tag: 'Add', page: 0, children: [
                                    ...(clientId ? [{ tag: 'ClientId', page: 0, content: clientId }] : []),
                                    { tag: 'Status', page: 0, content: '8' },
                                ] });
                                continue;
                            }
                            const resourceName = deterministicPimAddServerId(scopeHash, syncKey, clientId);
                            const serverId = pimWireServerId(collectionId, resourceName);
                            let ical: string;
                            try {
                                ical = activeSyncCalendarApplicationDataToIcal(resourceName, applicationData);
                            } catch (error) {
                                if (!(error instanceof ActiveSyncCalendarFieldError)) throw error;
                                responses.push({ tag: 'Add', page: 0, children: [
                                    { tag: 'ClientId', page: 0, content: clientId },
                                    { tag: 'Status', page: 0, content: '6' },
                                ] });
                                continue;
                            }
                            const saveResult = await saveActiveSyncCalendarEventInTransaction(
                                connection, calendarId, resourceName, ical, null,
                            );
                            if (saveResult === 'invalid') {
                                responses.push({ tag: 'Add', page: 0, children: [
                                    { tag: 'ClientId', page: 0, content: clientId },
                                    { tag: 'Status', page: 0, content: '6' },
                                ] });
                                continue;
                            }
                            if (saveResult === 'conflict') {
                                responses.push({ tag: 'Add', page: 0, children: [
                                    { tag: 'ClientId', page: 0, content: clientId },
                                    { tag: 'Status', page: 0, content: '7' },
                                ] });
                                continue;
                            }
                            calendarChanged = saveResult === 'changed' || calendarChanged;
                            acceptedUpsertIds.add(serverId);
                            responses.push({ tag: 'Add', page: 0, children: [
                                { tag: 'ClientId', page: 0, content: clientId },
                                { tag: 'ServerId', page: 0, content: serverId },
                                { tag: 'Status', page: 0, content: '1' },
                            ] });
                        } else if (commandNode.tag === 'Change') {
                            const existingMetadata = eventsBeforeById.get(requestedServerId);
                            if (!requestedServerId || !applicationData || !existingMetadata) {
                                responses.push({ tag: 'Change', page: 0, children: [
                                    ...(requestedServerId ? [{ tag: 'ServerId', page: 0, content: requestedServerId }] : []),
                                    { tag: 'Status', page: 0, content: '8' },
                                ] });
                                continue;
                            }
                            const existing = await loadCalendarEvent(existingMetadata);
                            const resourceName = existingMetadata.sourceId;
                            let ical: string;
                            try {
                                ical = activeSyncCalendarApplicationDataToIcal(
                                    resourceName,
                                    applicationData,
                                    String(existing.ical_data || ''),
                                    pimOmittedFieldsToClear(applicationData, 'Calendar', {
                                        wasPresent: state!.supportedWasPresent,
                                        fields: state!.supportedFields,
                                    }),
                                );
                            } catch (error) {
                                if (!(error instanceof ActiveSyncCalendarFieldError)) throw error;
                                responses.push({ tag: 'Change', page: 0, children: [
                                    { tag: 'ServerId', page: 0, content: requestedServerId },
                                    { tag: 'Status', page: 0, content: '6' },
                                ] });
                                continue;
                            }
                            const saveResult = await saveActiveSyncCalendarEventInTransaction(
                                connection, calendarId, resourceName, ical, String(existing.ical_data || ''),
                            );
                            if (saveResult === 'invalid') {
                                responses.push({ tag: 'Change', page: 0, children: [
                                    { tag: 'ServerId', page: 0, content: requestedServerId },
                                    { tag: 'Status', page: 0, content: '6' },
                                ] });
                                continue;
                            }
                            if (saveResult === 'conflict') {
                                responses.push({ tag: 'Change', page: 0, children: [
                                    { tag: 'ServerId', page: 0, content: requestedServerId },
                                    { tag: 'Status', page: 0, content: '7' },
                                ] });
                                continue;
                            }
                            calendarChanged = saveResult === 'changed' || calendarChanged;
                            acceptedUpsertIds.add(requestedServerId);
                        } else {
                            const existingMetadata = eventsBeforeById.get(requestedServerId);
                            if (!requestedServerId || !existingMetadata) {
                                responses.push({ tag: 'Delete', page: 0, children: [
                                    ...(requestedServerId ? [{ tag: 'ServerId', page: 0, content: requestedServerId }] : []),
                                    { tag: 'Status', page: 0, content: '8' },
                                ] });
                                continue;
                            }
                            const existing = await loadCalendarEvent(existingMetadata);
                            const resourceName = existingMetadata.sourceId;
                            if (await deleteActiveSyncCalendarEventInTransaction(
                                connection, calendarId, resourceName, String(existing.ical_data || ''),
                            ) === 'conflict') {
                                responses.push({ tag: 'Delete', page: 0, children: [
                                    { tag: 'ServerId', page: 0, content: requestedServerId },
                                    { tag: 'Status', page: 0, content: '7' },
                                ] });
                                continue;
                            }
                            calendarChanged = true;
                            acceptedDeletes.push(requestedServerId);
                        }
                    }

                    const eventsAfter = await loadBoundedCalendarPimSnapshot(connection, calendarId, collectionId);
                    const snapshotAfter = eventsAfter.items;
                    const acceptedUpserts: Record<string, string> = Object.create(null);
                    for (const serverId of acceptedUpsertIds) {
                        const metadata = eventsAfter.byServerId.get(serverId);
                        if (!metadata) throw new PimSyncStateError('Accepted PIM calendar item is missing after mutation');
                        acceptedUpserts[serverId] = metadata.fingerprint;
                    }
                    let nextKnownItems = applyAcceptedPimWrites(
                        state!.knownItems,
                        acceptedUpserts,
                        acceptedDeletes,
                    );
                    const normalizedQuarantine = normalizePimQuarantineState(nextKnownItems, snapshotAfter);
                    nextKnownItems = normalizedQuarantine.knownItems;
                    const knownBeforeServerCommands = nextKnownItems;
                    let serverCommands: PimSyncCommand[] = [];
                    let moreAvailable = false;
                    if (getChanges.value) {
                        const delta = computePimSyncDelta({
                            knownItems: nextKnownItems,
                            snapshot: normalizedQuarantine.snapshot,
                            windowSize,
                        });
                        serverCommands = delta.commands;
                        moreAvailable = delta.moreAvailable;
                    }
                    const renderedKnownItems = { ...knownBeforeServerCommands };
                    const renderCalendarCommand = async (command: PimSyncCommand) => {
                        if (command.type === 'Delete') {
                            return {
                                pimNode: { tag: 'Delete', page: 0, children: [{ tag: 'ServerId', page: 0, content: command.serverId }] },
                                accept: () => { delete renderedKnownItems[command.serverId]; },
                            };
                        }
                        const metadata = eventsAfter.byServerId.get(command.serverId);
                        if (!metadata) throw new PimSyncStateError('PIM calendar snapshot changed while rendering');
                        const event = await loadCalendarEvent(metadata);
                        const projection = projectStoredCalendarPimCommand(
                            command, renderedKnownItems, String(event.uid), String(event.ical_data || ''),
                        );
                        if (projection.quarantined) {
                            console.warn('[EAS] Calendar item quarantined from ActiveSync', {
                                collectionId,
                                serverIdPrefix: command.serverId.slice(0, 12),
                                reason: 'unsupported-calendar-shape',
                            });
                        }
                        return {
                            pimNode: projection.node,
                            command: projection.wireCommand || command,
                            accept: () => {
                                renderedKnownItems[command.serverId] = projection.stateFingerprint;
                            },
                        };
                    };
                    const nextSyncKey = createPimSyncKey();
                    const baseResponseBytes = activeSyncCollectionResponseBuffer(
                        collectionId, nextSyncKey, '1', responses, [], true,
                    ).length;
                    const page = await renderPimCommandPage(serverCommands, baseResponseBytes, renderCalendarCommand);
                    serverCommands = page.commands;
                    const commandNodes = page.nodes;
                    moreAvailable = moreAvailable || page.moreAvailable;
                    nextKnownItems = renderedKnownItems;
                    assertPimKnownItemsBound(nextKnownItems);
                    const responseBuffer = activeSyncCollectionResponseBuffer(
                        collectionId, nextSyncKey, '1', responses, commandNodes, moreAvailable,
                    );
                    if (responseBuffer.length > MAX_PIM_SYNC_RESPONSE_BYTES) {
                        throw new PimSyncLimitError('PIM response exceeds the encoded byte budget');
                    }
                    state = {
                        ...state!,
                        currentSyncKey: nextSyncKey,
                        previousSyncKey: syncKey,
                        windowSize,
                        knownItems: nextKnownItems,
                        lastCommands: serverCommands,
                        lastMoreAvailable: moreAvailable,
                        lastRequestHash: requestHash,
                        lastResponse: responseBuffer,
                        updatedAt: new Date(),
                    };
                    await savePimSyncStateOnConnection(connection, state);
                    return {
                        responseBuffer,
                        commandCount: commandNodes.length,
                        responseCount: responses.length,
                        calendarChanged,
                    };
                    }, {
                        acquire: connection => acquireActiveSyncCalendarLock(connection, calendarId),
                        release: (connection, lease) => releaseActiveSyncCalendarLock(
                            connection, lease as ActiveSyncCalendarLockLease,
                        ),
                    });
                    if (result.calendarChanged) {
                        io.to(creds.user).emit('calendar_updated', { calendarId });
                    }
                    console.log(`[EAS] Calendar Sync returning ${result.commandCount} commands and ${result.responseCount} responses`);
                    res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                    return res.status(200).send(result.responseBuffer);
                } catch (error) {
                    const expected = error instanceof PimSyncLimitError || error instanceof PimSyncStateError;
                    console.error(`[EAS] Calendar Sync failed (${expected ? error.name : 'unexpected'})`);
                    return sendCalendarStatus('5');
                }
            });
        }

        const classifiedCollection = classifyActiveSyncCollection(collectionId);
        if (classifiedCollection.kind !== 'mail') {
            const writer = new WbxmlWriter();
            writer.writeNode(unsupportedSyncCollectionResponse(collectionId, syncKey));
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(writer.getBuffer());
        }

        // Real IMAP Folder
        const creds = getAuthCredentials();
        if (!creds) return res.status(401).send();
        const deviceId = validateActiveSyncDeviceId(req.query.DeviceId);
        if (!deviceId) return res.status(400).send();
        const folderResolver = new ImapService(creds.user, creds.pass);
        let folderPath: string | null = null;
        try {
            await folderResolver.connect();
            folderPath = resolveActiveSyncMailFolderPath(collectionId, await folderResolver.getFolders());
        } catch {
            console.error('[EAS] Mail collection resolution failed');
            return res.status(500).send();
        } finally {
            try { await folderResolver.logout(); } catch {}
        }
        if (!folderPath) {
            const writer = new WbxmlWriter();
            writer.writeNode(unsupportedSyncCollectionResponse(collectionId, syncKey));
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(writer.getBuffer());
        }
        const scopeHash = mailSyncScopeHash(creds.user, deviceId, collectionId);
        const requestHash = mailSyncRequestHash(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));

        const sendMailSyncStatus = (status: string, responseSyncKey = syncKey) => {
            const writer = new WbxmlWriter();
            writer.writeNode({
                tag: 'Sync',
                page: 0,
                children: [{
                    tag: 'Collections',
                    page: 0,
                    children: [{
                        tag: 'Collection',
                        page: 0,
                        children: [
                            { tag: 'SyncKey', page: 0, content: responseSyncKey },
                            { tag: 'CollectionId', page: 0, content: collectionId },
                            { tag: 'Status', page: 0, content: status },
                        ],
                    }],
                }],
            });
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(writer.getBuffer());
        };

        return withMailSyncScopeLock(scopeHash, async () => {
            let state: StoredMailSyncState | null;
            try {
                state = await loadMailSyncState(creds.user, deviceId, collectionId);
            } catch (error) {
                if (!(error instanceof MailSyncStateError)) throw error;
                if (syncKey !== '0') return sendMailSyncStatus('3');
                await deleteMailSyncState(creds.user, deviceId, collectionId);
                state = null;
            }
            const replayResponse = mailSyncReplayResponse(state, syncKey, requestHash);
            if (replayResponse) {
                res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                return res.status(200).send(replayResponse);
            }
            if (syncKey !== '0' && (!state || syncKey !== state.currentSyncKey)) {
                console.log(`[SYNC] Rejecting stale EAS mail key for scope ${scopeHash.slice(0, 12)}; device reset required`);
                return sendMailSyncStatus('3');
            }

            const commandsNode = childNode(syncCollectionNode, 'Commands');
            const requestCommands = commandsNode?.children || [];
            if ((commandsNode && !Array.isArray(commandsNode.children))
                || !validateMailClientCommands(requestCommands, collectionId).ok) {
                return sendMailSyncStatus('4');
            }
            const requestedFetchServerIds = requestCommands
                .filter((command: any) => command.tag === 'Fetch')
                .map((command: any) => childText(command, 'ServerId'))
                .filter(Boolean);
            const changeReadFlags = requestCommands
                .filter((command: any) => command.tag === 'Change')
                .map((command: any) => ({
                    serverId: childText(command, 'ServerId'),
                    uid: activeSyncMailMessageUid(collectionId, childText(command, 'ServerId'))!,
                    read: childText(childNode(command, 'ApplicationData'), 'Read'),
                }));
            const deleteServerIds = requestCommands
                .filter((command: any) => command.tag === 'Delete')
                .map((command: any) => ({
                    serverId: childText(command, 'ServerId'),
                    uid: activeSyncMailMessageUid(collectionId, childText(command, 'ServerId'))!,
                }));
            const deletesAsMoves = childText(syncCollectionNode, 'DeletesAsMoves') !== '0';
            const getChanges = parseActiveSyncGetChanges(syncKey, childNode(syncCollectionNode, 'GetChanges'));
            if (!getChanges.ok) return sendMailSyncStatus('4');
            const getChangesRequested = getChanges.value;
            const optionsNode = childNode(syncCollectionNode, 'Options');
            const bodyPreferenceNodes = optionsNode?.children?.filter((node: any) => node.tag === 'BodyPreference') || [];
            const bodyPreferenceNode = bodyPreferenceNodes.find((node: any) => ['1', '2', '4'].includes(childText(node, 'Type')))
                || bodyPreferenceNodes[0];
            const requestedFilterType = childText(optionsNode, 'FilterType');
            const filterTypeSpecified = requestedFilterType !== '';
            const fallbackOptions = syncKey === '0' ? undefined : (state || undefined);
            let syncOptions;
            try {
                syncOptions = normalizeMailSyncOptions({
                    filterType: requestedFilterType || undefined,
                    windowSize: childNode(syncCollectionNode, 'WindowSize')
                        ? childText(syncCollectionNode, 'WindowSize')
                        : undefined,
                    bodyType: childText(bodyPreferenceNode, 'Type') || undefined,
                    truncationSize: childText(bodyPreferenceNode, 'TruncationSize') || undefined,
                }, fallbackOptions);
            } catch (error) {
                console.warn(`[EAS] Invalid mail options for scope ${scopeHash.slice(0, 12)}`);
                return sendMailSyncStatus('4');
            }

            if (syncKey === '0') {
                if (commandsNode) return sendMailSyncStatus('4');
                const validationImap = new ImapService(creds.user, creds.pass);
                let primeUidValidity = '0';
                try {
                    await validationImap.connect();
                    const mailbox = await validationImap.client.mailboxOpen(folderPath, { readOnly: true });
                    primeUidValidity = String(mailbox.uidValidity || '0');
                    await validationImap.client.mailboxClose();
                } catch {
                    return sendMailSyncStatus('8');
                } finally {
                    try { await validationImap.logout(); } catch {}
                }
                const nextSyncKey = createMailSyncKey();
                const responseBuffer = activeSyncCollectionResponseBuffer(collectionId, nextSyncKey, '1');
                state = {
                    scopeHash,
                    username: creds.user,
                    deviceId,
                    collectionId,
                    currentSyncKey: nextSyncKey,
                    previousSyncKey: '0',
                    uidValidity: primeUidValidity,
                    highestModseq: '0',
                    minimumUid: 1,
                    ...syncOptions,
                    knownItems: {},
                    lastCommands: [],
                    lastMoreAvailable: false,
                    lastRequestHash: requestHash,
                    lastResponse: responseBuffer,
                    updatedAt: new Date(),
                } satisfies StoredMailSyncState;
                await saveMailSyncState(state);
                res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                return res.status(200).send(responseBuffer);
            }
            const fetchServerIds = requestedFetchServerIds.slice(0, effectiveMailSyncWindow(syncOptions));
            const rejectedFetchServerIds = requestedFetchServerIds.slice(fetchServerIds.length);

            const nextSyncKey = createMailSyncKey();
            let serverCommands: MailSyncCommand[] = [];
            let nextKnownItems: MailSyncKnownItems = { ...(state?.knownItems || {}) };
            let nextHighestModseq = state?.highestModseq || '0';
            let nextUidValidity = state?.uidValidity || '0';
            let minimumUid = state?.minimumUid || 1;
            let moreAvailable = false;
            const responses: any[] = [];
            for (const serverId of rejectedFetchServerIds) {
                responses.push({
                    tag: 'Fetch', page: 0, children: [
                        { tag: 'ServerId', page: 0, content: serverId },
                        { tag: 'Status', page: 0, content: '6' },
                    ],
                });
            }
            const imap = new ImapService(creds.user, creds.pass);

            try {
                await imap.connect();

                const liveMailbox = await imap.client.mailboxOpen(folderPath, { readOnly: true });
                const liveUidValidity = String(liveMailbox.uidValidity || '0');
                await imap.client.mailboxClose();
                if (state?.uidValidity && state.uidValidity !== '0' && state.uidValidity !== liveUidValidity) {
                    return sendMailSyncStatus('3');
                }

                for (const change of changeReadFlags) {
                    const uid = change.uid;
                    try {
                        if (!Object.hasOwn(nextKnownItems, String(uid))) {
                            responses.push({
                                tag: 'Change', page: 0, children: [
                                    { tag: 'ServerId', page: 0, content: change.serverId },
                                    { tag: 'Status', page: 0, content: '6' },
                                ],
                            });
                            continue;
                        }
                        await imap.messageAction(folderPath, [uid], change.read === '1' ? 'read' : 'unread');
                        nextKnownItems[String(uid)] = change.read === '1' ? 1 : 0;
                    } catch {
                        responses.push({
                            tag: 'Change', page: 0, children: [
                                { tag: 'ServerId', page: 0, content: change.serverId },
                                { tag: 'Status', page: 0, content: '8' },
                            ],
                        });
                    }
                }

                for (const deletion of deleteServerIds) {
                    const { serverId, uid } = deletion;
                    try {
                        if (!Object.hasOwn(nextKnownItems, String(uid))) {
                            responses.push({
                                tag: 'Delete', page: 0, children: [
                                    { tag: 'ServerId', page: 0, content: serverId },
                                    { tag: 'Status', page: 0, content: '8' },
                                ],
                            });
                            continue;
                        }
                        const folderIsTrash = ['TRASH', 'DELETED MESSAGES'].includes(folderPath.toUpperCase());
                        await imap.messageAction(folderPath, [uid], deletesAsMoves && !folderIsTrash ? 'delete' : 'hardDelete');
                        delete nextKnownItems[String(uid)];
                    } catch {
                        responses.push({
                            tag: 'Delete', page: 0, children: [
                                { tag: 'ServerId', page: 0, content: serverId },
                                { tag: 'Status', page: 0, content: '8' },
                            ],
                        });
                    }
                }

                if (getChangesRequested) {
                    const recoverLegacyAllMailFloor = syncOptions.filterType === 0 && minimumUid > 1;
                    if (recoverLegacyAllMailFloor) nextHighestModseq = '0';
                    const snapshot = await imap.getActiveSyncMailSnapshot(
                        folderPath,
                        filterTypeCutoff(syncOptions.filterType),
                        state?.highestModseq || '0',
                        Object.keys(nextKnownItems).map(Number),
                        recoverLegacyAllMailFloor,
                    );
                    if (syncKey !== '0' && state && state.uidValidity !== '0' && state.uidValidity !== snapshot.uidValidity) {
                        return sendMailSyncStatus('3');
                    }
                    if (syncOptions.filterType === 0
                        || (filterTypeSpecified && (!state || state.filterType !== syncOptions.filterType || state.minimumUid > 1))) {
                        minimumUid = 1;
                    }
                    const delta = computeMailSyncDelta({
                        knownItems: nextKnownItems,
                        allUids: snapshot.allUids,
                        eligibleUids: snapshot.eligibleUids,
                        changedReadFlags: snapshot.changedReadFlags,
                        filterType: syncOptions.filterType,
                        windowSize: effectiveMailSyncWindow(syncOptions, fetchServerIds.length),
                        minimumUid,
                    });
                    serverCommands = delta.commands;
                    nextKnownItems = delta.nextKnownItems;
                    moreAvailable = delta.moreAvailable;
                    nextHighestModseq = delta.moreAvailable ? nextHighestModseq : snapshot.highestModseq;
                    nextUidValidity = snapshot.uidValidity;
                }

                const bodyUids = Array.from(new Set([
                    ...serverCommands.filter(command => command.type === 'Add').map(command => command.uid),
                    ...fetchServerIds
                        .map((serverId: string) => activeSyncMailMessageUid(collectionId, serverId))
                        .filter((uid: number | null): uid is number => uid !== null),
                ]));
                const messages = await imap.getActiveSyncMessages(
                    folderPath,
                    bodyUids,
                    syncOptions.truncationSize + 256 * 1024,
                );
                const messagesByUid = new Map(messages.map(message => [message.uid, message]));

                for (const serverId of fetchServerIds) {
                    const uid = activeSyncMailMessageUid(collectionId, serverId)!;
                    const message = messagesByUid.get(uid);
                    responses.push(message ? {
                        tag: 'Fetch', page: 0, children: [
                            { tag: 'ServerId', page: 0, content: serverId },
                            { tag: 'Status', page: 0, content: '1' },
                            { tag: 'ApplicationData', page: 0, children: await activeSyncMailApplicationData(message, syncOptions) },
                        ],
                    } : {
                        tag: 'Fetch', page: 0, children: [
                            { tag: 'ServerId', page: 0, content: serverId },
                            { tag: 'Status', page: 0, content: '8' },
                        ],
                    });
                }

                const commandNodes: any[] = [];
                for (const command of serverCommands) {
                    const serverId = activeSyncMailMessageServerId(collectionId, command.uid);
                    if (command.type === 'Add') {
                        const message = messagesByUid.get(command.uid);
                        if (!message) {
                            delete nextKnownItems[String(command.uid)];
                            moreAvailable = true;
                            continue;
                        }
                        nextKnownItems[String(command.uid)] = message.flags.includes('\\Seen') ? 1 : 0;
                        commandNodes.push({
                            tag: 'Add', page: 0, children: [
                                { tag: 'ServerId', page: 0, content: serverId },
                                { tag: 'ApplicationData', page: 0, children: await activeSyncMailApplicationData(message, syncOptions) },
                            ],
                        });
                    } else if (command.type === 'Change') {
                        commandNodes.push({
                            tag: 'Change', page: 0, children: [
                                { tag: 'ServerId', page: 0, content: serverId },
                                { tag: 'ApplicationData', page: 0, children: [
                                    { tag: 'Read', page: 2, content: command.isRead === 1 ? '1' : '0' },
                                ] },
                            ],
                        });
                    } else {
                        commandNodes.push({
                            tag: command.type, page: 0, children: [
                                { tag: 'ServerId', page: 0, content: serverId },
                            ],
                        });
                    }
                }

                const responseAst = {
                    tag: 'Sync', page: 0, children: [{
                        tag: 'Collections', page: 0, children: [{
                            tag: 'Collection', page: 0, children: [
                                { tag: 'SyncKey', page: 0, content: nextSyncKey },
                                { tag: 'CollectionId', page: 0, content: collectionId },
                                { tag: 'Status', page: 0, content: '1' },
                                ...(moreAvailable ? [{ tag: 'MoreAvailable', page: 0, children: [] }] : []),
                                ...(responses.length ? [{ tag: 'Responses', page: 0, children: responses }] : []),
                                ...(commandNodes.length ? [{ tag: 'Commands', page: 0, children: commandNodes }] : []),
                            ],
                        }],
                    }],
                };
                const writer = new WbxmlWriter();
                writer.writeNode(responseAst);
                const responseBuffer = writer.getBuffer();
                if (responseBuffer.length > MAX_MAIL_SYNC_RESPONSE_BYTES) {
                    throw new MailSyncStateError('Mail Sync response exceeds its aggregate byte budget');
                }
                const replayable = responseBuffer.length <= MAX_MAIL_SYNC_REPLAY_BYTES;
                state = {
                    scopeHash,
                    username: creds.user,
                    deviceId,
                    collectionId,
                    currentSyncKey: nextSyncKey,
                    previousSyncKey: replayable ? syncKey : null,
                    uidValidity: nextUidValidity,
                    highestModseq: nextHighestModseq,
                    minimumUid,
                    ...syncOptions,
                    knownItems: nextKnownItems,
                    lastCommands: serverCommands,
                    lastMoreAvailable: moreAvailable,
                    lastRequestHash: replayable ? requestHash : null,
                    lastResponse: replayable ? responseBuffer : null,
                    updatedAt: new Date(),
                } satisfies StoredMailSyncState;
                await saveMailSyncState(state);
                console.log(`[SYNC] Scope ${scopeHash.slice(0, 12)}: ${commandNodes.length} commands, ${responses.length} responses, MoreAvailable=${moreAvailable}`);
                res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                return res.status(200).send(responseBuffer);
            } catch {
                console.error(`[EAS] Mail Sync failed for scope ${scopeHash.slice(0, 12)}`);
                return res.status(500).send();
            } finally {
                try { await imap.logout(); } catch {}
            }
        });
    }

    if (cmd === 'Ping') {
        let heartbeat = 60; // default 60s
        if (req.body && req.body.length > 0) {
            try {
                const parser = new WbxmlParser(req.body);
                const decoded = parser.parse();
                const hbNode = decoded?.children?.find((c: any) => c.tag === 'HeartbeatInterval');
                if (hbNode && hbNode.content) {
                    heartbeat = parseInt(hbNode.content.toString()) || 60;
                }
            } catch (e) {}
        }
        // Cap heartbeat to prevent reverse proxy timeouts (nginx default is usually 60s)
        heartbeat = Math.min(heartbeat, 55); 

        console.log(`Holding Ping for ${heartbeat} seconds...`);
        
        req.on('close', () => {
            // If client disconnects, we just log and do nothing
            console.log("Client disconnected Ping early.");
        });

        setTimeout(() => {
            if (res.writableEnded) return; // Ignore if closed
            const responseAst = {
                tag: "Ping",
                page: 13,
                children: [
                    { tag: "Status", page: 13, content: "1" }
                ]
            };
            const writer = new WbxmlWriter();
            writer.writeNode(responseAst);
            
            console.log("Sending Ping response (No Changes)!");
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            res.status(200).send(writer.getBuffer());
        }, heartbeat * 1000);
        return;
    }

    if (cmd === 'Settings') {
        const responseAst = {
            tag: "Settings",
            page: 18,
            children: [
                { tag: "Status", page: 18, content: "1" }
            ]
        };
        const writer = new WbxmlWriter();
        writer.writeNode(responseAst);
        console.log("Sending mocked Settings response!");
        res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
        return res.status(200).send(writer.getBuffer());
    }

    if (cmd === 'SendMail' || cmd === 'SmartForward' || cmd === 'SmartReply') {
        const creds = getAuthCredentials();
        if (!creds) return res.status(401).send();

        let mimeContent: Buffer | string = "";
        let saveInSent = false;

        if (req.body && req.body.length > 0) {
            try {
                const parser = new WbxmlParser(req.body);
                const decoded = parser.parse();
                
                // Find SaveInSentItems recursively. MIME extraction searches all payload-bearing
                // nodes because iOS may place the raw RFC822 bytes under a decoded fallback tag.
                const findNode = (node: any, tag: string): any => {
                    if (!node) return null;
                    if (node.tag === tag) return node;
                    if (node.children) {
                        for (let child of node.children) {
                            const res = findNode(child, tag);
                            if (res) return res;
                        }
                    }
                    return null;
                };

                mimeContent = extractActiveSyncSendMailMime(decoded);
                const saveNode = findNode(decoded, 'SaveInSentItems');
                if (saveNode) saveInSent = true;
            } catch {
                console.error(`[EAS] ${cmd} WBXML parsing failed`);
            }
        }

        if (mimeContent) {
            try {
                const transporter = nodemailer.createTransport(smtpTransportOptions({
                    user: creds.user,
                    pass: creds.pass,
                }));

                const envelope = await buildActiveSyncSendMailEnvelope(mimeContent, creds.user);
                console.log(`[EAS] Sending email to ${envelope.to.length} recipient(s)`);
                await transporter.sendMail({ raw: mimeContent, envelope });
                console.log(`[EAS] Email sent successfully.`);

                // If saveInSent is true, we should append to Sent folder via IMAP
                if (saveInSent) {
                    console.log(`[EAS] Saving to Sent Items via IMAP...`);
                    const imap = new ImapService(creds.user, creds.pass);
                    await imap.connect();
                    // Identify sent folder
                    const folders = await imap.getFolders();
                    let sentFolderObj = folders.find((f: any) => f.path.toUpperCase() === 'SENT' || f.path.toUpperCase() === 'SENT MESSAGES');
                    if (sentFolderObj) {
                        await imap.appendMessage(sentFolderObj.path, mimeContent, ['\\Seen']);
                        console.log('[EAS] Saved outgoing email to the Sent mailbox');
                    }
                    await imap.logout();
                }

                return res.status(200).send();
            } catch {
                console.error('[EAS] SendMail failed');
                return res.status(500).send();
            }
        } else {
            console.warn(`[EAS] ${cmd} received without Mime content!`);
            return res.status(500).send();
        }
    }

    if (cmd === 'MoveItems') {
        const creds = getAuthCredentials();
        if (!creds) return res.status(401).send();

        if (req.body && req.body.length > 0) {
            try {
                const parser = new WbxmlParser(req.body);
                const decoded = parser.parse();

                const responseNodes: any[] = [];
                const movesNode = decoded?.children?.filter((c: any) => c.tag === 'Move') || [];

                const imap = new ImapService(creds.user, creds.pass);
                await imap.connect();

                for (let moveNode of movesNode) {
                    let srcMsgId = "";
                    let srcFldId = "";
                    let dstFldId = "";

                    for (let child of moveNode.children || []) {
                        if (child.tag === 'SrcMsgId') srcMsgId = child.content?.toString() || "";
                        if (child.tag === 'SrcFldId') srcFldId = child.content?.toString() || "";
                        if (child.tag === 'DstFldId') dstFldId = child.content?.toString() || "";
                    }

                    if (srcMsgId && srcFldId && dstFldId) {
                        try {
                            const sourceFolder = Buffer.from(srcFldId, 'base64').toString('utf8');
                            const destFolder = Buffer.from(dstFldId, 'base64').toString('utf8');
                            const parts = srcMsgId.split('-');
                            const uid = parseInt(parts[parts.length - 1]);

                            await imap.moveMessage(sourceFolder, destFolder, uid);

                            responseNodes.push({
                                tag: "Response", page: 5, children: [
                                    { tag: "SrcMsgId", page: 5, content: srcMsgId },
                                    { tag: "Status", page: 5, content: "3" }, // 3 = Success
                                    { tag: "DstMsgId", page: 5, content: `${dstFldId}-${uid}` } // Rough approximation of new ID
                                ]
                            });
                        } catch {
                            console.error('[EAS] MoveItems operation failed');
                            responseNodes.push({
                                tag: "Response", page: 5, children: [
                                    { tag: "SrcMsgId", page: 5, content: srcMsgId },
                                    { tag: "Status", page: 5, content: "2" } // 2 = Invalid source/destination
                                ]
                            });
                        }
                    }
                }

                await imap.logout();

                const responseAst = {
                    tag: "MoveItems", page: 5, children: responseNodes
                };
                const writer = new WbxmlWriter();
                writer.writeNode(responseAst);
                res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                return res.status(200).send(writer.getBuffer());

            } catch {
                console.error('[EAS] MoveItems request failed');
                return res.status(500).send();
            }
        }
        return res.status(500).send();
    }

    if (cmd === 'ItemOperations') {
        const sendItemOperations = (status: string, responses: any[] = []) => {
            const writer = new WbxmlWriter();
            writer.writeNode({
                tag: 'ItemOperations',
                page: 20,
                children: [
                    { tag: 'Status', page: 20, content: status },
                    ...(responses.length > 0 ? [{ tag: 'Response', page: 20, children: responses }] : []),
                ],
            });
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(writer.getBuffer());
        };

        if (requestBody.length === 0) return sendItemOperations('2');

        const operations = itemOperationsRequestFetches(decodedForStructure);
        if (!operations) return sendItemOperations('2');
        if (operations.length > ITEM_OPERATIONS_MAX_FETCHES) return sendItemOperations('2');
        if (operations.length === 0) return sendItemOperations('2');

        const responses: any[] = [];
        let remainingBodyBytes = ITEM_OPERATIONS_MAX_RESPONSE_BODY_BYTES;
        let remainingSourceBytes = ITEM_OPERATIONS_MAX_AGGREGATE_SOURCE_BYTES;
        let globalFailureStatus: string | null = null;
        const imap = new ImapService(requestCredentials.user, requestCredentials.pass);
        try {
            await imap.connect();
        } catch {
            try { await imap.logout(); } catch {}
            return sendItemOperations('3');
        }

        try {
            for (const fetchNode of operations) {
                const fetchRequest = itemOperationsFetchRequest(fetchNode);
                if (fetchRequest.ok === false) {
                    responses.push(itemOperationsFetchError(
                        fetchRequest.collectionId,
                        fetchRequest.serverId,
                        fetchRequest.status,
                    ));
                    continue;
                }
                const { collectionId, serverId } = fetchRequest;
                const target = itemOperationsMailboxTarget(fetchRequest.store, collectionId, serverId);
                if (target.ok === false) {
                    if (target.status === '9') {
                        globalFailureStatus = '9';
                        break;
                    }
                    responses.push(itemOperationsFetchError(collectionId, serverId, target.status));
                    continue;
                }
                const sourceAllowance = itemOperationsSourceAllowance(remainingSourceBytes);
                if (remainingBodyBytes === 0 || sourceAllowance === 0) {
                    responses.push(itemOperationsFetchError(collectionId, serverId, '11'));
                    continue;
                }

                let message: any;
                try {
                    message = await imap.getMessageByUid(
                        target.folderPath,
                        target.uid,
                        sourceAllowance,
                    );
                } catch {
                    globalFailureStatus = '12';
                    break;
                }
                if (!message) {
                    responses.push(itemOperationsFetchError(collectionId, serverId, '6'));
                    continue;
                }
                const sourceBytes = Buffer.isBuffer(message.source) ? message.source.length : sourceAllowance;
                remainingSourceBytes = Math.max(0, remainingSourceBytes - sourceBytes);
                if (sourceBytes > sourceAllowance) {
                    remainingSourceBytes = 0;
                    responses.push(itemOperationsFetchError(collectionId, serverId, '11'));
                    continue;
                }

                try {
                    const bodyAllowance = itemOperationsBodyAllowance(
                        remainingBodyBytes,
                        ITEM_OPERATIONS_MAX_BODY_BYTES,
                    );
                    const fetchResponse = await itemOperationsFetchSuccess({
                        collectionId,
                        serverId,
                        message,
                        maxBodyBytes: bodyAllowance,
                        bodyPreferences: fetchRequest.bodyPreferences,
                    });
                    remainingBodyBytes = Math.max(
                        0,
                        remainingBodyBytes - itemOperationsFetchBodyBytes(fetchResponse),
                    );
                    responses.push(fetchResponse);
                } catch {
                    responses.push(itemOperationsFetchError(collectionId, serverId, '14'));
                }
            }
        } finally {
            try { await imap.logout(); } catch {}
        }

        if (globalFailureStatus) return sendItemOperations(globalFailureStatus);
        return sendItemOperations('1', responses);
    }
    res.status(400).send();
});

async function startServer(): Promise<void> {
    try {
        await startApplicationAfterRequiredMigrations({
            ensureMailSearchSchema,
            initializeSessionStore,
            ensureUserSettingsSchema,
            ensureAdminSettingsSchema,
            ensureBrandingSchema,
            ensureAccountSecuritySchema,
            ensureCalendarSchema,
            ensureCalendarSubscriptionSchema,
            ensureScheduledEmailsSchema,
            ensureNotesSchema,
            ensureRemindersSchema,
            ensureAttachmentsSchema,
            ensureContactsSchema,
            ensureEasMailSyncSchema,
            ensureEasPimSyncSchema,
            repairBirthdayCalendarProjections: repairAllBirthdayCalendarProjections,
            startSearchWorker,
            startScheduledSender,
            startCalendarSubscriptionWorker,
            listen: () => server.listen(serverConfig.port, serverConfig.host, () => {
                console.log(`OpenMailStack webmail backend listening on ${serverConfig.host}:${serverConfig.port}`);
            }),
        });
    } catch (err) {
        console.error('Failed to initialize required application schema:', err);
        process.exit(1);
    }
}

void startServer();
