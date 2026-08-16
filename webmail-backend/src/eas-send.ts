import { simpleParser } from 'mailparser';
import { createHash } from 'crypto';
import { normalizeMailboxAddress } from './outbound-mail';

type ParsedAddressValue = { address?: string | false | null };
type ParsedAddressList = { value?: ParsedAddressValue[] } | null | undefined;
type ActiveSyncNode = {
    tag?: string;
    page?: number;
    content?: Buffer | string | { toString?: () => string } | null;
    children?: ActiveSyncNode[];
};

export type ActiveSyncSendMailStatus = '101' | '102' | '107' | '108' | '116' | '118' | '119' | '120' | '166';

export class ActiveSyncSendMailRequestError extends Error {
    constructor(
        message: string,
        readonly status: ActiveSyncSendMailStatus,
    ) {
        super(message);
        this.name = 'ActiveSyncSendMailRequestError';
    }
}

export interface ParsedActiveSyncSendMailRequest {
    clientId: string;
    mime: Buffer;
    saveInSentItems: boolean;
    accountId: string | null;
}

export interface PreparedActiveSyncSendMailSubmission {
    raw: Buffer;
    sentRaw: Buffer;
    envelope: { from: string; to: string[] };
    messageId: string;
    metadata: Record<string, any>;
    fingerprintSource: Record<string, any>;
}

const collectAddresses = (list: ParsedAddressList): string[] => {
    return (list?.value || [])
        .map((entry) => String(entry.address || '').trim())
        .filter(Boolean);
};

const normalizeAddresses = (list: ParsedAddressList): string[] => {
    const unique = new Set<string>();
    for (const address of collectAddresses(list)) {
        const normalized = normalizeMailboxAddress(address);
        if (normalized) unique.add(normalized);
    }
    return [...unique];
};

const contentToText = (content: ActiveSyncNode['content']): string => {
    if (!content) return '';
    if (Buffer.isBuffer(content)) {
        return content.toString('utf8', 0, Math.min(content.length, 8192));
    }
    return String(content).slice(0, 8192);
};

const contentByteLength = (content: ActiveSyncNode['content']): number => {
    if (!content) return 0;
    if (Buffer.isBuffer(content)) return content.length;
    return Buffer.byteLength(String(content), 'utf8');
};

export const isLikelyRawMime = (content: ActiveSyncNode['content']): boolean => {
    const text = contentToText(content);
    if (!text.trim()) return false;

    const headerBlock = text.split(/\r?\n\r?\n/, 1)[0] || text;
    const headerMatches = headerBlock.match(/(?:^|\r?\n)(From|To|Cc|Bcc|Subject|Date|Message-Id|MIME-Version|Content-Type|Content-Transfer-Encoding):/gi) || [];
    return headerMatches.length >= 2;
};

export const extractActiveSyncSendMailMime = (decoded: ActiveSyncNode): Buffer | string => {
    const candidates: Array<{ content: Buffer | string; tag?: string }> = [];

    const visit = (node: ActiveSyncNode | null | undefined) => {
        if (!node) return;
        if (node.content && isLikelyRawMime(node.content)) {
            candidates.push({
                content: Buffer.isBuffer(node.content) ? node.content : String(node.content),
                tag: node.tag,
            });
        }
        for (const child of node.children || []) {
            visit(child);
        }
    };

    visit(decoded);

    const mimeNode = candidates.find((candidate) => candidate.tag === 'Mime');
    return mimeNode?.content || candidates[0]?.content || '';
};

export const parseActiveSyncSendMailRequest = (
    decoded: ActiveSyncNode | null | undefined,
): ParsedActiveSyncSendMailRequest => {
    if (!decoded || decoded.tag !== 'SendMail' || decoded.page !== 21) {
        throw new ActiveSyncSendMailRequestError('ActiveSync SendMail content is invalid', '101');
    }
    const children = decoded.children || [];
    const allowedTags = new Set(['ClientId', 'AccountId', 'SaveInSentItems', 'Mime']);
    if (decoded.content !== undefined || children.some(node => node.page !== 21 || !allowedTags.has(String(node.tag)))) {
        throw new ActiveSyncSendMailRequestError('ActiveSync SendMail contains an unsupported element', '101');
    }
    for (const tag of allowedTags) {
        if (children.filter(node => node.tag === tag).length > 1) {
            throw new ActiveSyncSendMailRequestError(`ActiveSync SendMail contains duplicate ${tag}`, '101');
        }
    }
    const clientNodes = children.filter(node => node.page === 21 && node.tag === 'ClientId');
    if (clientNodes.length !== 1 || typeof clientNodes[0].content !== 'string'
        || (clientNodes[0].children?.length || 0) > 0) {
        throw new ActiveSyncSendMailRequestError('ActiveSync SendMail ClientId is required', '101');
    }
    const clientId = clientNodes[0].content;
    if (Array.from(clientId).length < 1 || Array.from(clientId).length > 40) {
        throw new ActiveSyncSendMailRequestError('ActiveSync SendMail ClientId is invalid', '101');
    }

    const saveNodes = children.filter(node => node.page === 21 && node.tag === 'SaveInSentItems');
    if (saveNodes.length > 1 || saveNodes.some(node => node.content !== undefined || (node.children?.length || 0) > 0)) {
        throw new ActiveSyncSendMailRequestError('ActiveSync SaveInSentItems is invalid', '101');
    }
    const accountNodes = children.filter(node => node.page === 21 && node.tag === 'AccountId');
    if (accountNodes.some(node => typeof node.content !== 'string'
        || node.content.length === 0 || node.content.length > 256
        || /[\r\n\0]/.test(node.content) || (node.children?.length || 0) > 0)) {
        throw new ActiveSyncSendMailRequestError('ActiveSync SendMail AccountId is invalid', '101');
    }

    const mimeNodes = children.filter(node => node.page === 21 && node.tag === 'Mime');
    if (mimeNodes.length !== 1 || (mimeNodes[0].children?.length || 0) > 0) {
        throw new ActiveSyncSendMailRequestError('ActiveSync SendMail MIME is required', '107');
    }
    const mime = mimeNodes[0].content;
    if (!Buffer.isBuffer(mime) || !isLikelyRawMime(mime)) {
        throw new ActiveSyncSendMailRequestError('ActiveSync SendMail MIME is invalid', '107');
    }

    return {
        clientId,
        mime,
        saveInSentItems: saveNodes.length === 1,
        accountId: accountNodes.length === 1 ? accountNodes[0].content as string : null,
    };
};

