import type { PoolConnection } from 'mysql2/promise';
export { expandRecurringEvent, extractIcalEventUid, formatActiveSyncDate, getCalendarFolderSyncKey, parseIcalEvent, slugifyCalendarName } from './calendar-format';
export interface CalendarRow {
    id: number;
    user_id: string;
    name: string;
    dav_slug?: string;
    components?: string;
    color?: string;
    sync_token?: number;
    event_count?: number;
    access_role?: string;
    subscribed_url?: string;
}
export type CalendarMutationConnection = Pick<PoolConnection, 'query'>;
export declare function isReservedManagedCalendarSlug(value: string): boolean;
/**
 * Allocate the one collection revision shared by every event/tombstone changed
 * in the caller's transaction. Callers must roll the transaction back when no
 * durable calendar resource changed.
 */
export declare function allocateCalendarCollectionRevisionOnConnection(connection: CalendarMutationConnection, calendarId: string | number): Promise<number>;
export declare function ensureCalendarSchema(): Promise<void>;
export declare function ensureCalendarSlug(calendar: CalendarRow): Promise<string>;
export declare function createCalendar(user: string, name: string, options?: {
    color?: string;
    slug?: string;
    components?: string;
    subscribed_url?: string;
}): Promise<CalendarRow>;
export declare function ensureDefaultCalendar(user: string): Promise<CalendarRow>;
export declare function getCalendarByToken(user: string, token: string): Promise<CalendarRow | null>;
export declare function getVisibleCalendars(user: string): Promise<CalendarRow[]>;
export declare function getCalendarHref(user: string, calendar: CalendarRow): string;
//# sourceMappingURL=calendar-utils.d.ts.map