"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPinnedLookup = exports.isBlockedProviderAddress = exports.SchedulerProviderRequestError = void 0;
exports.resolveProviderTarget = resolveProviderTarget;
exports.postSchedulerProviderJson = postSchedulerProviderJson;
const promises_1 = __importDefault(require("node:dns/promises"));
const node_https_1 = __importDefault(require("node:https"));
const node_net_1 = __importDefault(require("node:net"));
class SchedulerProviderRequestError extends Error {
    code;
    requestStarted;
    constructor(message, code, requestStarted) {
        super(message);
        this.code = code;
        this.requestStarted = requestStarted;
        this.name = 'SchedulerProviderRequestError';
    }
}
exports.SchedulerProviderRequestError = SchedulerProviderRequestError;
const blockedIpv4 = (address) => {
    const parts = address.split('.').map(Number);
    const [a, b, c] = parts;
    return a === 0 || a === 10 || a === 127 || a >= 224
        || (a === 100 && b >= 64 && b <= 127)
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && ((b === 0 && (c === 0 || c === 2)) || b === 168))
        || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
        || (a === 203 && b === 0 && c === 113);
};
const isBlockedProviderAddress = (addressValue) => {
    const address = String(addressValue || '').trim().toLowerCase();
    if (node_net_1.default.isIPv4(address))
        return blockedIpv4(address);
    if (!node_net_1.default.isIPv6(address))
        return true;
    const mapped = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped)
        return !node_net_1.default.isIPv4(mapped[1]) || blockedIpv4(mapped[1]);
    const mappedHex = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
        const value = (Number.parseInt(mappedHex[1], 16) << 16) + Number.parseInt(mappedHex[2], 16);
        return blockedIpv4([
            (value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255,
        ].join('.'));
    }
    return address === '::' || address === '::1'
        || address.startsWith('fc') || address.startsWith('fd')
        || /^fe[89ab]/.test(address)
        || address.startsWith('ff')
        || address.startsWith('2001:db8:');
};
exports.isBlockedProviderAddress = isBlockedProviderAddress;
async function resolveProviderTarget(endpoint, allowPrivateNetwork, lookupAll = hostname => promises_1.default.lookup(hostname, { all: true })) {
    const hostname = endpoint.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!allowPrivateNetwork && (hostname === 'localhost' || hostname.endsWith('.localhost'))) {
        throw new SchedulerProviderRequestError('Private provider endpoints are blocked', 'provider_private_network', false);
    }
    const directFamily = node_net_1.default.isIP(hostname);
    const addresses = directFamily
        ? [{ address: hostname, family: directFamily }]
        : await lookupAll(hostname).catch((error) => {
            throw new SchedulerProviderRequestError(String(error?.message || 'Provider hostname could not be resolved'), 'provider_dns', false);
        });
    if (!addresses.length) {
        throw new SchedulerProviderRequestError('Provider hostname did not resolve', 'provider_dns', false);
    }
    if (!allowPrivateNetwork && addresses.some(item => (0, exports.isBlockedProviderAddress)(item.address))) {
        throw new SchedulerProviderRequestError('Private provider endpoints are blocked', 'provider_private_network', false);
    }
    const selected = addresses.find(item => allowPrivateNetwork || !(0, exports.isBlockedProviderAddress)(item.address));
    return { address: selected.address, family: selected.family };
}
const createPinnedLookup = (target) => (_hostname, options, callback) => {
    if (options?.all) {
        callback(null, [{ address: target.address, family: target.family }]);
        return;
    }
    callback(null, target.address, target.family);
};
exports.createPinnedLookup = createPinnedLookup;
async function postSchedulerProviderJson(endpoint, headers, body, timeoutSeconds, allowPrivateNetwork, maxResponseBytes = 256 * 1024) {
    const target = await resolveProviderTarget(endpoint, allowPrivateNetwork);
    const requestHostname = endpoint.hostname.replace(/^\[|\]$/g, '');
    return new Promise((resolve, reject) => {
        let requestStarted = false;
        const request = node_https_1.default.request({
            protocol: 'https:',
            hostname: requestHostname,
            port: endpoint.port ? Number(endpoint.port) : 443,
            path: `${endpoint.pathname}${endpoint.search}`,
            method: 'POST',
            headers: { ...headers, 'content-length': Buffer.byteLength(body) },
            lookup: (0, exports.createPinnedLookup)(target),
            agent: false,
            servername: node_net_1.default.isIP(requestHostname) ? undefined : requestHostname,
            timeout: timeoutSeconds * 1000,
        }, response => {
            const chunks = [];
            let size = 0;
            response.on('data', (chunk) => {
                size += chunk.length;
                if (size > maxResponseBytes) {
                    response.destroy(new Error('Provider response exceeded the allowed size'));
                    return;
                }
                chunks.push(Buffer.from(chunk));
            });
            response.on('end', () => resolve({
                status: response.statusCode || 0,
                headers: response.headers,
                body: Buffer.concat(chunks).toString('utf8'),
            }));
        });
        request.once('finish', () => { requestStarted = true; });
        request.on('timeout', () => request.destroy(new Error('Provider request timed out')));
        request.on('error', (error) => reject(new SchedulerProviderRequestError(String(error?.message || 'Provider request failed'), error?.message?.includes('response exceeded') ? 'provider_response_too_large'
            : error?.message?.includes('timed out') ? 'provider_timeout' : 'provider_network', requestStarted)));
        request.end(body);
    });
}
//# sourceMappingURL=provider-http.js.map