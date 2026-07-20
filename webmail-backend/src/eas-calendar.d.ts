import { type ParsedIcalEvent } from './calendar-format';
export interface ActiveSyncCalendarNode {
    tag: string;
    page: number;
    content?: string;
    children?: ActiveSyncCalendarNode[];
}
export declare function normalizeCalendarEventUid(value: string): string;
export declare function parseActiveSyncCalendarDate(value: string): Date | null;
export declare function activeSyncCalendarApplicationDataToIcal(uid: string, applicationData: any, existingIcal?: string): string;
export declare function calendarEventToActiveSyncApplicationData(event: ParsedIcalEvent): ActiveSyncCalendarNode[];
//# sourceMappingURL=eas-calendar.d.ts.map