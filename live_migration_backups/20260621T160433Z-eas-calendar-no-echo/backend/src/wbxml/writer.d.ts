export declare function getTagToken(page: number, tagName: string): number | null;
export declare class WbxmlWriter {
    private buffer;
    private currentPage;
    constructor();
    private writeMbU32;
    private writeStringInline;
    private writeOpaque;
    writeNode(node: any): void;
    getBuffer(): Buffer;
}
//# sourceMappingURL=writer.d.ts.map