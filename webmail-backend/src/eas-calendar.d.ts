import { type ParsedIcalEvent } from './calendar-format';
export interface ActiveSyncCalendarNode {
    tag: string;
    page: number;
    content?: string;
    children?: ActiveSyncCalendarNode[];
}
export declare const MAX_ACTIVE_SYNC_CALENDAR_BODY_BYTES: number;
export declare const MAX_ACTIVE_SYNC_CALENDAR_EXCEPTIONS = 256;
export declare class ActiveSyncCalendarFieldError extends Error {
    constructor();
}
export declare const canWriteActiveSyncCalendar: (accessRole: unknown) => boolean;
export declare const normalizeCalendarSharePermission: (value: unknown) => "read" | "write" | null;
export declare function resolveActiveSyncCalendarAccessRole(row: {
    user_id?: unknown;
    dav_slug?: unknown;
    subscribed_url?: unknown;
    permission?: unknown;
} | null | undefined, user: string): 'owner' | 'read' | 'write' | null;
export declare function normalizeCalendarEventUid(value: string): string;
export declare function parseActiveSyncCalendarDate(value: string): Date | null;
export declare function activeSyncCalendarApplicationDataToIcal(uid: string, applicationData: any, existingIcal?: string, omittedFieldsToClear?: ReadonlySet<string>): string;
export declare function calendarEventToActiveSyncApplicationData(event: ParsedIcalEvent): ActiveSyncCalendarNode[];
export declare function storedIcalEventToActiveSyncApplicationData(storageUid: string, ical: string): ActiveSyncCalendarNode[];
//# sourceMappingURL=eas-calendar.d.ts.map