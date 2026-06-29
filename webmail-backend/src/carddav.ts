import express, { Request, Response } from 'express';
import xml2js from 'xml2js';
import { davBasicAuth } from './dav-auth';
import {
    addressBookSyncToken,
    contactEtag,
    contactVCard,
    deleteContactByDavUid,
    ensureContactsSchema,
    getContactByDavUid,
    getContactHref,
    listContacts,
    normalizeDavUid,
    saveContactFromVCard,
    xmlEscape
} from './contact-utils';

const router = express.Router();
const ADDRESSBOOK_SLUGS = new Set(['personal', 'contacts']);

function addressBookCollectionMatch(path: string): RegExpMatchArray | null {
    return path.match(/^(?:\/carddav)?\/addressbooks\/[^\/]+\/([^\/]+)\/?$/);
}

function contactResourceMatch(path: string): RegExpMatchArray | null {
    return path.match(/^(?:\/carddav)?\/addressbooks\/[^\/]+\/([^\/]+)\/([^\/]+)\.vcf$/);
}

function isAddressBookSlug(slug: string): boolean {
    return ADDRESSBOOK_SLUGS.has(decodeURIComponent(slug).toLowerCase());
}

function hrefToDavUid(href: string): string | null {
    const decodedHref = href
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
    const match = decodedHref.match(/\/addressbooks\/[^\/]+\/(?:personal|contacts)\/([^\/]+)\.vcf$/i);
    return match ? normalizeDavUid(match[1]) : null;
}

function responseForAddressBook(user: string, syncToken: string, includeChildren: string): string {
    return `
  <D:response>
    <D:href>/carddav/addressbooks/${xmlEscape(user)}/personal/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/><C:addressbook/></D:resourcetype>
        <D:displayname>Personal Contacts</D:displayname>
        <CS:getctag>"${xmlEscape(syncToken)}"</CS:getctag>
        <D:sync-token>http://openmailstack.local/carddav/${xmlEscape(syncToken)}</D:sync-token>
        <C:supported-address-data>
          <C:address-data-type content-type="text/vcard" version="3.0"/>
          <C:address-data-type content-type="text/vcard" version="4.0"/>
        </C:supported-address-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>${includeChildren}`;
}

