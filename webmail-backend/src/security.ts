export const securityHeaders = (_req: any, res: any, next: any) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
};

export const rateLimit = (windowMs: number, maxRequests: number) => {
    const buckets = new Map<string, { count: number; resetAt: number }>();

    return (req: any, res: any, next: any) => {
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
