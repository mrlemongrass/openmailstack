import { ImapService } from './imap';
/** Get or create a connected IMAP service for the given user. */
export declare function getImapConnection(user: string, pass: string): Promise<ImapService>;
/** Run selected-mailbox work on a short-lived client that cannot race the shared pool. */
export declare function withDedicatedImapConnection<T>(user: string, pass: string, operation: (imap: ImapService) => Promise<T>): Promise<T>;
/** Release a connection back to the pool (renews idle timer). */
export declare function releaseConnection(user: string, pass: string): void;
/** Force-close all pooled connections (for shutdown). */
export declare function closeAllConnections(): Promise<void>;
//# sourceMappingURL=imap-pool.d.ts.map