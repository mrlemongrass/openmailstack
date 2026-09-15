import crypto from 'crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { pool } from './db';
import { requireSession } from './auth';
import { schedulerConfig } from './config';
import { ImapService } from './imap';
import { ensureAccountOwnedTable } from './account-owned-schema';

export async function ensureUserActivitySchema() {
    await pool.query(`CREATE TABLE IF NOT EXISTS user_activity (
        id CHAR(36) PRIMARY KEY, owner VARCHAR(255) NOT NULL,
        area VARCHAR(16) NOT NULL, action VARCHAR(64) NOT NULL,
        state VARCHAR(24) NOT NULL, recovery_path VARCHAR(128) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY user_activity_owner (owner, created_at)
    )`);
    await ensureAccountOwnedTable('user_activity');
}

export function activityOutcome(body: any, status: number, action: string, closed = false) {
    const workflowState = body?.deliveryStatus || body?.job?.state || body?.state;
    if (closed || ['uncertain', 'partial', 'needs_review', 'unknown'].includes(workflowState)) return 'uncertain';
    if (body?.success === false || status >= 400 || ['failed', 'error'].includes(workflowState)) return 'failed';
    if (action === 'Send request' || status === 202 || ['ready', 'running', 'pending', 'scheduled', 'queued'].includes(workflowState)) return 'accepted';
    return 'completed';
}

// Only fixed labels and fixed recovery routes are persisted. Never record payloads,
// URLs, subjects, recipients, note titles, tokens, or server error messages.
export function activityDescriptor(method: string, path: string) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return null;
    const definitions: [RegExp, string, string, string][] = [
        [/^\/messages\/(action|selection\/[^/]+\/apply)$/, 'Mail', 'Message action', '/mail/inbox'],
        [/^\/folders\/(empty|mark-read)$/, 'Mail', 'Folder action', '/mail/inbox'],
        [/^\/messages\/send$/, 'Mail', 'Send request', '/mail/Scheduled'],
        [/^\/messages\/draft$|^\/drafts(?:\/[^/]+)?$/, 'Mail', 'Draft change', '/mail/Drafts'],
        [/^\/mail-import(?:\/[^/]+(?:\/run)?)?$/, 'Mail', 'Mail import', '/settings/mail_import'],
        [/^\/retention\/(enable|disable)$/, 'Mail', 'Cleanup schedule', '/settings/mail_cleanup'],
        [/^\/rules(?:\/one|\/sender-policy(?:\/[^/]+)?|\/run)?$/, 'Mail', 'Rule request', '/settings/mail_filters'],
        [/^\/(?:apps\/)?notes(?:\/[^/]+(?:\/restore|\/permanent|\/reminder|\/attachments(?:\/[^/]+)?)?)?$/, 'Notes', 'Note change', '/notes'],
        [/^\/apps\/contacts(?:\/[^/]+(?:\/restore|\/permanent|\/favorite|\/share)?)?$|^\/apps\/contacts-(?:import|merge)$|^\/apps\/contact-(?:labels|groups)(?:\/[^/]+){0,3}$/, 'Contacts', 'Contact change', '/contacts'],
        [/^\/apps\/(?:calendars|events)(?:\/[^/]+){0,3}$|^\/apps\/calendar-invitations\/retry$/, 'Calendar', 'Calendar request', '/calendar'],
        [/^\/scheduler\/v1\/(?:event-types|profile|availability|bookings|workflows)(?:\/[^/]+){0,3}$/, 'Scheduler', 'Scheduler request', '/scheduler-app'],
        [/^\/settings\/(?:mail|calendar|contacts)$/, 'Settings', 'Settings change', '/settings'],
    ];
    const match = definitions.find(([pattern]) => pattern.test(path));
    return match ? { area: match[1], action: match[2], recoveryPath: match[3] } : null;
}

