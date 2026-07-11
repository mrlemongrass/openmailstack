import type { BusyInterval } from './availability';
export declare const SCHEDULER_BOOKING_STATUSES: readonly ["requested", "confirmed", "rejected", "cancelled", "completed", "no_show"];
export type SchedulerBookingStatus = typeof SCHEDULER_BOOKING_STATUSES[number];
export interface SchedulerEventTypeSnapshot {
    eventTypeId: string;
    revision: number;
    title: string;
    durationMinutes: number;
    timeZone: string;
    locationType: 'in_person' | 'phone' | 'custom' | 'conference';
    locationLabel?: string;
    requiresConfirmation: boolean;
    capacity: number;
}
export interface SchedulerAttendee {
    id: string;
    name: string;
    email: string;
    timeZone: string;
    locale?: string;
}
export interface SchedulerBooking {
    id: string;
    tenantKey: string;
    hostUsername: string;
    status: SchedulerBookingStatus;
    eventType: SchedulerEventTypeSnapshot;
    attendees: SchedulerAttendee[];
    start: Date;
    end: Date;
    createdAt: Date;
    updatedAt: Date;
    idempotencyKey: string;
    calendarEventUid?: string;
    conferenceReference?: SchedulerProviderReference;
    paymentReference?: SchedulerProviderReference;
}
export interface SchedulerProviderReference {
    providerId: string;
    externalId: string;
}
export type SchedulerBookingTransition = {
    from: SchedulerBookingStatus;
    to: SchedulerBookingStatus;
};
export declare const canTransitionBooking: ({ from, to }: SchedulerBookingTransition) => boolean;
export interface SchedulerBusyQuery {
    tenantKey: string;
    hostUsername: string;
    calendarIds: string[];
    rangeStart: Date;
    rangeEnd: Date;
}
export interface SchedulerCalendarProjection {
    tenantKey: string;
    bookingId: string;
    hostUsername: string;
    destinationCalendarId: string;
    eventUid: string;
    sequence: number;
    status: 'confirmed' | 'cancelled';
    title: string;
    description: string;
    start: Date;
    end: Date;
    attendees: Array<Pick<SchedulerAttendee, 'name' | 'email'>>;
    conferenceUrl?: string;
}
export interface SchedulerCalendarProvider {
    readonly providerId: string;
    getBusyIntervals(query: SchedulerBusyQuery): Promise<BusyInterval[]>;
    upsertBookingEvent(projection: SchedulerCalendarProjection): Promise<SchedulerProviderReference>;
    deleteBookingEvent(reference: SchedulerProviderReference, tenantKey: string): Promise<void>;
}
export interface SchedulerConferenceRequest {
    tenantKey: string;
    bookingId: string;
    title: string;
    start: Date;
    end: Date;
    hostUsername: string;
    attendeeEmails: string[];
}
export interface SchedulerConference {
    reference: SchedulerProviderReference;
    joinUrl: string;
    hostUrl?: string;
}
export interface SchedulerConferenceProvider {
    readonly providerId: string;
    createConference(request: SchedulerConferenceRequest): Promise<SchedulerConference>;
    deleteConference(reference: SchedulerProviderReference, tenantKey: string): Promise<void>;
}
export interface SchedulerMessage {
    tenantKey: string;
    idempotencyKey: string;
    channel: 'email' | 'sms' | 'whatsapp';
    recipient: string;
    subject?: string;
    text: string;
    html?: string;
    calendarAttachment?: string;
}
export interface SchedulerMessageProvider {
    readonly providerId: string;
    send(message: SchedulerMessage): Promise<SchedulerProviderReference>;
}
export interface SchedulerPaymentRequest {
    tenantKey: string;
    bookingId: string;
    idempotencyKey: string;
    amountMinor: number;
    currency: string;
    successUrl: string;
    cancelUrl: string;
}
export interface SchedulerPaymentSession {
    reference: SchedulerProviderReference;
    checkoutUrl: string;
    expiresAt: Date;
}
export interface SchedulerPaymentProvider {
    readonly providerId: string;
    createCheckout(request: SchedulerPaymentRequest): Promise<SchedulerPaymentSession>;
    refund(reference: SchedulerProviderReference, tenantKey: string, amountMinor?: number): Promise<SchedulerProviderReference>;
}
//# sourceMappingURL=contracts.d.ts.map