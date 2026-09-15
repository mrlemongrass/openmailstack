import { ImapService } from './imap';
import { withDedicatedImapConnection } from './imap-pool';
type Kind = 'junk' | 'trash';
type Options = {
    junk: number;
    trash: number;
};
type Snapshot = {
    kind: Kind;
    path: string;
    uidValidity: string;
    uids: number[];
    eligible: number[];
};
type Dedicated = typeof withDedicatedImapConnection;
export declare function ensureMailRetentionSchema(): Promise<void>;
export declare function retentionOptions(value: any): Options;
export declare function retentionSnapshot(owner: string, imap: ImapService, options: Options, observe: boolean, now?: Date): Promise<Snapshot[]>;
export declare function previewRetention(owner: string, password: string, raw: unknown, dedicated?: Dedicated): Promise<{
    options: Options;
    folders: {
        total: number;
        eligible: number;
        kind: Kind;
        path: string;
        uidValidity: string;
    }[];
    token: `${string}-${string}-${string}-${string}-${string}`;
}>;
export declare function enableRetention(owner: string, token: string, confirm: boolean): Promise<void>;
export declare function disableRetention(owner: string): Promise<void>;
export declare function runRetentionForOwner(owner: string, password: string, dedicated?: Dedicated, now?: Date): Promise<void>;
export declare function createRetentionRouter(): import("express-serve-static-core").Router;
export declare function runRetentionWorker(): Promise<void>;
export declare function startRetentionWorker(): void;
export {};
//# sourceMappingURL=mail-retention.d.ts.map