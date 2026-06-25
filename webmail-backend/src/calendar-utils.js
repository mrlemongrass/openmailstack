"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.slugifyCalendarName = exports.parseIcalEvent = exports.getCalendarFolderSyncKey = exports.formatActiveSyncDate = exports.expandRecurringEvent = void 0;
exports.ensureCalendarSchema = ensureCalendarSchema;
exports.ensureCalendarSlug = ensureCalendarSlug;
exports.createCalendar = createCalendar;
exports.ensureDefaultCalendar = ensureDefaultCalendar;
exports.getCalendarByToken = getCalendarByToken;
exports.getVisibleCalendars = getVisibleCalendars;
exports.getCalendarHref = getCalendarHref;
const db_1 = require("./db");
const calendar_format_1 = require("./calendar-format");
var calendar_format_2 = require("./calendar-format");
Object.defineProperty(exports, "expandRecurringEvent", { enumerable: true, get: function () { return calendar_format_2.expandRecurringEvent; } });
Object.defineProperty(exports, "formatActiveSyncDate", { enumerable: true, get: function () { return calendar_format_2.formatActiveSyncDate; } });
Object.defineProperty(exports, "getCalendarFolderSyncKey", { enumerable: true, get: function () { return calendar_format_2.getCalendarFolderSyncKey; } });
Object.defineProperty(exports, "parseIcalEvent", { enumerable: true, get: function () { return calendar_format_2.parseIcalEvent; } });
Object.defineProperty(exports, "slugifyCalendarName", { enumerable: true, get: function () { return calendar_format_2.slugifyCalendarName; } });
let schemaPromise = null;
async function ensureCalendarSchema() {
    if (!schemaPromise) {
        schemaPromise = (async () => {
            const [slugColumn] = await db_1.pool.query("SHOW COLUMNS FROM calendars LIKE 'dav_slug'");
            if (slugColumn.length === 0) {
                await db_1.pool.query('ALTER TABLE calendars ADD COLUMN dav_slug VARCHAR(255) NULL AFTER name');
            }
            const [slugIndex] = await db_1.pool.query("SHOW INDEX FROM calendars WHERE Key_name = 'idx_calendars_user_dav_slug'");
            if (slugIndex.length === 0) {
                await db_1.pool.query('ALTER TABLE calendars ADD KEY idx_calendars_user_dav_slug (user_id, dav_slug)');
            }
            const [eventIndexes] = await db_1.pool.query('SHOW INDEX FROM events');
            const uniqueEventIndexes = new Map();
            for (const index of eventIndexes) {
                if (index.Non_unique !== 0)
                    continue;
                const columns = uniqueEventIndexes.get(index.Key_name) || [];
                columns[index.Seq_in_index - 1] = index.Column_name;
                uniqueEventIndexes.set(index.Key_name, columns);
            }
            const hasCalendarUidKey = Array.from(uniqueEventIndexes.values()).some(columns => (columns.length === 2 && columns[0] === 'calendar_id' && columns[1] === 'uid'));
            if (!hasCalendarUidKey) {
                const [duplicates] = await db_1.pool.query(`SELECT calendar_id, uid, COUNT(*) AS duplicate_count
                     FROM events
                     GROUP BY calendar_id, uid
                     HAVING duplicate_count > 1
                     LIMIT 1`);
                if (duplicates.length === 0) {
                    await db_1.pool.query('ALTER TABLE events ADD UNIQUE KEY uniq_events_calendar_uid (calendar_id, uid)');
                }
                else {
                    console.warn('Skipping uniq_events_calendar_uid creation until duplicate event UIDs are cleaned up');
                }
            }
            await backfillMissingCalendarSlugs();
        })();
    }
    return schemaPromise;
}
async function backfillMissingCalendarSlugs() {
    const [rows] = await db_1.pool.query('SELECT id, user_id, name, dav_slug FROM calendars ORDER BY user_id ASC, id ASC');
    const usedByUser = new Map();
    for (const row of rows) {
        if (!usedByUser.has(row.user_id)) {
            usedByUser.set(row.user_id, new Set());
        }
        if (row.dav_slug) {
            usedByUser.get(row.user_id)?.add(row.dav_slug);
        }
    }
    for (const row of rows) {
        if (row.dav_slug)
            continue;
        const used = usedByUser.get(row.user_id) || new Set();
        const base = (0, calendar_format_1.slugifyCalendarName)(row.name);
        let slug = base;
        let suffix = 2;
        while (used.has(slug)) {
            slug = `${base}-${suffix++}`;
        }
        await db_1.pool.query('UPDATE calendars SET dav_slug = ? WHERE id = ?', [slug, row.id]);
        used.add(slug);
        usedByUser.set(row.user_id, used);
    }
}
async function uniqueCalendarSlug(user, preferred, excludeCalendarId) {
    await ensureCalendarSchema();
    const base = (0, calendar_format_1.slugifyCalendarName)(preferred);
    let slug = base;
    let suffix = 2;
    while (true) {
        const params = [user, slug];
        let excludeClause = '';
        if (excludeCalendarId) {
            excludeClause = ' AND id <> ?';
            params.push(excludeCalendarId);
        }
        const [rows] = await db_1.pool.query(`SELECT id FROM calendars WHERE user_id = ? AND dav_slug = ?${excludeClause} LIMIT 1`, params);
        if (rows.length === 0)
            return slug;
        slug = `${base}-${suffix++}`;
    }
}
async function ensureCalendarSlug(calendar) {
    await ensureCalendarSchema();
    if (calendar.dav_slug)
        return calendar.dav_slug;
    const slug = await uniqueCalendarSlug(calendar.user_id, calendar.name, calendar.id);
    await db_1.pool.query('UPDATE calendars SET dav_slug = ? WHERE id = ?', [slug, calendar.id]);
    calendar.dav_slug = slug;
    return slug;
}
async function createCalendar(user, name, options = {}) {
    await ensureCalendarSchema();
    const cleanName = name.trim() || 'New Calendar';
    const slug = await uniqueCalendarSlug(user, options.slug || cleanName);
    const [result] = await db_1.pool.query('INSERT INTO calendars (user_id, name, dav_slug, color, sync_token) VALUES (?, ?, ?, ?, 1)', [user, cleanName, slug, options.color || '#3498db']);
    const [created] = await db_1.pool.query('SELECT * FROM calendars WHERE id = ?', [result.insertId]);
    return created[0];
}
async function ensureDefaultCalendar(user) {
    await ensureCalendarSchema();
    const [existing] = await db_1.pool.query('SELECT * FROM calendars WHERE user_id = ? ORDER BY id ASC LIMIT 1', [user]);
    if (existing.length > 0) {
        await ensureCalendarSlug(existing[0]);
        return existing[0];
    }
    return createCalendar(user, 'Personal', { slug: 'personal' });
}
async function getCalendarByToken(user, token) {
    await ensureCalendarSchema();
    const decodedToken = decodeURIComponent(token);
    if (/^\d+$/.test(decodedToken)) {
        const [rows] = await db_1.pool.query('SELECT * FROM calendars WHERE id = ? AND user_id = ? LIMIT 1', [decodedToken, user]);
        if (rows.length > 0)
            return rows[0];
    }
    const [rows] = await db_1.pool.query('SELECT * FROM calendars WHERE user_id = ? AND (dav_slug = ? OR name = ?) ORDER BY id ASC LIMIT 1', [user, (0, calendar_format_1.slugifyCalendarName)(decodedToken), decodedToken]);
    return rows.length > 0 ? rows[0] : null;
}
async function getVisibleCalendars(user) {
    await ensureCalendarSchema();
    await ensureDefaultCalendar(user);
    const [rows] = await db_1.pool.query(`SELECT c.*, COUNT(e.uid) AS event_count
         FROM calendars c
         LEFT JOIN events e ON e.calendar_id = c.id
         WHERE c.user_id = ?
         GROUP BY c.id
         ORDER BY c.id ASC`, [user]);
    let keptPersonal = false;
    const visible = rows.filter((cal) => {
        if (cal.name !== 'Personal')
            return true;
        if ((cal.event_count || 0) > 0)
            return true;
        if (!keptPersonal) {
            keptPersonal = true;
            return true;
        }
        return false;
    });
    for (const cal of visible) {
        await ensureCalendarSlug(cal);
    }
    return visible;
}
function getCalendarHref(user, calendar) {
    return `/caldav/calendars/${user}/${calendar.id}/`;
}
//# sourceMappingURL=calendar-utils.js.map