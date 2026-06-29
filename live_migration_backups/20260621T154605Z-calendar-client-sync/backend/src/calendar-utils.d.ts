export { formatActiveSyncDate, getCalendarFolderSyncKey, parseIcalEvent, slugifyCalendarName } from './calendar-format';
export interface CalendarRow {
    id: number;
    user_id: string;
    name: string;
    dav_slug?: string;
    color?: string;
    sync_token?: number;
    event_count?: number;
}
export declare function ensureCalendarSchema(): Promise<void>;
export declare function ensureCalendarSlug(calendar: CalendarRow): Promise<string>;
export declare function createCalendar(user: string, name: string, options?: {
    color?: string;
    slug?: string;
}): Promise<CalendarRow>;
export declare function ensureDefaultCalendar(user: string): Promise<CalendarRow>;
export declare function getCalendarByToken(user: string, token: string): Promise<CalendarRow | null>;
export declare function getVisibleCalendars(user: string): Promise<CalendarRow[]>;
export declare function getCalendarHref(user: string, calendar: CalendarRow): string;
//# sourceMappingURL=calendar-utils.d.ts.map