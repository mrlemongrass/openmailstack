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
import { simpleParser } from 'mailparser';
import { pool } from './db';
import { getPublicBaseUrl, normalizeMailboxUsername, serverConfig, smtpConfig, smtpTransportOptions } from './config';
import { rateLimit, securityHeaders } from './security';
import { ensureMailSearchSchema } from './search-index';
import { ensureUserSettingsSchema } from './user-settings';
import { ensureAdminSettingsSchema } from './admin-settings';
import { ensureBrandingSchema } from './branding';
import { ensureCalendarSchema, ensureDefaultCalendar, getCalendarFolderSyncKey, getVisibleCalendars, parseIcalEvent } from './calendar-utils';
import {
    addressBookSyncToken,
    contactSyncTokenVersion,
    contactVCard,
    deleteContactByDavUid,
    ensureContactsSchema,
    getContactDavUid,
    listContactTombstonesSince,
    listContacts,
    listContactsUpdatedSince,
    normalizeDavUid,
    saveContactFromVCard
} from './contact-utils';
import { ensureNotesSchema, ensureRemindersSchema, ensureAttachmentsSchema, listNotes, saveNote, deleteNote, getNotesSyncToken } from './notes-utils';
import { activeSyncToDbNote, dbNoteToActiveSync } from './eas-notes';
import { activeSyncContactApplicationDataToVCard, contactToActiveSyncApplicationData } from './eas-contacts';
import { activeSyncCalendarApplicationDataToIcal, calendarEventToActiveSyncApplicationData, normalizeCalendarEventUid } from './eas-calendar';
import { shouldSendActiveSyncServerChanges } from './eas-sync';
import {
    activeSyncMailApplicationData,
    computeMailSyncDelta,
    createMailSyncKey,
    effectiveMailSyncWindow,
    ensureEasMailSyncSchema,
    filterTypeCutoff,
    loadMailSyncState,
    mailSyncReplayResponse,
    mailSyncRequestHash,
    mailSyncScopeHash,
    MAX_MAIL_SYNC_REPLAY_BYTES,
    normalizeMailSyncOptions,
    saveMailSyncState,
    validateActiveSyncDeviceId,
    withMailSyncScopeLock,
    type MailSyncCommand,
    type MailSyncKnownItems,
    type StoredMailSyncState,
} from './eas-mail-sync';
import { buildActiveSyncSendMailEnvelope, extractActiveSyncSendMailMime, summarizeActiveSyncNodeForLog } from './eas-send';
import { syncNotesWithImap } from './notes-imap-sync';
import { startSearchWorker } from './search-worker';
import { startScheduledSender } from './scheduled-send';
import { startCalendarSubscriptionWorker } from './calendar-subscription';
import { schedulerRouter } from './scheduler/router';

