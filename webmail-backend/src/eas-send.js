"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildActiveSyncSendMailEnvelope = exports.summarizeActiveSyncNodeForLog = exports.extractActiveSyncSendMailMime = exports.isLikelyRawMime = void 0;
const mailparser_1 = require("mailparser");
const collectAddresses = (list) => {
    return (list?.value || [])
        .map((entry) => String(entry.address || '').trim())
        .filter(Boolean);
};
const contentToText = (content) => {
    if (!content)
        return '';
    if (Buffer.isBuffer(content)) {
        return content.toString('utf8', 0, Math.min(content.length, 8192));
    }
    return String(content).slice(0, 8192);
};
const contentByteLength = (content) => {
    if (!content)
        return 0;
    if (Buffer.isBuffer(content))
        return content.length;
    return Buffer.byteLength(String(content), 'utf8');
};
const isLikelyRawMime = (content) => {
    const text = contentToText(content);
    if (!text.trim())
        return false;
    const headerBlock = text.split(/\r?\n\r?\n/, 1)[0] || text;
    const headerMatches = headerBlock.match(/(?:^|\r?\n)(From|To|Cc|Bcc|Subject|Date|Message-Id|MIME-Version|Content-Type|Content-Transfer-Encoding):/gi) || [];
    return headerMatches.length >= 2;
};
exports.isLikelyRawMime = isLikelyRawMime;
const extractActiveSyncSendMailMime = (decoded) => {
    const candidates = [];
    const visit = (node) => {
        if (!node)
            return;
        if (node.content && (0, exports.isLikelyRawMime)(node.content)) {
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
exports.extractActiveSyncSendMailMime = extractActiveSyncSendMailMime;
const summarizeActiveSyncNodeForLog = (node) => {
    const summary = {
        tag: node.tag,
        page: node.page,
    };
    if (node.content) {
        summary.contentType = Buffer.isBuffer(node.content) ? 'buffer' : typeof node.content;
        summary.contentBytes = contentByteLength(node.content);
    }
    if (node.children && node.children.length > 0) {
        summary.children = node.children.map((child) => (0, exports.summarizeActiveSyncNodeForLog)(child));
    }
    return summary;
};
exports.summarizeActiveSyncNodeForLog = summarizeActiveSyncNodeForLog;
const buildActiveSyncSendMailEnvelope = async (rawMime, authenticatedUser) => {
    const parsed = await (0, mailparser_1.simpleParser)(rawMime);
    const recipients = [
        ...collectAddresses(parsed.to),
        ...collectAddresses(parsed.cc),
        ...collectAddresses(parsed.bcc),
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
exports.buildActiveSyncSendMailEnvelope = buildActiveSyncSendMailEnvelope;
//# sourceMappingURL=eas-send.js.map