import crypto from 'crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

export interface AcquireSlotHoldInput {
    tenantKey: string;
    eventTypeKey: string;
    hostUsername: string;
    slotStart: Date;
    slotEnd: Date;
    capacity: number;
    seats?: number;
    ttlSeconds: number;
    idempotencyKey: string;
    now?: Date;
}

export interface SlotHold {
    token: string;
    tenantKey: string;
    eventTypeKey: string;
    hostUsername: string;
    slotStart: Date;
    slotEnd: Date;
    seats: number;
    status: 'held' | 'confirmed' | 'released' | 'expired';
    expiresAt: Date;
}

interface InventoryRow extends RowDataPacket {
    slot_end_matches: number;
    capacity: number;
    held_seats: number;
    confirmed_seats: number;
}

interface HoldRow extends RowDataPacket {
    hold_token: string;
    tenant_key: string;
    event_type_key: string;
    host_username: string;
    slot_start_utc: string;
    slot_end_utc: string;
    seats: number;
    status: SlotHold['status'];
    expires_at_utc: string;
}

export class SlotUnavailableError extends Error {
    constructor() {
        super('The requested slot no longer has enough capacity');
        this.name = 'SlotUnavailableError';
    }
}

const assertInput = (input: AcquireSlotHoldInput): void => {
    if (!input.tenantKey || !input.eventTypeKey || !input.hostUsername || !input.idempotencyKey) {
        throw new Error('tenantKey, eventTypeKey, hostUsername, and idempotencyKey are required');
    }
    if (!Number.isFinite(input.slotStart.getTime()) || !Number.isFinite(input.slotEnd.getTime())) {
        throw new Error('slotStart and slotEnd must be valid dates');
    }
    if (input.slotStart.getTime() >= input.slotEnd.getTime()) throw new Error('slotStart must be before slotEnd');
    if (!Number.isInteger(input.capacity) || input.capacity <= 0) throw new Error('capacity must be a positive integer');
    const seats = input.seats ?? 1;
    if (!Number.isInteger(seats) || seats <= 0 || seats > input.capacity) throw new Error('seats must be between 1 and capacity');
    if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds <= 0) throw new Error('ttlSeconds must be a positive integer');
};

const mysqlDate = (date: Date): string => date.toISOString().slice(0, 23).replace('T', ' ');
const parseMysqlUtc = (value: string): Date => new Date(`${value.replace(' ', 'T')}Z`);
const isRetryableTransactionError = (error: unknown): boolean => {
    const candidate = error as { code?: string; errno?: number };
    return candidate?.code === 'ER_LOCK_DEADLOCK'
        || candidate?.code === 'ER_LOCK_WAIT_TIMEOUT'
        || candidate?.errno === 1213
        || candidate?.errno === 1205;
};

const mapHold = (row: HoldRow): SlotHold => ({
    token: row.hold_token,
    tenantKey: row.tenant_key,
    eventTypeKey: row.event_type_key,
    hostUsername: row.host_username,
    slotStart: parseMysqlUtc(row.slot_start_utc),
    slotEnd: parseMysqlUtc(row.slot_end_utc),
    seats: Number(row.seats),
    status: row.status,
    expiresAt: parseMysqlUtc(row.expires_at_utc),
});

export class SchedulerSlotHoldRepository {
    constructor(private readonly pool: Pool) {}

