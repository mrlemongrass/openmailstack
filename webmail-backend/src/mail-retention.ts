import crypto from 'crypto';
import { Router } from 'express';
import { pool } from './db';
import { ImapService } from './imap';
import { delegatedAuthEnabled } from './config';
import { decryptPassword } from './auth';
import { withDedicatedImapConnection } from './imap-pool';
import { ensureAccountOwnedTable } from './account-owned-schema';

const DAY = 86400000;
const MAX_MESSAGES = 10000;
type Kind = 'junk' | 'trash';
type Options = { junk: number; trash: number };
type Snapshot = { kind: Kind; path: string; uidValidity: string; uids: number[]; eligible: number[] };
type Dedicated = typeof withDedicatedImapConnection;
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

export async function ensureMailRetentionSchema() {
    await pool.query(`CREATE TABLE IF NOT EXISTS mail_retention (
        owner VARCHAR(255) PRIMARY KEY, revision INT UNSIGNED NOT NULL DEFAULT 0, generation CHAR(36) NOT NULL,
        enabled TINYINT NOT NULL DEFAULT 0, options_json TEXT NOT NULL,
        folders_json MEDIUMTEXT NOT NULL, next_run DATETIME NULL,
        last_run DATETIME NULL, status VARCHAR(32) NOT NULL DEFAULT 'off',
        preview_token CHAR(36) NULL, preview_json MEDIUMTEXT NULL, preview_expires DATETIME NULL
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS mail_retention_seen (
        owner VARCHAR(255) NOT NULL, folder_key CHAR(64) CHARACTER SET ascii NOT NULL,
        uid BIGINT UNSIGNED NOT NULL, first_seen DATETIME(3) NOT NULL,
        PRIMARY KEY (owner, folder_key, uid)
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS mail_retention_runs (
        id CHAR(36) PRIMARY KEY, owner VARCHAR(255) NOT NULL, state VARCHAR(32) NOT NULL,
        moved INT NOT NULL DEFAULT 0, deleted INT NOT NULL DEFAULT 0,
        junk_days INT NULL, trash_days INT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        KEY retention_runs_owner (owner, created_at)
    )`);
    for (const table of ['mail_retention', 'mail_retention_seen', 'mail_retention_runs'] as const) await ensureAccountOwnedTable(table);
}

export function retentionOptions(value: any): Options {
    if (!value || !['junk', 'trash'].every(key => Number.isInteger(value[key]) && (value[key] === 0 || (value[key] >= 1 && value[key] <= 3650)))) {
        throw new Error('Choose Off or 1–3,650 days for each folder.');
    }
    if (!value.junk && !value.trash) throw new Error('Choose a retention period, or turn cleanup off.');
    return { junk: value.junk, trash: value.trash };
}

async function getPolicy(owner: string, connection: Pick<typeof pool, 'query'> = pool) {
    const [rows]: any = await connection.query('SELECT * FROM mail_retention WHERE owner = ?', [owner]);
    return rows[0];
}

async function ownerLock<T>(owner: string, operation: () => Promise<T>): Promise<T> {
    const connection = await pool.getConnection();
    const key = `oms-retention-${hash(owner.toLowerCase()).slice(0, 48)}`;
    let acquired = false;
    try {
        const [rows]: any = await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [key]);
        acquired = Number(rows[0]?.acquired) === 1;
        if (!acquired) throw new Error('Cleanup is working. Try again after the current batch.');
        return await operation();
    } finally {
        let reusable = true;
        try { if (acquired) await connection.query('SELECT RELEASE_LOCK(?)', [key]); }
        catch (error) { reusable = false; connection.destroy(); throw error; }
        finally { if (reusable) connection.release(); }
    }
}

