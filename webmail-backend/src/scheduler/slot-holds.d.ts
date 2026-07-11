import type { Pool } from 'mysql2/promise';
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
export declare class SlotUnavailableError extends Error {
    constructor();
}
export declare class SchedulerSlotHoldRepository {
    private readonly pool;
    constructor(pool: Pool);
    acquire(input: AcquireSlotHoldInput): Promise<SlotHold>;
    private acquireInTransaction;
}
//# sourceMappingURL=slot-holds.d.ts.map