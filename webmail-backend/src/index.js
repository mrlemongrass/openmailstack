"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.io = void 0;
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
const parser_1 = require("./wbxml/parser");
const writer_1 = require("./wbxml/writer");
const imap_1 = require("./imap");
const api_1 = require("./api");
const cors_1 = __importDefault(require("cors"));
const nodemailer_1 = __importDefault(require("nodemailer"));
const mailparser_1 = require("mailparser");
const db_1 = require("./db");
const config_1 = require("./config");
const security_1 = require("./security");
const search_index_1 = require("./search-index");
const user_settings_1 = require("./user-settings");
const admin_settings_1 = require("./admin-settings");
const branding_1 = require("./branding");
const calendar_utils_1 = require("./calendar-utils");
const contact_utils_1 = require("./contact-utils");
const notes_utils_1 = require("./notes-utils");
const eas_notes_1 = require("./eas-notes");
const notes_imap_sync_1 = require("./notes-imap-sync");
const search_worker_1 = require("./search-worker");
const scheduled_send_1 = require("./scheduled-send");
const calendar_subscription_1 = require("./calendar-subscription");
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
exports.io = new socket_io_1.Server(server, {
    cors: { origin: true, credentials: true }
});
exports.io.on('connection', (socket) => {
    socket.on('join', (username) => {
        if (username) {
            socket.join(username);
        }
    });
});
(0, search_index_1.ensureMailSearchSchema)().catch(err => console.error('Failed to initialize mail search index:', err));
(0, search_worker_1.startSearchWorker)();
(0, scheduled_send_1.startScheduledSender)();
(0, calendar_subscription_1.startCalendarSubscriptionWorker)();
(0, user_settings_1.ensureUserSettingsSchema)().catch(err => console.error('Failed to initialize user settings schema:', err));
(0, admin_settings_1.ensureAdminSettingsSchema)().catch(err => console.error('Failed to initialize admin settings schema:', err));
(0, branding_1.ensureBrandingSchema)().catch(err => console.error('Failed to initialize branding schema:', err));
(0, calendar_utils_1.ensureCalendarSchema)().catch(err => console.error('Failed to initialize calendar schema:', err));
(0, contact_utils_1.ensureContactsSchema)().catch(err => console.error('Failed to initialize contacts schema:', err));
(0, notes_utils_1.ensureNotesSchema)().catch(err => console.error('Failed to initialize notes schema:', err));
(0, notes_utils_1.ensureRemindersSchema)().catch(err => console.error('Failed to initialize reminders schema:', err));
(0, notes_utils_1.ensureAttachmentsSchema)().catch(err => console.error('Failed to initialize attachments schema:', err));
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(security_1.securityHeaders);
app.use(express_1.default.json({ limit: `${config_1.serverConfig.uploadLimitBytes}b` }));
app.use(body_parser_1.default.raw({
    type: (req) => {
        const contentType = String(req.headers['content-type'] || '').toLowerCase();
        return !req.url.startsWith('/api/') && !contentType.includes('multipart/form-data');
    },
    limit: `${config_1.serverConfig.uploadLimitBytes}b`
}));
const path = __importStar(require("path"));
app.use('/uploads', express_1.default.static(path.join(__dirname, '..', 'uploads')));
const caldav_1 = __importDefault(require("./caldav"));
const carddav_1 = __importDefault(require("./carddav"));
const apps_api_1 = require("./apps-api");
const CONTACTS_COLLECTION_ID = 'contacts';
const LEGACY_CONTACTS_COLLECTION_ID = 'mock-contacts';
const nodeText = (node) => node?.content ? node.content.toString() : '';
const childNode = (node, tag) => node?.children?.find((child) => child.tag === tag);
const childText = (node, tag) => nodeText(childNode(node, tag));
const firstNonEmpty = (...values) => values.map(value => value.trim()).find(Boolean) || '';
function vcardEscape(value) {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,');
}
function icalEscape(value) {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,');
}
function splitContactName(name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 1)
        return { firstName: parts[0] || '', lastName: '' };
    return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}
