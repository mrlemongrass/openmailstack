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
    buffer = [];
    currentPage = 0;
    constructor() {
        // Default Header for ActiveSync WBXML 1.3
        this.buffer.push(0x03); // Version 1.3
        this.buffer.push(0x01); // Public ID 1
        this.buffer.push(0x6a); // Charset UTF-8
        this.buffer.push(0x00); // String Table Length 0
    }
    writeMbU32(val) {
        const buf = [];
        let temp = val;
        do {
            buf.unshift(temp & 0x7F);
            temp = temp >>> 7;
        } while (temp > 0);
        for (let i = 0; i < buf.length - 1; i++) {
            this.buffer.push(buf[i] | 0x80);
        }
        this.buffer.push(buf[buf.length - 1]);
    }
    writeStringInline(str) {
        this.buffer.push(0x03); // STR_I
        const strBuffer = Buffer.from(str, 'utf8');
        for (let i = 0; i < strBuffer.length; i++) {
            this.buffer.push(strBuffer[i]);
        }
        this.buffer.push(0x00); // Null terminator
    }
    writeOpaque(data) {
        this.buffer.push(0xC3); // OPAQUE
        this.writeMbU32(data.length);
        for (let i = 0; i < data.length; i++) {
            this.buffer.push(data[i]);
        }
    }
    writeNode(node) {
        if (node.page !== undefined && node.page !== this.currentPage) {
            this.buffer.push(0x00); // SWITCH_PAGE
            this.buffer.push(node.page);
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
        this.buffer.push(token);
        if (hasAttributes) {
            // EAS rarely uses this, skipped for now to keep it simple, just write END
            this.buffer.push(0x01);
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
            this.buffer.push(0x01); // END token for the node
        }
    }
    getBuffer() {
        return Buffer.from(this.buffer);
    }
}
exports.WbxmlWriter = WbxmlWriter;
//# sourceMappingURL=writer.js.map