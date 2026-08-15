"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CalendarSubscriptionHttpError = exports.MAX_CALENDAR_SUBSCRIPTION_URL_BYTES = exports.MAX_CALENDAR_SUBSCRIPTION_BODY_BYTES = exports.MAX_CALENDAR_SUBSCRIPTION_FETCH_MS = exports.MAX_CALENDAR_SUBSCRIPTION_REDIRECTS = void 0;
exports.validateCalendarSubscriptionUrl = validateCalendarSubscriptionUrl;
exports.calendarSubscriptionLogLabel = calendarSubscriptionLogLabel;
exports.isPublicCalendarSubscriptionAddress = isPublicCalendarSubscriptionAddress;
exports.fetchCalendarSubscription = fetchCalendarSubscription;
const promises_1 = require("dns/promises");
const https_1 = require("https");
const net_1 = require("net");
const calendar_ical_validation_1 = require("./calendar-ical-validation");
exports.MAX_CALENDAR_SUBSCRIPTION_REDIRECTS = 3;
exports.MAX_CALENDAR_SUBSCRIPTION_FETCH_MS = 15_000;
exports.MAX_CALENDAR_SUBSCRIPTION_BODY_BYTES = calendar_ical_validation_1.MAX_ICAL_DOCUMENT_BYTES;
exports.MAX_CALENDAR_SUBSCRIPTION_URL_BYTES = 4096;
class CalendarSubscriptionHttpError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CalendarSubscriptionHttpError';
    }
}
exports.CalendarSubscriptionHttpError = CalendarSubscriptionHttpError;
function normalizeRedirectLimit(value) {
    if (value === undefined)
        return exports.MAX_CALENDAR_SUBSCRIPTION_REDIRECTS;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
        httpError('Calendar subscription redirect limit is invalid');
    }
    return Math.max(0, Math.min(numeric, exports.MAX_CALENDAR_SUBSCRIPTION_REDIRECTS));
}
const defaultDependencies = {
    lookup: async (hostname) => (0, promises_1.lookup)(hostname, { all: true, verbatim: true }),
    request: https_1.request,
};
function httpError(message) {
    throw new CalendarSubscriptionHttpError(message);
}
function hostnameWithoutBrackets(hostname) {
    return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}
