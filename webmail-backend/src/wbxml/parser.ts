import { getTagName } from './codepages';

export interface WbxmlNode {
    tag: string;
    page: number;
    children: WbxmlNode[];
    content?: string | Buffer;
}

export class WbxmlParser {
    private static readonly MAX_NESTING_DEPTH = 64;
    private static readonly MAX_ELEMENT_COUNT = 4096;
    private static readonly MAX_TOKEN_COUNT = 16384;
    private static readonly MAX_INLINE_CONTENT_BYTES = 16 * 1024 * 1024;
    private buffer: Buffer;
    private pos: number = 0;
    private currentPage: number = 0;
    private elementCount: number = 0;
    private tokenCount: number = 0;
    private inlineContentBytes: number = 0;
    
    // Header properties
    public version: number = 0;
    public publicId: number = 0;
    public charset: number = 0;
    public stringTable: Buffer = Buffer.alloc(0);

    constructor(buffer: Buffer) {
        this.buffer = buffer;
    }

    private readByte(): number {
        if (this.pos >= this.buffer.length) {
            throw new Error("Unexpected end of WBXML buffer");
        }
        return this.buffer[this.pos++];
    }

    private readTokenByte(): number {
        this.tokenCount += 1;
        if (this.tokenCount > WbxmlParser.MAX_TOKEN_COUNT) {
            throw new Error('WBXML token count exceeds limit');
        }
        return this.readByte();
    }

    private readMbU32(): number {
        let result = 0;
        let byte = 0;
        let byteCount = 0;
        do {
            byte = this.readByte();
            byteCount += 1;
            if (byteCount > 5) throw new Error('WBXML multi-byte integer exceeds limit');
            result = (result * 128) + (byte & 0x7f);
            if (!Number.isSafeInteger(result) || result > 0xFFFFFFFF) {
                throw new Error('WBXML multi-byte integer exceeds limit');
            }
        } while ((byte & 0x80) !== 0);
        return result;
    }

    private readStringInline(): string {
        const start = this.pos;
        while (this.readByte() !== 0x00) {}
        this.inlineContentBytes += this.pos - start - 1;
        if (this.inlineContentBytes > WbxmlParser.MAX_INLINE_CONTENT_BYTES) {
            throw new Error('WBXML inline content exceeds limit');
        }
        // -1 to exclude the null terminator
        return this.buffer.toString('utf8', start, this.pos - 1);
    }

    private readOpaque(): Buffer {
        const len = this.readMbU32();
        const start = this.pos;
        this.pos += len;
        if (this.pos > this.buffer.length) {
            throw new Error("Opaque data length exceeds buffer");
        }
        return this.buffer.subarray(start, this.pos);
    }

    public parse(): WbxmlNode | null {
        this.pos = 0;
        this.currentPage = 0;
        this.elementCount = 0;
        this.tokenCount = 0;
        this.inlineContentBytes = 0;
        // Parse Header
        this.version = this.readByte();
        this.publicId = this.readMbU32();
        if (this.publicId === 0) {
            this.readMbU32(); // Public ID string index
        }
        this.charset = this.readMbU32();
        
        const stringTableLen = this.readMbU32();
        if (stringTableLen > this.buffer.length - this.pos) {
            throw new Error('WBXML string table length exceeds buffer');
        }
        if (stringTableLen > 0) {
            this.stringTable = this.buffer.subarray(this.pos, this.pos + stringTableLen);
            this.pos += stringTableLen;
        }

        // Parse Body
        if (this.pos < this.buffer.length) {
            const root = this.parseElement(0);
            if (this.pos !== this.buffer.length) throw new Error('WBXML trailing data after root element');
            return root;
        }
        return null;
    }

    private parseElement(depth: number): WbxmlNode {
        if (depth > WbxmlParser.MAX_NESTING_DEPTH) {
            throw new Error('WBXML nesting depth exceeds limit');
        }
        this.elementCount += 1;
        if (this.elementCount > WbxmlParser.MAX_ELEMENT_COUNT) {
            throw new Error('WBXML element count exceeds limit');
        }
        let token = this.readTokenByte();

        // Handle page switches before the tag
        while (token === 0x00) { // SWITCH_PAGE
            this.currentPage = this.readTokenByte();
            token = this.readTokenByte();
        }

        const hasAttributes = (token & 0x80) !== 0;
        const hasContent = (token & 0x40) !== 0;
        const tagToken = token & 0x3F;

        const node: WbxmlNode = {
            tag: getTagName(this.currentPage, tagToken),
            page: this.currentPage,
            children: []
        };

        if (hasAttributes) {
            // ActiveSync rarely uses attributes in WBXML. Skipping full implementation for now.
            // A basic loop would consume tokens until END (0x01).
            let attrToken = this.readTokenByte();
            while (attrToken !== 0x01) {
                // skip for now, but in reality we'd parse ATTR_START and ATTR_VALUE
                attrToken = this.readTokenByte();
            }
        }

        if (hasContent) {
            let contentToken = this.readTokenByte();
            let contentParts: string[] = [];
            
            while (contentToken !== 0x01) { // END token
                if (contentToken === 0x00) {
                    this.currentPage = this.readTokenByte();
                } else if (contentToken === 0x03) { // STR_I
                    contentParts.push(this.readStringInline());
                } else if (contentToken === 0xC3) { // OPAQUE
                    const opaqueData = this.readOpaque();
                    // Sometimes opaque is just a string, sometimes binary. Store as buffer.
                    // If we already have children, this might be a complex node.
                    node.content = opaqueData; 
                } else {
                    // Must be a child element
                    // We need to push the byte back or re-evaluate.
                    // Since we already read it, let's step back and parse element
                    this.pos--;
                    const child = this.parseElement(depth + 1);
                    node.children.push(child);
                }
                contentToken = this.readTokenByte();
            }
            
            if (contentParts.length > 0) {
                node.content = contentParts.join('');
            }
        }

        return node;
    }
}
