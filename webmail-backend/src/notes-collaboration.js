"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NoteCollaborationError = exports.NOTE_COLLABORATION_CAPABILITY_TTL_MS = exports.NOTES_SIGNALING_PATH = void 0;
exports.issueNoteCollaborationCapability = issueNoteCollaborationCapability;
exports.verifyNoteCollaborationCapability = verifyNoteCollaborationCapability;
exports.authorizeNoteCollaboration = authorizeNoteCollaboration;
exports.installNotesSignalingServer = installNotesSignalingServer;
const crypto_1 = __importDefault(require("crypto"));
const ws_1 = require("ws");
exports.NOTES_SIGNALING_PATH = '/notes-signal';
exports.NOTE_COLLABORATION_CAPABILITY_TTL_MS = 5 * 60 * 1000;
const MAX_SIGNALING_CONNECTIONS_PER_ROOM = 32;
const MAX_SIGNALING_MESSAGE_BYTES = 64 * 1024;
class NoteCollaborationError extends Error {
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
    }
}
exports.NoteCollaborationError = NoteCollaborationError;
const hmac = (secret, value) => (crypto_1.default.createHmac('sha256', secret).update(value).digest());
const ownerBinding = (secret, owner) => (hmac(secret, `notes-owner\0${owner}`).toString('base64url'));
const sessionBinding = (secret, sessionId) => (hmac(secret, `notes-session\0${sessionId}`).toString('base64url'));
const noteRoom = (secret, noteId) => (hmac(secret, `notes-room\0${noteId}`).toString('base64url'));
const safeEqualText = (left, right) => {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && crypto_1.default.timingSafeEqual(leftBuffer, rightBuffer);
};
function issueNoteCollaborationCapability({ noteId, owner, sessionId, secret, now = Date.now(), }) {
    const expiresAt = now + exports.NOTE_COLLABORATION_CAPABILITY_TTL_MS;
    const payload = {
        v: 1,
        r: noteRoom(secret, noteId),
        o: ownerBinding(secret, owner),
        s: sessionBinding(secret, sessionId),
        e: expiresAt,
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = hmac(secret, `notes-capability\0${encodedPayload}`).toString('base64url');
    return {
        room: payload.r,
        token: `${encodedPayload}.${signature}`,
        expiresAt,
    };
}
function verifyNoteCollaborationCapability({ token, owner, sessionId, secret, now = Date.now(), }) {
    const [encodedPayload, signature, extra] = token.split('.');
    if (!encodedPayload || !signature || extra !== undefined) {
        throw new NoteCollaborationError('Invalid collaboration capability', 401);
    }
    const expectedSignature = hmac(secret, `notes-capability\0${encodedPayload}`).toString('base64url');
    if (!safeEqualText(signature, expectedSignature)) {
        throw new NoteCollaborationError('Invalid collaboration capability', 401);
    }
    let payload;
    try {
        payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    }
    catch {
        throw new NoteCollaborationError('Invalid collaboration capability', 401);
    }
    if (payload?.v !== 1
        || typeof payload.r !== 'string'
        || payload.r.length !== 43
        || typeof payload.o !== 'string'
        || typeof payload.s !== 'string'
        || typeof payload.e !== 'number'
        || !Number.isSafeInteger(payload.e)) {
        throw new NoteCollaborationError('Invalid collaboration capability', 401);
    }
    if (now >= payload.e) {
        throw new NoteCollaborationError('Collaboration capability expired', 401);
    }
    if (!safeEqualText(payload.o, ownerBinding(secret, owner))) {
        throw new NoteCollaborationError('Not authorized for this collaboration room', 401);
    }
    if (!safeEqualText(payload.s, sessionBinding(secret, sessionId))) {
        throw new NoteCollaborationError('Not authorized for this collaboration session', 401);
    }
    return { room: payload.r, expiresAt: payload.e };
}
async function authorizeNoteCollaboration({ enabled, noteId, owner, sessionId, secret, findOwnedNote, now, }) {
    if (!enabled) {
        throw new NoteCollaborationError('Note collaboration is unavailable', 404);
    }
    if (!noteId || !await findOwnedNote(noteId, owner)) {
        throw new NoteCollaborationError('Note not found', 404);
    }
    return issueNoteCollaborationCapability({ noteId, owner, sessionId, secret, now });
}
const rejectUpgrade = (socket, statusCode) => {
    const reason = statusCode === 404 ? 'Not Found' : 'Unauthorized';
    if (socket.writable) {
        socket.end(`HTTP/1.1 ${statusCode} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
        return;
    }
    socket.destroy();
};
function installNotesSignalingServer(server, { enabled, secret, authenticate, now = Date.now, }) {
    const signaling = new ws_1.WebSocketServer({
        noServer: true,
        maxPayload: MAX_SIGNALING_MESSAGE_BYTES,
    });
    const roomConnections = new Map();
    const roomSubscribers = new Map();
    const roomLeaders = new Map();
    const sendBootstrapRole = (socket, leader) => {
        if (socket.readyState === ws_1.WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'oms-bootstrap', leader }));
        }
    };
    const removeSubscriber = (room, socket) => {
        const subscribers = roomSubscribers.get(room);
        subscribers?.delete(socket);
        if (subscribers?.size === 0)
            roomSubscribers.delete(room);
        if (roomLeaders.get(room) !== socket)
            return;
        const nextLeader = subscribers?.values().next().value;
        if (nextLeader) {
            roomLeaders.set(room, nextLeader);
            sendBootstrapRole(nextLeader, true);
        }
        else {
            roomLeaders.delete(room);
        }
    };
    signaling.on('connection', (socket, _request, capability) => {
        const { room, expiresAt } = capability;
        const connections = roomConnections.get(room) || new Set();
        connections.add(socket);
        roomConnections.set(room, connections);
        const expirationTimer = setTimeout(() => {
            socket.close(1008, 'Capability expired');
        }, Math.max(1, expiresAt - now()));
        const unsubscribe = () => {
            clearTimeout(expirationTimer);
            removeSubscriber(room, socket);
            connections.delete(socket);
            if (connections.size === 0)
                roomConnections.delete(room);
        };
        socket.on('close', unsubscribe);
        socket.on('error', () => undefined);
        socket.on('message', (raw, isBinary) => {
            if (isBinary) {
                socket.close(1003, 'Text messages only');
                return;
            }
            let message;
            try {
                message = JSON.parse(raw.toString());
            }
            catch {
                socket.close(1003, 'Invalid message');
                return;
            }
            if (message?.type === 'subscribe' && Array.isArray(message.topics)) {
                if (message.topics.includes(room)) {
                    const subscribers = roomSubscribers.get(room) || new Set();
                    subscribers.add(socket);
                    roomSubscribers.set(room, subscribers);
                    const currentLeader = roomLeaders.get(room);
                    if (!currentLeader || currentLeader.readyState !== ws_1.WebSocket.OPEN) {
                        roomLeaders.set(room, socket);
                        sendBootstrapRole(socket, true);
                    }
                    else {
                        sendBootstrapRole(socket, currentLeader === socket);
                    }
                }
                return;
            }
            if (message?.type === 'unsubscribe' && Array.isArray(message.topics)) {
                if (message.topics.includes(room))
                    removeSubscriber(room, socket);
                return;
            }
            if (message?.type === 'publish') {
                if (message.topic !== room) {
                    socket.close(1008, 'Room not authorized');
                    return;
                }
                const receivers = roomSubscribers.get(room);
                if (!receivers)
                    return;
                const outgoing = JSON.stringify({ ...message, clients: receivers.size });
                receivers.forEach(receiver => {
                    if (receiver.readyState === ws_1.WebSocket.OPEN)
                        receiver.send(outgoing);
                });
                return;
            }
            if (message?.type === 'ping') {
                socket.send(JSON.stringify({ type: 'pong' }));
                return;
            }
            socket.close(1003, 'Unsupported message');
        });
    });
    const handleUpgrade = async (request, socket, head) => {
        let url;
        try {
            url = new URL(request.url || '/', 'http://localhost');
        }
        catch {
            return;
        }
        if (url.pathname !== exports.NOTES_SIGNALING_PATH)
            return;
        if (!enabled) {
            rejectUpgrade(socket, 404);
            return;
        }
        try {
            const identity = await authenticate(request);
            if (!identity)
                throw new NoteCollaborationError('Unauthorized', 401);
            const capability = verifyNoteCollaborationCapability({
                token: url.searchParams.get('token') || '',
                owner: identity.owner,
                sessionId: identity.sessionId,
                secret,
                now: now(),
            });
            if ((roomConnections.get(capability.room)?.size || 0) >= MAX_SIGNALING_CONNECTIONS_PER_ROOM) {
                rejectUpgrade(socket, 401);
                return;
            }
            signaling.handleUpgrade(request, socket, head, (webSocket) => {
                signaling.emit('connection', webSocket, request, capability);
            });
        }
        catch {
            rejectUpgrade(socket, 401);
        }
    };
    server.on('upgrade', handleUpgrade);
    signaling.once('close', () => server.off('upgrade', handleUpgrade));
    return signaling;
}
//# sourceMappingURL=notes-collaboration.js.map