// Folder residence starts with our first observation, never the message's original date.
// A changed UIDVALIDITY or path creates a fresh grace period.
export async function retentionSnapshot(owner: string, imap: ImapService, options: Options, observe: boolean, now = new Date()): Promise<Snapshot[]> {
    const folders = await imap.client.list();
    if (!imap.client.capabilities.has('UIDPLUS')) throw new Error('This server cannot safely run bounded cleanup (UIDPLUS required).');
    if (options.junk && folders.filter(f => f.specialUse?.toLowerCase() === '\\trash' && !f.flags?.has('\\Noselect')).length !== 1) throw new Error('A unique Trash folder is required.');
    const snapshots: Snapshot[] = [];
    for (const kind of ['trash', 'junk'] as Kind[]) {
        if (!options[kind]) continue;
        const candidates = folders.filter(f => (f.specialUse || '').toLowerCase() === `\\${kind}` && !f.flags?.has('\\Noselect'));
        if (candidates.length !== 1) throw new Error(`A unique ${kind === 'junk' ? 'Junk' : 'Trash'} folder is required.`);
        const folder = candidates[0];
        const lock = await imap.client.getMailboxLock(folder.path);
        try {
            const mailbox = imap.client.mailbox;
            if (!mailbox || !/^[1-9][0-9]*$/.test(String(mailbox.uidValidity))) throw new Error('Folder identity is unavailable.');
            if (mailbox.exists > MAX_MESSAGES) throw new Error('Automatic cleanup supports up to 10,000 messages per folder. Use manual cleanup first.');
            const uidValidity = String(mailbox.uidValidity);
            const found = await imap.client.search({ all: true }, { uid: true });
            const uids = [...new Set((found || []).filter(uid => Number.isSafeInteger(uid) && uid > 0))];
            if (uids.length > MAX_MESSAGES) throw new Error('This folder exceeds the cleanup limit.');
            const key = hash(`${folder.path}\0${uidValidity}`);
            if (observe) {
                // Remove departed messages; returning messages have new UIDs and a new grace period.
                await pool.query(`DELETE FROM mail_retention_seen WHERE owner = ? AND folder_key = ?${uids.length ? ' AND uid NOT IN (?)' : ''}`, uids.length ? [owner, key, uids] : [owner, key]);
                for (let index = 0; index < uids.length; index += 500) {
                    await pool.query('INSERT IGNORE INTO mail_retention_seen (owner, folder_key, uid, first_seen) VALUES ?', [uids.slice(index, index + 500).map(uid => [owner, key, uid, now])]);
                }
            }
            const [rows]: any = await pool.query('SELECT uid FROM mail_retention_seen WHERE owner = ? AND folder_key = ? AND first_seen <= ?', [owner, key, new Date(now.getTime() - options[kind] * DAY)]);
            const present = new Set(uids);
            const eligible = rows.map((row: any) => Number(row.uid)).filter((uid: number) => present.has(uid));
            snapshots.push({ kind, path: folder.path, uidValidity, uids, eligible });
        } finally { lock.release(); }
    }
    if (observe) {
        const keys = snapshots.map(s => hash(`${s.path}\0${s.uidValidity}`));
        if (keys.length) await pool.query('DELETE FROM mail_retention_seen WHERE owner = ? AND folder_key NOT IN (?)', [owner, keys]);
    }
    return snapshots;
}

export async function previewRetention(owner: string, password: string, raw: unknown, dedicated: Dedicated = withDedicatedImapConnection) {
    const options = retentionOptions(raw);
    return ownerLock(owner, async () => {
        const folders = await dedicated(owner, password, imap => retentionSnapshot(owner, imap, options, false));
        const token = crypto.randomUUID();
        const preview = { options, folders: folders.map(({ uids, eligible, ...f }) => ({ ...f, total: uids.length, eligible: eligible.length })) };
        await pool.query(`INSERT INTO mail_retention (owner, generation, options_json, folders_json, preview_token, preview_json, preview_expires)
            VALUES (?, ?, '{}', '[]', ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))
            ON DUPLICATE KEY UPDATE preview_token = VALUES(preview_token), preview_json = VALUES(preview_json), preview_expires = VALUES(preview_expires)`, [owner, crypto.randomUUID(), token, JSON.stringify(preview)]);
        return { token, ...preview };
    });
}

export async function enableRetention(owner: string, token: string, confirm: boolean) {
    if (confirm !== true || typeof token !== 'string') throw new Error('Review and confirm the cleanup preview first.');
    return ownerLock(owner, async () => {
        const row = await getPolicy(owner);
        if (!row || row.preview_token !== token || new Date(row.preview_expires).getTime() <= Date.now()) throw new Error('The preview expired. Prepare a new preview.');
        const preview = JSON.parse(row.preview_json);
        // Disabled schedules restart residence observation rather than reusing old ages.
        if (!row.enabled) await pool.query('DELETE FROM mail_retention_seen WHERE owner = ?', [owner]);
        const [updated]: any = await pool.query(`UPDATE mail_retention SET enabled = 1, revision = revision + 1, options_json = ?, folders_json = ?,
            status = 'scheduled', next_run = DATE_ADD(NOW(), INTERVAL 1 HOUR), preview_token = NULL, preview_json = NULL, preview_expires = NULL WHERE owner = ? AND revision = ? AND preview_token = ?`, [JSON.stringify(preview.options), JSON.stringify(preview.folders), owner, row.revision, token]);
        if (updated.affectedRows !== 1) throw new Error('Cleanup settings changed. Prepare a new preview.');
        await pool.query("INSERT INTO mail_retention_runs (id, owner, state, junk_days, trash_days) VALUES (?, ?, 'enabled', ?, ?)", [crypto.randomUUID(), owner, preview.options.junk, preview.options.trash]);
    });
}