export function observeUserActivity(req: Request, res: Response, next: NextFunction) {
    const descriptor = activityDescriptor(req.method, req.path);
    if (!descriptor) return next();
    requireSession(req, res, () => {
        void (async () => {
            const owner = (req as any).user.username;
            const id = crypto.randomUUID();
            try {
                await pool.query("INSERT INTO user_activity (id, owner, area, action, state, recovery_path) VALUES (?, ?, ?, ?, 'pending', ?)", [id, owner, descriptor.area, descriptor.action, descriptor.recoveryPath]);
            } catch {
                // History must not break a save/send; the History page reports its own availability.
                return next();
            }
            let result: unknown;
            const json = res.json.bind(res);
            res.json = (body: any) => {
                result = { deliveryStatus: ['uncertain', 'failed', 'partial', 'sent', 'queued'].includes(body?.deliveryStatus) ? body.deliveryStatus : undefined, success: body?.success, state: body?.state, job: body?.job ? { state: body.job.state } : undefined };
                return json(body);
            };
            let recorded = false;
            const finish = (closed: boolean) => {
                if (recorded) return;
                recorded = true;
                const state = activityOutcome(result, res.statusCode, descriptor.action, closed);
                void pool.query('UPDATE user_activity SET state = ? WHERE id = ? AND owner = ?', [state, id, owner]).catch(() => {});
            };
            res.once('finish', () => finish(false));
            res.once('close', () => finish(!res.writableFinished));
            next();
        })().catch(next);
    });
}

export async function listUserActivity(owner: string) {
    const [rows]: any = await pool.query(`SELECT id, area, action,
        CASE WHEN state = 'pending' AND created_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE) THEN 'uncertain' ELSE state END AS state,
        recovery_path AS recoveryPath, created_at AS createdAt, updated_at AS updatedAt
        FROM user_activity WHERE owner = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        ORDER BY created_at DESC, id DESC LIMIT 100`, [owner]);
    return rows;
}

export async function userSyncObservation(owner: string, area: string) {
    try {
        if (area === 'Mail' || area === 'Contacts') {
            const [rows]: any = area === 'Mail'
                ? await pool.query('SELECT MAX(updated_at) AS last_at FROM eas_mail_sync_states WHERE username = ?', [owner])
                : await pool.query("SELECT MAX(updated_at) AS last_at FROM eas_pim_sync_states WHERE username = ? AND collection_id = 'contacts'", [owner]);
            return { syncState: rows[0]?.last_at ? 'recorded' : 'unknown', syncDetail: rows[0]?.last_at ? 'Last recorded ActiveSync exchange; other devices and protocols are not measured here.' : 'No ActiveSync exchange recorded. Other device sync status is unknown.', lastSyncAt: rows[0]?.last_at || null };
        }
        if (area === 'Calendar') {
            const [rows]: any = await pool.query(`SELECT COUNT(*) AS total, MIN(last_fetched_at) AS oldest, MAX(last_fetched_at) AS latest,
                SUM(last_fetched_at IS NULL) AS waiting, SUM(last_fetch_error IS NOT NULL AND last_fetch_error <> '') AS failed
                FROM calendars WHERE user_id = ? AND subscribed_url IS NOT NULL AND subscribed_url <> ''`, [owner]);
            const row = rows[0];
            if (Number(row?.total)) {
                const stale = row.oldest && Date.now() - new Date(row.oldest).getTime() > 24 * 3600000;
                return { syncState: Number(row.failed) || stale ? 'attention' : Number(row.waiting) ? 'pending' : 'recorded',
                    syncDetail: Number(row.failed) ? 'Some subscribed calendars could not refresh. Open Calendar to retry.' : Number(row.waiting) ? 'Some subscribed calendars await their first refresh.' : stale ? 'A subscribed calendar has not refreshed in over 24 hours.' : 'Subscribed calendars have refreshed. Device sync is separate.', lastSyncAt: row.latest || null };
            }
            const [device]: any = await pool.query("SELECT MAX(updated_at) AS last_at FROM eas_pim_sync_states WHERE username = ? AND collection_id LIKE 'cal-%'", [owner]);
            return { syncState: device[0]?.last_at ? 'recorded' : 'unknown', syncDetail: 'No subscribed calendars. Device status is unknown beyond the last recorded ActiveSync exchange.', lastSyncAt: device[0]?.last_at || null };
        }
        if (area === 'Scheduler' && schedulerConfig.enabled) {
            const [rows]: any = await pool.query(`SELECT MAX(j.completed_at) AS last_at,
                SUM(j.dead_lettered_at IS NOT NULL AND j.completed_at IS NULL AND j.cancelled_at IS NULL) AS failed,
                SUM(j.completed_at IS NULL AND j.cancelled_at IS NULL AND j.dead_lettered_at IS NULL) AS pending
                FROM scheduler_jobs j JOIN scheduler_bookings b ON b.id = j.booking_id WHERE b.host_username = ?`, [owner]);
            return { syncState: Number(rows[0]?.failed) ? 'attention' : Number(rows[0]?.pending) ? 'pending' : rows[0]?.last_at ? 'recorded' : 'unknown', syncDetail: `${Number(rows[0]?.pending || 0)} pending booking workflow jobs; ${Number(rows[0]?.failed || 0)} need recovery. Open Scheduler Workflows for details.`, lastSyncAt: rows[0]?.last_at || null };
        }
        return { syncState: 'unknown', syncDetail: area === 'Notes' ? 'IMAP/device synchronization is not measured here. Open Notes to refresh and check save or conflict status.' : 'No synchronization observation is available.', lastSyncAt: null };
    } catch { return { syncState: 'unknown', syncDetail: 'Synchronization observations are unavailable. This does not establish whether your devices are up to date.', lastSyncAt: null }; }
}