async function contactResourceResponse(user: string, contact: any, includeData: boolean): Promise<string> {
    const vcard = contactVCard(contact);
    return `
  <D:response>
    <D:href>${xmlEscape(getContactHref(user, contact))}</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>${xmlEscape(contactEtag(contact))}</D:getetag>
        <D:getcontenttype>text/vcard; charset=utf-8</D:getcontenttype>
        ${includeData ? `<C:address-data>${xmlEscape(vcard)}</C:address-data>` : ''}
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
}

async function parseRequestedHrefs(req: Request): Promise<string[]> {
    const rawBody = req.body ? req.body.toString('utf-8') : '';
    if (!rawBody.trim()) return [];

    try {
        const parsed = await xml2js.parseStringPromise(rawBody, { explicitArray: false });
        const hrefs: string[] = [];
        const walk = (value: any) => {
            if (!value || typeof value !== 'object') return;
            for (const [key, child] of Object.entries(value)) {
                if (key.toLowerCase().endsWith('href')) {
                    if (typeof child === 'string') hrefs.push(child);
                    if (Array.isArray(child)) hrefs.push(...child.filter(item => typeof item === 'string'));
                } else if (Array.isArray(child)) {
                    child.forEach(walk);
                } else {
                    walk(child);
                }
            }
        };
        walk(parsed);
        return hrefs;
    } catch {
        return [];
    }
}

router.use(davBasicAuth('OpenMailStack CardDAV'));

router.all(/.*/, async (req: Request, res: Response) => {
    const user = (req as any).user;
    const method = req.method.toUpperCase();
    const path = req.path;

    console.log(`[CardDAV] ${method} ${path} by ${user}`);

    try {
        await ensureContactsSchema();

        if (method === 'OPTIONS') {
            res.set('Allow', 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT');
            res.set('DAV', '1, 2, 3, addressbook');
            return res.status(200).send();
        }

        if (method === 'PROPFIND') return handlePropfind(req, res, user);
        if (method === 'REPORT') return handleReport(req, res, user);
        if (method === 'GET' || method === 'HEAD') return handleGet(req, res, user, method === 'HEAD');
        if (method === 'PUT') return handlePut(req, res, user);
        if (method === 'DELETE') return handleDelete(req, res, user);
        if (method === 'PROPPATCH') return handleProppatch(req, res, user);

        return res.status(405).send();
    } catch (err) {
        console.error(err);
        return res.status(500).send('CardDAV Error');
    }
});

async function handlePropfind(req: Request, res: Response, user: string) {
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
        <D:current-user-principal><D:href>/carddav/principals/${xmlEscape(user)}/</D:href></D:current-user-principal>
        <D:resourcetype><D:collection/></D:resourcetype>
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
    <D:href>/carddav/principals/${xmlEscape(user)}/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:principal/></D:resourcetype>
        <D:displayname>${xmlEscape(user)}</D:displayname>
        <D:principal-URL><D:href>/carddav/principals/${xmlEscape(user)}/</D:href></D:principal-URL>
        <C:addressbook-home-set><D:href>/carddav/addressbooks/${xmlEscape(user)}/</D:href></C:addressbook-home-set>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
        return res.status(207).send(xml);
    }

    const collectionMatch = addressBookCollectionMatch(path);
    if (collectionMatch && isAddressBookSlug(collectionMatch[1])) {
        const syncToken = await addressBookSyncToken(user);
        let contactResponses = '';
        if (depth === '1') {
            const contacts = await listContacts(user);
            contactResponses = (await Promise.all(contacts.map(contact => contactResourceResponse(user, contact, false)))).join('');
        }
        xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:CS="http://calendarserver.org/ns/">
${responseForAddressBook(user, syncToken, contactResponses)}
</D:multistatus>`;
        return res.status(207).send(xml);
    }

    if (path.includes('/addressbooks/')) {
        const syncToken = await addressBookSyncToken(user);
        const addressBookResponse = depth === '1' ? responseForAddressBook(user, syncToken, '') : '';
        xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:CS="http://calendarserver.org/ns/">
  <D:response>
    <D:href>/carddav/addressbooks/${xmlEscape(user)}/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/></D:resourcetype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>${addressBookResponse}
</D:multistatus>`;
        return res.status(207).send(xml);
    }

    return res.status(404).send();
}

async function handleReport(req: Request, res: Response, user: string) {
    const collectionMatch = addressBookCollectionMatch(req.path);
    if (!collectionMatch || !isAddressBookSlug(collectionMatch[1])) {
        return res.status(404).send();
    }

    const requestedHrefs = await parseRequestedHrefs(req);
    const requestedUids = new Set(requestedHrefs.map(hrefToDavUid).filter(Boolean) as string[]);
    let contacts = await listContacts(user);
    if (requestedUids.size > 0) {
        contacts = contacts.filter(contact => requestedUids.has(contact.dav_uid || `contact-${contact.id}`));
    }

    const rawBody = req.body ? req.body.toString('utf-8') : '';
    const includeData = rawBody.includes('address-data') || rawBody.includes('addressbook-multiget');

    const responses = (await Promise.all(contacts.map(contact => contactResourceResponse(user, contact, includeData)))).join('');
    const syncToken = await addressBookSyncToken(user);
    res.set('Content-Type', 'application/xml; charset=utf-8');
    const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
${responses}
  <D:sync-token>http://openmailstack.local/carddav/${xmlEscape(syncToken)}</D:sync-token>
</D:multistatus>`;
    return res.status(207).send(xml);
}

async function handleGet(req: Request, res: Response, user: string, headOnly: boolean) {
    const match = contactResourceMatch(req.path);
    if (!match || !isAddressBookSlug(match[1])) {
        return res.status(404).send();
    }

    const davUid = normalizeDavUid(match[2]);
    const contact = await getContactByDavUid(user, davUid);
    if (!contact) {
        return res.status(404).send();
    }

    const vcard = contactVCard(contact);
    res.set('Content-Type', 'text/vcard; charset=utf-8');
    res.set('ETag', contactEtag(contact));
    if (headOnly) return res.status(200).send();
    return res.status(200).send(vcard);
}

async function handlePut(req: Request, res: Response, user: string) {
    const match = contactResourceMatch(req.path);
    if (!match || !isAddressBookSlug(match[1])) {
        return res.status(409).send();
    }

    const davUid = normalizeDavUid(match[2]);
    const vcard = req.body ? req.body.toString('utf-8') : '';
    if (!vcard.trim()) {
        return res.status(400).send();
    }

    const result = await saveContactFromVCard(user, davUid, vcard);
    res.set('ETag', contactEtag(result.contact));
    res.set('Location', getContactHref(user, result.contact));
    return res.status(result.created ? 201 : 204).send();
}

async function handleDelete(req: Request, res: Response, user: string) {
    const match = contactResourceMatch(req.path);
    if (!match || !isAddressBookSlug(match[1])) {
        return res.status(400).send();
    }

    const deleted = await deleteContactByDavUid(user, normalizeDavUid(match[2]));
    return res.status(deleted ? 204 : 404).send();
}

async function handleProppatch(req: Request, res: Response, user: string) {
    const syncToken = await addressBookSyncToken(user);
    res.set('Content-Type', 'application/xml; charset=utf-8');
    const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:CS="http://calendarserver.org/ns/">
${responseForAddressBook(user, syncToken, '')}
</D:multistatus>`;
    return res.status(207).send(xml);
}

export default router;