const app = express();
const server = http.createServer(app);
export const io = new SocketIOServer(server, {
    cors: { origin: true, credentials: true }
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
ensureMailSearchSchema().catch(err => console.error('Failed to initialize mail search index:', err));
startSearchWorker();
startScheduledSender();
startCalendarSubscriptionWorker();
ensureUserSettingsSchema().catch(err => console.error('Failed to initialize user settings schema:', err));
ensureAdminSettingsSchema().catch(err => console.error('Failed to initialize admin settings schema:', err));
ensureBrandingSchema().catch(err => console.error('Failed to initialize branding schema:', err));
ensureCalendarSchema().catch(err => console.error('Failed to initialize calendar schema:', err));
ensureContactsSchema().catch(err => console.error('Failed to initialize contacts schema:', err));
ensureNotesSchema().catch(err => console.error('Failed to initialize notes schema:', err));
ensureRemindersSchema().catch(err => console.error('Failed to initialize reminders schema:', err));
ensureAttachmentsSchema().catch(err => console.error('Failed to initialize attachments schema:', err));
ensureEasMailSyncSchema().catch(err => console.error('Failed to initialize EAS mail sync schema:', err));
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(securityHeaders);
app.use(express.json({ limit: `${serverConfig.uploadLimitBytes}b` }));
app.use(bodyParser.raw({
    type: (req: any) => {
        const contentType = String(req.headers['content-type'] || '').toLowerCase();
        return !req.url.startsWith('/api/') && !contentType.includes('multipart/form-data');
    },
    limit: `${serverConfig.uploadLimitBytes}b`
}));

import * as path from 'path';
import { getSession, requireSession } from './auth';
app.use('/uploads', (req, res, next) => {
    requireSession(req, res, () => {
        next();
    });
}, express.static(path.join(__dirname, '..', 'uploads')));

import caldavRouter from './caldav';
import carddavRouter from './carddav';
import { appsApiRouter } from './apps-api';

const CONTACTS_COLLECTION_ID = 'contacts';
const LEGACY_CONTACTS_COLLECTION_ID = 'mock-contacts';

const nodeText = (node: any): string => node?.content ? node.content.toString() : '';
const childNode = (node: any, tag: string): any => node?.children?.find((child: any) => child.tag === tag);
const childText = (node: any, tag: string): string => nodeText(childNode(node, tag));
const firstNonEmpty = (...values: string[]): string => values.map(value => value.trim()).find(Boolean) || '';

async function saveActiveSyncCalendarEvent(calendarId: number, uid: string, ical: string): Promise<boolean> {
    const [existingRows]: any = await pool.query(
        'SELECT ical_data FROM events WHERE calendar_id = ? AND uid = ? LIMIT 1',
        [calendarId, uid]
    );

    if (existingRows.length > 0) {
        if ((existingRows[0].ical_data || '') === ical) {
            return false;
        }
        await pool.query('UPDATE events SET ical_data = ? WHERE calendar_id = ? AND uid = ?', [ical, calendarId, uid]);
    } else {
        await pool.query('INSERT INTO events (calendar_id, uid, ical_data) VALUES (?, ?, ?)', [calendarId, uid, ical]);
    }

    await pool.query('UPDATE calendars SET sync_token = sync_token + 1 WHERE id = ?', [calendarId]);
    return true;
}

function isContactsCollection(collectionId: string): boolean {
    return collectionId === CONTACTS_COLLECTION_ID || collectionId === LEGACY_CONTACTS_COLLECTION_ID;
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
    console.log(`\n--- [EAS] Received ${req.method} Request ---`);
    console.log(`Cmd: ${req.query.Cmd}`);

    if (req.method === 'OPTIONS') {
        res.set('MS-Server-ActiveSync', '14.1');
        res.set('MS-ASProtocolVersions', '14.0,14.1');
        res.set('MS-ASProtocolCommands', 'Sync,SendMail,SmartForward,SmartReply,FolderSync,FolderCreate,FolderDelete,FolderUpdate,GetItemEstimate,Settings,Ping,Provision');
        res.set('Public', 'OPTIONS,POST');
        return res.status(200).send();
    }

    if (req.body && req.body.length > 0) {
        // console.log("Raw Body (hex):", req.body.toString('hex'));
        try {
            const parser = new WbxmlParser(req.body);
            const decoded = parser.parse();
            const activeSyncCommand = String(req.query.Cmd || '');
            const decodedForLog = ['SendMail', 'SmartForward', 'SmartReply'].includes(activeSyncCommand)
                ? summarizeActiveSyncNodeForLog(decoded)
                : decoded;
            console.log("Decoded Request:", JSON.stringify(decodedForLog, null, 2));
        } catch (err) {
            console.error("Failed to parse WBXML:", err);
        }
    }
    
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
    const cmd = req.query.Cmd;
    const requestCredentials = getAuthCredentials();
    if (!requestCredentials) return res.status(401).send();
    const authenticationImap = new ImapService(requestCredentials.user, requestCredentials.pass, false);
    try {
        await authenticationImap.connect();
    } catch {
        return res.status(401).send();
    } finally {
        try { await authenticationImap.logout(); } catch {}
    }

    if (cmd === 'FolderSync') {
        let syncKey = "0";
        if (req.body && req.body.length > 0) {
            try {
                const parser = new WbxmlParser(req.body);
                const decoded = parser.parse();
                const syncKeyNode = decoded?.children?.find((c: any) => c.tag === 'SyncKey');
                if (syncKeyNode && syncKeyNode.content) {
                    syncKey = syncKeyNode.content.toString();
                }
            } catch (e) {}
        }

        let responseAst: any;

        const creds = getAuthCredentials();
        if (!creds) {
            return res.status(401).send();
        }

        try {
            const imap = new ImapService(creds.user, creds.pass);
            await imap.connect();
            const folders = await imap.getFolders();
            await imap.logout();
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
                const parts = path.split('.');
                if (parts.length > 1) {
                    displayName = parts[parts.length - 1];
                    parentId = Buffer.from(parts.slice(0, parts.length - 1).join('.')).toString('base64');
                }

                const serverId = Buffer.from(path).toString('base64');
                folderDescriptors.push({ serverId, displayName, type });

                return { tag: "Add", page: 7, children: [
                    { tag: "ServerId", page: 7, content: serverId },
                    { tag: "ParentId", page: 7, content: parentId },
                    { tag: "DisplayName", page: 7, content: displayName },
                    { tag: "Type", page: 7, content: type }
                ]};
            });

            let serviceFolders = [
                { tag: "Add", page: 7, children: [
                    { tag: "ServerId", page: 7, content: CONTACTS_COLLECTION_ID },
                    { tag: "ParentId", page: 7, content: "0" },
                    { tag: "DisplayName", page: 7, content: "Contacts" },
                    { tag: "Type", page: 7, content: "9" }
                ]},
                { tag: "Add", page: 7, children: [
                    { tag: "ServerId", page: 7, content: "mock-tasks" },
                    { tag: "ParentId", page: 7, content: "0" },
                    { tag: "DisplayName", page: 7, content: "Reminders" },
                    { tag: "Type", page: 7, content: "7" }
                ]},
                { tag: "Add", page: 7, children: [
                    { tag: "ServerId", page: 7, content: "mock-notes" },
                    { tag: "ParentId", page: 7, content: "0" },
                    { tag: "DisplayName", page: 7, content: "Notes" },
                    { tag: "Type", page: 7, content: "10" }
                ]}
            ];
            folderDescriptors.push(
                { serverId: CONTACTS_COLLECTION_ID, displayName: "Contacts", type: "9" },
                { serverId: "mock-tasks", displayName: "Reminders", type: "7" },
                { serverId: "mock-notes", displayName: "Notes", type: "10" }
            );

            try {
                const cals = await getVisibleCalendars(creds.user);
                for (const cal of cals) {
                    const serverId = `cal-${cal.id}`;
                    const displayName = cal.name;
                    const type = "8";
                    folderDescriptors.push({ serverId, displayName, type });
                    serviceFolders.push({
                        tag: "Add", page: 7, children: [
                            { tag: "ServerId", page: 7, content: serverId },
                            { tag: "ParentId", page: 7, content: "0" },
                            { tag: "DisplayName", page: 7, content: displayName },
                            { tag: "Type", page: 7, content: type } // Default Calendar
                        ]
                    });
                }
            } catch(e) {}

            const allNodes = [...mailNodes, ...serviceFolders];
            const currentSyncKey = getCalendarFolderSyncKey(folderDescriptors);

            if (syncKey !== "0" && syncKey === currentSyncKey) {
                console.log(`Client sent current FolderSync key ${syncKey}. Returning no changes.`);
                responseAst = {
                    tag: "FolderSync",
                    page: 7,
                    children: [
                        { tag: "Status", page: 7, content: "1" },
                        { tag: "SyncKey", page: 7, content: currentSyncKey }
                    ]
                };
            } else if (syncKey !== "0") {
                console.log(`Client sent stale FolderSync key ${syncKey}. Forcing hierarchy reset to ${currentSyncKey}.`);
                responseAst = {
                    tag: "FolderSync",
                    page: 7,
                    children: [
                        { tag: "Status", page: 7, content: "9" }
                    ]
                };
            } else {
                console.log(`Client sent SyncKey 0. Returning full folder hierarchy with key ${currentSyncKey}.`);
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
            console.error("IMAP Error during FolderSync:", err);
            if (err && err.message && err.message.toLowerCase().includes('auth')) {
                return res.status(401).send();
            }
            return res.status(401).send(); // Always return 401 so iOS asks for password again instead of failing
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

    if (cmd === 'GetItemEstimate') {
        const creds = getAuthCredentials();
        if (!creds) return res.status(401).send();

        try {
            let collectionNodes: any[] = [];
            if (req.body && req.body.length > 0) {
                const parser = new WbxmlParser(req.body);
                const decoded = parser.parse();
                collectionNodes = childNode(decoded, 'Collections')?.children?.filter((node: any) => node.tag === 'Collection') || [];
                if (collectionNodes.length === 0) {
                    collectionNodes = decoded?.children?.filter((node: any) => node.tag === 'Collection') || [];
                }
            }

            const responses: any[] = [];
            let imap: ImapService | null = null;

            try {
                for (const collectionNode of collectionNodes) {
                    const collectionId = childText(collectionNode, 'CollectionId');
                    const requestedClass = childText(collectionNode, 'Class');
                    let estimate = 0;
                    let status = '1';

                    try {
                        if (isContactsCollection(collectionId)) {
                            estimate = (await listContacts(creds.user)).length;
                        } else if (collectionId === 'mock-calendar' || collectionId.startsWith('cal-')) {
                            if (collectionId.startsWith('cal-')) {
                                const calendarId = collectionId.slice(4);
                                const [rows]: any = await pool.query(
                                    'SELECT COUNT(*) AS event_count FROM events e JOIN calendars c ON c.id = e.calendar_id WHERE c.id = ? AND c.user_id = ?',
                                    [calendarId, creds.user]
                                );
                                estimate = Number(rows[0]?.event_count || 0);
                            } else {
                                const calendar = await ensureDefaultCalendar(creds.user);
                                const [rows]: any = await pool.query('SELECT COUNT(*) AS event_count FROM events WHERE calendar_id = ?', [calendar.id]);
                                estimate = Number(rows[0]?.event_count || 0);
                            }
                        } else if (collectionId && !collectionId.startsWith('mail%')) {
                            if (!imap) {
                                imap = new ImapService(creds.user, creds.pass);
                                await imap.connect();
                            }
                            const folderPath = Buffer.from(collectionId, 'base64').toString('utf8');
                            const mailbox = await imap.client.mailboxOpen(folderPath);
                            estimate = mailbox.exists || 0;
                            await imap.client.mailboxClose();
                        } else {
                            status = '8';
                        }
                    } catch (estimateErr) {
                        console.error('[EAS] GetItemEstimate failed for collection:', collectionId, estimateErr);
                        status = '8';
                    }

                    responses.push({
                        tag: 'Response',
                        page: 6,
                        children: [
                            { tag: 'Status', page: 6, content: status },
                            { tag: 'Collection', page: 6, children: [
                                ...(requestedClass ? [{ tag: 'Class', page: 6, content: requestedClass }] : []),
                                { tag: 'CollectionId', page: 6, content: collectionId },
                                { tag: 'Estimate', page: 6, content: estimate.toString() }
                            ]}
                        ]
                    });
                }
            } finally {
                if (imap) {
                    try { await imap.logout(); } catch(e) {}
                }
            }

            const responseAst = {
                tag: 'GetItemEstimate',
                page: 6,
                children: responses.length > 0 ? responses : [
                    { tag: 'Response', page: 6, children: [
                        { tag: 'Status', page: 6, content: '1' },
                        { tag: 'Collection', page: 6, children: [
                            { tag: 'CollectionId', page: 6, content: '' },
                            { tag: 'Estimate', page: 6, content: '0' }
                        ]}
                    ]}
                ]
            };

            const writer = new WbxmlWriter();
            writer.writeNode(responseAst);
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(writer.getBuffer());
        } catch (e) {
            console.error('Failed to process GetItemEstimate:', e);
            return res.status(500).send();
        }
    }

    if (cmd === 'Sync') {
        let collectionId = "";
        let syncKey = "1";
        let syncCollectionNode: any = null;
        if (req.body && req.body.length > 0) {
            try {
                const parser = new WbxmlParser(req.body);
                const decoded = parser.parse();
                // extract collectionId from request
                const collNode = decoded?.children?.find((c: any) => c.tag === 'Collections')
                                        ?.children?.find((c: any) => c.tag === 'Collection');
                if (collNode) {
                    syncCollectionNode = collNode;
                    const idNode = collNode.children?.find((c: any) => c.tag === 'CollectionId');
                    if (idNode && idNode.content) collectionId = idNode.content.toString();
                    const keyNode = collNode.children?.find((c: any) => c.tag === 'SyncKey');
                    if (keyNode && keyNode.content) syncKey = keyNode.content.toString();
                }
            } catch (e) {}
        }

        if (isContactsCollection(collectionId)) {
            const creds = getAuthCredentials();
            if (!creds) return res.status(401).send();

            try {
                const responses: any[] = [];
                const commandsNode = childNode(syncCollectionNode, 'Commands');

                for (const commandNode of commandsNode?.children || []) {
                    const applicationData = childNode(commandNode, 'ApplicationData');

                    if (commandNode.tag === 'Add') {
                        const clientId = childText(commandNode, 'ClientId') || `client-${Date.now()}`;
                        const davUid = normalizeDavUid(`eas-${clientId}`);
                        const vcard = activeSyncContactApplicationDataToVCard(davUid, applicationData);
                        await saveContactFromVCard(creds.user, davUid, vcard);
                        io.to(creds.user).emit('contacts_updated', { davUid });
                        responses.push({
                            tag: 'Add',
                            page: 0,
                            children: [
                                { tag: 'ClientId', page: 0, content: clientId },
                                { tag: 'ServerId', page: 0, content: davUid },
                                { tag: 'Status', page: 0, content: '1' }
                            ]
                        });
                    } else if (commandNode.tag === 'Change') {
                        const serverId = childText(commandNode, 'ServerId');
                        if (serverId && applicationData) {
                            const davUid = normalizeDavUid(serverId);
                            const vcard = activeSyncContactApplicationDataToVCard(davUid, applicationData);
                            await saveContactFromVCard(creds.user, davUid, vcard);
                            io.to(creds.user).emit('contacts_updated', { davUid });
                            responses.push({
                                tag: 'Change',
                                page: 0,
                                children: [
                                    { tag: 'ServerId', page: 0, content: davUid },
                                    { tag: 'Status', page: 0, content: '1' }
                                ]
                            });
                        } else {
                            responses.push({
                                tag: 'Change',
                                page: 0,
                                children: [
                                    ...(serverId ? [{ tag: 'ServerId', page: 0, content: serverId }] : []),
                                    { tag: 'Status', page: 0, content: '8' }
                                ]
                            });
                        }
                    } else if (commandNode.tag === 'Delete') {
                        const serverId = childText(commandNode, 'ServerId');
                        if (serverId) {
                            await deleteContactByDavUid(creds.user, normalizeDavUid(serverId));
                            io.to(creds.user).emit('contacts_updated', { davUid: normalizeDavUid(serverId), deleted: true });
                        }
                        responses.push({
                            tag: 'Delete',
                            page: 0,
                            children: [
                                ...(serverId ? [{ tag: 'ServerId', page: 0, content: serverId }] : []),
                                { tag: 'Status', page: 0, content: '1' }
                            ]
                        });
                    }
                }

                const nextSyncKey = `contacts-${await addressBookSyncToken(creds.user)}`;
                const isInitialSync = syncKey === '0' || syncKey === '1';
                const shouldSendContacts = shouldSendActiveSyncServerChanges({
                    syncKey,
                    nextSyncKey,
                    hasClientCommands: Boolean(commandsNode?.children?.length),
                    getChangesRequested: Boolean(childNode(syncCollectionNode, 'GetChanges'))
                });
                const commandNodes: any[] = [];
                if (shouldSendContacts) {
                    let contacts;
                    if (isInitialSync) {
                        contacts = await listContacts(creds.user);
                    } else {
                        contacts = await listContactsUpdatedSince(creds.user, contactSyncTokenVersion(syncKey));
                    }
                    for (const contact of contacts) {
                        commandNodes.push({
                            tag: isInitialSync ? 'Add' : 'Change',
                            page: 0,
                            children: [
                                { tag: 'ServerId', page: 0, content: getContactDavUid(contact) },
                                { tag: 'ApplicationData', page: 0, children: contactToActiveSyncApplicationData(contact, contactVCard(contact)) }
                            ]
                        });
                    }

                    if (!isInitialSync) {
                        const tombstones = await listContactTombstonesSince(creds.user, contactSyncTokenVersion(syncKey));
                        for (const tombstone of tombstones) {
                            commandNodes.push({
                                tag: 'Delete',
                                page: 0,
                                children: [
                                    { tag: 'ServerId', page: 0, content: tombstone.dav_uid }
                                ]
                            });
                        }
                    }
                }

                const responseAst = {
                    tag: 'Sync',
                    page: 0,
                    children: [
                        { tag: 'Collections', page: 0, children: [
                            { tag: 'Collection', page: 0, children: [
                                { tag: 'Class', page: 0, content: 'Contacts' },
                                { tag: 'SyncKey', page: 0, content: nextSyncKey },
                                { tag: 'CollectionId', page: 0, content: collectionId },
                                { tag: 'Status', page: 0, content: '1' },
                                ...(responses.length > 0 ? [{ tag: 'Responses', page: 0, children: responses }] : []),
                                ...(commandNodes.length > 0 ? [{ tag: 'Commands', page: 0, children: commandNodes }] : [])
                            ]}
                        ]}
                    ]
                };

                const writer = new WbxmlWriter();
                writer.writeNode(responseAst);
                console.log(`[SYNC] Sending Contacts Sync Response for ${collectionId} with ${commandNodes.length} commands. SyncKey going to ${nextSyncKey}`);
                res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                return res.status(200).send(writer.getBuffer());
            } catch (e) {
                console.error('Failed to sync contacts:', e);
                return res.status(500).send();
            }
        }

        if (collectionId === 'mock-calendar' || collectionId.startsWith('cal-')) {
            const creds = getAuthCredentials();
            if (!creds) return res.status(401).send();

            try {
                const responseCollectionId = collectionId;
                let calendar: any;
                if (collectionId.startsWith('cal-')) {
                    const calendarId = collectionId.slice(4);
                    const visibleCals = await getVisibleCalendars(creds.user);
                    const rows = visibleCals.filter(c => c.id.toString() === calendarId);
                    if (rows.length === 0) {
                        const notFoundAst = {
                            tag: "Sync",
                            page: 0,
                            children: [
                                { tag: "Collections", page: 0, children: [
                                    { tag: "Collection", page: 0, children: [
                                        { tag: "SyncKey", page: 0, content: syncKey },
                                        { tag: "CollectionId", page: 0, content: collectionId },
                                        { tag: "Status", page: 0, content: "8" }
                                    ]}
                                ]}
                            ]
                        };
                        const writer = new WbxmlWriter();
                        writer.writeNode(notFoundAst);
                        res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                        return res.status(200).send(writer.getBuffer());
                    }
                    calendar = rows[0];
                } else {
                    calendar = await ensureDefaultCalendar(creds.user);
                }

                const responses: any[] = [];
                const commandsNode = childNode(syncCollectionNode, 'Commands');
                let calendarChanged = false;

                for (const commandNode of commandsNode?.children || []) {
                    const applicationData = childNode(commandNode, 'ApplicationData');

                    if (calendar.access_role === 'read') {
                        responses.push({
                            tag: commandNode.tag,
                            page: 0,
                            children: [
                                ...(childText(commandNode, 'ClientId') ? [{ tag: 'ClientId', page: 0, content: childText(commandNode, 'ClientId') }] : []),
                                ...(childText(commandNode, 'ServerId') ? [{ tag: 'ServerId', page: 0, content: childText(commandNode, 'ServerId') }] : []),
                                { tag: 'Status', page: 0, content: '8' }
                            ]
                        });
                        continue;
                    }

                    if (commandNode.tag === 'Add') {
                        if (!applicationData) {
                            responses.push({
                                tag: 'Add',
                                page: 0,
                                children: [
                                    ...(childText(commandNode, 'ClientId') ? [{ tag: 'ClientId', page: 0, content: childText(commandNode, 'ClientId') }] : []),
                                    { tag: 'Status', page: 0, content: '8' }
                                ]
                            });
                            continue;
                        }

                        const clientId = childText(commandNode, 'ClientId') || `client-${Date.now()}`;
                        const uid = normalizeCalendarEventUid(firstNonEmpty(childText(applicationData, 'UID'), clientId));
                        const ical = activeSyncCalendarApplicationDataToIcal(uid, applicationData);
                        calendarChanged = (await saveActiveSyncCalendarEvent(calendar.id, uid, ical)) || calendarChanged;
                        responses.push({
                            tag: 'Add',
                            page: 0,
                            children: [
                                { tag: 'ClientId', page: 0, content: clientId },
                                { tag: 'ServerId', page: 0, content: uid },
                                { tag: 'Status', page: 0, content: '1' }
                            ]
                        });
                    } else if (commandNode.tag === 'Change') {
                        const serverId = childText(commandNode, 'ServerId');
                        if (serverId && applicationData) {
                            const uid = normalizeCalendarEventUid(serverId);
                            const [existingRows]: any = await pool.query(
                                'SELECT ical_data, updated_at FROM events WHERE calendar_id = ? AND uid = ? LIMIT 1',
                                [calendar.id, uid]
                            );
                            if (existingRows.length === 0) {
                                responses.push({ tag: 'Change', page: 0, children: [{ tag: 'ServerId', page: 0, content: uid }, { tag: 'Status', page: 0, content: '8' }] });
                            } else {
                                const ical = activeSyncCalendarApplicationDataToIcal(uid, applicationData, existingRows[0]?.ical_data || '');
                                calendarChanged = (await saveActiveSyncCalendarEvent(calendar.id, uid, ical)) || calendarChanged;
                                responses.push({
                                    tag: 'Change',
                                    page: 0,
                                    children: [
                                        { tag: 'ServerId', page: 0, content: uid },
                                        { tag: 'Status', page: 0, content: '1' }
                                    ]
                                });
                            }
                        } else {
                            responses.push({
                                tag: 'Change',
                                page: 0,
                                children: [
                                    ...(serverId ? [{ tag: 'ServerId', page: 0, content: serverId }] : []),
                                    { tag: 'Status', page: 0, content: '8' }
                                ]
                            });
                        }
                    } else if (commandNode.tag === 'Delete') {
                        const serverId = childText(commandNode, 'ServerId');
                        if (serverId) {
                            const uid = normalizeCalendarEventUid(serverId);
                            await pool.query('INSERT INTO calendar_tombstones (calendar_id, uid) VALUES (?, ?)', [calendar.id, uid]);
                            await pool.query('DELETE FROM events WHERE calendar_id = ? AND uid = ?', [calendar.id, uid]);
                            await pool.query('UPDATE calendars SET sync_token = sync_token + 1 WHERE id = ?', [calendar.id]);
                            calendarChanged = true;
                            responses.push({
                                tag: 'Delete',
                                page: 0,
                                children: [
                                    { tag: 'ServerId', page: 0, content: uid },
                                    { tag: 'Status', page: 0, content: '1' }
                                ]
                            });
                        } else {
                            responses.push({
                                tag: 'Delete',
                                page: 0,
                                children: [
                                    { tag: 'Status', page: 0, content: '8' }
                                ]
                            });
                        }
                    }
                }

                if (calendarChanged) {
                    const visibleCals = await getVisibleCalendars(creds.user);
                    const updatedCalendars = visibleCals.filter(c => c.id === calendar.id);
                    if (updatedCalendars.length > 0) {
                        calendar = updatedCalendars[0];
                    }
                    io.to(creds.user).emit('calendar_updated', { calendarId: calendar.id });
                }

                const nextSyncKey = `cal-${calendar.id}-${calendar.sync_token || 1}`;
                const shouldSendEvents = shouldSendActiveSyncServerChanges({
                    syncKey,
                    nextSyncKey,
                    hasClientCommands: Boolean(commandsNode?.children?.length),
                    getChangesRequested: Boolean(childNode(syncCollectionNode, 'GetChanges'))
                });
                const addNodes: any[] = [];

                if (shouldSendEvents) {
                    const [events]: any = await pool.query(
                        'SELECT uid, ical_data FROM events WHERE calendar_id = ? ORDER BY updated_at ASC, id ASC',
                        [calendar.id]
                    );

                    for (const eventRow of events) {
                        const parsed = parseIcalEvent(eventRow.uid, eventRow.ical_data || '');
                        const applicationData = calendarEventToActiveSyncApplicationData(parsed);

                        addNodes.push({
                            tag: "Add",
                            page: 0,
                            children: [
                                { tag: "ServerId", page: 0, content: eventRow.uid },
                                { tag: "ApplicationData", page: 0, children: applicationData }
                            ]
                        });
                    }
                }

                // Query tombstones and emit Delete commands for deleted events
                if (shouldSendEvents) {
                    const [tombstones]: any = await pool.query(
                        'SELECT uid FROM calendar_tombstones WHERE calendar_id = ? AND deleted_at > DATE_SUB(NOW(), INTERVAL 30 DAY)',
                        [calendar.id]
                    );
                    for (const t of tombstones) {
                        addNodes.push({
                            tag: "Add",
                            page: 0,
                            children: [
                                { tag: "ServerId", page: 0, content: t.uid }
                            ]
                        });
                    }
                    // Clean old tombstones
                    pool.query('DELETE FROM calendar_tombstones WHERE deleted_at < DATE_SUB(NOW(), INTERVAL 30 DAY)').catch(() => {});
                }

                const responseAst = {
                    tag: "Sync",
                    page: 0,
                    children: [
                        { tag: "Collections", page: 0, children: [
                            { tag: "Collection", page: 0, children: [
                                { tag: "Class", page: 0, content: "Calendar" },
                                { tag: "SyncKey", page: 0, content: nextSyncKey },
                                { tag: "CollectionId", page: 0, content: responseCollectionId },
                                { tag: "Status", page: 0, content: "1" },
                                ...(responses.length > 0 ? [{ tag: "Responses", page: 0, children: responses }] : []),
                                ...(addNodes.length > 0 ? [{ tag: "Commands", page: 0, children: addNodes }] : [])
                            ]}
                        ]}
                    ]
                };

                const writer = new WbxmlWriter();
                writer.writeNode(responseAst);
                console.log(`[SYNC] Sending Calendar Sync Response for ${responseCollectionId} with ${addNodes.length} items. SyncKey going to ${nextSyncKey}`);
                res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                return res.status(200).send(writer.getBuffer());
            } catch (e) {
                console.error("Failed to sync calendar:", e);
                return res.status(500).send();
            }
        }

        if (collectionId === 'mock-notes') {
            const creds = getAuthCredentials();
            if (!creds) return res.status(401).send();
            
            console.log(`[SYNC] Notes sync for ${creds.user}, SyncKey=${syncKey}`);
            let responses: any[] = [];
            
            try {
                const commandsNode = childNode(syncCollectionNode, 'Commands');
                if (commandsNode) {
                    for (const cmd of commandsNode.children || []) {
                        if (cmd.tag === 'Add') {
                            const clientId = childText(cmd, 'ClientId');
                            const appData = childNode(cmd, 'ApplicationData');
                            const noteData = activeSyncToDbNote(appData);
                            const saved = await saveNote({ ...noteData, owner: creds.user });
                            responses.push({
                                tag: 'Add', page: 0, children: [
                                    { tag: 'ClientId', page: 0, content: clientId },
                                    { tag: 'ServerId', page: 0, content: saved.id },
                                    { tag: 'Status', page: 0, content: '1' }
                                ]
                            });
                        } else if (cmd.tag === 'Change') {
                            const serverId = childText(cmd, 'ServerId');
                            const appData = childNode(cmd, 'ApplicationData');
                            const noteData = activeSyncToDbNote(appData);
                            await saveNote({ ...noteData, id: serverId, owner: creds.user });
                            responses.push({
                                tag: 'Change', page: 0, children: [
                                    { tag: 'ServerId', page: 0, content: serverId },
                                    { tag: 'Status', page: 0, content: '1' }
                                ]
                            });
                        } else if (cmd.tag === 'Delete') {
                            const serverId = childText(cmd, 'ServerId');
                            if (serverId) {
                                await deleteNote(serverId, creds.user);
                            }
                            responses.push({
                                tag: 'Delete', page: 0, children: [
                                    { tag: 'ServerId', page: 0, content: serverId },
                                    { tag: 'Status', page: 0, content: '1' }
                                ]
                            });
                        }
                    }
                    if (responses.length > 0) {
                        syncNotesWithImap(creds.user, creds.pass).catch(e => console.error(e));
                    }
                }
                
                let addNodes: any[] = [];
                let dbToken = await getNotesSyncToken(creds.user);
                let nextSyncKey = `notes-${dbToken}`;
                
                if (syncKey === '0') {
                    nextSyncKey = "1";
                } else if (syncKey === '1') {
                    const allNotes = await listNotes(creds.user);
                    for (const note of allNotes) {
                        addNodes.push({
                            tag: 'Add', page: 0, children: [
                                { tag: 'ServerId', page: 0, content: note.id },
                                dbNoteToActiveSync(note)
                            ]
                        });
                    }
                } else {
                    const currentSyncKey = parseInt(syncKey.replace('notes-', '')) || 1;
                    if (currentSyncKey !== dbToken) {
                        const allNotes = await listNotes(creds.user, true);
                        const changedNotes = allNotes.filter(n => n.sync_token > currentSyncKey);
                        for (const note of changedNotes) {
                            if ((note as any).is_deleted) {
                                addNodes.push({
                                    tag: 'Delete',
                                    page: 0,
                                    children: [
                                        { tag: 'ServerId', page: 0, content: note.id }
                                    ]
                                });
                            } else {
                                addNodes.push({
                                    tag: 'Change',
                                    page: 0,
                                    children: [
                                        { tag: 'ServerId', page: 0, content: note.id },
                                        dbNoteToActiveSync(note)
                                    ]
                                });
                            }
                        }
                    }
                }
                
                const responseAst = {
                    tag: "Sync", page: 0, children: [
                        { tag: "Collections", page: 0, children: [
                            { tag: "Collection", page: 0, children: [
                                { tag: "Class", page: 0, content: "Notes" },
                                { tag: "SyncKey", page: 0, content: nextSyncKey },
                                { tag: "CollectionId", page: 0, content: collectionId },
                                { tag: "Status", page: 0, content: "1" },
                                ...(responses.length > 0 ? [{ tag: "Responses", page: 0, children: responses }] : []),
                                ...(addNodes.length > 0 ? [{ tag: "Commands", page: 0, children: addNodes }] : [])
                            ]}
                        ]}
                    ]
                };
                
                const writer = new WbxmlWriter();
                writer.writeNode(responseAst);
                res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                return res.status(200).send(writer.getBuffer());
                
            } catch (e) {
                console.error("Notes sync error:", e);
                return res.status(500).send();
            }
        }

        if (collectionId.startsWith('mock-')) {
            console.log(`Mock Sync for ${collectionId}`);
            let cls = "Email";
            if (collectionId === "mock-contacts") cls = "Contacts";
            if (collectionId === "mock-calendar") cls = "Calendar";
            if (collectionId === "mock-tasks") cls = "Tasks";
            if (collectionId === "mock-notes") cls = "Notes";
            
            const nextSyncKey = ((parseInt(syncKey) || 0) + 1).toString();
            const responseAst = {
                tag: "Sync",
                page: 0,
                children: [
                    {
                        tag: "Collections",
                        page: 0,
                        children: [
                            {
                                tag: "Collection",
                                page: 0,
                                children: [
                                    { tag: "Class", page: 0, content: cls },
                                    { tag: "SyncKey", page: 0, content: nextSyncKey },
                                    { tag: "CollectionId", page: 0, content: collectionId },
                                    { tag: "Status", page: 0, content: "1" }
                                ]
                            }
                        ]
                    }
                ]
            };
            const writer = new WbxmlWriter();
            writer.writeNode(responseAst);
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(writer.getBuffer());
        }

        if (collectionId.startsWith('mail%')) {
            console.log(`Rejecting SOGo CollectionId ${collectionId} with Status 8`);
            const responseAst = {
                tag: "Sync",
                page: 0,
                children: [
                    {
                        tag: "Collections",
                        page: 0,
                        children: [
                            {
                                tag: "Collection",
                                page: 0,
                                children: [
                                    { tag: "SyncKey", page: 0, content: syncKey },
                                    { tag: "CollectionId", page: 0, content: collectionId },
                                    { tag: "Status", page: 0, content: "8" } // Object Not Found
                                ]
                            }
                        ]
                    }
                ]
            };
            const writer = new WbxmlWriter();
            writer.writeNode(responseAst);
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(writer.getBuffer());
        }

        // Real IMAP Folder
        const folderPath = Buffer.from(collectionId, 'base64').toString('utf8');
        const creds = getAuthCredentials();
        if (!creds) return res.status(401).send();
        const deviceId = validateActiveSyncDeviceId(req.query.DeviceId);
        if (!deviceId) return res.status(400).send();
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
            let state = await loadMailSyncState(creds.user, deviceId, collectionId);
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
            if (requestCommands.length > 512 || requestCommands.some((command: any) => !['Fetch', 'Change', 'Delete'].includes(command.tag))) {
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
                    read: childText(childNode(command, 'ApplicationData'), 'Read'),
                }));
            const deleteServerIds = requestCommands
                .filter((command: any) => command.tag === 'Delete')
                .map((command: any) => childText(command, 'ServerId'));
            const deletesAsMoves = childText(syncCollectionNode, 'DeletesAsMoves') !== '0';
            const getChangesRequested = Boolean(childNode(syncCollectionNode, 'GetChanges')) || requestCommands.length === 0;
            const optionsNode = childNode(syncCollectionNode, 'Options');
            const bodyPreferenceNodes = optionsNode?.children?.filter((node: any) => node.tag === 'BodyPreference') || [];
            const bodyPreferenceNode = bodyPreferenceNodes.find((node: any) => ['1', '2', '4'].includes(childText(node, 'Type')))
                || bodyPreferenceNodes[0];
            const requestedFilterType = childText(optionsNode, 'FilterType');
            const filterTypeSpecified = requestedFilterType !== '';
            const fallbackOptions = state || undefined;
            let syncOptions;
            try {
                syncOptions = normalizeMailSyncOptions({
                    filterType: requestedFilterType || undefined,
                    windowSize: childText(syncCollectionNode, 'WindowSize') || undefined,
                    bodyType: childText(bodyPreferenceNode, 'Type') || undefined,
                    truncationSize: childText(bodyPreferenceNode, 'TruncationSize') || undefined,
                }, fallbackOptions);
            } catch (error) {
                console.warn(`[SYNC] Invalid mail options for scope ${scopeHash.slice(0, 12)}:`, error);
                return sendMailSyncStatus('4');
            }
            const fetchServerIds = requestedFetchServerIds.slice(0, effectiveMailSyncWindow(syncOptions));
            const rejectedFetchServerIds = requestedFetchServerIds.slice(fetchServerIds.length);

            const nextSyncKey = createMailSyncKey();
            let serverCommands: MailSyncCommand[] = [];
            let nextKnownItems: MailSyncKnownItems = syncKey === '0' ? {} : { ...(state?.knownItems || {}) };
            let nextHighestModseq = state?.highestModseq || '0';
            let nextUidValidity = state?.uidValidity || '0';
            let minimumUid = syncKey === '0' ? 1 : (state?.minimumUid || 1);
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

                for (const change of changeReadFlags) {
                    const uid = Number.parseInt(change.serverId.slice(`${collectionId}-`.length), 10);
                    try {
                        if (!change.serverId.startsWith(`${collectionId}-`) || !Number.isInteger(uid) || uid < 1 || !['0', '1'].includes(change.read)) {
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
                        responses.push({
                            tag: 'Change', page: 0, children: [
                                { tag: 'ServerId', page: 0, content: change.serverId },
                                { tag: 'Status', page: 0, content: '1' },
                            ],
                        });
                    } catch {
                        responses.push({
                            tag: 'Change', page: 0, children: [
                                { tag: 'ServerId', page: 0, content: change.serverId },
                                { tag: 'Status', page: 0, content: '8' },
                            ],
                        });
                    }
                }

                for (const serverId of deleteServerIds) {
                    const uid = serverId.startsWith(`${collectionId}-`)
                        ? Number.parseInt(serverId.slice(`${collectionId}-`.length), 10)
                        : Number.NaN;
                    try {
                        if (!Number.isInteger(uid) || uid < 1) throw new Error('Invalid ServerId');
                        const folderIsTrash = ['TRASH', 'DELETED MESSAGES'].includes(folderPath.toUpperCase());
                        await imap.messageAction(folderPath, [uid], deletesAsMoves && !folderIsTrash ? 'delete' : 'hardDelete');
                        delete nextKnownItems[String(uid)];
                        responses.push({
                            tag: 'Delete', page: 0, children: [
                                { tag: 'ServerId', page: 0, content: serverId },
                                { tag: 'Status', page: 0, content: '1' },
                            ],
                        });
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
                    const snapshot = await imap.getActiveSyncMailSnapshot(
                        folderPath,
                        filterTypeCutoff(syncOptions.filterType),
                        state?.highestModseq || '0',
                        Object.keys(nextKnownItems).map(Number),
                    );
                    if (syncKey !== '0' && state && state.uidValidity !== '0' && state.uidValidity !== snapshot.uidValidity) {
                        return sendMailSyncStatus('3');
                    }
                    if (syncKey === '0' && !filterTypeSpecified) {
                        const initialWindow = [...snapshot.eligibleUids].sort((a, b) => b - a).slice(0, syncOptions.windowSize);
                        minimumUid = initialWindow.length ? Math.min(...initialWindow) : 1;
                    } else if (filterTypeSpecified && (!state || state.filterType !== syncOptions.filterType || state.minimumUid > 1)) {
                        minimumUid = 1;
                    }
                    const delta = computeMailSyncDelta({
                        knownItems: nextKnownItems,
                        allUids: snapshot.allUids,
                        eligibleUids: snapshot.eligibleUids,
                        changedReadFlags: snapshot.changedReadFlags,
                        windowSize: effectiveMailSyncWindow(syncOptions, fetchServerIds.length),
                        minimumUid,
                    });
                    serverCommands = delta.commands;
                    nextKnownItems = delta.nextKnownItems;
                    moreAvailable = delta.moreAvailable;
                    nextHighestModseq = delta.moreAvailable ? (state?.highestModseq || '0') : snapshot.highestModseq;
                    nextUidValidity = snapshot.uidValidity;
                }

                const bodyUids = Array.from(new Set([
                    ...serverCommands.filter(command => command.type === 'Add').map(command => command.uid),
                    ...fetchServerIds
                        .filter((serverId: string) => serverId.startsWith(`${collectionId}-`))
                        .map((serverId: string) => Number.parseInt(serverId.slice(`${collectionId}-`.length), 10))
                        .filter(Number.isInteger),
                ]));
                const messages = await imap.getActiveSyncMessages(
                    folderPath,
                    bodyUids,
                    syncOptions.truncationSize + 256 * 1024,
                );
                const messagesByUid = new Map(messages.map(message => [message.uid, message]));

                for (const serverId of fetchServerIds) {
                    const uid = serverId.startsWith(`${collectionId}-`)
                        ? Number.parseInt(serverId.slice(`${collectionId}-`.length), 10)
                        : Number.NaN;
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
                    const serverId = `${collectionId}-${command.uid}`;
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
                                { tag: 'Class', page: 0, content: 'Email' },
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
            } catch (error) {
                console.error(`Failed to sync IMAP scope ${scopeHash.slice(0, 12)}:`, error);
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
            } catch (e) {
                console.error(`Failed to parse ${cmd} WBXML:`, e);
            }
        }

        if (mimeContent) {
            try {
                const transporter = nodemailer.createTransport(smtpTransportOptions({
                    user: creds.user,
                    pass: creds.pass,
                }));

                const envelope = await buildActiveSyncSendMailEnvelope(mimeContent, creds.user);
                console.log(`[EAS] Sending email for ${creds.user} to ${envelope.to.length} recipient(s) via SMTP ${smtpConfig.host}:${smtpConfig.port}...`);
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
                        console.log(`[EAS] Saved to ${sentFolderObj.path}.`);
                    }
                    await imap.logout();
                }

                return res.status(200).send();
            } catch (err) {
                console.error(`[EAS] Error sending email:`, err);
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

                            console.log(`[EAS] Moving item ${uid} from ${sourceFolder} to ${destFolder}`);
                            await imap.moveMessage(sourceFolder, destFolder, uid);

                            responseNodes.push({
                                tag: "Response", page: 5, children: [
                                    { tag: "SrcMsgId", page: 5, content: srcMsgId },
                                    { tag: "Status", page: 5, content: "3" }, // 3 = Success
                                    { tag: "DstMsgId", page: 5, content: `${dstFldId}-${uid}` } // Rough approximation of new ID
                                ]
                            });
                        } catch (e) {
                            console.error(`[EAS] MoveItems Error:`, e);
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

            } catch (err) {
                console.error("Failed to process MoveItems:", err);
                return res.status(500).send();
            }
        }
        return res.status(500).send();
    }

    if (cmd === 'ItemOperations') {
        const creds = getAuthCredentials();
        if (!creds) return res.status(401).send();

        if (req.body && req.body.length > 0) {
            try {
                const parser = new WbxmlParser(req.body);
                const decoded = parser.parse();

                const responses: any[] = [];
                const fetches = decoded?.children?.filter((c: any) => c.tag === 'Fetch') || [];

                const imap = new ImapService(creds.user, creds.pass);
                await imap.connect();

                for (let fetchNode of fetches) {
                    let collectionId = "";
                    let serverId = "";
                    for (let child of fetchNode.children || []) {
                        if (child.tag === 'CollectionId') collectionId = child.content?.toString() || "";
                        if (child.tag === 'ServerId') serverId = child.content?.toString() || "";
                    }

                    if (collectionId && serverId) {
                        try {
                            const folderPath = Buffer.from(collectionId, 'base64').toString('utf8');
                            const parts = serverId.split('-');
                            const uid = parseInt(parts[parts.length - 1]);

                            console.log(`[EAS] ItemOperations Fetching full message ${uid} in ${folderPath}`);
                            const msg = await imap.getMessageByUid(folderPath, uid);

                            if (msg && msg.source) {
                                const parsed = await simpleParser(msg.source);
                                const isRead = msg.flags.includes('\\Seen') ? "1" : "0";
                                
                                // iOS usually prefers HTML if available, otherwise text
                                const bodyType = parsed.html ? "2" : "1";
                                const bodyData = parsed.html || parsed.text || "No content.";

                                responses.push({
                                    tag: "Fetch", page: 20, children: [
                                        { tag: "Status", page: 20, content: "1" },
                                        { tag: "ServerId", page: 20, content: serverId },
                                        { tag: "CollectionId", page: 20, content: collectionId },
                                        { tag: "Class", page: 20, content: "Email" },
                                        { tag: "Properties", page: 20, children: [
                                            { tag: "To", page: 2, content: (parsed.to as any)?.text || "" },
                                            { tag: "From", page: 2, content: (parsed.from as any)?.text || "" },
                                            { tag: "Subject", page: 2, content: parsed.subject || "" },
                                            { tag: "DateReceived", page: 2, content: (parsed.date || new Date()).toISOString() },
                                            { tag: "DisplayTo", page: 2, content: (parsed.to as any)?.text || "" },
                                            { tag: "Read", page: 2, content: isRead },
                                            { tag: "MessageClass", page: 2, content: "IPM.Note" },
                                            { tag: "Body", page: 17, children: [
                                                { tag: "Type", page: 17, content: bodyType },
                                                { tag: "Data", page: 17, content: bodyData },
                                                { tag: "EstimatedDataSize", page: 17, content: bodyData.length.toString() }
                                            ]}
                                        ]}
                                    ]
                                });
                            } else {
                                responses.push({
                                    tag: "Fetch", page: 20, children: [
                                        { tag: "Status", page: 20, content: "2" }, // Not found
                                        { tag: "ServerId", page: 20, content: serverId },
                                        { tag: "CollectionId", page: 20, content: collectionId }
                                    ]
                                });
                            }
                        } catch (e) {
                            console.error(`[EAS] ItemOperations Error:`, e);
                        }
                    }
                }

                await imap.logout();

                const responseAst = {
                    tag: "ItemOperations", page: 20, children: [
                        { tag: "Status", page: 20, content: "1" },
                        { tag: "Response", page: 20, children: responses }
                    ]
                };

                const writer = new WbxmlWriter();
                writer.writeNode(responseAst);
                res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                return res.status(200).send(writer.getBuffer());

            } catch (err) {
                console.error("Failed to process ItemOperations:", err);
                return res.status(500).send();
            }
        }
        return res.status(500).send();
    }

    res.status(200).send();
});

server.listen(serverConfig.port, serverConfig.host, () => {
    console.log(`OpenMailStack webmail backend listening on ${serverConfig.host}:${serverConfig.port}`);
});
