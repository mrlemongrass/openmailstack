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
export declare class SchedulerProviderRequestError extends Error {
    readonly code: string;
    readonly requestStarted: boolean;
    constructor(message: string, code: string, requestStarted: boolean);
}
export declare const isBlockedProviderAddress: (addressValue: string) => boolean;
type LookupAll = (hostname: string) => Promise<LookupAddress[]>;
export declare function resolveProviderTarget(endpoint: URL, allowPrivateNetwork: boolean, lookupAll?: LookupAll): Promise<SchedulerProviderTarget>;
export declare const createPinnedLookup: (target: SchedulerProviderTarget) => LookupFunction;
export declare function postSchedulerProviderJson(endpoint: URL, headers: Record<string, string>, body: string, timeoutSeconds: number, allowPrivateNetwork: boolean, maxResponseBytes?: number): Promise<SchedulerProviderHttpResponse>;
export {};
//# sourceMappingURL=provider-http.d.ts.map