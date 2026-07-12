import crypto from 'crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { calculateAvailability, type AvailabilityOverride, type AvailabilitySlot, type BusyInterval } from './availability';
import { SchedulerSlotHoldRepository } from './slot-holds';
import {
    assertTimeZone,
    buildSchedulerCalendarEvent,
    createSchedulerToken,
    normalizePrivateLinkExpiry,
    defaultSchedulerHandle,
    normalizeSchedulerEventInput,
    normalizeSchedulerHandle,
    schedulerTokenHash,
    type SchedulerEventInput,
} from './phase1';
import { ensureDefaultCalendar, expandRecurringEvent, getVisibleCalendars, parseIcalEvent } from '../calendar-utils';

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
    windows: Array<{ weekday: number; startMinute: number; endMinute: number }>;
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
    privateAccessToken?: string;
}

export interface SchedulerPrivateLinkState {
    active: boolean;
    expired: boolean;
    tokenHint: string | null;
    expiresAt: Date | null;
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
    windows,
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

    constructor(private readonly pool: Pool) {
        this.holds = new SchedulerSlotHoldRepository(pool);
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
            await this.ensureSystemDefaultEvent(connection, entitlement, schedule.id, published);
            await this.writeAudit(connection, entitlement.tenantKey, 'user', username, 'availability.default.update', 'availability_schedule', schedule.id, {
                published,
                windowCount: windows.length,
                overrideCount: overrides.length,
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
            `SELECT * FROM scheduler_event_types WHERE owner_username = ? AND system_managed = 0 ${includeInactive ? '' : 'AND active = 1'} ORDER BY created_at`,
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
                const [owned]: any = await connection.query('SELECT id, visibility FROM scheduler_event_types WHERE id = ? AND owner_username = ? AND system_managed = 0 FOR UPDATE', [id, username]);
                if (!owned.length) throw new Error('Event type not found');
                const visibility = input.visibility === undefined
                    ? (owned[0].visibility === 'private' ? 'private' : owned[0].visibility === 'unlisted' ? 'unlisted' : 'public')
                    : normalized.visibility;
                await connection.query(
                    `UPDATE scheduler_event_types SET slug=?, title=?, description=?, duration_minutes=?, interval_minutes=?,
                        buffer_before_minutes=?, buffer_after_minutes=?, minimum_notice_minutes=?, capacity=?, location_type=?,
                        location_label=?, destination_calendar_id=?, conflict_calendar_ids=?, availability_schedule_id=?, visibility=?, active=? WHERE id=? AND system_managed = 0`,
                    [normalized.slug, normalized.title, normalized.description, normalized.durationMinutes, normalized.intervalMinutes,
                        normalized.bufferBeforeMinutes, normalized.bufferAfterMinutes, normalized.minimumNoticeMinutes, normalized.capacity,
                        normalized.locationType, normalized.locationLabel, normalized.destinationCalendarId,
                        JSON.stringify(normalized.conflictCalendarIds), availabilityScheduleId, visibility, normalized.active ? 1 : 0, id]
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
                         location_label, destination_calendar_id, conflict_calendar_ids, availability_schedule_id, system_managed, visibility, active)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
                    [id, entitlement.tenantKey, username, normalized.slug, normalized.title, normalized.description,
                        normalized.durationMinutes, normalized.intervalMinutes, normalized.bufferBeforeMinutes,
                        normalized.bufferAfterMinutes, normalized.minimumNoticeMinutes, normalized.capacity,
                        normalized.locationType, normalized.locationLabel, normalized.destinationCalendarId,
                        JSON.stringify(normalized.conflictCalendarIds), availabilityScheduleId, normalized.visibility, normalized.active ? 1 : 0]
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
        const [rows]: any = await this.pool.query('SELECT * FROM scheduler_event_types WHERE id = ? AND owner_username = ? AND system_managed = 0 LIMIT 1', [id, username]);
        if (!rows.length) return null;
        const windows = await loadWindows(this.pool, [id]);
        return eventFromRow(rows[0], windows.get(id) || []);
    }

    async getPrivateLinkState(username: string, eventId: string): Promise<SchedulerPrivateLinkState> {
        await this.requireOwner(username);
        const event = await this.getOwnedEventType(username, eventId);
        if (!event) throw new Error('Event type not found');
        const [rows]: any = await this.pool.query(
            `SELECT token_hint, CAST(expires_at AS CHAR) AS expires_at_utc
             FROM scheduler_private_links
             WHERE event_type_id = ? AND revoked_at IS NULL
             ORDER BY created_at DESC LIMIT 1`,
            [eventId]
        );
        if (!rows.length) return { active: false, expired: false, tokenHint: null, expiresAt: null };
        const expiresAt = rows[0].expires_at_utc ? utcDate(rows[0].expires_at_utc) : null;
        const expired = Boolean(expiresAt && expiresAt <= new Date());
        return { active: !expired, expired, tokenHint: rows[0].token_hint, expiresAt };
    }

    async rotatePrivateLink(username: string, eventId: string, expiry: unknown): Promise<{ token: string; state: SchedulerPrivateLinkState }> {
        const entitlement = await this.requireOwner(username);
        const expiresAt = normalizePrivateLinkExpiry(expiry);
        const token = createSchedulerToken();
        const tokenHash = schedulerTokenHash(token);
        const tokenHint = token.slice(-8);
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
            await connection.query(
                `INSERT INTO scheduler_private_links
                    (id, tenant_key, event_type_id, token_hash, token_hint, expires_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [crypto.randomUUID(), entitlement.tenantKey, eventId, tokenHash, tokenHint, expiresAt ? mysqlDate(expiresAt) : null]
            );
            await this.writeAudit(connection, entitlement.tenantKey, 'user', username, 'private_link.rotate', 'event_type', eventId, {
                expiresAt: expiresAt?.toISOString() || null,
            });
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
        return { token, state: { active: true, expired: false, tokenHint, expiresAt } };
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

    private async privateLinkAllows(eventId: string, token: string): Promise<boolean> {
        const candidate = String(token || '').trim();
        if (candidate.length < 32 || candidate.length > 128) return false;
        const [rows]: any = await this.pool.query(
            `SELECT id FROM scheduler_private_links
             WHERE event_type_id = ? AND token_hash = ? AND revoked_at IS NULL
               AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3))
             LIMIT 1`,
            [eventId, schedulerTokenHash(candidate)]
        );
        if (rows.length > 0) return true;
        const [bookingRows]: any = await this.pool.query(
            `SELECT id FROM scheduler_bookings
             WHERE event_type_id = ? AND reschedule_token_hash = ? AND status = 'confirmed'
               AND action_tokens_expires_at > UTC_TIMESTAMP(3)
             LIMIT 1`,
            [eventId, schedulerTokenHash(candidate)]
        );
        return bookingRows.length > 0;
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

    async listSlots(handle: string, slug: string, rangeStart: Date, rangeEnd: Date, privateAccessToken = ''): Promise<AvailabilitySlot[]> {
        if (!Number.isFinite(rangeStart.getTime()) || !Number.isFinite(rangeEnd.getTime()) || rangeStart >= rangeEnd) throw new Error('Invalid availability range');
        if (rangeEnd.getTime() - rangeStart.getTime() > 62 * 24 * 60 * 60 * 1000) throw new Error('Availability range cannot exceed 62 days');
        const result = await this.getPublicEvent(handle, slug, privateAccessToken);
        if (!result) return [];
        const busy = await this.busyIntervals(result.event, rangeStart, rangeEnd);
        const schedule = result.event.availabilityScheduleId
            ? await this.getAvailabilityScheduleById(result.event.availabilityScheduleId)
            : null;
        const overrides: AvailabilityOverride[] | undefined = schedule?.overrides.map((override) => ({
            date: override.date,
            windows: override.unavailableAllDay ? [] : override.windows,
        }));
        const slots = calculateAvailability({
            timeZone: schedule?.timeZone || result.entitlement.timeZone,
            rangeStart,
            rangeEnd,
            durationMinutes: result.event.durationMinutes,
            intervalMinutes: result.event.intervalMinutes,
            windows: schedule?.windows || result.event.windows,
            overrides,
            busy,
            bufferBeforeMinutes: result.event.bufferBeforeMinutes,
            bufferAfterMinutes: result.event.bufferAfterMinutes,
            minimumNoticeMinutes: result.event.minimumNoticeMinutes,
        });
        const fullStarts = await this.fullCapacitySlotStarts(result.event, rangeStart, rangeEnd);
        return slots.filter((slot) => !fullStarts.has(slot.start.getTime()));
    }

    async createBooking(handle: string, slug: string, input: SchedulerBookingInput): Promise<Record<string, unknown>> {
        const publicEvent = await this.getPublicEvent(handle, slug, input.privateAccessToken);
        if (!publicEvent || publicEvent.event.id !== input.eventTypeId) throw new Error('Event type not found');
        const bookerName = String(input.bookerName || '').trim().slice(0, 160);
        const bookerEmail = String(input.bookerEmail || '').trim().toLowerCase();
        if (!bookerName) throw new Error('Your name is required');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bookerEmail)) throw new Error('A valid email address is required');
        const bookerTimeZone = assertTimeZone(input.bookerTimeZone);
        const idempotencyKey = String(input.idempotencyKey || '').trim().slice(0, 128);
        if (idempotencyKey.length < 8) throw new Error('An idempotency key is required');
        const end = new Date(input.start.getTime() + publicEvent.event.durationMinutes * 60 * 1000);
        const slots = await this.listSlots(handle, slug, new Date(input.start.getTime() - 1), new Date(end.getTime() + 1), input.privateAccessToken);
        if (!slots.some((slot) => slot.start.getTime() === input.start.getTime())) throw new Error('The selected time is no longer available');

        const existing = await this.bookingByIdempotency(publicEvent.entitlement.tenantKey, idempotencyKey);
        if (existing) return { ...existing, idempotentReplay: true };

        const hold = await this.holds.acquire({
            tenantKey: publicEvent.entitlement.tenantKey,
            eventTypeKey: publicEvent.event.id,
            hostUsername: publicEvent.entitlement.username,
            slotStart: input.start,
            slotEnd: end,
            capacity: publicEvent.event.capacity,
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
        const ical = buildSchedulerCalendarEvent({
            uid: calendarUid,
            title: publicEvent.event.title,
            description: input.bookerNotes || '',
            location: publicEvent.event.locationLabel,
            start: input.start,
            end,
            hostEmail: publicEvent.entitlement.username,
            bookerName,
            bookerEmail,
            sequence: 0,
        });
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [lockedHolds]: any = await connection.query(
                "SELECT status FROM scheduler_slot_holds WHERE hold_token = ? AND tenant_key = ? AND expires_at > ? FOR UPDATE",
                [hold.token, publicEvent.entitlement.tenantKey, mysqlDate(new Date())]
            );
            if (!lockedHolds.length || lockedHolds[0].status !== 'held') throw new Error('The selected time is no longer available');
            await connection.query(
                `INSERT INTO scheduler_bookings
                    (id, tenant_key, event_type_id, host_username, status, slot_start, slot_end, host_time_zone,
                     booker_time_zone, booker_name, booker_email, booker_notes, event_snapshot, cancel_token_hash,
                     reschedule_token_hash, action_tokens_expires_at, slot_hold_token, calendar_id, calendar_event_uid, idempotency_key)
                 VALUES (?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [bookingId, publicEvent.entitlement.tenantKey, publicEvent.event.id, publicEvent.entitlement.username,
                    mysqlDate(input.start), mysqlDate(end), publicEvent.entitlement.timeZone, bookerTimeZone, bookerName,
                    bookerEmail, String(input.bookerNotes || '').trim().slice(0, 4000), eventSnapshot,
                    schedulerTokenHash(cancelToken), schedulerTokenHash(rescheduleToken), mysqlDate(new Date(end.getTime() + 30 * 24 * 60 * 60 * 1000)),
                    hold.token, calendar.id, calendarUid, idempotencyKey]
            );
            await connection.query(
                `INSERT INTO events (calendar_id, uid, ical_data) VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE ical_data = VALUES(ical_data)`,
                [calendar.id, calendarUid, ical]
            );
            await connection.query('UPDATE calendars SET sync_token = sync_token + 1 WHERE id = ?', [calendar.id]);
            await connection.query("UPDATE scheduler_slot_holds SET status = 'confirmed' WHERE hold_token = ?", [hold.token]);
            await connection.query(
                `UPDATE scheduler_slot_inventory SET held_seats = GREATEST(held_seats - ?, 0), confirmed_seats = confirmed_seats + ?
                 WHERE tenant_key = ? AND event_type_key = ? AND host_username = ? AND slot_start = ?`,
                [hold.seats, hold.seats, hold.tenantKey, hold.eventTypeKey, hold.hostUsername, mysqlDate(hold.slotStart)]
            );
            await this.enqueue(connection, publicEvent.entitlement.tenantKey, bookingId, 'booking.confirmed', `booking:${bookingId}:confirmed`, {
                bookingId, hostEmail: publicEvent.entitlement.username, bookerEmail, bookerName,
                notificationFrom: publicEvent.entitlement.notificationFrom, notificationName: publicEvent.entitlement.displayName,
                title: publicEvent.event.title, start: input.start.toISOString(), end: end.toISOString(),
                timeZone: bookerTimeZone, cancelToken, rescheduleToken, ical,
            });
            await this.writeAudit(connection, publicEvent.entitlement.tenantKey, 'anonymous', bookerEmail, 'booking.create', 'booking', bookingId, { eventTypeId: publicEvent.event.id });
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            await this.releaseHold(hold.token).catch(() => undefined);
            throw error;
        } finally {
            connection.release();
        }
        return { id: bookingId, status: 'confirmed', start: input.start, end, cancelToken, rescheduleToken };
    }

