"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const xml2js_1 = __importDefault(require("xml2js"));
const dav_auth_1 = require("./dav-auth");
const dav_report_1 = require("./dav-report");
const contact_utils_1 = require("./contact-utils");
const router = express_1.default.Router();
const ADDRESSBOOK_SLUGS = new Set(['personal', 'contacts']);
const READ_PRIVILEGES = ['read', 'read-current-user-privilege-set'];
const CONTACT_PRIVILEGES = [...READ_PRIVILEGES, 'write-content'];
const ADDRESSBOOK_PRIVILEGES = [...READ_PRIVILEGES, 'bind', 'unbind'];
function currentUserPrivilegeSet(privileges) {
    return `<D:current-user-privilege-set>${privileges
        .map(privilege => `<D:privilege><D:${privilege}/></D:privilege>`)
        .join('')}</D:current-user-privilege-set>`;
}
function emitContactsUpdated(user, details = {}) {
    try {
        const { io } = require('./index');
        io.to(user).emit('contacts_updated', details);
    }
    catch { }
}
function addressBookCollectionMatch(path) {
    return path.match(/^(?:\/carddav)?\/addressbooks\/[^\/]+\/([^\/]+)\/?$/);
}
function contactResourceMatch(path) {
    return path.match(/^(?:\/carddav)?\/addressbooks\/[^\/]+\/([^\/]+)\/([^\/]+)\.vcf$/);
}
function isAddressBookSlug(slug) {
    return ADDRESSBOOK_SLUGS.has(decodeURIComponent(slug).toLowerCase());
}
function hrefToDavUid(href) {
    const decodedHref = href
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
    const match = decodedHref.match(/\/addressbooks\/[^\/]+\/(?:personal|contacts)\/([^\/]+)\.vcf$/i);
    return match ? (0, contact_utils_1.normalizeDavUid)(match[1]) : null;
}
function normalizeReportSyncToken(token) {
    if (!token)
        return null;
    const trimmed = token.trim();
    const lastSlash = trimmed.lastIndexOf('/');
    return lastSlash >= 0 ? trimmed.slice(lastSlash + 1) : trimmed;
}
function responseForAddressBook(user, syncToken, includeChildren) {
    return `
  <D:response>
    <D:href>/carddav/addressbooks/${(0, contact_utils_1.xmlEscape)(user)}/personal/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/><C:addressbook/></D:resourcetype>
        <D:displayname>Personal Contacts</D:displayname>
        <CS:getctag>"${(0, contact_utils_1.xmlEscape)(syncToken)}"</CS:getctag>
        <D:sync-token>http://openmailstack.local/carddav/${(0, contact_utils_1.xmlEscape)(syncToken)}</D:sync-token>
        ${currentUserPrivilegeSet(ADDRESSBOOK_PRIVILEGES)}
        <C:supported-address-data>
          <C:address-data-type content-type="text/vcard" version="3.0"/>
          <C:address-data-type content-type="text/vcard" version="4.0"/>
        </C:supported-address-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>${includeChildren}`;
}
async function contactResourceResponse(user, contact, includeData) {
    const vcard = (0, contact_utils_1.contactVCard)(contact);
    return `
  <D:response>
    <D:href>${(0, contact_utils_1.xmlEscape)((0, contact_utils_1.getContactHref)(user, contact))}</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>${(0, contact_utils_1.xmlEscape)((0, contact_utils_1.contactEtag)(contact))}</D:getetag>
        <D:getcontenttype>text/vcard; charset=utf-8</D:getcontenttype>
        ${currentUserPrivilegeSet(CONTACT_PRIVILEGES)}
        ${includeData ? `<C:address-data>${(0, contact_utils_1.xmlEscape)(vcard)}</C:address-data>` : ''}
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
}
function deletedContactResponse(user, davUid) {
    return `
  <D:response>
    <D:href>${(0, contact_utils_1.xmlEscape)((0, contact_utils_1.getContactHrefForDavUid)(user, davUid))}</D:href>
    <D:status>HTTP/1.1 404 Not Found</D:status>
  </D:response>`;
}
async function parseRequestedHrefs(req) {
    const rawBody = req.body ? req.body.toString('utf-8') : '';
    if (!rawBody.trim())
        return [];
    try {
        const parsed = await xml2js_1.default.parseStringPromise(rawBody, { explicitArray: false });
        const hrefs = [];
        const walk = (value) => {
            if (!value || typeof value !== 'object')
                return;
            for (const [key, child] of Object.entries(value)) {
                if (key.toLowerCase().endsWith('href')) {
                    if (typeof child === 'string')
                        hrefs.push(child);
                    if (Array.isArray(child))
                        hrefs.push(...child.filter(item => typeof item === 'string'));
                }
                else if (Array.isArray(child)) {
                    child.forEach(walk);
                }
                else {
                    walk(child);
                }
            }
        };
        walk(parsed);
        return hrefs;
    }
    catch {
        return [];
    }
}
router.use((0, dav_auth_1.davBasicAuth)('OpenMailStack CardDAV'));
router.all(/.*/, async (req, res) => {
    const user = req.user;
    const method = req.method.toUpperCase();
    const path = req.path;
    console.log(`[CardDAV] ${method} ${path} by ${user}`);
    try {
        await (0, contact_utils_1.ensureContactsSchema)();
        if (method === 'OPTIONS') {
            res.set('Allow', 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT');
            res.set('DAV', '1, 2, 3, addressbook');
            return res.status(200).send();
        }
        if (method === 'PROPFIND')
            return handlePropfind(req, res, user);
        if (method === 'REPORT')
            return handleReport(req, res, user);
        if (method === 'GET' || method === 'HEAD')
            return handleGet(req, res, user, method === 'HEAD');
        if (method === 'PUT')
            return handlePut(req, res, user);
        if (method === 'DELETE')
            return handleDelete(req, res, user);
        if (method === 'PROPPATCH')
            return handleProppatch(req, res, user);
        return res.status(405).send();
    }
    catch (err) {
        console.error(err);
        return res.status(500).send('CardDAV Error');
    }
});
async function handlePropfind(req, res, user) {
    const path = req.path;
    const depth = String(req.headers.depth || '0');
    let xml = '';
    res.set('Content-Type', 'application/xml; charset=utf-8');
    if (path === '/' || path === '' || path === `/${user}` || path === `/${user}/`) {
        xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:response>
    <D:href>/carddav/</D:href>
    <D:propstat>
      <D:prop>
        <D:current-user-principal><D:href>/carddav/principals/${(0, contact_utils_1.xmlEscape)(user)}/</D:href></D:current-user-principal>
        <D:resourcetype><D:collection/></D:resourcetype>
        ${currentUserPrivilegeSet(READ_PRIVILEGES)}
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
        return res.status(207).send(xml);
    }
    if (path.includes('/principals/')) {
        xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:response>
    <D:href>/carddav/principals/${(0, contact_utils_1.xmlEscape)(user)}/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:principal/></D:resourcetype>
        <D:displayname>${(0, contact_utils_1.xmlEscape)(user)}</D:displayname>
        <D:principal-URL><D:href>/carddav/principals/${(0, contact_utils_1.xmlEscape)(user)}/</D:href></D:principal-URL>
        <C:addressbook-home-set><D:href>/carddav/addressbooks/${(0, contact_utils_1.xmlEscape)(user)}/</D:href></C:addressbook-home-set>
        ${currentUserPrivilegeSet(READ_PRIVILEGES)}
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
        return res.status(207).send(xml);
    }
    const collectionMatch = addressBookCollectionMatch(path);
    if (collectionMatch && isAddressBookSlug(collectionMatch[1])) {
        const syncToken = await (0, contact_utils_1.addressBookSyncToken)(user);
        let contactResponses = '';
        if (depth === '1') {
            const contacts = await (0, contact_utils_1.listContacts)(user);
            const tombstones = await (0, contact_utils_1.listRecentContactTombstones)(user);
            contactResponses = [
                ...(await Promise.all(contacts.map(contact => contactResourceResponse(user, contact, false)))),
                ...tombstones.flatMap(contact_utils_1.contactTombstoneDavUids).map(davUid => deletedContactResponse(user, davUid))
            ].join('');
        }
        xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:CS="http://calendarserver.org/ns/">
${responseForAddressBook(user, syncToken, contactResponses)}
</D:multistatus>`;
        return res.status(207).send(xml);
    }
    if (path.includes('/addressbooks/')) {
        const syncToken = await (0, contact_utils_1.addressBookSyncToken)(user);
        const addressBookResponse = depth === '1' ? responseForAddressBook(user, syncToken, '') : '';
        xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:CS="http://calendarserver.org/ns/">
  <D:response>
    <D:href>/carddav/addressbooks/${(0, contact_utils_1.xmlEscape)(user)}/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/></D:resourcetype>
        ${currentUserPrivilegeSet(READ_PRIVILEGES)}
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>${addressBookResponse}
</D:multistatus>`;
        return res.status(207).send(xml);
    }
    return res.status(404).send();
}
async function handleReport(req, res, user) {
    const collectionMatch = addressBookCollectionMatch(req.path);
    if (!collectionMatch || !isAddressBookSlug(collectionMatch[1])) {
        return res.status(404).send();
    }
    const rawBody = req.body ? req.body.toString('utf-8') : '';
    const rawBodyLower = rawBody.toLowerCase();
    const isSyncCollection = (0, dav_report_1.isSyncCollectionReport)(rawBody);
    const requestedSyncToken = normalizeReportSyncToken((0, dav_report_1.syncTokenFromReportBody)(rawBody));
    const syncToken = await (0, contact_utils_1.addressBookSyncToken)(user);
    const requestedHrefs = await parseRequestedHrefs(req);
    const requestedUids = new Set(requestedHrefs.map(hrefToDavUid).filter(Boolean));
    let contacts = [];
    let tombstoneUids = [];
    if (isSyncCollection && requestedSyncToken === syncToken) {
        contacts = [];
    }
    else if (isSyncCollection) {
        const previousVersion = (0, contact_utils_1.contactSyncTokenVersion)(requestedSyncToken);
        contacts = previousVersion > 0
            ? await (0, contact_utils_1.listContactsUpdatedSince)(user, previousVersion)
            : await (0, contact_utils_1.listContacts)(user);
        tombstoneUids = previousVersion > 0
            ? (await (0, contact_utils_1.listContactTombstonesSince)(user, previousVersion)).flatMap(contact_utils_1.contactTombstoneDavUids)
            : [];
    }
    else if (requestedUids.size > 0) {
        contacts = await (0, contact_utils_1.listContacts)(user);
        contacts = contacts.filter(contact => requestedUids.has(contact.dav_uid || `contact-${contact.id}`));
        tombstoneUids = (await (0, contact_utils_1.listRecentContactTombstones)(user))
            .flatMap(contact_utils_1.contactTombstoneDavUids)
            .filter(davUid => requestedUids.has(davUid));
    }
    else {
        contacts = await (0, contact_utils_1.listContacts)(user);
    }
    const includeData = rawBodyLower.includes('address-data') || rawBodyLower.includes('addressbook-multiget');
    const contactResponses = (await Promise.all(contacts.map(contact => contactResourceResponse(user, contact, includeData)))).join('');
    const deletedResponses = tombstoneUids.map(davUid => deletedContactResponse(user, davUid)).join('');
    const responses = `${contactResponses}${deletedResponses}`;
    res.set('Content-Type', 'application/xml; charset=utf-8');
    const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
${responses}
  <D:sync-token>http://openmailstack.local/carddav/${(0, contact_utils_1.xmlEscape)(syncToken)}</D:sync-token>
</D:multistatus>`;
    return res.status(207).send(xml);
}
async function handleGet(req, res, user, headOnly) {
    const match = contactResourceMatch(req.path);
    if (!match || !isAddressBookSlug(match[1])) {
        return res.status(404).send();
    }
    const davUid = (0, contact_utils_1.normalizeDavUid)(match[2]);
    const contact = await (0, contact_utils_1.getContactByDavUid)(user, davUid);
    if (!contact) {
        return res.status(404).send();
    }
    const vcard = (0, contact_utils_1.contactVCard)(contact);
    res.set('Content-Type', 'text/vcard; charset=utf-8');
    res.set('ETag', (0, contact_utils_1.contactEtag)(contact));
    if (headOnly)
        return res.status(200).send();
    return res.status(200).send(vcard);
}
async function handlePut(req, res, user) {
    const match = contactResourceMatch(req.path);
    if (!match || !isAddressBookSlug(match[1])) {
        return res.status(409).send();
    }
    const davUid = (0, contact_utils_1.normalizeDavUid)(match[2]);
    const vcard = req.body ? req.body.toString('utf-8') : '';
    if (!vcard.trim()) {
        return res.status(400).send();
    }
    const result = await (0, contact_utils_1.saveContactFromVCard)(user, davUid, vcard);
    emitContactsUpdated(user, { davUid });
    res.set('ETag', (0, contact_utils_1.contactEtag)(result.contact));
    res.set('Location', (0, contact_utils_1.getContactHref)(user, result.contact));
    return res.status(result.created ? 201 : 204).send();
}
async function handleDelete(req, res, user) {
    const match = contactResourceMatch(req.path);
    if (!match || !isAddressBookSlug(match[1])) {
        return res.status(400).send();
    }
    const deleted = await (0, contact_utils_1.deleteContactByDavUid)(user, (0, contact_utils_1.normalizeDavUid)(match[2]));
    if (deleted)
        emitContactsUpdated(user, { davUid: (0, contact_utils_1.normalizeDavUid)(match[2]), deleted: true });
    return res.status(deleted ? 204 : 404).send();
}
async function handleProppatch(req, res, user) {
    const syncToken = await (0, contact_utils_1.addressBookSyncToken)(user);
    res.set('Content-Type', 'application/xml; charset=utf-8');
    const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:CS="http://calendarserver.org/ns/">
${responseForAddressBook(user, syncToken, '')}
</D:multistatus>`;
    return res.status(207).send(xml);
}
exports.default = router;
//# sourceMappingURL=carddav.js.map