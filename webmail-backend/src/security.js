"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateLimit = exports.securityHeaders = void 0;
const securityHeaders = (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
};
exports.securityHeaders = securityHeaders;
const rateLimit = (windowMs, maxRequests) => {
    const buckets = new Map();
    return (req, res, next) => {
        const now = Date.now();
        const key = req.ip || req.socket?.remoteAddress || 'unknown';
        const bucket = buckets.get(key);
        if (!bucket || bucket.resetAt <= now) {
            buckets.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }
        if (bucket.count >= maxRequests) {
            res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000).toString());
            return res.status(429).json({ success: false, error: 'Too many requests' });
        }
        bucket.count += 1;
        next();
    };
};
exports.rateLimit = rateLimit;
//# sourceMappingURL=security.js.map