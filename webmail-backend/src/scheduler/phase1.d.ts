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
    requiresConfirmation?: boolean;
    cancellationCutoffMinutes?: number | null;
    rescheduleCutoffMinutes?: number | null;
    requireCancellationReason?: boolean;
    requireRescheduleReason?: boolean;
    activeBookingLimit?: number | null;
    guestAllowList?: string[];
    guestDenyList?: string[];
    requireEmailVerification?: boolean;
    maxAdditionalGuests?: number;
    waitlistEnabled?: boolean;
    maxRecurrenceOccurrences?: number;
    publicAccentColor?: string;
    publicIntro?: string;
    privacyUrl?: string;
    termsUrl?: string;
    locale?: string;
    lockedTimeZone?: string | null;
    windows?: Array<{
        weekday: number;
        startMinute: number;
        endMinute: number;
    }>;
    questions?: SchedulerBookingQuestion[];
}
export type SchedulerBookingQuestionType = 'short_text' | 'long_text' | 'select';
export interface SchedulerBookingQuestion {
    id: string;
    label: string;
    type: SchedulerBookingQuestionType;
    required: boolean;
    options: string[];
}
export interface SchedulerBookingAnswerInput {
    questionId: string;
    value: string;
}
export interface SchedulerBookingAnswer extends SchedulerBookingAnswerInput {
    label: string;
    type: SchedulerBookingQuestionType;
}
export interface SchedulerAttendeeInput {
    name?: string;
    email: string;
}
export interface SchedulerAttendee {
    name: string;
    email: string;
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
    additionalAttendees?: SchedulerAttendee[];
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
export type SchedulerBookingActionScope = 'cancel' | 'reschedule';
export interface SchedulerBookingActionPolicy {
    allowed: boolean;
    cutoffMinutes: number | null;
    reasonRequired: boolean;
    closesAt: Date | null;
}
export declare function normalizeSchedulerHandle(value: string): string;
export declare function defaultSchedulerHandle(username: string): string;
export declare function normalizeSchedulerQuestions(value: unknown): SchedulerBookingQuestion[];
export declare function normalizeSchedulerBookingAnswers(questions: SchedulerBookingQuestion[], value: unknown): SchedulerBookingAnswer[];
export declare function normalizeSchedulerGuestRules(value: unknown): string[];
export declare class SchedulerGuestPolicyError extends Error {
}
export declare function assertSchedulerGuestEligible(email: string, allowList: string[], denyList: string[]): void;
export declare function normalizeSchedulerAttendees(value: unknown, bookerEmail: string, maximum: number): SchedulerAttendee[];
export declare function normalizeSchedulerEventInput(input: SchedulerEventInput): Required<Omit<SchedulerEventInput, 'destinationCalendarId'>> & {
    destinationCalendarId: number | null;
};
export declare function schedulerBookingActionPolicy(event: Partial<SchedulerEventInput>, scope: SchedulerBookingActionScope, start: Date, now?: Date): SchedulerBookingActionPolicy;
export declare function normalizeSchedulerActionReason(value: unknown, scope: SchedulerBookingActionScope, required: boolean): string;
export declare function assertTimeZone(timeZone: string): string;
export declare const schedulerTokenHash: (token: string) => string;
export declare const createSchedulerToken: () => string;
export declare function normalizePrivateLinkExpiry(value: unknown, now?: Date): Date | null;
export declare function normalizeOneOffAvailability(value: unknown, durationMinutes: number, now?: Date): SchedulerOneOffAvailability | null;
export declare function buildSchedulerCalendarEvent(event: BookingCalendarEvent): string;
export declare function schedulerPublicUrl(baseUrl: string, handle: string, slug?: string): string;
//# sourceMappingURL=phase1.d.ts.map