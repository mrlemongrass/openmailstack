export interface SchedulerEventInput {
    title: string;
    slug?: string;
    description?: string;
    durationMinutes?: number;
    intervalMinutes?: number;
    bufferBeforeMinutes?: number;
    bufferAfterMinutes?: number;
    minimumNoticeMinutes?: number;
    capacity?: number;
    locationType?: 'in_person' | 'phone' | 'custom' | 'conference';
    locationLabel?: string;
    destinationCalendarId?: number | null;
    conflictCalendarIds?: number[];
    availabilityScheduleId?: string | null;
    visibility?: 'public' | 'unlisted' | 'private';
    active?: boolean;
    windows?: Array<{
        weekday: number;
        startMinute: number;
        endMinute: number;
    }>;
}
export interface BookingCalendarEvent {
    uid: string;
    title: string;
    description: string;
    location: string;
    start: Date;
    end: Date;
    hostEmail: string;
    bookerName: string;
    bookerEmail: string;
    sequence: number;
    cancelled?: boolean;
}
export interface SchedulerOneOffWindow {
    date: string;
    startMinute: number;
    endMinute: number;
}
export interface SchedulerOneOffAvailability {
    timeZone: string;
    windows: SchedulerOneOffWindow[];
}
export declare function normalizeSchedulerHandle(value: string): string;
export declare function defaultSchedulerHandle(username: string): string;
export declare function normalizeSchedulerEventInput(input: SchedulerEventInput): Required<Omit<SchedulerEventInput, 'destinationCalendarId'>> & {
    destinationCalendarId: number | null;
};
export declare function assertTimeZone(timeZone: string): string;
export declare const schedulerTokenHash: (token: string) => string;
export declare const createSchedulerToken: () => string;
export declare function normalizePrivateLinkExpiry(value: unknown, now?: Date): Date | null;
export declare function normalizeOneOffAvailability(value: unknown, durationMinutes: number, now?: Date): SchedulerOneOffAvailability | null;
export declare function buildSchedulerCalendarEvent(event: BookingCalendarEvent): string;
export declare function schedulerPublicUrl(baseUrl: string, handle: string, slug?: string): string;
//# sourceMappingURL=phase1.d.ts.map