const activeSyncSendMailScopeHash = (authenticatedUser: string, deviceId: string, clientId: string): string => (
    createHash('sha256')
        .update(authenticatedUser.trim().toLowerCase())
        .update('\0')
        .update(deviceId)
        .update('\0')
        .update(clientId)
        .digest('hex')
);

export const activeSyncSendMailIdempotencyKey = (
    authenticatedUser: string,
    deviceId: string,
    clientId: string,
): string => `eas:${activeSyncSendMailScopeHash(authenticatedUser, deviceId, clientId)}`;

type MimeBoundary = { index: number; length: number; lineBreak: '\r\n' | '\n' };

const findMimeBoundary = (raw: Buffer): MimeBoundary | null => {
    const crlf = raw.indexOf(Buffer.from('\r\n\r\n'));
    const lf = raw.indexOf(Buffer.from('\n\n'));
    if (crlf < 0 && lf < 0) return null;
    if (crlf >= 0 && (lf < 0 || crlf < lf)) return { index: crlf, length: 4, lineBreak: '\r\n' };
    return { index: lf, length: 2, lineBreak: '\n' };
};

const mimeHeaderFieldCount = (raw: Buffer, field: string): number => {
    const boundary = findMimeBoundary(raw);
    if (!boundary) return 0;
    const header = raw.subarray(0, boundary.index).toString('latin1');
    const lines = header.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) || [];
    const prefix = `${field.toLowerCase()}:`;
    return lines.reduce((count, line) => {
        const value = line.replace(/(?:\r\n|\n|\r)$/, '');
        return count + (!/^[ \t]/.test(value) && value.toLowerCase().startsWith(prefix) ? 1 : 0);
    }, 0);
};

const addMessageIdHeader = (raw: Buffer, messageId: string): Buffer => {
    const boundary = findMimeBoundary(raw);
    if (!boundary || boundary.index === 0) {
        throw new ActiveSyncSendMailRequestError('ActiveSync SendMail MIME headers are invalid', '107');
    }
    return Buffer.concat([
        raw.subarray(0, boundary.index),
        Buffer.from(`${boundary.lineBreak}Message-ID: ${messageId}`, 'ascii'),
        raw.subarray(boundary.index),
    ]);
};

const stripDeliveryBccHeader = (raw: Buffer): Buffer => {
    const boundary = findMimeBoundary(raw);
    if (!boundary || boundary.index === 0) {
        throw new ActiveSyncSendMailRequestError('ActiveSync SendMail MIME headers are invalid', '107');
    }
    const header = raw.subarray(0, boundary.index).toString('latin1');
    const lines = header.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) || [];
    let droppingBcc = false;
    const kept: string[] = [];
    for (const line of lines) {
        const value = line.replace(/(?:\r\n|\n|\r)$/, '');
        const continuation = /^[ \t]/.test(value);
        if (!continuation) droppingBcc = /^(?:bcc|resent-bcc):/i.test(value);
        if (!droppingBcc) kept.push(line);
    }
    return Buffer.concat([
        Buffer.from(kept.join(''), 'latin1'),
        raw.subarray(boundary.index),
    ]);
};

const deterministicMessageId = (authenticatedUser: string, deviceId: string, clientId: string): string => {
    const rawDomain = authenticatedUser.slice(authenticatedUser.lastIndexOf('@') + 1).toLowerCase();
    const domain = /^[a-z0-9.-]+$/.test(rawDomain) ? rawDomain : 'openmailstack.local';
    return `<eas-${activeSyncSendMailScopeHash(authenticatedUser, deviceId, clientId)}@${domain}>`;
};

