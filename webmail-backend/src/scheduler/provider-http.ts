import dns from 'node:dns/promises';
import https from 'node:https';
import net from 'node:net';
import type { LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';

export interface SchedulerProviderTarget {
    address: string;
    family: 4 | 6;
}

export interface SchedulerProviderHttpResponse {
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
}

export class SchedulerProviderRequestError extends Error {
    constructor(
        message: string,
        readonly code: string,
        readonly requestStarted: boolean,
    ) {
        super(message);
        this.name = 'SchedulerProviderRequestError';
    }
}

const blockedIpv4 = (address: string): boolean => {
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

export const isBlockedProviderAddress = (addressValue: string): boolean => {
    const address = String(addressValue || '').trim().toLowerCase();
    if (net.isIPv4(address)) return blockedIpv4(address);
    if (!net.isIPv6(address)) return true;
    const mapped = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return !net.isIPv4(mapped[1]) || blockedIpv4(mapped[1]);
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

type LookupAll = (hostname: string) => Promise<LookupAddress[]>;

export async function resolveProviderTarget(
    endpoint: URL,
    allowPrivateNetwork: boolean,
    lookupAll: LookupAll = hostname => dns.lookup(hostname, { all: true }),
): Promise<SchedulerProviderTarget> {
    const hostname = endpoint.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!allowPrivateNetwork && (hostname === 'localhost' || hostname.endsWith('.localhost'))) {
        throw new SchedulerProviderRequestError('Private provider endpoints are blocked', 'provider_private_network', false);
    }
    const directFamily = net.isIP(hostname);
    const addresses: LookupAddress[] = directFamily
        ? [{ address: hostname, family: directFamily } as LookupAddress]
        : await lookupAll(hostname).catch((error: any) => {
            throw new SchedulerProviderRequestError(
                String(error?.message || 'Provider hostname could not be resolved'),
                'provider_dns',
                false,
            );
        });
    if (!addresses.length) {
        throw new SchedulerProviderRequestError('Provider hostname did not resolve', 'provider_dns', false);
    }
    if (!allowPrivateNetwork && addresses.some(item => isBlockedProviderAddress(item.address))) {
        throw new SchedulerProviderRequestError('Private provider endpoints are blocked', 'provider_private_network', false);
    }
    const selected = addresses.find(item => allowPrivateNetwork || !isBlockedProviderAddress(item.address))!;
    return { address: selected.address, family: selected.family as 4 | 6 };
}

export const createPinnedLookup = (target: SchedulerProviderTarget): LookupFunction => (
    _hostname,
    options,
    callback,
): void => {
    if (options?.all) {
        callback(null, [{ address: target.address, family: target.family }]);
        return;
    }
    callback(null, target.address, target.family);
};

export async function postSchedulerProviderJson(
    endpoint: URL,
    headers: Record<string, string>,
    body: string,
    timeoutSeconds: number,
    allowPrivateNetwork: boolean,
    maxResponseBytes = 256 * 1024,
): Promise<SchedulerProviderHttpResponse> {
    const target = await resolveProviderTarget(endpoint, allowPrivateNetwork);
    const requestHostname = endpoint.hostname.replace(/^\[|\]$/g, '');
    return new Promise((resolve, reject) => {
        let requestStarted = false;
        const request = https.request({
            protocol: 'https:',
            hostname: requestHostname,
            port: endpoint.port ? Number(endpoint.port) : 443,
            path: `${endpoint.pathname}${endpoint.search}`,
            method: 'POST',
            headers: { ...headers, 'content-length': Buffer.byteLength(body) },
            lookup: createPinnedLookup(target),
            agent: false,
            servername: net.isIP(requestHostname) ? undefined : requestHostname,
            timeout: timeoutSeconds * 1000,
        }, response => {
            const chunks: Buffer[] = [];
            let size = 0;
            response.on('data', (chunk: Buffer) => {
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
        request.on('error', (error: any) => reject(new SchedulerProviderRequestError(
            String(error?.message || 'Provider request failed'),
            error?.message?.includes('response exceeded') ? 'provider_response_too_large'
                : error?.message?.includes('timed out') ? 'provider_timeout' : 'provider_network',
            requestStarted,
        )));
        request.end(body);
    });
}
