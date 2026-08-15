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
const config_1 = require("./config");
const security_1 = require("./security");
const search_index_1 = require("./search-index");
const user_settings_1 = require("./user-settings");
const admin_settings_1 = require("./admin-settings");
const branding_1 = require("./branding");
const calendar_utils_1 = require("./calendar-utils");
const birthday_calendar_1 = require("./birthday-calendar");
const application_startup_1 = require("./application-startup");
const contact_utils_1 = require("./contact-utils");
const notes_utils_1 = require("./notes-utils");
const eas_contacts_1 = require("./eas-contacts");
const eas_calendar_1 = require("./eas-calendar");
const eas_calendar_sync_projection_1 = require("./eas-calendar-sync-projection");
const eas_calendar_persistence_1 = require("./eas-calendar-persistence");
const eas_sync_1 = require("./eas-sync");
const eas_mail_sync_1 = require("./eas-mail-sync");
const eas_pim_sync_1 = require("./eas-pim-sync");
const eas_send_1 = require("./eas-send");
const eas_protocol_1 = require("./eas-protocol");
const eas_item_operations_1 = require("./eas-item-operations");
const search_worker_1 = require("./search-worker");
const scheduled_send_1 = require("./scheduled-send");
const calendar_subscription_1 = require("./calendar-subscription");
const router_1 = require("./scheduler/router");
const auth_1 = require("./auth");
const account_security_1 = require("./account-security");
const mail_autoconfig_1 = require("./mail-autoconfig");
const notes_collaboration_1 = require("./notes-collaboration");
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
exports.io = new socket_io_1.Server(server, {
    cors: { origin: true, credentials: true }
});
(0, notes_collaboration_1.installNotesSignalingServer)(server, {
    enabled: config_1.serverConfig.notesCollaborationEnabled,
    secret: config_1.serverConfig.sessionSecret,
    authenticate: async (request) => {
        const session = await (0, auth_1.getSession)(request);
        return session ? { owner: session.username, sessionId: session.id } : null;
    },
});
exports.io.on('connection', (socket) => {
    socket.on('join', async () => {
        try {
            const session = await (0, auth_1.getSession)(socket.request);
            if (session?.username) {
                socket.join(session.username);
            }
        }
        catch (err) {
            if (process.env.NODE_ENV !== 'test') {
                console.error('Failed to authorize socket join:', err);
            }
        }
    });
});
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(security_1.securityHeaders);
app.use('/Microsoft-Server-ActiveSync', body_parser_1.default.raw({
    type: () => true,
    limit: `${eas_protocol_1.ACTIVE_SYNC_MAX_REQUEST_BYTES}b`,
}));
app.use(express_1.default.json({ limit: `${config_1.serverConfig.uploadLimitBytes}b` }));
app.use(body_parser_1.default.raw({
    type: (req) => {
        const contentType = String(req.headers['content-type'] || '').toLowerCase();
        return !req.url.startsWith('/api/')
            && !req.url.startsWith('/Microsoft-Server-ActiveSync')
            && !contentType.includes('multipart/form-data');
    },
    limit: `${config_1.serverConfig.uploadLimitBytes}b`
}));
const path = __importStar(require("path"));
app.use('/uploads', (req, res, next) => {
    (0, auth_1.requireSession)(req, res, () => {
        next();
    });
}, express_1.default.static(path.join(__dirname, '..', 'uploads')));
const caldav_1 = __importDefault(require("./caldav"));
const carddav_1 = __importDefault(require("./carddav"));
const apps_api_1 = require("./apps-api");
const CONTACTS_COLLECTION_ID = 'contacts';
const nodeText = (node) => node?.content ? node.content.toString() : '';
const childNode = (node, tag) => node?.children?.find((child) => child.tag === tag);
const childText = (node, tag) => nodeText(childNode(node, tag));
const firstNonEmpty = (...values) => values.map(value => value.trim()).find(Boolean) || '';
function activeSyncCollectionResponseBuffer(collectionId, syncKey, status, responses = [], commands = [], moreAvailable = false) {
    const writer = new writer_1.WbxmlWriter();
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
function activeSyncRootStatusBuffer(status) {
    const writer = new writer_1.WbxmlWriter();
    writer.writeNode({ tag: 'Sync', page: 0, children: [{ tag: 'Status', page: 0, content: status }] });
    return writer.getBuffer();
}
function activeSyncNodeEncodedBytes(node) {
    const writer = new writer_1.WbxmlWriter();
    writer.writeNode(node);
    return writer.getBuffer().length;
}
async function renderPimCommandPage(commands, baseResponseBytes, render) {
    const emitted = [];
    const nodes = [];
    let used = baseResponseBytes + 16;
    for (const command of commands) {
        const rendered = await render(command);
        const wrapped = rendered && typeof rendered === 'object' && Object.hasOwn(rendered, 'pimNode');
        const node = wrapped ? rendered.pimNode : rendered;
        const effectiveCommand = wrapped && rendered.command ? rendered.command : command;
        if (!node) {
            if (wrapped)
                rendered.accept?.();
            continue;
        }
        const bytes = activeSyncNodeEncodedBytes(node);
        if (used + bytes > eas_pim_sync_1.MAX_PIM_SYNC_RESPONSE_BYTES) {
            if (emitted.length === 0)
                throw new eas_pim_sync_1.PimSyncLimitError('A PIM item exceeds the encoded response byte budget');
            return { commands: emitted, nodes, moreAvailable: true };
        }
        if (wrapped)
            rendered.accept?.();
        emitted.push(effectiveCommand);
        nodes.push(node);
        used += bytes;
    }
    return { commands: emitted, nodes, moreAvailable: false };
}
function boundedActiveSyncText(value, maxBytes = 8192) {
    const source = Buffer.from(String(value || '').replace(/\0/g, '\uFFFD'), 'utf8');
    if (source.length <= maxBytes)
        return source.toString('utf8');
    let end = maxBytes;
    while (end > 0 && (source[end] & 0xC0) === 0x80)
        end -= 1;
    return source.subarray(0, end).toString('utf8');
}
function isContactsCollection(collectionId) {
    return collectionId === CONTACTS_COLLECTION_ID;
}
app.use('/api/auth/login', (0, security_1.rateLimit)(15 * 60 * 1000, 20));
app.use('/api', (0, cors_1.default)({ credentials: true, origin: true }), api_1.apiRouter);
app.use('/api/apps', (0, cors_1.default)({ credentials: true, origin: true }), apps_api_1.appsApiRouter);
app.use('/api', (0, cors_1.default)({ credentials: true, origin: true }), router_1.schedulerRouter);
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
const autoconfigDomain = config_1.serverConfig.defaultDomain || 'example.invalid';
const autoconfigMailHostname = config_1.serverConfig.publicBaseUrl
    ? new URL(config_1.serverConfig.publicBaseUrl).hostname
    : `mail.${autoconfigDomain}`;
app.use((0, mail_autoconfig_1.createMozillaAutoconfigRouter)({
    domain: config_1.serverConfig.defaultDomain || 'example.invalid',
    mailHostname: autoconfigMailHostname,
}));
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
    if (req.method === 'OPTIONS') {
        res.set('MS-Server-ActiveSync', '14.1');
        res.set('MS-ASProtocolVersions', '14.0,14.1');
        res.set('MS-ASProtocolCommands', eas_protocol_1.ACTIVE_SYNC_ADVERTISED_COMMANDS.join(','));
        res.set('Public', 'OPTIONS,POST');
        return res.status(200).send();
    }
    const requestBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (requestBody.length > eas_protocol_1.ACTIVE_SYNC_MAX_REQUEST_BYTES)
        return res.status(413).send();
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
    const cmd = String(req.query.Cmd || '');
    const requestCredentials = getAuthCredentials();
    if (!requestCredentials)
        return res.status(401).send();
    const authenticationImap = new imap_1.ImapService(requestCredentials.user, requestCredentials.pass, false);
    try {
        await authenticationImap.connect();
    }
    catch (error) {
        return res.status((0, eas_protocol_1.isActiveSyncAuthenticationFailure)(error) ? 401 : 503).send();
    }
    finally {
        try {
            await authenticationImap.logout();
        }
        catch { }
    }
    let decodedForStructure = null;
    let requestParseFailed = false;
    if (requestBody.length > 0) {
        try {
            decodedForStructure = new parser_1.WbxmlParser(requestBody).parse();
        }
        catch {
            requestParseFailed = true;
        }
    }
    console.log('[EAS] Request', JSON.stringify((0, eas_protocol_1.activeSyncRequestLogSummary)(req.method, cmd, requestBody.length, decodedForStructure, requestParseFailed)));
    if (requestParseFailed)
        return res.status(400).send();
    if (eas_protocol_1.ACTIVE_SYNC_UNSUPPORTED_COMMANDS.includes(cmd)) {
        return res.status(501).send();
    }
    if (cmd === 'FolderSync') {
        const folderRequest = (0, eas_protocol_1.parseActiveSyncFolderSyncRequest)(decodedForStructure);
        const folderStatus = (status) => {
            const writer = new writer_1.WbxmlWriter();
            writer.writeNode({
                tag: 'FolderSync', page: 7, children: [{ tag: 'Status', page: 7, content: status }],
            });
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(writer.getBuffer());
        };
        if (!folderRequest.ok)
            return folderStatus('10');
        const syncKey = folderRequest.syncKey;
        let responseAst;
        const creds = getAuthCredentials();
        if (!creds) {
            return res.status(401).send();
        }
        try {
            const imap = new imap_1.ImapService(creds.user, creds.pass);
            let folders;
            try {
                await imap.connect();
                folders = await imap.getFolders();
            }
            finally {
                try {
                    await imap.logout();
                }
                catch { }
            }
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
                const delimiter = typeof f.delimiter === 'string' ? f.delimiter : '';
                if (delimiter && path.includes(delimiter)) {
                    displayName = path.slice(path.lastIndexOf(delimiter) + delimiter.length);
                    parentId = (0, eas_protocol_1.activeSyncMailParentId)({ path, delimiter });
                }
                displayName = boundedActiveSyncText(displayName);
                const serverId = (0, eas_protocol_1.activeSyncMailCollectionId)(path);
                folderDescriptors.push({ serverId, displayName, type });
                return { tag: "Add", page: 7, children: [
                        { tag: "ServerId", page: 7, content: serverId },
                        { tag: "ParentId", page: 7, content: parentId },
                        { tag: "DisplayName", page: 7, content: displayName },
                        { tag: "Type", page: 7, content: type }
                    ] };
            });
            const staticFolders = (0, eas_protocol_1.staticActiveSyncServiceFolders)();
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
            const defaultCalendar = await (0, calendar_utils_1.ensureDefaultCalendar)(creds.user);
            const cals = await (0, calendar_utils_1.getVisibleCalendars)(creds.user);
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
            const currentSyncKey = (0, calendar_utils_1.getCalendarFolderSyncKey)(folderDescriptors);
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
            }
            else if (syncKey !== "0") {
                console.log('[EAS] FolderSync rejected a stale hierarchy key');
                responseAst = {
                    tag: "FolderSync",
                    page: 7,
                    children: [
                        { tag: "Status", page: 7, content: "9" }
                    ]
                };
            }
            else {
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
                            ] }
                    ]
                };
            }
        }
        catch (err) {
            console.error('[EAS] FolderSync failed');
            if ((0, eas_protocol_1.isActiveSyncAuthenticationFailure)(err))
                return res.status(401).send();
            return folderStatus('6');
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
    if (cmd === 'Sync') {
        const collectionResult = (0, eas_sync_1.singleActiveSyncCollection)(decodedForStructure);
        if (collectionResult.ok === false) {
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(activeSyncRootStatusBuffer(collectionResult.status));
        }
        const syncCollectionNode = collectionResult.collection;
        if (!(0, eas_sync_1.validateActiveSyncCollectionRequest)(syncCollectionNode).ok) {
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
            if (!creds)
                return res.status(401).send();
            const deviceId = (0, eas_mail_sync_1.validateActiveSyncDeviceId)(req.query.DeviceId);
            if (!deviceId)
                return res.status(400).send();
            const scopeHash = (0, eas_pim_sync_1.pimSyncScopeHash)(creds.user, deviceId, collectionId);
            const requestHash = (0, eas_pim_sync_1.pimSyncRequestHash)(requestBody);
            const sendContactsStatus = (status, responseSyncKey = syncKey) => {
                res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                return res.status(200).send(activeSyncCollectionResponseBuffer(collectionId, responseSyncKey, status));
            };
            const supported = syncKey === '0'
                ? (0, eas_pim_sync_1.parsePimSupportedProperties)(syncCollectionNode, 'Contacts')
                : { ok: true, value: { wasPresent: false, fields: [] } };
            if (!supported.ok)
                return sendContactsStatus('4');
            await (0, contact_utils_1.ensureContactsSchema)();
            return (0, eas_pim_sync_1.withPimSyncScopeLock)(scopeHash, async () => {
                const contactEvents = [];
                try {
                    const result = await (0, eas_pim_sync_1.withPimSqlTransaction)(creds.user, async (connection) => {
                        const contactsStatusBuffer = (status, responseSyncKey = syncKey) => activeSyncCollectionResponseBuffer(collectionId, responseSyncKey, status);
                        let state;
                        try {
                            state = await (0, eas_pim_sync_1.loadPimSyncStateOnConnection)(connection, creds.user, deviceId, collectionId);
                        }
                        catch (error) {
                            if (!(error instanceof eas_pim_sync_1.PimSyncLimitError || error instanceof eas_pim_sync_1.PimSyncStateError))
                                throw error;
                            if (syncKey !== '0')
                                return { responseBuffer: contactsStatusBuffer('3'), commandCount: 0, responseCount: 0 };
                            await (0, eas_pim_sync_1.deletePimSyncStateOnConnection)(connection, creds.user, deviceId, collectionId);
                            state = null;
                        }
                        const replayResponse = (0, eas_pim_sync_1.pimSyncReplayResponse)(state, syncKey, requestHash);
                        if (replayResponse) {
                            return { responseBuffer: replayResponse, commandCount: 0, responseCount: 0 };
                        }
                        if ((0, eas_pim_sync_1.pimSyncStateDisposition)(state, syncKey) === 'stale') {
                            return { responseBuffer: contactsStatusBuffer('3'), commandCount: 0, responseCount: 0 };
                        }
                        const commandContainers = syncCollectionNode.children?.filter((node) => node.tag === 'Commands') || [];
                        const commandsNode = commandContainers[0];
                        const requestCommands = commandsNode?.children || [];
                        const getChanges = (0, eas_sync_1.parseActiveSyncGetChanges)(syncKey, childNode(syncCollectionNode, 'GetChanges'));
                        let windowSize;
                        try {
                            windowSize = (0, eas_mail_sync_1.resolveActiveSyncWindowSize)(syncKey, childNode(syncCollectionNode, 'WindowSize') ? childText(syncCollectionNode, 'WindowSize') : undefined, state?.windowSize);
                        }
                        catch {
                            return { responseBuffer: contactsStatusBuffer('4'), commandCount: 0, responseCount: 0 };
                        }
                        if (!getChanges.ok || commandContainers.length > 1
                            || (commandsNode && !Array.isArray(commandsNode.children))
                            || !(0, eas_pim_sync_1.validatePimClientCommands)(requestCommands, 'Contacts').ok) {
                            return { responseBuffer: contactsStatusBuffer('4'), commandCount: 0, responseCount: 0 };
                        }
                        if (syncKey === '0') {
                            if (commandsNode)
                                return { responseBuffer: contactsStatusBuffer('4'), commandCount: 0, responseCount: 0 };
                            const nextSyncKey = (0, eas_pim_sync_1.createPimSyncKey)();
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
                            };
                            await (0, eas_pim_sync_1.savePimSyncStateOnConnection)(connection, state);
                            return { responseBuffer, commandCount: 0, responseCount: 0 };
                        }
                        const contactsBefore = await (0, eas_pim_sync_1.loadBoundedContactPimSnapshot)(connection, creds.user, collectionId);
                        const snapshotBefore = contactsBefore.items;
                        const prospectiveKnown = Object.fromEntries(snapshotBefore.map(item => [item.serverId, item.fingerprint]));
                        for (const command of requestCommands.filter((node) => node.tag === 'Add')) {
                            const clientId = childText(command, 'ClientId');
                            if (clientId && childNode(command, 'ApplicationData')) {
                                const sourceId = (0, eas_pim_sync_1.deterministicPimAddServerId)(scopeHash, syncKey, clientId);
                                prospectiveKnown[(0, eas_pim_sync_1.pimWireServerId)(collectionId, sourceId)] = 'pending';
                            }
                        }
                        (0, eas_pim_sync_1.assertPimKnownItemsBound)(prospectiveKnown);
                        const responses = [];
                        const acceptedUpsertIds = new Set();
                        const acceptedDeletes = [];
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
                                const davUid = (0, eas_pim_sync_1.deterministicPimAddServerId)(scopeHash, syncKey, clientId);
                                const serverId = (0, eas_pim_sync_1.pimWireServerId)(collectionId, davUid);
                                let vcard;
                                try {
                                    vcard = (0, eas_contacts_1.activeSyncContactApplicationDataToVCard)(davUid, applicationData);
                                }
                                catch (error) {
                                    if (!(error instanceof eas_contacts_1.ActiveSyncContactPictureError || error instanceof eas_contacts_1.ActiveSyncContactFieldError))
                                        throw error;
                                    responses.push({ tag: 'Add', page: 0, children: [
                                            { tag: 'ClientId', page: 0, content: clientId },
                                            { tag: 'Status', page: 0, content: '6' },
                                        ] });
                                    continue;
                                }
                                const saved = await (0, contact_utils_1.saveContactFromVCardOnConnection)(connection, creds.user, davUid, vcard, null);
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
                            }
                            else if (commandNode.tag === 'Change') {
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
                                    : await (0, contact_utils_1.getEasContactByDavUidOnConnection)(connection, creds.user, davUid, existingMetadata.versionToken, existingMetadata.sourceBytes);
                                if (!existingContact)
                                    throw new eas_pim_sync_1.PimSyncStateError('PIM contact snapshot changed during mutation');
                                let vcard;
                                try {
                                    vcard = (0, eas_contacts_1.activeSyncContactApplicationDataToVCard)(davUid, applicationData, existingContact.vcard_data || '', (0, eas_pim_sync_1.pimOmittedFieldsToClear)(applicationData, 'Contacts', {
                                        wasPresent: state.supportedWasPresent,
                                        fields: state.supportedFields,
                                    }));
                                }
                                catch (error) {
                                    if (!(error instanceof eas_contacts_1.ActiveSyncContactPictureError || error instanceof eas_contacts_1.ActiveSyncContactFieldError))
                                        throw error;
                                    responses.push({ tag: 'Change', page: 0, children: [
                                            { tag: 'ServerId', page: 0, content: serverId },
                                            { tag: 'Status', page: 0, content: '6' },
                                        ] });
                                    continue;
                                }
                                const saved = await (0, contact_utils_1.saveContactFromVCardOnConnection)(connection, creds.user, davUid, vcard, existingMetadata.versionToken ?? null);
                                if (!saved) {
                                    responses.push({ tag: 'Change', page: 0, children: [
                                            { tag: 'ServerId', page: 0, content: serverId },
                                            { tag: 'Status', page: 0, content: '7' },
                                        ] });
                                    continue;
                                }
                                acceptedUpsertIds.add(serverId);
                                contactEvents.push({ davUid });
                            }
                            else {
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
                                if (!await (0, contact_utils_1.deleteContactByDavUidOnConnection)(connection, creds.user, davUid, existingMetadata.versionToken)) {
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
                        const contactsAfter = await (0, eas_pim_sync_1.loadBoundedContactPimSnapshot)(connection, creds.user, collectionId);
                        const snapshotAfter = contactsAfter.items;
                        const acceptedUpserts = Object.create(null);
                        for (const serverId of acceptedUpsertIds) {
                            const metadata = contactsAfter.byServerId.get(serverId);
                            if (!metadata)
                                throw new eas_pim_sync_1.PimSyncStateError('Accepted PIM contact is missing after mutation');
                            acceptedUpserts[serverId] = metadata.fingerprint;
                        }
                        let nextKnownItems = (0, eas_pim_sync_1.applyAcceptedPimWrites)(state.knownItems, acceptedUpserts, acceptedDeletes);
                        const knownBeforeServerCommands = nextKnownItems;
                        let serverCommands = [];
                        let moreAvailable = false;
                        if (getChanges.value) {
                            const delta = (0, eas_pim_sync_1.computePimSyncDelta)({ knownItems: nextKnownItems, snapshot: snapshotAfter, windowSize });
                            serverCommands = delta.commands;
                            moreAvailable = delta.moreAvailable;
                        }
                        const renderContactCommand = async (command) => {
                            if (command.type === 'Delete') {
                                return { tag: 'Delete', page: 0, children: [{ tag: 'ServerId', page: 0, content: command.serverId }] };
                            }
                            const metadata = contactsAfter.byServerId.get(command.serverId);
                            if (!metadata)
                                throw new eas_pim_sync_1.PimSyncStateError('PIM contact snapshot changed while rendering');
                            const contact = metadata.versionToken === undefined
                                ? null
                                : await (0, contact_utils_1.getEasContactByDavUidOnConnection)(connection, creds.user, metadata.sourceId, metadata.versionToken, metadata.sourceBytes);
                            if (!contact)
                                throw new eas_pim_sync_1.PimSyncStateError('PIM contact snapshot changed while rendering');
                            return { tag: command.type, page: 0, children: [
                                    { tag: 'ServerId', page: 0, content: command.serverId },
                                    { tag: 'ApplicationData', page: 0, children: (0, eas_contacts_1.contactToActiveSyncApplicationData)(contact, contact.vcard_data || '') },
                                ] };
                        };
                        const nextSyncKey = (0, eas_pim_sync_1.createPimSyncKey)();
                        const baseResponseBytes = activeSyncCollectionResponseBuffer(collectionId, nextSyncKey, '1', responses, [], true).length;
                        const page = await renderPimCommandPage(serverCommands, baseResponseBytes, renderContactCommand);
                        serverCommands = page.commands;
                        const commandNodes = page.nodes;
                        moreAvailable = moreAvailable || page.moreAvailable;
                        nextKnownItems = (0, eas_pim_sync_1.advancePimKnownItems)(knownBeforeServerCommands, serverCommands);
                        const responseBuffer = activeSyncCollectionResponseBuffer(collectionId, nextSyncKey, '1', responses, commandNodes, moreAvailable);
                        if (responseBuffer.length > eas_pim_sync_1.MAX_PIM_SYNC_RESPONSE_BYTES) {
                            throw new eas_pim_sync_1.PimSyncLimitError('PIM response exceeds the encoded byte budget');
                        }
                        state = {
                            ...state,
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
                        await (0, eas_pim_sync_1.savePimSyncStateOnConnection)(connection, state);
                        return { responseBuffer, commandCount: commandNodes.length, responseCount: responses.length };
                    }, {
                        acquire: connection => (0, contact_utils_1.acquireContactMutationLock)(connection, creds.user),
                        release: (connection, lease) => (0, contact_utils_1.releaseContactMutationLock)(connection, lease),
                    });
                    for (const event of contactEvents)
                        exports.io.to(creds.user).emit('contacts_updated', event);
                    console.log(`[EAS] Contacts Sync returning ${result.commandCount} commands and ${result.responseCount} responses`);
                    res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                    return res.status(200).send(result.responseBuffer);
                }
                catch (error) {
                    const expected = error instanceof eas_pim_sync_1.PimSyncLimitError || error instanceof eas_pim_sync_1.PimSyncStateError;
                    console.error(`[EAS] Contacts Sync failed (${expected ? error.name : 'unexpected'})`);
                    return sendContactsStatus('5');
                }
            });
        }
        if (collectionId.startsWith('cal-')) {
            const creds = getAuthCredentials();
            if (!creds)
                return res.status(401).send();
            const deviceId = (0, eas_mail_sync_1.validateActiveSyncDeviceId)(req.query.DeviceId);
            if (!deviceId)
                return res.status(400).send();
            await (0, calendar_utils_1.ensureCalendarSchema)();
            const scopeHash = (0, eas_pim_sync_1.pimSyncScopeHash)(creds.user, deviceId, collectionId);
            const requestHash = (0, eas_pim_sync_1.pimSyncRequestHash)(requestBody);
            const sendCalendarStatus = (status, responseSyncKey = syncKey) => {
                res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                return res.status(200).send(activeSyncCollectionResponseBuffer(collectionId, responseSyncKey, status));
            };
            const supported = syncKey === '0'
                ? (0, eas_pim_sync_1.parsePimSupportedProperties)(syncCollectionNode, 'Calendar')
                : { ok: true, value: { wasPresent: false, fields: [] } };
            if (!supported.ok)
                return sendCalendarStatus('4');
            const calendarId = Number(collectionId.slice(4));
            return (0, eas_pim_sync_1.withPimSyncScopeLock)(scopeHash, async () => {
                try {
                    const result = await (0, eas_pim_sync_1.withPimSqlTransaction)(creds.user, async (connection) => {
                        const calendarStatusBuffer = (status, responseSyncKey = syncKey) => activeSyncCollectionResponseBuffer(collectionId, responseSyncKey, status);
                        const [calendarRows] = await connection.query(`SELECT c.id, c.user_id, c.dav_slug, c.subscribed_url, cs.permission
                         FROM calendars c
                         LEFT JOIN calendar_shares cs
                           ON cs.calendar_id = c.id AND cs.shared_with_user_id = ?
                         WHERE c.id = ?
                         LIMIT 1 FOR UPDATE`, [creds.user, calendarId]);
                        const accessRole = (0, eas_calendar_1.resolveActiveSyncCalendarAccessRole)(calendarRows[0], creds.user);
                        if (!accessRole) {
                            await (0, eas_pim_sync_1.deletePimSyncStateOnConnection)(connection, creds.user, deviceId, collectionId);
                            return { responseBuffer: calendarStatusBuffer('8'), commandCount: 0, responseCount: 0, calendarChanged: false };
                        }
                        let state;
                        try {
                            state = await (0, eas_pim_sync_1.loadPimSyncStateOnConnection)(connection, creds.user, deviceId, collectionId);
                        }
                        catch (error) {
                            if (!(error instanceof eas_pim_sync_1.PimSyncLimitError || error instanceof eas_pim_sync_1.PimSyncStateError))
                                throw error;
                            if (syncKey !== '0') {
                                return { responseBuffer: calendarStatusBuffer('3'), commandCount: 0, responseCount: 0, calendarChanged: false };
                            }
                            await (0, eas_pim_sync_1.deletePimSyncStateOnConnection)(connection, creds.user, deviceId, collectionId);
                            state = null;
                        }
                        const replayResponse = (0, eas_pim_sync_1.pimSyncReplayResponse)(state, syncKey, requestHash);
                        if (replayResponse) {
                            return { responseBuffer: replayResponse, commandCount: 0, responseCount: 0, calendarChanged: false };
                        }
                        if ((0, eas_pim_sync_1.pimSyncStateDisposition)(state, syncKey) === 'stale') {
                            return { responseBuffer: calendarStatusBuffer('3'), commandCount: 0, responseCount: 0, calendarChanged: false };
                        }
                        const commandContainers = syncCollectionNode.children?.filter((node) => node.tag === 'Commands') || [];
                        const commandsNode = commandContainers[0];
                        const requestCommands = commandsNode?.children || [];
                        const getChanges = (0, eas_sync_1.parseActiveSyncGetChanges)(syncKey, childNode(syncCollectionNode, 'GetChanges'));
                        let windowSize;
                        try {
                            windowSize = (0, eas_mail_sync_1.resolveActiveSyncWindowSize)(syncKey, childNode(syncCollectionNode, 'WindowSize') ? childText(syncCollectionNode, 'WindowSize') : undefined, state?.windowSize);
                        }
                        catch {
                            return { responseBuffer: calendarStatusBuffer('4'), commandCount: 0, responseCount: 0, calendarChanged: false };
                        }
                        if (!getChanges.ok || commandContainers.length > 1
                            || (commandsNode && !Array.isArray(commandsNode.children))
                            || !(0, eas_pim_sync_1.validatePimClientCommands)(requestCommands, 'Calendar').ok) {
                            return { responseBuffer: calendarStatusBuffer('4'), commandCount: 0, responseCount: 0, calendarChanged: false };
                        }
                        if (syncKey === '0') {
                            if (commandsNode) {
                                return { responseBuffer: calendarStatusBuffer('4'), commandCount: 0, responseCount: 0, calendarChanged: false };
                            }
                            const nextSyncKey = (0, eas_pim_sync_1.createPimSyncKey)();
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
                            };
                            await (0, eas_pim_sync_1.savePimSyncStateOnConnection)(connection, state);
                            return { responseBuffer, commandCount: 0, responseCount: 0, calendarChanged: false };
                        }
                        const eventsBefore = await (0, eas_pim_sync_1.loadBoundedCalendarPimSnapshot)(connection, calendarId, collectionId);
                        const snapshotBefore = eventsBefore.items;
                        const prospectiveKnown = Object.fromEntries(snapshotBefore.map(item => [item.serverId, item.fingerprint]));
                        for (const command of requestCommands.filter((node) => node.tag === 'Add')) {
                            const clientId = childText(command, 'ClientId');
                            if (clientId && childNode(command, 'ApplicationData')) {
                                const sourceId = (0, eas_pim_sync_1.deterministicPimAddServerId)(scopeHash, syncKey, clientId);
                                prospectiveKnown[(0, eas_pim_sync_1.pimWireServerId)(collectionId, sourceId)] = 'pending';
                            }
                        }
                        (0, eas_pim_sync_1.assertPimKnownItemsBound)(prospectiveKnown);
                        const responses = [];
                        const acceptedUpsertIds = new Set();
                        const acceptedDeletes = [];
                        const eventsBeforeById = eventsBefore.byServerId;
                        const loadCalendarEvent = async (metadata) => {
                            const [rows] = await connection.query(`SELECT uid, resource_name, ical_data FROM events
                             WHERE calendar_id = ? AND BINARY resource_name = BINARY ? LIMIT 1`, [calendarId, metadata.sourceId]);
                            const event = rows[0];
                            if (!event)
                                throw new eas_pim_sync_1.PimSyncStateError('PIM calendar snapshot changed while loading an item');
                            if (Buffer.byteLength(String(event.ical_data || ''), 'utf8') > eas_pim_sync_1.MAX_PIM_ITEM_SOURCE_BYTES) {
                                throw new eas_pim_sync_1.PimSyncLimitError('PIM calendar item exceeds its source bound');
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
                            if (!(0, eas_calendar_1.canWriteActiveSyncCalendar)(accessRole)) {
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
                                const resourceName = (0, eas_pim_sync_1.deterministicPimAddServerId)(scopeHash, syncKey, clientId);
                                const serverId = (0, eas_pim_sync_1.pimWireServerId)(collectionId, resourceName);
                                let ical;
                                try {
                                    ical = (0, eas_calendar_1.activeSyncCalendarApplicationDataToIcal)(resourceName, applicationData);
                                }
                                catch (error) {
                                    if (!(error instanceof eas_calendar_1.ActiveSyncCalendarFieldError))
                                        throw error;
                                    responses.push({ tag: 'Add', page: 0, children: [
                                            { tag: 'ClientId', page: 0, content: clientId },
                                            { tag: 'Status', page: 0, content: '6' },
                                        ] });
                                    continue;
                                }
                                const saveResult = await (0, eas_calendar_persistence_1.saveActiveSyncCalendarEventInTransaction)(connection, calendarId, resourceName, ical, null);
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
                            }
                            else if (commandNode.tag === 'Change') {
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
                                let ical;
                                try {
                                    ical = (0, eas_calendar_1.activeSyncCalendarApplicationDataToIcal)(resourceName, applicationData, String(existing.ical_data || ''), (0, eas_pim_sync_1.pimOmittedFieldsToClear)(applicationData, 'Calendar', {
                                        wasPresent: state.supportedWasPresent,
                                        fields: state.supportedFields,
                                    }));
                                }
                                catch (error) {
                                    if (!(error instanceof eas_calendar_1.ActiveSyncCalendarFieldError))
                                        throw error;
                                    responses.push({ tag: 'Change', page: 0, children: [
                                            { tag: 'ServerId', page: 0, content: requestedServerId },
                                            { tag: 'Status', page: 0, content: '6' },
                                        ] });
                                    continue;
                                }
                                const saveResult = await (0, eas_calendar_persistence_1.saveActiveSyncCalendarEventInTransaction)(connection, calendarId, resourceName, ical, String(existing.ical_data || ''));
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
                            }
                            else {
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
                                if (await (0, eas_calendar_persistence_1.deleteActiveSyncCalendarEventInTransaction)(connection, calendarId, resourceName, String(existing.ical_data || '')) === 'conflict') {
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
                        const eventsAfter = await (0, eas_pim_sync_1.loadBoundedCalendarPimSnapshot)(connection, calendarId, collectionId);
                        const snapshotAfter = eventsAfter.items;
                        const acceptedUpserts = Object.create(null);
                        for (const serverId of acceptedUpsertIds) {
                            const metadata = eventsAfter.byServerId.get(serverId);
                            if (!metadata)
                                throw new eas_pim_sync_1.PimSyncStateError('Accepted PIM calendar item is missing after mutation');
                            acceptedUpserts[serverId] = metadata.fingerprint;
                        }
                        let nextKnownItems = (0, eas_pim_sync_1.applyAcceptedPimWrites)(state.knownItems, acceptedUpserts, acceptedDeletes);
                        const normalizedQuarantine = (0, eas_pim_sync_1.normalizePimQuarantineState)(nextKnownItems, snapshotAfter);
                        nextKnownItems = normalizedQuarantine.knownItems;
                        const knownBeforeServerCommands = nextKnownItems;
                        let serverCommands = [];
                        let moreAvailable = false;
                        if (getChanges.value) {
                            const delta = (0, eas_pim_sync_1.computePimSyncDelta)({
                                knownItems: nextKnownItems,
                                snapshot: normalizedQuarantine.snapshot,
                                windowSize,
                            });
                            serverCommands = delta.commands;
                            moreAvailable = delta.moreAvailable;
                        }
                        const renderedKnownItems = { ...knownBeforeServerCommands };
                        const renderCalendarCommand = async (command) => {
                            if (command.type === 'Delete') {
                                return {
                                    pimNode: { tag: 'Delete', page: 0, children: [{ tag: 'ServerId', page: 0, content: command.serverId }] },
                                    accept: () => { delete renderedKnownItems[command.serverId]; },
                                };
                            }
                            const metadata = eventsAfter.byServerId.get(command.serverId);
                            if (!metadata)
                                throw new eas_pim_sync_1.PimSyncStateError('PIM calendar snapshot changed while rendering');
                            const event = await loadCalendarEvent(metadata);
                            const projection = (0, eas_calendar_sync_projection_1.projectStoredCalendarPimCommand)(command, renderedKnownItems, String(event.uid), String(event.ical_data || ''));
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
                        const nextSyncKey = (0, eas_pim_sync_1.createPimSyncKey)();
                        const baseResponseBytes = activeSyncCollectionResponseBuffer(collectionId, nextSyncKey, '1', responses, [], true).length;
                        const page = await renderPimCommandPage(serverCommands, baseResponseBytes, renderCalendarCommand);
                        serverCommands = page.commands;
                        const commandNodes = page.nodes;
                        moreAvailable = moreAvailable || page.moreAvailable;
                        nextKnownItems = renderedKnownItems;
                        (0, eas_pim_sync_1.assertPimKnownItemsBound)(nextKnownItems);
                        const responseBuffer = activeSyncCollectionResponseBuffer(collectionId, nextSyncKey, '1', responses, commandNodes, moreAvailable);
                        if (responseBuffer.length > eas_pim_sync_1.MAX_PIM_SYNC_RESPONSE_BYTES) {
                            throw new eas_pim_sync_1.PimSyncLimitError('PIM response exceeds the encoded byte budget');
                        }
                        state = {
                            ...state,
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
                        await (0, eas_pim_sync_1.savePimSyncStateOnConnection)(connection, state);
                        return {
                            responseBuffer,
                            commandCount: commandNodes.length,
                            responseCount: responses.length,
                            calendarChanged,
                        };
                    }, {
                        acquire: connection => (0, eas_calendar_persistence_1.acquireActiveSyncCalendarLock)(connection, calendarId),
                        release: (connection, lease) => (0, eas_calendar_persistence_1.releaseActiveSyncCalendarLock)(connection, lease),
                    });
                    if (result.calendarChanged) {
                        exports.io.to(creds.user).emit('calendar_updated', { calendarId });
                    }
                    console.log(`[EAS] Calendar Sync returning ${result.commandCount} commands and ${result.responseCount} responses`);
                    res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                    return res.status(200).send(result.responseBuffer);
                }
                catch (error) {
                    const expected = error instanceof eas_pim_sync_1.PimSyncLimitError || error instanceof eas_pim_sync_1.PimSyncStateError;
                    console.error(`[EAS] Calendar Sync failed (${expected ? error.name : 'unexpected'})`);
                    return sendCalendarStatus('5');
                }
            });
        }
        const classifiedCollection = (0, eas_protocol_1.classifyActiveSyncCollection)(collectionId);
        if (classifiedCollection.kind !== 'mail') {
            const writer = new writer_1.WbxmlWriter();
            writer.writeNode((0, eas_protocol_1.unsupportedSyncCollectionResponse)(collectionId, syncKey));
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(writer.getBuffer());
        }
        // Real IMAP Folder
        const creds = getAuthCredentials();
        if (!creds)
            return res.status(401).send();
        const deviceId = (0, eas_mail_sync_1.validateActiveSyncDeviceId)(req.query.DeviceId);
        if (!deviceId)
            return res.status(400).send();
        const folderResolver = new imap_1.ImapService(creds.user, creds.pass);
        let folderPath = null;
        try {
            await folderResolver.connect();
            folderPath = (0, eas_protocol_1.resolveActiveSyncMailFolderPath)(collectionId, await folderResolver.getFolders());
        }
        catch {
            console.error('[EAS] Mail collection resolution failed');
            return res.status(500).send();
        }
        finally {
            try {
                await folderResolver.logout();
            }
            catch { }
        }
        if (!folderPath) {
            const writer = new writer_1.WbxmlWriter();
            writer.writeNode((0, eas_protocol_1.unsupportedSyncCollectionResponse)(collectionId, syncKey));
            res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
            return res.status(200).send(writer.getBuffer());
        }
        const scopeHash = (0, eas_mail_sync_1.mailSyncScopeHash)(creds.user, deviceId, collectionId);
        const requestHash = (0, eas_mail_sync_1.mailSyncRequestHash)(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
        const sendMailSyncStatus = (status, responseSyncKey = syncKey) => {
            const writer = new writer_1.WbxmlWriter();
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
        return (0, eas_mail_sync_1.withMailSyncScopeLock)(scopeHash, async () => {
            let state;
            try {
                state = await (0, eas_mail_sync_1.loadMailSyncState)(creds.user, deviceId, collectionId);
            }
            catch (error) {
                if (!(error instanceof eas_mail_sync_1.MailSyncStateError))
                    throw error;
                if (syncKey !== '0')
                    return sendMailSyncStatus('3');
                await (0, eas_mail_sync_1.deleteMailSyncState)(creds.user, deviceId, collectionId);
                state = null;
            }
            const replayResponse = (0, eas_mail_sync_1.mailSyncReplayResponse)(state, syncKey, requestHash);
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
                || !(0, eas_mail_sync_1.validateMailClientCommands)(requestCommands, collectionId).ok) {
                return sendMailSyncStatus('4');
            }
            const requestedFetchServerIds = requestCommands
                .filter((command) => command.tag === 'Fetch')
                .map((command) => childText(command, 'ServerId'))
                .filter(Boolean);
            const changeReadFlags = requestCommands
                .filter((command) => command.tag === 'Change')
                .map((command) => ({
                serverId: childText(command, 'ServerId'),
                uid: (0, eas_protocol_1.activeSyncMailMessageUid)(collectionId, childText(command, 'ServerId')),
                read: childText(childNode(command, 'ApplicationData'), 'Read'),
            }));
            const deleteServerIds = requestCommands
                .filter((command) => command.tag === 'Delete')
                .map((command) => ({
                serverId: childText(command, 'ServerId'),
                uid: (0, eas_protocol_1.activeSyncMailMessageUid)(collectionId, childText(command, 'ServerId')),
            }));
            const deletesAsMoves = childText(syncCollectionNode, 'DeletesAsMoves') !== '0';
            const getChanges = (0, eas_sync_1.parseActiveSyncGetChanges)(syncKey, childNode(syncCollectionNode, 'GetChanges'));
            if (!getChanges.ok)
                return sendMailSyncStatus('4');
            const getChangesRequested = getChanges.value;
            const optionsNode = childNode(syncCollectionNode, 'Options');
            const bodyPreferenceNodes = optionsNode?.children?.filter((node) => node.tag === 'BodyPreference') || [];
            const bodyPreferenceNode = bodyPreferenceNodes.find((node) => ['1', '2', '4'].includes(childText(node, 'Type')))
                || bodyPreferenceNodes[0];
            const requestedFilterType = childText(optionsNode, 'FilterType');
            const filterTypeSpecified = requestedFilterType !== '';
            const fallbackOptions = syncKey === '0' ? undefined : (state || undefined);
            let syncOptions;
            try {
                syncOptions = (0, eas_mail_sync_1.normalizeMailSyncOptions)({
                    filterType: requestedFilterType || undefined,
                    windowSize: childNode(syncCollectionNode, 'WindowSize')
                        ? childText(syncCollectionNode, 'WindowSize')
                        : undefined,
                    bodyType: childText(bodyPreferenceNode, 'Type') || undefined,
                    truncationSize: childText(bodyPreferenceNode, 'TruncationSize') || undefined,
                }, fallbackOptions);
            }
            catch (error) {
                console.warn(`[EAS] Invalid mail options for scope ${scopeHash.slice(0, 12)}`);
                return sendMailSyncStatus('4');
            }
            if (syncKey === '0') {
                if (commandsNode)
                    return sendMailSyncStatus('4');
                const validationImap = new imap_1.ImapService(creds.user, creds.pass);
                let primeUidValidity = '0';
                try {
                    await validationImap.connect();
                    const mailbox = await validationImap.client.mailboxOpen(folderPath, { readOnly: true });
                    primeUidValidity = String(mailbox.uidValidity || '0');
                    await validationImap.client.mailboxClose();
                }
                catch {
                    return sendMailSyncStatus('8');
                }
                finally {
                    try {
                        await validationImap.logout();
                    }
                    catch { }
                }
                const nextSyncKey = (0, eas_mail_sync_1.createMailSyncKey)();
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
                };
                await (0, eas_mail_sync_1.saveMailSyncState)(state);
                res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                return res.status(200).send(responseBuffer);
            }
            const fetchServerIds = requestedFetchServerIds.slice(0, (0, eas_mail_sync_1.effectiveMailSyncWindow)(syncOptions));
            const rejectedFetchServerIds = requestedFetchServerIds.slice(fetchServerIds.length);
            const nextSyncKey = (0, eas_mail_sync_1.createMailSyncKey)();
            let serverCommands = [];
            let nextKnownItems = { ...(state?.knownItems || {}) };
            let nextHighestModseq = state?.highestModseq || '0';
            let nextUidValidity = state?.uidValidity || '0';
            let minimumUid = state?.minimumUid || 1;
            let moreAvailable = false;
            const responses = [];
            for (const serverId of rejectedFetchServerIds) {
                responses.push({
                    tag: 'Fetch', page: 0, children: [
                        { tag: 'ServerId', page: 0, content: serverId },
                        { tag: 'Status', page: 0, content: '6' },
                    ],
                });
            }
            const imap = new imap_1.ImapService(creds.user, creds.pass);
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
                    }
                    catch {
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
                    }
                    catch {
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
                    if (recoverLegacyAllMailFloor)
                        nextHighestModseq = '0';
                    const snapshot = await imap.getActiveSyncMailSnapshot(folderPath, (0, eas_mail_sync_1.filterTypeCutoff)(syncOptions.filterType), state?.highestModseq || '0', Object.keys(nextKnownItems).map(Number), recoverLegacyAllMailFloor);
                    if (syncKey !== '0' && state && state.uidValidity !== '0' && state.uidValidity !== snapshot.uidValidity) {
                        return sendMailSyncStatus('3');
                    }
                    if (syncOptions.filterType === 0
                        || (filterTypeSpecified && (!state || state.filterType !== syncOptions.filterType || state.minimumUid > 1))) {
                        minimumUid = 1;
                    }
                    const delta = (0, eas_mail_sync_1.computeMailSyncDelta)({
                        knownItems: nextKnownItems,
                        allUids: snapshot.allUids,
                        eligibleUids: snapshot.eligibleUids,
                        changedReadFlags: snapshot.changedReadFlags,
                        filterType: syncOptions.filterType,
                        windowSize: (0, eas_mail_sync_1.effectiveMailSyncWindow)(syncOptions, fetchServerIds.length),
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
                        .map((serverId) => (0, eas_protocol_1.activeSyncMailMessageUid)(collectionId, serverId))
                        .filter((uid) => uid !== null),
                ]));
                const messages = await imap.getActiveSyncMessages(folderPath, bodyUids, syncOptions.truncationSize + 256 * 1024);
                const messagesByUid = new Map(messages.map(message => [message.uid, message]));
                for (const serverId of fetchServerIds) {
                    const uid = (0, eas_protocol_1.activeSyncMailMessageUid)(collectionId, serverId);
                    const message = messagesByUid.get(uid);
                    responses.push(message ? {
                        tag: 'Fetch', page: 0, children: [
                            { tag: 'ServerId', page: 0, content: serverId },
                            { tag: 'Status', page: 0, content: '1' },
                            { tag: 'ApplicationData', page: 0, children: await (0, eas_mail_sync_1.activeSyncMailApplicationData)(message, syncOptions) },
                        ],
                    } : {
                        tag: 'Fetch', page: 0, children: [
                            { tag: 'ServerId', page: 0, content: serverId },
                            { tag: 'Status', page: 0, content: '8' },
                        ],
                    });
                }
                const commandNodes = [];
                for (const command of serverCommands) {
                    const serverId = (0, eas_protocol_1.activeSyncMailMessageServerId)(collectionId, command.uid);
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
                                { tag: 'ApplicationData', page: 0, children: await (0, eas_mail_sync_1.activeSyncMailApplicationData)(message, syncOptions) },
                            ],
                        });
                    }
                    else if (command.type === 'Change') {
                        commandNodes.push({
                            tag: 'Change', page: 0, children: [
                                { tag: 'ServerId', page: 0, content: serverId },
                                { tag: 'ApplicationData', page: 0, children: [
                                        { tag: 'Read', page: 2, content: command.isRead === 1 ? '1' : '0' },
                                    ] },
                            ],
                        });
                    }
                    else {
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
                const writer = new writer_1.WbxmlWriter();
                writer.writeNode(responseAst);
                const responseBuffer = writer.getBuffer();
                if (responseBuffer.length > eas_mail_sync_1.MAX_MAIL_SYNC_RESPONSE_BYTES) {
                    throw new eas_mail_sync_1.MailSyncStateError('Mail Sync response exceeds its aggregate byte budget');
                }
                const replayable = responseBuffer.length <= eas_mail_sync_1.MAX_MAIL_SYNC_REPLAY_BYTES;
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
                };
                await (0, eas_mail_sync_1.saveMailSyncState)(state);
                console.log(`[SYNC] Scope ${scopeHash.slice(0, 12)}: ${commandNodes.length} commands, ${responses.length} responses, MoreAvailable=${moreAvailable}`);
                res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                return res.status(200).send(responseBuffer);
            }
            catch {
                console.error(`[EAS] Mail Sync failed for scope ${scopeHash.slice(0, 12)}`);
                return res.status(500).send();
            }
            finally {
                try {
                    await imap.logout();
                }
                catch { }
            }
        });
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
                // Find SaveInSentItems recursively. MIME extraction searches all payload-bearing
                // nodes because iOS may place the raw RFC822 bytes under a decoded fallback tag.
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
                mimeContent = (0, eas_send_1.extractActiveSyncSendMailMime)(decoded);
                const saveNode = findNode(decoded, 'SaveInSentItems');
                if (saveNode)
                    saveInSent = true;
            }
            catch {
                console.error(`[EAS] ${cmd} WBXML parsing failed`);
            }
        }
        if (mimeContent) {
            try {
                const transporter = nodemailer_1.default.createTransport((0, config_1.smtpTransportOptions)({
                    user: creds.user,
                    pass: creds.pass,
                }));
                const envelope = await (0, eas_send_1.buildActiveSyncSendMailEnvelope)(mimeContent, creds.user);
                console.log(`[EAS] Sending email to ${envelope.to.length} recipient(s)`);
                await transporter.sendMail({ raw: mimeContent, envelope });
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
                        console.log('[EAS] Saved outgoing email to the Sent mailbox');
                    }
                    await imap.logout();
                }
                return res.status(200).send();
            }
            catch {
                console.error('[EAS] SendMail failed');
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
                            await imap.moveMessage(sourceFolder, destFolder, uid);
                            responseNodes.push({
                                tag: "Response", page: 5, children: [
                                    { tag: "SrcMsgId", page: 5, content: srcMsgId },
                                    { tag: "Status", page: 5, content: "3" }, // 3 = Success
                                    { tag: "DstMsgId", page: 5, content: `${dstFldId}-${uid}` } // Rough approximation of new ID
                                ]
                            });
                        }
                        catch {
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
                const writer = new writer_1.WbxmlWriter();
                writer.writeNode(responseAst);
                res.set('Content-Type', 'application/vnd.ms-sync.wbxml');
                return res.status(200).send(writer.getBuffer());
            }
            catch {
                console.error('[EAS] MoveItems request failed');
                return res.status(500).send();
            }
        }
        return res.status(500).send();
    }
    if (cmd === 'ItemOperations') {
        const sendItemOperations = (status, responses = []) => {
            const writer = new writer_1.WbxmlWriter();
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
        if (requestBody.length === 0)
            return sendItemOperations('2');
        const operations = (0, eas_item_operations_1.itemOperationsRequestFetches)(decodedForStructure);
        if (!operations)
            return sendItemOperations('2');
        if (operations.length > eas_item_operations_1.ITEM_OPERATIONS_MAX_FETCHES)
            return sendItemOperations('2');
        if (operations.length === 0)
            return sendItemOperations('2');
        const responses = [];
        let remainingBodyBytes = eas_item_operations_1.ITEM_OPERATIONS_MAX_RESPONSE_BODY_BYTES;
        let remainingSourceBytes = eas_item_operations_1.ITEM_OPERATIONS_MAX_AGGREGATE_SOURCE_BYTES;
        let globalFailureStatus = null;
        const imap = new imap_1.ImapService(requestCredentials.user, requestCredentials.pass);
        try {
            await imap.connect();
        }
        catch {
            try {
                await imap.logout();
            }
            catch { }
            return sendItemOperations('3');
        }
        try {
            for (const fetchNode of operations) {
                const fetchRequest = (0, eas_item_operations_1.itemOperationsFetchRequest)(fetchNode);
                if (fetchRequest.ok === false) {
                    responses.push((0, eas_item_operations_1.itemOperationsFetchError)(fetchRequest.collectionId, fetchRequest.serverId, fetchRequest.status));
                    continue;
                }
                const { collectionId, serverId } = fetchRequest;
                const target = (0, eas_item_operations_1.itemOperationsMailboxTarget)(fetchRequest.store, collectionId, serverId);
                if (target.ok === false) {
                    if (target.status === '9') {
                        globalFailureStatus = '9';
                        break;
                    }
                    responses.push((0, eas_item_operations_1.itemOperationsFetchError)(collectionId, serverId, target.status));
                    continue;
                }
                const sourceAllowance = (0, eas_item_operations_1.itemOperationsSourceAllowance)(remainingSourceBytes);
                if (remainingBodyBytes === 0 || sourceAllowance === 0) {
                    responses.push((0, eas_item_operations_1.itemOperationsFetchError)(collectionId, serverId, '11'));
                    continue;
                }
                let message;
                try {
                    message = await imap.getMessageByUid(target.folderPath, target.uid, sourceAllowance);
                }
                catch {
                    globalFailureStatus = '12';
                    break;
                }
                if (!message) {
                    responses.push((0, eas_item_operations_1.itemOperationsFetchError)(collectionId, serverId, '6'));
                    continue;
                }
                const sourceBytes = Buffer.isBuffer(message.source) ? message.source.length : sourceAllowance;
                remainingSourceBytes = Math.max(0, remainingSourceBytes - sourceBytes);
                if (sourceBytes > sourceAllowance) {
                    remainingSourceBytes = 0;
                    responses.push((0, eas_item_operations_1.itemOperationsFetchError)(collectionId, serverId, '11'));
                    continue;
                }
                try {
                    const bodyAllowance = (0, eas_item_operations_1.itemOperationsBodyAllowance)(remainingBodyBytes, eas_item_operations_1.ITEM_OPERATIONS_MAX_BODY_BYTES);
                    const fetchResponse = await (0, eas_item_operations_1.itemOperationsFetchSuccess)({
                        collectionId,
                        serverId,
                        message,
                        maxBodyBytes: bodyAllowance,
                        bodyPreferences: fetchRequest.bodyPreferences,
                    });
                    remainingBodyBytes = Math.max(0, remainingBodyBytes - (0, eas_item_operations_1.itemOperationsFetchBodyBytes)(fetchResponse));
                    responses.push(fetchResponse);
                }
                catch {
                    responses.push((0, eas_item_operations_1.itemOperationsFetchError)(collectionId, serverId, '14'));
                }
            }
        }
        finally {
            try {
                await imap.logout();
            }
            catch { }
        }
        if (globalFailureStatus)
            return sendItemOperations(globalFailureStatus);
        return sendItemOperations('1', responses);
    }
    res.status(400).send();
});
async function startServer() {
    try {
        await (0, application_startup_1.startApplicationAfterRequiredMigrations)({
            ensureMailSearchSchema: search_index_1.ensureMailSearchSchema,
            initializeSessionStore: auth_1.initializeSessionStore,
            ensureUserSettingsSchema: user_settings_1.ensureUserSettingsSchema,
            ensureAdminSettingsSchema: admin_settings_1.ensureAdminSettingsSchema,
            ensureBrandingSchema: branding_1.ensureBrandingSchema,
            ensureAccountSecuritySchema: account_security_1.ensureAccountSecuritySchema,
            ensureCalendarSchema: calendar_utils_1.ensureCalendarSchema,
            ensureCalendarSubscriptionSchema: calendar_subscription_1.ensureCalendarSubscriptionSchema,
            ensureScheduledEmailsSchema: scheduled_send_1.ensureScheduledEmailsSchema,
            ensureNotesSchema: notes_utils_1.ensureNotesSchema,
            ensureRemindersSchema: notes_utils_1.ensureRemindersSchema,
            ensureAttachmentsSchema: notes_utils_1.ensureAttachmentsSchema,
            ensureContactsSchema: contact_utils_1.ensureContactsSchema,
            ensureEasMailSyncSchema: eas_mail_sync_1.ensureEasMailSyncSchema,
            ensureEasPimSyncSchema: eas_pim_sync_1.ensureEasPimSyncSchema,
            repairBirthdayCalendarProjections: birthday_calendar_1.repairAllBirthdayCalendarProjections,
            startSearchWorker: search_worker_1.startSearchWorker,
            startScheduledSender: scheduled_send_1.startScheduledSender,
            startCalendarSubscriptionWorker: calendar_subscription_1.startCalendarSubscriptionWorker,
            listen: () => server.listen(config_1.serverConfig.port, config_1.serverConfig.host, () => {
                console.log(`OpenMailStack webmail backend listening on ${config_1.serverConfig.host}:${config_1.serverConfig.port}`);
            }),
        });
    }
    catch (err) {
        console.error('Failed to initialize required application schema:', err);
        process.exit(1);
    }
}
void startServer();
//# sourceMappingURL=index.js.map