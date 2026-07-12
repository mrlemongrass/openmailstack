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
    notificationFrom: string;
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
    availabilityScheduleId: string | null;
    systemManaged: boolean;
    visibility: 'public' | 'unlisted';
    active: boolean;
    windows: Array<{
        weekday: number;
        startMinute: number;
        endMinute: number;
    }>;
}
export interface SchedulerScheduleWindow {
    weekday: number;
    startMinute: number;
    endMinute: number;
}
export interface SchedulerScheduleOverride {
    id?: string;
    date: string;
    unavailableAllDay: boolean;
    windows: Array<{
        startMinute: number;
        endMinute: number;
    }>;
}
export interface SchedulerAvailabilitySchedule {
    id: string;
    name: string;
    timeZone: string;
    isDefault: boolean;
    published: boolean;
    windows: SchedulerScheduleWindow[];
    overrides: SchedulerScheduleOverride[];
}
export interface SchedulerAvailabilityInput {
    name?: string;
    timeZone?: string;
    published?: boolean;
    windows?: SchedulerScheduleWindow[];
    overrides?: SchedulerScheduleOverride[];
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
    listNotificationIdentities(username: string): Promise<Array<{
        address: string;
        name: string;
    }>>;
    getDefaultAvailability(username: string): Promise<SchedulerAvailabilitySchedule>;
    saveDefaultAvailability(username: string, input: SchedulerAvailabilityInput): Promise<SchedulerAvailabilitySchedule>;
    previewDefaultAvailability(username: string, rangeStart: Date, rangeEnd: Date): Promise<{
        slots: AvailabilitySlot[];
        busyIntervalCount: number;
        overrideCount: number;
    }>;
    updateProfile(username: string, input: {
        displayName?: string;
        welcomeMessage?: string;
        timeZone?: string;
        published?: boolean;
        defaultCalendarId?: number | null;
        notificationFrom?: string;
    }): Promise<SchedulerEntitlement>;
    listEventTypes(username: string, includeInactive?: boolean): Promise<SchedulerEventType[]>;
    saveEventType(username: string, input: SchedulerEventInput, eventId?: string): Promise<SchedulerEventType>;
    deleteEventType(username: string, eventId: string): Promise<void>;
    getOwnedEventType(username: string, id: string): Promise<SchedulerEventType | null>;
    getPublicProfile(handle: string): Promise<{
        entitlement: SchedulerEntitlement;
        events: SchedulerEventType[];
        defaultEvent: SchedulerEventType | null;
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
    private loadAvailabilitySchedule;
    private getAvailabilityScheduleById;
    private assertScheduleOwnership;
    private ensureSystemDefaultEvent;
    private getSystemDefaultEvent;
    private busyIntervals;
    private fullCapacitySlotStarts;
    private assertCalendarOwnership;
    private bookingByIdempotency;
    private releaseHold;
    private enqueue;
    private writeAudit;
}
//# sourceMappingURL=store.d.ts.map