"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.compileOutboundMessage = exports.mailboxAddressFromHeader = exports.classifySmtpRecipientOutcome = exports.SmtpRecipientsRejectedError = exports.OutboundMessageValidationError = exports.authorizeOutboundSender = exports.listOwnedSenderIdentities = exports.normalizeMailboxAddress = exports.SenderAuthorizationError = void 0;
const crypto_1 = __importDefault(require("crypto"));
const MailComposer = require('nodemailer/lib/mail-composer');
const addressparser = require('nodemailer/lib/addressparser');
class SenderAuthorizationError extends Error {
    code = 'SENDER_NOT_AUTHORIZED';
    status = 403;
    constructor() {
        super('The selected From address is not an active identity for this mailbox');
        this.name = 'SenderAuthorizationError';
    }
}
exports.SenderAuthorizationError = SenderAuthorizationError;
const normalizeMailboxAddress = (value) => {
    if (typeof value !== 'string')
        return null;
    const address = value.trim().toLowerCase();
    if (!address || Buffer.byteLength(address, 'utf8') > 254 || /[\s\r\n\0]/.test(address))
        return null;
    const at = address.indexOf('@');
    if (at < 1 || at !== address.lastIndexOf('@') || at === address.length - 1)
        return null;
    if (address.slice(0, at) === '*')
        return null;
    if (address.startsWith('@') || address.endsWith('.') || address.includes('..'))
        return null;
    return address;
};
exports.normalizeMailboxAddress = normalizeMailboxAddress;
const aliasTargetsMailbox = (value, mailbox) => (typeof value === 'string'
    && value.split(',').some(target => (0, exports.normalizeMailboxAddress)(target) === mailbox));
