import crypto from 'crypto';
import { pool } from './db';
import { serverConfig } from './config';

export interface WebmailSession {
    id: string;
    username: string;
    password: string;
    isAdmin: boolean;
    expiresAt: number;
}

export const SESSION_COOKIE = 'oms_session';

let schemaPromise: Promise<void> | null = null;

const ensureSessionSchema = async () => {
    if (!schemaPromise) {
        schemaPromise = (async () => {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS webmail_sessions (
                    id_hash CHAR(64) NOT NULL PRIMARY KEY,
                    username VARCHAR(255) NOT NULL,
                    password_ciphertext TEXT NOT NULL,
                    password_iv VARBINARY(12) NOT NULL,
                    password_tag VARBINARY(16) NOT NULL,
                    is_admin TINYINT(1) NOT NULL DEFAULT 0,
                    expires_at DATETIME NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    KEY idx_expires_at (expires_at),
                    KEY idx_username (username)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            await pool.query(`
                CREATE TABLE IF NOT EXISTS mailbox_credentials (
                    username VARCHAR(255) NOT NULL PRIMARY KEY,
                    password_ciphertext TEXT NOT NULL,
                    password_iv VARBINARY(12) NOT NULL,
                    password_tag VARBINARY(16) NOT NULL,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
        })().then(() => undefined);
    }

    return schemaPromise;
};

const cookieOptions = (maxAgeSeconds: number): string[] => {
    const options = [
        'HttpOnly',
        'Path=/',
        'SameSite=Lax',
        `Max-Age=${maxAgeSeconds}`,
    ];
    if (serverConfig.cookieSecure) options.push('Secure');
    return options;
};

const parseCookies = (header = ''): Record<string, string> => {
    const cookies: Record<string, string> = {};
    for (const part of header.split(';')) {
        const [key, ...valueParts] = part.trim().split('=');
        if (!key) continue;
        cookies[key] = decodeURIComponent(valueParts.join('=') || '');
    }
    return cookies;
};

const hashSessionId = (id: string) => crypto.createHash('sha256').update(id).digest('hex');

const getSessionKey = () => crypto.createHash('sha256').update(serverConfig.sessionSecret).digest();

const encryptPassword = (password: string) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getSessionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
    return {
        ciphertext: ciphertext.toString('base64'),
        iv,
        tag: cipher.getAuthTag()
    };
};

export const decryptPassword = (ciphertext: string, iv: Buffer, tag: Buffer) => {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getSessionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64')),
        decipher.final()
    ]).toString('utf8');
};

const toMysqlDate = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ');

const cleanupExpiredSessions = async () => {
    await ensureSessionSchema();
    await pool.query('DELETE FROM webmail_sessions WHERE expires_at <= NOW()');
};

export const createSession = async (res: any, data: Omit<WebmailSession, 'id' | 'expiresAt'>): Promise<WebmailSession> => {
    await cleanupExpiredSessions();
    const id = crypto.randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + serverConfig.sessionTtlMs;
    const encryptedPassword = encryptPassword(data.password);

    await pool.query(
        `INSERT INTO webmail_sessions
            (id_hash, username, password_ciphertext, password_iv, password_tag, is_admin, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            hashSessionId(id),
            data.username,
            encryptedPassword.ciphertext,
            encryptedPassword.iv,
            encryptedPassword.tag,
            data.isAdmin ? 1 : 0,
            toMysqlDate(expiresAt)
        ]
    );

    // Also store credentials persistently for offline indexing
    pool.query(
        `INSERT INTO mailbox_credentials (username, password_ciphertext, password_iv, password_tag)
         VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE
         password_ciphertext = VALUES(password_ciphertext),
         password_iv = VALUES(password_iv),
         password_tag = VALUES(password_tag)`,
        [data.username, encryptedPassword.ciphertext, encryptedPassword.iv, encryptedPassword.tag]
    ).catch(err => console.error('Failed to store mailbox credentials:', err));

    const session = { ...data, id, expiresAt };
    const maxAge = Math.floor(serverConfig.sessionTtlMs / 1000);
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(id)}; ${cookieOptions(maxAge).join('; ')}`);
    return session;
};

export const getSession = async (req: any): Promise<WebmailSession | null> => {
    const id = parseCookies(req.headers.cookie || '')[SESSION_COOKIE];
    if (!id) return null;

    await ensureSessionSchema();
    const [rows]: any = await pool.query(
        `SELECT username, password_ciphertext, password_iv, password_tag, is_admin, expires_at
         FROM webmail_sessions
         WHERE id_hash = ? AND expires_at > NOW()
         LIMIT 1`,
        [hashSessionId(id)]
    );

    if (rows.length === 0) {
        await pool.query('DELETE FROM webmail_sessions WHERE id_hash = ?', [hashSessionId(id)]);
        return null;
    }

    const row = rows[0];
    const expiresAt = Date.now() + serverConfig.sessionTtlMs;
    await pool.query(
        'UPDATE webmail_sessions SET expires_at = ? WHERE id_hash = ?',
        [toMysqlDate(expiresAt), hashSessionId(id)]
    );

    try {
        return {
            id,
            username: row.username,
            password: decryptPassword(row.password_ciphertext, row.password_iv, row.password_tag),
            isAdmin: !!row.is_admin,
            expiresAt
        };
    } catch (err) {
        await pool.query('DELETE FROM webmail_sessions WHERE id_hash = ?', [hashSessionId(id)]);
        console.error('Failed to decrypt webmail session:', err);
        return null;
    }
};

export const clearSession = async (req: any, res: any) => {
    const id = parseCookies(req.headers.cookie || '')[SESSION_COOKIE];
    if (id) {
        await ensureSessionSchema();
        await pool.query('DELETE FROM webmail_sessions WHERE id_hash = ?', [hashSessionId(id)]);
    }
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; ${cookieOptions(0).join('; ')}`);
};

export const requireSession = async (req: any, res: any, next: any) => {
    const session = await getSession(req);
    if (!session) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    req.user = {
        username: session.username,
        password: session.password,
        isAdmin: session.isAdmin,
    };
    next();
};

export const requireAdminSession = (req: any, res: any, next: any) => {
    if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({ success: false, error: 'Forbidden: Admins only' });
    }
    next();
};
