export interface ParsedIcalEvent {
    uid: string;
    title: string;
    location: string;
    description: string;
    start: Date;
    end: Date;
    isAllDay: boolean;
    dtstamp: Date;
}
export declare function slugifyCalendarName(name: string): string;
export declare function parseIcalEvent(uid: string, ical: string): ParsedIcalEvent;
export declare function formatActiveSyncDate(date: Date): string;
export declare function getCalendarFolderSyncKey(folders: Array<{
    serverId: string;
    displayName: string;
    type: string;
}>): string;
//# sourceMappingURL=calendar-format.d.ts.map