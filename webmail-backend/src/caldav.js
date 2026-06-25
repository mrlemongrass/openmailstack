"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const db_1 = require("./db");
const xml2js_1 = __importDefault(require("xml2js"));
const calendar_utils_1 = require("./calendar-utils");
const dav_auth_1 = require("./dav-auth");
const router = express_1.default.Router();
async function userOwnsCalendar(calendarId, user) {
    const [rows] = await db_1.pool.query('SELECT id FROM calendars WHERE id = ? AND user_id = ? LIMIT 1', [calendarId, user]);
    return rows.length > 0;
}
function calendarCollectionMatch(path) {
    return path.match(/^(?:\/caldav)?\/calendars\/[^\/]+\/([^\/]+)\/?$/);
}
function calendarEventMatch(path) {
    return path.match(/^(?:\/caldav)?\/calendars\/[^\/]+\/([^\/]+)\/([^\/]+)\.ics$/);
}
function firstPropertyValue(obj, names) {
    for (const name of names) {
        const value = obj?.[name];
        if (typeof value === 'string')
            return value;
        if (value && typeof value._ === 'string')
            return value._;
    }
    return '';
}
async function readCalendarProperties(req, fallbackName) {
    const rawBody = req.body ? req.body.toString('utf-8') : '';
    if (!rawBody.trim()) {
        return { name: fallbackName, color: undefined };
    }
    try {
        const parsed = await xml2js_1.default.parseStringPromise(rawBody, { explicitArray: false });
        const mkcalendar = parsed['C:mkcalendar'] || parsed['c:mkcalendar'] || parsed.mkcalendar || parsed['D:mkcol'] || parsed['d:mkcol'] || parsed.mkcol;
        const set = mkcalendar?.['D:set'] || mkcalendar?.['d:set'] || mkcalendar?.set;
        const prop = set?.['D:prop'] || set?.['d:prop'] || set?.prop || parsed?.['D:prop'] || parsed?.['d:prop'] || parsed?.prop;
        const displayName = firstPropertyValue(prop, ['D:displayname', 'd:displayname', 'displayname']);
        const calendarColor = firstPropertyValue(prop, ['A:calendar-color', 'a:calendar-color', 'calendar-color']);
        return {
            name: displayName.trim() || fallbackName,
            color: /^#[0-9a-f]{6}$/i.test(calendarColor.trim()) ? calendarColor.trim() : undefined
        };
    }
    catch {
        return { name: fallbackName, color: undefined };
    }
}
const authenticate = (0, dav_auth_1.davBasicAuth)('OpenMailStack CalDAV');
router.use(authenticate);
// Main CalDAV Handler
router.all(/.*/, async (req, res) => {
    const user = req.user;
    const method = req.method.toUpperCase();
    const path = req.path;
    console.log(`[CalDAV] ${method} ${path} by ${user}`);
    if (method === 'OPTIONS') {
        res.set('Allow', 'OPTIONS, GET, HEAD, POST, PUT, DELETE, TRACE, COPY, MOVE, PROPFIND, PROPPATCH, MKCOL, MKCALENDAR, LOCK, UNLOCK, REPORT, ACL');
        res.set('DAV', '1, 2, 3, calendar-access, addressbook, extended-mkcol');
        return res.status(200).send();
    }
    if (method === 'PROPFIND') {
        return handlePropfind(req, res, user);
    }
    if (method === 'REPORT') {
        return handleReport(req, res, user);
    }
    if (method === 'PROPPATCH') {
        return handleProppatch(req, res, user);
    }
    if (method === 'MKCALENDAR' || method === 'MKCOL') {
        return handleMkcalendar(req, res, user);
    }
    if (method === 'PUT') {
        return handlePut(req, res, user);
    }
    if (method === 'DELETE') {
        return handleDelete(req, res, user);
    }
    res.status(404).send('Not Found');
});
async function handlePropfind(req, res, user) {
    const path = req.path;
    let xml = '';
    res.set('Content-Type', 'application/xml; charset=utf-8');
    if (path === '/' || path === '' || path === `/${user}/` || path === `/${user}`) {
        // Principal discovery
        xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">
  <D:response>
    <D:href>/caldav/${user}/</D:href>
    <D:propstat>
      <D:prop>
        <D:current-user-principal><D:href>/caldav/principals/${user}/</D:href></D:current-user-principal>
        <D:resourcetype><D:collection/></D:resourcetype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
    }
    else if (path.includes('/principals/')) {
        // Principal details
        xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">
  <D:response>
    <D:href>/caldav/principals/${user}/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:principal/></D:resourcetype>
        <C:calendar-home-set><D:href>/caldav/calendars/${user}/</D:href></C:calendar-home-set>
        <C:calendar-user-address-set><D:href>mailto:${user}</D:href></C:calendar-user-address-set>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
    }
    else if (path.includes('/calendars/') || path.match(/\/[^\/]+\/[^\/]+\/$/)) {
        // Match /caldav/calendars/user/1/ after the /caldav mount, or legacy /user/Calendar/.
        let calendarId = '1';
        let isLegacy = false;
        const calMatch = calendarCollectionMatch(path);
        const legacyMatch = path.match(/^\/([^\/]+)\/([^\/]+)\/$/);
        let cal = null;
        if (calMatch) {
            cal = await (0, calendar_utils_1.getCalendarByToken)(user, calMatch[1]);
            if (!cal)
                return res.status(404).send();
            calendarId = cal.id.toString();
        }
        else if (legacyMatch) {
            isLegacy = true;
            try {
                const defaultCalendar = await (0, calendar_utils_1.ensureDefaultCalendar)(user);
                cal = defaultCalendar;
                calendarId = defaultCalendar.id.toString();
            }
            catch (e) { }
        }
        if (calMatch || legacyMatch) {
            try {
                if (!cal) {
                    const [calRows] = await db_1.pool.query('SELECT * FROM calendars WHERE id = ? AND user_id = ?', [calendarId, user]);
                    if (calRows.length === 0)
                        return res.status(404).send();
                    cal = calRows[0];
                }
                let eventResponses = '';
                if (req.headers.depth === '1') {
                    const [events] = await db_1.pool.query('SELECT * FROM events WHERE calendar_id = ?', [calendarId]);
                    eventResponses = events.map((ev) => `
  <D:response>
    <D:href>${isLegacy ? `/SOGo/dav/${user}/Calendar/` : `/caldav/calendars/${user}/${calendarId}/`}${ev.uid}.ics</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>"${ev.uid}"</D:getetag>
        <D:getcontenttype>text/calendar; charset=utf-8</D:getcontenttype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`).join('');
                }
                xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">
  <D:response>
    <D:href>${isLegacy ? `/SOGo/dav/${user}/Calendar/` : `/caldav/calendars/${user}/${calendarId}/`}</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
        <D:displayname>${cal.name}</D:displayname>
        <CS:getctag>"${cal.sync_token}"</CS:getctag>
        <D:sync-token>http://sabre.io/ns/sync/${cal.sync_token}</D:sync-token>
        <C:supported-calendar-component-set>
          <C:comp name="VEVENT"/>
        </C:supported-calendar-component-set>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  ${eventResponses}
</D:multistatus>`;
            }
            catch (e) {
                console.error(e);
                return res.status(500).send('DB Error');
            }
        }
        else {
            // List all calendars
            try {
                const rows = await (0, calendar_utils_1.getVisibleCalendars)(user);
                let responses = rows.map((cal) => `
  <D:response>
    <D:href>/caldav/calendars/${user}/${cal.id}/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
        <D:displayname>${cal.name}</D:displayname>
        <CS:getctag>"${cal.sync_token}"</CS:getctag>
        <D:sync-token>http://sabre.io/ns/sync/${cal.sync_token}</D:sync-token>
        <C:supported-calendar-component-set>
          <C:comp name="VEVENT"/>
        </C:supported-calendar-component-set>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`).join('');
                xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">
  <D:response>
    <D:href>/caldav/calendars/${user}/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/></D:resourcetype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  ${responses}
</D:multistatus>`;
            }
            catch (e) {
                console.error(e);
                return res.status(500).send('DB Error');
            }
        }
    }
    else {
        return res.status(404).send();
    }
    res.status(207).send(xml);
}
async function handleReport(req, res, user) {
    const path = req.path;
    let calendarId = '1';
    let isLegacy = false;
    const calMatch = calendarCollectionMatch(path);
    const legacyMatch = path.match(/^\/([^\/]+)\/([^\/]+)\/$/);
    if (calMatch) {
        const cal = await (0, calendar_utils_1.getCalendarByToken)(user, calMatch[1]);
        if (!cal)
            return res.status(404).send();
        calendarId = cal.id.toString();
    }
    else if (legacyMatch) {
        isLegacy = true;
        try {
            const defaultCalendar = await (0, calendar_utils_1.ensureDefaultCalendar)(user);
            calendarId = defaultCalendar.id.toString();
        }
        catch (e) { }
    }
    else {
        return res.status(404).send();
    }
    try {
        if (!(await userOwnsCalendar(calendarId, user))) {
            return res.status(404).send();
        }
        const [events] = await db_1.pool.query('SELECT * FROM events WHERE calendar_id = ?', [calendarId]);
        const responses = events.map((ev) => `
  <D:response>
    <D:href>${isLegacy ? `/SOGo/dav/${user}/Calendar/` : `/caldav/calendars/${user}/${calendarId}/`}${ev.uid}.ics</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>"${ev.uid}"</D:getetag>
        <C:calendar-data><![CDATA[${ev.ical_data}]]></C:calendar-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`).join('');
        res.set('Content-Type', 'application/xml; charset=utf-8');
        const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  ${responses}
</D:multistatus>`;
        res.status(207).send(xml);
    }
    catch (e) {
        console.error(e);
        res.status(500).send();
    }
}
async function handlePut(req, res, user) {
    const path = req.path;
    let calendarId = '1';
    let uid = '';
    const calMatch = calendarEventMatch(path);
    const legacyMatch = path.match(/^\/([^\/]+)\/([^\/]+)\/([^\/]+)\.ics/);
    if (calMatch) {
        const cal = await (0, calendar_utils_1.getCalendarByToken)(user, calMatch[1]);
        if (!cal)
            return res.status(404).send();
        calendarId = cal.id.toString();
        uid = calMatch[2];
    }
    else if (legacyMatch) {
        uid = legacyMatch[3];
        try {
            const defaultCalendar = await (0, calendar_utils_1.ensureDefaultCalendar)(user);
            calendarId = defaultCalendar.id.toString();
        }
        catch (e) { }
    }
    else {
        return res.status(400).send();
    }
    const icalData = req.body ? req.body.toString('utf-8') : '';
    try {
        if (!(await userOwnsCalendar(calendarId, user))) {
            return res.status(404).send();
        }
        await db_1.pool.query(`INSERT INTO events (calendar_id, uid, ical_data) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE ical_data = ?`, [calendarId, uid, icalData, icalData]);
        await db_1.pool.query('UPDATE calendars SET sync_token = sync_token + 1 WHERE id = ?', [calendarId]);
        res.set('ETag', `"${uid}"`);
        res.status(201).send();
    }
    catch (e) {
        console.error(e);
        res.status(500).send();
    }
}
async function handleProppatch(req, res, user) {
    const path = req.path;
    let calendarId = '';
    let href = path.endsWith('/') ? path : `${path}/`;
    const calMatch = calendarCollectionMatch(path);
    const legacyMatch = path.match(/^\/([^\/]+)\/([^\/]+)\/?$/);
    if (calMatch) {
        const cal = await (0, calendar_utils_1.getCalendarByToken)(user, calMatch[1]);
        if (!cal)
            return res.status(404).send();
        calendarId = cal.id.toString();
        href = (0, calendar_utils_1.getCalendarHref)(user, cal);
    }
    else if (legacyMatch) {
        try {
            const defaultCalendar = await (0, calendar_utils_1.ensureDefaultCalendar)(user);
            calendarId = defaultCalendar.id.toString();
            href = `/SOGo/dav/${user}/${legacyMatch[2]}/`;
        }
        catch (e) {
            console.error(e);
            return res.status(500).send();
        }
    }
    if (!calendarId) {
        return res.status(404).send();
    }
    try {
        const rawBody = req.body ? req.body.toString('utf-8') : '';
        if (rawBody.trim()) {
            const parsed = await xml2js_1.default.parseStringPromise(rawBody, { explicitArray: false });
            const propertyupdate = parsed['D:propertyupdate'] || parsed['d:propertyupdate'] || parsed.propertyupdate;
            const set = propertyupdate?.['D:set'] || propertyupdate?.['d:set'] || propertyupdate?.set;
            const prop = set?.['D:prop'] || set?.['d:prop'] || set?.prop;
            const displayName = prop?.['D:displayname'] || prop?.['d:displayname'] || prop?.displayname;
            const calendarColor = prop?.['A:calendar-color'] || prop?.['a:calendar-color'] || prop?.['calendar-color'];
            if (typeof displayName === 'string' && displayName.trim()) {
                await db_1.pool.query('UPDATE calendars SET name = ?, sync_token = sync_token + 1 WHERE id = ? AND user_id = ?', [displayName.trim(), calendarId, user]);
            }
            if (typeof calendarColor === 'string' && /^#[0-9a-f]{6}$/i.test(calendarColor.trim())) {
                await db_1.pool.query('UPDATE calendars SET color = ?, sync_token = sync_token + 1 WHERE id = ? AND user_id = ?', [calendarColor.trim(), calendarId, user]);
            }
        }
        res.set('Content-Type', 'application/xml; charset=utf-8');
        const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>${href}</D:href>
    <D:propstat>
      <D:prop/>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
        return res.status(207).send(xml);
    }
    catch (e) {
        console.error(e);
        return res.status(400).send();
    }
}
async function handleMkcalendar(req, res, user) {
    const path = req.path;
    const calMatch = calendarCollectionMatch(path);
    if (!calMatch) {
        return res.status(409).send();
    }
    const requestedSlug = decodeURIComponent(calMatch[1]);
    const existing = await (0, calendar_utils_1.getCalendarByToken)(user, requestedSlug);
    if (existing) {
        return res.status(405).send();
    }
    try {
        const props = await readCalendarProperties(req, requestedSlug);
        const calendar = await (0, calendar_utils_1.createCalendar)(user, props.name, { slug: requestedSlug, color: props.color });
        res.set('Location', (0, calendar_utils_1.getCalendarHref)(user, calendar));
        res.status(201).send();
    }
    catch (e) {
        console.error(e);
        res.status(500).send();
    }
}
async function handleDelete(req, res, user) {
    const path = req.path;
    const eventMatch = calendarEventMatch(path);
    const collectionMatch = calendarCollectionMatch(path);
    if (collectionMatch) {
        const cal = await (0, calendar_utils_1.getCalendarByToken)(user, collectionMatch[1]);
        if (!cal)
            return res.status(404).send();
        try {
            await db_1.pool.query('DELETE FROM events WHERE calendar_id = ?', [cal.id]);
            await db_1.pool.query('DELETE FROM calendars WHERE id = ? AND user_id = ?', [cal.id, user]);
            await (0, calendar_utils_1.ensureDefaultCalendar)(user);
            return res.status(204).send();
        }
        catch (e) {
            console.error(e);
            return res.status(500).send();
        }
    }
    if (!eventMatch)
        return res.status(400).send();
    const cal = await (0, calendar_utils_1.getCalendarByToken)(user, eventMatch[1]);
    if (!cal)
        return res.status(404).send();
    const calendarId = cal.id.toString();
    const uid = eventMatch[2];
    try {
        if (!(await userOwnsCalendar(calendarId, user))) {
            return res.status(404).send();
        }
        await db_1.pool.query('DELETE FROM events WHERE calendar_id = ? AND uid = ?', [calendarId, uid]);
        await db_1.pool.query('UPDATE calendars SET sync_token = sync_token + 1 WHERE id = ?', [calendarId]);
        res.status(204).send();
    }
    catch (e) {
        console.error(e);
        res.status(500).send();
    }
}
exports.default = router;
//# sourceMappingURL=caldav.js.map