function validateCalendarSubscriptionUrl(value) {
    if (typeof value !== 'string' || !value.trim()
        || Buffer.byteLength(value.trim(), 'utf8') > exports.MAX_CALENDAR_SUBSCRIPTION_URL_BYTES) {
        httpError('Calendar subscription URL is invalid');
    }
    let parsed;
    try {
        parsed = new URL(value.trim());
    }
    catch {
        httpError('Calendar subscription URL is invalid');
    }
    if (parsed.protocol !== 'https:')
        httpError('Calendar subscription URL must use HTTPS');
    if (parsed.username || parsed.password)
        httpError('Calendar subscription URL cannot contain credentials');
    if (!parsed.hostname)
        httpError('Calendar subscription URL is invalid');
    return parsed;
}
function calendarSubscriptionLogLabel(value) {
    try {
        return hostnameWithoutBrackets(validateCalendarSubscriptionUrl(value).hostname);
    }
    catch {
        return 'invalid-target';
    }
}
function parseIpv4(address) {
    if ((0, net_1.isIP)(address) !== 4)
        return null;
    const octets = address.split('.').map(Number);
    return octets.length === 4 ? octets : null;
}
function ipv4IsPublic(address) {
    const octets = parseIpv4(address);
    if (!octets)
        return false;
    const [a, b, c] = octets;
    if (a === 0 || a === 10 || a === 127 || a >= 224)
        return false;
    if (a === 100 && b >= 64 && b <= 127)
        return false;
    if (a === 169 && b === 254)
        return false;
    if (a === 172 && b >= 16 && b <= 31)
        return false;
    if (a === 192 && b === 168)
        return false;
    if (a === 192 && b === 0 && c === 0)
        return false;
    if (a === 192 && b === 0 && c === 2)
        return false;
    if (a === 192 && b === 88 && c === 99)
        return false;
    if (a === 198 && (b === 18 || b === 19))
        return false;
    if (a === 198 && b === 51 && c === 100)
        return false;
    if (a === 203 && b === 0 && c === 113)
        return false;
    return true;
}
function ipv6ToBigInt(address) {
    let source = hostnameWithoutBrackets(address).toLowerCase();
    if (source.includes('%') || (0, net_1.isIP)(source) !== 6)
        return null;
    const ipv4Tail = source.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (ipv4Tail) {
        const octets = parseIpv4(ipv4Tail);
        if (!octets)
            return null;
        const replacement = `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
        source = `${source.slice(0, source.length - ipv4Tail.length)}${replacement}`;
    }
    const halves = source.split('::');
    if (halves.length > 2)
        return null;
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const missing = 8 - head.length - tail.length;
    if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1))
        return null;
    const parts = [...head, ...Array(missing).fill('0'), ...tail];
    if (parts.length !== 8 || parts.some(part => !/^[0-9a-f]{1,4}$/.test(part)))
        return null;
    return parts.reduce((value, part) => (value << 16n) | BigInt(`0x${part}`), 0n);
}
function ipv6Prefix(value, prefix, length) {
    const network = ipv6ToBigInt(prefix);
    return network !== null && (value >> BigInt(128 - length)) === (network >> BigInt(128 - length));
}
function ipv6IsPublic(address) {
    const value = ipv6ToBigInt(address);
    if (value === null)
        return false;
    // Current globally routed unicast space is 2000::/3. Reject transition,
    // documentation, and special-purpose allocations within it as well.
    if ((value >> 125n) !== 1n)
        return false;
    if (ipv6Prefix(value, '2001:0000::', 32))
        return false; // Teredo
    if (ipv6Prefix(value, '2001:0002::', 48))
        return false; // benchmarking
    if (ipv6Prefix(value, '2001:0010::', 28))
        return false; // ORCHIDv1
    if (ipv6Prefix(value, '2001:0020::', 28))
        return false; // ORCHIDv2
    if (ipv6Prefix(value, '2001:0db8::', 32))
        return false; // documentation
    if (ipv6Prefix(value, '2002::', 16))
        return false; // 6to4 can embed private IPv4
    if (ipv6Prefix(value, '3fff::', 20))
        return false; // documentation
    return true;
}
function isPublicCalendarSubscriptionAddress(address) {
    const normalized = hostnameWithoutBrackets(address);
    if ((0, net_1.isIP)(normalized) === 4)
        return ipv4IsPublic(normalized);
    if ((0, net_1.isIP)(normalized) === 6)
        return ipv6IsPublic(normalized);
    return false;
}
function deadlinePromise(promise, deadline, message) {
    const remaining = deadline - Date.now();
    if (remaining <= 0)
        return Promise.reject(new CalendarSubscriptionHttpError(message));
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new CalendarSubscriptionHttpError(message)), remaining);
        promise.then(value => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); reject(new CalendarSubscriptionHttpError(message)); });
    });
}
async function resolvePinnedAddress(url, dependencies, deadline) {
    const hostname = hostnameWithoutBrackets(url.hostname);
    const literalFamily = (0, net_1.isIP)(hostname);
    const addresses = literalFamily
        ? [{ address: hostname, family: literalFamily }]
        : await deadlinePromise(dependencies.lookup(hostname), deadline, 'Calendar subscription DNS lookup timed out');
    if (!Array.isArray(addresses) || addresses.length === 0
        || addresses.some(result => !isPublicCalendarSubscriptionAddress(result.address))) {
        httpError('Calendar subscription host must resolve only to public addresses');
    }
    const selected = addresses[0];
    const family = (0, net_1.isIP)(selected.address);
    if ((family !== 4 && family !== 6) || (selected.family !== 4 && selected.family !== 6)) {
        httpError('Calendar subscription DNS response is invalid');
    }
    return { address: selected.address, family };
}
function requestPinned(url, pinned, dependencies, deadline, maxBodyBytes) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let request;
        const finish = (error, value) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (error)
                reject(error);
            else
                resolve(value);
        };
        const remaining = deadline - Date.now();
        if (remaining <= 0)
            return reject(new CalendarSubscriptionHttpError('Calendar subscription request timed out'));
        const timer = setTimeout(() => {
            request?.destroy(new CalendarSubscriptionHttpError('Calendar subscription request timed out'));
        }, remaining);
        try {
            request = dependencies.request({
                protocol: 'https:',
                hostname: hostnameWithoutBrackets(url.hostname),
                port: url.port || 443,
                method: 'GET',
                path: `${url.pathname}${url.search}`,
                agent: false,
                servername: (0, net_1.isIP)(hostnameWithoutBrackets(url.hostname)) ? undefined : hostnameWithoutBrackets(url.hostname),
                headers: {
                    Accept: 'text/calendar, application/calendar+json;q=0.1',
                    'User-Agent': 'OpenMailStack-CalendarSubscription/1.0',
                },
                lookup: ((_, options, callback) => {
                    if (options?.all)
                        callback(null, [{ address: pinned.address, family: pinned.family }]);
                    else
                        callback(null, pinned.address, pinned.family);
                }),
            }, (response) => {
                const status = Number(response.statusCode || 0);
                if ([301, 302, 303, 307, 308].includes(status)) {
                    const location = response.headers.location;
                    response.destroy();
                    if (!location)
                        return finish(new CalendarSubscriptionHttpError('Calendar subscription redirect is invalid'));
                    return finish(null, { redirect: location });
                }
                if (status < 200 || status >= 300) {
                    response.destroy();
                    return finish(new CalendarSubscriptionHttpError(`Calendar subscription returned HTTP ${status || 'error'}`));
                }
                const contentLengthValue = Array.isArray(response.headers['content-length'])
                    ? response.headers['content-length'][0]
                    : response.headers['content-length'];
                if (contentLengthValue !== undefined) {
                    const contentLength = Number(contentLengthValue);
                    if (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > maxBodyBytes) {
                        response.destroy();
                        return finish(new CalendarSubscriptionHttpError('Calendar subscription response is too large'));
                    }
                }
                const chunks = [];
                let received = 0;
                response.on('data', chunk => {
                    if (settled)
                        return;
                    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    received += buffer.length;
                    if (received > maxBodyBytes) {
                        response.destroy();
                        finish(new CalendarSubscriptionHttpError('Calendar subscription response is too large'));
                        return;
                    }
                    chunks.push(buffer);
                });
                response.once('end', () => finish(null, { body: Buffer.concat(chunks, received) }));
                response.once('error', () => finish(new CalendarSubscriptionHttpError('Calendar subscription response failed')));
            });
            request.once('error', error => finish(error instanceof CalendarSubscriptionHttpError
                ? error
                : new CalendarSubscriptionHttpError('Calendar subscription request failed')));
            request.end();
        }
        catch {
            finish(new CalendarSubscriptionHttpError('Calendar subscription request failed'));
        }
    });
}
async function fetchCalendarSubscription(value, options = {}) {
    const dependencies = { ...defaultDependencies, ...(options.dependencies || {}) };
    const timeoutMs = Math.max(1, Math.min(Number(options.timeoutMs) || exports.MAX_CALENDAR_SUBSCRIPTION_FETCH_MS, exports.MAX_CALENDAR_SUBSCRIPTION_FETCH_MS));
    const maxBodyBytes = Math.max(1, Math.min(Number(options.maxBodyBytes) || exports.MAX_CALENDAR_SUBSCRIPTION_BODY_BYTES, exports.MAX_CALENDAR_SUBSCRIPTION_BODY_BYTES));
    const maxRedirects = normalizeRedirectLimit(options.maxRedirects);
    const deadline = Date.now() + timeoutMs;
    let current = validateCalendarSubscriptionUrl(value);
    try {
        for (let redirectCount = 0;; redirectCount += 1) {
            const pinned = await resolvePinnedAddress(current, dependencies, deadline);
            const result = await requestPinned(current, pinned, dependencies, deadline, maxBodyBytes);
            if (result.body)
                return result.body;
            if (!result.redirect || redirectCount >= maxRedirects) {
                httpError('Calendar subscription exceeded the redirect limit');
            }
            try {
                current = validateCalendarSubscriptionUrl(new URL(result.redirect, current).toString());
            }
            catch (error) {
                if (error instanceof CalendarSubscriptionHttpError)
                    throw error;
                httpError('Calendar subscription redirect is invalid');
            }
        }
    }
    catch (error) {
        if (error instanceof CalendarSubscriptionHttpError)
            throw error;
        throw new CalendarSubscriptionHttpError('Calendar subscription request failed');
    }
}
//# sourceMappingURL=calendar-subscription-http.js.map