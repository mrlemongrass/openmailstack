import { type OutboundReleaseMode } from './config';
import { type OwnedSenderIdentity } from './outbound-mail';
export type ScheduledEmailStatus = 'scheduled' | 'retry_wait' | 'claimed' | 'smtp_inflight' | 'sent_copy_pending' | 'cancel_restore_pending' | 'completed' | 'failed' | 'delivery_uncertain' | 'partial_delivery' | 'cancelled';
export type OutboundSubmissionKind = 'immediate' | 'scheduled';
export declare class OutboundReleaseBridgeError extends Error {
    readonly code = "OUTBOUND_RELEASE_BRIDGE";
    readonly status = 503;
    constructor();
}
export type CanonicalFingerprintValue = null | boolean | number | string | Date | Buffer | CanonicalFingerprintValue[] | {
    [key: string]: CanonicalFingerprintValue | undefined;
};
export interface OutboundRequestFingerprintInput {
    submissionKind: OutboundSubmissionKind;
    sendAt: Date;
    username: string;
    senderAddress: string;
    recipients: string[];
    fingerprintSource: CanonicalFingerprintValue;
}
export declare const computeOutboundRequestFingerprint: (input: OutboundRequestFingerprintInput) => string;
export interface ScheduledEmailRow {
    id: number;
    username: string;
    send_at: Date;
    mail_options: string;
    draft_uid: number | null;
    payload_version?: number;
    submission_kind?: OutboundSubmissionKind;
    idempotency_key?: string | null;
    request_fingerprint?: string | null;
    save_in_sent_items?: number | boolean;
    status?: ScheduledEmailStatus;
    available_at?: Date;
    attempts?: number;
    lease_owner?: string | null;
    sender_address?: string | null;
    message_id?: string | null;
    envelope_json?: string | null;
    rejected_recipients_json?: string | null;
    raw_message?: Buffer | null;
    sent_raw_message?: Buffer | null;
    smtp_accepted_at?: Date | null;
    removed_at?: Date | null;
}
export interface ScheduledEmailStore {
    materialize?(row: ScheduledEmailRow, workerId: string): Promise<void>;
    beginSmtp?(row: ScheduledEmailRow, workerId: string): Promise<void>;
    accepted?(row: ScheduledEmailRow, workerId: string): Promise<void>;
    renewSentCopyLease?(row: ScheduledEmailRow, workerId: string): Promise<void>;
    complete?(row: ScheduledEmailRow, workerId: string): Promise<void>;
    sentCopyPending?(row: ScheduledEmailRow, workerId: string, code: string): Promise<void>;
    retry?(row: ScheduledEmailRow, workerId: string, code: string): Promise<void>;
    failed?(row: ScheduledEmailRow, workerId: string, code: string): Promise<void>;
    uncertain?(row: ScheduledEmailRow, workerId: string, code: string): Promise<void>;
}
export interface ScheduledEmailDependencies {
    operationTimeoutMs?: number;
    getCredential(username: string): Promise<string>;
    createTransport(username: string, password: string): any;
    createImap(username: string, password: string): Promise<any>;
    authorizeSender(username: string, sender: string): Promise<OwnedSenderIdentity>;
    onAccepted?(row: ScheduledEmailRow, acceptedRecipients: string[]): Promise<void>;
}
export declare const classifyScheduledSmtpError: (error: any) => "safe_to_retry" | "permanent_failure" | "delivery_uncertain";
export declare const processScheduledEmail: (row: ScheduledEmailRow, workerId: string, store: ScheduledEmailStore, dependencies: ScheduledEmailDependencies) => Promise<ScheduledEmailStatus>;
export declare const ensureScheduledEmailsSchema: (db?: any) => Promise<void>;
export declare class MySqlScheduledEmailStore implements ScheduledEmailStore {
    private readonly db;
    private readonly releaseMode;
    constructor(db?: any, releaseMode?: OutboundReleaseMode);
    claimById(id: number, username: string, workerId: string): Promise<ScheduledEmailRow | null>;
    claimBatch(workerId: string, limit?: number): Promise<ScheduledEmailRow[]>;
    private update;
    materialize(row: ScheduledEmailRow, workerId: string): Promise<void>;
    beginSmtp(row: ScheduledEmailRow, workerId: string): Promise<void>;
    accepted(row: ScheduledEmailRow, workerId: string): Promise<void>;
    renewSentCopyLease(row: ScheduledEmailRow, workerId: string): Promise<void>;
    complete(row: ScheduledEmailRow, workerId: string): Promise<void>;
    sentCopyPending(row: ScheduledEmailRow, workerId: string, code: string): Promise<void>;
    retry(row: ScheduledEmailRow, workerId: string, code: string): Promise<void>;
    failed(row: ScheduledEmailRow, workerId: string, code: string): Promise<void>;
    uncertain(row: ScheduledEmailRow, workerId: string, code: string): Promise<void>;
}
export type ScheduledCancellationClaim = {
    outcome: 'ready';
    row: ScheduledEmailRow;
} | {
    outcome: 'not_found' | 'conflict';
};
export declare const claimScheduledCancellation: (db: any, id: number, username: string, workerId: string) => Promise<ScheduledCancellationClaim>;
export declare const completeScheduledCancellation: (db: any, id: number, username: string, workerId: string, restoredDraftUid: number) => Promise<void>;
export declare const releaseScheduledCancellation: (db: any, id: number, username: string, workerId: string, code: string) => Promise<void>;
export declare const removeTerminalScheduledEmail: (db: any, id: number, username: string) => Promise<"removed" | "not_found" | "conflict">;
export declare const abortScheduledEmailBeforeDelivery: (db: any, id: number, username: string) => Promise<boolean>;
export interface PersistedOutboundMessage {
    username: string;
    sendAt: Date;
    senderAddress: string;
    messageId: string;
    envelope: {
        from: string;
        to: string[];
    };
    raw: Buffer;
    sentRaw?: Buffer;
    metadata: Record<string, any>;
    draftUid?: number | null;
    saveSentCopy?: boolean;
}
export interface OutboundSubmissionInput {
    submissionKind: OutboundSubmissionKind;
    idempotencyKey: string;
    fingerprintSource: CanonicalFingerprintValue;
    message: PersistedOutboundMessage;
    requestCredential?: string;
}
export interface OutboundSubmissionStatus {
    id: number;
    submissionKind: OutboundSubmissionKind;
    status: ScheduledEmailStatus;
    messageId: string | null;
    sendAt: Date;
    smtpAccepted: boolean;
    saveSentCopy: boolean;
    rejectedRecipients: string[];
    lastErrorCode: string | null;
}
export interface OutboundSubmissionResult extends OutboundSubmissionStatus {
    replayed: boolean;
}
export type OutboundSubmissionLookup = {
    id: number;
} | {
    idempotencyKey: string;
};
export interface SubmitOutboundRuntime {
    workerId?: string;
    dependencies?: Partial<ScheduledEmailDependencies>;
}
export declare class OutboundIdempotencyKeyError extends Error {
    readonly code = "OUTBOUND_IDEMPOTENCY_KEY_INVALID";
    readonly status = 400;
    constructor(message?: string);
}
export declare class OutboundIdempotencyConflictError extends Error {
    readonly code = "OUTBOUND_IDEMPOTENCY_CONFLICT";
    readonly status = 409;
    constructor();
}
export declare class OutboundSubmissionUnavailableError extends Error {
    readonly code = "OUTBOUND_SUBMISSION_UNAVAILABLE";
    readonly status = 503;
    constructor(cause?: unknown);
}
export declare const getOutboundSubmission: (db: any, username: string, lookup: OutboundSubmissionLookup) => Promise<OutboundSubmissionStatus | null>;
export declare const submitOutbound: (db: any, input: OutboundSubmissionInput, runtime?: SubmitOutboundRuntime) => Promise<OutboundSubmissionResult>;
export declare const runScheduledSender: (dependencies?: ScheduledEmailDependencies, db?: any, workerId?: string) => Promise<number>;
export declare const startScheduledSender: () => void;
//# sourceMappingURL=scheduled-send.d.ts.map