    async acquire(input: AcquireSlotHoldInput): Promise<SlotHold> {
        assertInput(input);
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const connection = await this.pool.getConnection();
            try {
                await connection.beginTransaction();
                const result = await this.acquireInTransaction(connection, input);
                await connection.commit();
                return result;
            } catch (error) {
                await connection.rollback();
                if (!isRetryableTransactionError(error) || attempt === 2) throw error;
            } finally {
                connection.release();
            }
        }
        throw new Error('Failed to acquire scheduler slot hold');
    }

    private async acquireInTransaction(connection: PoolConnection, input: AcquireSlotHoldInput): Promise<SlotHold> {
        const seats = input.seats ?? 1;
        const now = input.now || new Date();
        const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000);
        const key = [input.tenantKey, input.eventTypeKey, input.hostUsername, mysqlDate(input.slotStart)];

        const [existingRows] = await connection.query<HoldRow[]>(
            `SELECT hold_token, tenant_key, event_type_key, host_username,
                    CAST(slot_start AS CHAR) AS slot_start_utc,
                    CAST(slot_end AS CHAR) AS slot_end_utc,
                    seats, status, CAST(expires_at AS CHAR) AS expires_at_utc
             FROM scheduler_slot_holds
             WHERE tenant_key = ? AND idempotency_key = ?
             LIMIT 1
             FOR UPDATE`,
            [input.tenantKey, input.idempotencyKey]
        );
        if (existingRows.length > 0) {
            const existing = mapHold(existingRows[0]);
            if (existing.status === 'released') {
                await connection.query(
                    'DELETE FROM scheduler_slot_holds WHERE hold_token = ? AND status = ?',
                    [existing.token, 'released']
                );
            } else {
                return existing.status === 'held' && existing.expiresAt.getTime() <= now.getTime()
                    ? { ...existing, status: 'expired' }
                    : existing;
            }
        }

        await connection.query(
            `INSERT INTO scheduler_slot_inventory
                (tenant_key, event_type_key, host_username, slot_start, slot_end, capacity, held_seats, confirmed_seats)
             VALUES (?, ?, ?, ?, ?, ?, 0, 0)
             ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP(3)`,
            [...key, mysqlDate(input.slotEnd), input.capacity]
        );

        const [inventoryRows] = await connection.query<InventoryRow[]>(
            `SELECT slot_end = ? AS slot_end_matches, capacity, held_seats, confirmed_seats
             FROM scheduler_slot_inventory
             WHERE tenant_key = ? AND event_type_key = ? AND host_username = ? AND slot_start = ?
             FOR UPDATE`,
            [mysqlDate(input.slotEnd), ...key]
        );
        const inventory = inventoryRows[0];
        if (!inventory) throw new Error('Failed to lock scheduler slot inventory');
        if (Number(inventory.slot_end_matches) !== 1 || Number(inventory.capacity) !== input.capacity) {
            throw new Error('Slot definition does not match existing inventory');
        }

        const [expiredRows] = await connection.query<Array<RowDataPacket & { expired_seats: number }>>(
            `SELECT COALESCE(SUM(seats), 0) AS expired_seats
             FROM scheduler_slot_holds
             WHERE tenant_key = ? AND event_type_key = ? AND host_username = ? AND slot_start = ?
               AND status = 'held' AND expires_at <= ?`,
            [...key, mysqlDate(now)]
        );
        const expiredSeats = Number(expiredRows[0]?.expired_seats || 0);
        if (expiredSeats > 0) {
            await connection.query(
                `UPDATE scheduler_slot_holds SET status = 'expired'
                 WHERE tenant_key = ? AND event_type_key = ? AND host_username = ? AND slot_start = ?
                   AND status = 'held' AND expires_at <= ?`,
                [...key, mysqlDate(now)]
            );
            await connection.query(
                `UPDATE scheduler_slot_inventory
                 SET held_seats = GREATEST(held_seats - ?, 0)
                 WHERE tenant_key = ? AND event_type_key = ? AND host_username = ? AND slot_start = ?`,
                [expiredSeats, ...key]
            );
            inventory.held_seats = Math.max(Number(inventory.held_seats) - expiredSeats, 0);
        }

        if (Number(inventory.held_seats) + Number(inventory.confirmed_seats) + seats > Number(inventory.capacity)) {
            throw new SlotUnavailableError();
        }

        const token = crypto.randomBytes(32).toString('base64url');
        await connection.query(
            `INSERT INTO scheduler_slot_holds
                (hold_token, tenant_key, event_type_key, host_username, slot_start, slot_end, seats, status, expires_at, idempotency_key)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'held', ?, ?)`,
            [
                token,
                input.tenantKey,
                input.eventTypeKey,
                input.hostUsername,
                mysqlDate(input.slotStart),
                mysqlDate(input.slotEnd),
                seats,
                mysqlDate(expiresAt),
                input.idempotencyKey,
            ]
        );
        await connection.query(
            `UPDATE scheduler_slot_inventory SET held_seats = held_seats + ?
             WHERE tenant_key = ? AND event_type_key = ? AND host_username = ? AND slot_start = ?`,
            [seats, ...key]
        );

        return {
            token,
            tenantKey: input.tenantKey,
            eventTypeKey: input.eventTypeKey,
            hostUsername: input.hostUsername,
            slotStart: input.slotStart,
            slotEnd: input.slotEnd,
            seats,
            status: 'held',
            expiresAt,
        };
    }
}
