import crypto from 'crypto';

const MailComposer = require('nodemailer/lib/mail-composer');
const addressparser = require('nodemailer/lib/addressparser');

export interface MailQueryable {
    query(sql: string, params?: any[]): Promise<any>;
}

export class SenderAuthorizationError extends Error {
    readonly code = 'SENDER_NOT_AUTHORIZED';
    readonly status = 403;

    constructor() {
        super('The selected From address is not an active identity for this mailbox');
        this.name = 'SenderAuthorizationError';
    }
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

export const normalizeMailboxAddress = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const address = value.trim().toLowerCase();
    if (!address || Buffer.byteLength(address, 'utf8') > 254 || /[\s\r\n\0]/.test(address)) return null;
    const at = address.indexOf('@');
    if (at < 1 || at !== address.lastIndexOf('@') || at === address.length - 1) return null;
    if (address.slice(0, at) === '*') return null;
    if (address.startsWith('@') || address.endsWith('.') || address.includes('..')) return null;
    return address;
};

const aliasTargetsMailbox = (value: unknown, mailbox: string): boolean => (
    typeof value === 'string'
    && value.split(',').some(target => normalizeMailboxAddress(target) === mailbox)
);

export const listOwnedSenderIdentities = async (
    db: MailQueryable,
    username: string,
): Promise<OwnedSenderIdentities> => {
    const primary = normalizeMailboxAddress(username);
    if (!primary) throw new SenderAuthorizationError();
    const [mailboxRows]: any = await db.query('SELECT name FROM mailbox WHERE username = ? LIMIT 1', [username]);
    const name = String(mailboxRows?.[0]?.name || '');
    const [aliasRows]: any = await db.query(
        `SELECT address, goto, active FROM alias
         WHERE active = 1 AND (goto = ? OR FIND_IN_SET(?, REPLACE(goto, ' ', '')) > 0)
         ORDER BY address`,
        [username, username],
    );
    const addresses = [primary];
    const seen = new Set(addresses);
    for (const row of aliasRows || []) {
        if (Number(row.active) !== 1 || !aliasTargetsMailbox(row.goto, primary)) continue;
        const address = normalizeMailboxAddress(row.address);
        if (!address || seen.has(address)) continue;
        seen.add(address);
        addresses.push(address);
    }
    return { name, primary, addresses };
};

export const authorizeOutboundSender = async (
    db: MailQueryable,
    username: string,
    requestedFrom?: unknown,
): Promise<OwnedSenderIdentity> => {
    const identities = await listOwnedSenderIdentities(db, username);
    const requested = requestedFrom == null || String(requestedFrom).trim() === ''
        ? identities.primary
        : normalizeMailboxAddress(requestedFrom);
    if (!requested || !identities.addresses.includes(requested)) throw new SenderAuthorizationError();
    return { address: requested, name: identities.name };
};

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
    envelope: { from: string; to: string[] };
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

export class OutboundMessageValidationError extends Error {
    readonly code = 'OUTBOUND_MESSAGE_INVALID';
    readonly status = 400;

    constructor(message: string) {
        super(message);
        this.name = 'OutboundMessageValidationError';
    }
}

export class SmtpRecipientsRejectedError extends Error {
    readonly code = 'EENVELOPE';
    readonly command = 'RCPT TO';

    constructor() {
        super('The SMTP server rejected every recipient');
        this.name = 'SmtpRecipientsRejectedError';
    }
}

export interface SmtpRecipientOutcome {
    accepted: string[];
    rejected: string[];
    partial: boolean;
}

const smtpResultAddress = (value: unknown): string | null => {
    if (typeof value === 'string') return normalizeMailboxAddress(value);
    if (value && typeof value === 'object' && 'address' in value) {
        return normalizeMailboxAddress((value as { address?: unknown }).address);
    }
    return null;
};

export const classifySmtpRecipientOutcome = (
    info: any,
    requestedRecipients: string[],
): SmtpRecipientOutcome => {
    const requestedByAddress = new Map<string, string>();
    for (const recipient of requestedRecipients) {
        const normalized = normalizeMailboxAddress(recipient);
        if (normalized && !requestedByAddress.has(normalized)) requestedByAddress.set(normalized, recipient);
    }
    const requested = [...requestedByAddress.values()];
    const explicitRejected = Array.isArray(info?.rejected);
    const explicitAccepted = Array.isArray(info?.accepted);
    if (!explicitRejected && !explicitAccepted) {
        return { accepted: requested, rejected: [], partial: false };
    }

    const resultAddresses = (values: unknown[]): string[] => {
        const seen = new Set<string>();
        const result: string[] = [];
        for (const value of values) {
            const normalized = smtpResultAddress(value);
            const requestedValue = normalized ? requestedByAddress.get(normalized) : undefined;
            if (!normalized || !requestedValue || seen.has(normalized)) continue;
            seen.add(normalized);
            result.push(requestedValue);
        }
        return result;
    };
    const rejected = resultAddresses(explicitRejected ? info.rejected : []);
    const rejectedSet = new Set(rejected.map(normalizeMailboxAddress).filter(Boolean));
    const accepted = explicitAccepted
        ? resultAddresses(info.accepted)
        : requested.filter(recipient => !rejectedSet.has(normalizeMailboxAddress(recipient)));

    if (rejected.length > 0 && accepted.length === 0) throw new SmtpRecipientsRejectedError();
    return { accepted, rejected, partial: rejected.length > 0 };
};

const boundedHeader = (value: unknown, field: string, limit = 998): string => {
    const text = value == null ? '' : String(value);
    if (/[\r\n\0]/.test(text) || text.length > limit) {
        throw new OutboundMessageValidationError(`${field} contains invalid header text`);
    }
    return text;
};

