const parseNumber = (name: string, fallback: number): number => {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
        throw new Error(`${name} must be a number`);
    }
    return parsed;
};

const parseBoolean = (name: string, fallback: boolean): boolean => {
    const raw = process.env[name];
    if (!raw) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
};

const required = (name: string): string => {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is required`);
    }
    return value;
};

const optional = (name: string, fallback = ''): string => process.env[name] || fallback;

const explicitSessionSecret = optional('OMS_SESSION_SECRET');
const sessionSecret = explicitSessionSecret || (
    process.env.NODE_ENV === 'production' ? '' : required('OMS_DB_PASSWORD')
);
if (process.env.NODE_ENV === 'production' && sessionSecret.length < 32) {
    throw new Error('Production requires OMS_SESSION_SECRET with at least 32 characters');
}

export const serverConfig = {
    host: optional('OMS_WEBMAIL_HOST', '127.0.0.1'),
    port: parseNumber('OMS_WEBMAIL_PORT', 20000),
    publicBaseUrl: optional('OMS_PUBLIC_BASE_URL'),
    defaultDomain: optional('OMS_DEFAULT_DOMAIN'),
    sessionTtlMs: parseNumber('OMS_SESSION_TTL_SECONDS', 8 * 60 * 60) * 1000,
    sessionSecret,
    cookieSecure: parseBoolean('OMS_COOKIE_SECURE', process.env.NODE_ENV === 'production'),
    uploadLimitBytes: parseNumber('OMS_UPLOAD_LIMIT_BYTES', 25 * 1024 * 1024),
    webhookSecret: optional('OMS_WEBHOOK_SECRET'),
};

const schedulerPublicBaseUrl = optional('OMS_SCHEDULER_PUBLIC_BASE_URL', serverConfig.publicBaseUrl).replace(/\/$/, '');
const schedulerPublicHost = schedulerPublicBaseUrl ? new URL(schedulerPublicBaseUrl).hostname.toLowerCase() : '';
const schedulerEnabled = parseBoolean('ENABLE_OMS_SCHEDULER', false);
const schedulerSecretKeyVersion = parseNumber('OMS_SCHEDULER_SECRET_KEY_VERSION', 1);
const schedulerSecretKey = optional('OMS_SCHEDULER_SECRET_KEY', schedulerEnabled ? '' : serverConfig.sessionSecret);
const schedulerSecretKeys: Record<number, string> = {};
for (const entry of optional('OMS_SCHEDULER_SECRET_KEYRING').split(',').map(value => value.trim()).filter(Boolean)) {
    const separator = entry.indexOf(':');
    const version = Number(entry.slice(0, separator));
    const key = entry.slice(separator + 1);
    if (separator < 1 || !Number.isInteger(version) || version < 1 || version > 65535 || key.length < 32) {
        throw new Error('OMS_SCHEDULER_SECRET_KEYRING must contain comma-separated version:key entries');
    }
    schedulerSecretKeys[version] = key;
}
if (schedulerSecretKey) schedulerSecretKeys[schedulerSecretKeyVersion] = schedulerSecretKey;

export const schedulerConfig = {
    enabled: schedulerEnabled,
    publicBaseUrl: schedulerPublicBaseUrl,
    allowedHosts: Array.from(new Set([
        schedulerPublicHost,
        ...optional('OMS_SCHEDULER_HOST_ALIASES')
            .split(',')
            .map((host) => host.trim().toLowerCase())
            .filter(Boolean),
    ].filter(Boolean))),
    notificationFrom: optional('OMS_SCHEDULER_NOTIFICATION_FROM', `scheduler@${serverConfig.defaultDomain || 'localhost'}`),
    smtpHost: optional('OMS_SCHEDULER_SMTP_HOST', optional('OMS_SMTP_HOST', '127.0.0.1')),
    smtpPort: parseNumber('OMS_SCHEDULER_SMTP_PORT', 25),
    smtpServerName: optional('OMS_SCHEDULER_SMTP_SERVER_NAME'),
    smtpRejectUnauthorized: parseBoolean('OMS_SCHEDULER_SMTP_REJECT_UNAUTHORIZED', true),
    secretKeys: {
        currentVersion: schedulerSecretKeyVersion,
        keys: schedulerSecretKeys,
    },
};

if (schedulerConfig.enabled && (!schedulerConfig.publicBaseUrl || schedulerConfig.allowedHosts.length === 0)) {
    throw new Error('Enabled OMS Scheduler requires OMS_SCHEDULER_PUBLIC_BASE_URL and at least one allowed hostname');
}

if (schedulerConfig.enabled && schedulerSecretKey.length < 32) {
    throw new Error('Enabled OMS Scheduler requires OMS_SCHEDULER_SECRET_KEY with at least 32 characters');
}

export const dbConfig = {
    host: optional('OMS_DB_HOST', '127.0.0.1'),
    port: parseNumber('OMS_DB_PORT', 3306),
    user: optional('OMS_DB_USER', 'postfixadmin'),
    password: required('OMS_DB_PASSWORD'),
    database: optional('OMS_DB_NAME', 'postfixadmin'),
    connectionLimit: parseNumber('OMS_DB_CONNECTION_LIMIT', 10),
};

export const imapConfig = {
    host: optional('OMS_IMAP_HOST', '127.0.0.1'),
    port: parseNumber('OMS_IMAP_PORT', 143),
    secure: parseBoolean('OMS_IMAP_SECURE', false),
    rejectUnauthorized: parseBoolean('OMS_IMAP_REJECT_UNAUTHORIZED', process.env.NODE_ENV === 'production'),
    masterUser: optional('OMS_IMAP_MASTER_USER'),
    masterPass: optional('OMS_IMAP_MASTER_PASS'),
};

export const smtpConfig = {
    host: optional('OMS_SMTP_HOST', '127.0.0.1'),
    port: parseNumber('OMS_SMTP_PORT', 25),
    secure: parseBoolean('OMS_SMTP_SECURE', false),
    serverName: optional('OMS_SMTP_SERVER_NAME'),
    rejectUnauthorized: parseBoolean('OMS_SMTP_REJECT_UNAUTHORIZED', process.env.NODE_ENV === 'production'),
    masterUser: optional('OMS_SMTP_MASTER_USER'),
    masterPass: optional('OMS_SMTP_MASTER_PASS'),
};

interface SmtpTransportConfig {
    host: string;
    port: number;
    secure: boolean;
    serverName: string;
    rejectUnauthorized: boolean;
    masterUser?: string;
    masterPass?: string;
}

export const smtpTransportOptions = (
    auth: { user: string; pass: string },
    config: SmtpTransportConfig = smtpConfig,
): Record<string, unknown> => {
    const delegatedAuth = config.masterUser && config.masterPass
        ? { user: `${auth.user}*${config.masterUser}`, pass: config.masterPass }
        : auth;
    return {
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: delegatedAuth,
        tls: {
            rejectUnauthorized: config.rejectUnauthorized,
            ...(config.serverName ? { servername: config.serverName } : {}),
        },
    };
};

export const sieveConfig = {
    host: optional('OMS_SIEVE_HOST', '127.0.0.1'),
    port: parseNumber('OMS_SIEVE_PORT', 4190),
    masterUser: optional('OMS_SIEVE_MASTER_USER'),
    masterPass: optional('OMS_SIEVE_MASTER_PASS'),
};

const validateCredentialPair = (userName: string, passName: string, user: string, pass: string) => {
    if (Boolean(user) !== Boolean(pass)) {
        throw new Error(`${userName} and ${passName} must be configured together`);
    }
};

validateCredentialPair('OMS_IMAP_MASTER_USER', 'OMS_IMAP_MASTER_PASS', imapConfig.masterUser, imapConfig.masterPass);
validateCredentialPair('OMS_SMTP_MASTER_USER', 'OMS_SMTP_MASTER_PASS', smtpConfig.masterUser, smtpConfig.masterPass);
validateCredentialPair('OMS_SIEVE_MASTER_USER', 'OMS_SIEVE_MASTER_PASS', sieveConfig.masterUser, sieveConfig.masterPass);

export const delegatedAuthEnabled = Boolean(
    imapConfig.masterUser && imapConfig.masterPass
    && smtpConfig.masterUser && smtpConfig.masterPass
    && sieveConfig.masterUser && sieveConfig.masterPass
);

export const normalizeMailboxUsername = (rawUser: string): string => {
    let user = rawUser;
    if (user.includes('\\')) {
        user = user.split('\\')[1];
    }
    if (!user.includes('@') && serverConfig.defaultDomain) {
        user = `${user}@${serverConfig.defaultDomain}`;
    }
    return user;
};

export const getPublicBaseUrl = (req: any): string => {
    if (serverConfig.publicBaseUrl) return serverConfig.publicBaseUrl.replace(/\/$/, '');
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return `${proto}://${host}`;
};
