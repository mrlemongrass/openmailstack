"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const db_1 = require("./db");
const xml2js_1 = __importDefault(require("xml2js"));
const calendar_utils_1 = require("./calendar-utils");
const birthday_calendar_1 = require("./birthday-calendar");
const dav_auth_1 = require("./dav-auth");
const dav_etag_1 = require("./dav-etag");
const dav_report_1 = require("./dav-report");
const calendar_ical_validation_1 = require("./calendar-ical-validation");
const router = express_1.default.Router();
const CALDAV_ALLOWED_METHODS = [
    'OPTIONS', 'GET', 'HEAD', 'PUT', 'DELETE',
    'PROPFIND', 'PROPPATCH', 'MKCOL', 'MKCALENDAR', 'REPORT',
];
function encodeDavPathSegment(value) {
    return encodeURIComponent(String(value));
}
function decodeDavPathSegment(value) {
    try {
        return decodeURIComponent(value);
    }
    catch {
        return null;
    }
}
function isValidCalendarResourceName(value) {
    return Boolean(value)
        && !value.endsWith(' ')
        && !/[\x00-\x1f\x7f]/.test(value)
        && Array.from(value).length <= 255
        && Buffer.byteLength(value, 'utf8') <= 255 * 4;
}
function isAuthenticatedCalendarHome(path, user) {
    const match = path.match(/^\/calendars\/([^/]+)\/?$/);
    return Boolean(match && decodeDavPathSegment(match[1]) === user);
}
function sendInvalidCalendarResource(res, status = 403) {
    res.set('Content-Type', 'application/xml; charset=utf-8');
    return res.status(status).send('<?xml version="1.0" encoding="utf-8" ?>'
        + '<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">'
        + '<C:valid-calendar-object-resource/>'
        + '</D:error>');
}
function sendCalendarUidConflict(res, conflictingHref) {
    res.set('Content-Type', 'application/xml; charset=utf-8');
    return res.status(403).send('<?xml version="1.0" encoding="utf-8" ?>'
        + '<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">'
        + '<C:no-uid-conflict>'
        + (conflictingHref ? `<D:href>${escapeXml(conflictingHref)}</D:href>` : '')
        + '</C:no-uid-conflict>'
        + '</D:error>');
}
function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function escapeCdata(value) {
    return String(value ?? '').replace(/]]>/g, ']]]]><![CDATA[>');
}
function calendarEventResourceHref(hrefBase, uid) {
    return `${hrefBase}${encodeDavPathSegment(uid)}.ics`;
}
function calendarResourceName(event) {
    return String(event?.resource_name || event?.uid || '');
}
function isCalendarContentReadOnly(calendar) {
    return (0, birthday_calendar_1.isManagedBirthdayCalendar)(calendar) || Boolean(String(calendar?.subscribed_url || '').trim());
}
function isDuplicateEntry(error) {
    return Boolean(error && typeof error === 'object' && error.code === 'ER_DUP_ENTRY');
}
function weakEtagComparisonValue(value) {
    const trimmed = value.trim();
    return /^W\//i.test(trimmed) ? trimmed.slice(2).trim() : trimmed;
}
function emitCalendarUpdated(user, calendarId) {
    try {
        const { io } = require('./index');
        io.to(user).emit('calendar_updated', { calendarId });
    }
    catch { }
}
async function userHasCalendarAccess(calendarId, user, requireWrite = false) {
    const [rows] = await db_1.pool.query(`SELECT c.user_id, c.dav_slug, c.subscribed_url, cs.permission
         FROM calendars c 
         LEFT JOIN calendar_shares cs ON cs.calendar_id = c.id AND cs.shared_with_user_id = ?
         WHERE c.id = ?`, [user, calendarId]);
    if (rows.length === 0)
        return false;
    if (requireWrite && isCalendarContentReadOnly(rows[0]))
        return false;
    if (rows[0].user_id === user)
        return true;
    if (requireWrite)
        return rows[0].permission === 'write';
    return rows[0].permission === 'read' || rows[0].permission === 'write';
}
async function userHasCalendarAccessOnConnection(connection, calendarId, user, requireWrite = false) {
    const [rows] = await connection.query(`SELECT c.user_id, c.dav_slug, c.subscribed_url, cs.permission
         FROM calendars c
         LEFT JOIN calendar_shares cs ON cs.calendar_id = c.id AND cs.shared_with_user_id = ?
         WHERE c.id = ?
         FOR UPDATE`, [user, calendarId]);
    if (rows.length === 0)
        return false;
    if (requireWrite && isCalendarContentReadOnly(rows[0]))
        return false;
    if (rows[0].user_id === user)
        return true;
    if (requireWrite)
        return rows[0].permission === 'write';
    return rows[0].permission === 'read' || rows[0].permission === 'write';
}
function requestPreconditionFailed(req, currentEtag) {
    const ifMatch = req.get('if-match');
    if (ifMatch) {
        if (ifMatch === '*') {
            if (!currentEtag)
                return true;
        }
        else if (!currentEtag || !ifMatch.split(',').map(value => value.trim()).includes(currentEtag)) {
            return true;
        }
    }
    const ifNoneMatch = req.get('if-none-match');
    if (ifNoneMatch) {
        if (ifNoneMatch === '*')
            return Boolean(currentEtag);
        if (currentEtag) {
            const comparableCurrentEtag = weakEtagComparisonValue(currentEtag);
            if (ifNoneMatch.split(',').some(value => weakEtagComparisonValue(value) === comparableCurrentEtag)) {
                return true;
            }
        }
    }
    return false;
}
function calendarSyncToken(calendar, revision = Number(calendar?.sync_token || 0)) {
    const calendarId = Number(calendar?.id);
    if (!Number.isSafeInteger(calendarId) || calendarId <= 0
        || !Number.isSafeInteger(revision) || revision < 0) {
        throw new Error('Calendar sync identity is invalid');
    }
    return `http://sabre.io/ns/sync/calendar/v2/${calendarId}/${revision}`;
}
function calendarSyncTokenRevision(token, calendar) {
    const match = token.match(/^http:\/\/sabre\.io\/ns\/sync\/calendar\/v2\/([1-9]\d*)\/(0|[1-9]\d*)$/);
    if (!match || match[1] !== String(calendar?.id))
        return null;
    const revision = Number(match[2]);
    return Number.isSafeInteger(revision) ? revision : null;
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
        return { name: fallbackName, color: undefined, components: undefined };
    }
    try {
        const parsed = await xml2js_1.default.parseStringPromise(rawBody, { explicitArray: false });
        const mkcalendar = parsed['C:mkcalendar'] || parsed['c:mkcalendar'] || parsed.mkcalendar || parsed['D:mkcol'] || parsed['d:mkcol'] || parsed.mkcol;
        const set = mkcalendar?.['D:set'] || mkcalendar?.['d:set'] || mkcalendar?.set;
        const prop = set?.['D:prop'] || set?.['d:prop'] || set?.prop || parsed?.['D:prop'] || parsed?.['d:prop'] || parsed?.prop;
        const displayName = firstPropertyValue(prop, ['D:displayname', 'd:displayname', 'displayname']);
        const calendarColor = firstPropertyValue(prop, ['A:calendar-color', 'a:calendar-color', 'calendar-color']);
        let components;
        const compSet = prop?.['C:supported-calendar-component-set'] || prop?.['c:supported-calendar-component-set'];
        if (compSet) {
            const comp = compSet['C:comp'] || compSet['c:comp'] || compSet.comp;
            const compArray = Array.isArray(comp) ? comp : [comp];
            const names = compArray.map((c) => c?.$?.name).filter(Boolean);
            if (names.length > 0) {
                components = names.join(',');
            }
        }
        return {
            name: displayName.trim() || fallbackName,
            color: /^#[0-9a-f]{6}$/i.test(calendarColor.trim()) ? calendarColor.trim() : undefined,
            components
        };
    }
    catch {
        return { name: fallbackName, color: undefined, components: undefined };
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
        res.set('Allow', CALDAV_ALLOWED_METHODS.join(', '));
        res.set('DAV', '1, calendar-access, extended-mkcol');
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
    if (method === 'GET' || method === 'HEAD') {
        return handleGet(req, res, user, method === 'HEAD');
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
    <D:href>${escapeXml(req.originalUrl)}</D:href>
    <D:propstat>
      <D:prop>
        <D:current-user-principal><D:href>/caldav/principals/${encodeDavPathSegment(user)}/</D:href></D:current-user-principal>
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
    <D:href>/caldav/principals/${encodeDavPathSegment(user)}/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:principal/></D:resourcetype>
        <C:calendar-home-set><D:href>/caldav/calendars/${encodeDavPathSegment(user)}/</D:href></C:calendar-home-set>
        <C:calendar-user-address-set><D:href>${escapeXml(`mailto:${user}`)}</D:href></C:calendar-user-address-set>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
    }
    else if (isAuthenticatedCalendarHome(path, user)) {
        // List all calendars
        try {
            const rows = await (0, calendar_utils_1.getVisibleCalendars)(user);
            let responses = rows.map((cal) => `
  <D:response>
    <D:href>${escapeXml((0, calendar_utils_1.getCalendarHref)(user, cal))}</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
        <D:displayname>${escapeXml(cal.name)}</D:displayname>
        <CS:getctag>"${cal.sync_token}"</CS:getctag>
        <D:sync-token>${calendarSyncToken(cal)}</D:sync-token>
        <C:supported-calendar-component-set>
          ${(cal.components || 'VEVENT,VTODO').split(',').map((c) => `<C:comp name="${escapeXml(c.trim())}"/>`).join('\\n          ')}
        </C:supported-calendar-component-set>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`).join('');
            const homeSetCtag = rows.reduce((acc, cal) => acc + (cal.sync_token || 0), 0) + rows.length;
            xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">
  <D:response>
    <D:href>/caldav/calendars/${encodeDavPathSegment(user)}/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/></D:resourcetype>
        <CS:getctag>"${homeSetCtag}"</CS:getctag>
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
    else if (path.includes('/calendars/') || path.match(/\/[^\/]+\/[^\/]+\/$/)) {
        // Match /caldav/calendars/user/1/ after the /caldav mount, or legacy /user/Calendar/.
        let calendarId = '1';
        let isLegacy = false;
        const calMatch = calendarCollectionMatch(path);
        const legacyMatch = path.match(/^\/([^\/]+)\/Calendar\/?$/i);
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
                    const eventHrefBase = isLegacy
                        ? `/SOGo/dav/${encodeDavPathSegment(user)}/Calendar/`
                        : (0, calendar_utils_1.getCalendarHref)(user, cal);
                    eventResponses = events.map((ev) => `
  <D:response>
    <D:href>${escapeXml(calendarEventResourceHref(eventHrefBase, calendarResourceName(ev)))}</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>${escapeXml((0, dav_etag_1.calendarEventEtag)(ev))}</D:getetag>
        <D:getcontenttype>text/calendar; charset=utf-8</D:getcontenttype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`).join('');
                }
                xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/">
  <D:response>
    <D:href>${isLegacy
                    ? `/SOGo/dav/${encodeDavPathSegment(user)}/Calendar/`
                    : escapeXml((0, calendar_utils_1.getCalendarHref)(user, cal))}</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
        <D:displayname>${escapeXml(cal.name)}</D:displayname>
        <CS:getctag>"${cal.sync_token}"</CS:getctag>
        <D:sync-token>${calendarSyncToken(cal)}</D:sync-token>
        <C:supported-calendar-component-set>
          ${(cal.components || 'VEVENT,VTODO').split(',').map((c) => `<C:comp name="${escapeXml(c.trim())}"/>`).join('\\n          ')}
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
    let cal = null;
    const calMatch = calendarCollectionMatch(path);
    const legacyMatch = path.match(/^\/([^\/]+)\/([^\/]+)\/$/);
    if (calMatch) {
        cal = await (0, calendar_utils_1.getCalendarByToken)(user, calMatch[1]);
        if (!cal)
            return res.status(404).send();
        calendarId = cal.id.toString();
    }
    else if (legacyMatch) {
        isLegacy = true;
        try {
            cal = await (0, calendar_utils_1.ensureDefaultCalendar)(user);
            calendarId = cal.id.toString();
        }
        catch (e) { }
    }
    else {
        return res.status(404).send();
    }
    try {
        if (!(await userHasCalendarAccess(calendarId, user))) {
            return res.status(404).send();
        }
        // Parse REPORT body to detect sync-collection vs calendar-query
        const body = req.body || '';
        const bodyStr = typeof body === 'string' ? body : (body instanceof Buffer ? body.toString('utf8') : '');
        const isSyncCollection = (0, dav_report_1.isSyncCollectionReport)(bodyStr);
        const requestedToken = (0, dav_report_1.syncTokenFromReportBody)(bodyStr);
        // Build the base href for this calendar
        const hrefBase = isLegacy
            ? `/SOGo/dav/${encodeDavPathSegment(user)}/Calendar/`
            : (0, calendar_utils_1.getCalendarHref)(user, cal);
        let events;
        let tombstones = [];
        if (isSyncCollection && requestedToken && cal) {
            // Incremental sync: parse requested token, return only changes
            const tokenNum = calendarSyncTokenRevision(requestedToken, cal);
            const currentToken = cal.sync_token || 0;
            if (tokenNum === null || tokenNum > currentToken) {
                res.set('Content-Type', 'application/xml; charset=utf-8');
                return res.status(403).send('<?xml version="1.0" encoding="utf-8" ?>'
                    + '<D:error xmlns:D="DAV:"><D:valid-sync-token/></D:error>');
            }
            if (tokenNum >= currentToken) {
                // No changes since last sync — return empty multistatus with updated token
                events = [];
            }
            else {
                const [changedRows] = await db_1.pool.query(`SELECT uid, resource_name, ical_data, updated_at, sync_token, 0 AS deleted
                     FROM events
                     WHERE calendar_id = ? AND sync_token > ?
                     UNION ALL
                     SELECT uid, resource_name, NULL AS ical_data, deleted_at AS updated_at, sync_token, 1 AS deleted
                     FROM calendar_tombstones
                     WHERE calendar_id = ? AND sync_token > ?
                     ORDER BY sync_token ASC, resource_name ASC`, [calendarId, tokenNum, calendarId, tokenNum]);
                // Migration cleanup and the unique tombstone key should make
                // this map a no-op. Keeping the newest state here also makes a
                // REPORT deterministic across legacy rows.
                const latestByResourceName = new Map();
                for (const row of changedRows) {
                    const resourceName = calendarResourceName(row);
                    const previous = latestByResourceName.get(resourceName);
                    if (!previous
                        || Number(row.sync_token) > Number(previous.sync_token)
                        || (Number(row.sync_token) === Number(previous.sync_token) && !Number(row.deleted))) {
                        latestByResourceName.set(resourceName, row);
                    }
                }
                const latestRows = Array.from(latestByResourceName.values());
                events = latestRows.filter(row => !Number(row.deleted));
                tombstones = latestRows.filter(row => Number(row.deleted));
            }
        }
        else {
            // Full sync (calendar-query or no sync-token)
            events = (await db_1.pool.query('SELECT * FROM events WHERE calendar_id = ?', [calendarId]))[0];
        }
        let containsInvalidStoredResource = false;
        const eventResponses = events.map((ev) => {
            try {
                (0, calendar_ical_validation_1.validateICalendarDocument)(String(ev.ical_data || ''));
            }
            catch (error) {
                if (!(error instanceof calendar_ical_validation_1.ICalendarValidationError))
                    throw error;
                containsInvalidStoredResource = true;
                return `
  <D:response>
    <D:href>${escapeXml(calendarEventResourceHref(hrefBase, calendarResourceName(ev)))}</D:href>
    <D:status>HTTP/1.1 500 Internal Server Error</D:status>
  </D:response>`;
            }
            return `
  <D:response>
    <D:href>${escapeXml(calendarEventResourceHref(hrefBase, calendarResourceName(ev)))}</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>${escapeXml((0, dav_etag_1.calendarEventEtag)(ev))}</D:getetag>
        <C:calendar-data><![CDATA[${escapeCdata(ev.ical_data)}]]></C:calendar-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
        }).join('');
        const tombstoneResponses = tombstones.map((t) => `
  <D:response>
    <D:href>${escapeXml(calendarEventResourceHref(hrefBase, calendarResourceName(t)))}</D:href>
    <D:status>HTTP/1.1 404 Not Found</D:status>
  </D:response>`).join('');
        res.set('Content-Type', 'application/xml; charset=utf-8');
        // Do not let a client advance beyond a resource that could not be
        // represented safely in XML. The resource-level error remains valid
        // XML and the missing token forces a retry after storage is repaired.
        const syncTokenXml = cal && !containsInvalidStoredResource
            ? `\n  <D:sync-token>${calendarSyncToken(cal)}</D:sync-token>`
            : '';
        const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${syncTokenXml}
  ${eventResponses}${tombstoneResponses}
</D:multistatus>`;
        res.status(207).send(xml);
    }
    catch (e) {
        console.error(e);
        res.status(500).send();
    }
}
async function handleGet(req, res, user, headOnly = false) {
    const path = req.path;
    const eventMatch = calendarEventMatch(path);
    if (!eventMatch)
        return res.status(404).send();
    const cal = await (0, calendar_utils_1.getCalendarByToken)(user, eventMatch[1]);
    if (!cal)
        return res.status(404).send();
    const calendarId = cal.id.toString();
    const resourceName = decodeDavPathSegment(eventMatch[2]);
    if (resourceName === null || !isValidCalendarResourceName(resourceName))
        return res.status(400).send();
    try {
        if (!(await userHasCalendarAccess(calendarId, user))) {
            return res.status(404).send();
        }
        const [events] = await db_1.pool.query(`SELECT * FROM events
             WHERE calendar_id = ? AND BINARY COALESCE(NULLIF(resource_name, ''), uid) = BINARY ?
             LIMIT 1`, [calendarId, resourceName]);
        if (events.length === 0)
            return res.status(404).send();
        res.set('Content-Type', 'text/calendar; charset=utf-8');
        res.set('ETag', (0, dav_etag_1.calendarEventEtag)(events[0]));
        if (headOnly)
            return res.status(200).send();
        res.status(200).send(events[0].ical_data);
    }
    catch (e) {
        console.error(e);
        res.status(500).send();
    }
}
async function handlePut(req, res, user) {
    const path = req.path;
    let calendarId = '1';
    let resourceName = '';
    let logicalUid = '';
    let targetCalendar = null;
    const calMatch = calendarEventMatch(path);
    const legacyMatch = path.match(/^\/([^\/]+)\/([^\/]+)\/([^\/]+)\.ics/);
    if (calMatch) {
        const cal = await (0, calendar_utils_1.getCalendarByToken)(user, calMatch[1]);
        if (!cal)
            return res.status(404).send();
        if (isCalendarContentReadOnly(cal) || cal.access_role === 'read')
            return res.status(403).send();
        targetCalendar = cal;
        calendarId = cal.id.toString();
        const decodedResourceName = decodeDavPathSegment(calMatch[2]);
        if (decodedResourceName === null || !isValidCalendarResourceName(decodedResourceName)) {
            return res.status(400).send();
        }
        resourceName = decodedResourceName;
    }
    else if (legacyMatch) {
        const decodedResourceName = decodeDavPathSegment(legacyMatch[3]);
        if (decodedResourceName === null || !isValidCalendarResourceName(decodedResourceName)) {
            return res.status(400).send();
        }
        resourceName = decodedResourceName;
        try {
            const defaultCalendar = await (0, calendar_utils_1.ensureDefaultCalendar)(user);
            if (isCalendarContentReadOnly(defaultCalendar))
                return res.status(403).send();
            targetCalendar = defaultCalendar;
            calendarId = defaultCalendar.id.toString();
        }
        catch (e) { }
    }
    else {
        return res.status(400).send();
    }
    const icalData = req.body ? req.body.toString('utf-8') : '';
    try {
        const validated = (0, calendar_ical_validation_1.validateICalendarDocument)(icalData);
        if (validated.resources.length !== 1)
            return sendInvalidCalendarResource(res);
        const resource = validated.resources[0];
        logicalUid = resource.uid;
        const supportedComponents = new Set(String(targetCalendar?.components || 'VEVENT,VTODO')
            .split(',')
            .map((component) => component.trim().toUpperCase())
            .filter(Boolean));
        if (!supportedComponents.has(resource.componentType))
            return sendInvalidCalendarResource(res);
    }
    catch (error) {
        if (error instanceof calendar_ical_validation_1.ICalendarValidationError)
            return sendInvalidCalendarResource(res);
        throw error;
    }
    const connection = await db_1.pool.getConnection();
    try {
        await connection.beginTransaction();
        if (!(await userHasCalendarAccessOnConnection(connection, calendarId, user, true))) {
            await connection.rollback();
            return res.status(403).send();
        }
        const [existingEvents] = await connection.query(`SELECT uid, resource_name, ical_data, updated_at, sync_token
             FROM events
             WHERE calendar_id = ? AND BINARY COALESCE(NULLIF(resource_name, ''), uid) = BINARY ?
             LIMIT 1 FOR UPDATE`, [calendarId, resourceName]);
        const existingEvent = existingEvents[0];
        const currentEtag = existingEvent ? (0, dav_etag_1.calendarEventEtag)(existingEvent) : null;
        if (requestPreconditionFailed(req, currentEtag)) {
            await connection.rollback();
            return res.status(412).send();
        }
        const [uidConflicts] = await connection.query(`SELECT resource_name, uid
             FROM events
             WHERE calendar_id = ? AND BINARY uid = BINARY ?
               AND BINARY COALESCE(NULLIF(resource_name, ''), uid) <> BINARY ?
             LIMIT 1 FOR UPDATE`, [calendarId, logicalUid, resourceName]);
        if (uidConflicts.length > 0) {
            await connection.rollback();
            return sendCalendarUidConflict(res, calendarEventResourceHref((0, calendar_utils_1.getCalendarHref)(user, targetCalendar), calendarResourceName(uidConflicts[0])));
        }
        const bodyChanged = !existingEvent
            || String(existingEvent.uid || '') !== logicalUid
            || String(existingEvent.ical_data || '') !== icalData;
        const [tombstoneResult] = await connection.query(`DELETE FROM calendar_tombstones
             WHERE calendar_id = ? AND BINARY COALESCE(NULLIF(resource_name, ''), uid) = BINARY ?`, [calendarId, resourceName]);
        const tombstoneCleared = Number(tombstoneResult.affectedRows || 0) > 0;
        if (!bodyChanged && !tombstoneCleared) {
            await connection.rollback();
            res.set('ETag', currentEtag);
            return res.status(204).send();
        }
        const revision = await (0, calendar_utils_1.allocateCalendarCollectionRevisionOnConnection)(connection, calendarId);
        if (existingEvent) {
            await connection.query(`UPDATE events SET uid = ?, resource_name = ?, ical_data = ?, sync_token = ?
                 WHERE calendar_id = ? AND BINARY COALESCE(NULLIF(resource_name, ''), uid) = BINARY ?`, [logicalUid, resourceName, icalData, revision, calendarId, resourceName]);
        }
        else {
            await connection.query(`INSERT INTO events (calendar_id, uid, resource_name, ical_data, sync_token)
                 VALUES (?, ?, ?, ?, ?)`, [calendarId, logicalUid, resourceName, icalData, revision]);
        }
        const [savedEvents] = await connection.query(`SELECT uid, resource_name, ical_data, updated_at, sync_token
             FROM events
             WHERE calendar_id = ? AND BINARY COALESCE(NULLIF(resource_name, ''), uid) = BINARY ?
             LIMIT 1`, [calendarId, resourceName]);
        await connection.commit();
        emitCalendarUpdated(user, calendarId);
        res.set('ETag', (0, dav_etag_1.calendarEventEtag)(savedEvents[0] || { uid: logicalUid, ical_data: icalData }));
        return res.status(existingEvent ? 204 : 201).send();
    }
    catch (e) {
        await connection.rollback();
        if (isDuplicateEntry(e))
            return sendCalendarUidConflict(res);
        console.error(e);
        return res.status(500).send();
    }
    finally {
        connection.release();
    }
}
async function handleProppatch(req, res, user) {
    const path = req.path;
    let calendarId = '';
    let targetCalendar = null;
    let href = path.endsWith('/') ? path : `${path}/`;
    const calMatch = calendarCollectionMatch(path);
    const legacyMatch = path.match(/^\/([^\/]+)\/([^\/]+)\/?$/);
    if (calMatch) {
        const cal = await (0, calendar_utils_1.getCalendarByToken)(user, calMatch[1]);
        if (!cal)
            return res.status(404).send();
        if ((0, birthday_calendar_1.isManagedBirthdayCalendar)(cal))
            return res.status(403).send();
        if (cal.access_role && cal.access_role !== 'owner')
            return res.status(403).send();
        targetCalendar = cal;
        calendarId = cal.id.toString();
        href = (0, calendar_utils_1.getCalendarHref)(user, cal);
    }
    else if (legacyMatch) {
        try {
            const defaultCalendar = await (0, calendar_utils_1.ensureDefaultCalendar)(user);
            if ((0, birthday_calendar_1.isManagedBirthdayCalendar)(defaultCalendar))
                return res.status(403).send();
            targetCalendar = defaultCalendar;
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
    if (targetCalendar?.user_id !== user)
        return res.status(403).send();
    try {
        const rawBody = req.body ? req.body.toString('utf-8') : '';
        let changed = false;
        if (rawBody.trim()) {
            const parsed = await xml2js_1.default.parseStringPromise(rawBody, { explicitArray: false });
            const propertyupdate = parsed['D:propertyupdate'] || parsed['d:propertyupdate'] || parsed.propertyupdate;
            const set = propertyupdate?.['D:set'] || propertyupdate?.['d:set'] || propertyupdate?.set;
            const prop = set?.['D:prop'] || set?.['d:prop'] || set?.prop;
            const displayName = prop?.['D:displayname'] || prop?.['d:displayname'] || prop?.displayname;
            const calendarColor = prop?.['A:calendar-color'] || prop?.['a:calendar-color'] || prop?.['calendar-color'];
            if (typeof displayName === 'string' && displayName.trim()) {
                await db_1.pool.query('UPDATE calendars SET name = ?, sync_token = sync_token + 1 WHERE id = ? AND user_id = ?', [displayName.trim(), calendarId, user]);
                changed = true;
            }
            if (typeof calendarColor === 'string' && /^#[0-9a-f]{6}$/i.test(calendarColor.trim())) {
                await db_1.pool.query('UPDATE calendars SET color = ?, sync_token = sync_token + 1 WHERE id = ? AND user_id = ?', [calendarColor.trim(), calendarId, user]);
                changed = true;
            }
        }
        if (changed) {
            emitCalendarUpdated(user, calendarId);
        }
        res.set('Content-Type', 'application/xml; charset=utf-8');
        const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>${escapeXml(href)}</D:href>
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
    const requestedSlug = decodeDavPathSegment(calMatch[1]);
    if (requestedSlug === null)
        return res.status(400).send();
    if ((0, calendar_utils_1.isReservedManagedCalendarSlug)(requestedSlug))
        return res.status(403).send();
    const existing = await (0, calendar_utils_1.getCalendarByToken)(user, requestedSlug);
    if (existing) {
        return res.status(405).send();
    }
    try {
        const props = await readCalendarProperties(req, requestedSlug);
        const calendar = await (0, calendar_utils_1.createCalendar)(user, props.name, { slug: requestedSlug, color: props.color, components: props.components });
        emitCalendarUpdated(user, calendar.id);
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
        if ((0, birthday_calendar_1.isManagedBirthdayCalendar)(cal))
            return res.status(403).send();
        const connection = await db_1.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [calendarRows] = await connection.query('SELECT user_id FROM calendars WHERE id = ? AND user_id = ? LIMIT 1 FOR UPDATE', [cal.id, user]);
            if (calendarRows.length !== 1) {
                await connection.rollback();
                return res.status(404).send();
            }
            await connection.query('DELETE FROM events WHERE calendar_id = ?', [cal.id]);
            await connection.query('DELETE FROM calendar_tombstones WHERE calendar_id = ?', [cal.id]);
            await connection.query('DELETE FROM calendar_shares WHERE calendar_id = ?', [cal.id]);
            const [deleteResult] = await connection.query('DELETE FROM calendars WHERE id = ? AND user_id = ?', [cal.id, user]);
            if (Number(deleteResult.affectedRows || 0) !== 1) {
                throw new Error('Calendar disappeared during collection deletion');
            }
            await connection.commit();
        }
        catch (e) {
            await connection.rollback();
            console.error(e);
            return res.status(500).send();
        }
        finally {
            connection.release();
        }
        try {
            await (0, calendar_utils_1.ensureDefaultCalendar)(user);
        }
        catch (e) {
            console.error('Failed to ensure a default calendar after collection deletion', e);
        }
        emitCalendarUpdated(user, cal.id);
        return res.status(204).send();
    }
    if (!eventMatch)
        return res.status(400).send();
    const cal = await (0, calendar_utils_1.getCalendarByToken)(user, eventMatch[1]);
    if (!cal)
        return res.status(404).send();
    if (isCalendarContentReadOnly(cal) || cal.access_role === 'read')
        return res.status(403).send();
    const calendarId = cal.id.toString();
    const resourceName = decodeDavPathSegment(eventMatch[2]);
    if (resourceName === null || !isValidCalendarResourceName(resourceName))
        return res.status(400).send();
    const connection = await db_1.pool.getConnection();
    try {
        await connection.beginTransaction();
        if (!(await userHasCalendarAccessOnConnection(connection, calendarId, user, true))) {
            await connection.rollback();
            return res.status(403).send();
        }
        const [eventRows] = await connection.query(`SELECT uid, resource_name, ical_data, updated_at, sync_token
             FROM events
             WHERE calendar_id = ? AND BINARY COALESCE(NULLIF(resource_name, ''), uid) = BINARY ?
             LIMIT 1 FOR UPDATE`, [calendarId, resourceName]);
        const event = eventRows[0];
        const currentEtag = event ? (0, dav_etag_1.calendarEventEtag)(event) : null;
        if (requestPreconditionFailed(req, currentEtag)) {
            await connection.rollback();
            return res.status(412).send();
        }
        if (!event) {
            await connection.rollback();
            return res.status(404).send();
        }
        const revision = await (0, calendar_utils_1.allocateCalendarCollectionRevisionOnConnection)(connection, calendarId);
        await connection.query(`DELETE FROM events
             WHERE calendar_id = ? AND BINARY COALESCE(NULLIF(resource_name, ''), uid) = BINARY ?`, [calendarId, resourceName]);
        await connection.query(`INSERT INTO calendar_tombstones (calendar_id, uid, resource_name, sync_token, deleted_at)
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON DUPLICATE KEY UPDATE uid = VALUES(uid), sync_token = VALUES(sync_token), deleted_at = CURRENT_TIMESTAMP`, [calendarId, event.uid, resourceName, revision]);
        await connection.commit();
        emitCalendarUpdated(user, calendarId);
        return res.status(204).send();
    }
    catch (e) {
        await connection.rollback();
        console.error(e);
        return res.status(500).send();
    }
    finally {
        connection.release();
    }
}
exports.default = router;
//# sourceMappingURL=caldav.js.map