export async function disableRetention(owner: string) {
    // No worker lock: an in-flight IMAP batch may finish, but the next batch sees this revision.
    await pool.query("UPDATE mail_retention SET enabled = 0, revision = revision + 1, status = 'off', next_run = NULL, preview_token = NULL, preview_json = NULL WHERE owner = ?", [owner]);
    await pool.query("INSERT INTO mail_retention_runs (id, owner, state) VALUES (?, ?, 'disabled')", [crypto.randomUUID(), owner]);
}

export async function runRetentionForOwner(owner: string, password: string, dedicated: Dedicated = withDedicatedImapConnection, now = new Date()) {
    return ownerLock(owner, async () => {
        const policy = await getPolicy(owner);
        if (!policy?.enabled || !policy.next_run || new Date(policy.next_run) > now) return;
        const runId = crypto.randomUUID();
        // A durable pending marker prevents an automatic replay after process/acknowledgement loss.
        if (policy.status === 'running') {
            await pool.query("UPDATE mail_retention SET enabled = 0, status = 'needs_review', next_run = NULL WHERE owner = ?", [owner]);
            await pool.query("UPDATE mail_retention_runs SET state = 'uncertain' WHERE owner = ? AND state = 'running'", [owner]);
            return;
        }
        const options = retentionOptions(JSON.parse(policy.options_json));
        await pool.query("INSERT INTO mail_retention_runs (id, owner, state, junk_days, trash_days) VALUES (?, ?, 'running', ?, ?)", [runId, owner, options.junk, options.trash]);
        await pool.query("UPDATE mail_retention SET status = 'running' WHERE owner = ? AND revision = ? AND generation = ?", [owner, policy.revision, policy.generation]);
        let moved = 0;
        let deleted = 0;
        try {
            await dedicated(owner, password, async imap => {
                const deadline = setTimeout(() => imap.close(), 120000);
                try {
                    const snapshots = await retentionSnapshot(owner, imap, options, true, now);
                    const expected = JSON.parse(policy.folders_json);
                    if (snapshots.some(s => !expected.some((f: any) => f.kind === s.kind && f.path === s.path && f.uidValidity === s.uidValidity))) throw new Error('Folder changed.');
                    if (!imap.client.capabilities.has('UIDPLUS')) throw new Error('UIDPLUS required.');
                    // Trash goes first, so moved Junk cannot be deleted by this run.
                    for (const snapshot of snapshots) {
                        for (let index = 0; index < snapshot.eligible.length; index += 100) {
                            const connection = await pool.getConnection();
                            let cancelled = false;
                            try {
                                await connection.beginTransaction();
                                const [accounts]: any = await connection.query('SELECT username FROM mailbox WHERE username = ? AND active = 1 LOCK IN SHARE MODE', [owner]);
                                const current = await getPolicy(owner, connection);
                                if (!accounts.length || !current?.enabled || current.revision !== policy.revision || current.generation !== policy.generation) {
                                    cancelled = true;
                                } else {
                                    const lock = await imap.client.getMailboxLock(snapshot.path);
                                    try {
                                        const currentFolders = await imap.client.list();
                                        if (!currentFolders.some(f => f.path === snapshot.path && f.specialUse?.toLowerCase() === `\\${snapshot.kind}` && !f.flags?.has('\\Noselect'))) throw new Error('Folder purpose changed.');
                                        if (!imap.client.mailbox || String(imap.client.mailbox.uidValidity) !== snapshot.uidValidity) throw new Error('Folder changed.');
                                        const batch = snapshot.eligible.slice(index, index + 100);
                                        const present = await imap.client.search({ uid: batch.join(',') }, { uid: true });
                                        if (!present || !present.length) { await connection.commit(); continue; }
                                        const requested = new Set(batch);
                                        if (present.some(uid => !requested.has(uid))) throw new Error('Unexpected selection.');
                                        let acknowledged: unknown;
                                        if (snapshot.kind === 'trash') acknowledged = await imap.client.messageDelete(present.join(','), { uid: true });
                                        else {
                                            const trash = currentFolders.filter(f => f.specialUse?.toLowerCase() === '\\trash' && !f.flags?.has('\\Noselect'));
                                            if (trash.length !== 1 || trash[0].path === snapshot.path) throw new Error('Trash unavailable.');
                                            acknowledged = await imap.client.messageMove(present.join(','), trash[0].path, { uid: true });
                                        }
                                        if (!acknowledged) throw new Error('Unacknowledged cleanup.');
                                        if (snapshot.kind === 'trash') deleted += present.length;
                                        else moved += present.length;
                                        await connection.query('UPDATE mail_retention_runs SET moved = ?, deleted = ? WHERE id = ?', [moved, deleted, runId]);
                                    } finally { lock.release(); }
                                }
                                await connection.commit();
                            } catch (error) { await connection.rollback(); throw error; }
                            finally { connection.release(); }
                            if (cancelled) {
                                await pool.query("UPDATE mail_retention_runs SET state = 'cancelled' WHERE id = ?", [runId]);
                                return;
                            }
                        }
                    }
                } finally { clearTimeout(deadline); }
            });
            await pool.query("UPDATE mail_retention_runs SET state = 'completed' WHERE id = ? AND state = 'running'", [runId]);
            await pool.query("UPDATE mail_retention SET status = 'scheduled', last_run = ?, next_run = DATE_ADD(?, INTERVAL 1 HOUR) WHERE owner = ? AND enabled = 1 AND revision = ? AND generation = ?", [now, now, owner, policy.revision, policy.generation]);
        } catch {
            await pool.query("UPDATE mail_retention_runs SET state = 'uncertain', moved = ?, deleted = ? WHERE id = ?", [moved, deleted, runId]);
            await pool.query("UPDATE mail_retention SET enabled = 0, status = 'needs_review', next_run = NULL, preview_token = NULL WHERE owner = ? AND revision = ? AND generation = ?", [owner, policy.revision, policy.generation]);
        }
    });
}

