import { simpleParser } from 'mailparser';

type ParsedAddressValue = { address?: string | false | null };
type ParsedAddressList = { value?: ParsedAddressValue[] } | null | undefined;
type ActiveSyncNode = {
    tag?: string;
    page?: number;
    content?: Buffer | string | { toString?: () => string } | null;
    children?: ActiveSyncNode[];
};

const collectAddresses = (list: ParsedAddressList): string[] => {
    return (list?.value || [])
        .map((entry) => String(entry.address || '').trim())
        .filter(Boolean);
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
