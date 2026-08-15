"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WbxmlWriter = void 0;
exports.getTagToken = getTagToken;
const codepages_1 = require("./codepages");
function getTagToken(page, tagName) {
    const pageTags = codepages_1.CODEPAGES[page];
    if (!pageTags)
        return null;
    for (const [tokenStr, name] of Object.entries(pageTags)) {
        if (name === tagName) {
            return parseInt(tokenStr, 10);
        }
    }
    return null;
}
class WbxmlWriter {
    chunks = [];
    pendingBytes = [];
    currentPage = 0;
    constructor() {
        // Default Header for ActiveSync WBXML 1.3
        this.pushBytes(0x03, 0x01, 0x6a, 0x00);
    }
    pushBytes(...bytes) {
        this.pendingBytes.push(...bytes);
        if (this.pendingBytes.length >= 4096)
            this.flushPendingBytes();
    }
    flushPendingBytes() {
        if (this.pendingBytes.length === 0)
            return;
        this.chunks.push(Buffer.from(this.pendingBytes));
        this.pendingBytes = [];
    }
    pushBuffer(data) {
        if (data.length === 0)
            return;
        this.flushPendingBytes();
        this.chunks.push(data);
    }
    writeMbU32(val) {
        const buf = [];
        let temp = val;
        do {
            buf.unshift(temp & 0x7F);
            temp = temp >>> 7;
        } while (temp > 0);
        for (let i = 0; i < buf.length - 1; i++) {
            this.pushBytes(buf[i] | 0x80);
        }
        this.pushBytes(buf[buf.length - 1]);
    }
    writeStringInline(str) {
        this.pushBytes(0x03); // STR_I
        const strBuffer = Buffer.from(str, 'utf8');
        this.pushBuffer(strBuffer);
        this.pushBytes(0x00); // Null terminator
    }
    writeOpaque(data) {
        this.pushBytes(0xC3); // OPAQUE
        this.writeMbU32(data.length);
        this.pushBuffer(data);
    }
    writeNode(node) {
        if (node.page !== undefined && node.page !== this.currentPage) {
            this.pushBytes(0x00, node.page); // SWITCH_PAGE
            this.currentPage = node.page;
        }
        const tagToken = getTagToken(node.page !== undefined ? node.page : this.currentPage, node.tag);
        if (tagToken === null) {
            throw new Error(`Unknown tag ${node.tag} for page ${node.page}`);
        }
        const hasContent = (node.children && node.children.length > 0) || node.content !== undefined;
        const hasAttributes = node.attributes && Object.keys(node.attributes).length > 0;
        let token = tagToken;
        if (hasContent)
            token |= 0x40;
        if (hasAttributes)
            token |= 0x80;
        this.pushBytes(token);
        if (hasAttributes) {
            // EAS rarely uses this, skipped for now to keep it simple, just write END
            this.pushBytes(0x01);
        }
        if (hasContent) {
            if (node.content !== undefined) {
                if (Buffer.isBuffer(node.content)) {
                    this.writeOpaque(node.content);
                }
                else {
                    this.writeStringInline(node.content.toString());
                }
            }
            if (node.children) {
                for (const child of node.children) {
                    this.writeNode(child);
                }
            }
            this.pushBytes(0x01); // END token for the node
        }
    }
    getBuffer() {
        this.flushPendingBytes();
        return Buffer.concat(this.chunks);
    }
}
exports.WbxmlWriter = WbxmlWriter;
//# sourceMappingURL=writer.js.map