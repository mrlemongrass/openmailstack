export interface WbxmlNode {
    tag: string;
    page: number;
    children: WbxmlNode[];
    content?: string | Buffer;
}
export declare class WbxmlParser {
    private buffer;
    private pos;
    private currentPage;
    version: number;
    publicId: number;
    charset: number;
    stringTable: Buffer;
    constructor(buffer: Buffer);
    private readByte;
    private readMbU32;
    private readStringInline;
    private readOpaque;
    parse(): WbxmlNode | null;
    private parseElement;
}
//# sourceMappingURL=parser.d.ts.map