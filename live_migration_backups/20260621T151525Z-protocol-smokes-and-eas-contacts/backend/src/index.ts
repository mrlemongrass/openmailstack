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
import { getPublicBaseUrl, normalizeMailboxUsername, serverConfig, smtpConfig } from './config';
import { rateLimit, securityHeaders } from './security';
import { ensureMailSearchSchema } from './search-index';
import { ensureCalendarSchema, ensureDefaultCalendar, formatActiveSyncDate, getCalendarFolderSyncKey, getVisibleCalendars, parseIcalEvent } from './calendar-utils';
import { ensureContactsSchema } from './contact-utils';

const app = express();
ensureMailSearchSchema().catch(err => console.error('Failed to initialize mail search index:', err));
ensureCalendarSchema().catch(err => console.error('Failed to initialize calendar schema:', err));
ensureContactsSchema().catch(err => console.error('Failed to initialize contacts schema:', err));
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(securityHeaders);
app.use(express.json());
app.use(bodyParser.raw({
    type: (req: any) => {
        const contentType = String(req.headers['content-type'] || '').toLowerCase();
        return !req.url.startsWith('/api/') && !contentType.includes('multipart/form-data');
    },
    limit: `${serverConfig.uploadLimitBytes}b`
}));

import caldavRouter from './caldav';
import carddavRouter from './carddav';
import { appsApiRouter } from './apps-api';

