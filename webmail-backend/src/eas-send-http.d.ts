import type { IncomingMessage, ServerResponse } from 'http';
import { type ActiveSyncLogSummary } from './eas-protocol';
import type { OutboundSubmissionInput, OutboundSubmissionResult } from './scheduled-send';
type ActiveSyncHttpRequest = IncomingMessage & {
    body?: unknown;
};
export type ActiveSyncSendMailSubmission = OutboundSubmissionInput & {
    origin: 'activesync';
    submissionKind: 'immediate';
};
export interface ActiveSyncSendMailHttpDependencies {
    normalizeUsername(value: string): string;
    validateDeviceId(value: unknown): string | null;
    authenticate(username: string, password: string): Promise<boolean>;
    isAuthenticationFailure?(error: unknown): boolean;
    submissionAvailable?(): boolean;
    authorizeSender(username: string, requestedFrom: string): Promise<{
        address: string;
        name?: string;
    }>;
    submit(input: ActiveSyncSendMailSubmission): Promise<OutboundSubmissionResult>;
    logRequest?(summary: ActiveSyncLogSummary): void;
    now?(): Date;
}
export type ActiveSyncSendMailHttpHandler = (request: ActiveSyncHttpRequest, response: ServerResponse) => Promise<boolean>;
export declare const createActiveSyncSendMailHttpHandler: (dependencies: ActiveSyncSendMailHttpDependencies) => ActiveSyncSendMailHttpHandler;
export {};
//# sourceMappingURL=eas-send-http.d.ts.map