function contactToActiveSyncApplicationData(contact) {
    const fileAs = contact.name || contact.email || 'Unnamed Contact';
    const { firstName, lastName } = splitContactName(contact.name || '');
    const data = [
        { tag: 'FileAs', page: 1, content: fileAs }
    ];
    if (firstName)
        data.push({ tag: 'FirstName', page: 1, content: firstName });
    if (lastName)
        data.push({ tag: 'LastName', page: 1, content: lastName });
    if (contact.email)
        data.push({ tag: 'Email1Address', page: 1, content: contact.email });
    if (contact.phone)
        data.push({ tag: 'MobilePhoneNumber', page: 1, content: contact.phone });
    if (contact.organization)
        data.push({ tag: 'CompanyName', page: 1, content: contact.organization });
    if (contact.job_title)
        data.push({ tag: 'JobTitle', page: 1, content: contact.job_title });
    if (contact.photo_url) {
        const photo = contact.photo_url;
        if (photo.startsWith('data:image/')) {
            data.push({ tag: 'Picture', page: 1, content: photo });
        }
    }
    const vcard = (0, contact_utils_1.contactVCard)(contact);
    if (vcard) {
        data.push({
            tag: 'Body',
            page: 17,
            children: [
                { tag: 'Type', page: 17, content: '1' },
                { tag: 'Data', page: 17, content: vcard },
                { tag: 'EstimatedDataSize', page: 17, content: vcard.length.toString() }
            ]
        });
    }
    return data;
}
function activeSyncApplicationDataToVCard(davUid, applicationData) {
    const firstName = childText(applicationData, 'FirstName');
    const lastName = childText(applicationData, 'LastName');
    const fileAs = childText(applicationData, 'FileAs');
    const email = firstNonEmpty(childText(applicationData, 'Email1Address'), childText(applicationData, 'Email2Address'), childText(applicationData, 'Email3Address'));
    const phone = firstNonEmpty(childText(applicationData, 'MobilePhoneNumber'), childText(applicationData, 'BusinessPhoneNumber'), childText(applicationData, 'HomePhoneNumber'), childText(applicationData, 'Business2PhoneNumber'), childText(applicationData, 'Home2PhoneNumber'));
    const company = childText(applicationData, 'CompanyName');
    const displayName = firstNonEmpty([firstName, lastName].filter(Boolean).join(' '), fileAs, email, 'Unnamed Contact');
    const lines = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `UID:${vcardEscape(davUid)}`,
        `FN:${vcardEscape(displayName)}`,
        `N:${vcardEscape(lastName)};${vcardEscape(firstName)};;;`
    ];
    if (email)
        lines.push(`EMAIL;TYPE=INTERNET:${vcardEscape(email)}`);
    if (phone)
        lines.push(`TEL;TYPE=CELL:${vcardEscape(phone)}`);
    if (company)
        lines.push(`ORG:${vcardEscape(company)}`);
    const picture = childText(applicationData, 'Picture');
    if (picture && picture.startsWith('data:image/')) {
        const b64 = picture.replace(/^data:image\/[^;]+;base64,/, '');
        lines.push(`PHOTO;ENCODING=BASE64;TYPE=JPEG:${b64}`);
    }
    lines.push('END:VCARD');
    return `${lines.join('\r\n')}\r\n`;
}
function normalizeCalendarEventUid(value) {
    const normalized = value
        .trim()
        .replace(/[\r\n]+/g, '-')
        .replace(/[^A-Za-z0-9._@-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 180);
    return normalized || `eas-event-${Date.now()}`;
}
function parseActiveSyncCalendarDate(value) {
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    const compact = trimmed.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.\d+)?Z?$/);
    if (compact) {
        return new Date(Date.UTC(Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]), Number(compact[4]), Number(compact[5]), Number(compact[6])));
    }
    const dateOnly = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (dateOnly) {
        return new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 0, 0, 0));
    }
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function formatIcalUtcDate(date) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
function formatIcalDateOnly(date) {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
}
function activeSyncCalendarApplicationDataToIcal(uid, applicationData, existingIcal = '') {
    const existing = existingIcal ? (0, calendar_utils_1.parseIcalEvent)(uid, existingIcal) : null;
    const body = childNode(applicationData, 'Body');
    const allDayText = childText(applicationData, 'AllDayEvent');
    const isAllDay = allDayText ? allDayText === '1' : Boolean(existing?.isAllDay);
    const start = parseActiveSyncCalendarDate(childText(applicationData, 'StartTime')) || existing?.start || new Date();
    const fallbackEnd = new Date(start.getTime() + (isAllDay ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000));
    let end = parseActiveSyncCalendarDate(childText(applicationData, 'EndTime')) || existing?.end || fallbackEnd;
    if (end.getTime() <= start.getTime()) {
        end = fallbackEnd;
    }
    const subject = firstNonEmpty(childText(applicationData, 'Subject'), existing?.title || '', 'Untitled');
    const location = firstNonEmpty(childText(applicationData, 'Location'), existing?.location || '');
    const description = firstNonEmpty(childText(body, 'Data'), childText(applicationData, 'Description'), existing?.description || '');
    const dtstamp = parseActiveSyncCalendarDate(childText(applicationData, 'DtStamp')) || existing?.dtstamp || new Date();
    // Parse recurrence from EAS
    let rruleLine = existing?.recurrence?.raw || '';
    const recurrenceNode = childNode(applicationData, 'Recurrence');
    if (recurrenceNode) {
        const recType = childText(recurrenceNode, 'Type');
        const interval = childText(recurrenceNode, 'Interval') || '1';
        const until = childText(recurrenceNode, 'Until');
        const occurrences = childText(recurrenceNode, 'Occurrences');
        const freqMap = { '0': 'DAILY', '1': 'WEEKLY', '2': 'MONTHLY', '5': 'YEARLY' };
        const freq = freqMap[recType] || 'DAILY';
        let rrule = `RRULE:FREQ=${freq}`;
        if (interval !== '1')
            rrule += `;INTERVAL=${interval}`;
        if (until)
            rrule += `;UNTIL=${until.replace(/[^0-9TZ]/g, '')}`;
        if (occurrences)
            rrule += `;COUNT=${occurrences}`;
        rruleLine = rrule;
    }
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//OpenMailStack//ActiveSync Calendar//EN',
        'BEGIN:VEVENT',
        `UID:${icalEscape(uid)}`,
        `DTSTAMP:${formatIcalUtcDate(dtstamp)}`
    ];
    if (isAllDay) {
        lines.push(`DTSTART;VALUE=DATE:${formatIcalDateOnly(start)}`);
        lines.push(`DTEND;VALUE=DATE:${formatIcalDateOnly(end)}`);
    }
    else {
        lines.push(`DTSTART:${formatIcalUtcDate(start)}`);
        lines.push(`DTEND:${formatIcalUtcDate(end)}`);
    }
    lines.push(`SUMMARY:${icalEscape(subject)}`);
    if (location)
        lines.push(`LOCATION:${icalEscape(location)}`);
    if (description)
        lines.push(`DESCRIPTION:${icalEscape(description)}`);
    if (rruleLine)
        lines.push(rruleLine);
    lines.push('TRANSP:OPAQUE');
    lines.push('END:VEVENT');
    lines.push('END:VCALENDAR');
    return `${lines.join('\r\n')}\r\n`;
}
async function saveActiveSyncCalendarEvent(calendarId, uid, ical) {
    const [existingRows] = await db_1.pool.query('SELECT ical_data FROM events WHERE calendar_id = ? AND uid = ? LIMIT 1', [calendarId, uid]);
    if (existingRows.length > 0) {
        if ((existingRows[0].ical_data || '') === ical) {
            return false;
        }
        await db_1.pool.query('UPDATE events SET ical_data = ? WHERE calendar_id = ? AND uid = ?', [ical, calendarId, uid]);
    }
    else {
        await db_1.pool.query('INSERT INTO events (calendar_id, uid, ical_data) VALUES (?, ?, ?)', [calendarId, uid, ical]);
    }
    await db_1.pool.query('UPDATE calendars SET sync_token = sync_token + 1 WHERE id = ?', [calendarId]);
    return true;
}
function isContactsCollection(collectionId) {
    return collectionId === CONTACTS_COLLECTION_ID || collectionId === LEGACY_CONTACTS_COLLECTION_ID;
}
app.use('/api/auth/login', (0, security_1.rateLimit)(15 * 60 * 1000, 20));
app.use('/api', (0, cors_1.default)({ credentials: true, origin: true }), api_1.apiRouter);
app.use('/api/apps', (0, cors_1.default)({ credentials: true, origin: true }), apps_api_1.appsApiRouter);
app.use('/caldav', caldav_1.default);
app.all('/', (req, res, next) => {
    if (req.method === 'PROPFIND') {
        res.redirect(301, '/carddav/');
        return;
    }
    next();
});
app.use('/carddav', carddav_1.default);
app.all('/.well-known/caldav', (req, res) => {
    res.redirect(301, '/caldav/');
});
app.all('/.well-known/carddav', (req, res) => {
    res.redirect(301, '/carddav/');
});
app.all(['/autodiscover/autodiscover.xml', '/Autodiscover/Autodiscover.xml'], (req, res) => {
    let email = config_1.serverConfig.defaultDomain ? `user@${config_1.serverConfig.defaultDomain}` : 'user@example.invalid';
    if (req.body && req.body.length > 0) {
        const bodyStr = req.body.toString('utf8');
        const match = bodyStr.match(/<EMailAddress>(.*?)<\/EMailAddress>/i);
        if (match)
            email = match[1];
    }
    const publicBaseUrl = (0, config_1.getPublicBaseUrl)(req);
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
            const parser = new parser_1.WbxmlParser(req.body);
            const decoded = parser.parse();
            console.log("Decoded Request:", JSON.stringify(decoded, null, 2));
        }
        catch (err) {
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
            user = (0, config_1.normalizeMailboxUsername)(user);
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
                const parser = new parser_1.WbxmlParser(req.body);
                const decoded = parser.parse();
                const syncKeyNode = decoded?.children?.find((c) => c.tag === 'SyncKey');
                if (syncKeyNode && syncKeyNode.content) {
                    syncKey = syncKeyNode.content.toString();
                }
            }
            catch (e) { }
        }
        let responseAst;
        const creds = getAuthCredentials();
        if (!creds) {
            return res.status(401).send();
        }
        try {
            const imap = new imap_1.ImapService(creds.user, creds.pass);
            await imap.connect();
            const folders = await imap.getFolders();
            await imap.logout();
            const folderDescriptors = [];
            const mailNodes = folders.map((f) => {
                const path = f.path;
                // Type mapping
                let type = "12"; // User-created Mail folder
                if (path.toUpperCase() === 'INBOX')
                    type = "2";
                else if (path.toUpperCase() === 'DRAFTS')
                    type = "3";
                else if (path.toUpperCase() === 'TRASH' || path.toUpperCase() === 'DELETED MESSAGES')
                    type = "4";
                else if (path.toUpperCase() === 'SENT' || path.toUpperCase() === 'SENT MESSAGES')
                    type = "5";
                else if (path.toUpperCase() === 'JUNK')
                    type = "12";
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
                    ] };
            });
            let serviceFolders = [
                { tag: "Add", page: 7, children: [
                        { tag: "ServerId", page: 7, content: CONTACTS_COLLECTION_ID },
                        { tag: "ParentId", page: 7, content: "0" },
                        { tag: "DisplayName", page: 7, content: "Contacts" },
                        { tag: "Type", page: 7, content: "9" }
                    ] },
                { tag: "Add", page: 7, children: [
                        { tag: "ServerId", page: 7, content: "mock-tasks" },
                        { tag: "ParentId", page: 7, content: "0" },
                        { tag: "DisplayName", page: 7, content: "Reminders" },
                        { tag: "Type", page: 7, content: "7" }
                    ] },
                { tag: "Add", page: 7, children: [
                        { tag: "ServerId", page: 7, content: "mock-notes" },
                        { tag: "ParentId", page: 7, content: "0" },
                        { tag: "DisplayName", page: 7, content: "Notes" },
                        { tag: "Type", page: 7, content: "10" }
                    ] }
            ];
            folderDescriptors.push({ serverId: CONTACTS_COLLECTION_ID, displayName: "Contacts", type: "9" }, { serverId: "mock-tasks", displayName: "Reminders", type: "7" }, { serverId: "mock-notes", displayName: "Notes", type: "10" });
            try {
                const cals = await (0, calendar_utils_1.getVisibleCalendars)(creds.user);
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
            }
            catch (e) { }
            const allNodes = [...mailNodes, ...serviceFolders];
            const currentSyncKey = (0, calendar_utils_1.getCalendarFolderSyncKey)(folderDescriptors);
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
            }
            else if (syncKey !== "0") {
                console.log(`Client sent stale FolderSync key ${syncKey}. Forcing hierarchy reset to ${currentSyncKey}.`);
                responseAst = {
                    tag: "FolderSync",
                    page: 7,
                    children: [
                        { tag: "Status", page: 7, content: "9" }
                    ]
                };
            }
            else {
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
                            ] }
                    ]
                };
            }
        }
        catch (err) {
            console.error("IMAP Error during FolderSync:", err);
            if (err && err.message && err.message.toLowerCase().includes('auth')) {
                return res.status(401).send();
            }
            return res.status(401).send(); // Always return 401 so iOS asks for password again instead of failing
        }
        const writer = new writer_1.WbxmlWriter();
        writer.writeNode(responseAst);
        const outBuffer = writer.getBuffer();
        console.log("Sending FolderSync response.");
        res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
        return res.status(200).send(outBuffer);
    }
    if (cmd === 'FolderCreate') {
        const auth = getAuthCredentials();
        if (!auth)
            return res.status(401).send();
        const decoded = new parser_1.WbxmlParser(req.body).parse();
        const parentId = childText(decoded, 'ParentId') || '0';
        const displayName = childText(decoded, 'DisplayName') || 'New Folder';
        try {
            const imap = new imap_1.ImapService(auth.user, auth.pass);
            await imap.connect();
            const separator = '/';
            const parentPath = parentId === '0' ? '' : parentId;
            const folderPath = parentPath ? `${parentPath}${separator}${displayName}` : displayName;
            await imap.client.mailboxCreate(folderPath);
            await imap.logout();
            const writer = new writer_1.WbxmlWriter();
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
        }
        catch (e) {
            const writer = new writer_1.WbxmlWriter();
            writer.writeNode({ tag: 'FolderCreate', page: 7, children: [{ tag: 'Status', page: 7, content: '8' }] });
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(writer.getBuffer());
        }
    }
    if (cmd === 'FolderDelete') {
        const auth = getAuthCredentials();
        if (!auth)
            return res.status(401).send();
        const decoded = new parser_1.WbxmlParser(req.body).parse();
        const serverId = childText(decoded, 'ServerId') || '';
        try {
            const imap = new imap_1.ImapService(auth.user, auth.pass);
            await imap.connect();
            await imap.client.mailboxDelete(serverId);
            await imap.logout();
            const writer = new writer_1.WbxmlWriter();
            writer.writeNode({ tag: 'FolderDelete', page: 7, children: [{ tag: 'Status', page: 7, content: '1' }] });
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(writer.getBuffer());
        }
        catch (e) {
            const writer = new writer_1.WbxmlWriter();
            writer.writeNode({ tag: 'FolderDelete', page: 7, children: [{ tag: 'Status', page: 7, content: '8' }] });
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(writer.getBuffer());
        }
    }
    if (cmd === 'FolderUpdate') {
        const auth = getAuthCredentials();
        if (!auth)
            return res.status(401).send();
        const decoded = new parser_1.WbxmlParser(req.body).parse();
        const serverId = childText(decoded, 'ServerId') || '';
        const newName = childText(decoded, 'DisplayName') || '';
        try {
            const imap = new imap_1.ImapService(auth.user, auth.pass);
            await imap.connect();
            const separator = '/';
            const parts = serverId.split(separator);
            parts[parts.length - 1] = newName;
            const newPath = parts.join(separator);
            await imap.client.mailboxRename(serverId, newPath);
            await imap.logout();
            const writer = new writer_1.WbxmlWriter();
            writer.writeNode({ tag: 'FolderUpdate', page: 7, children: [
                    { tag: 'Status', page: 7, content: '1' },
                    { tag: 'ServerId', page: 7, content: newPath },
                    { tag: 'DisplayName', page: 7, content: newName }
                ] });
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(writer.getBuffer());
        }
        catch (e) {
            const writer = new writer_1.WbxmlWriter();
            writer.writeNode({ tag: 'FolderUpdate', page: 7, children: [{ tag: 'Status', page: 7, content: '8' }] });
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(writer.getBuffer());
        }
    }
    if (cmd === 'Provision') {
        let policyKey = "0";
        try {
            if (req.body && req.body.length > 0) {
                const parser = new parser_1.WbxmlParser(req.body);
                const decoded = parser.parse();
                const polNode = decoded?.children?.find((c) => c.tag === 'Policies')
                    ?.children?.find((c) => c.tag === 'Policy');
                if (polNode) {
                    const keyNode = polNode.children?.find((c) => c.tag === 'PolicyKey');
                    if (keyNode && keyNode.content)
                        policyKey = keyNode.content.toString();
                }
            }
        }
        catch (e) { }
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
                                                ] }
                                        ] }
                                ] }
                        ] }
                ]
            };
        }
        else {
            responseAst = {
                tag: "Provision", page: 14, children: [
                    { tag: "Status", page: 14, content: "1" },
                    { tag: "Policies", page: 14, children: [
                            { tag: "Policy", page: 14, children: [
                                    { tag: "PolicyType", page: 14, content: "MS-EAS-Provisioning-WBXML" },
                                    { tag: "Status", page: 14, content: "1" },
                                    { tag: "PolicyKey", page: 14, content: policyKey }
                                ] }
                        ] }
                ]
            };
        }
        const writer = new writer_1.WbxmlWriter();
        writer.writeNode(responseAst);
        res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
        return res.status(200).send(writer.getBuffer());
    }
    if (cmd === 'GetItemEstimate') {
        const creds = getAuthCredentials();
        if (!creds)
            return res.status(401).send();
        try {
            let collectionNodes = [];
            if (req.body && req.body.length > 0) {
                const parser = new parser_1.WbxmlParser(req.body);
                const decoded = parser.parse();
                collectionNodes = childNode(decoded, 'Collections')?.children?.filter((node) => node.tag === 'Collection') || [];
                if (collectionNodes.length === 0) {
                    collectionNodes = decoded?.children?.filter((node) => node.tag === 'Collection') || [];
                }
            }
            const responses = [];
            let imap = null;
            try {
                for (const collectionNode of collectionNodes) {
                    const collectionId = childText(collectionNode, 'CollectionId');
                    const requestedClass = childText(collectionNode, 'Class');
                    let estimate = 0;
                    let status = '1';
                    try {
                        if (isContactsCollection(collectionId)) {
                            estimate = (await (0, contact_utils_1.listContacts)(creds.user)).length;
                        }
                        else if (collectionId === 'mock-calendar' || collectionId.startsWith('cal-')) {
                            if (collectionId.startsWith('cal-')) {
                                const calendarId = collectionId.slice(4);
                                const [rows] = await db_1.pool.query('SELECT COUNT(*) AS event_count FROM events e JOIN calendars c ON c.id = e.calendar_id WHERE c.id = ? AND c.user_id = ?', [calendarId, creds.user]);
                                estimate = Number(rows[0]?.event_count || 0);
                            }
                            else {
                                const calendar = await (0, calendar_utils_1.ensureDefaultCalendar)(creds.user);
                                const [rows] = await db_1.pool.query('SELECT COUNT(*) AS event_count FROM events WHERE calendar_id = ?', [calendar.id]);
                                estimate = Number(rows[0]?.event_count || 0);
                            }
                        }
                        else if (collectionId && !collectionId.startsWith('mail%')) {
                            if (!imap) {
                                imap = new imap_1.ImapService(creds.user, creds.pass);
                                await imap.connect();
                            }
                            const folderPath = Buffer.from(collectionId, 'base64').toString('utf8');
                            const mailbox = await imap.client.mailboxOpen(folderPath);
                            estimate = mailbox.exists || 0;
                            await imap.client.mailboxClose();
                        }
                        else {
                            status = '8';
                        }
                    }
                    catch (estimateErr) {
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
                                ] }
                        ]
                    });
                }
            }
            finally {
                if (imap) {
                    try {
                        await imap.logout();
                    }
                    catch (e) { }
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
                                ] }
                        ] }
                ]
            };
            const writer = new writer_1.WbxmlWriter();
            writer.writeNode(responseAst);
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(writer.getBuffer());
        }
        catch (e) {
            console.error('Failed to process GetItemEstimate:', e);
            return res.status(500).send();
        }
    }
    if (cmd === 'Sync') {
        let collectionId = "";
        let syncKey = "1";
        let syncCollectionNode = null;
        if (req.body && req.body.length > 0) {
            try {
                const parser = new parser_1.WbxmlParser(req.body);
                const decoded = parser.parse();
                // extract collectionId from request
                const collNode = decoded?.children?.find((c) => c.tag === 'Collections')
                    ?.children?.find((c) => c.tag === 'Collection');
                if (collNode) {
                    syncCollectionNode = collNode;
                    const idNode = collNode.children?.find((c) => c.tag === 'CollectionId');
                    if (idNode && idNode.content)
                        collectionId = idNode.content.toString();
                    const keyNode = collNode.children?.find((c) => c.tag === 'SyncKey');
                    if (keyNode && keyNode.content)
                        syncKey = keyNode.content.toString();
                }
            }
            catch (e) { }
        }
        if (isContactsCollection(collectionId)) {
            const creds = getAuthCredentials();
            if (!creds)
                return res.status(401).send();
            try {
                const responses = [];
                const commandsNode = childNode(syncCollectionNode, 'Commands');
                for (const commandNode of commandsNode?.children || []) {
                    const applicationData = childNode(commandNode, 'ApplicationData');
                    if (commandNode.tag === 'Add') {
                        const clientId = childText(commandNode, 'ClientId') || `client-${Date.now()}`;
                        const davUid = (0, contact_utils_1.normalizeDavUid)(`eas-${clientId}`);
                        const vcard = activeSyncApplicationDataToVCard(davUid, applicationData);
                        await (0, contact_utils_1.saveContactFromVCard)(creds.user, davUid, vcard);
                        responses.push({
                            tag: 'Add',
                            page: 0,
                            children: [
                                { tag: 'ClientId', page: 0, content: clientId },
                                { tag: 'ServerId', page: 0, content: davUid },
                                { tag: 'Status', page: 0, content: '1' }
                            ]
                        });
                    }
                    else if (commandNode.tag === 'Change') {
                        const serverId = childText(commandNode, 'ServerId');
                        if (serverId && applicationData) {
                            const davUid = (0, contact_utils_1.normalizeDavUid)(serverId);
                            const vcard = activeSyncApplicationDataToVCard(davUid, applicationData);
                            await (0, contact_utils_1.saveContactFromVCard)(creds.user, davUid, vcard);
                            responses.push({
                                tag: 'Change',
                                page: 0,
                                children: [
                                    { tag: 'ServerId', page: 0, content: davUid },
                                    { tag: 'Status', page: 0, content: '1' }
                                ]
                            });
                        }
                        else {
                            responses.push({
                                tag: 'Change',
                                page: 0,
                                children: [
                                    ...(serverId ? [{ tag: 'ServerId', page: 0, content: serverId }] : []),
                                    { tag: 'Status', page: 0, content: '8' }
                                ]
                            });
                        }
                    }
                    else if (commandNode.tag === 'Delete') {
                        const serverId = childText(commandNode, 'ServerId');
                        if (serverId) {
                            await (0, contact_utils_1.deleteContactByDavUid)(creds.user, (0, contact_utils_1.normalizeDavUid)(serverId));
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
                const nextSyncKey = `contacts-${await (0, contact_utils_1.addressBookSyncToken)(creds.user)}`;
                const isInitialSync = syncKey === '0' || syncKey === '1';
                const shouldSendContacts = isInitialSync || syncKey !== nextSyncKey;
                const addNodes = [];
                if (shouldSendContacts) {
                    let contacts;
                    if (isInitialSync) {
                        contacts = await (0, contact_utils_1.listContacts)(creds.user);
                    }
                    else {
                        // Delta: only send contacts updated since last sync
                        const lastSyncToken = parseInt(syncKey.replace(/[^0-9]/g, '').slice(-8), 10) || 0;
                        const [deltaContacts] = await db_1.pool.query('SELECT * FROM contacts WHERE username = ? AND sync_token > ? ORDER BY id ASC', [creds.user, lastSyncToken]);
                        contacts = deltaContacts;
                    }
                    for (const contact of contacts) {
                        addNodes.push({
                            tag: 'Add',
                            page: 0,
                            children: [
                                { tag: 'ServerId', page: 0, content: (0, contact_utils_1.getContactDavUid)(contact) },
                                { tag: 'ApplicationData', page: 0, children: contactToActiveSyncApplicationData(contact) }
                            ]
                        });
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
                                        ...(addNodes.length > 0 ? [{ tag: 'Commands', page: 0, children: addNodes }] : [])
                                    ] }
                            ] }
                    ]
                };
                const writer = new writer_1.WbxmlWriter();
                writer.writeNode(responseAst);
                console.log(`[SYNC] Sending Contacts Sync Response for ${collectionId} with ${addNodes.length} contacts. SyncKey going to ${nextSyncKey}`);
                res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                return res.status(200).send(writer.getBuffer());
            }
            catch (e) {
                console.error('Failed to sync contacts:', e);
                return res.status(500).send();
            }
        }
        if (collectionId === 'mock-calendar' || collectionId.startsWith('cal-')) {
            const creds = getAuthCredentials();
            if (!creds)
                return res.status(401).send();
            try {
                const responseCollectionId = collectionId;
                let calendar;
                if (collectionId.startsWith('cal-')) {
                    const calendarId = collectionId.slice(4);
                    const visibleCals = await (0, calendar_utils_1.getVisibleCalendars)(creds.user);
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
                                            ] }
                                    ] }
                            ]
                        };
                        const writer = new writer_1.WbxmlWriter();
                        writer.writeNode(notFoundAst);
                        res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                        return res.status(200).send(writer.getBuffer());
                    }
                    calendar = rows[0];
                }
                else {
                    calendar = await (0, calendar_utils_1.ensureDefaultCalendar)(creds.user);
                }
                const responses = [];
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
                    }
                    else if (commandNode.tag === 'Change') {
                        const serverId = childText(commandNode, 'ServerId');
                        if (serverId && applicationData) {
                            const uid = normalizeCalendarEventUid(serverId);
                            const [existingRows] = await db_1.pool.query('SELECT ical_data, updated_at FROM events WHERE calendar_id = ? AND uid = ? LIMIT 1', [calendar.id, uid]);
                            if (existingRows.length === 0) {
                                responses.push({ tag: 'Change', page: 0, children: [{ tag: 'ServerId', page: 0, content: uid }, { tag: 'Status', page: 0, content: '8' }] });
                            }
                            else {
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
                        }
                        else {
                            responses.push({
                                tag: 'Change',
                                page: 0,
                                children: [
                                    ...(serverId ? [{ tag: 'ServerId', page: 0, content: serverId }] : []),
                                    { tag: 'Status', page: 0, content: '8' }
                                ]
                            });
                        }
                    }
                    else if (commandNode.tag === 'Delete') {
                        const serverId = childText(commandNode, 'ServerId');
                        if (serverId) {
                            const uid = normalizeCalendarEventUid(serverId);
                            await db_1.pool.query('INSERT INTO calendar_tombstones (calendar_id, uid) VALUES (?, ?)', [calendar.id, uid]);
                            await db_1.pool.query('DELETE FROM events WHERE calendar_id = ? AND uid = ?', [calendar.id, uid]);
                            await db_1.pool.query('UPDATE calendars SET sync_token = sync_token + 1 WHERE id = ?', [calendar.id]);
                            calendarChanged = true;
                            responses.push({
                                tag: 'Delete',
                                page: 0,
                                children: [
                                    { tag: 'ServerId', page: 0, content: uid },
                                    { tag: 'Status', page: 0, content: '1' }
                                ]
                            });
                        }
                        else {
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
                    const visibleCals = await (0, calendar_utils_1.getVisibleCalendars)(creds.user);
                    const updatedCalendars = visibleCals.filter(c => c.id === calendar.id);
                    if (updatedCalendars.length > 0) {
                        calendar = updatedCalendars[0];
                    }
                }
                const nextSyncKey = `cal-${calendar.id}-${calendar.sync_token || 1}`;
                const shouldSendEvents = syncKey === "0" || syncKey === "1" || syncKey !== nextSyncKey;
                const addNodes = [];
                if (shouldSendEvents) {
                    const [events] = await db_1.pool.query('SELECT uid, ical_data FROM events WHERE calendar_id = ? ORDER BY updated_at ASC, id ASC', [calendar.id]);
                    for (const eventRow of events) {
                        const parsed = (0, calendar_utils_1.parseIcalEvent)(eventRow.uid, eventRow.ical_data || '');
                        const applicationData = [
                            { tag: "Subject", page: 4, content: parsed.title },
                            { tag: "UID", page: 4, content: parsed.uid },
                            { tag: "StartTime", page: 4, content: (0, calendar_utils_1.formatActiveSyncDate)(parsed.start) },
                            { tag: "EndTime", page: 4, content: (0, calendar_utils_1.formatActiveSyncDate)(parsed.end) },
                            { tag: "DtStamp", page: 4, content: (0, calendar_utils_1.formatActiveSyncDate)(parsed.dtstamp) },
                            { tag: "AllDayEvent", page: 4, content: parsed.isAllDay ? "1" : "0" },
                            { tag: "BusyStatus", page: 4, content: parsed.busyStatus === 'free' ? "0" : "2" },
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
                // Query tombstones and emit Delete commands for deleted events
                if (shouldSendEvents) {
                    const [tombstones] = await db_1.pool.query('SELECT uid FROM calendar_tombstones WHERE calendar_id = ? AND deleted_at > DATE_SUB(NOW(), INTERVAL 30 DAY)', [calendar.id]);
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
                    db_1.pool.query('DELETE FROM calendar_tombstones WHERE deleted_at < DATE_SUB(NOW(), INTERVAL 30 DAY)').catch(() => { });
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
                                    ] }
                            ] }
                    ]
                };
                const writer = new writer_1.WbxmlWriter();
                writer.writeNode(responseAst);
                console.log(`[SYNC] Sending Calendar Sync Response for ${responseCollectionId} with ${addNodes.length} items. SyncKey going to ${nextSyncKey}`);
                res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                return res.status(200).send(writer.getBuffer());
            }
            catch (e) {
                console.error("Failed to sync calendar:", e);
                return res.status(500).send();
            }
        }
        if (collectionId === 'mock-notes') {
            const creds = getAuthCredentials();
            if (!creds)
                return res.status(401).send();
            console.log(`[SYNC] Notes sync for ${creds.user}, SyncKey=${syncKey}`);
            let responses = [];
            try {
                const commandsNode = childNode(syncCollectionNode, 'Commands');
                if (commandsNode) {
                    for (const cmd of commandsNode.children || []) {
                        if (cmd.tag === 'Add') {
                            const clientId = childText(cmd, 'ClientId');
                            const appData = childNode(cmd, 'ApplicationData');
                            const noteData = (0, eas_notes_1.activeSyncToDbNote)(appData);
                            const saved = await (0, notes_utils_1.saveNote)({ ...noteData, owner: creds.user });
                            responses.push({
                                tag: 'Add', page: 0, children: [
                                    { tag: 'ClientId', page: 0, content: clientId },
                                    { tag: 'ServerId', page: 0, content: saved.id },
                                    { tag: 'Status', page: 0, content: '1' }
                                ]
                            });
                        }
                        else if (cmd.tag === 'Change') {
                            const serverId = childText(cmd, 'ServerId');
                            const appData = childNode(cmd, 'ApplicationData');
                            const noteData = (0, eas_notes_1.activeSyncToDbNote)(appData);
                            await (0, notes_utils_1.saveNote)({ ...noteData, id: serverId, owner: creds.user });
                            responses.push({
                                tag: 'Change', page: 0, children: [
                                    { tag: 'ServerId', page: 0, content: serverId },
                                    { tag: 'Status', page: 0, content: '1' }
                                ]
                            });
                        }
                        else if (cmd.tag === 'Delete') {
                            const serverId = childText(cmd, 'ServerId');
                            if (serverId) {
                                await (0, notes_utils_1.deleteNote)(serverId, creds.user);
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
                        (0, notes_imap_sync_1.syncNotesWithImap)(creds.user, creds.pass).catch(e => console.error(e));
                    }
                }
                let addNodes = [];
                let dbToken = await (0, notes_utils_1.getNotesSyncToken)(creds.user);
                let nextSyncKey = `notes-${dbToken}`;
                if (syncKey === '0') {
                    nextSyncKey = "1";
                }
                else if (syncKey === '1') {
                    const allNotes = await (0, notes_utils_1.listNotes)(creds.user);
                    for (const note of allNotes) {
                        addNodes.push({
                            tag: 'Add', page: 0, children: [
                                { tag: 'ServerId', page: 0, content: note.id },
                                (0, eas_notes_1.dbNoteToActiveSync)(note)
                            ]
                        });
                    }
                }
                else {
                    const currentSyncKey = parseInt(syncKey.replace('notes-', '')) || 1;
                    if (currentSyncKey !== dbToken) {
                        const allNotes = await (0, notes_utils_1.listNotes)(creds.user, true);
                        const changedNotes = allNotes.filter(n => n.sync_token > currentSyncKey);
                        for (const note of changedNotes) {
                            if (note.is_deleted) {
                                addNodes.push({
                                    tag: 'Delete',
                                    page: 0,
                                    children: [
                                        { tag: 'ServerId', page: 0, content: note.id }
                                    ]
                                });
                            }
                            else {
                                addNodes.push({
                                    tag: 'Change',
                                    page: 0,
                                    children: [
                                        { tag: 'ServerId', page: 0, content: note.id },
                                        (0, eas_notes_1.dbNoteToActiveSync)(note)
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
                                    ] }
                            ] }
                    ]
                };
                const writer = new writer_1.WbxmlWriter();
                writer.writeNode(responseAst);
                res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                return res.status(200).send(writer.getBuffer());
            }
            catch (e) {
                console.error("Notes sync error:", e);
                return res.status(500).send();
            }
        }
        if (collectionId.startsWith('mock-')) {
            console.log(`Mock Sync for ${collectionId}`);
            let cls = "Email";
            if (collectionId === "mock-contacts")
                cls = "Contacts";
            if (collectionId === "mock-calendar")
                cls = "Calendar";
            if (collectionId === "mock-tasks")
                cls = "Tasks";
            if (collectionId === "mock-notes")
                cls = "Notes";
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
            const writer = new writer_1.WbxmlWriter();
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
            const writer = new writer_1.WbxmlWriter();
            writer.writeNode(responseAst);
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(writer.getBuffer());
        }
        // Real IMAP Folder
        const folderPath = Buffer.from(collectionId, 'base64').toString('utf8');
        console.log(`Client Syncing IMAP Folder: ${folderPath} with SyncKey: ${syncKey}`);
        const creds = getAuthCredentials();
        if (!creds)
            return res.status(401).send();
        let addNodes = [];
        let fetchResponses = [];
        let changeReadFlags = [];
        let changeResponses = [];
        let nextSyncKey = ((parseInt(syncKey) || 0) + 1).toString();
        let moreAvailable = false;
        try {
            let fetchServerIds = [];
            if (req.body && req.body.length > 0) {
                try {
                    const parser = new parser_1.WbxmlParser(req.body);
                    const decoded = parser.parse();
                    const collNode = decoded?.children?.find((c) => c.tag === 'Collections')
                        ?.children?.find((c) => c.tag === 'Collection');
                    if (collNode) {
                        const commandsNode = collNode.children?.find((c) => c.tag === 'Commands');
                        if (commandsNode) {
                            for (let cmd of commandsNode.children || []) {
                                if (cmd.tag === 'Fetch') {
                                    const idNode = cmd.children?.find((c) => c.tag === 'ServerId');
                                    if (idNode && idNode.content)
                                        fetchServerIds.push(idNode.content.toString());
                                }
                                else if (cmd.tag === 'Change') {
                                    const idNode = cmd.children?.find((c) => c.tag === 'ServerId');
                                    const appData = cmd.children?.find((c) => c.tag === 'ApplicationData');
                                    if (idNode && idNode.content && appData) {
                                        const readNode = appData.children?.find((c) => c.tag === 'Read');
                                        if (readNode && readNode.content !== undefined) {
                                            changeReadFlags.push({
                                                serverId: idNode.content.toString(),
                                                isRead: readNode.content.toString() === '1'
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                catch (e) { }
            }
            const imap = new imap_1.ImapService(creds.user, creds.pass);
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
                                        ] }
                                ] }
                        ]
                    });
                }
                else {
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
            let sinceModseq = "0";
            if (syncKey === "1") {
                // Initial sync, fetch newest 25
                result = await imap.getMessages(folderPath);
            }
            else {
                const parts = syncKey.split('-');
                if (parts.length >= 2) {
                    lowestUid = parseInt(parts[0]);
                    currentUidNext = parseInt(parts[1]);
                    if (parts.length >= 3) {
                        sinceModseq = parts[2];
                    }
                }
                else {
                    currentUidNext = parseInt(syncKey);
                }
                result = await imap.getMessages(folderPath, currentUidNext);
                // If there are no new messages, but the client explicitly sent a Sync request, 
                // they might be paging backwards.
                if (result.messages.length === 0 && lowestUid > 1) {
                    result = await imap.getMessages(folderPath, undefined, lowestUid);
                }
            }
            // Get flag changes
            if (sinceModseq !== "0" && syncKey !== "1") {
                const changedResult = await imap.getChangedFlags(folderPath, sinceModseq);
                result.highestModseq = changedResult.highestModseq;
                for (let c of changedResult.changed) {
                    if (!result.messages.some((m) => m.uid === c.uid)) {
                        changeResponses.push({
                            tag: "Change",
                            page: 0,
                            children: [
                                { tag: "ServerId", page: 0, content: `${collectionId}-${c.uid}` },
                                { tag: "ApplicationData", page: 0, children: [
                                        { tag: "Read", page: 17, content: c.flags.includes('\\Seen') ? "1" : "0" }
                                    ] }
                            ]
                        });
                    }
                }
            }
            // Process flag changes from client
            for (let change of changeReadFlags) {
                const parts = change.serverId.split('-');
                const uidPart = parts.length > 1 ? parts[1] : change.serverId;
                try {
                    await imap.messageAction(folderPath, [parseInt(uidPart)], change.isRead ? 'read' : 'unread');
                    changeResponses.push({
                        tag: "Change",
                        page: 0,
                        children: [
                            { tag: "ServerId", page: 0, content: change.serverId },
                            { tag: "Status", page: 0, content: "1" }
                        ]
                    });
                }
                catch (e) {
                    changeResponses.push({
                        tag: "Change",
                        page: 0,
                        children: [
                            { tag: "ServerId", page: 0, content: change.serverId },
                            { tag: "Status", page: 0, content: "8" }
                        ]
                    });
                }
            }
            await imap.logout();
            const { messages, uidNext, highestModseq, lowestUid: newLowestUid, moreAvailable: isMore } = result;
            if (isMore)
                moreAvailable = true;
            // Set nextSyncKey to maintain pagination bounds
            if (uidNext) {
                const effectiveLowestUid = newLowestUid > 0 ? newLowestUid : (lowestUid > 0 ? lowestUid : uidNext);
                nextSyncKey = `${effectiveLowestUid}-${uidNext}-${highestModseq || "0"}`;
            }
            console.log(`[SYNC] Fetched ${messages.length} messages, ${changeResponses.length} changes for ${folderPath} (SyncKey: ${nextSyncKey})`);
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
                                { tag: "To", page: 2, content: parsed.to?.text || "" },
                                { tag: "From", page: 2, content: parsed.from?.text || "" },
                                { tag: "Subject", page: 2, content: parsed.subject || "" },
                                { tag: "DateReceived", page: 2, content: (parsed.date || new Date()).toISOString() },
                                { tag: "DisplayTo", page: 2, content: parsed.to?.text || "" },
                                { tag: "Read", page: 2, content: isRead },
                                { tag: "MessageClass", page: 2, content: "IPM.Note" },
                                { tag: "Body", page: 17, children: [
                                        { tag: "Type", page: 17, content: "1" },
                                        { tag: "Data", page: 17, content: truncatedText },
                                        { tag: "EstimatedDataSize", page: 17, content: textBody.length.toString() },
                                        ...(isTruncated === "1" ? [{ tag: "Truncated", page: 17, content: "1" }] : [])
                                    ] }
                            ] }
                    ]
                });
            }
        }
        catch (e) {
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
                                ...((fetchResponses.length > 0 || changeResponses.length > 0) ? [{ tag: "Responses", page: 0, children: [...fetchResponses, ...changeResponses] }] : []),
                                ...(addNodes.length > 0 ? [{ tag: "Commands", page: 0, children: addNodes }] : [])
                            ]
                        }
                    ]
                }
            ]
        };
        const writer = new writer_1.WbxmlWriter();
        writer.writeNode(responseAst);
        console.log(`[SYNC] Sending Sync Response for ${folderPath} with ${addNodes.length} items. SyncKey going to ${nextSyncKey}. MoreAvailable: ${moreAvailable}`);
        res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
        return res.status(200).send(writer.getBuffer());
    }
    if (cmd === 'Ping') {
        let heartbeat = 60; // default 60s
        if (req.body && req.body.length > 0) {
            try {
                const parser = new parser_1.WbxmlParser(req.body);
                const decoded = parser.parse();
                const hbNode = decoded?.children?.find((c) => c.tag === 'HeartbeatInterval');
                if (hbNode && hbNode.content) {
                    heartbeat = parseInt(hbNode.content.toString()) || 60;
                }
            }
            catch (e) { }
        }
        // Cap heartbeat to prevent reverse proxy timeouts (nginx default is usually 60s)
        heartbeat = Math.min(heartbeat, 55);
        console.log(`Holding Ping for ${heartbeat} seconds...`);
        req.on('close', () => {
            // If client disconnects, we just log and do nothing
            console.log("Client disconnected Ping early.");
        });
        setTimeout(() => {
            if (res.writableEnded)
                return; // Ignore if closed
            const responseAst = {
                tag: "Ping",
                page: 13,
                children: [
                    { tag: "Status", page: 13, content: "1" }
                ]
            };
            const writer = new writer_1.WbxmlWriter();
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
        const writer = new writer_1.WbxmlWriter();
        writer.writeNode(responseAst);
        console.log("Sending mocked Settings response!");
        res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
        return res.status(200).send(writer.getBuffer());
    }
    if (cmd === 'SendMail' || cmd === 'SmartForward' || cmd === 'SmartReply') {
        const creds = getAuthCredentials();
        if (!creds)
            return res.status(401).send();
        let mimeContent = "";
        let saveInSent = false;
        if (req.body && req.body.length > 0) {
            try {
                const parser = new parser_1.WbxmlParser(req.body);
                const decoded = parser.parse();
                // Find Mime and SaveInSentItems recursively
                const findNode = (node, tag) => {
                    if (!node)
                        return null;
                    if (node.tag === tag)
                        return node;
                    if (node.children) {
                        for (let child of node.children) {
                            const res = findNode(child, tag);
                            if (res)
                                return res;
                        }
                    }
                    return null;
                };
                const mimeNode = findNode(decoded, 'Mime');
                if (mimeNode && mimeNode.content) {
                    mimeContent = mimeNode.content.toString();
                }
                const saveNode = findNode(decoded, 'SaveInSentItems');
                if (saveNode)
                    saveInSent = true;
            }
            catch (e) {
                console.error(`Failed to parse ${cmd} WBXML:`, e);
            }
        }
        if (mimeContent) {
            try {
                const transporter = nodemailer_1.default.createTransport({
                    host: config_1.smtpConfig.host,
                    port: config_1.smtpConfig.port,
                    secure: config_1.smtpConfig.secure,
                    tls: { rejectUnauthorized: config_1.smtpConfig.rejectUnauthorized },
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
                    const imap = new imap_1.ImapService(creds.user, creds.pass);
                    await imap.connect();
                    // Identify sent folder
                    const folders = await imap.getFolders();
                    let sentFolderObj = folders.find((f) => f.path.toUpperCase() === 'SENT' || f.path.toUpperCase() === 'SENT MESSAGES');
                    if (sentFolderObj) {
                        await imap.appendMessage(sentFolderObj.path, mimeContent, ['\\Seen']);
                        console.log(`[EAS] Saved to ${sentFolderObj.path}.`);
                    }
                    await imap.logout();
                }
                return res.status(200).send();
            }
            catch (err) {
                console.error(`[EAS] Error sending email:`, err);
                return res.status(500).send();
            }
        }
        else {
            console.warn(`[EAS] ${cmd} received without Mime content!`);
            return res.status(500).send();
        }
    }
    if (cmd === 'MoveItems') {
        const creds = getAuthCredentials();
        if (!creds)
            return res.status(401).send();
        if (req.body && req.body.length > 0) {
            try {
                const parser = new parser_1.WbxmlParser(req.body);
                const decoded = parser.parse();
                const responseNodes = [];
                const movesNode = decoded?.children?.filter((c) => c.tag === 'Move') || [];
                const imap = new imap_1.ImapService(creds.user, creds.pass);
                await imap.connect();
                for (let moveNode of movesNode) {
                    let srcMsgId = "";
                    let srcFldId = "";
                    let dstFldId = "";
                    for (let child of moveNode.children || []) {
                        if (child.tag === 'SrcMsgId')
                            srcMsgId = child.content?.toString() || "";
                        if (child.tag === 'SrcFldId')
                            srcFldId = child.content?.toString() || "";
                        if (child.tag === 'DstFldId')
                            dstFldId = child.content?.toString() || "";
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
                        }
                        catch (e) {
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
                const writer = new writer_1.WbxmlWriter();
                writer.writeNode(responseAst);
                res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                return res.status(200).send(writer.getBuffer());
            }
            catch (err) {
                console.error("Failed to process MoveItems:", err);
                return res.status(500).send();
            }
        }
        return res.status(500).send();
    }
    if (cmd === 'ItemOperations') {
        const creds = getAuthCredentials();
        if (!creds)
            return res.status(401).send();
        if (req.body && req.body.length > 0) {
            try {
                const parser = new parser_1.WbxmlParser(req.body);
                const decoded = parser.parse();
                const responses = [];
                const fetches = decoded?.children?.filter((c) => c.tag === 'Fetch') || [];
                const imap = new imap_1.ImapService(creds.user, creds.pass);
                await imap.connect();
                for (let fetchNode of fetches) {
                    let collectionId = "";
                    let serverId = "";
                    for (let child of fetchNode.children || []) {
                        if (child.tag === 'CollectionId')
                            collectionId = child.content?.toString() || "";
                        if (child.tag === 'ServerId')
                            serverId = child.content?.toString() || "";
                    }
                    if (collectionId && serverId) {
                        try {
                            const folderPath = Buffer.from(collectionId, 'base64').toString('utf8');
                            const parts = serverId.split('-');
                            const uid = parseInt(parts[parts.length - 1]);
                            console.log(`[EAS] ItemOperations Fetching full message ${uid} in ${folderPath}`);
                            const msg = await imap.getMessageByUid(folderPath, uid);
                            if (msg && msg.source) {
                                const parsed = await (0, mailparser_1.simpleParser)(msg.source);
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
                                                { tag: "To", page: 2, content: parsed.to?.text || "" },
                                                { tag: "From", page: 2, content: parsed.from?.text || "" },
                                                { tag: "Subject", page: 2, content: parsed.subject || "" },
                                                { tag: "DateReceived", page: 2, content: (parsed.date || new Date()).toISOString() },
                                                { tag: "DisplayTo", page: 2, content: parsed.to?.text || "" },
                                                { tag: "Read", page: 2, content: isRead },
                                                { tag: "MessageClass", page: 2, content: "IPM.Note" },
                                                { tag: "Body", page: 17, children: [
                                                        { tag: "Type", page: 17, content: bodyType },
                                                        { tag: "Data", page: 17, content: bodyData },
                                                        { tag: "EstimatedDataSize", page: 17, content: bodyData.length.toString() }
                                                    ] }
                                            ] }
                                    ]
                                });
                            }
                            else {
                                responses.push({
                                    tag: "Fetch", page: 20, children: [
                                        { tag: "Status", page: 20, content: "2" }, // Not found
                                        { tag: "ServerId", page: 20, content: serverId },
                                        { tag: "CollectionId", page: 20, content: collectionId }
                                    ]
                                });
                            }
                        }
                        catch (e) {
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
                const writer = new writer_1.WbxmlWriter();
                writer.writeNode(responseAst);
                res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                return res.status(200).send(writer.getBuffer());
            }
            catch (err) {
                console.error("Failed to process ItemOperations:", err);
                return res.status(500).send();
            }
        }
        return res.status(500).send();
    }
    res.status(200).send();
});
server.listen(config_1.serverConfig.port, config_1.serverConfig.host, () => {
    console.log(`OpenMailStack webmail backend listening on ${config_1.serverConfig.host}:${config_1.serverConfig.port}`);
});
//# sourceMappingURL=index.js.map