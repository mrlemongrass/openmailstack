export declare function ensureMailImportSchema(): Promise<void>;
export declare const importRoot = "/var/lib/openmailstack/mail-import";
export interface ImportMessage {
    source: Buffer;
    hash: string;
    subject: string;
    date: string | null;
}
export declare function parseMailImport(source: Buffer, filename: string): Promise<ImportMessage[]>;
export declare function createMailImportRouter(withImap: <T>(owner: string, pass: string, work: (imap: any) => Promise<T>) => Promise<T>, root?: string): import("express-serve-static-core").Router;
//# sourceMappingURL=mail-import.d.ts.map