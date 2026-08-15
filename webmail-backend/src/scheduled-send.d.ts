import { type OwnedSenderIdentity } from './outbound-mail';
export type ScheduledEmailStatus = 'scheduled' | 'retry_wait' | 'claimed' | 'smtp_inflight' | 'sent_copy_pending' | 'cancel_restore_pending' | 'completed' | 'failed' | 'delivery_uncertain' | 'partial_delivery' | 'cancelled';
export interface ScheduledEmailRow {
    id: number;
    username: string;
    send_at: Date;
    mail_options: string;
    draft_uid: number | null;
    payload_version?: number;
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
}
export declare const classifyScheduledSmtpError: (error: any) => "safe_to_retry" | "delivery_uncertain";
export declare const processScheduledEmail: (row: ScheduledEmailRow, workerId: string, store: ScheduledEmailStore, dependencies: ScheduledEmailDependencies) => Promise<ScheduledEmailStatus>;
export declare const ensureScheduledEmailsSchema: (db?: any) => Promise<void>;
export declare class MySqlScheduledEmailStore implements ScheduledEmailStore {
    private readonly db;
    constructor(db?: any);
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
}
export declare const enqueueScheduledEmail: (db: any, message: PersistedOutboundMessage) => Promise<number>;
export declare const retainAcceptedSentCopy: (db: any, message: PersistedOutboundMessage) => Promise<number>;
export declare const runScheduledSender: (dependencies?: ScheduledEmailDependencies, db?: any, workerId?: string) => Promise<number>;
export declare const startScheduledSender: () => void;
//# sourceMappingURL=scheduled-send.d.ts.map