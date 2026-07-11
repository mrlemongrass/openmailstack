export declare const SCHEDULER_ACTIONS: readonly ["profile.public.read", "slots.public.read", "booking.public.create", "booking.capability.read", "booking.capability.cancel", "booking.capability.reschedule", "scheduler.owner.read", "scheduler.owner.write", "scheduler.analytics.read", "scheduler.entitlement.manage", "scheduler.integration.manage"];
export type SchedulerAction = typeof SCHEDULER_ACTIONS[number];
export type SchedulerActor = {
    kind: 'anonymous';
} | {
    kind: 'user';
    username: string;
    tenantKey: string;
} | {
    kind: 'admin';
    username: string;
    superAdmin: boolean;
    tenantKeys: string[];
} | {
    kind: 'capability';
    tenantKey: string;
    bookingId: string;
    scopes: Array<'read' | 'cancel' | 'reschedule'>;
    expiresAt: Date;
};
export interface SchedulerResource {
    schedulerInstalled: boolean;
    tenantKey: string;
    ownerUsername?: string;
    bookingId?: string;
    schedulerEnabled?: boolean;
    published?: boolean;
}
export type SchedulerAuthorizationDecision = {
    allowed: true;
} | {
    allowed: false;
    reason: 'not_found' | 'unauthorized' | 'forbidden' | 'expired';
};
export declare const schedulerTenantKeyFromUsername: (username: string) => string;
export declare function authorizeSchedulerAction(actor: SchedulerActor, action: SchedulerAction, resource: SchedulerResource, now?: Date): SchedulerAuthorizationDecision;
//# sourceMappingURL=authorization.d.ts.map