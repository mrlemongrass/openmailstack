import { type CalendarSubscriptionFetchOptions } from './calendar-subscription-http';
export declare const MAX_CALENDAR_SUBSCRIPTIONS_PER_RUN = 20;
export declare const MAX_CALENDAR_SUBSCRIPTION_RUN_MS: number;
export declare const MAX_CALENDAR_SUBSCRIPTION_EVENTS = 1000;
export interface CalendarSubscriptionWorkerDependencies {
    fetchSubscription: (url: unknown, options?: CalendarSubscriptionFetchOptions) => Promise<Buffer>;
    now: () => number;
}
export interface CalendarSubscriptionRunOutcome {
    status: 'synced' | 'pending' | 'error';
    error?: string;
}
export declare const ensureCalendarSubscriptionSchema: () => Promise<void>;
export declare const runCalendarSubscriptionFetchOnce: (overrides?: Partial<CalendarSubscriptionWorkerDependencies>, options?: {
    calendarId?: number;
    expectedSubscribedUrl?: string;
    expectedSyncToken?: string;
}) => Promise<CalendarSubscriptionRunOutcome | undefined>;
export declare const startCalendarSubscriptionWorker: () => void;
//# sourceMappingURL=calendar-subscription.d.ts.map