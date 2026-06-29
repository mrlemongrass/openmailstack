import { getTagName } from './codepages';

export interface WbxmlNode {
    tag: string;
    page: number;
    children: WbxmlNode[];
    content?: string | Buffer;
}

export class WbxmlParser {
    private buffer: Buffer;
    private pos: number = 0;
    private currentPage: number = 0;
    
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

    private readMbU32(): number {
        let result = 0;
        let byte;
        do {
            byte = this.readByte();
            result = (result << 7) | (byte & 0x7f);
        } while ((byte & 0x80) !== 0);
        return result;
    }

    private readStringInline(): string {
        const start = this.pos;
        while (this.readByte() !== 0x00) {}
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
        // Parse Header
        this.version = this.readByte();
        this.publicId = this.readMbU32();
        if (this.publicId === 0) {
            this.readMbU32(); // Public ID string index
        }
        this.charset = this.readMbU32();
        
        const stringTableLen = this.readMbU32();
        if (stringTableLen > 0) {
            this.stringTable = this.buffer.subarray(this.pos, this.pos + stringTableLen);
            this.pos += stringTableLen;
        }

        // Parse Body
        if (this.pos < this.buffer.length) {
            return this.parseElement();
        }
        return null;
    }

    private parseElement(): WbxmlNode {
        let token = this.readByte();

        // Handle page switches before the tag
        while (token === 0x00) { // SWITCH_PAGE
            this.currentPage = this.readByte();
            token = this.readByte();
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
            let attrToken = this.readByte();
            while (attrToken !== 0x01) {
                // skip for now, but in reality we'd parse ATTR_START and ATTR_VALUE
                attrToken = this.readByte();
            }
        }

        if (hasContent) {
            let contentToken = this.readByte();
            let contentParts: string[] = [];
            
            while (contentToken !== 0x01) { // END token
                if (contentToken === 0x00) {
                    this.currentPage = this.readByte();
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
                    const child = this.parseElement();
                    node.children.push(child);
                }
                contentToken = this.readByte();
            }
            
            if (contentParts.length > 0) {
                node.content = contentParts.join('');
            }
        }

        return node;
    }
}
