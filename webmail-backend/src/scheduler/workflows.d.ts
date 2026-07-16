import type { Pool, PoolConnection } from 'mysql2/promise';
import { postSchedulerProviderJson } from './provider-http';
type Queryable = Pick<Pool, 'query'> | Pick<PoolConnection, 'query'>;
export type SchedulerWorkflowTriggerType = 'booking.requested' | 'booking.start' | 'booking.ended' | 'booking.confirmed' | 'booking.rejected' | 'booking.cancelled' | 'booking.rescheduled' | 'booking.completed' | 'booking.no_show';
export type SchedulerWorkflowActionType = 'message.email.reminder' | 'message.email' | 'notification.in_app' | 'webhook.http' | 'message.external';
export type SchedulerExternalChannel = 'sms' | 'whatsapp' | 'voice';
export interface SchedulerWorkflowCondition {
    field: 'booking.status' | 'booker.locale' | 'booking.consent';
    operator: 'equals' | 'not_equals' | 'contains';
    value: string;
}
export interface SchedulerWorkflowTranslation {
    subject?: string;
    body?: string;
}
export interface SchedulerWorkflowStepConfig {
    recipient?: 'guest' | 'host';
    subject?: string;
    title?: string;
    body?: string;
    translations?: Record<string, SchedulerWorkflowTranslation>;
    providerId?: string;
    channel?: SchedulerExternalChannel;
    requiresConsent?: boolean;
}
export interface SchedulerWorkflowDefinition {
    trigger: {
        type: SchedulerWorkflowTriggerType;
        offsetSeconds: number;
    };
    steps: Array<{
        action: SchedulerWorkflowActionType;
        delaySeconds: number;
        condition?: SchedulerWorkflowCondition;
        config: SchedulerWorkflowStepConfig;
    }>;
}
export interface SchedulerReminderPayload {
    tenantKey?: string;
    bookingId: string;
    hostEmail: string;
    notificationFrom?: string;
    notificationName?: string;
    bookerEmail: string;
    bookerName: string;
    bookerPhone?: string;
    title: string;
    start: string;
    end?: string;
    status?: string;
    timeZone: string;
    locale?: string;
    communicationConsents?: SchedulerExternalChannel[];
    manageUrl: string;
}
export interface SchedulerRenderedAction {
    recipient: string;
    phone?: string;
    subject: string;
    body: string;
}
export interface SchedulerCommunicationConsents {
    phone: string;
    channels: SchedulerExternalChannel[];
}
export interface SchedulerProviderConfigInput {
    name: string;
    channel: SchedulerExternalChannel | 'webhook' | 'translation';
    endpointUrl: string;
    authHeaderName?: string;
    secret?: string;
    timeoutSeconds?: number;
    allowPrivateNetwork?: boolean;
    enabled?: boolean;
}
export interface SchedulerEncryptedSecret {
    ciphertext: string;
    iv: Buffer;
    tag: Buffer;
    keyVersion: number;
}
export interface SchedulerSecretKeyRing {
    currentVersion: number;
    keys: Record<number, string>;
}
export declare class SchedulerSecretBox {
    private readonly currentVersion;
    private readonly rootKeys;
    constructor(keyMaterial: string | SchedulerSecretKeyRing);
    private key;
    encrypt(value: string, purpose: string): SchedulerEncryptedSecret;
    decrypt(value: SchedulerEncryptedSecret, purpose: string): string;
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
    tenantKey: string;
    bookingId?: string;
    jobType: SchedulerWorkflowActionType;
    idempotencyKey: string;
    attempts: number;
    payload: SchedulerReminderPayload;
    config: SchedulerWorkflowDefinition['steps'][number]['config'];
    condition?: SchedulerWorkflowCondition;
    contactEmail?: string;
    consentChannel?: 'email' | SchedulerExternalChannel;
}
export interface SchedulerJobStore {
    claimBatch(workerId: string, limit: number, leaseUntil: Date): Promise<SchedulerJobClaim[]>;
    beginAttempt(jobId: string, workerId: string, provider: string): Promise<void>;
    complete(jobId: string, workerId: string, provider: string, providerMessageId?: string): Promise<void>;
    fail(jobId: string, workerId: string, provider: string, attempt: number, errorCode: string): Promise<void>;
    uncertain?(jobId: string, workerId: string, provider: string, attempt: number, errorCode: string): Promise<void>;
    deadLetter?(jobId: string, workerId: string, provider: string, attempt: number, errorCode: string): Promise<void>;
    skip?(jobId: string, workerId: string, reason: string): Promise<void>;
    cancel?(jobId: string, workerId: string, provider: string, errorCode: string): Promise<void>;
}
export interface SchedulerMessageProvider {
    readonly name: string;
    send(mail: SchedulerReminderMail, idempotencyKey: string): Promise<{
        messageId?: string;
    }>;
}
export interface SchedulerWorkflowDispatcher {
    providerName(job: SchedulerJobClaim): string;
    deliver(job: SchedulerJobClaim): Promise<{
        messageId?: string;
    }>;
}
export declare class SchedulerProviderError extends Error {
    readonly disposition: 'safe_to_retry' | 'delivery_uncertain' | 'operator_action' | 'policy_skip';
    readonly code: string;
    constructor(message: string, disposition: 'safe_to_retry' | 'delivery_uncertain' | 'operator_action' | 'policy_skip', code?: string);
}
export interface SchedulerBookingWorkflowInput extends Omit<SchedulerReminderPayload, 'start' | 'end'> {
    tenantKey: string;
    eventTypeId: string;
    start: Date;
    end: Date;
}
export declare function normalizeWorkflowDefinition(value: any): SchedulerWorkflowDefinition;
export declare function normalizeCommunicationConsents(value: any): SchedulerCommunicationConsents;
export declare const bookingConsentAllows: (payload: Pick<SchedulerReminderPayload, "communicationConsents">, channel: SchedulerExternalChannel) => boolean;
export declare const workflowConditionMatches: (condition: SchedulerWorkflowCondition | undefined, payload: Pick<SchedulerReminderPayload, "status" | "locale" | "communicationConsents">) => boolean;
export declare function normalizeProviderConfig(value: any): SchedulerProviderConfigInput;
export declare function renderWorkflowAction(payload: SchedulerReminderPayload, config: SchedulerWorkflowStepConfig): SchedulerRenderedAction;
export declare function workflowRunAt(bookingStart: Date, triggerOffsetSeconds: number, stepDelaySeconds: number): Date;
export declare function schedulerReminderMail(payload: SchedulerReminderPayload, config: SchedulerWorkflowDefinition['steps'][number]['config']): SchedulerReminderMail;
export declare function runSchedulerJobCycle(repository: SchedulerJobStore, provider: SchedulerMessageProvider | SchedulerWorkflowDispatcher, workerId: string): Promise<number>;
export declare class SchedulerWorkflowRepository {
    private readonly pool;
    constructor(pool: Pool);
    listWorkflows(ownerUsername: string): Promise<Array<Record<string, unknown>>>;
    updateWorkflow(ownerUsername: string, workflowId: string, input: {
        name?: string;
        enabled?: boolean;
        eventTypeIds?: string[];
    }): Promise<void>;
    archiveWorkflow(ownerUsername: string, workflowId: string): Promise<void>;
    createWorkflow(input: {
        tenantKey: string;
        ownerUsername: string;
        name: string;
        enabled?: boolean;
        eventTypeIds?: string[];
    }): Promise<{
        id: string;
    }>;
    cloneWorkflow(ownerUsername: string, workflowId: string): Promise<{
        id: string;
    }>;
    publishVersion(workflowId: string, createdBy: string, value: unknown): Promise<{
        id: string;
        version: number;
    }>;
    enqueueTest(ownerUsername: string, workflowId: string, payload: SchedulerReminderPayload): Promise<{
        jobIds: string[];
        skippedActions: SchedulerWorkflowActionType[];
    }>;
    requiredChannels(ownerUsername: string, eventTypeId: string): Promise<SchedulerExternalChannel[]>;
    listOperations(ownerUsername: string, limit?: number): Promise<{
        jobs: any[];
        alerts: any[];
    }>;
    listAdminOperations(tenantKeyValue?: string, limit?: number): Promise<{
        jobs: any[];
        alerts: any[];
        metrics: Record<string, number>;
    }>;
    reconcileJob(ownerUsername: string, jobId: string, action: 'retry' | 'delivered' | 'cancel'): Promise<void>;
    reconcileJobAsAdmin(adminUsername: string, jobId: string, action: 'retry' | 'delivered' | 'cancel'): Promise<void>;
    private reconcileJobScoped;
    listNotifications(ownerUsername: string, limit?: number): Promise<any[]>;
    markNotificationRead(ownerUsername: string, notificationId: string): Promise<void>;
    captureForBooking(db: Queryable, input: SchedulerBookingWorkflowInput, lifecycleTrigger?: 'booking.requested' | 'booking.confirmed'): Promise<number>;
    activateCapturedForBooking(db: Queryable, input: SchedulerBookingWorkflowInput): Promise<number>;
    rescheduleForBooking(db: Queryable, input: SchedulerBookingWorkflowInput): Promise<number>;
    triggerForBooking(db: Queryable, input: SchedulerBookingWorkflowInput, trigger: Exclude<SchedulerWorkflowTriggerType, 'booking.requested' | 'booking.start' | 'booking.ended' | 'booking.confirmed' | 'booking.rescheduled'>): Promise<number>;
    cancelForBooking(db: Queryable, input: SchedulerBookingWorkflowInput): Promise<number>;
    listBookingVersions(tenantKey: string, bookingId: string): Promise<Array<{
        workflowId: string;
        versionId: string;
        version: number;
    }>>;
}
export interface SchedulerDeliveryProvider {
    id: string;
    tenantKey: string;
    name: string;
    channel: SchedulerProviderConfigInput['channel'];
    endpointUrl: string;
    authHeaderName: string;
    timeoutSeconds: number;
    allowPrivateNetwork: boolean;
    enabled: boolean;
    hasSecret: boolean;
    lastTestedAt: string | null;
    lastTestStatus: 'healthy' | 'failed' | null;
    lastTestErrorCode: string | null;
}
interface SchedulerDeliveryProviderSecret extends SchedulerDeliveryProvider {
    secret?: string;
}
export declare class SchedulerDeliveryProviderRepository {
    private readonly pool;
    private readonly secrets;
    constructor(pool: Pool, secrets: SchedulerSecretBox);
    private fromRow;
    list(tenantKey?: string): Promise<SchedulerDeliveryProvider[]>;
    listAvailable(tenantKey: string): Promise<Array<Pick<SchedulerDeliveryProvider, 'id' | 'name' | 'channel'>>>;
    save(actor: string, tenantKeyValue: string, value: unknown, providerId?: string): Promise<SchedulerDeliveryProvider>;
    disable(providerId: string, actor: string): Promise<void>;
    recordTest(providerId: string, status: 'healthy' | 'failed', errorCode?: string): Promise<void>;
    forDelivery(tenantKey: string, providerId: string): Promise<SchedulerDeliveryProviderSecret>;
}
export declare class SchedulerContactPreferenceRepository {
    private readonly pool;
    private readonly secrets;
    constructor(pool: Pool, secrets: SchedulerSecretBox);
    recordConsents(db: Queryable, tenantKey: string, emailValue: string, consent: SchedulerCommunicationConsents): Promise<void>;
    current(tenantKey: string, email: string, channel: SchedulerExternalChannel): Promise<{
        phone: string;
        token: string;
    } | null>;
    unsubscribe(tokenValue: string): Promise<boolean>;
}
export declare class SchedulerWorkflowDeliveryDispatcher implements SchedulerWorkflowDispatcher {
    private readonly pool;
    private readonly smtp;
    private readonly providers;
    private readonly preferences;
    private readonly publicBaseUrl;
    private readonly providerHttp;
    constructor(pool: Pool, smtp: SchedulerMessageProvider, providers: SchedulerDeliveryProviderRepository, preferences: SchedulerContactPreferenceRepository, publicBaseUrl: string, providerHttp?: typeof postSchedulerProviderJson);
    providerName(job: SchedulerJobClaim): string;
    deliver(job: SchedulerJobClaim): Promise<{
        messageId?: string;
    }>;
    testProvider(tenantKey: string, providerId: string): Promise<void>;
    translateDefinition(tenantKey: string, providerId: string, localeValues: unknown, definitionValue: unknown): Promise<SchedulerWorkflowDefinition>;
}
export declare class SchedulerJobRepository implements SchedulerJobStore {
    private readonly pool;
    constructor(pool: Pool);
    claimBatch(workerId: string, limit: number, _leaseUntil: Date): Promise<SchedulerJobClaim[]>;
    beginAttempt(jobId: string, workerId: string, provider: string): Promise<void>;
    skip(jobId: string, workerId: string, reason: string): Promise<void>;
    complete(jobId: string, workerId: string, provider: string, providerMessageId?: string): Promise<void>;
    fail(jobId: string, workerId: string, provider: string, attempt: number, errorCode: string): Promise<void>;
    uncertain(jobId: string, workerId: string, provider: string, attempt: number, errorCode: string): Promise<void>;
    deadLetter(jobId: string, workerId: string, provider: string, attempt: number, errorCode: string): Promise<void>;
    private recordTerminalFailure;
    cancel(jobId: string, workerId: string, provider: string, errorCode: string): Promise<void>;
}
export {};
//# sourceMappingURL=workflows.d.ts.map