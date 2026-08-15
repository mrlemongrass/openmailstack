import { request as httpsRequest } from 'https';
export declare const MAX_CALENDAR_SUBSCRIPTION_REDIRECTS = 3;
export declare const MAX_CALENDAR_SUBSCRIPTION_FETCH_MS = 15000;
export declare const MAX_CALENDAR_SUBSCRIPTION_BODY_BYTES: number;
export declare const MAX_CALENDAR_SUBSCRIPTION_URL_BYTES = 4096;
export declare class CalendarSubscriptionHttpError extends Error {
    constructor(message: string);
}
export interface CalendarSubscriptionLookupAddress {
    address: string;
    family: number;
}
export interface CalendarSubscriptionHttpDependencies {
    lookup: (hostname: string) => Promise<CalendarSubscriptionLookupAddress[]>;
    request: typeof httpsRequest;
}
export interface CalendarSubscriptionFetchOptions {
    timeoutMs?: number;
    maxBodyBytes?: number;
    maxRedirects?: number;
    dependencies?: Partial<CalendarSubscriptionHttpDependencies>;
}
export declare function validateCalendarSubscriptionUrl(value: unknown): URL;
export declare function calendarSubscriptionLogLabel(value: unknown): string;
export declare function isPublicCalendarSubscriptionAddress(address: string): boolean;
export declare function fetchCalendarSubscription(value: unknown, options?: CalendarSubscriptionFetchOptions): Promise<Buffer>;
//# sourceMappingURL=calendar-subscription-http.d.ts.map