import crypto from 'crypto';
import type { IncomingMessage } from 'http';
import type { Socket } from 'net';
import { WebSocket, WebSocketServer } from 'ws';

export const NOTES_SIGNALING_PATH = '/notes-signal';
export const NOTE_COLLABORATION_CAPABILITY_TTL_MS = 5 * 60 * 1000;

const MAX_SIGNALING_CONNECTIONS_PER_ROOM = 32;
const MAX_SIGNALING_MESSAGE_BYTES = 64 * 1024;

interface CapabilityPayload {
    v: 1;
    r: string;
    o: string;
    s: string;
    e: number;
}

export interface NoteCollaborationCapability {
    room: string;
    token: string;
    expiresAt: number;
}

export class NoteCollaborationError extends Error {
    constructor(message: string, public readonly statusCode: number) {
        super(message);
    }
}

const hmac = (secret: string, value: string): Buffer => (
    crypto.createHmac('sha256', secret).update(value).digest()
);

const ownerBinding = (secret: string, owner: string): string => (
    hmac(secret, `notes-owner\0${owner}`).toString('base64url')
);

const sessionBinding = (secret: string, sessionId: string): string => (
    hmac(secret, `notes-session\0${sessionId}`).toString('base64url')
);

const noteRoom = (secret: string, noteId: string): string => (
    hmac(secret, `notes-room\0${noteId}`).toString('base64url')
);