const addressInputText = (value: string | string[] | undefined): string => (
    Array.isArray(value) ? value.join(', ') : String(value || '')
);

const parsedAddresses = (value: string | string[] | undefined, field: string): string[] => {
    const raw = addressInputText(value).trim();
    if (!raw) return [];
    if (/[\r\n\0]/.test(raw) || Buffer.byteLength(raw, 'utf8') > 16_384) {
        throw new OutboundMessageValidationError(`${field} contains invalid address text`);
    }
    const flattened: string[] = [];
    const visit = (items: any[]) => {
        for (const item of items || []) {
            if (Array.isArray(item.group)) visit(item.group);
            else if (item.address) {
                const address = String(item.address).trim();
                if (!normalizeMailboxAddress(address)) {
                    throw new OutboundMessageValidationError(`${field} contains an invalid address`);
                }
                flattened.push(address);
            }
        }
    };
    visit(addressparser(raw));
    if (flattened.length === 0) throw new OutboundMessageValidationError(`${field} contains no valid address`);
    return flattened;
};

export const mailboxAddressFromHeader = (value: unknown): string | null => {
    if (typeof value !== 'string' || /[\r\n\0]/.test(value)) return null;
    try {
        const addresses = parsedAddresses(value, 'From');
        return addresses.length === 1 ? addresses[0] : null;
    } catch {
        return null;
    }
};

const normalizeMessageId = (value: unknown, field: string): string => {
    const raw = boundedHeader(value, field, 998).trim();
    const inner = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw;
    if (!/^[^<>\s@]+@[^<>\s@]+$/.test(inner)) {
        throw new OutboundMessageValidationError(`${field} contains an invalid message identifier`);
    }
    return `<${inner}>`;
};

const normalizeReferences = (value: string | string[] | undefined): string[] => {
    if (value == null || value === '') return [];
    const values = Array.isArray(value) ? value : (value.match(/<[^<>\s]+>/g) || value.split(/\s+/));
    const result: string[] = [];
    const seen = new Set<string>();
    for (const item of values) {
        if (!String(item).trim()) continue;
        const normalized = normalizeMessageId(item, 'References');
        if (!seen.has(normalized)) {
            seen.add(normalized);
            result.push(normalized);
        }
    }
    return result;
};

const messageIdDomain = (address: string): string => address.slice(address.lastIndexOf('@') + 1) || 'openmailstack.local';

export const compileOutboundMessage = async (input: OutboundMessageInput): Promise<CompiledOutboundMessage> => {
    const from = normalizeMailboxAddress(input.sender.address);
    if (!from) throw new OutboundMessageValidationError('From contains an invalid address');
    const toAddresses = parsedAddresses(input.to, 'To');
    const ccAddresses = parsedAddresses(input.cc, 'Cc');
    const bccAddresses = parsedAddresses(input.bcc, 'Bcc');
    const envelopeRecipients: string[] = [];
    const seenRecipients = new Set<string>();
    for (const address of [...toAddresses, ...ccAddresses, ...bccAddresses]) {
        const key = normalizeMailboxAddress(address)!;
        if (seenRecipients.has(key)) continue;
        seenRecipients.add(key);
        envelopeRecipients.push(address);
    }
    if (!input.allowNoRecipients && envelopeRecipients.length === 0) {
        throw new OutboundMessageValidationError('At least one recipient is required');
    }
    const replyToAddresses = parsedAddresses(input.replyTo, 'Reply-To');
    const subject = boundedHeader(input.subject || '', 'Subject');
    const inReplyTo = input.inReplyTo ? normalizeMessageId(input.inReplyTo, 'In-Reply-To') : '';
    const references = normalizeReferences(input.references);
    const messageId = input.messageId
        ? normalizeMessageId(input.messageId, 'Message-ID')
        : `<${crypto.randomUUID()}@${messageIdDomain(from)}>`;
    const date = input.date || new Date();
    const text = input.text ?? input.body ?? '';
    const html = input.html ?? '';
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(input.headers || {})) {
        const cleanKey = boundedHeader(key, 'Header name', 100);
        if (!/^[A-Za-z0-9-]+$/.test(cleanKey)) throw new OutboundMessageValidationError('Header name is invalid');
        headers[cleanKey] = boundedHeader(value, cleanKey, 8_192);
    }
    const composerOptions = {
        from: { name: input.sender.name || '', address: from },
        to: addressInputText(input.to),
        cc: addressInputText(input.cc),
        bcc: addressInputText(input.bcc),
        replyTo: replyToAddresses.length > 0 ? addressInputText(input.replyTo) : undefined,
        subject,
        text,
        html: html || undefined,
        inReplyTo: inReplyTo || undefined,
        references: references.length > 0 ? references.join(' ') : undefined,
        attachments: input.attachments || [],
        headers,
        messageId,
        date,
    };
    const buildRaw = async (keepBcc: boolean): Promise<Buffer> => {
        const message = new MailComposer({ ...composerOptions, keepBcc }).compile();
        // MailComposer does not forward its `keepBcc` data option to the root
        // MimeNode. Local Draft/Sent storage needs the header while SMTP MIME
        // must continue to omit it.
        message.keepBcc = keepBcc;
        return message.build();
    };
    const raw = await buildRaw(input.keepBcc === true);
    const sentRaw = input.keepBcc === true || bccAddresses.length === 0
        ? raw
        : await buildRaw(true);
    return {
        raw,
        sentRaw,
        envelope: { from, to: envelopeRecipients },
        messageId,
        date,
        metadata: {
            from,
            to: addressInputText(input.to),
            cc: addressInputText(input.cc),
            bcc: addressInputText(input.bcc),
            replyTo: addressInputText(input.replyTo),
            subject,
            text,
            html,
            inReplyTo,
            references,
        },
    };
};
