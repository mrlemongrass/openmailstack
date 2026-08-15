export interface ParsedIcalEvent {
    uid: string;
    title: string;
    location: string;
    description: string;
    start: Date;
    end: Date;
    isAllDay: boolean;
    timeKind: 'utc' | 'zoned' | 'floating' | 'all-day';
    timeZone: string | null;
    sourceTimeZone?: string;
    timeZoneStatus?: 'valid' | 'canonicalized' | 'unsupported' | 'invalid';
    dtstamp: Date;
    recurrence: RecurrenceRule | null;
    recurrenceLabel: string;
    occurrenceId?: string;
    exdates?: Set<string>;
    excludedOccurrenceIds?: Set<string>;
    recurrenceExceptions?: ParsedRecurrenceException[];
    attendees?: string;
    activeSyncAttendees?: Array<{
        email: string;
        name?: string;
        status?: string;
        type?: string;
    }>;
    organizerEmail?: string;
    organizerName?: string;
    categories?: string[];
    busyStatus?: string;
    activeSyncBusyStatus?: string;
    sensitivity?: string;
    meetingStatus?: string;
    responseRequested?: boolean;
    disallowNewTimeProposal?: boolean;
    activeSyncCalendarType?: string;
    activeSyncIsLeapMonth?: string;
    activeSyncRecurrenceDayOfWeekOmitted?: boolean;
    recurrenceExceptionOverflow?: boolean;
    notifications?: Array<{
        id: number;
        type: string;
        time: number;
    }>;
}
export interface ParsedRecurrenceException {
    recurrenceId: Date;
    deleted: boolean;
    event?: Omit<ParsedIcalEvent, 'recurrenceExceptions' | 'excludedOccurrenceIds' | 'exdates'>;
}
export interface RecurrenceRule {
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
    interval: number;
    count: number | null;
    until: Date | null;
    raw: string;
}
export declare function slugifyCalendarName(name: string): string;
export declare function extractIcalEventUid(ical: string): string | null;
export interface WallTimeParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}
export declare function wallTimeAt(instant: Date, timeZone: string): WallTimeParts;
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