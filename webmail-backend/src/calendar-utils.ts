import { pool } from './db';
import { slugifyCalendarName } from './calendar-format';

export { expandRecurringEvent, formatActiveSyncDate, getCalendarFolderSyncKey, parseIcalEvent, slugifyCalendarName } from './calendar-format';

export interface CalendarRow {
    id: number;
    user_id: string;
    name: string;
    dav_slug?: string;
    components?: string;
    color?: string;
    sync_token?: number;
    event_count?: number;
    access_role?: string;
    subscribed_url?: string;
}

let schemaPromise: Promise<void> | null = null;

export async function ensureCalendarSchema(): Promise<void> {
    if (!schemaPromise) {
        schemaPromise = (async () => {
            const [slugColumn]: any = await pool.query("SHOW COLUMNS FROM calendars LIKE 'dav_slug'");
            if (slugColumn.length === 0) {
                await pool.query('ALTER TABLE calendars ADD COLUMN dav_slug VARCHAR(255) NULL AFTER name');
            }

            const [componentsColumn]: any = await pool.query("SHOW COLUMNS FROM calendars LIKE 'components'");
            if (componentsColumn.length === 0) {
                await pool.query("ALTER TABLE calendars ADD COLUMN components VARCHAR(255) NOT NULL DEFAULT 'VEVENT,VTODO' AFTER dav_slug");
            }

            const [subscribedUrlColumn]: any = await pool.query("SHOW COLUMNS FROM calendars LIKE 'subscribed_url'");
            if (subscribedUrlColumn.length === 0) {
                await pool.query('ALTER TABLE calendars ADD COLUMN subscribed_url TEXT NULL AFTER components');
            }

            const [slugIndex]: any = await pool.query("SHOW INDEX FROM calendars WHERE Key_name = 'idx_calendars_user_dav_slug'");
            if (slugIndex.length === 0) {
                await pool.query('ALTER TABLE calendars ADD KEY idx_calendars_user_dav_slug (user_id, dav_slug)');
            }

            const [eventIndexes]: any = await pool.query('SHOW INDEX FROM events');
            const uniqueEventIndexes = new Map<string, string[]>();
            for (const index of eventIndexes) {
                if (index.Non_unique !== 0) continue;
                const columns = uniqueEventIndexes.get(index.Key_name) || [];
                columns[index.Seq_in_index - 1] = index.Column_name;
                uniqueEventIndexes.set(index.Key_name, columns);
            }
            const hasCalendarUidKey = Array.from(uniqueEventIndexes.values()).some(columns => (
                columns.length === 2 && columns[0] === 'calendar_id' && columns[1] === 'uid'
            ));

            if (!hasCalendarUidKey) {
                const [duplicates]: any = await pool.query(
                    `SELECT calendar_id, uid, COUNT(*) AS duplicate_count
                     FROM events
                     GROUP BY calendar_id, uid
                     HAVING duplicate_count > 1
                     LIMIT 1`
                );
                if (duplicates.length === 0) {
                    await pool.query('ALTER TABLE events ADD UNIQUE KEY uniq_events_calendar_uid (calendar_id, uid)');
                } else {
                    console.warn('Skipping uniq_events_calendar_uid creation until duplicate event UIDs are cleaned up');
                }
            }

            await pool.query(`
                CREATE TABLE IF NOT EXISTS calendar_shares (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    calendar_id INT NOT NULL,
                    shared_with_user_id VARCHAR(255) NOT NULL,
                    permission ENUM('read', 'write') DEFAULT 'read',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY unique_share (calendar_id, shared_with_user_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            await backfillMissingCalendarSlugs();
        })();
    }

    return schemaPromise;
}

async function backfillMissingCalendarSlugs(): Promise<void> {
    const [rows]: any = await pool.query('SELECT id, user_id, name, dav_slug FROM calendars ORDER BY user_id ASC, id ASC');
    const usedByUser = new Map<string, Set<string>>();

    for (const row of rows) {
        if (!usedByUser.has(row.user_id)) {
            usedByUser.set(row.user_id, new Set());
        }
        if (row.dav_slug) {
            usedByUser.get(row.user_id)?.add(row.dav_slug);
        }
    }

    for (const row of rows) {
        if (row.dav_slug) continue;

        const used = usedByUser.get(row.user_id) || new Set<string>();
        const base = slugifyCalendarName(row.name);
        let slug = base;
        let suffix = 2;
        while (used.has(slug)) {
            slug = `${base}-${suffix++}`;
        }

        await pool.query('UPDATE calendars SET dav_slug = ? WHERE id = ?', [slug, row.id]);
        used.add(slug);
        usedByUser.set(row.user_id, used);
    }
}

async function uniqueCalendarSlug(user: string, preferred: string, excludeCalendarId?: number): Promise<string> {
    await ensureCalendarSchema();
    const base = slugifyCalendarName(preferred);
    let slug = base;
    let suffix = 2;

    while (true) {
        const params: any[] = [user, slug];
        let excludeClause = '';
        if (excludeCalendarId) {
            excludeClause = ' AND id <> ?';
            params.push(excludeCalendarId);
        }

        const [rows]: any = await pool.query(
            `SELECT id FROM calendars WHERE user_id = ? AND dav_slug = ?${excludeClause} LIMIT 1`,
            params
        );
        if (rows.length === 0) return slug;
        slug = `${base}-${suffix++}`;
    }
}

export async function ensureCalendarSlug(calendar: CalendarRow): Promise<string> {
    await ensureCalendarSchema();
    if (calendar.dav_slug) return calendar.dav_slug;

    const slug = await uniqueCalendarSlug(calendar.user_id, calendar.name, calendar.id);
    await pool.query('UPDATE calendars SET dav_slug = ? WHERE id = ?', [slug, calendar.id]);
    calendar.dav_slug = slug;
    return slug;
}

export async function createCalendar(user: string, name: string, options: { color?: string; slug?: string; components?: string; subscribed_url?: string } = {}): Promise<CalendarRow> {
    await ensureCalendarSchema();
    const cleanName = name.trim() || 'New Calendar';
    const slug = await uniqueCalendarSlug(user, options.slug || cleanName);
    const [result]: any = await pool.query(
        'INSERT INTO calendars (user_id, name, dav_slug, color, components, subscribed_url, sync_token) VALUES (?, ?, ?, ?, ?, ?, 1)',
        [user, cleanName, slug, options.color || '#3498db', options.components || 'VEVENT,VTODO', options.subscribed_url || null]
    );
    const [created]: any = await pool.query('SELECT * FROM calendars WHERE id = ?', [result.insertId]);
    return created[0];
}

export async function ensureDefaultCalendar(user: string): Promise<CalendarRow> {
    await ensureCalendarSchema();
    const [existing]: any = await pool.query(
        'SELECT * FROM calendars WHERE user_id = ? ORDER BY id ASC LIMIT 1',
        [user]
    );
    if (existing.length > 0) {
        await ensureCalendarSlug(existing[0]);
        return existing[0];
    }

    return createCalendar(user, 'Personal', { slug: 'personal' });
}

export async function getCalendarByToken(user: string, token: string): Promise<CalendarRow | null> {
    await ensureCalendarSchema();
    const decodedToken = decodeURIComponent(token);
    if (/^\d+$/.test(decodedToken)) {
        const [rows]: any = await pool.query('SELECT * FROM calendars WHERE id = ? AND user_id = ? LIMIT 1', [decodedToken, user]);
        if (rows.length > 0) return rows[0];
    }

    const [rows]: any = await pool.query(
        'SELECT * FROM calendars WHERE user_id = ? AND (dav_slug = ? OR name = ?) ORDER BY id ASC LIMIT 1',
        [user, slugifyCalendarName(decodedToken), decodedToken]
    );
    return rows.length > 0 ? rows[0] : null;
}

export async function getVisibleCalendars(user: string): Promise<CalendarRow[]> {
    await ensureCalendarSchema();
    await ensureDefaultCalendar(user);

    const [rows]: any = await pool.query(
        `SELECT c.*, COUNT(e.uid) AS event_count,
                (CASE WHEN c.user_id = ? THEN 'owner' ELSE cs.permission END) AS access_role
         FROM calendars c
         LEFT JOIN events e ON e.calendar_id = c.id
         LEFT JOIN calendar_shares cs ON cs.calendar_id = c.id AND cs.shared_with_user_id = ?
         WHERE c.user_id = ? OR cs.shared_with_user_id = ?
         GROUP BY c.id
         ORDER BY c.id ASC`,
        [user, user, user, user]
    );

    let keptPersonal = false;
    const visible = rows.filter((cal: CalendarRow) => {
        if (cal.name !== 'Personal') return true;
        if ((cal.event_count || 0) > 0) return true;
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

export function getCalendarHref(user: string, calendar: CalendarRow): string {
    return `/caldav/calendars/${user}/${calendar.id}/`;
}
