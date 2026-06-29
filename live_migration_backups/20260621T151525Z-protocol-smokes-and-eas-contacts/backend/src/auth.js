"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAdminSession = exports.requireSession = exports.clearSession = exports.getSession = exports.createSession = exports.SESSION_COOKIE = void 0;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("./db");
const config_1 = require("./config");
exports.SESSION_COOKIE = 'oms_session';
let schemaPromise = null;
const ensureSessionSchema = async () => {
    if (!schemaPromise) {
        schemaPromise = db_1.pool.query(`
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
        `).then(() => undefined);
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
const toMysqlDate = (timestamp) => new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ');
const cleanupExpiredSessions = async () => {
    await ensureSessionSchema();
    await db_1.pool.query('DELETE FROM webmail_sessions WHERE expires_at <= NOW()');
};
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
    const [rows] = await db_1.pool.query(`SELECT username, password_ciphertext, password_iv, password_tag, is_admin, expires_at
         FROM webmail_sessions
         WHERE id_hash = ? AND expires_at > NOW()
         LIMIT 1`, [hashSessionId(id)]);
    if (rows.length === 0) {
        await db_1.pool.query('DELETE FROM webmail_sessions WHERE id_hash = ?', [hashSessionId(id)]);
        return null;
    }
    const row = rows[0];
    const expiresAt = Date.now() + config_1.serverConfig.sessionTtlMs;
    await db_1.pool.query('UPDATE webmail_sessions SET expires_at = ? WHERE id_hash = ?', [toMysqlDate(expiresAt), hashSessionId(id)]);
    try {
        return {
            id,
            username: row.username,
            password: decryptPassword(row.password_ciphertext, row.password_iv, row.password_tag),
            isAdmin: !!row.is_admin,
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
    };
    next();
};
exports.requireSession = requireSession;
const requireAdminSession = (req, res, next) => {
    if (!req.user || !req.user.isAdmin) {
        return res.status(403).json({ success: false, error: 'Forbidden: Admins only' });
    }
    next();
};
exports.requireAdminSession = requireAdminSession;
//# sourceMappingURL=auth.js.map