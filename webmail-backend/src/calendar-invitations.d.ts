export type CalendarInvitationRole = 'organizer' | 'attendee' | 'unowned';
export type CalendarInvitationResponse = 'needs-action' | 'accepted' | 'tentative' | 'declined';
export type CalendarInvitationAttendeeRole = 'required' | 'optional' | 'non-participant';
export type CalendarInvitationMethod = 'REPLY' | 'CANCEL' | 'COUNTER';
export interface CalendarInvitationAttendee {
    email: string;
    name?: string;
    response: CalendarInvitationResponse;
    role: CalendarInvitationAttendeeRole;
}
export interface CalendarInvitationProjection {
    role: CalendarInvitationRole;
    organizerEmail: string;
    organizerName?: string;
    attendeeEmail?: string;
    response?: CalendarInvitationResponse;
    responseRequested: boolean;
    attendees: CalendarInvitationAttendee[];
    attendeeCount: number;
    attendeesTruncated: boolean;
    recurring: boolean;
    canRespond: boolean;
    canCancel: boolean;
    canCancelOccurrence: boolean;
    seriesResponse?: Exclude<CalendarInvitationResponse, 'needs-action'>;
    actionUnavailableReason?: string;
    canProposeNewTime: boolean;
    canForward: boolean;
    sequence: number;
}
export interface CalendarInvitationDelivery {
    method: CalendarInvitationMethod;
    sender: string;
    recipients: string[];
    subject: string;
    text: string;
    ical: string;
}
export declare class CalendarInvitationActionError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(code: string, message: string, status?: number);
}
interface InvitationRuntime {
    now?: () => Date;
}
export declare function projectCalendarInvitation(source: string, ownedAddresses: string[], occurrenceId?: string): CalendarInvitationProjection | null;
export declare function projectCalendarInvitationOccurrences(source: string, ownedAddresses: string[], occurrenceIds: Array<string | undefined>): Array<CalendarInvitationProjection | null>;
export declare function prepareInvitationResponse(source: string, ownedAddresses: string[], response: Exclude<CalendarInvitationResponse, 'needs-action'>, runtime?: InvitationRuntime): {
    updatedIcal: string;
    delivery: CalendarInvitationDelivery;
    alreadyResponded: boolean;
};
export declare function calendarRecurrenceIdLine(source: string, value: string): string;
export declare function calendarInvitationActionStateFingerprint(source: string, actorAddress: string, action: {
    action: 'respond';
    response: 'accepted' | 'tentative' | 'declined';
} | {
    action: 'cancel';
    scope: 'occurrence' | 'series';
    occurrenceId: string | null;
} | {
    action: 'propose-time';
    start: string;
    end: string;
}): string;
export declare function prepareInvitationCancellation(source: string, ownedAddresses: string[], input?: {
    occurrenceId?: string;
    alreadyOccurrenceCancelled?: boolean;
}, runtime?: InvitationRuntime): {
    revisedIcal: string;
    delivery: CalendarInvitationDelivery;
    alreadyCancelled: boolean;
};
export declare function prepareInvitationCounter(source: string, ownedAddresses: string[], input: {
    start: Date;
    end: Date;
    comment?: string;
}, runtime?: InvitationRuntime): {
    delivery: CalendarInvitationDelivery;
};
export {};
//# sourceMappingURL=calendar-invitations.d.ts.map