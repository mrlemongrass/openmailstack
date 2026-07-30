import crypto from 'crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { calculateAvailability, type AvailabilityOverride, type AvailabilitySlot, type BusyInterval } from './availability';
import { SchedulerSlotHoldRepository } from './slot-holds';
import {
    assertTimeZone,
    assertSchedulerGuestEligible,
    buildSchedulerCalendarEvent,
    createSchedulerToken,
    normalizeSchedulerBookingAnswers,
    normalizeSchedulerActionReason,
    normalizeSchedulerAttendees,
    normalizeOneOffAvailability,
    normalizePrivateLinkExpiry,
    defaultSchedulerHandle,
    normalizeSchedulerEventInput,
    normalizeSchedulerQuestions,
    normalizeSchedulerHandle,
    schedulerTokenHash,
    schedulerBookingActionPolicy,
    SchedulerGuestPolicyError,
    type SchedulerEventInput,
    type SchedulerBookingAnswer,
    type SchedulerBookingAnswerInput,
    type SchedulerBookingQuestion,
    type SchedulerAttendee,
    type SchedulerAttendeeInput,
    type SchedulerOneOffAvailability,
    type SchedulerOneOffWindow,
} from './phase1';
import { ensureDefaultCalendar, expandRecurringEvent, getVisibleCalendars, parseIcalEvent } from '../calendar-utils';
import { schedulerConfig } from '../config';
import {
    exclusionDateKeys,
    normalizeRecurrenceCount,
    normalizeSchedulerAttribution,
    normalizeSchedulerExclusions,
    type SchedulerAvailabilityExclusion,
} from './phase2';
import {
    SchedulerContactPreferenceRepository,
    SchedulerSecretBox,
    SchedulerWorkflowRepository,
    normalizeCommunicationConsents,
    type SchedulerCommunicationConsents,
} from './workflows';

type Queryable = Pick<Pool, 'query'> | Pick<PoolConnection, 'query'>;

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
    visibility: 'public' | 'unlisted' | 'private';
    active: boolean;
    requiresConfirmation: boolean;
    cancellationCutoffMinutes: number | null;
    rescheduleCutoffMinutes: number | null;
    requireCancellationReason: boolean;
    requireRescheduleReason: boolean;
    activeBookingLimit: number | null;
    guestAllowList: string[];
    guestDenyList: string[];
    requireEmailVerification: boolean;
    maxAdditionalGuests: number;
    waitlistEnabled: boolean;
    maxRecurrenceOccurrences: number;
    publicAccentColor: string;
    publicIntro: string;
    privacyUrl: string;
    termsUrl: string;
    locale: string;
    lockedTimeZone: string | null;
    windows: Array<{ weekday: number; startMinute: number; endMinute: number }>;
    questions: SchedulerBookingQuestion[];
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
    windows: Array<{ startMinute: number; endMinute: number }>;
}

export interface SchedulerAvailabilitySchedule {
    id: string;
    name: string;
    timeZone: string;
    isDefault: boolean;
    published: boolean;
    windows: SchedulerScheduleWindow[];
    overrides: SchedulerScheduleOverride[];
    exclusions: SchedulerAvailabilityExclusion[];
}

export interface SchedulerAvailabilityInput {
    name?: string;
    timeZone?: string;
    published?: boolean;
    windows?: SchedulerScheduleWindow[];
    overrides?: SchedulerScheduleOverride[];
    exclusions?: SchedulerAvailabilityExclusion[];
}

export interface SchedulerBookingInput {
    eventTypeId: string;
    start: Date;
    bookerTimeZone: string;
    bookerName: string;
    bookerEmail: string;
    communicationConsents?: SchedulerCommunicationConsents;
    bookerNotes?: string;
    bookingAnswers?: SchedulerBookingAnswerInput[];
    attendees?: SchedulerAttendeeInput[];
    seats?: number;
    verificationChallengeId?: string;
    verificationCode?: string;
    recurrenceCount?: number;
    attribution?: Record<string, unknown>;
    bookedByUsername?: string;
    waitlistEntryId?: string;
    seriesId?: string;
    seriesIndex?: number;
    seriesCount?: number;
    suppressNotification?: boolean;
    verificationBypass?: boolean;
    idempotencyKey: string;
    privateAccessToken?: string;
}

export interface SchedulerPrivateLinkState {
    active: boolean;
    expired: boolean;
    consumed: boolean;
    singleUse: boolean;
    remainingUses: number | null;
    oneOff: boolean;
    oneOffTimeZone: string | null;
    oneOffWindows: SchedulerOneOffWindow[];
    tokenHint: string | null;
    expiresAt: Date | null;
}

interface SchedulerActivePrivateLink {
    id: string;
    remainingUses: number | null;
    oneOffAvailability: SchedulerOneOffAvailability | null;
}

const mysqlDate = (date: Date): string => date.toISOString().slice(0, 23).replace('T', ' ');
const utcDate = (value: string): Date => new Date(`${String(value).replace(' ', 'T')}Z`);
const booleanValue = (value: unknown): boolean => Number(value) === 1;
const jsonArray = (value: unknown): number[] => {
    try {
        const parsed = JSON.parse(String(value || '[]'));
        return Array.isArray(parsed) ? parsed.map(Number).filter((item) => Number.isInteger(item) && item > 0) : [];
    } catch {
        return [];
    }
};

const bookingQuestionsFromRow = (row: any): SchedulerBookingQuestion[] => {
    try {
        const parsed = JSON.parse(String(row.booking_questions || '[]'));
        return normalizeSchedulerQuestions(parsed);
    } catch {
        return [];
    }
};