export const prepareActiveSyncSendMailSubmission = async (
    rawMime: Buffer | string,
    authenticatedUser: string,
    deviceId: string,
    clientId: string,
): Promise<PreparedActiveSyncSendMailSubmission> => {
    const original = Buffer.isBuffer(rawMime) ? Buffer.from(rawMime) : Buffer.from(rawMime, 'utf8');
    if (!findMimeBoundary(original) || mimeHeaderFieldCount(original, 'from') !== 1) {
        throw new ActiveSyncSendMailRequestError('ActiveSync SendMail MIME headers are invalid', '107');
    }

    let parsed: Awaited<ReturnType<typeof simpleParser>>;
    try {
        parsed = await simpleParser(original);
    } catch {
        throw new ActiveSyncSendMailRequestError('ActiveSync SendMail MIME is invalid', '107');
    }
    const parsedFrom = collectAddresses(parsed.from as ParsedAddressList);
    const from = parsedFrom.length === 1 ? normalizeMailboxAddress(parsedFrom[0]) : null;
    if (!from) {
        throw new ActiveSyncSendMailRequestError('ActiveSync SendMail MIME must contain exactly one From address', '107');
    }
    const to = normalizeAddresses(parsed.to as ParsedAddressList);
    const cc = normalizeAddresses(parsed.cc as ParsedAddressList);
    const bcc = normalizeAddresses(parsed.bcc as ParsedAddressList);
    const recipients = [...new Set([...to, ...cc, ...bcc])];
    if (recipients.length === 0) {
        throw new ActiveSyncSendMailRequestError('ActiveSync SendMail MIME has no recipients', '119');
    }

    let messageId = String(parsed.messageId || '').trim();
    if (/\r|\n|\0/.test(messageId) || messageId.length > 998) {
        throw new ActiveSyncSendMailRequestError('ActiveSync SendMail Message-ID is invalid', '107');
    }
    if (!messageId) messageId = deterministicMessageId(authenticatedUser, deviceId, clientId);
    const sentRaw = String(parsed.messageId || '').trim() ? original : addMessageIdHeader(original, messageId);
    const raw = stripDeliveryBccHeader(sentRaw);
    const references = Array.isArray(parsed.references)
        ? parsed.references.map(String)
        : parsed.references ? [String(parsed.references)] : [];
    const attachments = (parsed.attachments || []).map(attachment => ({
        filename: String(attachment.filename || ''),
        contentType: String(attachment.contentType || ''),
        content: Buffer.from(attachment.content),
    }));
    const text = String(parsed.text || '');
    const html = typeof parsed.html === 'string' ? parsed.html : '';
    const inReplyTo = String(parsed.inReplyTo || '');
    const subject = String(parsed.subject || '');
    const metadata = {
        from,
        to: to.join(', '),
        cc: cc.join(', '),
        bcc: bcc.join(', '),
        replyTo: normalizeAddresses(parsed.replyTo as ParsedAddressList).join(', '),
        subject,
        text,
        html,
        inReplyTo,
        references,
    };

    return {
        raw,
        sentRaw,
        envelope: { from, to: recipients },
        messageId,
        metadata,
        fingerprintSource: {
            command: 'SendMail',
            from,
            to,
            cc,
            bcc,
            subject,
            text,
            html,
            inReplyTo,
            references,
            attachments,
            mime: sentRaw,
        },
    };
};

export const activeSyncSendMailResultStatus = (result: {
    replayed: boolean;
    status: string;
    smtpAccepted: boolean;
    rejectedRecipients: string[];
}): ActiveSyncSendMailStatus | null => {
    const queued = ['scheduled', 'retry_wait', 'claimed', 'smtp_inflight'].includes(result.status);
    if (result.replayed) return result.smtpAccepted || queued ? '118' : '120';
    if (queued) return null;
    if (result.smtpAccepted && (result.status === 'partial_delivery' || result.rejectedRecipients.length > 0)) {
        return '116';
    }
    return result.smtpAccepted ? null : '120';
};

export const summarizeActiveSyncNodeForLog = (node: ActiveSyncNode): Record<string, unknown> => {
    const summary: Record<string, unknown> = {
        tag: node.tag,
        page: node.page,
    };

    if (node.content) {
        summary.contentType = Buffer.isBuffer(node.content) ? 'buffer' : typeof node.content;
        summary.contentBytes = contentByteLength(node.content);
    }

    if (node.children && node.children.length > 0) {
        summary.children = node.children.map((child) => summarizeActiveSyncNodeForLog(child));
    }

    return summary;
};

export const buildActiveSyncSendMailEnvelope = async (rawMime: Buffer | string, authenticatedUser: string) => {
    const parsed = await simpleParser(rawMime);
    const recipients = [
        ...collectAddresses(parsed.to as ParsedAddressList),
        ...collectAddresses(parsed.cc as ParsedAddressList),
        ...collectAddresses(parsed.bcc as ParsedAddressList),
    ];
    const uniqueRecipients = Array.from(new Set(recipients.map((address) => address.toLowerCase())));

    if (uniqueRecipients.length === 0) {
        throw new Error('ActiveSync SendMail MIME has no recipients');
    }

    return {
        from: authenticatedUser,
        to: uniqueRecipients,
    };
};
