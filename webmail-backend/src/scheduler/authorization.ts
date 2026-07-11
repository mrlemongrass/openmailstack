export const SCHEDULER_ACTIONS = [
    'profile.public.read',
    'slots.public.read',
    'booking.public.create',
    'booking.capability.read',
    'booking.capability.cancel',
    'booking.capability.reschedule',
    'scheduler.owner.read',
    'scheduler.owner.write',
    'scheduler.analytics.read',
    'scheduler.entitlement.manage',
    'scheduler.integration.manage',
] as const;

export type SchedulerAction = typeof SCHEDULER_ACTIONS[number];

export type SchedulerActor =
    | { kind: 'anonymous' }
    | { kind: 'user'; username: string; tenantKey: string }
    | { kind: 'admin'; username: string; superAdmin: boolean; tenantKeys: string[] }
    | {
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

export type SchedulerAuthorizationDecision =
    | { allowed: true }
    | { allowed: false; reason: 'not_found' | 'unauthorized' | 'forbidden' | 'expired' };

const normalized = (value: string): string => value.trim().toLowerCase();

export const schedulerTenantKeyFromUsername = (username: string): string => {
    const normalizedUsername = normalized(username);
    const separator = normalizedUsername.lastIndexOf('@');
    if (separator <= 0 || separator === normalizedUsername.length - 1) {
        throw new Error('Scheduler usernames must be full mailbox addresses');
    }
    return normalizedUsername.slice(separator + 1);
};

const publicAction = (action: SchedulerAction): boolean => (
    action === 'profile.public.read'
    || action === 'slots.public.read'
    || action === 'booking.public.create'
);

const capabilityScope = (action: SchedulerAction): 'read' | 'cancel' | 'reschedule' | null => {
    if (action === 'booking.capability.read') return 'read';
    if (action === 'booking.capability.cancel') return 'cancel';
    if (action === 'booking.capability.reschedule') return 'reschedule';
    return null;
};

export function authorizeSchedulerAction(
    actor: SchedulerActor,
    action: SchedulerAction,
    resource: SchedulerResource,
    now = new Date()
): SchedulerAuthorizationDecision {
    if (!resource.schedulerInstalled) {
        return { allowed: false, reason: publicAction(action) || capabilityScope(action) ? 'not_found' : 'forbidden' };
    }

    if (publicAction(action)) {
        return resource.schedulerEnabled && resource.published
            ? { allowed: true }
            : { allowed: false, reason: 'not_found' };
    }

    const requiredScope = capabilityScope(action);
    if (requiredScope) {
        if (actor.kind !== 'capability') return { allowed: false, reason: 'unauthorized' };
        if (actor.expiresAt.getTime() <= now.getTime()) return { allowed: false, reason: 'expired' };
        if (normalized(actor.tenantKey) !== normalized(resource.tenantKey) || actor.bookingId !== resource.bookingId) {
            return { allowed: false, reason: 'not_found' };
        }
        return actor.scopes.includes(requiredScope)
            ? { allowed: true }
            : { allowed: false, reason: 'forbidden' };
    }

    if (actor.kind === 'anonymous' || actor.kind === 'capability') {
        return { allowed: false, reason: 'unauthorized' };
    }

    if (actor.kind === 'user') {
        const sameTenant = normalized(actor.tenantKey) === normalized(resource.tenantKey);
        const ownsResource = resource.ownerUsername && normalized(actor.username) === normalized(resource.ownerUsername);
        if (!sameTenant || !ownsResource) return { allowed: false, reason: 'not_found' };
        if (!resource.schedulerEnabled) return { allowed: false, reason: 'forbidden' };
        if (action === 'scheduler.entitlement.manage' || action === 'scheduler.integration.manage') {
            return { allowed: false, reason: 'forbidden' };
        }
        return { allowed: true };
    }

    const adminTenantAccess = actor.superAdmin
        || actor.tenantKeys.some((tenantKey) => normalized(tenantKey) === normalized(resource.tenantKey));
    if (!adminTenantAccess) return { allowed: false, reason: 'not_found' };
    return { allowed: true };
}