export function createRetentionRouter() {
    const router = Router();
    router.get('/', async (req: any, res) => {
        try {
            const row = await getPolicy(req.user.username);
            const [history]: any = await pool.query('SELECT id, state, moved, deleted, junk_days, trash_days, created_at, updated_at FROM mail_retention_runs WHERE owner = ? ORDER BY created_at DESC, id DESC LIMIT 50', [req.user.username]);
            res.setHeader('Cache-Control', 'no-store');
            res.json({ success: true, enabled: Boolean(row?.enabled), options: row ? JSON.parse(row.options_json) : { junk: 0, trash: 0 }, status: row?.status || 'off', nextRun: row?.next_run, lastRun: row?.last_run, history });
        } catch { res.status(503).json({ success: false, error: 'Cleanup settings are unavailable. Try again.' }); }
    });
    router.post('/preview', async (req: any, res) => {
        try { res.json({ success: true, ...await previewRetention(req.user.username, req.user.password, req.body?.options) }); }
        catch (error) { res.status(409).json({ success: false, error: error instanceof Error ? error.message : 'Preview unavailable.' }); }
    });
    router.post('/enable', async (req: any, res) => {
        try { await enableRetention(req.user.username, req.body?.token, req.body?.confirm); res.json({ success: true }); }
        catch (error) { res.status(409).json({ success: false, error: error instanceof Error ? error.message : 'Schedule could not be enabled.' }); }
    });
    router.post('/disable', async (req: any, res) => {
        try { await disableRetention(req.user.username); res.json({ success: true }); }
        catch { res.status(503).json({ success: false, error: 'Cleanup could not be stopped. Try again.' }); }
    });
    return router;
}

let workerRunning = false;
export async function runRetentionWorker() {
    if (workerRunning) return;
    workerRunning = true;
    try {
        const [rows]: any = await pool.query(`SELECT r.owner FROM mail_retention r JOIN mailbox m ON m.username = r.owner
            WHERE r.enabled = 1 AND m.active = 1 AND r.next_run <= NOW() ORDER BY r.next_run LIMIT 25`);
        for (const row of rows) {
            try {
                let password = '';
                if (!delegatedAuthEnabled) {
                    const [credentials]: any = await pool.query(`SELECT password_ciphertext, password_iv, password_tag FROM mailbox_credentials WHERE username = ?
                        UNION ALL SELECT password_ciphertext, password_iv, password_tag FROM webmail_sessions WHERE username = ? AND expires_at > NOW() LIMIT 1`, [row.owner, row.owner]);
                    if (!credentials.length) throw new Error('Sign in required.');
                    password = decryptPassword(credentials[0].password_ciphertext, credentials[0].password_iv, credentials[0].password_tag);
                }
                await runRetentionForOwner(row.owner, password);
            } catch {
                // No message content, folder names or credentials enter logs.
                await pool.query("UPDATE mail_retention SET status = 'waiting', next_run = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE owner = ? AND enabled = 1 AND status <> 'running'", [row.owner]);
            }
        }
        await pool.query('DELETE FROM mail_retention_runs WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)');
    } finally { workerRunning = false; }
}

export function startRetentionWorker() {
    const timer = setInterval(() => { void runRetentionWorker().catch(() => console.error('Cleanup worker unavailable.')); }, 60000);
    timer.unref();
}
