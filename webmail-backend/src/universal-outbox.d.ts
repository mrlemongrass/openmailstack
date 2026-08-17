export declare const OUTBOUND_COMPACTION_VERIFIED_MODE: "registry-verified-v1";
export type OutboundSubmissionOrigin = 'web' | 'activesync';
export type OutboundCompactionMode = 'disabled' | typeof OUTBOUND_COMPACTION_VERIFIED_MODE;
export interface UniversalOutboundReservation {
    username: string;
    sendAtSql: string;
    mailOptions: string;
    displayMetadata: string;
    draftUid: number | null;
    submissionKind: 'immediate' | 'scheduled';
    submissionOrigin: OutboundSubmissionOrigin;
    idempotencyKey: string;
    requestFingerprint: string;
    saveSentCopy: boolean;
    senderAddress: string;
    messageId: string;
    envelopeJson: string;
    rawMessage: Buffer;
    sentRawMessage: Buffer;
}
export interface UniversalOutboundIdentityRow {
    id: number;
    submission_kind: 'immediate' | 'scheduled';
    submission_origin?: OutboundSubmissionOrigin;
    idempotency_key: string | null;
    request_fingerprint: string | null;
    status: string;
    message_id: string | null;
    send_at: Date | string;
    send_at_utc?: string;
    smtp_accepted_at: Date | null;
    save_in_sent_items: number | boolean;
    rejected_recipients_json: string | null;
    last_error_code: string | null;
    registry_only?: number | boolean;
}
export interface UniversalOutboundReservationResult {
    id: number;
    replayed: boolean;
    existing?: UniversalOutboundIdentityRow;
}
export interface OutboundMaintenanceResult {
    payloadsPurged: number;
    hotRowsRemoved: number;
    tombstonesRemoved: number;
}
export declare class UniversalOutboundFingerprintConflictError extends Error {
    constructor();
}
export declare const ensureOutboundRegistrySchema: (db: any) => Promise<void>;
export declare const findUniversalOutboundIdentity: (db: any, username: string, lookup: {
    id: number;
} | {
    idempotencyKey: string;
}) => Promise<UniversalOutboundIdentityRow | null>;
export declare const reserveUniversalOutbound: (db: any, reservation: UniversalOutboundReservation) => Promise<UniversalOutboundReservationResult>;
export declare const abortUniversalOutboundReservation: (db: any, id: number, username: string) => Promise<boolean>;
export declare const backfillOutboundRegistry: (db: any, batchSize?: number) => Promise<{
    inserted: number;
    remaining: number;
}>;
export declare const compactUniversalOutbox: (db: any, options: {
    mode: OutboundCompactionMode;
    batchSize?: number;
}) => Promise<OutboundMaintenanceResult>;
export declare const projectMixedBasisInstant: (row: any, localField?: string, utcAlias?: string) => Date;
export declare const selectMixedBasisDueRows: (connection: any, limit: number, now: Date) => Promise<any[]>;
//# sourceMappingURL=universal-outbox.d.ts.map