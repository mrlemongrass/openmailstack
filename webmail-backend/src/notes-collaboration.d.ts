import type { IncomingMessage } from 'http';
import { WebSocketServer } from 'ws';
export declare const NOTES_SIGNALING_PATH = "/notes-signal";
export declare const NOTE_COLLABORATION_CAPABILITY_TTL_MS: number;
export interface NoteCollaborationCapability {
    room: string;
    token: string;
    expiresAt: number;
}
export declare class NoteCollaborationError extends Error {
    readonly statusCode: number;
    constructor(message: string, statusCode: number);
}
export declare function issueNoteCollaborationCapability({ noteId, owner, sessionId, secret, now, }: {
    noteId: string;
    owner: string;
    sessionId: string;
    secret: string;
    now?: number;
}): NoteCollaborationCapability;
export declare function verifyNoteCollaborationCapability({ token, owner, sessionId, secret, now, }: {
    token: string;
    owner: string;
    sessionId: string;
    secret: string;
    now?: number;
}): {
    room: string;
    expiresAt: number;
};
export declare function authorizeNoteCollaboration({ enabled, noteId, owner, sessionId, secret, findOwnedNote, now, }: {
    enabled: boolean;
    noteId: string;
    owner: string;
    sessionId: string;
    secret: string;
    findOwnedNote: (noteId: string, owner: string) => Promise<unknown | null>;
    now?: number;
}): Promise<NoteCollaborationCapability>;
export declare function installNotesSignalingServer(server: import('http').Server, { enabled, secret, authenticate, now, }: {
    enabled: boolean;
    secret: string;
    authenticate: (request: IncomingMessage) => Promise<{
        owner: string;
        sessionId: string;
    } | null>;
    now?: () => number;
}): WebSocketServer;
//# sourceMappingURL=notes-collaboration.d.ts.map