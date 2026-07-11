"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdminSession = exports.requireSession = exports.clearSession = exports.getSession = exports.createSession = exports.canDemoteGlobalAdmin = exports.hasGlobalAdminAccess = exports.decryptPassword = exports.SESSION_COOKIE = void 0;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("./db");
const config_1 = require("./config");
exports.SESSION_COOKIE = 'oms_session';
let schemaPromise = null;
const ensureSessionSchema = async () => {
    if (!schemaPromise) {
        schemaPromise = (async () => {
            await db_1.pool.query(`
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
            await db_1.pool.query(`
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
const cookieOptions = (maxAgeSeconds) => {
    const options = [
        'HttpOnly',
        'Path=/',
        'SameSite=Lax',
        `Max-Age=${maxAgeSeconds}`,
    ];
    if (config_1.serverConfig.cookieSecure)
        options.push('Secure');
    return options;
};
const parseCookies = (header = '') => {
    const cookies = {};
    for (const part of header.split(';')) {
        const [key, ...valueParts] = part.trim().split('=');
        if (!key)
            continue;
        cookies[key] = decodeURIComponent(valueParts.join('=') || '');
    }
    return cookies;
};
const hashSessionId = (id) => crypto_1.default.createHash('sha256').update(id).digest('hex');
const getSessionKey = () => crypto_1.default.createHash('sha256').update(config_1.serverConfig.sessionSecret).digest();
const encryptPassword = (password) => {
    const iv = crypto_1.default.randomBytes(12);
    const cipher = crypto_1.default.createCipheriv('aes-256-gcm', getSessionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
    return {
        ciphertext: ciphertext.toString('base64'),
        iv,
        tag: cipher.getAuthTag()
    };
};
const decryptPassword = (ciphertext, iv, tag) => {
    const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', getSessionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64')),
        decipher.final()
    ]).toString('utf8');
};
exports.decryptPassword = decryptPassword;
const toMysqlDate = (timestamp) => new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ');
const cleanupExpiredSessions = async () => {
    await ensureSessionSchema();
    await db_1.pool.query('DELETE FROM webmail_sessions WHERE expires_at <= NOW()');
};
const hasGlobalAdminAccess = (row) => (Number(row?.superadmin || 0) === 1);
exports.hasGlobalAdminAccess = hasGlobalAdminAccess;
const canDemoteGlobalAdmin = (actorUsername, targetUsername, activeSuperAdminCount) => {
    if (actorUsername === targetUsername) {
        return { allowed: false, reason: 'You cannot remove your own superadmin role.' };
    }
    if (activeSuperAdminCount <= 1) {
        return { allowed: false, reason: 'At least one active superadmin is required.' };
    }
    return { allowed: true, reason: '' };
};
exports.canDemoteGlobalAdmin = canDemoteGlobalAdmin;
const createSession = async (res, data) => {
    await cleanupExpiredSessions();
    const id = crypto_1.default.randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + config_1.serverConfig.sessionTtlMs;
    const encryptedPassword = encryptPassword(data.password);
    await db_1.pool.query(`INSERT INTO webmail_sessions
            (id_hash, username, password_ciphertext, password_iv, password_tag, is_admin, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`, [
        hashSessionId(id),
        data.username,
        encryptedPassword.ciphertext,
        encryptedPassword.iv,
        encryptedPassword.tag,
        data.isAdmin ? 1 : 0,
        toMysqlDate(expiresAt)
    ]);
    // Also store credentials persistently for offline indexing
    db_1.pool.query(`INSERT INTO mailbox_credentials (username, password_ciphertext, password_iv, password_tag)
         VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE
         password_ciphertext = VALUES(password_ciphertext),
         password_iv = VALUES(password_iv),
         password_tag = VALUES(password_tag)`, [data.username, encryptedPassword.ciphertext, encryptedPassword.iv, encryptedPassword.tag]).catch(err => console.error('Failed to store mailbox credentials:', err));
    const session = { ...data, id, expiresAt };
    const maxAge = Math.floor(config_1.serverConfig.sessionTtlMs / 1000);
    res.setHeader('Set-Cookie', `${exports.SESSION_COOKIE}=${encodeURIComponent(id)}; ${cookieOptions(maxAge).join('; ')}`);
    return session;
};
exports.createSession = createSession;
const getSession = async (req) => {
    const id = parseCookies(req.headers.cookie || '')[exports.SESSION_COOKIE];
    if (!id)
        return null;
    await ensureSessionSchema();
    const [rows] = await db_1.pool.query(`SELECT
            s.username,
            s.password_ciphertext,
            s.password_iv,
            s.password_tag,
            s.is_admin,
            s.expires_at,
            a.superadmin
         FROM webmail_sessions s
         LEFT JOIN admin a ON a.username = s.username AND a.active = 1
         WHERE s.id_hash = ? AND s.expires_at > NOW()
         LIMIT 1`, [hashSessionId(id)]);
    if (rows.length === 0) {
        await db_1.pool.query('DELETE FROM webmail_sessions WHERE id_hash = ?', [hashSessionId(id)]);
        return null;
    }
    const row = rows[0];
    const expiresAt = Date.now() + config_1.serverConfig.sessionTtlMs;
    await db_1.pool.query('UPDATE webmail_sessions SET expires_at = ? WHERE id_hash = ?', [toMysqlDate(expiresAt), hashSessionId(id)]);
    try {
        const isSuperAdmin = (0, exports.hasGlobalAdminAccess)(row);
        return {
            id,
            username: row.username,
            password: (0, exports.decryptPassword)(row.password_ciphertext, row.password_iv, row.password_tag),
            isAdmin: isSuperAdmin,
            isSuperAdmin,
            expiresAt
        };
    }
    catch (err) {
        await db_1.pool.query('DELETE FROM webmail_sessions WHERE id_hash = ?', [hashSessionId(id)]);
        console.error('Failed to decrypt webmail session:', err);
        return null;
    }
};
exports.getSession = getSession;
const clearSession = async (req, res) => {
    const id = parseCookies(req.headers.cookie || '')[exports.SESSION_COOKIE];
    if (id) {
        await ensureSessionSchema();
        await db_1.pool.query('DELETE FROM webmail_sessions WHERE id_hash = ?', [hashSessionId(id)]);
    }
    res.setHeader('Set-Cookie', `${exports.SESSION_COOKIE}=; ${cookieOptions(0).join('; ')}`);
};
exports.clearSession = clearSession;
const requireSession = async (req, res, next) => {
    const session = await (0, exports.getSession)(req);
    if (!session) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    req.user = {
        username: session.username,
        password: session.password,
        isAdmin: session.isAdmin,
        isSuperAdmin: session.isSuperAdmin,
    };
    next();
};
exports.requireSession = requireSession;
const requireAdminSession = async (req, res, next) => {
    if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({ success: false, error: 'Forbidden: Admins only' });
    }
    try {
        const [rows] = await db_1.pool.query('SELECT superadmin FROM admin WHERE username = ? AND active = 1 LIMIT 1', [req.user.username]);
        if (rows.length === 0 || !(0, exports.hasGlobalAdminAccess)(rows[0])) {
            req.user.isAdmin = false;
            req.user.isSuperAdmin = false;
            return res.status(403).json({ success: false, error: 'Forbidden: Superadmins only' });
        }
        req.user.isSuperAdmin = true;
    }
    catch (err) {
        console.error('Failed to verify admin privileges:', err);
        return res.status(500).json({ success: false, error: 'Failed to verify admin privileges' });
    }
    next();
};
exports.requireAdminSession = requireAdminSession;
//# sourceMappingURL=auth.js.map