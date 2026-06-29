import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { normalizeMailboxUsername } from './config';
import { ImapService } from './imap';

const AUTH_CACHE_TTL_MS = 5 * 60 * 1000;
const authCache = new Map<string, number>();

function authCacheKey(user: string, pass: string): string {
    return createHash('sha256').update(user).update('\0').update(pass).digest('hex');
}

async function verifyCredentials(user: string, pass: string): Promise<boolean> {
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
        const imap = new ImapService(user, pass);
        await imap.connect();
        await imap.logout();
        authCache.set(key, now + AUTH_CACHE_TTL_MS);
        return true;
    } catch {
        authCache.delete(key);
        return false;
    }
}

export function davBasicAuth(realm: string) {
    return async (req: Request, res: Response, next: NextFunction) => {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Basic ')) {
            res.set('WWW-Authenticate', `Basic realm="${realm}"`);
            return res.status(401).send('Unauthorized');
        }

        const b64 = authHeader.split(' ')[1];
        const parts = Buffer.from(b64 || '', 'base64').toString().split(':');
        let user = parts.shift() || '';
        const pass = parts.join(':');

        user = normalizeMailboxUsername(user);
        if (!user.includes('@')) {
            return res.status(401).send('Unauthorized');
        }

        try {
            const isValid = await verifyCredentials(user, pass);
            if (!isValid) {
                return res.status(401).send('Unauthorized');
            }
            (req as any).user = user;
            next();
        } catch {
            return res.status(401).send('Unauthorized');
        }
    };
}
