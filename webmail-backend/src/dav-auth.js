"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.davBasicAuth = davBasicAuth;
const crypto_1 = require("crypto");
const config_1 = require("./config");
const imap_1 = require("./imap");
const AUTH_CACHE_TTL_MS = 5 * 60 * 1000;
const authCache = new Map();
function authCacheKey(user, pass) {
    return (0, crypto_1.createHash)('sha256').update(user).update('\0').update(pass).digest('hex');
}
async function verifyCredentials(user, pass) {
    const key = authCacheKey(user, pass);
    const now = Date.now();
    for (const [cachedKey, cachedExpiresAt] of authCache) {
        if (cachedExpiresAt <= now) {
            authCache.delete(cachedKey);
        }
    }
    const expiresAt = authCache.get(key);
    if (expiresAt && expiresAt > now) {
        return true;
    }
    try {
        const imap = new imap_1.ImapService(user, pass);
        await imap.connect();
        await imap.logout();
        authCache.set(key, now + AUTH_CACHE_TTL_MS);
        return true;
    }
    catch {
        authCache.delete(key);
        return false;
    }
}
function davBasicAuth(realm) {
    return async (req, res, next) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Basic ')) {
            res.set('WWW-Authenticate', `Basic realm="${realm}"`);
            return res.status(401).send('Unauthorized');
        }
        const b64 = authHeader.split(' ')[1];
        const parts = Buffer.from(b64 || '', 'base64').toString().split(':');
        let user = parts.shift() || '';
        const pass = parts.join(':');
        user = (0, config_1.normalizeMailboxUsername)(user);
        if (!user.includes('@')) {
            return res.status(401).send('Unauthorized');
        }
        try {
            const isValid = await verifyCredentials(user, pass);
            if (!isValid) {
                return res.status(401).send('Unauthorized');
            }
            req.user = user;
            next();
        }
        catch {
            return res.status(401).send('Unauthorized');
        }
    };
}
//# sourceMappingURL=dav-auth.js.map