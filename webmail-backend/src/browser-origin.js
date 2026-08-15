"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.browserRequestHasSameOrigin = browserRequestHasSameOrigin;
exports.requireSameOriginBrowserRequest = requireSameOriginBrowserRequest;
exports.allowSameOriginSocketRequest = allowSameOriginSocketRequest;
const ORIGIN_ONLY = /^(https?):\/\/(\[[0-9a-f:.]+\]|[^\s\/?#@:]+)(?::([0-9]{1,5}))?$/i;
function normalizedOrigin(value) {
    if (!value || value !== value.trim() || value === 'null' || !ORIGIN_ONLY.test(value))
        return null;
    try {
        const parsed = new URL(value);
        if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
            || parsed.username
            || parsed.password
            || !parsed.hostname
            || parsed.pathname !== '/'
            || parsed.search
            || parsed.hash)
            return null;
        return {
            protocol: parsed.protocol,
            hostname: parsed.hostname.toLowerCase(),
            port: parsed.port || (parsed.protocol === 'https:' ? '443' : '80'),
        };
    }
    catch {
        return null;
    }
}
function requestTargetOrigin(req) {
    const host = req.headers.host;
    const forwardedProto = req.headers['x-forwarded-proto'];
    if (typeof host !== 'string' || !host || Array.isArray(forwardedProto))
        return null;
    const scheme = forwardedProto === undefined
        ? (req.socket.encrypted ? 'https' : 'http')
        : forwardedProto;
    if (scheme !== 'http' && scheme !== 'https')
        return null;
    return normalizedOrigin(`${scheme}://${host}`);
}
function browserRequestHasSameOrigin(req) {
    const origin = req.headers.origin;
    if (origin === undefined) {
        const fetchSite = req.headers['sec-fetch-site'];
        if (fetchSite === undefined)
            return true;
        return typeof fetchSite === 'string' && (fetchSite === 'same-origin' || fetchSite === 'none');
    }
    if (typeof origin !== 'string')
        return false;
    const supplied = normalizedOrigin(origin);
    const target = requestTargetOrigin(req);
    return Boolean(supplied
        && target
        && supplied.protocol === target.protocol
        && supplied.hostname === target.hostname
        && supplied.port === target.port);
}
function requireSameOriginBrowserRequest(req, res, next) {
    if (browserRequestHasSameOrigin(req)) {
        next();
        return;
    }
    res.status(403).json({ success: false, error: 'Forbidden' });
}
function allowSameOriginSocketRequest(req, callback) {
    callback(null, browserRequestHasSameOrigin(req));
}
//# sourceMappingURL=browser-origin.js.map