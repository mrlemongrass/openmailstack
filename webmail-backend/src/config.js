"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPublicBaseUrl = exports.normalizeMailboxUsername = exports.sieveConfig = exports.smtpConfig = exports.imapConfig = exports.dbConfig = exports.serverConfig = void 0;
const parseNumber = (name, fallback) => {
    const raw = process.env[name];
    if (!raw)
        return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
        throw new Error(`${name} must be a number`);
    }
    return parsed;
};
const parseBoolean = (name, fallback) => {
    const raw = process.env[name];
    if (!raw)
        return fallback;
    return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
};
const required = (name) => {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is required`);
    }
    return value;
};
const optional = (name, fallback = '') => process.env[name] || fallback;
exports.serverConfig = {
    host: optional('OMS_WEBMAIL_HOST', '127.0.0.1'),
    port: parseNumber('OMS_WEBMAIL_PORT', 20000),
    publicBaseUrl: optional('OMS_PUBLIC_BASE_URL'),
    defaultDomain: optional('OMS_DEFAULT_DOMAIN'),
    sessionTtlMs: parseNumber('OMS_SESSION_TTL_SECONDS', 8 * 60 * 60) * 1000,
    sessionSecret: optional('OMS_SESSION_SECRET', required('OMS_DB_PASSWORD')),
    cookieSecure: parseBoolean('OMS_COOKIE_SECURE', process.env.NODE_ENV === 'production'),
    uploadLimitBytes: parseNumber('OMS_UPLOAD_LIMIT_BYTES', 25 * 1024 * 1024),
};
exports.dbConfig = {
    host: optional('OMS_DB_HOST', '127.0.0.1'),
    port: parseNumber('OMS_DB_PORT', 3306),
    user: optional('OMS_DB_USER', 'postfixadmin'),
    password: required('OMS_DB_PASSWORD'),
    database: optional('OMS_DB_NAME', 'postfixadmin'),
    connectionLimit: parseNumber('OMS_DB_CONNECTION_LIMIT', 10),
};
exports.imapConfig = {
    host: optional('OMS_IMAP_HOST', '127.0.0.1'),
    port: parseNumber('OMS_IMAP_PORT', 143),
    secure: parseBoolean('OMS_IMAP_SECURE', false),
    rejectUnauthorized: parseBoolean('OMS_IMAP_REJECT_UNAUTHORIZED', process.env.NODE_ENV === 'production'),
    masterUser: optional('OMS_IMAP_MASTER_USER'),
    masterPass: optional('OMS_IMAP_MASTER_PASS'),
};
exports.smtpConfig = {
    host: optional('OMS_SMTP_HOST', '127.0.0.1'),
    port: parseNumber('OMS_SMTP_PORT', 25),
    secure: parseBoolean('OMS_SMTP_SECURE', false),
    rejectUnauthorized: parseBoolean('OMS_SMTP_REJECT_UNAUTHORIZED', process.env.NODE_ENV === 'production'),
    masterUser: optional('OMS_SMTP_MASTER_USER'),
    masterPass: optional('OMS_SMTP_MASTER_PASS'),
};
exports.sieveConfig = {
    host: optional('OMS_SIEVE_HOST', '127.0.0.1'),
    port: parseNumber('OMS_SIEVE_PORT', 4190),
    masterUser: optional('OMS_SIEVE_MASTER_USER'),
    masterPass: optional('OMS_SIEVE_MASTER_PASS'),
};
const normalizeMailboxUsername = (rawUser) => {
    let user = rawUser;
    if (user.includes('\\')) {
        user = user.split('\\')[1];
    }
    if (!user.includes('@') && exports.serverConfig.defaultDomain) {
        user = `${user}@${exports.serverConfig.defaultDomain}`;
    }
    return user;
};
exports.normalizeMailboxUsername = normalizeMailboxUsername;
const getPublicBaseUrl = (req) => {
    if (exports.serverConfig.publicBaseUrl)
        return exports.serverConfig.publicBaseUrl.replace(/\/$/, '');
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return `${proto}://${host}`;
};
exports.getPublicBaseUrl = getPublicBaseUrl;
//# sourceMappingURL=config.js.map