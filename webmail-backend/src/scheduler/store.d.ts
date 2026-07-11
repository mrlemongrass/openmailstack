import type { Pool } from 'mysql2/promise';
import { type AvailabilitySlot } from './availability';
import { type SchedulerEventInput } from './phase1';
export interface SchedulerEntitlement {
    username: string;
    tenantKey: string;
    handle: string;
    enabled: boolean;
    published: boolean;
    displayName: string;
    welcomeMessage: string;
    timeZone: string;
    defaultCalendarId: number | null;
}
export interface SchedulerEventType {
    id: string;
    tenantKey: string;
    ownerUsername: string;
    slug: string;
    title: string;
    description: string;
    durationMinutes: number;
    intervalMinutes: number;
    bufferBeforeMinutes: number;
    bufferAfterMinutes: number;
    minimumNoticeMinutes: number;
    capacity: number;
    locationType: 'in_person' | 'phone' | 'custom' | 'conference';
    locationLabel: string;
    destinationCalendarId: number | null;
    conflictCalendarIds: number[];
    active: boolean;
    windows: Array<{
        weekday: number;
        startMinute: number;
        endMinute: number;
    }>;
}
export interface SchedulerBookingInput {
    eventTypeId: string;
    start: Date;
    bookerTimeZone: string;
    bookerName: string;
    bookerEmail: string;
    bookerNotes?: string;
    idempotencyKey: string;
}
export declare class SchedulerStore {
    private readonly pool;
    private readonly holds;
    constructor(pool: Pool);
    listAdminMailboxes(): Promise<Array<Record<string, unknown>>>;
    setEntitlement(username: string, actor: string, input: {
        enabled: boolean;
        handle?: string;
        timeZone?: string;
    }): Promise<SchedulerEntitlement>;
    getEntitlement(username: string): Promise<SchedulerEntitlement | null>;
    requireOwner(username: string): Promise<SchedulerEntitlement>;
    updateProfile(username: string, input: {
        displayName?: string;
        welcomeMessage?: string;
        timeZone?: string;
        published?: boolean;
        defaultCalendarId?: number | null;
    }): Promise<SchedulerEntitlement>;
    listEventTypes(username: string, includeInactive?: boolean): Promise<SchedulerEventType[]>;
    saveEventType(username: string, input: SchedulerEventInput, eventId?: string): Promise<SchedulerEventType>;
    deleteEventType(username: string, eventId: string): Promise<void>;
    getOwnedEventType(username: string, id: string): Promise<SchedulerEventType | null>;
    getPublicProfile(handle: string): Promise<{
        entitlement: SchedulerEntitlement;
        events: SchedulerEventType[];
    } | null>;
    getPublicEvent(handle: string, slug: string): Promise<{
        entitlement: SchedulerEntitlement;
        event: SchedulerEventType;
    } | null>;
    listSlots(handle: string, slug: string, rangeStart: Date, rangeEnd: Date): Promise<AvailabilitySlot[]>;
    createBooking(handle: string, slug: string, input: SchedulerBookingInput): Promise<Record<string, unknown>>;
    listBookings(username: string, filter?: string): Promise<Array<Record<string, unknown>>>;
    getCapabilityBooking(token: string, scope: 'cancel' | 'reschedule'): Promise<Record<string, unknown> | null>;
    cancelBookingByToken(token: string): Promise<Record<string, unknown> | null>;
    cancelOwnedBooking(username: string, bookingId: string): Promise<void>;
    rescheduleBookingByToken(token: string, newStart: Date): Promise<Record<string, unknown> | null>;
    private cancelBooking;
    private lockCapabilityBooking;
    private busyIntervals;
    private assertCalendarOwnership;
    private bookingByIdempotency;
    private releaseHold;
    private enqueue;
    private writeAudit;
}
//# sourceMappingURL=store.d.ts.map