export interface ParsedIcalEvent {
    uid: string;
    title: string;
    location: string;
    description: string;
    start: Date;
    end: Date;
    isAllDay: boolean;
    dtstamp: Date;
    recurrence: RecurrenceRule | null;
    recurrenceLabel: string;
    occurrenceId?: string;
    exdates?: Set<string>;
    attendees?: string;
    busyStatus?: string;
    notifications?: Array<{
        id: number;
        type: string;
        time: number;
    }>;
}
export interface RecurrenceRule {
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
    interval: number;
    count: number | null;
    until: Date | null;
    raw: string;
}
export declare function slugifyCalendarName(name: string): string;
export declare function parseIcalEvent(uid: string, ical: string): ParsedIcalEvent & {
    type?: 'event' | 'task';
};
export declare function expandRecurringEvent(event: ParsedIcalEvent, rangeStart: Date, rangeEnd: Date, maxOccurrences?: number): ParsedIcalEvent[];
export declare function formatActiveSyncDate(date: Date): string;
export declare function getCalendarFolderSyncKey(folders: Array<{
    serverId: string;
    displayName: string;
    type: string;
}>): string;
//# sourceMappingURL=calendar-format.d.ts.map