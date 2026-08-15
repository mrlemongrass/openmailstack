export interface MailQueryable {
    query(sql: string, params?: any[]): Promise<any>;
}
export declare class SenderAuthorizationError extends Error {
    readonly code = "SENDER_NOT_AUTHORIZED";
    readonly status = 403;
    constructor();
}
export interface OwnedSenderIdentity {
    address: string;
    name: string;
}
export interface OwnedSenderIdentities {
    name: string;
    primary: string;
    addresses: string[];
}
export declare const normalizeMailboxAddress: (value: unknown) => string | null;
export declare const listOwnedSenderIdentities: (db: MailQueryable, username: string) => Promise<OwnedSenderIdentities>;
export declare const authorizeOutboundSender: (db: MailQueryable, username: string, requestedFrom?: unknown) => Promise<OwnedSenderIdentity>;
export interface OutboundAttachment {
    filename: string;
    content: Buffer;
    contentType?: string;
}
export interface OutboundMessageInput {
    sender: OwnedSenderIdentity;
    to?: string | string[];
    cc?: string | string[];
    bcc?: string | string[];
    replyTo?: string;
    subject?: string;
    text?: string;
    body?: string;
    html?: string;
    inReplyTo?: string;
    references?: string | string[];
    attachments?: OutboundAttachment[];
    headers?: Record<string, string>;
    messageId?: string;
    date?: Date;
    allowNoRecipients?: boolean;
    keepBcc?: boolean;
}
export interface CompiledOutboundMessage {
    raw: Buffer;
    sentRaw: Buffer;
    envelope: {
        from: string;
        to: string[];
    };
    messageId: string;
    date: Date;
    metadata: {
        from: string;
        to: string;
        cc: string;
        bcc: string;
        replyTo: string;
        subject: string;
        text: string;
        html: string;
        inReplyTo: string;
        references: string[];
    };
}
export declare class OutboundMessageValidationError extends Error {
    readonly code = "OUTBOUND_MESSAGE_INVALID";
    readonly status = 400;
    constructor(message: string);
}
export declare class SmtpRecipientsRejectedError extends Error {
    readonly code = "EENVELOPE";
    readonly command = "RCPT TO";
    constructor();
}
export interface SmtpRecipientOutcome {
    accepted: string[];
    rejected: string[];
    partial: boolean;
}
export declare const classifySmtpRecipientOutcome: (info: any, requestedRecipients: string[]) => SmtpRecipientOutcome;
export declare const mailboxAddressFromHeader: (value: unknown) => string | null;
export declare const compileOutboundMessage: (input: OutboundMessageInput) => Promise<CompiledOutboundMessage>;
//# sourceMappingURL=outbound-mail.d.ts.map