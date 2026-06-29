"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCalendarSubscriptionWorker = void 0;
const db_1 = require("./db");
let schemaPromise = null;
const ensureSubscriptionSchema = async () => {
    if (!schemaPromise) {
        schemaPromise = (async () => {
            const [cols] = await db_1.pool.query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'calendars'
                 AND COLUMN_NAME IN ('last_fetched_at', 'last_fetch_error')`);
            const names = new Set(cols.map((c) => c.COLUMN_NAME));
            if (!names.has('last_fetched_at')) {
                await db_1.pool.query('ALTER TABLE calendars ADD COLUMN last_fetched_at DATETIME NULL AFTER subscribed_url');
            }
            if (!names.has('last_fetch_error')) {
                await db_1.pool.query('ALTER TABLE calendars ADD COLUMN last_fetch_error TEXT NULL AFTER last_fetched_at');
            }
        })().then(() => undefined);
    }
    return schemaPromise;
};
const runSubscriptionFetcher = async () => {
    try {
        await ensureSubscriptionSchema();
        const [calendars] = await db_1.pool.query(`SELECT id, user_id, subscribed_url, last_fetched_at, last_fetch_error
             FROM calendars
             WHERE subscribed_url IS NOT NULL AND subscribed_url != ''
             AND (last_fetched_at IS NULL OR last_fetched_at < DATE_SUB(NOW(), INTERVAL 15 MINUTE))
             AND (last_fetch_error IS NULL OR last_fetched_at < DATE_SUB(NOW(), INTERVAL 1 HOUR))`);
        for (const cal of calendars) {
            try {
                const response = await fetch(cal.subscribed_url, { signal: AbortSignal.timeout(30000) });
                if (!response.ok)
                    throw new Error(`HTTP ${response.status}`);
                const icsData = await response.text();
                // Parse VEVENT blocks from the .ics data
                const veventRegex = /BEGIN:VEVENT[\s\S]*?END:VEVENT/gi;
                const matches = icsData.match(veventRegex) || [];
                for (const vevent of matches) {
                    const uidMatch = vevent.match(/^UID:(.+)$/im);
                    if (!uidMatch)
                        continue;
                    const uid = uidMatch[1].trim();
                    const icalData = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${vevent}\r\nEND:VCALENDAR`;
                    await db_1.pool.query(`INSERT INTO events (calendar_id, uid, ical_data)
                         VALUES (?, ?, ?)
                         ON DUPLICATE KEY UPDATE ical_data = VALUES(ical_data)`, [cal.id, uid, icalData]);
                }
                await db_1.pool.query('UPDATE calendars SET last_fetched_at = NOW(), last_fetch_error = NULL WHERE id = ?', [cal.id]);
                await db_1.pool.query('UPDATE calendars SET sync_token = sync_token + 1 WHERE id = ?', [cal.id]);
                console.log(`[CalendarSub] Synced ${matches.length} events to calendar ${cal.id} (${cal.subscribed_url})`);
            }
            catch (err) {
                console.error(`[CalendarSub] Failed to fetch ${cal.subscribed_url}:`, err.message);
                await db_1.pool.query('UPDATE calendars SET last_fetched_at = NOW(), last_fetch_error = ? WHERE id = ?', [err.message.substring(0, 500), cal.id]);
            }
        }
    }
    catch (err) {
        console.error('[CalendarSub] Subscription fetcher error:', err.message);
    }
};
const startCalendarSubscriptionWorker = () => {
    ensureSubscriptionSchema().catch(err => console.error('Failed to init calendar subscription schema:', err));
    // Check every 15 minutes
    setInterval(runSubscriptionFetcher, 15 * 60 * 1000);
    // Run once on startup after 1 minute
    setTimeout(runSubscriptionFetcher, 60 * 1000);
};
exports.startCalendarSubscriptionWorker = startCalendarSubscriptionWorker;
//# sourceMappingURL=calendar-subscription.js.map