app.use('/api/auth/login', rateLimit(15 * 60 * 1000, 20));
app.use('/api', cors({ credentials: true, origin: true }), apiRouter);
app.use('/api/apps', cors({ credentials: true, origin: true }), appsApiRouter);
app.use('/caldav', caldavRouter);
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
        res.set('MS-ASProtocolCommands', 'Sync,SendMail,SmartForward,SmartReply,GetAttachment,GetHierarchy,CreateCollection,DeleteCollection,MoveCollection,FolderSync,FolderCreate,FolderDelete,FolderUpdate,MoveItems,GetItemEstimate,MeetingResponse,Search,Settings,Ping,ItemOperations,ResolveRecipients,ValidateCert');
        res.set('Public', 'OPTIONS,POST');
        return res.status(200).send();
    }

    if (req.body && req.body.length > 0) {
        // console.log("Raw Body (hex):", req.body.toString('hex'));
        try {
            const parser = new WbxmlParser(req.body);
            const decoded = parser.parse();
            console.log("Decoded Request:", JSON.stringify(decoded, null, 2));
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

            let mockFolders = [
                { tag: "Add", page: 7, children: [
                    { tag: "ServerId", page: 7, content: "mock-contacts" },
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
                { serverId: "mock-contacts", displayName: "Contacts", type: "9" },
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
                    mockFolders.push({
                        tag: "Add", page: 7, children: [
                            { tag: "ServerId", page: 7, content: serverId },
                            { tag: "ParentId", page: 7, content: "0" },
                            { tag: "DisplayName", page: 7, content: displayName },
                            { tag: "Type", page: 7, content: type } // Default Calendar
                        ]
                    });
                }
            } catch(e) {}

            const allNodes = [...mailNodes, ...mockFolders];
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
        let collectionId = "";
        let syncKey = "1";
        if (req.body && req.body.length > 0) {
            try {
                const parser = new WbxmlParser(req.body);
                const decoded = parser.parse();
                // extract collectionId from request
                const collNode = decoded?.children?.find((c: any) => c.tag === 'Collections')
                                        ?.children?.find((c: any) => c.tag === 'Collection');
                if (collNode) {
                    const idNode = collNode.children?.find((c: any) => c.tag === 'CollectionId');
                    if (idNode && idNode.content) collectionId = idNode.content.toString();
                    const keyNode = collNode.children?.find((c: any) => c.tag === 'SyncKey');
                    if (keyNode && keyNode.content) syncKey = keyNode.content.toString();
                }
            } catch (e) {}
        }

        if (collectionId === 'mock-calendar' || collectionId.startsWith('cal-')) {
            const creds = getAuthCredentials();
            if (!creds) return res.status(401).send();

            try {
                const responseCollectionId = collectionId;
                let calendar: any;
                if (collectionId.startsWith('cal-')) {
                    const calendarId = collectionId.slice(4);
                    const [rows]: any = await pool.query('SELECT * FROM calendars WHERE id = ? AND user_id = ? LIMIT 1', [calendarId, creds.user]);
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

                const nextSyncKey = `cal-${calendar.id}-${calendar.sync_token || 1}`;
                const shouldSendEvents = syncKey === "0" || syncKey === "1" || syncKey !== nextSyncKey;
                const addNodes: any[] = [];

                if (shouldSendEvents) {
                    const [events]: any = await pool.query(
                        'SELECT uid, ical_data FROM events WHERE calendar_id = ? ORDER BY updated_at ASC, id ASC',
                        [calendar.id]
                    );

                    for (const eventRow of events) {
                        const parsed = parseIcalEvent(eventRow.uid, eventRow.ical_data || '');
                        const applicationData: any[] = [
                            { tag: "Subject", page: 4, content: parsed.title },
                            { tag: "UID", page: 4, content: parsed.uid },
                            { tag: "StartTime", page: 4, content: formatActiveSyncDate(parsed.start) },
                            { tag: "EndTime", page: 4, content: formatActiveSyncDate(parsed.end) },
                            { tag: "DtStamp", page: 4, content: formatActiveSyncDate(parsed.dtstamp) },
                            { tag: "AllDayEvent", page: 4, content: parsed.isAllDay ? "1" : "0" },
                            { tag: "BusyStatus", page: 4, content: "2" },
                            { tag: "Sensitivity", page: 4, content: "0" },
                            { tag: "MeetingStatus", page: 4, content: "0" }
                        ];

                        if (parsed.location) {
                            applicationData.push({ tag: "Location", page: 4, content: parsed.location });
                        }
                        if (parsed.description) {
                            applicationData.push({
                                tag: "Body",
                                page: 17,
                                children: [
                                    { tag: "Type", page: 17, content: "1" },
                                    { tag: "Data", page: 17, content: parsed.description },
                                    { tag: "EstimatedDataSize", page: 17, content: parsed.description.length.toString() }
                                ]
                            });
                        }

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
        console.log(`Client Syncing IMAP Folder: ${folderPath} with SyncKey: ${syncKey}`);
        
        const creds = getAuthCredentials();
        if (!creds) return res.status(401).send();

        let addNodes: any[] = [];
        let fetchResponses: any[] = [];
        let nextSyncKey = ((parseInt(syncKey) || 0) + 1).toString();
        let moreAvailable = false;

        try {
            // Parse request for Fetch commands
            let fetchServerIds: string[] = [];
            if (req.body && req.body.length > 0) {
                try {
                    const parser = new WbxmlParser(req.body);
                    const decoded = parser.parse();
                    const collNode = decoded?.children?.find((c: any) => c.tag === 'Collections')
                                            ?.children?.find((c: any) => c.tag === 'Collection');
                    if (collNode) {
                        const commandsNode = collNode.children?.find((c: any) => c.tag === 'Commands');
                        if (commandsNode) {
                            for (let cmd of commandsNode.children || []) {
                                if (cmd.tag === 'Fetch') {
                                    const idNode = cmd.children?.find((c: any) => c.tag === 'ServerId');
                                    if (idNode && idNode.content) fetchServerIds.push(idNode.content.toString());
                                }
                            }
                        }
                    }
                } catch (e) {}
            }

            const imap = new ImapService(creds.user, creds.pass);
            await imap.connect();

            // Process Fetch commands
            for (let id of fetchServerIds) {
                // id is like "SU5CT1g=-123"
                const parts = id.split('-');
                const uidPart = parts.length > 1 ? parts[1] : id;
                const msg = await imap.getMessageByUid(folderPath, parseInt(uidPart));
                if (msg && msg.source) {
                    fetchResponses.push({
                        tag: "Fetch",
                        page: 0,
                        children: [
                            { tag: "ServerId", page: 0, content: id },
                            { tag: "Status", page: 0, content: "1" },
                            { tag: "ApplicationData", page: 0, children: [
                                { tag: "Body", page: 17, children: [
                                    { tag: "Type", page: 17, content: "4" },
                                    { tag: "Data", page: 17, content: msg.source.toString('utf8') },
                                    { tag: "EstimatedDataSize", page: 17, content: msg.source.length.toString() }
                                ]}
                            ] }
                        ]
                    });
                } else {
                    fetchResponses.push({
                        tag: "Fetch",
                        page: 0,
                        children: [
                            { tag: "ServerId", page: 0, content: id },
                            { tag: "Status", page: 0, content: "8" } // Not found
                        ]
                    });
                }
            }
            
            let result;
            let lowestUid = -1;
            let currentUidNext = -1;
            
            if (syncKey === "1") {
                // Initial sync, fetch newest 25
                result = await imap.getMessages(folderPath);
            } else {
                const parts = syncKey.split('-');
                if (parts.length === 2) {
                    lowestUid = parseInt(parts[0]);
                    currentUidNext = parseInt(parts[1]);
                } else {
                    currentUidNext = parseInt(syncKey);
                }
                
                result = await imap.getMessages(folderPath, currentUidNext);
                
                // If there are no new messages, but the client explicitly sent a Sync request, 
                // they might be paging backwards.
                if (result.messages.length === 0 && lowestUid > 1) {
                    result = await imap.getMessages(folderPath, undefined, lowestUid);
                }
            }
            
            await imap.logout();
            const { messages, uidNext, lowestUid: newLowestUid, moreAvailable: isMore } = result;
            if (isMore) moreAvailable = true;
            
            // Set nextSyncKey to maintain pagination bounds
            if (uidNext) {
                const effectiveLowestUid = newLowestUid > 0 ? newLowestUid : (lowestUid > 0 ? lowestUid : uidNext);
                nextSyncKey = `${effectiveLowestUid}-${uidNext}`;
            }

            console.log(`[SYNC] Fetched ${messages.length} messages from IMAP for ${folderPath} (SyncKey state: ${nextSyncKey})`);

            const simpleParser = require('mailparser').simpleParser;

            for (let msg of messages) {
                // parse email
                const parsed = await simpleParser(msg.source);
                const isRead = msg.flags.includes('\\Seen') ? "1" : "0";
                
                const textBody = parsed.text || "No preview available.";
                const truncatedText = textBody.substring(0, 499);
                const isTruncated = textBody.length > 500 ? "1" : "0";
                const globalServerId = `${collectionId}-${msg.uid}`;
                
                addNodes.push({
                    tag: "Add",
                    page: 0,
                    children: [
                        { tag: "ServerId", page: 0, content: globalServerId },
                        { tag: "ApplicationData", page: 0, children: [
                            { tag: "To", page: 2, content: (parsed.to as any)?.text || "" },
                            { tag: "From", page: 2, content: (parsed.from as any)?.text || "" },
                            { tag: "Subject", page: 2, content: parsed.subject || "" },
                            { tag: "DateReceived", page: 2, content: (parsed.date || new Date()).toISOString() },
                            { tag: "DisplayTo", page: 2, content: (parsed.to as any)?.text || "" },
                            { tag: "Read", page: 2, content: isRead },
                            { tag: "MessageClass", page: 2, content: "IPM.Note" },
                            { tag: "Body", page: 17, children: [
                                { tag: "Type", page: 17, content: "1" },
                                { tag: "Data", page: 17, content: truncatedText },
                                { tag: "EstimatedDataSize", page: 17, content: textBody.length.toString() },
                                ...(isTruncated === "1" ? [{ tag: "Truncated", page: 17, content: "1" }] : [])
                            ]}
                        ]}
                    ]
                });
            }
        } catch (e) {
            console.error("Failed to sync IMAP:", e);
        }

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
                                { tag: "Class", page: 0, content: "Email" },
                                { tag: "SyncKey", page: 0, content: nextSyncKey },
                                { tag: "CollectionId", page: 0, content: collectionId },
                                { tag: "Status", page: 0, content: "1" },
                                ...(moreAvailable ? [{ tag: "MoreAvailable", page: 0, children: [] }] : []),
                                ...(fetchResponses.length > 0 ? [{ tag: "Responses", page: 0, children: fetchResponses }] : []),
                                ...(addNodes.length > 0 ? [{ tag: "Commands", page: 0, children: addNodes }] : [])
                            ]
                        }
                    ]
                }
            ]
        };

        const writer = new WbxmlWriter();
        writer.writeNode(responseAst);
        console.log(`[SYNC] Sending Sync Response for ${folderPath} with ${addNodes.length} items. SyncKey going to ${nextSyncKey}. MoreAvailable: ${moreAvailable}`);
        res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
        return res.status(200).send(writer.getBuffer());
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

        let mimeContent = "";
        let saveInSent = false;

        if (req.body && req.body.length > 0) {
            try {
                const parser = new WbxmlParser(req.body);
                const decoded = parser.parse();
                
                // Find Mime and SaveInSentItems recursively
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

                const mimeNode = findNode(decoded, 'Mime');
                if (mimeNode && mimeNode.content) {
                    mimeContent = mimeNode.content.toString();
                }

                const saveNode = findNode(decoded, 'SaveInSentItems');
                if (saveNode) saveInSent = true;
            } catch (e) {
                console.error(`Failed to parse ${cmd} WBXML:`, e);
            }
        }

        if (mimeContent) {
            try {
                const transporter = nodemailer.createTransport({
                    host: smtpConfig.host,
                    port: smtpConfig.port,
                    secure: smtpConfig.secure,
                    tls: { rejectUnauthorized: smtpConfig.rejectUnauthorized },
                    auth: {
                        user: creds.user,
                        pass: creds.pass
                    }
                });

                console.log(`[EAS] Sending email for ${creds.user} via SMTP localhost:25...`);
                await transporter.sendMail({ raw: mimeContent });
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

app.listen(serverConfig.port, serverConfig.host, () => {
    console.log(`OpenMailStack webmail backend listening on ${serverConfig.host}:${serverConfig.port}`);
});