const listOwnedSenderIdentities = async (db, username) => {
    const primary = (0, exports.normalizeMailboxAddress)(username);
    if (!primary)
        throw new SenderAuthorizationError();
    const [mailboxRows] = await db.query('SELECT name FROM mailbox WHERE username = ? LIMIT 1', [username]);
    const name = String(mailboxRows?.[0]?.name || '');
    const [aliasRows] = await db.query(`SELECT address, goto, active FROM alias
         WHERE active = 1 AND (goto = ? OR FIND_IN_SET(?, REPLACE(goto, ' ', '')) > 0)
         ORDER BY address`, [username, username]);
    const addresses = [primary];
    const seen = new Set(addresses);
    for (const row of aliasRows || []) {
        if (Number(row.active) !== 1 || !aliasTargetsMailbox(row.goto, primary))
            continue;
        const address = (0, exports.normalizeMailboxAddress)(row.address);
        if (!address || seen.has(address))
            continue;
        seen.add(address);
        addresses.push(address);
    }
    return { name, primary, addresses };
};
exports.listOwnedSenderIdentities = listOwnedSenderIdentities;
const authorizeOutboundSender = async (db, username, requestedFrom) => {
    const identities = await (0, exports.listOwnedSenderIdentities)(db, username);
    const requested = requestedFrom == null || String(requestedFrom).trim() === ''
        ? identities.primary
        : (0, exports.normalizeMailboxAddress)(requestedFrom);
    if (!requested || !identities.addresses.includes(requested))
        throw new SenderAuthorizationError();
    return { address: requested, name: identities.name };
};
exports.authorizeOutboundSender = authorizeOutboundSender;
class OutboundMessageValidationError extends Error {
    code = 'OUTBOUND_MESSAGE_INVALID';
    status = 400;
    constructor(message) {
        super(message);
        this.name = 'OutboundMessageValidationError';
    }
}
exports.OutboundMessageValidationError = OutboundMessageValidationError;
class SmtpRecipientsRejectedError extends Error {
    code = 'EENVELOPE';
    command = 'RCPT TO';
    constructor() {
        super('The SMTP server rejected every recipient');
        this.name = 'SmtpRecipientsRejectedError';
    }
}
exports.SmtpRecipientsRejectedError = SmtpRecipientsRejectedError;
const smtpResultAddress = (value) => {
    if (typeof value === 'string')
        return (0, exports.normalizeMailboxAddress)(value);
    if (value && typeof value === 'object' && 'address' in value) {
        return (0, exports.normalizeMailboxAddress)(value.address);
    }
    return null;
};
const classifySmtpRecipientOutcome = (info, requestedRecipients) => {
    const requestedByAddress = new Map();
    for (const recipient of requestedRecipients) {
        const normalized = (0, exports.normalizeMailboxAddress)(recipient);
        if (normalized && !requestedByAddress.has(normalized))
            requestedByAddress.set(normalized, recipient);
    }
    const requested = [...requestedByAddress.values()];
    const explicitRejected = Array.isArray(info?.rejected);
    const explicitAccepted = Array.isArray(info?.accepted);
    if (!explicitRejected && !explicitAccepted) {
        return { accepted: requested, rejected: [], partial: false };
    }
    const resultAddresses = (values) => {
        const seen = new Set();
        const result = [];
        for (const value of values) {
            const normalized = smtpResultAddress(value);
            const requestedValue = normalized ? requestedByAddress.get(normalized) : undefined;
            if (!normalized || !requestedValue || seen.has(normalized))
                continue;
            seen.add(normalized);
            result.push(requestedValue);
        }
        return result;
    };
    const rejected = resultAddresses(explicitRejected ? info.rejected : []);
    const rejectedSet = new Set(rejected.map(exports.normalizeMailboxAddress).filter(Boolean));
    const accepted = explicitAccepted
        ? resultAddresses(info.accepted)
        : requested.filter(recipient => !rejectedSet.has((0, exports.normalizeMailboxAddress)(recipient)));
    if (rejected.length > 0 && accepted.length === 0)
        throw new SmtpRecipientsRejectedError();
    return { accepted, rejected, partial: rejected.length > 0 };
};
exports.classifySmtpRecipientOutcome = classifySmtpRecipientOutcome;
const boundedHeader = (value, field, limit = 998) => {
    const text = value == null ? '' : String(value);
    if (/[\r\n\0]/.test(text) || text.length > limit) {
        throw new OutboundMessageValidationError(`${field} contains invalid header text`);
    }
    return text;
};
const addressInputText = (value) => (Array.isArray(value) ? value.join(', ') : String(value || ''));
const parsedAddresses = (value, field) => {
    const raw = addressInputText(value).trim();
    if (!raw)
        return [];
    if (/[\r\n\0]/.test(raw) || Buffer.byteLength(raw, 'utf8') > 16_384) {
        throw new OutboundMessageValidationError(`${field} contains invalid address text`);
    }
    const flattened = [];
    const visit = (items) => {
        for (const item of items || []) {
            if (Array.isArray(item.group))
                visit(item.group);
            else if (item.address) {
                const address = String(item.address).trim();
                if (!(0, exports.normalizeMailboxAddress)(address)) {
                    throw new OutboundMessageValidationError(`${field} contains an invalid address`);
                }
                flattened.push(address);
            }
        }
    };
    visit(addressparser(raw));
    if (flattened.length === 0)
        throw new OutboundMessageValidationError(`${field} contains no valid address`);
    return flattened;
};
const mailboxAddressFromHeader = (value) => {
    if (typeof value !== 'string' || /[\r\n\0]/.test(value))
        return null;
    try {
        const addresses = parsedAddresses(value, 'From');
        return addresses.length === 1 ? addresses[0] : null;
    }
    catch {
        return null;
    }
};
exports.mailboxAddressFromHeader = mailboxAddressFromHeader;
const normalizeMessageId = (value, field) => {
    const raw = boundedHeader(value, field, 998).trim();
    const inner = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw;
    if (!/^[^<>\s@]+@[^<>\s@]+$/.test(inner)) {
        throw new OutboundMessageValidationError(`${field} contains an invalid message identifier`);
    }
    return `<${inner}>`;
};
const normalizeReferences = (value) => {
    if (value == null || value === '')
        return [];
    const values = Array.isArray(value) ? value : (value.match(/<[^<>\s]+>/g) || value.split(/\s+/));
    const result = [];
    const seen = new Set();
    for (const item of values) {
        if (!String(item).trim())
            continue;
        const normalized = normalizeMessageId(item, 'References');
        if (!seen.has(normalized)) {
            seen.add(normalized);
            result.push(normalized);
        }
    }
    return result;
};
const messageIdDomain = (address) => address.slice(address.lastIndexOf('@') + 1) || 'openmailstack.local';
const compileOutboundMessage = async (input) => {
    const from = (0, exports.normalizeMailboxAddress)(input.sender.address);
    if (!from)
        throw new OutboundMessageValidationError('From contains an invalid address');
    const toAddresses = parsedAddresses(input.to, 'To');
    const ccAddresses = parsedAddresses(input.cc, 'Cc');
    const bccAddresses = parsedAddresses(input.bcc, 'Bcc');
    const envelopeRecipients = [];
    const seenRecipients = new Set();
    for (const address of [...toAddresses, ...ccAddresses, ...bccAddresses]) {
        const key = (0, exports.normalizeMailboxAddress)(address);
        if (seenRecipients.has(key))
            continue;
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
        : `<${crypto_1.default.randomUUID()}@${messageIdDomain(from)}>`;
    const date = input.date || new Date();
    const text = input.text ?? input.body ?? '';
    const html = input.html ?? '';
    const headers = {};
    for (const [key, value] of Object.entries(input.headers || {})) {
        const cleanKey = boundedHeader(key, 'Header name', 100);
        if (!/^[A-Za-z0-9-]+$/.test(cleanKey))
            throw new OutboundMessageValidationError('Header name is invalid');
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
    const buildRaw = async (keepBcc) => {
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
exports.compileOutboundMessage = compileOutboundMessage;
//# sourceMappingURL=outbound-mail.js.map