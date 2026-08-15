import { CODEPAGES } from './codepages';

export function getTagToken(page: number, tagName: string): number | null {
    const pageTags = CODEPAGES[page];
    if (!pageTags) return null;
    
    for (const [tokenStr, name] of Object.entries(pageTags)) {
        if (name === tagName) {
            return parseInt(tokenStr, 10);
        }
    }
    return null;
}

export class WbxmlWriter {
    private chunks: Buffer[] = [];
    private pendingBytes: number[] = [];
    private currentPage: number = 0;

    constructor() {
        // Default Header for ActiveSync WBXML 1.3
        this.pushBytes(0x03, 0x01, 0x6a, 0x00);
    }

    private pushBytes(...bytes: number[]): void {
        this.pendingBytes.push(...bytes);
        if (this.pendingBytes.length >= 4096) this.flushPendingBytes();
    }

    private flushPendingBytes(): void {
        if (this.pendingBytes.length === 0) return;
        this.chunks.push(Buffer.from(this.pendingBytes));
        this.pendingBytes = [];
    }

    private pushBuffer(data: Buffer): void {
        if (data.length === 0) return;
        this.flushPendingBytes();
        this.chunks.push(data);
    }

    private writeMbU32(val: number): void {
        const buf: number[] = [];
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

    private writeStringInline(str: string): void {
        if (str.includes('\0')) throw new Error('WBXML inline strings cannot contain NUL');
        this.pushBytes(0x03); // STR_I
        const strBuffer = Buffer.from(str, 'utf8');
        this.pushBuffer(strBuffer);
        this.pushBytes(0x00); // Null terminator
    }

    private writeOpaque(data: Buffer): void {
        this.pushBytes(0xC3); // OPAQUE
        this.writeMbU32(data.length);
        this.pushBuffer(data);
    }

    public writeNode(node: any): void {
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
        if (hasContent) token |= 0x40;
        if (hasAttributes) token |= 0x80;

        this.pushBytes(token);

        if (hasAttributes) {
            // EAS rarely uses this, skipped for now to keep it simple, just write END
            this.pushBytes(0x01);
        }

        if (hasContent) {
            if (node.content !== undefined) {
                if (Buffer.isBuffer(node.content)) {
                    this.writeOpaque(node.content);
                } else if (typeof node.content === 'string') {
                    this.writeStringInline(node.content);
                } else {
                    throw new Error('WBXML node content must be a string or Buffer');
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

    public getBuffer(): Buffer {
        this.flushPendingBytes();
        return Buffer.concat(this.chunks);
    }
}