export async function getUserHealth(owner: string, password: string) {
    const checks = [
        { area: 'Mail', path: '/mail/inbox', check: async () => {
            const imap = new ImapService(owner, password);
            const timeout = setTimeout(() => imap.close(), 10000);
            try { await imap.connect(); await imap.client.noop(); }
            finally { clearTimeout(timeout); imap.close(); }
            return 'Mailbox connection available';
        } },
        { area: 'Calendar', path: '/calendar', check: async () => {
            await pool.query('SELECT id FROM calendars WHERE user_id = ? LIMIT 1', [owner]);
            const [rows]: any = await pool.query('SELECT COUNT(*) AS failures FROM calendars WHERE user_id = ? AND last_fetch_error IS NOT NULL AND last_fetch_error <> ?', [owner, '']);
            return Number(rows[0]?.failures) > 0 ? 'Subscription sync needs attention' : 'Calendar storage available';
        } },
        { area: 'Contacts', path: '/contacts', check: async () => {
            await pool.query('SELECT id FROM contacts WHERE username = ? LIMIT 1', [owner]);
            return 'Contacts storage available';
        } },
        { area: 'Notes', path: '/notes', check: async () => {
            await pool.query('SELECT id FROM notes WHERE owner = ? LIMIT 1', [owner]);
            return 'Notes storage available';
        } },
        { area: 'Scheduler', path: '/scheduler-app', check: async () => {
            if (!schedulerConfig.enabled) return 'Not installed';
            await pool.query('SELECT host_username FROM scheduler_slot_inventory WHERE host_username = ? LIMIT 1', [owner]);
            return 'Scheduler storage available';
        } },
    ];
    return Promise.all(checks.map(async ({ area, path, check }) => {
        const started = Date.now();
        try {
            const detail = await check();
            return { area, path, detail, state: detail.includes('attention') ? 'attention' : detail === 'Not installed' ? 'unavailable' : 'available', ...await userSyncObservation(owner, area), checkedAt: new Date().toISOString(), latencyMs: Date.now() - started };
        } catch { return { area, path, detail: 'Check failed. Open this app to retry its workflow.', state: 'failed', checkedAt: new Date().toISOString(), latencyMs: Date.now() - started }; }
    }));
}

export function createActivityRouter() {
    const router = Router();
    router.get('/', async (req: any, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try { res.json({ success: true, items: await listUserActivity(req.user.username) }); }
        catch { res.status(503).json({ success: false, error: 'Activity is unavailable. Try again.' }); }
    });
    router.get('/health', async (req: any, res) => {
        res.setHeader('Cache-Control', 'no-store');
        try { res.json({ success: true, checks: await getUserHealth(req.user.username, req.user.password) }); }
        catch { res.status(503).json({ success: false, error: 'Health checks are unavailable. Try again.' }); }
    });
    return router;
}

export function startActivityMaintenance() {
    const timer = setInterval(() => {
        void pool.query('DELETE FROM user_activity WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)').catch(() => {});
    }, 3600000);
    timer.unref();
}
