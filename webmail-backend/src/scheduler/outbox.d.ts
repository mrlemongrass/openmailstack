export declare const SCHEDULER_OUTBOX_EVENT_TYPES: readonly ["booking.requested", "booking.confirmed", "booking.rejected", "booking.cancelled", "booking.rescheduled", "booking.verification", "waitlist.joined", "calendar.project", "conference.create", "message.send", "payment.create", "webhook.deliver"];
export type SchedulerOutboxEventType = typeof SCHEDULER_OUTBOX_EVENT_TYPES[number];
export interface SchedulerOutboxEnvelope<TPayload = Record<string, unknown>> {
    id: string;
    tenantKey: string;
    aggregateType: 'booking' | 'event_type' | 'workflow' | 'routing_response';
    aggregateId: string;
    eventType: SchedulerOutboxEventType;
    version: number;
    idempotencyKey: string;
    occurredAt: Date;
    availableAt: Date;
    payload: TPayload;
}
export interface SchedulerOutboxClaim<TPayload = Record<string, unknown>> {
    envelope: SchedulerOutboxEnvelope<TPayload>;
    leaseOwner: string;
    leaseExpiresAt: Date;
    attempt: number;
}
export interface SchedulerOutboxRepository {
    enqueue<TPayload>(envelope: SchedulerOutboxEnvelope<TPayload>): Promise<void>;
    claimBatch(workerId: string, limit: number, leaseUntil: Date): Promise<SchedulerOutboxClaim[]>;
    complete(eventId: string, workerId: string): Promise<void>;
    retry(eventId: string, workerId: string, availableAt: Date, errorCode: string): Promise<void>;
    deadLetter(eventId: string, workerId: string, errorCode: string): Promise<void>;
}
export interface SchedulerAuditEvent {
    id: string;
    tenantKey: string;
    actorType: 'anonymous' | 'user' | 'admin' | 'capability' | 'worker';
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    occurredAt: Date;
    correlationId: string;
    ipAddress?: string;
    metadata: Record<string, string | number | boolean | null>;
}
export interface SchedulerAuditSink {
    write(event: SchedulerAuditEvent): Promise<void>;
}
//# sourceMappingURL=outbox.d.ts.map