const bookingAnswersFromRow = (value: unknown): SchedulerBookingAnswer[] => {
    try {
        const parsed = JSON.parse(String(value || '[]'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const attendeesFromRow = (value: unknown): SchedulerAttendee[] => {
    try {
        const parsed = JSON.parse(String(value || '[]'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const attributionFromRow = (value: unknown): Record<string, string> => {
    try { return normalizeSchedulerAttribution(JSON.parse(String(value || '{}'))); } catch { return {}; }
};

const guestRulesFromRow = (value: unknown): string[] => {
    try {
        const parsed = JSON.parse(String(value || '[]'));
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
        return [];
    }
};

const oneOffAvailabilityFromRow = (row: any): SchedulerOneOffAvailability | null => {
    if (!row.one_off_time_zone || !row.one_off_windows) return null;
    try {
        const windows = JSON.parse(String(row.one_off_windows));
        if (!Array.isArray(windows)) return null;
        return {
            timeZone: String(row.one_off_time_zone),
            windows: windows.map((window: any) => ({
                date: String(window.date),
                startMinute: Number(window.startMinute),
                endMinute: Number(window.endMinute),
            })),
        };
    } catch {
        return null;
    }
};

const entitlementFromRow = (row: any): SchedulerEntitlement => ({
    username: row.username,
    tenantKey: row.tenant_key,
    handle: row.public_handle,
    enabled: booleanValue(row.enabled),
    published: booleanValue(row.published),
    displayName: row.display_name || '',
    welcomeMessage: row.welcome_message || '',
    timeZone: row.time_zone || 'UTC',
    defaultCalendarId: row.default_calendar_id == null ? null : Number(row.default_calendar_id),
    notificationFrom: row.notification_from || row.username,
});

const eventFromRow = (row: any, windows: SchedulerEventType['windows'] = []): SchedulerEventType => ({
    id: row.id,
    tenantKey: row.tenant_key,
    ownerUsername: row.owner_username,
    slug: row.slug,
    title: row.title,
    description: row.description || '',
    durationMinutes: Number(row.duration_minutes),
    intervalMinutes: Number(row.interval_minutes),
    bufferBeforeMinutes: Number(row.buffer_before_minutes),
    bufferAfterMinutes: Number(row.buffer_after_minutes),
    minimumNoticeMinutes: Number(row.minimum_notice_minutes),
    capacity: Number(row.capacity),
    locationType: row.location_type,
    locationLabel: row.location_label || '',
    destinationCalendarId: row.destination_calendar_id == null ? null : Number(row.destination_calendar_id),
    conflictCalendarIds: jsonArray(row.conflict_calendar_ids),
    availabilityScheduleId: row.availability_schedule_id || null,
    systemManaged: booleanValue(row.system_managed),
    visibility: row.visibility === 'private' ? 'private' : row.visibility === 'unlisted' ? 'unlisted' : 'public',
    active: booleanValue(row.active),
    requiresConfirmation: booleanValue(row.requires_confirmation),
    cancellationCutoffMinutes: row.cancellation_cutoff_minutes == null ? null : Number(row.cancellation_cutoff_minutes),
    rescheduleCutoffMinutes: row.reschedule_cutoff_minutes == null ? null : Number(row.reschedule_cutoff_minutes),
    requireCancellationReason: booleanValue(row.require_cancellation_reason),
    requireRescheduleReason: booleanValue(row.require_reschedule_reason),
    activeBookingLimit: row.active_booking_limit == null ? null : Number(row.active_booking_limit),
    guestAllowList: guestRulesFromRow(row.guest_allow_list),
    guestDenyList: guestRulesFromRow(row.guest_deny_list),
    requireEmailVerification: booleanValue(row.require_email_verification),
    maxAdditionalGuests: Number(row.max_additional_guests || 0),
    waitlistEnabled: booleanValue(row.waitlist_enabled),
    maxRecurrenceOccurrences: Number(row.max_recurrence_occurrences || 1),
    publicAccentColor: row.public_accent_color || '#245fc7',
    publicIntro: row.public_intro || '',
    privacyUrl: row.privacy_url || '',
    termsUrl: row.terms_url || '',
    locale: row.locale || 'en',
    lockedTimeZone: row.locked_time_zone || null,
    windows,
    questions: bookingQuestionsFromRow(row),
});

const normalizeWindows = <T extends { startMinute: number; endMinute: number; weekday?: number }>(windows: T[], requireWeekday: boolean): T[] => {
    const normalized = windows.map((window) => ({
        ...window,
        ...(requireWeekday ? { weekday: Number(window.weekday) } : {}),
        startMinute: Number(window.startMinute),
        endMinute: Number(window.endMinute),
    }));
    for (const window of normalized) {
        if (requireWeekday && (!Number.isInteger(window.weekday) || Number(window.weekday) < 0 || Number(window.weekday) > 6)) {
            throw new Error('Availability weekday must be between 0 and 6');
        }
        if (!Number.isInteger(window.startMinute) || !Number.isInteger(window.endMinute)
            || window.startMinute < 0 || window.endMinute > 1440 || window.startMinute >= window.endMinute) {
            throw new Error('Availability windows must have valid start and end times');
        }
    }
    const groups = new Map<number, T[]>();
    for (const window of normalized as T[]) {
        const key = requireWeekday ? Number(window.weekday) : 0;
        const group = groups.get(key) || [];
        group.push(window);
        groups.set(key, group);
    }
    for (const group of groups.values()) {
        group.sort((left, right) => left.startMinute - right.startMinute);
        for (let index = 1; index < group.length; index += 1) {
            if (group[index].startMinute < group[index - 1].endMinute) throw new Error('Availability windows cannot overlap');
        }
    }
    return normalized as T[];
};

const normalizeOverrides = (overrides: SchedulerScheduleOverride[]): SchedulerScheduleOverride[] => {
    const dates = new Set<string>();
    return overrides.map((override) => {
        const date = String(override.date || '');
        const probe = new Date(`${date}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 10) !== date) {
            throw new Error('Availability override must use a valid date');
        }
        if (dates.has(date)) throw new Error('Only one availability override is allowed per date');
        dates.add(date);
        const unavailableAllDay = Boolean(override.unavailableAllDay);
        const windows = unavailableAllDay ? [] : normalizeWindows(override.windows || [], false);
        return { id: override.id, date, unavailableAllDay, windows };
    });
};

async function loadWindows(db: Queryable, eventIds: string[]): Promise<Map<string, SchedulerEventType['windows']>> {
    const result = new Map<string, SchedulerEventType['windows']>();
    if (eventIds.length === 0) return result;
    const placeholders = eventIds.map(() => '?').join(',');
    const [rows]: any = await db.query(
        `SELECT event_type_id, weekday, start_minute, end_minute
         FROM scheduler_availability_windows
         WHERE event_type_id IN (${placeholders})
         ORDER BY weekday, start_minute`,
        eventIds
    );
    for (const row of rows) {
        const windows = result.get(row.event_type_id) || [];
        windows.push({ weekday: Number(row.weekday), startMinute: Number(row.start_minute), endMinute: Number(row.end_minute) });
        result.set(row.event_type_id, windows);
    }
    return result;
}

export class SchedulerStore {
    private readonly holds: SchedulerSlotHoldRepository;
    private readonly workflows: SchedulerWorkflowRepository;
    private readonly contactPreferences: SchedulerContactPreferenceRepository;

    constructor(private readonly pool: Pool) {
        this.holds = new SchedulerSlotHoldRepository(pool);
        this.workflows = new SchedulerWorkflowRepository(pool);
        this.contactPreferences = new SchedulerContactPreferenceRepository(pool, new SchedulerSecretBox(schedulerConfig.secretKeys));
    }

    async listAdminMailboxes(): Promise<Array<Record<string, unknown>>> {
        const [rows]: any = await this.pool.query(
            `SELECT m.username, m.name, m.local_part, m.domain, m.active,
                    e.public_handle, e.enabled AS scheduler_enabled, e.published AS scheduler_published,
                    e.time_zone AS scheduler_time_zone
             FROM mailbox m
             LEFT JOIN scheduler_mailbox_entitlements e ON e.username = m.username
             ORDER BY m.domain, m.username`
        );
        return rows.map((row: any) => ({
            username: row.username,
            name: row.name || '',
            localPart: row.local_part,
            domain: row.domain,
            active: booleanValue(row.active),
            scheduler: row.public_handle ? {
                handle: row.public_handle,
                enabled: booleanValue(row.scheduler_enabled),
                published: booleanValue(row.scheduler_published),
                timeZone: row.scheduler_time_zone,
            } : null,
        }));
    }

    async setEntitlement(username: string, actor: string, input: { enabled: boolean; handle?: string; timeZone?: string }): Promise<SchedulerEntitlement> {
        const normalizedUsername = username.trim().toLowerCase();
        const tenantKey = normalizedUsername.split('@')[1] || '';
        if (!tenantKey) throw new Error('Mailbox username must include a domain');
        const existingEntitlement = await this.getEntitlement(normalizedUsername);
        const timeZone = assertTimeZone(input.timeZone || existingEntitlement?.timeZone || 'UTC');
        const handle = normalizeSchedulerHandle(input.handle || existingEntitlement?.handle || defaultSchedulerHandle(normalizedUsername));
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [mailboxes]: any = await connection.query('SELECT username, name, active FROM mailbox WHERE username = ? LIMIT 1 FOR UPDATE', [normalizedUsername]);
            if (mailboxes.length === 0) throw new Error('Mailbox not found');
            if (input.enabled && !booleanValue(mailboxes[0].active)) throw new Error('Inactive mailboxes cannot use Scheduler');
            await connection.query(
                `INSERT INTO scheduler_mailbox_entitlements
                    (username, tenant_key, public_handle, enabled, published, display_name, time_zone, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE public_handle = VALUES(public_handle), enabled = VALUES(enabled),
                    published = VALUES(published), time_zone = VALUES(time_zone), updated_at = CURRENT_TIMESTAMP(3)`,
                [normalizedUsername, tenantKey, handle, input.enabled ? 1 : 0, input.enabled ? 1 : 0, mailboxes[0].name || '', timeZone, actor]
            );
            await this.writeAudit(connection, tenantKey, 'admin', actor, input.enabled ? 'entitlement.enable' : 'entitlement.disable', 'mailbox', normalizedUsername, { handle });
            await connection.commit();
        } catch (error: any) {
            await connection.rollback();
            if (error?.code === 'ER_DUP_ENTRY') throw new Error('That Scheduler handle is already in use');
            throw error;
        } finally {
            connection.release();
        }
        return (await this.getEntitlement(normalizedUsername))!;
    }

    async getEntitlement(username: string): Promise<SchedulerEntitlement | null> {
        const [rows]: any = await this.pool.query('SELECT * FROM scheduler_mailbox_entitlements WHERE username = ? LIMIT 1', [username.toLowerCase()]);
        return rows.length ? entitlementFromRow(rows[0]) : null;
    }

    async requireOwner(username: string): Promise<SchedulerEntitlement> {
        const entitlement = await this.getEntitlement(username);
        if (!entitlement || !entitlement.enabled) throw new Error('Scheduler is not enabled for this mailbox');
        return entitlement;
    }

    async listNotificationIdentities(username: string): Promise<Array<{ address: string; name: string }>> {
        const entitlement = await this.requireOwner(username);
        const [mailboxes]: any = await this.pool.query('SELECT name FROM mailbox WHERE username = ? LIMIT 1', [username]);
        const [aliases]: any = await this.pool.query('SELECT address, goto FROM alias WHERE active = 1 ORDER BY address');
        const addresses = [username, ...aliases
            .filter((row: any) => String(row.goto || '').split(',').map((value: string) => value.trim().toLowerCase()).includes(username.toLowerCase()))
            .map((row: any) => String(row.address).trim().toLowerCase())
            .filter((address: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))];
        return Array.from(new Set(addresses)).map((address) => ({
            address,
            name: entitlement.displayName || mailboxes[0]?.name || username.split('@')[0],
        }));
    }

    async getDefaultAvailability(username: string): Promise<SchedulerAvailabilitySchedule> {
        const entitlement = await this.requireOwner(username);
        const [rows]: any = await this.pool.query(
            'SELECT * FROM scheduler_availability_schedules WHERE owner_username = ? AND is_default = 1 LIMIT 1',
            [username]
        );
        if (rows.length) return this.loadAvailabilitySchedule(rows[0]);

        const id = crypto.randomUUID();
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query(
                `INSERT INTO scheduler_availability_schedules
                    (id, tenant_key, owner_username, name, time_zone, is_default, published)
                 VALUES (?, ?, ?, 'Working hours', ?, 1, 0)`,
                [id, entitlement.tenantKey, username, entitlement.timeZone]
            );
            for (const weekday of [1, 2, 3, 4, 5]) {
                await connection.query(
                    'INSERT INTO scheduler_schedule_windows (schedule_id, weekday, start_minute, end_minute) VALUES (?, ?, 540, 1020)',
                    [id, weekday]
                );
            }
            await connection.commit();
        } catch (error: any) {
            await connection.rollback();
            if (error?.code !== 'ER_DUP_ENTRY') throw error;
        } finally {
            connection.release();
        }
        const [created]: any = await this.pool.query(
            'SELECT * FROM scheduler_availability_schedules WHERE owner_username = ? AND is_default = 1 LIMIT 1',
            [username]
        );
        if (!created.length) throw new Error('Unable to create default availability');
        return this.loadAvailabilitySchedule(created[0]);
    }

    async saveDefaultAvailability(username: string, input: SchedulerAvailabilityInput): Promise<SchedulerAvailabilitySchedule> {
        const entitlement = await this.requireOwner(username);
        const schedule = await this.getDefaultAvailability(username);
        const name = String(input.name || schedule.name || 'Working hours').trim().slice(0, 120) || 'Working hours';
        const timeZone = assertTimeZone(input.timeZone || schedule.timeZone || entitlement.timeZone);
        const published = input.published ?? schedule.published;
        const windows = normalizeWindows(input.windows || schedule.windows, true);
        const overrides = normalizeOverrides(input.overrides || schedule.overrides);
        const exclusions = normalizeSchedulerExclusions(input.exclusions ?? schedule.exclusions);
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [owned]: any = await connection.query(
                'SELECT id FROM scheduler_availability_schedules WHERE id = ? AND owner_username = ? FOR UPDATE',
                [schedule.id, username]
            );
            if (!owned.length) throw new Error('Availability schedule not found');
            await connection.query(
                'UPDATE scheduler_availability_schedules SET name = ?, time_zone = ?, published = ? WHERE id = ?',
                [name, timeZone, published ? 1 : 0, schedule.id]
            );
            await connection.query('DELETE FROM scheduler_schedule_windows WHERE schedule_id = ?', [schedule.id]);
            for (const window of windows) {
                await connection.query(
                    'INSERT INTO scheduler_schedule_windows (schedule_id, weekday, start_minute, end_minute) VALUES (?, ?, ?, ?)',
                    [schedule.id, window.weekday, window.startMinute, window.endMinute]
                );
            }
            await connection.query('DELETE FROM scheduler_schedule_overrides WHERE schedule_id = ?', [schedule.id]);
            for (const override of overrides) {
                const overrideId = crypto.randomUUID();
                await connection.query(
                    'INSERT INTO scheduler_schedule_overrides (id, schedule_id, local_date, unavailable_all_day) VALUES (?, ?, ?, ?)',
                    [overrideId, schedule.id, override.date, override.unavailableAllDay ? 1 : 0]
                );
                for (const window of override.windows) {
                    await connection.query(
                        'INSERT INTO scheduler_override_windows (override_id, start_minute, end_minute) VALUES (?, ?, ?)',
                        [overrideId, window.startMinute, window.endMinute]
                    );
                }
            }
            await connection.query('DELETE FROM scheduler_availability_exclusions WHERE schedule_id = ?', [schedule.id]);
            for (const exclusion of exclusions) {
                await connection.query(
                    `INSERT INTO scheduler_availability_exclusions (id, schedule_id, kind, start_date, end_date, label)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [exclusion.id || crypto.randomUUID(), schedule.id, exclusion.kind, exclusion.startDate, exclusion.endDate, exclusion.label]
                );
            }
            await this.ensureSystemDefaultEvent(connection, entitlement, schedule.id, published);
            await this.writeAudit(connection, entitlement.tenantKey, 'user', username, 'availability.default.update', 'availability_schedule', schedule.id, {
                published,
                windowCount: windows.length,
                overrideCount: overrides.length,
                exclusionCount: exclusions.length,
            });
            await connection.commit();
        } catch (error: any) {
            await connection.rollback();
            if (error?.code === 'ER_DUP_ENTRY') throw new Error('That availability schedule name is already in use');
            throw error;
        } finally {
            connection.release();
        }
        return this.getDefaultAvailability(username);
    }

    async previewDefaultAvailability(username: string, rangeStart: Date, rangeEnd: Date): Promise<{ slots: AvailabilitySlot[]; busyIntervalCount: number; overrideCount: number }> {
        if (!Number.isFinite(rangeStart.getTime()) || !Number.isFinite(rangeEnd.getTime()) || rangeStart >= rangeEnd) {
            throw new Error('Invalid availability range');
        }
        if (rangeEnd.getTime() - rangeStart.getTime() > 62 * 24 * 60 * 60 * 1000) throw new Error('Availability range cannot exceed 62 days');
        const schedule = await this.getDefaultAvailability(username);
        const event = await this.getSystemDefaultEvent(username, false);
        const busy = await this.busyIntervals(event || {
            ownerUsername: username,
            conflictCalendarIds: [],
        } as SchedulerEventType, rangeStart, rangeEnd);
        const overrides: AvailabilityOverride[] = schedule.overrides.map((override) => ({
            date: override.date,
            windows: override.unavailableAllDay ? [] : override.windows,
        }));
        for (const date of exclusionDateKeys(schedule.exclusions, rangeStart, rangeEnd)) {
            if (!overrides.some((override) => override.date === date)) overrides.push({ date, windows: [] });
        }
        const slots = calculateAvailability({
            timeZone: schedule.timeZone,
            rangeStart,
            rangeEnd,
            durationMinutes: 30,
            intervalMinutes: 30,
            windows: schedule.windows,
            overrides,
            busy,
            minimumNoticeMinutes: 60,
        });
        return {
            slots,
            busyIntervalCount: busy.length,
            overrideCount: schedule.overrides.filter((override) => {
                const date = override.date;
                return date >= rangeStart.toISOString().slice(0, 10) && date <= rangeEnd.toISOString().slice(0, 10);
            }).length,
        };
    }

    async updateProfile(username: string, input: { displayName?: string; welcomeMessage?: string; timeZone?: string; published?: boolean; defaultCalendarId?: number | null; notificationFrom?: string }): Promise<SchedulerEntitlement> {
        const entitlement = await this.requireOwner(username);
        const displayName = String(input.displayName ?? entitlement.displayName).trim().slice(0, 160);
        const welcomeMessage = String(input.welcomeMessage ?? entitlement.welcomeMessage).trim().slice(0, 4000);
        const timeZone = assertTimeZone(input.timeZone || entitlement.timeZone);
        const published = input.published ?? entitlement.published;
        const defaultCalendarId = input.defaultCalendarId === undefined ? entitlement.defaultCalendarId : input.defaultCalendarId;
        const notificationFrom = String(input.notificationFrom || entitlement.notificationFrom || username).trim().toLowerCase();
        if (defaultCalendarId !== null) await this.assertCalendarOwnership(username, Number(defaultCalendarId));
        const identities = await this.listNotificationIdentities(username);
        if (!identities.some((identity) => identity.address === notificationFrom)) throw new Error('Scheduler sender must be your mailbox or an active alias');
        await this.pool.query(
            `UPDATE scheduler_mailbox_entitlements
             SET display_name = ?, welcome_message = ?, time_zone = ?, published = ?, default_calendar_id = ?, notification_from = ?
             WHERE username = ? AND enabled = 1`,
            [displayName, welcomeMessage, timeZone, published ? 1 : 0, defaultCalendarId, notificationFrom, username]
        );
        await this.writeAudit(this.pool, entitlement.tenantKey, 'user', username, 'profile.update', 'mailbox', username, { published });
        return (await this.getEntitlement(username))!;
    }

    async listEventTypes(username: string, includeInactive = true): Promise<SchedulerEventType[]> {
        await this.requireOwner(username);
        const [rows]: any = await this.pool.query(
            `SELECT event_type.* FROM scheduler_event_types event_type
             WHERE event_type.owner_username = ? AND event_type.system_managed = 0
               AND NOT EXISTS (
                   SELECT 1 FROM scheduler_audit_events audit
                   WHERE audit.target_type = 'event_type'
                     AND audit.target_id = event_type.id
                     AND audit.action = 'event_type.delete'
               )
               ${includeInactive ? '' : 'AND event_type.active = 1'}
             ORDER BY event_type.created_at`,
            [username]
        );
        const windows = await loadWindows(this.pool, rows.map((row: any) => row.id));
        return rows.map((row: any) => eventFromRow(row, windows.get(row.id) || []));
    }

    async saveEventType(username: string, input: SchedulerEventInput, eventId?: string): Promise<SchedulerEventType> {
        const entitlement = await this.requireOwner(username);
        const normalized = normalizeSchedulerEventInput(input);
        const defaultSchedule = input.availabilityScheduleId === undefined && !eventId ? await this.getDefaultAvailability(username) : null;
        const availabilityScheduleId = defaultSchedule?.id || normalized.availabilityScheduleId;
        if (normalized.destinationCalendarId !== null) await this.assertCalendarOwnership(username, normalized.destinationCalendarId);
        for (const calendarId of normalized.conflictCalendarIds) await this.assertCalendarOwnership(username, calendarId);
        if (availabilityScheduleId !== null) await this.assertScheduleOwnership(username, availabilityScheduleId);
        const id = eventId || crypto.randomUUID();
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            if (eventId) {
                const [owned]: any = await connection.query(`SELECT id, visibility, booking_questions, requires_confirmation,
                    cancellation_cutoff_minutes, reschedule_cutoff_minutes, require_cancellation_reason, require_reschedule_reason,
                    active_booking_limit, guest_allow_list, guest_deny_list, require_email_verification, max_additional_guests,
                    waitlist_enabled, max_recurrence_occurrences, public_accent_color, public_intro, privacy_url, terms_url, locale, locked_time_zone
                    FROM scheduler_event_types WHERE id = ? AND owner_username = ? AND system_managed = 0 FOR UPDATE`, [id, username]);
                if (!owned.length) throw new Error('Event type not found');
                const visibility = input.visibility === undefined
                    ? (owned[0].visibility === 'private' ? 'private' : owned[0].visibility === 'unlisted' ? 'unlisted' : 'public')
                    : normalized.visibility;
                const bookingQuestions = input.questions === undefined
                    ? String(owned[0].booking_questions || '[]')
                    : JSON.stringify(normalized.questions);
                const requiresConfirmation = input.requiresConfirmation === undefined
                    ? booleanValue(owned[0].requires_confirmation)
                    : normalized.requiresConfirmation;
                const cancellationCutoffMinutes = input.cancellationCutoffMinutes === undefined
                    ? (owned[0].cancellation_cutoff_minutes == null ? null : Number(owned[0].cancellation_cutoff_minutes))
                    : normalized.cancellationCutoffMinutes;
                const rescheduleCutoffMinutes = input.rescheduleCutoffMinutes === undefined
                    ? (owned[0].reschedule_cutoff_minutes == null ? null : Number(owned[0].reschedule_cutoff_minutes))
                    : normalized.rescheduleCutoffMinutes;
                const requireCancellationReason = input.requireCancellationReason === undefined
                    ? booleanValue(owned[0].require_cancellation_reason)
                    : normalized.requireCancellationReason;
                const requireRescheduleReason = input.requireRescheduleReason === undefined
                    ? booleanValue(owned[0].require_reschedule_reason)
                    : normalized.requireRescheduleReason;
                const activeBookingLimit = input.activeBookingLimit === undefined
                    ? (owned[0].active_booking_limit == null ? null : Number(owned[0].active_booking_limit))
                    : normalized.activeBookingLimit;
                const guestAllowList = input.guestAllowList === undefined
                    ? String(owned[0].guest_allow_list || '[]')
                    : JSON.stringify(normalized.guestAllowList);
                const guestDenyList = input.guestDenyList === undefined
                    ? String(owned[0].guest_deny_list || '[]')
                    : JSON.stringify(normalized.guestDenyList);
                const requireEmailVerification = input.requireEmailVerification === undefined
                    ? booleanValue(owned[0].require_email_verification)
                    : normalized.requireEmailVerification;
                const maxAdditionalGuests = input.maxAdditionalGuests === undefined
                    ? Number(owned[0].max_additional_guests || 0)
                    : normalized.maxAdditionalGuests;
                const waitlistEnabled = input.waitlistEnabled === undefined ? booleanValue(owned[0].waitlist_enabled) : normalized.waitlistEnabled;
                const maxRecurrenceOccurrences = input.maxRecurrenceOccurrences === undefined
                    ? Number(owned[0].max_recurrence_occurrences || 1) : normalized.maxRecurrenceOccurrences;
                const publicAccentColor = input.publicAccentColor === undefined ? String(owned[0].public_accent_color || '#245fc7') : normalized.publicAccentColor;
                const publicIntro = input.publicIntro === undefined ? String(owned[0].public_intro || '') : normalized.publicIntro;
                const privacyUrl = input.privacyUrl === undefined ? String(owned[0].privacy_url || '') : normalized.privacyUrl;
                const termsUrl = input.termsUrl === undefined ? String(owned[0].terms_url || '') : normalized.termsUrl;
                const locale = input.locale === undefined ? String(owned[0].locale || 'en') : normalized.locale;
                const lockedTimeZone = input.lockedTimeZone === undefined ? (owned[0].locked_time_zone || null) : normalized.lockedTimeZone;
                await connection.query(
                    `UPDATE scheduler_event_types SET slug=?, title=?, description=?, duration_minutes=?, interval_minutes=?,
                        buffer_before_minutes=?, buffer_after_minutes=?, minimum_notice_minutes=?, capacity=?, location_type=?,
                        location_label=?, destination_calendar_id=?, conflict_calendar_ids=?, availability_schedule_id=?, visibility=?, active=?,
                        booking_questions=?, requires_confirmation=?, cancellation_cutoff_minutes=?, reschedule_cutoff_minutes=?,
                        require_cancellation_reason=?, require_reschedule_reason=?, active_booking_limit=?, guest_allow_list=?, guest_deny_list=?,
                        require_email_verification=?, max_additional_guests=?, waitlist_enabled=?, max_recurrence_occurrences=?,
                        public_accent_color=?, public_intro=?, privacy_url=?, terms_url=?, locale=?, locked_time_zone=?
                        WHERE id=? AND system_managed = 0`,
                    [normalized.slug, normalized.title, normalized.description, normalized.durationMinutes, normalized.intervalMinutes,
                        normalized.bufferBeforeMinutes, normalized.bufferAfterMinutes, normalized.minimumNoticeMinutes, normalized.capacity,
                        normalized.locationType, normalized.locationLabel, normalized.destinationCalendarId,
                        JSON.stringify(normalized.conflictCalendarIds), availabilityScheduleId, visibility, normalized.active ? 1 : 0,
                        bookingQuestions, requiresConfirmation ? 1 : 0, cancellationCutoffMinutes, rescheduleCutoffMinutes,
                        requireCancellationReason ? 1 : 0, requireRescheduleReason ? 1 : 0, activeBookingLimit,
                        guestAllowList, guestDenyList, requireEmailVerification ? 1 : 0, maxAdditionalGuests,
                        waitlistEnabled ? 1 : 0, maxRecurrenceOccurrences, publicAccentColor, publicIntro, privacyUrl, termsUrl,
                        locale, lockedTimeZone, id]
                );
                if (visibility !== 'private') {
                    await connection.query(
                        'UPDATE scheduler_private_links SET revoked_at = UTC_TIMESTAMP(3) WHERE event_type_id = ? AND revoked_at IS NULL',
                        [id]
                    );
                }
                await connection.query('DELETE FROM scheduler_availability_windows WHERE event_type_id = ?', [id]);
            } else {
                await connection.query(
                    `INSERT INTO scheduler_event_types
                        (id, tenant_key, owner_username, slug, title, description, duration_minutes, interval_minutes,
                         buffer_before_minutes, buffer_after_minutes, minimum_notice_minutes, capacity, location_type,
                         location_label, destination_calendar_id, conflict_calendar_ids, availability_schedule_id, system_managed, visibility, active,
                         booking_questions, requires_confirmation, cancellation_cutoff_minutes, reschedule_cutoff_minutes,
                         require_cancellation_reason, require_reschedule_reason, active_booking_limit, guest_allow_list, guest_deny_list,
                         require_email_verification, max_additional_guests, waitlist_enabled, max_recurrence_occurrences,
                         public_accent_color, public_intro, privacy_url, terms_url, locale, locked_time_zone)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [id, entitlement.tenantKey, username, normalized.slug, normalized.title, normalized.description,
                        normalized.durationMinutes, normalized.intervalMinutes, normalized.bufferBeforeMinutes,
                        normalized.bufferAfterMinutes, normalized.minimumNoticeMinutes, normalized.capacity,
                        normalized.locationType, normalized.locationLabel, normalized.destinationCalendarId,
                        JSON.stringify(normalized.conflictCalendarIds), availabilityScheduleId, normalized.visibility,
                        normalized.active ? 1 : 0, JSON.stringify(normalized.questions), normalized.requiresConfirmation ? 1 : 0,
                        normalized.cancellationCutoffMinutes, normalized.rescheduleCutoffMinutes,
                        normalized.requireCancellationReason ? 1 : 0, normalized.requireRescheduleReason ? 1 : 0,
                        normalized.activeBookingLimit, JSON.stringify(normalized.guestAllowList), JSON.stringify(normalized.guestDenyList),
                        normalized.requireEmailVerification ? 1 : 0, normalized.maxAdditionalGuests,
                        normalized.waitlistEnabled ? 1 : 0, normalized.maxRecurrenceOccurrences, normalized.publicAccentColor,
                        normalized.publicIntro, normalized.privacyUrl, normalized.termsUrl, normalized.locale, normalized.lockedTimeZone]
                );
            }
            for (const window of normalized.windows) {
                await connection.query(
                    'INSERT INTO scheduler_availability_windows (event_type_id, weekday, start_minute, end_minute) VALUES (?, ?, ?, ?)',
                    [id, window.weekday, window.startMinute, window.endMinute]
                );
            }
            await this.writeAudit(connection, entitlement.tenantKey, 'user', username, eventId ? 'event_type.update' : 'event_type.create', 'event_type', id, { slug: normalized.slug });
            await connection.commit();
        } catch (error: any) {
            await connection.rollback();
            if (error?.code === 'ER_DUP_ENTRY') throw new Error('That event link is already in use');
            throw error;
        } finally {
            connection.release();
        }
        return (await this.getOwnedEventType(username, id))!;
    }

    async deleteEventType(username: string, eventId: string): Promise<void> {
        const entitlement = await this.requireOwner(username);
        const [bookings]: any = await this.pool.query('SELECT COUNT(*) AS total FROM scheduler_bookings WHERE event_type_id = ?', [eventId]);
        if (Number(bookings[0]?.total || 0) > 0) {
            const [result]: any = await this.pool.query('UPDATE scheduler_event_types SET active = 0 WHERE id = ? AND owner_username = ? AND system_managed = 0', [eventId, username]);
            if (!result.affectedRows) throw new Error('Event type not found');
        } else {
            const [result]: any = await this.pool.query('DELETE FROM scheduler_event_types WHERE id = ? AND owner_username = ? AND system_managed = 0', [eventId, username]);
            if (!result.affectedRows) throw new Error('Event type not found');
        }
        await this.writeAudit(this.pool, entitlement.tenantKey, 'user', username, 'event_type.delete', 'event_type', eventId, {});
    }

    async getOwnedEventType(username: string, id: string): Promise<SchedulerEventType | null> {
        const [rows]: any = await this.pool.query(
            `SELECT event_type.* FROM scheduler_event_types event_type
             WHERE event_type.id = ? AND event_type.owner_username = ? AND event_type.system_managed = 0
               AND NOT EXISTS (
                   SELECT 1 FROM scheduler_audit_events audit
                   WHERE audit.target_type = 'event_type'
                     AND audit.target_id = event_type.id
                     AND audit.action = 'event_type.delete'
               )
             LIMIT 1`,
            [id, username]
        );
        if (!rows.length) return null;
        const windows = await loadWindows(this.pool, [id]);
        return eventFromRow(rows[0], windows.get(id) || []);
    }

    async getPrivateLinkState(username: string, eventId: string): Promise<SchedulerPrivateLinkState> {
        await this.requireOwner(username);
        const event = await this.getOwnedEventType(username, eventId);
        if (!event) throw new Error('Event type not found');
        const [rows]: any = await this.pool.query(
            `SELECT token_hint, max_uses, uses_remaining, consumed_at, one_off_time_zone, one_off_windows,
                    CAST(expires_at AS CHAR) AS expires_at_utc
             FROM scheduler_private_links
             WHERE event_type_id = ? AND revoked_at IS NULL
             ORDER BY created_at DESC LIMIT 1`,
            [eventId]
        );
        if (!rows.length) return {
            active: false, expired: false, consumed: false, singleUse: false, remainingUses: null,
            oneOff: false, oneOffTimeZone: null, oneOffWindows: [], tokenHint: null, expiresAt: null,
        };
        const expiresAt = rows[0].expires_at_utc ? utcDate(rows[0].expires_at_utc) : null;
        const expired = Boolean(expiresAt && expiresAt <= new Date());
        const remainingUses = rows[0].uses_remaining === null ? null : Number(rows[0].uses_remaining);
        const consumed = rows[0].max_uses !== null && remainingUses === 0;
        const oneOffAvailability = oneOffAvailabilityFromRow(rows[0]);
        return {
            active: !expired && !consumed,
            expired,
            consumed,
            singleUse: Number(rows[0].max_uses) === 1,
            remainingUses,
            oneOff: Boolean(oneOffAvailability),
            oneOffTimeZone: oneOffAvailability?.timeZone || null,
            oneOffWindows: oneOffAvailability?.windows || [],
            tokenHint: rows[0].token_hint,
            expiresAt,
        };
    }

    async rotatePrivateLink(username: string, eventId: string, expiry: unknown, singleUse = false, oneOffInput: unknown = null): Promise<{ token: string; state: SchedulerPrivateLinkState }> {
        const entitlement = await this.requireOwner(username);
        const expiresAt = normalizePrivateLinkExpiry(expiry);
        const token = createSchedulerToken();
        const tokenHash = schedulerTokenHash(token);
        const tokenHint = token.slice(-8);
        let oneOffAvailability: SchedulerOneOffAvailability | null = null;
        let effectiveSingleUse = singleUse;
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [events]: any = await connection.query(
                `SELECT id, duration_minutes, visibility FROM scheduler_event_types
                 WHERE id = ? AND owner_username = ? AND system_managed = 0 FOR UPDATE`,
                [eventId, username]
            );
            if (!events.length) throw new Error('Event type not found');
            oneOffAvailability = normalizeOneOffAvailability(oneOffInput, Number(events[0].duration_minutes));
            if (oneOffAvailability && events[0].visibility !== 'private') throw new Error('One-off links require a private event type');
            effectiveSingleUse = singleUse || Boolean(oneOffAvailability);
            await connection.query(
                'UPDATE scheduler_private_links SET revoked_at = UTC_TIMESTAMP(3) WHERE event_type_id = ? AND revoked_at IS NULL',
                [eventId]
            );
            await connection.query(
                `INSERT INTO scheduler_private_links
                    (id, tenant_key, event_type_id, token_hash, token_hint, expires_at, max_uses, uses_remaining,
                     one_off_time_zone, one_off_windows)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [crypto.randomUUID(), entitlement.tenantKey, eventId, tokenHash, tokenHint, expiresAt ? mysqlDate(expiresAt) : null,
                    effectiveSingleUse ? 1 : null, effectiveSingleUse ? 1 : null,
                    oneOffAvailability?.timeZone || null, oneOffAvailability ? JSON.stringify(oneOffAvailability.windows) : null]
            );
            await this.writeAudit(connection, entitlement.tenantKey, 'user', username, 'private_link.rotate', 'event_type', eventId, {
                expiresAt: expiresAt?.toISOString() || null,
                singleUse: effectiveSingleUse,
                oneOff: Boolean(oneOffAvailability),
                oneOffWindowCount: oneOffAvailability?.windows.length || 0,
            });
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
        return { token, state: {
            active: true,
            expired: false,
            consumed: false,
            singleUse: effectiveSingleUse,
            remainingUses: effectiveSingleUse ? 1 : null,
            oneOff: Boolean(oneOffAvailability),
            oneOffTimeZone: oneOffAvailability?.timeZone || null,
            oneOffWindows: oneOffAvailability?.windows || [],
            tokenHint,
            expiresAt,
        } };
    }

    async revokePrivateLink(username: string, eventId: string): Promise<void> {
        const entitlement = await this.requireOwner(username);
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [events]: any = await connection.query(
                'SELECT id FROM scheduler_event_types WHERE id = ? AND owner_username = ? AND system_managed = 0 FOR UPDATE',
                [eventId, username]
            );
            if (!events.length) throw new Error('Event type not found');
            await connection.query(
                'UPDATE scheduler_private_links SET revoked_at = UTC_TIMESTAMP(3) WHERE event_type_id = ? AND revoked_at IS NULL',
                [eventId]
            );
            await this.writeAudit(connection, entitlement.tenantKey, 'user', username, 'private_link.revoke', 'event_type', eventId, {});
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    private async activePrivateLink(eventId: string, token: string): Promise<SchedulerActivePrivateLink | null> {
        const candidate = String(token || '').trim();
        if (candidate.length < 32 || candidate.length > 128) return null;
        const [rows]: any = await this.pool.query(
            `SELECT id, uses_remaining, one_off_time_zone, one_off_windows FROM scheduler_private_links
             WHERE event_type_id = ? AND token_hash = ? AND revoked_at IS NULL
               AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3))
               AND (uses_remaining IS NULL OR uses_remaining > 0)
             LIMIT 1`,
            [eventId, schedulerTokenHash(candidate)]
        );
        if (!rows.length) return null;
        const oneOffAvailability = oneOffAvailabilityFromRow(rows[0]);
        if ((rows[0].one_off_time_zone || rows[0].one_off_windows) && !oneOffAvailability) return null;
        return {
            id: rows[0].id,
            remainingUses: rows[0].uses_remaining === null ? null : Number(rows[0].uses_remaining),
            oneOffAvailability,
        };
    }

    private async rescheduleCapabilityAllows(eventId: string, token: string): Promise<boolean> {
        const candidate = String(token || '').trim();
        if (candidate.length < 32 || candidate.length > 128) return false;
        const [bookingRows]: any = await this.pool.query(
            `SELECT id FROM scheduler_bookings
             WHERE event_type_id = ? AND reschedule_token_hash = ? AND status = 'confirmed'
               AND action_tokens_expires_at > UTC_TIMESTAMP(3)
             LIMIT 1`,
            [eventId, schedulerTokenHash(candidate)]
        );
        return bookingRows.length > 0;
    }

    private async privateLinkAllows(eventId: string, token: string): Promise<boolean> {
        return Boolean(await this.activePrivateLink(eventId, token))
            || await this.rescheduleCapabilityAllows(eventId, token);
    }

    async getPublicProfile(handle: string): Promise<{ entitlement: SchedulerEntitlement; events: SchedulerEventType[]; defaultEvent: SchedulerEventType | null } | null> {
        const [rows]: any = await this.pool.query(
            'SELECT * FROM scheduler_mailbox_entitlements WHERE public_handle = ? AND enabled = 1 AND published = 1 LIMIT 1',
            [handle.toLowerCase()]
        );
        if (!rows.length) return null;
        const entitlement = entitlementFromRow(rows[0]);
        const allEvents = await this.listEventTypes(entitlement.username, true);
        const events = allEvents.filter((event) => event.active && event.visibility === 'public');
        const defaultEvent = allEvents.length === 0 ? await this.getSystemDefaultEvent(entitlement.username, true) : null;
        return { entitlement, events, defaultEvent };
    }

    async getPublicEvent(handle: string, slug: string, privateAccessToken = ''): Promise<{ entitlement: SchedulerEntitlement; event: SchedulerEventType } | null> {
        const profile = await this.getPublicProfile(handle);
        if (!profile) return null;
        const directEvents = await this.listEventTypes(profile.entitlement.username, true);
        const event = directEvents.find((candidate) => candidate.active && candidate.slug === slug.toLowerCase())
            || (profile.defaultEvent?.slug === slug ? profile.defaultEvent : null);
        if (!event) return null;
        if (event.visibility === 'private' && !(await this.privateLinkAllows(event.id, privateAccessToken))) return null;
        return { entitlement: profile.entitlement, event };
    }

    async listSlots(handle: string, slug: string, rangeStart: Date, rangeEnd: Date, privateAccessToken = '', includeFull = false): Promise<AvailabilitySlot[]> {
        if (!Number.isFinite(rangeStart.getTime()) || !Number.isFinite(rangeEnd.getTime()) || rangeStart >= rangeEnd) throw new Error('Invalid availability range');
        if (rangeEnd.getTime() - rangeStart.getTime() > 62 * 24 * 60 * 60 * 1000) throw new Error('Availability range cannot exceed 62 days');
        const result = await this.getPublicEvent(handle, slug, privateAccessToken);
        if (!result) return [];
        const privateLink = result.event.visibility === 'private'
            ? await this.activePrivateLink(result.event.id, privateAccessToken)
            : null;
        if (result.event.visibility === 'private'
            && !privateLink
            && !(await this.rescheduleCapabilityAllows(result.event.id, privateAccessToken))) return [];
        const busy = await this.busyIntervals(result.event, rangeStart, rangeEnd);
        const schedule = result.event.availabilityScheduleId
            ? await this.getAvailabilityScheduleById(result.event.availabilityScheduleId)
            : null;
        const oneOffAvailability = privateLink?.oneOffAvailability || null;
        const oneOffWindows = new Map<string, Array<{ startMinute: number; endMinute: number }>>();
        for (const window of oneOffAvailability?.windows || []) {
            oneOffWindows.set(window.date, [
                ...(oneOffWindows.get(window.date) || []),
                { startMinute: window.startMinute, endMinute: window.endMinute },
            ]);
        }
        const overrides: AvailabilityOverride[] | undefined = oneOffAvailability
            ? Array.from(oneOffWindows, ([date, windows]) => ({ date, windows }))
            : schedule?.overrides.map((override) => ({
                date: override.date,
                windows: override.unavailableAllDay ? [] : override.windows,
            }));
        if (!oneOffAvailability && schedule && overrides) {
            for (const date of exclusionDateKeys(schedule.exclusions, rangeStart, rangeEnd)) {
                if (!overrides.some((override) => override.date === date)) overrides.push({ date, windows: [] });
            }
        }
        const slots = calculateAvailability({
            timeZone: oneOffAvailability?.timeZone || schedule?.timeZone || result.entitlement.timeZone,
            rangeStart,
            rangeEnd,
            durationMinutes: result.event.durationMinutes,
            intervalMinutes: result.event.intervalMinutes,
            windows: oneOffAvailability ? [] : schedule?.windows || result.event.windows,
            overrides,
            busy,
            bufferBeforeMinutes: result.event.bufferBeforeMinutes,
            bufferAfterMinutes: result.event.bufferAfterMinutes,
            minimumNoticeMinutes: result.event.minimumNoticeMinutes,
        });
        const remainingByStart = await this.remainingCapacityByStart(result.event, rangeStart, rangeEnd);
        return slots.map((slot) => ({
            ...slot,
            remainingSeats: remainingByStart.get(slot.start.getTime()) ?? result.event.capacity,
        })).filter((slot: any) => includeFull || slot.remainingSeats > 0);
    }

    async requestEmailVerification(handle: string, slug: string, emailValue: unknown, privateAccessToken = ''): Promise<Record<string, unknown>> {
        const bookerEmail = String(emailValue || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bookerEmail)) throw new Error('A valid email address is required');
        const publicEvent = await this.getPublicEvent(handle, slug, privateAccessToken);
        if (!publicEvent) throw new Error('Event type not found');
        assertSchedulerGuestEligible(bookerEmail, publicEvent.event.guestAllowList, publicEvent.event.guestDenyList);
        if (!publicEvent.event.requireEmailVerification) throw new Error('Email verification is not required for this event');
        const challengeId = crypto.randomUUID();
        const code = crypto.randomBytes(8).toString('base64url').slice(0, 10);
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query(
                `DELETE FROM scheduler_email_verifications
                 WHERE event_type_id=? AND booker_email=? AND (expires_at <= UTC_TIMESTAMP(3) OR used_at IS NOT NULL)`,
                [publicEvent.event.id, bookerEmail]
            );
            await connection.query(
                `INSERT INTO scheduler_email_verifications
                    (id, tenant_key, event_type_id, booker_email, code_hash, expires_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [challengeId, publicEvent.entitlement.tenantKey, publicEvent.event.id, bookerEmail,
                    schedulerTokenHash(`${challengeId}:${code}`), mysqlDate(expiresAt)]
            );
            await this.enqueue(connection, publicEvent.entitlement.tenantKey, challengeId, 'booking.verification', `verification:${challengeId}`, {
                bookingId: challengeId, hostEmail: publicEvent.entitlement.username, bookerEmail, bookerName: bookerEmail,
                notificationFrom: publicEvent.entitlement.notificationFrom, notificationName: publicEvent.entitlement.displayName,
                title: publicEvent.event.title, verificationCode: code, start: new Date().toISOString(),
            });
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
        return { challengeId, expiresAt };
    }

    async createBooking(handle: string, slug: string, input: SchedulerBookingInput): Promise<Record<string, unknown>> {
        const bookerName = String(input.bookerName || '').trim().slice(0, 160);
        const bookerEmail = String(input.bookerEmail || '').trim().toLowerCase();
        if (!bookerName) throw new Error('Your name is required');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bookerEmail)) throw new Error('A valid email address is required');
        const bookerTimeZone = assertTimeZone(input.bookerTimeZone);
        const idempotencyKey = String(input.idempotencyKey || '').trim().slice(0, 128);
        if (idempotencyKey.length < 8) throw new Error('An idempotency key is required');
        const profile = await this.getPublicProfile(handle);
        if (!profile) throw new Error('Event type not found');
        const existing = await this.bookingByIdempotency(profile.entitlement.tenantKey, idempotencyKey);
        if (existing) {
            if (existing.eventTypeId !== input.eventTypeId
                || existing.bookerEmail !== bookerEmail
                || existing.start.getTime() !== input.start.getTime()) {
                throw new Error('Idempotency key was already used for another booking');
            }
            return { id: existing.id, status: existing.status, start: existing.start, end: existing.end, idempotentReplay: true };
        }

        const publicEvent = await this.getPublicEvent(handle, slug, input.privateAccessToken);
        if (!publicEvent || publicEvent.event.id !== input.eventTypeId) throw new Error('Event type not found');
        const communicationConsents = normalizeCommunicationConsents(input.communicationConsents || {});
        const availableCommunicationChannels = await this.workflows.requiredChannels(
            publicEvent.entitlement.username, publicEvent.event.id,
        );
        if (communicationConsents.channels.some(channel => !availableCommunicationChannels.includes(channel))) {
            throw new Error('Communication consent was provided for an unavailable channel');
        }
        if (publicEvent.event.lockedTimeZone && bookerTimeZone !== publicEvent.event.lockedTimeZone) {
            throw new SchedulerGuestPolicyError(`This event requires the ${publicEvent.event.lockedTimeZone} time zone`);
        }
        assertSchedulerGuestEligible(bookerEmail, publicEvent.event.guestAllowList, publicEvent.event.guestDenyList);
        const bookingAnswers = normalizeSchedulerBookingAnswers(publicEvent.event.questions, input.bookingAnswers);
        const attribution = normalizeSchedulerAttribution(input.attribution);
        const attendees = normalizeSchedulerAttendees(input.attendees, bookerEmail, publicEvent.event.maxAdditionalGuests);
        for (const attendee of attendees) {
            assertSchedulerGuestEligible(attendee.email, publicEvent.event.guestAllowList, publicEvent.event.guestDenyList);
        }
        const seats = Number(input.seats ?? 1);
        if (!Number.isInteger(seats) || seats < 1 || seats > publicEvent.event.capacity) {
            throw new SchedulerGuestPolicyError(`Seats must be an integer between 1 and ${publicEvent.event.capacity}`);
        }
        if (seats < attendees.length + 1) {
            throw new SchedulerGuestPolicyError('Seats must include the booker and every additional guest');
        }
        let verification: any = null;
        if (publicEvent.event.requireEmailVerification && !input.waitlistEntryId && !input.bookedByUsername && !input.verificationBypass) {
            const challengeId = String(input.verificationChallengeId || '');
            const code = String(input.verificationCode || '');
            const [verificationRows]: any = await this.pool.query(
                `SELECT * FROM scheduler_email_verifications
                 WHERE id=? AND event_type_id=? AND booker_email=? AND used_at IS NULL
                   AND expires_at > UTC_TIMESTAMP(3) AND attempts < 5 LIMIT 1`,
                [challengeId, publicEvent.event.id, bookerEmail]
            );
            verification = verificationRows[0];
            if (!verification || schedulerTokenHash(`${challengeId}:${code}`) !== verification.code_hash) {
                if (verification) await this.pool.query('UPDATE scheduler_email_verifications SET attempts=attempts+1 WHERE id=?', [challengeId]);
                throw new Error('A valid email verification code is required');
            }
        }
        const privateLink = publicEvent.event.visibility === 'private'
            ? await this.activePrivateLink(publicEvent.event.id, input.privateAccessToken || '')
            : null;
        if (publicEvent.event.visibility === 'private' && !privateLink) throw new Error('Event type not found');
        const end = new Date(input.start.getTime() + publicEvent.event.durationMinutes * 60 * 1000);
        const slots = await this.listSlots(handle, slug, new Date(input.start.getTime() - 1), new Date(end.getTime() + 1), input.privateAccessToken);
        if (!slots.some((slot) => slot.start.getTime() === input.start.getTime())) throw new Error('The selected time is no longer available');

        const hold = await this.holds.acquire({
            tenantKey: publicEvent.entitlement.tenantKey,
            eventTypeKey: publicEvent.event.id,
            hostUsername: publicEvent.entitlement.username,
            slotStart: input.start,
            slotEnd: end,
            capacity: publicEvent.event.capacity,
            seats,
            ttlSeconds: 300,
            idempotencyKey: `booking:${idempotencyKey}`,
        });
        const bookingId = crypto.randomUUID();
        const cancelToken = createSchedulerToken();
        const rescheduleToken = createSchedulerToken();
        const calendar = publicEvent.event.destinationCalendarId
            ? await this.assertCalendarOwnership(publicEvent.entitlement.username, publicEvent.event.destinationCalendarId)
            : await ensureDefaultCalendar(publicEvent.entitlement.username);
        const calendarUid = `scheduler-${bookingId}@openmailstack`;
        const eventSnapshot = JSON.stringify(publicEvent.event);
        const bookingStatus = publicEvent.event.requiresConfirmation ? 'requested' : 'confirmed';
        const ical = bookingStatus === 'confirmed' ? buildSchedulerCalendarEvent({
            uid: calendarUid,
            title: publicEvent.event.title,
            description: input.bookerNotes || '',
            location: publicEvent.event.locationLabel,
            start: input.start,
            end,
            hostEmail: publicEvent.entitlement.username,
            bookerName,
            bookerEmail,
            additionalAttendees: attendees,
            sequence: 0,
        }) : null;
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [lockedHolds]: any = await connection.query(
                "SELECT status FROM scheduler_slot_holds WHERE hold_token = ? AND tenant_key = ? AND expires_at > ? FOR UPDATE",
                [hold.token, publicEvent.entitlement.tenantKey, mysqlDate(new Date())]
            );
            if (!lockedHolds.length || lockedHolds[0].status !== 'held') throw new Error('The selected time is no longer available');
            if (publicEvent.event.activeBookingLimit !== null) {
                await connection.query(
                    `INSERT INTO scheduler_booker_locks (event_type_id, booker_email) VALUES (?, ?)
                     ON DUPLICATE KEY UPDATE updated_at=updated_at`,
                    [publicEvent.event.id, bookerEmail]
                );
                await connection.query(
                    'SELECT event_type_id FROM scheduler_booker_locks WHERE event_type_id=? AND booker_email=? FOR UPDATE',
                    [publicEvent.event.id, bookerEmail]
                );
                const [activeRows]: any = await connection.query(
                    `SELECT COUNT(*) AS total FROM scheduler_bookings
                     WHERE event_type_id=? AND booker_email=? AND status IN ('requested','confirmed')
                       AND slot_end > UTC_TIMESTAMP(3)`,
                    [publicEvent.event.id, bookerEmail]
                );
                if (Number(activeRows[0]?.total || 0) >= publicEvent.event.activeBookingLimit) {
                    throw new Error('You already have the maximum active bookings for this event. Use the secure link in your booking email to manage or reschedule the existing booking.');
                }
            }
            if (verification) {
                const [verificationRows]: any = await connection.query(
                    `SELECT code_hash FROM scheduler_email_verifications
                     WHERE id=? AND event_type_id=? AND booker_email=? AND used_at IS NULL
                       AND expires_at > UTC_TIMESTAMP(3) AND attempts < 5 FOR UPDATE`,
                    [verification.id, publicEvent.event.id, bookerEmail]
                );
                if (!verificationRows.length
                    || schedulerTokenHash(`${verification.id}:${String(input.verificationCode || '')}`) !== verificationRows[0].code_hash) {
                    throw new Error('A valid email verification code is required');
                }
                await connection.query('UPDATE scheduler_email_verifications SET used_at=UTC_TIMESTAMP(3) WHERE id=?', [verification.id]);
            }
            if (input.waitlistEntryId) {
                const [waitlistRows]: any = await connection.query(
                    `SELECT id, verified_at FROM scheduler_waitlist_entries
                     WHERE id=? AND event_type_id=? AND booker_email=? AND status='promoting' FOR UPDATE`,
                    [input.waitlistEntryId, publicEvent.event.id, bookerEmail]
                );
                if (!waitlistRows.length || (publicEvent.event.requireEmailVerification && !waitlistRows[0].verified_at)) {
                    throw new SchedulerGuestPolicyError('Waitlist promotion is no longer available');
                }
            }
            if (privateLink) {
                const [privateLinks]: any = await connection.query(
                    `SELECT id, uses_remaining FROM scheduler_private_links
                     WHERE id = ? AND event_type_id = ? AND revoked_at IS NULL
                       AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3))
                     FOR UPDATE`,
                    [privateLink.id, publicEvent.event.id]
                );
                const lockedPrivateLink = privateLinks[0];
                if (!lockedPrivateLink || (lockedPrivateLink.uses_remaining !== null && Number(lockedPrivateLink.uses_remaining) < 1)) {
                    throw new Error('Private booking link is no longer available');
                }
                if (lockedPrivateLink.uses_remaining !== null) {
                    const remainingUses = Number(lockedPrivateLink.uses_remaining) - 1;
                    await connection.query(
                        `UPDATE scheduler_private_links
                         SET uses_remaining = ?, consumed_at = CASE WHEN ? = 0 THEN UTC_TIMESTAMP(3) ELSE consumed_at END
                         WHERE id = ?`,
                        [remainingUses, remainingUses, privateLink.id]
                    );
                    await this.writeAudit(connection, publicEvent.entitlement.tenantKey, 'capability', privateLink.id,
                        'private_link.consume', 'booking', bookingId, { remainingUses });
                }
            }
            await connection.query(
                `INSERT INTO scheduler_bookings
                    (id, tenant_key, event_type_id, host_username, booked_by_username, status, seats, slot_start, slot_end, host_time_zone,
                     booker_time_zone, booker_name, booker_email, booker_phone, communication_consents, booker_notes, booking_answers, attribution, attendees, series_id, series_index, series_count, event_snapshot, cancel_token_hash,
                     reschedule_token_hash, action_tokens_expires_at, slot_hold_token, calendar_id, calendar_event_uid, idempotency_key, confirmed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [bookingId, publicEvent.entitlement.tenantKey, publicEvent.event.id, publicEvent.entitlement.username,
                    input.bookedByUsername || null, bookingStatus, seats, mysqlDate(input.start), mysqlDate(end), publicEvent.entitlement.timeZone, bookerTimeZone, bookerName,
                    bookerEmail, communicationConsents.phone || null, JSON.stringify(communicationConsents.channels),
                    String(input.bookerNotes || '').trim().slice(0, 4000), JSON.stringify(bookingAnswers), JSON.stringify(attribution), JSON.stringify(attendees),
                    input.seriesId || null, input.seriesIndex ?? null, input.seriesCount ?? null, eventSnapshot,
                    schedulerTokenHash(cancelToken), schedulerTokenHash(rescheduleToken), mysqlDate(new Date(end.getTime() + 30 * 24 * 60 * 60 * 1000)),
                    hold.token, calendar.id, calendarUid, idempotencyKey, bookingStatus === 'confirmed' ? mysqlDate(new Date()) : null]
            );
            await this.contactPreferences.recordConsents(
                connection, publicEvent.entitlement.tenantKey, bookerEmail, communicationConsents,
            );
            if (ical) {
                await connection.query(
                    `INSERT INTO events (calendar_id, uid, ical_data) VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE ical_data = VALUES(ical_data)`,
                    [calendar.id, calendarUid, ical]
                );
                await connection.query('UPDATE calendars SET sync_token = sync_token + 1 WHERE id = ?', [calendar.id]);
            }
            await this.workflows.captureForBooking(connection, {
                    tenantKey: publicEvent.entitlement.tenantKey,
                    bookingId,
                    eventTypeId: publicEvent.event.id,
                    hostEmail: publicEvent.entitlement.username,
                    notificationFrom: publicEvent.entitlement.notificationFrom,
                    notificationName: publicEvent.entitlement.displayName,
                    bookerEmail,
                    bookerName,
                    bookerPhone: communicationConsents.phone || undefined,
                    communicationConsents: communicationConsents.channels,
                    title: publicEvent.event.title,
                    start: input.start,
                    end,
                    status: bookingStatus,
                    locale: publicEvent.event.locale,
                    timeZone: bookerTimeZone,
                    manageUrl: `${schedulerConfig.publicBaseUrl}/scheduler/action/reschedule/${encodeURIComponent(rescheduleToken)}`,
                }, bookingStatus === 'requested' ? 'booking.requested' : 'booking.confirmed');
            await connection.query("UPDATE scheduler_slot_holds SET status = 'confirmed' WHERE hold_token = ?", [hold.token]);
            await connection.query(
                `UPDATE scheduler_slot_inventory SET held_seats = GREATEST(held_seats - ?, 0), confirmed_seats = confirmed_seats + ?
                 WHERE tenant_key = ? AND event_type_key = ? AND host_username = ? AND slot_start = ?`,
                [hold.seats, hold.seats, hold.tenantKey, hold.eventTypeKey, hold.hostUsername, mysqlDate(hold.slotStart)]
            );
            const notificationType = bookingStatus === 'requested' ? 'booking.requested' : 'booking.confirmed';
            if (!input.suppressNotification) await this.enqueue(connection, publicEvent.entitlement.tenantKey, bookingId, notificationType, `booking:${bookingId}:${bookingStatus}`, {
                bookingId, hostEmail: publicEvent.entitlement.username, bookerEmail, bookerName,
                notificationFrom: publicEvent.entitlement.notificationFrom, notificationName: publicEvent.entitlement.displayName,
                title: publicEvent.event.title, start: input.start.toISOString(), end: end.toISOString(),
                timeZone: bookerTimeZone, cancelToken,
                additionalAttendees: attendees, seats,
                ...(bookingStatus === 'confirmed' ? { rescheduleToken, ical } : {}),
            });
            await this.writeAudit(connection, publicEvent.entitlement.tenantKey, 'anonymous', bookerEmail, 'booking.create', 'booking', bookingId, {
                eventTypeId: publicEvent.event.id,
                status: bookingStatus,
            });
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            await this.releaseHold(hold.token).catch(() => undefined);
            throw error;
        } finally {
            connection.release();
        }
        return { id: bookingId, status: bookingStatus, start: input.start, end, cancelToken, rescheduleToken, seats };
    }

    async createRecurringBooking(handle: string, slug: string, input: SchedulerBookingInput): Promise<Record<string, unknown>> {
        const publicEvent = await this.getPublicEvent(handle, slug, input.privateAccessToken);
        if (!publicEvent || publicEvent.event.id !== input.eventTypeId) throw new Error('Event type not found');
        const count = normalizeRecurrenceCount(input.recurrenceCount, publicEvent.event.maxRecurrenceOccurrences);
        if (count === 1) return this.createBooking(handle, slug, input);
        if (publicEvent.event.visibility === 'private') throw new Error('Recurring bookings are not available through private links');
        const baseIdempotencyKey = String(input.idempotencyKey || '').trim();
        if (baseIdempotencyKey.length < 8 || baseIdempotencyKey.length > 112) {
            throw new Error('A recurring booking idempotency key must contain between 8 and 112 characters');
        }
        const lockName = `oms-series-${schedulerTokenHash(`${publicEvent.entitlement.tenantKey}:${baseIdempotencyKey}`).slice(0, 48)}`;
        const lockConnection = await this.pool.getConnection();
        try {
            const [lockRows]: any = await lockConnection.query('SELECT GET_LOCK(?, 10) AS acquired', [lockName]);
            if (Number(lockRows[0]?.acquired) !== 1) throw new Error('Another recurring booking request is still being processed');
            const [firstRows]: any = await this.pool.query(
                `SELECT event_type_id,booker_email,CAST(slot_start AS CHAR) AS slot_start_utc,series_id,series_count
                 FROM scheduler_bookings WHERE tenant_key=? AND idempotency_key=? LIMIT 1`,
                [publicEvent.entitlement.tenantKey, `${baseIdempotencyKey}:series:1`]
            );
            if (firstRows.length) {
                const first = firstRows[0];
                if (first.event_type_id !== input.eventTypeId
                    || first.booker_email !== String(input.bookerEmail || '').trim().toLowerCase()
                    || utcDate(first.slot_start_utc).getTime() !== input.start.getTime()
                    || Number(first.series_count) !== count) {
                    throw new Error('Idempotency key was already used for another recurring booking');
                }
                const [seriesRows]: any = await this.pool.query(
                    `SELECT id,status,CAST(slot_start AS CHAR) AS slot_start_utc,CAST(slot_end AS CHAR) AS slot_end_utc,series_index
                     FROM scheduler_bookings WHERE series_id=? ORDER BY series_index`, [first.series_id]
                );
                if (seriesRows.length === count) {
                    const bookings = seriesRows.map((row: any) => ({
                        id: row.id, status: row.status, start: utcDate(row.slot_start_utc), end: utcDate(row.slot_end_utc), idempotentReplay: true,
                    }));
                    return { ...bookings[0], seriesId: first.series_id, recurrenceCount: count, bookings, idempotentReplay: true };
                }
                for (const row of seriesRows.reverse()) await this.rollbackCreatedBooking(String(row.id));
            }
            const seriesId = crypto.randomUUID();
            const created: any[] = [];
            const localSignature = (date: Date) => new Intl.DateTimeFormat('en-US', {
                timeZone: publicEvent.entitlement.timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
            }).format(date);
            const signature = localSignature(input.start);
            try {
                for (let index = 0; index < count; index += 1) {
                    let start = input.start;
                    if (index > 0) {
                        const approximate = new Date(input.start.getTime() + index * 7 * 24 * 60 * 60 * 1000);
                        const candidates = await this.listSlots(
                            handle, slug, new Date(approximate.getTime() - 18 * 60 * 60 * 1000),
                            new Date(approximate.getTime() + 18 * 60 * 60 * 1000), input.privateAccessToken,
                        );
                        const matching = candidates.find(candidate => localSignature(candidate.start) === signature);
                        if (!matching) throw new Error(`Recurring occurrence ${index + 1} is not available at the same local time`);
                        start = matching.start;
                    }
                    created.push(await this.createBooking(handle, slug, {
                        ...input,
                        start,
                        idempotencyKey: `${baseIdempotencyKey}:series:${index + 1}`,
                        seriesId,
                        seriesIndex: index + 1,
                        seriesCount: count,
                        verificationBypass: index > 0,
                        suppressNotification: true,
                    }));
                }
                await this.queueExistingBookingNotifications(created);
                return { ...created[0], seriesId, recurrenceCount: count, bookings: created };
            } catch (error) {
                const rollbackErrors: unknown[] = [];
                for (const booking of created.reverse()) {
                    try { await this.rollbackCreatedBooking(String(booking.id)); }
                    catch (rollbackError) { rollbackErrors.push(rollbackError); }
                }
                if (publicEvent.event.requireEmailVerification && input.verificationChallengeId) {
                    await this.pool.query(
                        `UPDATE scheduler_email_verifications SET used_at=NULL
                         WHERE id=? AND event_type_id=? AND booker_email=? AND expires_at>UTC_TIMESTAMP(3)`,
                        [input.verificationChallengeId, publicEvent.event.id, String(input.bookerEmail || '').trim().toLowerCase()]
                    );
                }
                if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'Recurring booking failed and could not be fully rolled back');
                throw error;
            }
        } finally {
            await lockConnection.query('SELECT RELEASE_LOCK(?)', [lockName]).catch(() => undefined);
            lockConnection.release();
        }
    }

    async joinWaitlist(handle: string, slug: string, input: SchedulerBookingInput): Promise<Record<string, unknown>> {
        const publicEvent = await this.getPublicEvent(handle, slug, input.privateAccessToken);
        if (!publicEvent || publicEvent.event.id !== input.eventTypeId || !publicEvent.event.waitlistEnabled) throw new Error('Waitlist is not available');
        const bookerName = String(input.bookerName || '').trim().slice(0, 160);
        const bookerEmail = String(input.bookerEmail || '').trim().toLowerCase();
        if (!bookerName) throw new Error('Your name is required');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bookerEmail)) throw new Error('A valid email address is required');
        const communicationConsents = normalizeCommunicationConsents(input.communicationConsents || {});
        const availableCommunicationChannels = await this.workflows.requiredChannels(
            publicEvent.entitlement.username, publicEvent.event.id,
        );
        if (communicationConsents.channels.some(channel => !availableCommunicationChannels.includes(channel))) {
            throw new Error('Communication consent was provided for an unavailable channel');
        }
        const bookerTimeZone = assertTimeZone(input.bookerTimeZone);
        if (publicEvent.event.lockedTimeZone && publicEvent.event.lockedTimeZone !== bookerTimeZone) {
            throw new Error(`This event requires the ${publicEvent.event.lockedTimeZone} time zone`);
        }
        assertSchedulerGuestEligible(bookerEmail, publicEvent.event.guestAllowList, publicEvent.event.guestDenyList);
        const attendees = normalizeSchedulerAttendees(input.attendees, bookerEmail, publicEvent.event.maxAdditionalGuests);
        for (const attendee of attendees) assertSchedulerGuestEligible(attendee.email, publicEvent.event.guestAllowList, publicEvent.event.guestDenyList);
        const seats = Number(input.seats ?? 1);
        if (!Number.isInteger(seats) || seats < attendees.length + 1 || seats > publicEvent.event.capacity) {
            throw new Error('Waitlist seats must include the booker and guests within event capacity');
        }
        const idempotencyKey = String(input.idempotencyKey || '').trim().slice(0, 128);
        if (idempotencyKey.length < 8) throw new Error('An idempotency key is required');
        const [existingRows]: any = await this.pool.query(
            `SELECT id,status,promoted_booking_id,event_type_id,booker_email,CAST(desired_start AS CHAR) AS desired_start_utc
             FROM scheduler_waitlist_entries WHERE tenant_key=? AND idempotency_key=? LIMIT 1`,
            [publicEvent.entitlement.tenantKey, idempotencyKey]
        );
        if (existingRows.length) {
            const existing = existingRows[0];
            if (existing.event_type_id !== input.eventTypeId || existing.booker_email !== bookerEmail
                || utcDate(existing.desired_start_utc).getTime() !== input.start.getTime()) {
                throw new Error('Idempotency key was already used for another waitlist request');
            }
            return { id: existing.id, status: existing.status, promotedBookingId: existing.promoted_booking_id, idempotentReplay: true };
        }
        if (!(input.start instanceof Date) || !Number.isFinite(input.start.getTime()) || input.start.getTime() <= Date.now()) {
            throw new Error('Waitlist time must be in the future');
        }
        const end = new Date(input.start.getTime() + publicEvent.event.durationMinutes * 60_000);
        const candidateSlots = await this.listSlots(
            handle, slug, new Date(input.start.getTime() - 1), new Date(end.getTime() + 1), input.privateAccessToken, true
        );
        if (!candidateSlots.some(slot => slot.start.getTime() === input.start.getTime())) {
            throw new Error('This time is not available for the waitlist');
        }
        const [inventoryRows]: any = await this.pool.query(
            `SELECT i.capacity-i.confirmed_seats-
                    COALESCE(SUM(CASE WHEN h.status='held' AND h.expires_at>UTC_TIMESTAMP(3) THEN h.seats ELSE 0 END),0) AS remaining
             FROM scheduler_slot_inventory i LEFT JOIN scheduler_slot_holds h
               ON h.tenant_key=i.tenant_key AND h.event_type_key=i.event_type_key AND h.host_username=i.host_username
              AND h.slot_start=i.slot_start AND h.slot_end=i.slot_end
             WHERE i.tenant_key=? AND i.event_type_key=? AND i.host_username=? AND i.slot_start=?
             GROUP BY i.capacity,i.confirmed_seats`,
            [publicEvent.entitlement.tenantKey, publicEvent.event.id, publicEvent.entitlement.username, mysqlDate(input.start)]
        );
        if (!inventoryRows.length || Number(inventoryRows[0].remaining) >= seats) throw new Error('This time still has enough capacity to book directly');
        let verification: any = null;
        if (publicEvent.event.requireEmailVerification) {
            const challengeId = String(input.verificationChallengeId || '');
            const [rows]: any = await this.pool.query(
                `SELECT * FROM scheduler_email_verifications WHERE id=? AND event_type_id=? AND booker_email=?
                 AND used_at IS NULL AND expires_at>UTC_TIMESTAMP(3) AND attempts<5 LIMIT 1`,
                [challengeId, publicEvent.event.id, bookerEmail]
            );
            verification = rows[0];
            if (!verification || schedulerTokenHash(`${challengeId}:${String(input.verificationCode || '')}`) !== verification.code_hash) {
                if (verification) {
                    await this.pool.query(
                        'UPDATE scheduler_email_verifications SET attempts=attempts+1 WHERE id=? AND used_at IS NULL',
                        [verification.id]
                    );
                }
                throw new Error('A valid email verification code is required');
            }
        }
        const id = crypto.randomUUID();
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            if (verification) {
                const [locked]: any = await connection.query(
                    `SELECT code_hash FROM scheduler_email_verifications WHERE id=? AND used_at IS NULL
                     AND expires_at>UTC_TIMESTAMP(3) AND attempts<5 FOR UPDATE`, [verification.id]
                );
                if (!locked.length) throw new Error('A valid email verification code is required');
                await connection.query('UPDATE scheduler_email_verifications SET used_at=UTC_TIMESTAMP(3) WHERE id=?', [verification.id]);
            }
            await connection.query(
                `INSERT INTO scheduler_waitlist_entries
                 (id,tenant_key,event_type_id,desired_start,desired_end,booker_time_zone,booker_name,booker_email,
                  booker_phone,communication_consents,booker_notes,seats,attendees,verified_at,idempotency_key)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
                [id, publicEvent.entitlement.tenantKey, publicEvent.event.id, mysqlDate(input.start), mysqlDate(end), bookerTimeZone,
                    bookerName, bookerEmail, communicationConsents.phone || null, JSON.stringify(communicationConsents.channels),
                    String(input.bookerNotes || '').trim().slice(0, 4000), seats, JSON.stringify(attendees),
                    verification ? mysqlDate(new Date()) : null, idempotencyKey]
            );
            await this.contactPreferences.recordConsents(
                connection, publicEvent.entitlement.tenantKey, bookerEmail, communicationConsents,
            );
            await this.enqueue(connection, publicEvent.entitlement.tenantKey, id, 'waitlist.joined', `waitlist:${id}:joined`, {
                bookingId: id, hostEmail: publicEvent.entitlement.username, bookerEmail, bookerName,
                notificationFrom: publicEvent.entitlement.notificationFrom, notificationName: publicEvent.entitlement.displayName,
                title: publicEvent.event.title, start: input.start.toISOString(), end: end.toISOString(), timeZone: bookerTimeZone,
            });
            await this.writeAudit(connection, publicEvent.entitlement.tenantKey, 'anonymous', bookerEmail, 'waitlist.join', 'waitlist', id, { eventTypeId: publicEvent.event.id });
            await connection.commit();
        } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
        return { id, status: 'pending', start: input.start, seats };
    }

    async listWaitlist(username: string): Promise<any[]> {
        await this.requireOwner(username);
        const [rows]: any = await this.pool.query(
            `SELECT w.id,w.status,w.booker_name,w.booker_email,w.seats,w.attendees,w.promoted_booking_id,
                    CAST(w.desired_start AS CHAR) AS desired_start_utc,e.title,e.slug
             FROM scheduler_waitlist_entries w JOIN scheduler_event_types e ON e.id=w.event_type_id
             WHERE e.owner_username=? ORDER BY w.created_at`, [username]
        );
        return rows.map((row: any) => ({ ...row, desiredStart: utcDate(row.desired_start_utc), attendees: attendeesFromRow(row.attendees) }));
    }

    async promoteWaitlist(eventTypeId: string, start: Date): Promise<Record<string, unknown> | null> {
        const connection = await this.pool.getConnection();
        let entry: any = null;
        try {
            await connection.beginTransaction();
            const [rows]: any = await connection.query(
                `SELECT w.*,e.slug,m.public_handle FROM scheduler_waitlist_entries w
                 JOIN scheduler_event_types e ON e.id=w.event_type_id
                 JOIN scheduler_mailbox_entitlements m ON m.username=e.owner_username
                 WHERE w.event_type_id=? AND w.desired_start=? AND w.status='pending'
                   AND w.seats <= COALESCE((SELECT i.capacity-i.confirmed_seats-
                       COALESCE(SUM(CASE WHEN h.status='held' AND h.expires_at>UTC_TIMESTAMP(3) THEN h.seats ELSE 0 END),0)
                       FROM scheduler_slot_inventory i LEFT JOIN scheduler_slot_holds h
                         ON h.tenant_key=i.tenant_key AND h.event_type_key=i.event_type_key AND h.host_username=i.host_username
                        AND h.slot_start=i.slot_start AND h.slot_end=i.slot_end
                       WHERE i.event_type_key=w.event_type_id AND i.host_username=e.owner_username AND i.slot_start=w.desired_start
                       GROUP BY i.capacity,i.confirmed_seats),0)
                 ORDER BY w.created_at LIMIT 1 FOR UPDATE`, [eventTypeId, mysqlDate(start)]
            );
            entry = rows[0];
            if (!entry) { await connection.commit(); return null; }
            await connection.query("UPDATE scheduler_waitlist_entries SET status='promoting' WHERE id=?", [entry.id]);
            await connection.commit();
        } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
        try {
            const booking = await this.createBooking(entry.public_handle, entry.slug, {
                eventTypeId, start, bookerTimeZone: entry.booker_time_zone, bookerName: entry.booker_name,
                bookerEmail: entry.booker_email, bookerNotes: entry.booker_notes || '', seats: Number(entry.seats),
                communicationConsents: {
                    phone: entry.booker_phone || '',
                    channels: jsonArray(entry.communication_consents) as any,
                },
                attendees: attendeesFromRow(entry.attendees), idempotencyKey: `waitlist:${entry.id}`, waitlistEntryId: entry.id,
            });
            await this.pool.query("UPDATE scheduler_waitlist_entries SET status='promoted', promoted_booking_id=? WHERE id=?", [booking.id, entry.id]);
            return booking;
        } catch (error) {
            const permanentlyIneligible = error instanceof SchedulerGuestPolicyError;
            const status = permanentlyIneligible ? 'failed' : 'pending';
            await this.pool.query("UPDATE scheduler_waitlist_entries SET status=? WHERE id=? AND status='promoting'", [status, entry.id]);
            if (permanentlyIneligible) return this.promoteWaitlist(eventTypeId, start);
            return null;
        }
    }

    async bookOnBehalf(username: string, eventTypeId: string, input: Omit<SchedulerBookingInput, 'eventTypeId'>): Promise<Record<string, unknown>> {
        const entitlement = await this.requireOwner(username);
        const event = await this.getOwnedEventType(username, eventTypeId);
        if (!event || event.systemManaged) throw new Error('Event type not found');
        return this.createBooking(entitlement.handle, event.slug, {
            ...input, bookerTimeZone: event.lockedTimeZone || input.bookerTimeZone,
            eventTypeId, bookedByUsername: username,
        });
    }

    async markBookingOutcome(username: string, bookingId: string, outcome: 'completed' | 'no_show'): Promise<void> {
        const entitlement = await this.requireOwner(username);
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [rows]: any = await connection.query(
                `SELECT b.*, CAST(b.slot_start AS CHAR) AS slot_start_utc, CAST(b.slot_end AS CHAR) AS slot_end_utc,
                        m.notification_from, m.display_name
                 FROM scheduler_bookings b
                 JOIN scheduler_mailbox_entitlements m ON m.username=b.host_username
                 WHERE b.id=? AND b.host_username=? FOR UPDATE`, [bookingId, username]
            );
            if (!rows.length) throw new Error('Booking not found');
            if (rows[0].status === outcome) { await connection.commit(); return; }
            if (rows[0].status !== 'confirmed') throw new Error('Only confirmed bookings can be completed or marked no-show');
            if (utcDate(rows[0].slot_end_utc).getTime() > Date.now()) throw new Error('A booking can be completed or marked no-show only after it ends');
            await connection.query(
                `UPDATE scheduler_bookings SET status=?, no_show_at=CASE WHEN ?='no_show' THEN UTC_TIMESTAMP(3) ELSE NULL END WHERE id=?`,
                [outcome, outcome, bookingId]
            );
            const booking = rows[0];
            const snapshot = JSON.parse(booking.event_snapshot);
            await this.workflows.triggerForBooking(connection, {
                tenantKey: booking.tenant_key,
                bookingId: booking.id,
                eventTypeId: booking.event_type_id,
                hostEmail: booking.host_username,
                notificationFrom: booking.notification_from || booking.host_username,
                notificationName: booking.display_name,
                bookerEmail: booking.booker_email,
                bookerName: booking.booker_name,
                bookerPhone: booking.booker_phone || undefined,
                communicationConsents: jsonArray(booking.communication_consents) as any,
                title: snapshot.title || 'Meeting',
                start: utcDate(booking.slot_start_utc),
                end: utcDate(booking.slot_end_utc),
                status: outcome,
                locale: snapshot.locale || 'en',
                timeZone: booking.booker_time_zone,
                manageUrl: `${schedulerConfig.publicBaseUrl}/scheduler`,
            }, outcome === 'completed' ? 'booking.completed' : 'booking.no_show');
            await this.writeAudit(connection, entitlement.tenantKey, 'user', username, `booking.${outcome}`, 'booking', bookingId, {});
            await connection.commit();
        } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    }

    private async queueExistingBookingNotifications(tokensByBooking: any[]): Promise<void> {
        const pending: Array<{ booking: any; tokens: any; ical?: string }> = [];
        for (const tokens of tokensByBooking) {
            const [rows]: any = await this.pool.query(
                `SELECT b.*,CAST(b.slot_start AS CHAR) AS slot_start_utc,CAST(b.slot_end AS CHAR) AS slot_end_utc,
                        m.notification_from,m.display_name FROM scheduler_bookings b
                 JOIN scheduler_mailbox_entitlements m ON m.username=b.host_username WHERE b.id=? LIMIT 1`, [tokens.id]
            );
            const booking = rows[0];
            if (!booking) continue;
            const [calendarRows]: any = await this.pool.query('SELECT ical_data FROM events WHERE calendar_id=? AND uid=? LIMIT 1', [booking.calendar_id, booking.calendar_event_uid]);
            pending.push({ booking, tokens, ical: calendarRows[0]?.ical_data });
        }
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            for (const { booking, tokens, ical } of pending) {
                const snapshot = JSON.parse(booking.event_snapshot);
                const type = booking.status === 'requested' ? 'booking.requested' : 'booking.confirmed';
                await this.enqueue(connection, booking.tenant_key, booking.id, type, `booking:${booking.id}:${booking.status}`, {
                    bookingId: booking.id, hostEmail: booking.host_username, bookerEmail: booking.booker_email, bookerName: booking.booker_name,
                    notificationFrom: booking.notification_from || booking.host_username, notificationName: booking.display_name,
                    title: snapshot.title, start: utcDate(booking.slot_start_utc).toISOString(), end: utcDate(booking.slot_end_utc).toISOString(),
                    timeZone: booking.booker_time_zone, cancelToken: tokens.cancelToken,
                    additionalAttendees: attendeesFromRow(booking.attendees), seats: Number(booking.seats || 1),
                    ...(type === 'booking.confirmed' ? { rescheduleToken: tokens.rescheduleToken, ical } : {}),
                });
            }
            await connection.commit();
        } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    }

    private async rollbackCreatedBooking(bookingId: string): Promise<void> {
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [rows]: any = await connection.query(
                'SELECT * FROM scheduler_bookings WHERE id=? FOR UPDATE', [bookingId]
            );
            const booking = rows[0];
            if (!booking) { await connection.commit(); return; }
            if (booking.calendar_id && booking.calendar_event_uid) {
                await connection.query('DELETE FROM events WHERE calendar_id=? AND uid=?', [booking.calendar_id, booking.calendar_event_uid]);
                await connection.query('UPDATE calendars SET sync_token=sync_token+1 WHERE id=?', [booking.calendar_id]);
            }
            await connection.query(
                `UPDATE scheduler_slot_inventory SET confirmed_seats=GREATEST(confirmed_seats-?,0)
                 WHERE tenant_key=? AND event_type_key=? AND host_username=? AND slot_start=?`,
                [Number(booking.seats || 1), booking.tenant_key, booking.event_type_id, booking.host_username, booking.slot_start]
            );
            await connection.query("UPDATE scheduler_slot_holds SET status='released' WHERE hold_token=?", [booking.slot_hold_token]);
            await connection.query('DELETE FROM scheduler_outbox WHERE aggregate_id=?', [bookingId]);
            await connection.query("DELETE FROM scheduler_audit_events WHERE target_type='booking' AND target_id=?", [bookingId]);
            await connection.query('DELETE FROM scheduler_bookings WHERE id=?', [bookingId]);
            await connection.commit();
        } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    }

    async listBookings(username: string, filter = 'upcoming'): Promise<Array<Record<string, unknown>>> {
        await this.requireOwner(username);
        const clauses = ['host_username = ?'];
        if (filter === 'upcoming') clauses.push("status IN ('requested','confirmed') AND slot_end >= UTC_TIMESTAMP(3)");
        if (filter === 'past') clauses.push("slot_end < UTC_TIMESTAMP(3) AND status <> 'cancelled'");
        if (filter === 'cancelled') clauses.push("status = 'cancelled'");
        if (filter === 'rejected') clauses.push("status = 'rejected'");
        const [rows]: any = await this.pool.query(
            `SELECT id, event_type_id, host_username, booked_by_username, status, seats, CAST(slot_start AS CHAR) AS slot_start_utc,
                    CAST(slot_end AS CHAR) AS slot_end_utc, host_time_zone, booker_time_zone,
                    booker_name, booker_email, booker_notes, booking_answers, attribution, attendees, series_id, series_index, series_count,
                    event_snapshot, calendar_id, calendar_event_uid,
                    cancellation_reason, reschedule_reason, UNIX_TIMESTAMP(created_at) * 1000 AS created_at_epoch
             FROM scheduler_bookings WHERE ${clauses.join(' AND ')} ORDER BY slot_start ASC`,
            [username]
        );
        return rows.map((row: any) => ({
            id: row.id,
            eventTypeId: row.event_type_id,
            status: row.status,
            bookedByUsername: row.booked_by_username || null,
            seats: Number(row.seats || 1),
            start: utcDate(row.slot_start_utc),
            end: utcDate(row.slot_end_utc),
            hostTimeZone: row.host_time_zone,
            bookerTimeZone: row.booker_time_zone,
            bookerName: row.booker_name,
            bookerEmail: row.booker_email,
            bookerNotes: row.booker_notes || '',
            bookingAnswers: bookingAnswersFromRow(row.booking_answers),
            attribution: attributionFromRow(row.attribution),
            attendees: attendeesFromRow(row.attendees),
            seriesId: row.series_id || null,
            seriesIndex: row.series_index == null ? null : Number(row.series_index),
            seriesCount: row.series_count == null ? null : Number(row.series_count),
            cancellationReason: row.cancellation_reason || '',
            rescheduleReason: row.reschedule_reason || '',
            event: JSON.parse(row.event_snapshot),
            calendarId: row.calendar_id,
            calendarEventUid: row.calendar_event_uid,
            createdAt: new Date(Number(row.created_at_epoch)),
        }));
    }

    async getCapabilityBooking(token: string, scope: 'cancel' | 'reschedule'): Promise<Record<string, unknown> | null> {
        const column = scope === 'cancel' ? 'cancel_token_hash' : 'reschedule_token_hash';
        const [rows]: any = await this.pool.query(
            `SELECT b.id, b.status, CAST(b.slot_start AS CHAR) AS slot_start_utc,
                    CAST(b.slot_end AS CHAR) AS slot_end_utc, b.booker_name, b.booker_email, b.event_snapshot,
                    m.public_handle
             FROM scheduler_bookings b
             JOIN scheduler_mailbox_entitlements m ON m.username = b.host_username
             WHERE b.${column} = ? AND b.action_tokens_expires_at > UTC_TIMESTAMP(3) AND m.enabled = 1 LIMIT 1`,
            [schedulerTokenHash(token)]
        );
        if (!rows.length) return null;
        const event = JSON.parse(rows[0].event_snapshot);
        const policy = schedulerBookingActionPolicy(event, scope, utcDate(rows[0].slot_start_utc));
        const statusAllowsAction = scope === 'cancel'
            ? ['requested', 'confirmed'].includes(rows[0].status)
            : rows[0].status === 'confirmed';
        return {
            id: rows[0].id,
            status: rows[0].status,
            start: utcDate(rows[0].slot_start_utc),
            end: utcDate(rows[0].slot_end_utc),
            bookerName: rows[0].booker_name,
            bookerEmail: rows[0].booker_email,
            event,
            handle: rows[0].public_handle,
            policy: {
                ...policy,
                allowed: policy.allowed && statusAllowsAction,
                closesAt: policy.closesAt?.toISOString() || null,
            },
        };
    }

    async cancelBookingByToken(token: string, reason?: unknown): Promise<Record<string, unknown> | null> {
        const booking = await this.lockCapabilityBooking(token, 'cancel');
        if (!booking) return null;
        await this.cancelBooking(booking, 'capability', booking.booker_email, reason);
        return { id: booking.id, status: 'cancelled' };
    }

    async cancelOwnedBooking(username: string, bookingId: string): Promise<void> {
        await this.requireOwner(username);
        const [rows]: any = await this.pool.query('SELECT * FROM scheduler_bookings WHERE id = ? AND host_username = ? LIMIT 1', [bookingId, username]);
        if (!rows.length) throw new Error('Booking not found');
        await this.cancelBooking(rows[0], 'user', username);
    }

    async decideBooking(username: string, bookingId: string, decision: 'confirmed' | 'rejected'): Promise<Record<string, unknown>> {
        await this.requireOwner(username);
        const nextCancelToken = decision === 'confirmed' ? createSchedulerToken() : '';
        const nextRescheduleToken = decision === 'confirmed' ? createSchedulerToken() : '';
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [rows]: any = await connection.query(
                `SELECT b.*, CAST(b.slot_start AS CHAR) AS slot_start_utc, CAST(b.slot_end AS CHAR) AS slot_end_utc,
                        m.notification_from, m.display_name
                 FROM scheduler_bookings b
                 JOIN scheduler_mailbox_entitlements m ON m.username = b.host_username
                 WHERE b.id = ? AND b.host_username = ? FOR UPDATE`,
                [bookingId, username]
            );
            const booking = rows[0];
            if (!booking) throw new Error('Booking not found');
            if (booking.status === decision) {
                await connection.commit();
                return { id: booking.id, status: decision, idempotentReplay: true };
            }
            if (booking.status !== 'requested') throw new Error('Booking can no longer be approved or rejected');
            const snapshot = JSON.parse(booking.event_snapshot);
            if (decision === 'confirmed') {
                const start = utcDate(booking.slot_start_utc);
                const end = utcDate(booking.slot_end_utc);
                const ical = buildSchedulerCalendarEvent({
                    uid: booking.calendar_event_uid,
                    title: snapshot.title || 'Meeting',
                    description: booking.booker_notes || '',
                    location: snapshot.locationLabel || '',
                    start,
                    end,
                    hostEmail: booking.host_username,
                    bookerName: booking.booker_name,
                    bookerEmail: booking.booker_email,
                    additionalAttendees: attendeesFromRow(booking.attendees),
                    sequence: 0,
                });
                await connection.query(
                    `UPDATE scheduler_bookings
                     SET status='confirmed', confirmed_at=UTC_TIMESTAMP(3), rejected_at=NULL,
                         cancel_token_hash=?, reschedule_token_hash=?, action_tokens_expires_at=?
                     WHERE id=?`,
                    [schedulerTokenHash(nextCancelToken), schedulerTokenHash(nextRescheduleToken),
                        mysqlDate(new Date(end.getTime() + 30 * 24 * 60 * 60 * 1000)), booking.id]
                );
                await connection.query(
                    `INSERT INTO events (calendar_id, uid, ical_data) VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE ical_data=VALUES(ical_data)`,
                    [booking.calendar_id, booking.calendar_event_uid, ical]
                );
                await connection.query('UPDATE calendars SET sync_token=sync_token+1 WHERE id=?', [booking.calendar_id]);
                await this.workflows.activateCapturedForBooking(connection, {
                    tenantKey: booking.tenant_key,
                    bookingId: booking.id,
                    eventTypeId: booking.event_type_id,
                    hostEmail: booking.host_username,
                    notificationFrom: booking.notification_from || booking.host_username,
                    notificationName: booking.display_name,
                    bookerEmail: booking.booker_email,
                    bookerName: booking.booker_name,
                    bookerPhone: booking.booker_phone || undefined,
                    communicationConsents: jsonArray(booking.communication_consents) as any,
                    title: snapshot.title || 'Meeting',
                    start,
                    end,
                    status: 'confirmed',
                    locale: snapshot.locale || 'en',
                    timeZone: booking.booker_time_zone,
                    manageUrl: `${schedulerConfig.publicBaseUrl}/scheduler/action/reschedule/${encodeURIComponent(nextRescheduleToken)}`,
                });
                await this.enqueue(connection, booking.tenant_key, booking.id, 'booking.confirmed', `booking:${booking.id}:confirmed`, {
                    bookingId: booking.id, hostEmail: booking.host_username, bookerEmail: booking.booker_email,
                    notificationFrom: booking.notification_from || booking.host_username, notificationName: booking.display_name,
                    bookerName: booking.booker_name, title: snapshot.title, start: start.toISOString(), end: end.toISOString(),
                    timeZone: booking.booker_time_zone, cancelToken: nextCancelToken, rescheduleToken: nextRescheduleToken, ical,
                    additionalAttendees: attendeesFromRow(booking.attendees), seats: Number(booking.seats || 1),
                });
            } else {
                await connection.query("UPDATE scheduler_bookings SET status='rejected', rejected_at=UTC_TIMESTAMP(3), action_tokens_expires_at=UTC_TIMESTAMP(3) WHERE id=?", [booking.id]);
                await connection.query("UPDATE scheduler_slot_holds SET status='released' WHERE hold_token=? AND status='confirmed'", [booking.slot_hold_token]);
                await connection.query(
                    `UPDATE scheduler_slot_inventory SET confirmed_seats=GREATEST(confirmed_seats-?,0)
                     WHERE tenant_key=? AND event_type_key=? AND host_username=? AND slot_start=?`,
                    [Number(booking.seats || 1), booking.tenant_key, booking.event_type_id, booking.host_username, booking.slot_start_utc]
                );
                await this.workflows.triggerForBooking(connection, {
                    tenantKey: booking.tenant_key,
                    bookingId: booking.id,
                    eventTypeId: booking.event_type_id,
                    hostEmail: booking.host_username,
                    notificationFrom: booking.notification_from || booking.host_username,
                    notificationName: booking.display_name,
                    bookerEmail: booking.booker_email,
                    bookerName: booking.booker_name,
                    bookerPhone: booking.booker_phone || undefined,
                    communicationConsents: jsonArray(booking.communication_consents) as any,
                    title: snapshot.title || 'Meeting',
                    start: utcDate(booking.slot_start_utc),
                    end: utcDate(booking.slot_end_utc),
                    status: 'rejected',
                    locale: snapshot.locale || 'en',
                    timeZone: booking.booker_time_zone,
                    manageUrl: `${schedulerConfig.publicBaseUrl}/scheduler`,
                }, 'booking.rejected');
                await this.enqueue(connection, booking.tenant_key, booking.id, 'booking.rejected', `booking:${booking.id}:rejected`, {
                    bookingId: booking.id, hostEmail: booking.host_username, bookerEmail: booking.booker_email,
                    notificationFrom: booking.notification_from || booking.host_username, notificationName: booking.display_name,
                    bookerName: booking.booker_name, title: snapshot.title, start: utcDate(booking.slot_start_utc).toISOString(),
                    end: utcDate(booking.slot_end_utc).toISOString(), timeZone: booking.booker_time_zone,
                });
            }
            await this.writeAudit(connection, booking.tenant_key, 'user', username,
                decision === 'confirmed' ? 'booking.confirm' : 'booking.reject', 'booking', booking.id, {});
            await connection.commit();
            if (decision === 'rejected') await this.promoteWaitlist(booking.event_type_id, utcDate(booking.slot_start_utc)).catch(() => null);
            return { id: booking.id, status: decision };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    async rescheduleBookingByToken(token: string, newStart: Date, reason?: unknown): Promise<Record<string, unknown> | null> {
        if (!Number.isFinite(newStart.getTime())) throw new Error('A valid new start time is required');
        const [rows]: any = await this.pool.query(
            `SELECT b.*, CAST(b.slot_start AS CHAR) AS slot_start_utc,
                    e.slug, e.duration_minutes, e.capacity, e.title, e.location_label,
                    m.public_handle, m.time_zone, m.notification_from, m.display_name
             FROM scheduler_bookings b
             JOIN scheduler_event_types e ON e.id = b.event_type_id
             JOIN scheduler_mailbox_entitlements m ON m.username = b.host_username
             WHERE b.reschedule_token_hash = ? AND b.action_tokens_expires_at > UTC_TIMESTAMP(3)
               AND b.status = 'confirmed' AND m.enabled = 1 AND m.published = 1
             LIMIT 1`,
            [schedulerTokenHash(token)]
        );
        const booking = rows[0];
        if (!booking) return null;
        const snapshot = JSON.parse(booking.event_snapshot);
        const initialPolicy = schedulerBookingActionPolicy(snapshot, 'reschedule', utcDate(booking.slot_start_utc));
        if (!initialPolicy.allowed) throw new Error('Reschedule window has closed');
        const normalizedReason = normalizeSchedulerActionReason(reason, 'reschedule', initialPolicy.reasonRequired);
        const newEnd = new Date(newStart.getTime() + Number(booking.duration_minutes) * 60 * 1000);
        const slots = await this.listSlots(booking.public_handle, booking.slug, new Date(newStart.getTime() - 1), new Date(newEnd.getTime() + 1), token);
        if (!slots.some((slot: any) => slot.start.getTime() === newStart.getTime()
            && Number(slot.remainingSeats ?? booking.capacity) >= Number(booking.seats || 1))) {
            throw new Error('The selected time is no longer available');
        }
        const hold = await this.holds.acquire({
            tenantKey: booking.tenant_key,
            eventTypeKey: booking.event_type_id,
            hostUsername: booking.host_username,
            slotStart: newStart,
            slotEnd: newEnd,
            capacity: Number(booking.capacity),
            seats: Number(booking.seats || 1),
            ttlSeconds: 300,
            idempotencyKey: `reschedule:${booking.id}:${newStart.toISOString()}`,
        });
        const ical = buildSchedulerCalendarEvent({
            uid: booking.calendar_event_uid,
            title: snapshot.title || booking.title,
            description: booking.booker_notes || '',
            location: snapshot.locationLabel || booking.location_label || '',
            start: newStart,
            end: newEnd,
            hostEmail: booking.host_username,
            bookerName: booking.booker_name,
            bookerEmail: booking.booker_email,
            additionalAttendees: attendeesFromRow(booking.attendees),
            sequence: 1,
        });
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [lockedRows]: any = await connection.query(
                "SELECT status, CAST(slot_start AS CHAR) AS slot_start_utc, event_snapshot FROM scheduler_bookings WHERE id=? FOR UPDATE",
                [booking.id]
            );
            if (!lockedRows.length || lockedRows[0].status !== 'confirmed') throw new Error('Booking cannot be rescheduled');
            if (utcDate(lockedRows[0].slot_start_utc).getTime() !== utcDate(booking.slot_start_utc).getTime()) {
                throw new Error('Booking cannot be rescheduled because it changed during this request');
            }
            const lockedPolicy = schedulerBookingActionPolicy(JSON.parse(lockedRows[0].event_snapshot), 'reschedule', utcDate(lockedRows[0].slot_start_utc));
            if (!lockedPolicy.allowed) throw new Error('Reschedule window has closed');
            normalizeSchedulerActionReason(normalizedReason, 'reschedule', lockedPolicy.reasonRequired);
            await connection.query(
                `UPDATE scheduler_slot_inventory SET confirmed_seats=GREATEST(confirmed_seats-?,0)
                 WHERE tenant_key=? AND event_type_key=? AND host_username=? AND slot_start=?`,
                [Number(booking.seats || 1), booking.tenant_key, booking.event_type_id, booking.host_username, booking.slot_start_utc]
            );
            await connection.query("UPDATE scheduler_slot_holds SET status='released' WHERE hold_token=? AND status='confirmed'", [booking.slot_hold_token]);
            await connection.query(
                'UPDATE scheduler_bookings SET slot_start=?, slot_end=?, slot_hold_token=?, action_tokens_expires_at=?, cancelled_at=NULL, reschedule_reason=? WHERE id=?',
                [mysqlDate(newStart), mysqlDate(newEnd), hold.token, mysqlDate(new Date(newEnd.getTime() + 30 * 24 * 60 * 60 * 1000)), normalizedReason || null, booking.id]
            );
            await this.workflows.rescheduleForBooking(connection, {
                tenantKey: booking.tenant_key,
                bookingId: booking.id,
                eventTypeId: booking.event_type_id,
                hostEmail: booking.host_username,
                notificationFrom: booking.notification_from || booking.host_username,
                notificationName: booking.display_name,
                bookerEmail: booking.booker_email,
                bookerName: booking.booker_name,
                bookerPhone: booking.booker_phone || undefined,
                communicationConsents: jsonArray(booking.communication_consents) as any,
                title: snapshot.title || booking.title || 'Meeting',
                start: newStart,
                end: newEnd,
                status: 'confirmed',
                locale: snapshot.locale || 'en',
                timeZone: booking.booker_time_zone,
                manageUrl: `${schedulerConfig.publicBaseUrl}/scheduler/action/reschedule/${encodeURIComponent(token)}`,
            });
            await connection.query('UPDATE events SET ical_data=? WHERE calendar_id=? AND uid=?', [ical, booking.calendar_id, booking.calendar_event_uid]);
            await connection.query('UPDATE calendars SET sync_token=sync_token+1 WHERE id=?', [booking.calendar_id]);
            await connection.query("UPDATE scheduler_slot_holds SET status='confirmed' WHERE hold_token=?", [hold.token]);
            await connection.query(
                `UPDATE scheduler_slot_inventory SET held_seats=GREATEST(held_seats-?,0), confirmed_seats=confirmed_seats+?
                 WHERE tenant_key=? AND event_type_key=? AND host_username=? AND slot_start=?`,
                [hold.seats, hold.seats, hold.tenantKey, hold.eventTypeKey, hold.hostUsername, mysqlDate(hold.slotStart)]
            );
            await this.enqueue(connection, booking.tenant_key, booking.id, 'booking.rescheduled', `booking:${booking.id}:rescheduled:${newStart.toISOString()}`, {
                bookingId: booking.id, hostEmail: booking.host_username, bookerEmail: booking.booker_email,
                notificationFrom: booking.notification_from || booking.host_username, notificationName: booking.display_name,
                bookerName: booking.booker_name, title: snapshot.title, start: newStart.toISOString(),
                end: newEnd.toISOString(), timeZone: booking.booker_time_zone, ical,
                additionalAttendees: attendeesFromRow(booking.attendees), seats: Number(booking.seats || 1),
            });
            await this.writeAudit(connection, booking.tenant_key, 'capability', booking.booker_email, 'booking.reschedule', 'booking', booking.id, { newStart: newStart.toISOString() });
            await connection.commit();
            await this.promoteWaitlist(booking.event_type_id, utcDate(booking.slot_start_utc)).catch(() => null);
        } catch (error) {
            await connection.rollback();
            await this.releaseHold(hold.token).catch(() => undefined);
            throw error;
        } finally {
            connection.release();
        }
        return { id: booking.id, status: 'confirmed', start: newStart, end: newEnd };
    }

    private async cancelBooking(booking: any, actorType: 'user' | 'capability', actorId: string, reason?: unknown): Promise<void> {
        if (booking.status === 'cancelled') return;
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [rows]: any = await connection.query(
                `SELECT b.*, CAST(b.slot_start AS CHAR) AS slot_start_utc, CAST(b.slot_end AS CHAR) AS slot_end_utc,
                        m.notification_from, m.display_name
                 FROM scheduler_bookings b JOIN scheduler_mailbox_entitlements m ON m.username = b.host_username
                 WHERE b.id = ? FOR UPDATE`,
                [booking.id]
            );
            const current = rows[0];
            if (!current || current.status === 'cancelled') {
                await connection.commit();
                return;
            }
            if (!['requested', 'confirmed'].includes(current.status)) throw new Error('Booking can no longer be cancelled');
            const snapshot = JSON.parse(current.event_snapshot);
            const cancellationPolicy = schedulerBookingActionPolicy(snapshot, 'cancel', utcDate(current.slot_start_utc));
            if (actorType === 'capability' && !cancellationPolicy.allowed) throw new Error('Cancellation window has closed');
            const normalizedReason = actorType === 'capability'
                ? normalizeSchedulerActionReason(reason, 'cancel', cancellationPolicy.reasonRequired)
                : '';
            const wasConfirmed = current.status === 'confirmed';
            await connection.query("UPDATE scheduler_bookings SET status='cancelled', cancelled_at=UTC_TIMESTAMP(3), cancellation_reason=? WHERE id=?", [normalizedReason || null, current.id]);
            await this.workflows.cancelForBooking(connection, {
                tenantKey: current.tenant_key,
                bookingId: current.id,
                eventTypeId: current.event_type_id,
                hostEmail: current.host_username,
                notificationFrom: current.notification_from || current.host_username,
                notificationName: current.display_name,
                bookerEmail: current.booker_email,
                bookerName: current.booker_name,
                bookerPhone: current.booker_phone || undefined,
                communicationConsents: jsonArray(current.communication_consents) as any,
                title: snapshot.title || 'Meeting',
                start: utcDate(current.slot_start_utc),
                end: utcDate(current.slot_end_utc),
                status: 'cancelled',
                locale: snapshot.locale || 'en',
                timeZone: current.booker_time_zone,
                manageUrl: `${schedulerConfig.publicBaseUrl}/scheduler`,
            });
            if (current.slot_hold_token) {
                await connection.query("UPDATE scheduler_slot_holds SET status='released' WHERE hold_token=? AND status='confirmed'", [current.slot_hold_token]);
            }
            if (wasConfirmed && current.calendar_id && current.calendar_event_uid) {
                await connection.query('INSERT INTO calendar_tombstones (calendar_id, uid) VALUES (?, ?)', [current.calendar_id, current.calendar_event_uid]);
                await connection.query('DELETE FROM events WHERE calendar_id = ? AND uid = ?', [current.calendar_id, current.calendar_event_uid]);
                await connection.query('UPDATE calendars SET sync_token = sync_token + 1 WHERE id = ?', [current.calendar_id]);
            }
            await connection.query(
                `UPDATE scheduler_slot_inventory SET confirmed_seats = GREATEST(confirmed_seats - ?, 0)
                 WHERE tenant_key=? AND event_type_key=? AND host_username=? AND slot_start=?`,
                [Number(current.seats || 1), current.tenant_key, current.event_type_id, current.host_username, current.slot_start_utc]
            );
            const cancellationIcal = wasConfirmed ? buildSchedulerCalendarEvent({
                uid: current.calendar_event_uid,
                title: snapshot.title || 'Meeting',
                description: current.booker_notes || '',
                location: snapshot.locationLabel || '',
                start: utcDate(current.slot_start_utc),
                end: utcDate(current.slot_end_utc),
                hostEmail: current.host_username,
                bookerName: current.booker_name,
                bookerEmail: current.booker_email,
                additionalAttendees: attendeesFromRow(current.attendees),
                sequence: 1,
                cancelled: true,
            }) : undefined;
            await this.enqueue(connection, current.tenant_key, current.id, 'booking.cancelled', `booking:${current.id}:cancelled`, {
                bookingId: current.id, hostEmail: current.host_username, bookerEmail: current.booker_email,
                notificationFrom: current.notification_from || current.host_username, notificationName: current.display_name,
                bookerName: current.booker_name, start: utcDate(current.slot_start_utc).toISOString(),
                timeZone: current.booker_time_zone, event: snapshot, ical: cancellationIcal,
                additionalAttendees: wasConfirmed ? attendeesFromRow(current.attendees) : [], seats: Number(current.seats || 1),
            });
            await this.writeAudit(connection, current.tenant_key, actorType, actorId, 'booking.cancel', 'booking', current.id, {});
            await connection.commit();
            await this.promoteWaitlist(current.event_type_id, utcDate(current.slot_start_utc)).catch(() => null);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    private async lockCapabilityBooking(token: string, scope: 'cancel' | 'reschedule'): Promise<any | null> {
        const column = scope === 'cancel' ? 'cancel_token_hash' : 'reschedule_token_hash';
        const [rows]: any = await this.pool.query(`SELECT * FROM scheduler_bookings WHERE ${column} = ? AND action_tokens_expires_at > UTC_TIMESTAMP(3) LIMIT 1`, [schedulerTokenHash(token)]);
        return rows[0] || null;
    }

    private async loadAvailabilitySchedule(row: any): Promise<SchedulerAvailabilitySchedule> {
        const [windowRows]: any = await this.pool.query(
            `SELECT weekday, start_minute, end_minute FROM scheduler_schedule_windows
             WHERE schedule_id = ? ORDER BY weekday, start_minute`,
            [row.id]
        );
        const [overrideRows]: any = await this.pool.query(
            `SELECT o.id, o.local_date, o.unavailable_all_day, w.start_minute, w.end_minute
             FROM scheduler_schedule_overrides o
             LEFT JOIN scheduler_override_windows w ON w.override_id = o.id
             WHERE o.schedule_id = ? ORDER BY o.local_date, w.start_minute`,
            [row.id]
        );
        const [exclusionRows]: any = await this.pool.query(
            `SELECT id, kind, CAST(start_date AS CHAR) AS start_date, CAST(end_date AS CHAR) AS end_date, label
             FROM scheduler_availability_exclusions WHERE schedule_id=? ORDER BY start_date, end_date`,
            [row.id]
        );
        const overrides = new Map<string, SchedulerScheduleOverride>();
        for (const overrideRow of overrideRows) {
            const id = String(overrideRow.id);
            const date = overrideRow.local_date instanceof Date
                ? `${overrideRow.local_date.getFullYear()}-${String(overrideRow.local_date.getMonth() + 1).padStart(2, '0')}-${String(overrideRow.local_date.getDate()).padStart(2, '0')}`
                : String(overrideRow.local_date).slice(0, 10);
            const override = overrides.get(id) || {
                id,
                date,
                unavailableAllDay: booleanValue(overrideRow.unavailable_all_day),
                windows: [],
            };
            if (overrideRow.start_minute != null) {
                override.windows.push({ startMinute: Number(overrideRow.start_minute), endMinute: Number(overrideRow.end_minute) });
            }
            overrides.set(id, override);
        }
        return {
            id: row.id,
            name: row.name,
            timeZone: row.time_zone,
            isDefault: booleanValue(row.is_default),
            published: booleanValue(row.published),
            windows: windowRows.map((window: any) => ({
                weekday: Number(window.weekday),
                startMinute: Number(window.start_minute),
                endMinute: Number(window.end_minute),
            })),
            overrides: Array.from(overrides.values()),
            exclusions: exclusionRows.map((exclusion: any) => ({
                id: exclusion.id,
                kind: exclusion.kind,
                startDate: String(exclusion.start_date).slice(0, 10),
                endDate: String(exclusion.end_date).slice(0, 10),
                label: exclusion.label || '',
            })),
        };
    }

    private async getAvailabilityScheduleById(id: string): Promise<SchedulerAvailabilitySchedule | null> {
        const [rows]: any = await this.pool.query('SELECT * FROM scheduler_availability_schedules WHERE id = ? LIMIT 1', [id]);
        return rows.length ? this.loadAvailabilitySchedule(rows[0]) : null;
    }

    private async assertScheduleOwnership(username: string, id: string): Promise<void> {
        const [rows]: any = await this.pool.query(
            'SELECT id FROM scheduler_availability_schedules WHERE id = ? AND owner_username = ? LIMIT 1',
            [id, username]
        );
        if (!rows.length) throw new Error('Availability schedule not found');
    }

    private async ensureSystemDefaultEvent(db: Queryable, entitlement: SchedulerEntitlement, scheduleId: string, active: boolean): Promise<void> {
        const [rows]: any = await db.query(
            'SELECT id FROM scheduler_event_types WHERE owner_username = ? AND system_managed = 1 LIMIT 1',
            [entitlement.username]
        );
        if (rows.length) {
            await db.query(
                `UPDATE scheduler_event_types SET duration_minutes = 30, interval_minutes = 30,
                    availability_schedule_id = ?, destination_calendar_id = ?, active = ? WHERE id = ?`,
                [scheduleId, entitlement.defaultCalendarId, active ? 1 : 0, rows[0].id]
            );
            return;
        }
        await db.query(
            `INSERT INTO scheduler_event_types
                (id, tenant_key, owner_username, slug, title, description, duration_minutes, interval_minutes,
                 buffer_before_minutes, buffer_after_minutes, minimum_notice_minutes, capacity, location_type,
                 location_label, destination_calendar_id, conflict_calendar_ids, availability_schedule_id, system_managed, active)
             VALUES (?, ?, ?, '_default', '30-minute meeting', '', 30, 30, 0, 0, 60, 1, 'custom', '', ?, '[]', ?, 1, ?)`,
            [crypto.randomUUID(), entitlement.tenantKey, entitlement.username, entitlement.defaultCalendarId, scheduleId, active ? 1 : 0]
        );
    }

    private async getSystemDefaultEvent(username: string, activeOnly: boolean): Promise<SchedulerEventType | null> {
        const [rows]: any = await this.pool.query(
            `SELECT * FROM scheduler_event_types WHERE owner_username = ? AND system_managed = 1 ${activeOnly ? 'AND active = 1' : ''} LIMIT 1`,
            [username]
        );
        return rows.length ? eventFromRow(rows[0], []) : null;
    }

    private async busyIntervals(event: SchedulerEventType, rangeStart: Date, rangeEnd: Date): Promise<BusyInterval[]> {
        let calendarIds = event.conflictCalendarIds;
        if (!calendarIds.length) calendarIds = (await getVisibleCalendars(event.ownerUsername)).map((calendar) => calendar.id);
        if (!calendarIds.length) return [];
        const placeholders = calendarIds.map(() => '?').join(',');
        const [rows]: any = await this.pool.query(
            `SELECT e.uid, e.ical_data, b.event_type_id AS scheduler_event_type_id
             FROM events e
             LEFT JOIN scheduler_bookings b
               ON b.calendar_id = e.calendar_id AND BINARY b.calendar_event_uid = BINARY e.uid
              AND b.status = 'confirmed'
             WHERE e.calendar_id IN (${placeholders})`,
            calendarIds
        );
        const busy: BusyInterval[] = [];
        for (const row of rows) {
            if (row.scheduler_event_type_id === event.id) continue;
            try {
                const parsed = parseIcalEvent(row.uid, row.ical_data);
                if (parsed.busyStatus === 'free') continue;
                for (const occurrence of expandRecurringEvent(parsed, rangeStart, rangeEnd)) {
                    if (occurrence.end > rangeStart && occurrence.start < rangeEnd) busy.push({ start: occurrence.start, end: occurrence.end });
                }
            } catch {
                // One malformed calendar event must not hide all valid availability.
            }
        }
        return busy;
    }

    private async remainingCapacityByStart(event: SchedulerEventType, rangeStart: Date, rangeEnd: Date): Promise<Map<number, number>> {
        const [rows]: any = await this.pool.query(
            `SELECT CAST(i.slot_start AS CHAR) AS slot_start_utc, i.capacity, i.confirmed_seats,
                    COALESCE(SUM(CASE WHEN h.status = 'held' AND h.expires_at > UTC_TIMESTAMP(3) THEN h.seats ELSE 0 END), 0) AS active_held_seats
             FROM scheduler_slot_inventory i
             LEFT JOIN scheduler_slot_holds h
               ON h.tenant_key = i.tenant_key AND h.event_type_key = i.event_type_key
              AND h.host_username = i.host_username AND h.slot_start = i.slot_start AND h.slot_end = i.slot_end
             WHERE i.tenant_key = ? AND i.event_type_key = ? AND i.host_username = ?
               AND i.slot_start >= ? AND i.slot_start < ?
             GROUP BY i.slot_start, i.capacity, i.confirmed_seats`,
            [event.tenantKey, event.id, event.ownerUsername, mysqlDate(rangeStart), mysqlDate(rangeEnd)]
        );
        return new Map(rows.map((row: any) => [
            utcDate(row.slot_start_utc).getTime(),
            Math.max(Number(row.capacity) - Number(row.confirmed_seats) - Number(row.active_held_seats), 0),
        ]));
    }

    private async assertCalendarOwnership(username: string, calendarId: number): Promise<any> {
        const [rows]: any = await this.pool.query('SELECT * FROM calendars WHERE id = ? AND user_id = ? LIMIT 1', [calendarId, username]);
        if (!rows.length) throw new Error('Calendar not found');
        return rows[0];
    }

    private async bookingByIdempotency(tenantKey: string, key: string): Promise<{
        id: string;
        eventTypeId: string;
        bookerEmail: string;
        status: string;
        start: Date;
        end: Date;
    } | null> {
        const [rows]: any = await this.pool.query(
            `SELECT id, event_type_id, booker_email, status,
                    CAST(slot_start AS CHAR) AS slot_start_utc, CAST(slot_end AS CHAR) AS slot_end_utc
             FROM scheduler_bookings WHERE tenant_key = ? AND idempotency_key = ? LIMIT 1`,
            [tenantKey, key]
        );
        return rows.length ? {
            id: rows[0].id,
            eventTypeId: rows[0].event_type_id,
            bookerEmail: rows[0].booker_email,
            status: rows[0].status,
            start: utcDate(rows[0].slot_start_utc),
            end: utcDate(rows[0].slot_end_utc),
        } : null;
    }

    private async releaseHold(token: string): Promise<void> {
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [rows]: any = await connection.query(
                'SELECT *, CAST(slot_start AS CHAR) AS slot_start_utc FROM scheduler_slot_holds WHERE hold_token = ? FOR UPDATE',
                [token]
            );
            const hold = rows[0];
            if (hold?.status === 'held') {
                await connection.query("UPDATE scheduler_slot_holds SET status='released' WHERE hold_token=?", [token]);
                await connection.query(
                    `UPDATE scheduler_slot_inventory SET held_seats=GREATEST(held_seats-?,0)
                     WHERE tenant_key=? AND event_type_key=? AND host_username=? AND slot_start=?`,
                    [hold.seats, hold.tenant_key, hold.event_type_key, hold.host_username, hold.slot_start_utc]
                );
            }
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    private async enqueue(db: Queryable, tenantKey: string, aggregateId: string, eventType: string, idempotencyKey: string, payload: unknown): Promise<void> {
        await db.query(
            `INSERT IGNORE INTO scheduler_outbox
                (id, tenant_key, aggregate_type, aggregate_id, event_type, event_version, idempotency_key, payload, available_at)
             VALUES (?, ?, 'booking', ?, ?, 1, ?, ?, UTC_TIMESTAMP(3))`,
            [crypto.randomUUID(), tenantKey, aggregateId, eventType, idempotencyKey, JSON.stringify(payload)]
        );
    }

    private async writeAudit(db: Queryable, tenantKey: string, actorType: string, actorId: string, action: string, targetType: string, targetId: string, metadata: unknown): Promise<void> {
        await db.query(
            `INSERT INTO scheduler_audit_events
                (id, tenant_key, actor_type, actor_id, action, target_type, target_id, correlation_id, metadata, occurred_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
            [crypto.randomUUID(), tenantKey, actorType, actorId, action, targetType, targetId, crypto.randomUUID(), JSON.stringify(metadata)]
        );
    }
}
