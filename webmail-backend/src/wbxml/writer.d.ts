export declare function getTagToken(page: number, tagName: string): number | null;
export declare class WbxmlWriter {
    private chunks;
    private pendingBytes;
    private currentPage;
    constructor();
    private pushBytes;
    private flushPendingBytes;
    private pushBuffer;
    private writeMbU32;
    private writeStringInline;
    private writeOpaque;
    writeNode(node: any): void;
    getBuffer(): Buffer;
}
//# sourceMappingURL=writer.d.ts.map