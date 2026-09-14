import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { Router } from 'express';
import { pool } from './db';
const multer = require('multer');
const { simpleParser } = require('mailparser');
export async function ensureMailImportSchema(): Promise<void> {
    await pool.query(`CREATE TABLE IF NOT EXISTS mail_import_jobs (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 owner VARCHAR(255) NOT NULL,
 source_name VARCHAR(255) NOT NULL,
 source_sha256 CHAR(64) CHARACTER SET ascii NOT NULL,
 source_bytes INT UNSIGNED NOT NULL,
 folder TEXT NOT NULL,
 uid_validity VARCHAR(32) NOT NULL,
 destination_sha256 CHAR(64) CHARACTER SET ascii NOT NULL,
 manifest_json MEDIUMTEXT NOT NULL,
 total INT UNSIGNED NOT NULL,
 cursor_index INT UNSIGNED NOT NULL DEFAULT 0,
 imported INT UNSIGNED NOT NULL DEFAULT 0,
 skipped INT UNSIGNED NOT NULL DEFAULT 0,
 state VARCHAR(16) NOT NULL DEFAULT 'ready',
 last_error VARCHAR(512) NULL,
 staged TINYINT(1) NOT NULL DEFAULT 1,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 KEY import_owner (owner)
)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS mail_import_receipts (
 destination_sha256 CHAR(64) CHARACTER SET ascii NOT NULL,
 message_sha256 CHAR(64) CHARACTER SET ascii NOT NULL,
 state VARCHAR(16) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (destination_sha256, message_sha256)
)`);
}
const LIMIT = 50 * 1024 * 1024;
export const importRoot = '/var/lib/openmailstack/mail-import';
export interface ImportMessage { source: Buffer; hash: string; subject: string; date: string | null }
const hash = (input: Buffer | string) => crypto.createHash('sha256').update(input).digest('hex');
export async function parseMailImport(source: Buffer, filename: string): Promise<ImportMessage[]> {
    if (!source.length || source.length > LIMIT) throw new Error('Import files must be between 1 byte and 50 MiB.');
    let parts: Buffer[];
    if (/\.eml$/i.test(filename)) parts = [source];
    else if (/\.mbox$/i.test(filename)) {
        const text = source.toString('latin1');
        const chunks = text.split(/^From \S+ (?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) [^\r\n]+\r?\n/gm);
        if (chunks.shift()?.trim()) throw new Error('This is not a supported mboxrd mailbox. Export EML or standard MBOX.');
        parts = chunks.filter(part => part.trim()).map(part => Buffer.from(part.replace(/^>(>*From )/gm, '$1'), 'latin1'));
    } else throw new Error('Choose an .eml message or .mbox mailbox.');
    if (!parts.length || parts.length > 1000) throw new Error('Each import can contain 1–1,000 messages. Split larger exports.');
    const result: ImportMessage[] = [];
    for (const part of parts) {
        if (part.length > 20 * 1024 * 1024 || !/^[^\r\n:]+:/m.test(part.subarray(0, 8192).toString())) throw new Error('A message is invalid or exceeds 20 MiB.');
        const parsed = await simpleParser(part, { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true });
        if (!parsed.from?.value?.length && !parsed.subject && !parsed.messageId) throw new Error('A message has no recognizable mail headers.');
        result.push({ source: part, hash: hash(part), subject: String(parsed.subject || '(no subject)').slice(0, 255), date: parsed.date instanceof Date && Number.isFinite(parsed.date.getTime()) ? parsed.date.toISOString() : null });
    }
    return result;
}
function publicJob(row: any) {
    const manifest = JSON.parse(row.manifest_json);
    return { id: row.id, sourceName: row.source_name, folder: row.folder, total: row.total, cursor: row.cursor_index, imported: row.imported, skipped: row.skipped, state: row.state, staged: Boolean(row.staged), error: row.last_error, samples: manifest.slice(0, 5).map((m: any) => m.subject) };
}
async function withImportLock<T>(owner: string, run: () => Promise<T>): Promise<T> {
    const connection = await pool.getConnection();
    const key = `oms-import-${hash(owner).slice(0, 48)}`;
    let acquired = false;
    try {
        const [rows]: any = await connection.query('SELECT GET_LOCK(?, 30) AS acquired', [key]);
        acquired = Number(rows[0]?.acquired) === 1;
        if (!acquired) throw new Error('Another import is still working. Check progress shortly.');
        return await run();
    } finally {
        let reusable = true;
        try { if (acquired) await connection.query('SELECT RELEASE_LOCK(?)', [key]); }
        catch (error) { reusable = false; connection.destroy(); throw error; }
        finally { if (reusable) connection.release(); }
    }
}
export function createMailImportRouter(withImap: <T>(owner: string, pass: string, work: (imap: any) => Promise<T>) => Promise<T>, root = importRoot) {
    const router = Router();
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: LIMIT, files: 1, fields: 2, fieldSize: 4096 } });
    const sourcePath = (id: string) => { if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid import.'); return path.join(root, id + '.mail'); };
    const getJob = async (id: string, owner: string) => {
        const [rows]: any = await pool.query('SELECT * FROM mail_import_jobs WHERE id = ? AND owner = ?', [id, owner]);
        if (!rows.length) throw new Error('Import unavailable.'); return rows[0];
    };
    router.get('/', async (req: any, res) => {
        try { const [rows]: any = await pool.query('SELECT * FROM mail_import_jobs WHERE owner = ? ORDER BY staged DESC, created_at DESC LIMIT 50', [req.user.username]); res.json({ success: true, jobs: rows.map(publicJob) }); }
        catch { res.status(503).json({ success: false, error: 'Import history is unavailable. Retry.' }); }
    });
    router.post('/', upload.single('file'), async (req: any, res) => {
        const owner = req.user.username;
        let stagedFile: string | undefined;
        try {
            if (!req.file || typeof req.body.folder !== 'string' || !req.body.folder || /[\u0000-\u001f\u007f]/.test(req.body.folder)) throw new Error('Choose a file and destination folder.');
            const messages = await parseMailImport(req.file.buffer, req.file.originalname);
            const job = await withImportLock(owner, async () => {
                const identity = await withImap(owner, req.user.password, async imap => {
                    const lock = await imap.client.getMailboxLock(req.body.folder);
                    try { return String(imap.client.mailbox && imap.client.mailbox.uidValidity || ''); } finally { lock.release(); }
                });
                if (!identity) throw new Error('Destination mailbox identity is unavailable.');
                const sourceHash = hash(req.file.buffer);
                const [existing]: any = await pool.query("SELECT * FROM mail_import_jobs WHERE owner = ? AND source_sha256 = ? AND folder = ? AND uid_validity = ? AND state <> 'cancelled' ORDER BY created_at DESC LIMIT 1", [owner, sourceHash, req.body.folder, identity]);
                if (existing.length) return existing[0];
                const [quota]: any = await pool.query('SELECT COUNT(*) AS count, COALESCE(SUM(source_bytes), 0) AS bytes FROM mail_import_jobs WHERE owner = ? AND staged = 1', [owner]);
                if (Number(quota[0].count) >= 25) throw new Error('Finish or remove an earlier staged import (25 active imports maximum).');
                if (Number(quota[0].bytes) + req.file.size > 100 * 1024 * 1024) throw new Error('Finish or remove earlier staged imports before uploading more (100 MiB limit).');
                const id = crypto.randomUUID(); const manifest: any[] = []; let offset = 0;
                for (const message of messages) { manifest.push({ offset, bytes: message.source.length, hash: message.hash, subject: message.subject, date: message.date }); offset += message.source.length; }
                await fs.mkdir(root, { recursive: true, mode: 0o700 });
                const metadata = await fs.lstat(root); if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Import storage unavailable.');
                stagedFile = sourcePath(id);
                await fs.writeFile(stagedFile, Buffer.concat(messages.map(m => m.source)), { mode: 0o600, flag: 'wx' });
                await pool.query('INSERT INTO mail_import_jobs (id, owner, source_name, source_sha256, source_bytes, folder, uid_validity, destination_sha256, manifest_json, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, owner, req.file.originalname.slice(0, 255), sourceHash, offset, req.body.folder, identity, hash(JSON.stringify([owner, req.body.folder, identity])), JSON.stringify(manifest), messages.length]);
                stagedFile = undefined; return getJob(id, owner);
            });
            res.json({ success: true, job: publicJob(job) });
        } catch (err) { if (stagedFile) await fs.unlink(stagedFile).catch(() => undefined); res.status(400).json({ success: false, error: err instanceof Error ? err.message : 'Import could not be prepared.' }); }
    });
    router.post('/:id/run', async (req: any, res) => {
        try {
            if (req.body?.confirm !== true || !Number.isInteger(req.body.cursor) || req.body.cursor < 0) throw new Error('Review and confirm the import first.');
            const job = await withImportLock(req.user.username, async () => {
                let row = await getJob(req.params.id, req.user.username);
                if (row.state === 'complete' && row.staged) {
                    await fs.unlink(sourcePath(row.id)).catch((error: any) => { if (error.code !== 'ENOENT') throw error; });
                    await pool.query('UPDATE mail_import_jobs SET staged = 0 WHERE id = ? AND owner = ?', [row.id, req.user.username]);
                    row = await getJob(row.id, req.user.username);
                }
                if (['complete', 'cancelled'].includes(row.state) || req.body.cursor < row.cursor_index) return row;
                if (req.body.cursor !== row.cursor_index) throw new Error('Import progress changed. Refresh its status.');
                const manifest = JSON.parse(row.manifest_json);
                const file = await fs.open(sourcePath(row.id), 'r');
                try {
                    await withImap(req.user.username, req.user.password, async imap => {
                        const lock = await imap.client.getMailboxLock(row.folder);
                        try {
                            if (String(imap.client.mailbox && imap.client.mailbox.uidValidity) !== row.uid_validity) throw new Error('The destination folder was replaced. Start a new reviewed import.');
                            const end = Math.min(manifest.length, row.cursor_index + 10);
                            for (let index = row.cursor_index; index < end; index++) {
                                const item = manifest[index];
                                const [receipts]: any = await pool.query('SELECT state FROM mail_import_receipts WHERE destination_sha256 = ? AND message_sha256 = ?', [row.destination_sha256, item.hash]);
                                const existing = receipts[0]; let skipped = false;
                                if (existing?.state === 'done') skipped = true;
                                else {
                                    const found = await imap.client.search({ header: { 'x-oms-import-id': item.hash } }, { uid: true });
                                    if (found && found.length) skipped = true;
                                    else {
                                        if (existing && req.body.confirmMissing !== true) throw new Error('The last message has an uncertain outcome and was not found during reconciliation. Check the destination folder before explicitly retrying that message.');
                                        const content = Buffer.alloc(item.bytes); const read = await file.read(content, 0, item.bytes, item.offset);
                                        if (read.bytesRead !== item.bytes || hash(content) !== item.hash) throw new Error('Staged source changed. Remove this import and upload it again.');
                                        await pool.query("INSERT INTO mail_import_receipts (destination_sha256, message_sha256, state) VALUES (?, ?, 'pending') ON DUPLICATE KEY UPDATE state = 'pending'", [row.destination_sha256, item.hash]);
                                        // The marker makes a lost-response retry discoverable without relying on Message-ID uniqueness.
                                        const raw = Buffer.concat([Buffer.from(`X-OMS-Import-Id: ${item.hash}\r\n`), content]);
                                        const appended = await imap.client.append(row.folder, raw, ['\\Seen'], item.date ? new Date(item.date) : undefined);
                                        if (!appended) throw new Error('The append was not acknowledged.');
                                    }
                                    await pool.query("INSERT INTO mail_import_receipts (destination_sha256, message_sha256, state) VALUES (?, ?, 'done') ON DUPLICATE KEY UPDATE state = 'done'", [row.destination_sha256, item.hash]);
                                }
                                await pool.query("UPDATE mail_import_jobs SET cursor_index = ?, imported = imported + ?, skipped = skipped + ?, state = 'ready', last_error = NULL WHERE id = ? AND owner = ?", [index + 1, skipped ? 0 : 1, skipped ? 1 : 0, row.id, req.user.username]);
                                // Confirmation applies only to the uncertain first message, never to later uncertain messages.
                                req.body.confirmMissing = false;
                            }
                        } finally { lock.release(); }
                    });
                    row = await getJob(row.id, req.user.username);
                    if (row.cursor_index === row.total) {
                        await pool.query("UPDATE mail_import_jobs SET state = 'complete' WHERE id = ? AND owner = ?", [row.id, req.user.username]);
                        await fs.unlink(sourcePath(row.id)).catch((error: any) => { if (error.code !== 'ENOENT') throw error; });
                        await pool.query('UPDATE mail_import_jobs SET staged = 0 WHERE id = ? AND owner = ?', [row.id, req.user.username]);
                    }
                } catch (err) {
                    const error = err instanceof Error ? err.message : 'Import paused.';
                    await pool.query("UPDATE mail_import_jobs SET state = 'uncertain', last_error = ? WHERE id = ? AND owner = ? AND state NOT IN ('complete', 'cancelled')", [error.slice(0, 512), row.id, req.user.username]);
                    throw err;
                } finally { await file.close(); }
                return getJob(row.id, req.user.username);
            });
            res.json({ success: true, job: publicJob(job) });
        } catch (err) {
            const error = err instanceof Error ? err.message : 'Import paused. Check progress before retrying.';
            res.status(409).json({ success: false, error });
        }
    });
    router.delete('/:id', async (req: any, res) => {
        if (req.body?.confirm !== true) return res.status(400).json({ success: false, error: 'Confirm removal of the staged source.' });
        try {
            await withImportLock(req.user.username, async () => {
                const row = await getJob(req.params.id, req.user.username);
                await fs.unlink(sourcePath(row.id)).catch((error: any) => { if (error.code !== 'ENOENT') throw error; });
                await pool.query("UPDATE mail_import_jobs SET state = IF(state = 'complete', 'complete', 'cancelled'), staged = 0 WHERE id = ? AND owner = ?", [row.id, req.user.username]);
            });
            res.json({ success: true });
        } catch (err) { res.status(409).json({ success: false, error: err instanceof Error ? err.message : 'Import could not be removed.' }); }
    });
    router.use((error: any, _req: any, res: any, _next: any) => res.status(400).json({ success: false, error: error?.code === 'LIMIT_FILE_SIZE' ? 'Use a file up to 50 MiB.' : 'The upload could not be accepted.' }));
    return router;
}