const safeEqualText = (left: string, right: string): boolean => {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export function issueNoteCollaborationCapability({
    noteId,
    owner,
    sessionId,
    secret,
    now = Date.now(),
}: {
    noteId: string;
    owner: string;
    sessionId: string;
    secret: string;
    now?: number;
}): NoteCollaborationCapability {
    const expiresAt = now + NOTE_COLLABORATION_CAPABILITY_TTL_MS;
    const payload: CapabilityPayload = {
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

export function verifyNoteCollaborationCapability({
    token,
    owner,
    sessionId,
    secret,
    now = Date.now(),
}: {
    token: string;
    owner: string;
    sessionId: string;
    secret: string;
    now?: number;
}): { room: string; expiresAt: number } {
    const [encodedPayload, signature, extra] = token.split('.');
    if (!encodedPayload || !signature || extra !== undefined) {
        throw new NoteCollaborationError('Invalid collaboration capability', 401);
    }
    const expectedSignature = hmac(secret, `notes-capability\0${encodedPayload}`).toString('base64url');
    if (!safeEqualText(signature, expectedSignature)) {
        throw new NoteCollaborationError('Invalid collaboration capability', 401);
    }

    let payload: CapabilityPayload;
    try {
        payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    } catch {
        throw new NoteCollaborationError('Invalid collaboration capability', 401);
    }
    if (
        payload?.v !== 1
        || typeof payload.r !== 'string'
        || payload.r.length !== 43
        || typeof payload.o !== 'string'
        || typeof payload.s !== 'string'
        || typeof payload.e !== 'number'
        || !Number.isSafeInteger(payload.e)
    ) {
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

export async function authorizeNoteCollaboration({
    enabled,
    noteId,
    owner,
    sessionId,
    secret,
    findOwnedNote,
    now,
}: {
    enabled: boolean;
    noteId: string;
    owner: string;
    sessionId: string;
    secret: string;
    findOwnedNote: (noteId: string, owner: string) => Promise<unknown | null>;
    now?: number;
}): Promise<NoteCollaborationCapability> {
    if (!enabled) {
        throw new NoteCollaborationError('Note collaboration is unavailable', 404);
    }
    if (!noteId || !await findOwnedNote(noteId, owner)) {
        throw new NoteCollaborationError('Note not found', 404);
    }
    return issueNoteCollaborationCapability({ noteId, owner, sessionId, secret, now });
}

const rejectUpgrade = (socket: Socket, statusCode: number): void => {
    const reason = statusCode === 404 ? 'Not Found' : 'Unauthorized';
    if (socket.writable) {
        socket.end(
            `HTTP/1.1 ${statusCode} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
        );
        return;
    }
    socket.destroy();
};

export function installNotesSignalingServer(
    server: import('http').Server,
    {
        enabled,
        secret,
        authenticate,
        now = Date.now,
    }: {
        enabled: boolean;
        secret: string;
        authenticate: (request: IncomingMessage) => Promise<{ owner: string; sessionId: string } | null>;
        now?: () => number;
    },
): WebSocketServer {
    const signaling = new WebSocketServer({
        noServer: true,
        maxPayload: MAX_SIGNALING_MESSAGE_BYTES,
    });
    const roomConnections = new Map<string, Set<WebSocket>>();
    const roomSubscribers = new Map<string, Set<WebSocket>>();
    const roomLeaders = new Map<string, WebSocket>();

    const sendBootstrapRole = (socket: WebSocket, leader: boolean) => {
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'oms-bootstrap', leader }));
        }
    };

    const removeSubscriber = (room: string, socket: WebSocket) => {
        const subscribers = roomSubscribers.get(room);
        subscribers?.delete(socket);
        if (subscribers?.size === 0) roomSubscribers.delete(room);
        if (roomLeaders.get(room) !== socket) return;
        const nextLeader = subscribers?.values().next().value as WebSocket | undefined;
        if (nextLeader) {
            roomLeaders.set(room, nextLeader);
            sendBootstrapRole(nextLeader, true);
        } else {
            roomLeaders.delete(room);
        }
    };

    signaling.on('connection', (socket, _request, capability: { room: string; expiresAt: number }) => {
        const { room, expiresAt } = capability;
        const connections = roomConnections.get(room) || new Set<WebSocket>();
        connections.add(socket);
        roomConnections.set(room, connections);
        const expirationTimer = setTimeout(() => {
            socket.close(1008, 'Capability expired');
        }, Math.max(1, expiresAt - now()));

        const unsubscribe = () => {
            clearTimeout(expirationTimer);
            removeSubscriber(room, socket);
            connections.delete(socket);
            if (connections.size === 0) roomConnections.delete(room);
        };
        socket.on('close', unsubscribe);
        socket.on('error', () => undefined);
        socket.on('message', (raw, isBinary) => {
            if (isBinary) {
                socket.close(1003, 'Text messages only');
                return;
            }
            let message: any;
            try {
                message = JSON.parse(raw.toString());
            } catch {
                socket.close(1003, 'Invalid message');
                return;
            }

            if (message?.type === 'subscribe' && Array.isArray(message.topics)) {
                if (message.topics.includes(room)) {
                    const subscribers = roomSubscribers.get(room) || new Set<WebSocket>();
                    subscribers.add(socket);
                    roomSubscribers.set(room, subscribers);
                    const currentLeader = roomLeaders.get(room);
                    if (!currentLeader || currentLeader.readyState !== WebSocket.OPEN) {
                        roomLeaders.set(room, socket);
                        sendBootstrapRole(socket, true);
                    } else {
                        sendBootstrapRole(socket, currentLeader === socket);
                    }
                }
                return;
            }
            if (message?.type === 'unsubscribe' && Array.isArray(message.topics)) {
                if (message.topics.includes(room)) removeSubscriber(room, socket);
                return;
            }
            if (message?.type === 'publish') {
                if (message.topic !== room) {
                    socket.close(1008, 'Room not authorized');
                    return;
                }
                const receivers = roomSubscribers.get(room);
                if (!receivers) return;
                const outgoing = JSON.stringify({ ...message, clients: receivers.size });
                receivers.forEach(receiver => {
                    if (receiver.readyState === WebSocket.OPEN) receiver.send(outgoing);
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

    const handleUpgrade = async (request: IncomingMessage, socket: Socket, head: Buffer) => {
        let url: URL;
        try {
            url = new URL(request.url || '/', 'http://localhost');
        } catch {
            return;
        }
        if (url.pathname !== NOTES_SIGNALING_PATH) return;
        if (!enabled) {
            rejectUpgrade(socket, 404);
            return;
        }

        try {
            const identity = await authenticate(request);
            if (!identity) throw new NoteCollaborationError('Unauthorized', 401);
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
        } catch {
            rejectUpgrade(socket, 401);
        }
    };

    server.on('upgrade', handleUpgrade);
    signaling.once('close', () => server.off('upgrade', handleUpgrade));
    return signaling;
}
