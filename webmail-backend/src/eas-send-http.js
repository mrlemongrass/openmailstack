"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createActiveSyncSendMailHttpHandler = void 0;
const eas_send_1 = require("./eas-send");
const eas_protocol_1 = require("./eas-protocol");
const parser_1 = require("./wbxml/parser");
const writer_1 = require("./wbxml/writer");
const commandFromRequest = (request) => {
    try {
        return new URL(request.url || '/', 'http://127.0.0.1').searchParams.get('Cmd') || '';
    }
    catch {
        return '';
    }
};
const queryValue = (request, name) => {
    try {
        return new URL(request.url || '/', 'http://127.0.0.1').searchParams.get(name);
    }
    catch {
        return null;
    }
};
const basicCredentials = (authorization, normalizeUsername) => {
    if (typeof authorization !== 'string')
        return null;
    const match = authorization.match(/^Basic ([A-Za-z0-9+/]+={0,2})$/);
    if (!match || match[1].length % 4 !== 0)
        return null;
    const decoded = Buffer.from(match[1], 'base64');
    if (decoded.toString('base64') !== match[1])
        return null;
    const value = decoded.toString('utf8');
    const separator = value.indexOf(':');
    if (separator < 1 || value.includes('\0'))
        return null;
    let username = '';
    try {
        username = normalizeUsername(value.slice(0, separator));
    }
    catch {
        return null;
    }
    if (!username)
        return null;
    return { username, password: value.slice(separator + 1) };
};
const readRequestBody = async (request) => {
    if (Buffer.isBuffer(request.body)) {
        return request.body.length <= eas_protocol_1.ACTIVE_SYNC_MAX_REQUEST_BYTES ? request.body : null;
    }
    const declaredLength = Number(request.headers['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > eas_protocol_1.ACTIVE_SYNC_MAX_REQUEST_BYTES)
        return null;
    const chunks = [];
    let bytes = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > eas_protocol_1.ACTIVE_SYNC_MAX_REQUEST_BYTES)
            return null;
        chunks.push(buffer);
    }
    return Buffer.concat(chunks);
};
const sendEmpty = (response, statusCode) => {
    response.statusCode = statusCode;
    response.end();
};
const sendComposeStatus = (response, status) => {
    const writer = new writer_1.WbxmlWriter();
    writer.writeNode({
        tag: 'SendMail',
        page: 21,
        children: [{ tag: 'Status', page: 21, content: status }],
    });
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/vnd.ms-sync.wbxml');
    response.end(writer.getBuffer());
};
const errorCode = (error) => (error && typeof error === 'object' && 'code' in error
    ? String(error.code || '')
    : '');
const createActiveSyncSendMailHttpHandler = (dependencies) => async (request, response) => {
    if (commandFromRequest(request) !== 'SendMail')
        return false;
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
    }
    catch (error) {
        sendEmpty(response, dependencies.isAuthenticationFailure?.(error) ? 401 : 503);
        return true;
    }
    let decoded;
    try {
        decoded = body.length > 0 ? new parser_1.WbxmlParser(body).parse() : null;
    }
    catch {
        dependencies.logRequest?.((0, eas_protocol_1.activeSyncRequestLogSummary)(request.method, 'SendMail', body.length, null, true));
        sendComposeStatus(response, '102');
        return true;
    }
    dependencies.logRequest?.((0, eas_protocol_1.activeSyncRequestLogSummary)(request.method, 'SendMail', body.length, decoded, false));
    const deviceId = dependencies.validateDeviceId(queryValue(request, 'DeviceId'));
    if (!deviceId) {
        sendComposeStatus(response, '108');
        return true;
    }
    let parsedRequest;
    try {
        parsedRequest = (0, eas_send_1.parseActiveSyncSendMailRequest)(decoded);
    }
    catch (error) {
        sendComposeStatus(response, error instanceof eas_send_1.ActiveSyncSendMailRequestError ? error.status : '101');
        return true;
    }
    if (parsedRequest.accountId) {
        sendComposeStatus(response, '166');
        return true;
    }
    let prepared;
    try {
        prepared = await (0, eas_send_1.prepareActiveSyncSendMailSubmission)(parsedRequest.mime, credentials.username, deviceId, parsedRequest.clientId);
    }
    catch (error) {
        sendComposeStatus(response, error instanceof eas_send_1.ActiveSyncSendMailRequestError ? error.status : '107');
        return true;
    }
    try {
        if (dependencies.submissionAvailable && !dependencies.submissionAvailable()) {
            sendComposeStatus(response, '120');
            return true;
        }
    }
    catch {
        sendComposeStatus(response, '120');
        return true;
    }
    let sender;
    try {
        sender = await dependencies.authorizeSender(credentials.username, prepared.envelope.from);
    }
    catch {
        sendComposeStatus(response, '120');
        return true;
    }
    try {
        const submission = await dependencies.submit({
            origin: 'activesync',
            submissionKind: 'immediate',
            idempotencyKey: (0, eas_send_1.activeSyncSendMailIdempotencyKey)(credentials.username, deviceId, parsedRequest.clientId),
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
        const status = (0, eas_send_1.activeSyncSendMailResultStatus)(submission);
        if (status)
            sendComposeStatus(response, status);
        else
            sendEmpty(response, 200);
    }
    catch (error) {
        if (errorCode(error) === 'OUTBOUND_IDEMPOTENCY_CONFLICT')
            sendComposeStatus(response, '118');
        else
            sendComposeStatus(response, '120');
    }
    return true;
};
exports.createActiveSyncSendMailHttpHandler = createActiveSyncSendMailHttpHandler;
//# sourceMappingURL=eas-send-http.js.map