    async listBookings(username: string, filter = 'upcoming'): Promise<Array<Record<string, unknown>>> {
        await this.requireOwner(username);
        const clauses = ['host_username = ?'];
        if (filter === 'upcoming') clauses.push("status IN ('requested','confirmed') AND slot_end >= UTC_TIMESTAMP(3)");
        if (filter === 'past') clauses.push("slot_end < UTC_TIMESTAMP(3) AND status <> 'cancelled'");
        if (filter === 'cancelled') clauses.push("status = 'cancelled'");
        const [rows]: any = await this.pool.query(
            `SELECT id, event_type_id, status, CAST(slot_start AS CHAR) AS slot_start_utc,
                    CAST(slot_end AS CHAR) AS slot_end_utc, host_time_zone, booker_time_zone,
                    booker_name, booker_email, booker_notes, event_snapshot, calendar_id, calendar_event_uid,
                    UNIX_TIMESTAMP(created_at) * 1000 AS created_at_epoch
             FROM scheduler_bookings WHERE ${clauses.join(' AND ')} ORDER BY slot_start ASC`,
            [username]
        );
        return rows.map((row: any) => ({
            id: row.id,
            eventTypeId: row.event_type_id,
            status: row.status,
            start: utcDate(row.slot_start_utc),
            end: utcDate(row.slot_end_utc),
            hostTimeZone: row.host_time_zone,
            bookerTimeZone: row.booker_time_zone,
            bookerName: row.booker_name,
            bookerEmail: row.booker_email,
            bookerNotes: row.booker_notes || '',
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
        return {
            id: rows[0].id,
            status: rows[0].status,
            start: utcDate(rows[0].slot_start_utc),
            end: utcDate(rows[0].slot_end_utc),
            bookerName: rows[0].booker_name,
            bookerEmail: rows[0].booker_email,
            event: JSON.parse(rows[0].event_snapshot),
            handle: rows[0].public_handle,
        };
    }

    async cancelBookingByToken(token: string): Promise<Record<string, unknown> | null> {
        const booking = await this.lockCapabilityBooking(token, 'cancel');
        if (!booking) return null;
        await this.cancelBooking(booking, 'capability', booking.booker_email);
        return { id: booking.id, status: 'cancelled' };
    }

    async cancelOwnedBooking(username: string, bookingId: string): Promise<void> {
        await this.requireOwner(username);
        const [rows]: any = await this.pool.query('SELECT * FROM scheduler_bookings WHERE id = ? AND host_username = ? LIMIT 1', [bookingId, username]);
        if (!rows.length) throw new Error('Booking not found');
        await this.cancelBooking(rows[0], 'user', username);
    }

    async rescheduleBookingByToken(token: string, newStart: Date): Promise<Record<string, unknown> | null> {
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
        const newEnd = new Date(newStart.getTime() + Number(booking.duration_minutes) * 60 * 1000);
        const slots = await this.listSlots(booking.public_handle, booking.slug, new Date(newStart.getTime() - 1), new Date(newEnd.getTime() + 1), token);
        if (!slots.some((slot) => slot.start.getTime() === newStart.getTime())) throw new Error('The selected time is no longer available');
        const hold = await this.holds.acquire({
            tenantKey: booking.tenant_key,
            eventTypeKey: booking.event_type_id,
            hostUsername: booking.host_username,
            slotStart: newStart,
            slotEnd: newEnd,
            capacity: Number(booking.capacity),
            ttlSeconds: 300,
            idempotencyKey: `reschedule:${booking.id}:${newStart.toISOString()}`,
        });
        const snapshot = JSON.parse(booking.event_snapshot);
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
            sequence: 1,
        });
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [lockedRows]: any = await connection.query("SELECT status FROM scheduler_bookings WHERE id=? FOR UPDATE", [booking.id]);
            if (!lockedRows.length || lockedRows[0].status !== 'confirmed') throw new Error('Booking cannot be rescheduled');
            await connection.query(
                `UPDATE scheduler_slot_inventory SET confirmed_seats=GREATEST(confirmed_seats-1,0)
                 WHERE tenant_key=? AND event_type_key=? AND host_username=? AND slot_start=?`,
                [booking.tenant_key, booking.event_type_id, booking.host_username, booking.slot_start_utc]
            );
            await connection.query("UPDATE scheduler_slot_holds SET status='released' WHERE hold_token=? AND status='confirmed'", [booking.slot_hold_token]);
            await connection.query(
                'UPDATE scheduler_bookings SET slot_start=?, slot_end=?, slot_hold_token=?, action_tokens_expires_at=?, cancelled_at=NULL WHERE id=?',
                [mysqlDate(newStart), mysqlDate(newEnd), hold.token, mysqlDate(new Date(newEnd.getTime() + 30 * 24 * 60 * 60 * 1000)), booking.id]
            );
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
            });
            await this.writeAudit(connection, booking.tenant_key, 'capability', booking.booker_email, 'booking.reschedule', 'booking', booking.id, { newStart: newStart.toISOString() });
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            await this.releaseHold(hold.token).catch(() => undefined);
            throw error;
        } finally {
            connection.release();
        }
        return { id: booking.id, status: 'confirmed', start: newStart, end: newEnd };
    }

    private async cancelBooking(booking: any, actorType: 'user' | 'capability', actorId: string): Promise<void> {
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
            await connection.query("UPDATE scheduler_bookings SET status='cancelled', cancelled_at=UTC_TIMESTAMP(3) WHERE id=?", [current.id]);
            if (current.slot_hold_token) {
                await connection.query("UPDATE scheduler_slot_holds SET status='released' WHERE hold_token=? AND status='confirmed'", [current.slot_hold_token]);
            }
            if (current.calendar_id && current.calendar_event_uid) {
                await connection.query('INSERT INTO calendar_tombstones (calendar_id, uid) VALUES (?, ?)', [current.calendar_id, current.calendar_event_uid]);
                await connection.query('DELETE FROM events WHERE calendar_id = ? AND uid = ?', [current.calendar_id, current.calendar_event_uid]);
                await connection.query('UPDATE calendars SET sync_token = sync_token + 1 WHERE id = ?', [current.calendar_id]);
            }
            await connection.query(
                `UPDATE scheduler_slot_inventory SET confirmed_seats = GREATEST(confirmed_seats - 1, 0)
                 WHERE tenant_key=? AND event_type_key=? AND host_username=? AND slot_start=?`,
                [current.tenant_key, current.event_type_id, current.host_username, current.slot_start_utc]
            );
            const snapshot = JSON.parse(current.event_snapshot);
            const cancellationIcal = buildSchedulerCalendarEvent({
                uid: current.calendar_event_uid,
                title: snapshot.title || 'Meeting',
                description: current.booker_notes || '',
                location: snapshot.locationLabel || '',
                start: utcDate(current.slot_start_utc),
                end: utcDate(current.slot_end_utc),
                hostEmail: current.host_username,
                bookerName: current.booker_name,
                bookerEmail: current.booker_email,
                sequence: 1,
                cancelled: true,
            });
            await this.enqueue(connection, current.tenant_key, current.id, 'booking.cancelled', `booking:${current.id}:cancelled`, {
                bookingId: current.id, hostEmail: current.host_username, bookerEmail: current.booker_email,
                notificationFrom: current.notification_from || current.host_username, notificationName: current.display_name,
                bookerName: current.booker_name, start: utcDate(current.slot_start_utc).toISOString(),
                timeZone: current.booker_time_zone, event: snapshot, ical: cancellationIcal,
            });
            await this.writeAudit(connection, current.tenant_key, actorType, actorId, 'booking.cancel', 'booking', current.id, {});
            await connection.commit();
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
        const [rows]: any = await this.pool.query(`SELECT uid, ical_data FROM events WHERE calendar_id IN (${placeholders})`, calendarIds);
        const busy: BusyInterval[] = [];
        for (const row of rows) {
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

    private async fullCapacitySlotStarts(event: SchedulerEventType, rangeStart: Date, rangeEnd: Date): Promise<Set<number>> {
        const [rows]: any = await this.pool.query(
            `SELECT CAST(i.slot_start AS CHAR) AS slot_start_utc, i.capacity, i.confirmed_seats,
                    COALESCE(SUM(CASE WHEN h.status = 'held' AND h.expires_at > UTC_TIMESTAMP(3) THEN h.seats ELSE 0 END), 0) AS active_held_seats
             FROM scheduler_slot_inventory i
             LEFT JOIN scheduler_slot_holds h
               ON h.tenant_key = i.tenant_key AND h.event_type_key = i.event_type_key
              AND h.host_username = i.host_username AND h.slot_start = i.slot_start AND h.slot_end = i.slot_end
             WHERE i.tenant_key = ? AND i.event_type_key = ? AND i.host_username = ?
               AND i.slot_start >= ? AND i.slot_start < ?
             GROUP BY i.slot_start, i.capacity, i.confirmed_seats
             HAVING i.confirmed_seats + active_held_seats >= i.capacity`,
            [event.tenantKey, event.id, event.ownerUsername, mysqlDate(rangeStart), mysqlDate(rangeEnd)]
        );
        return new Set(rows.map((row: any) => utcDate(row.slot_start_utc).getTime()));
    }

    private async assertCalendarOwnership(username: string, calendarId: number): Promise<any> {
        const [rows]: any = await this.pool.query('SELECT * FROM calendars WHERE id = ? AND user_id = ? LIMIT 1', [calendarId, username]);
        if (!rows.length) throw new Error('Calendar not found');
        return rows[0];
    }

    private async bookingByIdempotency(tenantKey: string, key: string): Promise<Record<string, unknown> | null> {
        const [rows]: any = await this.pool.query(
            'SELECT id, status, CAST(slot_start AS CHAR) AS slot_start_utc, CAST(slot_end AS CHAR) AS slot_end_utc FROM scheduler_bookings WHERE tenant_key = ? AND idempotency_key = ? LIMIT 1',
            [tenantKey, key]
        );
        return rows.length ? { id: rows[0].id, status: rows[0].status, start: utcDate(rows[0].slot_start_utc), end: utcDate(rows[0].slot_end_utc) } : null;
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
