import type { Pool, PoolConnection } from 'mysql2/promise';
type Queryable = Pick<Pool, 'query'> | Pick<PoolConnection, 'query'>;
export interface SchedulerWorkflowDefinition {
    trigger: {
        type: 'booking.start';
        offsetSeconds: number;
    };
    steps: Array<{
        action: 'message.email.reminder';
        delaySeconds: number;
        config: {
            subject?: string;
            body?: string;
        };
    }>;
}
export interface SchedulerReminderPayload {
    bookingId: string;
    hostEmail: string;
    notificationFrom?: string;
    notificationName?: string;
    bookerEmail: string;
    bookerName: string;
    title: string;
    start: string;
    timeZone: string;
    manageUrl: string;
}
export interface SchedulerReminderMail {
    to: string;
    subject: string;
    text: string;
    from: {
        name: string;
        address: string;
    };
    replyTo: string;
}
export interface SchedulerJobClaim {
    id: string;
    idempotencyKey: string;
    attempts: number;
    payload: SchedulerReminderPayload;
    config: SchedulerWorkflowDefinition['steps'][number]['config'];
}
export interface SchedulerJobStore {
    claimBatch(workerId: string, limit: number, leaseUntil: Date): Promise<SchedulerJobClaim[]>;
    beginAttempt(jobId: string, workerId: string, provider: string): Promise<void>;
    complete(jobId: string, workerId: string, provider: string, providerMessageId?: string): Promise<void>;
    fail(jobId: string, workerId: string, provider: string, attempt: number, errorCode: string): Promise<void>;
}
export interface SchedulerMessageProvider {
    readonly name: string;
    send(mail: SchedulerReminderMail, idempotencyKey: string): Promise<{
        messageId?: string;
    }>;
}
export declare class SchedulerProviderError extends Error {
    readonly disposition: 'safe_to_retry' | 'delivery_uncertain';
    readonly code: string;
    constructor(message: string, disposition: 'safe_to_retry' | 'delivery_uncertain', code?: string);
}
export interface SchedulerBookingWorkflowInput extends Omit<SchedulerReminderPayload, 'start'> {
    tenantKey: string;
    eventTypeId: string;
    start: Date;
}
export declare function normalizeWorkflowDefinition(value: any): SchedulerWorkflowDefinition;
export declare function workflowRunAt(bookingStart: Date, triggerOffsetSeconds: number, stepDelaySeconds: number): Date;
export declare function schedulerReminderMail(payload: SchedulerReminderPayload, config: SchedulerWorkflowDefinition['steps'][number]['config']): SchedulerReminderMail;
export declare function runSchedulerJobCycle(repository: SchedulerJobStore, provider: SchedulerMessageProvider, workerId: string): Promise<number>;
export declare class SchedulerWorkflowRepository {
    private readonly pool;
    constructor(pool: Pool);
    createWorkflow(input: {
        tenantKey: string;
        ownerUsername: string;
        name: string;
        enabled?: boolean;
        eventTypeIds?: string[];
    }): Promise<{
        id: string;
    }>;
    publishVersion(workflowId: string, createdBy: string, value: unknown): Promise<{
        id: string;
        version: number;
    }>;
    captureForBooking(db: Queryable, input: SchedulerBookingWorkflowInput): Promise<number>;
    rescheduleForBooking(db: Queryable, input: SchedulerBookingWorkflowInput): Promise<number>;
    cancelForBooking(db: Queryable, tenantKey: string, bookingId: string): Promise<void>;
    listBookingVersions(tenantKey: string, bookingId: string): Promise<Array<{
        workflowId: string;
        versionId: string;
        version: number;
    }>>;
}
export declare class SchedulerJobRepository implements SchedulerJobStore {
    private readonly pool;
    constructor(pool: Pool);
    claimBatch(workerId: string, limit: number, _leaseUntil: Date): Promise<SchedulerJobClaim[]>;
    beginAttempt(jobId: string, workerId: string, provider: string): Promise<void>;
    complete(jobId: string, workerId: string, provider: string, providerMessageId?: string): Promise<void>;
    fail(jobId: string, workerId: string, provider: string, attempt: number, errorCode: string): Promise<void>;
}
export {};
//# sourceMappingURL=workflows.d.ts.map