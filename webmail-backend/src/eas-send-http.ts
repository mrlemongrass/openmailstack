import type { IncomingMessage, ServerResponse } from 'http';
import {
    ActiveSyncSendMailRequestError,
    activeSyncSendMailIdempotencyKey,
    activeSyncSendMailResultStatus,
    parseActiveSyncSendMailRequest,
    prepareActiveSyncSendMailSubmission,
    type ActiveSyncSendMailStatus,
} from './eas-send';
import {
    ACTIVE_SYNC_MAX_REQUEST_BYTES,
    activeSyncRequestLogSummary,
    type ActiveSyncLogSummary,
} from './eas-protocol';
import type { OutboundSubmissionInput, OutboundSubmissionResult } from './scheduled-send';
import { WbxmlParser } from './wbxml/parser';
import { WbxmlWriter } from './wbxml/writer';

type ActiveSyncHttpRequest = IncomingMessage & { body?: unknown };

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
    authorizeSender(username: string, requestedFrom: string): Promise<{ address: string; name?: string }>;
    submit(input: ActiveSyncSendMailSubmission): Promise<OutboundSubmissionResult>;
    logRequest?(summary: ActiveSyncLogSummary): void;
    now?(): Date;
}

export type ActiveSyncSendMailHttpHandler = (
    request: ActiveSyncHttpRequest,
    response: ServerResponse,
) => Promise<boolean>;

const commandFromRequest = (request: IncomingMessage): string => {
    try {
        return new URL(request.url || '/', 'http://127.0.0.1').searchParams.get('Cmd') || '';
    } catch {
        return '';
    }
};

const queryValue = (request: IncomingMessage, name: string): string | null => {
    try {
        return new URL(request.url || '/', 'http://127.0.0.1').searchParams.get(name);
    } catch {
        return null;
    }
};

const basicCredentials = (
    authorization: string | string[] | undefined,
    normalizeUsername: (value: string) => string,
): { username: string; password: string } | null => {
    if (typeof authorization !== 'string') return null;
    const match = authorization.match(/^Basic ([A-Za-z0-9+/]+={0,2})$/);
    if (!match || match[1].length % 4 !== 0) return null;
    const decoded = Buffer.from(match[1], 'base64');
    if (decoded.toString('base64') !== match[1]) return null;
    const value = decoded.toString('utf8');
    const separator = value.indexOf(':');
    if (separator < 1 || value.includes('\0')) return null;
    let username = '';
    try {
        username = normalizeUsername(value.slice(0, separator));
    } catch {
        return null;
    }
    if (!username) return null;
    return { username, password: value.slice(separator + 1) };
};

const readRequestBody = async (request: ActiveSyncHttpRequest): Promise<Buffer | null> => {
    if (Buffer.isBuffer(request.body)) {
        return request.body.length <= ACTIVE_SYNC_MAX_REQUEST_BYTES ? request.body : null;
    }
    const declaredLength = Number(request.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > ACTIVE_SYNC_MAX_REQUEST_BYTES) return null;

    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > ACTIVE_SYNC_MAX_REQUEST_BYTES) return null;
        chunks.push(buffer);
    }
    return Buffer.concat(chunks);
};

const sendEmpty = (response: ServerResponse, statusCode: number): void => {
    response.statusCode = statusCode;
    response.end();
};

const sendComposeStatus = (response: ServerResponse, status: ActiveSyncSendMailStatus): void => {
    const writer = new WbxmlWriter();
    writer.writeNode({
        tag: 'SendMail',
        page: 21,
        children: [{ tag: 'Status', page: 21, content: status }],
    });
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/vnd.ms-sync.wbxml');
    response.end(writer.getBuffer());
};

const errorCode = (error: unknown): string => (
    error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code || '')
        : ''
);

export const createActiveSyncSendMailHttpHandler = (
    dependencies: ActiveSyncSendMailHttpDependencies,
): ActiveSyncSendMailHttpHandler => async (request, response) => {
    if (commandFromRequest(request) !== 'SendMail') return false;

    const body = await readRequestBody(request);
    if (!body) {
        sendEmpty(response, 413);
        return true;
    }

    const credentials = basicCredentials(request.headers.authorization, dependencies.normalizeUsername);
    if (!credentials) {
        sendEmpty(response, 401);
        return true;
    }
    try {
        if (!await dependencies.authenticate(credentials.username, credentials.password)) {
            sendEmpty(response, 401);
            return true;
        }
    } catch (error) {
        sendEmpty(response, dependencies.isAuthenticationFailure?.(error) ? 401 : 503);
        return true;
    }

    let decoded: any;
    try {
        decoded = body.length > 0 ? new WbxmlParser(body).parse() : null;
    } catch {
        dependencies.logRequest?.(activeSyncRequestLogSummary(
            request.method,
            'SendMail',
            body.length,
            null,
            true,
        ));
        sendComposeStatus(response, '102');
        return true;
    }
    dependencies.logRequest?.(activeSyncRequestLogSummary(
        request.method,
        'SendMail',
        body.length,
        decoded,
        false,
    ));

    const deviceId = dependencies.validateDeviceId(queryValue(request, 'DeviceId'));
    if (!deviceId) {
        sendComposeStatus(response, '108');
        return true;
    }

    let parsedRequest;
    try {
        parsedRequest = parseActiveSyncSendMailRequest(decoded);
    } catch (error) {
        sendComposeStatus(response, error instanceof ActiveSyncSendMailRequestError ? error.status : '101');
        return true;
    }
    if (parsedRequest.accountId) {
        sendComposeStatus(response, '166');
        return true;
    }

    let prepared;
    try {
        prepared = await prepareActiveSyncSendMailSubmission(
            parsedRequest.mime,
            credentials.username,
            deviceId,
            parsedRequest.clientId,
        );
    } catch (error) {
        sendComposeStatus(response, error instanceof ActiveSyncSendMailRequestError ? error.status : '107');
        return true;
    }

    try {
        if (dependencies.submissionAvailable && !dependencies.submissionAvailable()) {
            sendComposeStatus(response, '120');
            return true;
        }
    } catch {
        sendComposeStatus(response, '120');
        return true;
    }

    let sender;
    try {
        sender = await dependencies.authorizeSender(credentials.username, prepared.envelope.from);
    } catch {
        sendComposeStatus(response, '120');
        return true;
    }

    try {
        const submission = await dependencies.submit({
            origin: 'activesync',
            submissionKind: 'immediate',
            idempotencyKey: activeSyncSendMailIdempotencyKey(
                credentials.username,
                deviceId,
                parsedRequest.clientId,
            ),
            fingerprintSource: {
                ...prepared.fingerprintSource,
                saveSentCopy: parsedRequest.saveInSentItems,
            },
            message: {
                username: credentials.username,
                sendAt: (dependencies.now || (() => new Date()))(),
                senderAddress: sender.address,
                messageId: prepared.messageId,
                envelope: { ...prepared.envelope, from: sender.address },
                raw: prepared.raw,
                sentRaw: prepared.sentRaw,
                metadata: prepared.metadata,
                saveSentCopy: parsedRequest.saveInSentItems,
            },
            requestCredential: credentials.password,
        });
        const status = activeSyncSendMailResultStatus(submission);
        if (status) sendComposeStatus(response, status);
        else sendEmpty(response, 200);
    } catch (error) {
        if (errorCode(error) === 'OUTBOUND_IDEMPOTENCY_CONFLICT') sendComposeStatus(response, '118');
        else sendComposeStatus(response, '120');
    }
    return true;
};
