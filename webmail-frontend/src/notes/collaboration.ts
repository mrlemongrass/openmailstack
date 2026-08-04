import type { WebrtcProvider } from 'y-webrtc';

export interface NoteCollaborationSession {
  room: string;
  token: string;
  signalingPath: string;
  expiresAt: number;
}

interface LocationLike {
  protocol: string;
  host: string;
}

interface SignalingConnection {
  on(eventName: 'message', handler: (message: unknown) => void): void;
}

interface PeerChange {
  webrtcPeers: string[];
  bcPeers: string[];
}

interface SyncChange {
  synced: boolean;
}

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export async function fetchNoteCollaborationSession(
  noteId: string,
  signal?: AbortSignal,
  fetcher: FetchLike = fetch,
): Promise<NoteCollaborationSession | null> {
  const response = await fetcher(
    `/api/notes/${encodeURIComponent(noteId)}/collaboration-session`,
    { method: 'POST', signal },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Collaboration is temporarily unavailable');

  const data = await response.json() as Partial<NoteCollaborationSession> & { success?: boolean };
  if (
    data.success !== true
    || typeof data.room !== 'string'
    || typeof data.token !== 'string'
    || data.signalingPath !== '/notes-signal'
    || typeof data.expiresAt !== 'number'
  ) {
    throw new Error('Invalid collaboration session');
  }
  return {
    room: data.room,
    token: data.token,
    signalingPath: data.signalingPath,
    expiresAt: data.expiresAt,
  };
}

export function collaborationWebSocketUrl(
  session: NoteCollaborationSession,
  location: LocationLike = window.location,
): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = new URL(session.signalingPath, `${protocol}//${location.host}`);
  url.searchParams.set('token', session.token);
  return url.toString();
}

export function collaborationRefreshDelay(
  session: NoteCollaborationSession,
  now = Date.now(),
): number {
    return Math.max(1000, session.expiresAt - now - 30_000);
}

export function collaborationRetryDelay(
  attempt: number,
  expiresAt: number,
  now = Date.now(),
): number | null {
  const remaining = expiresAt - now;
  if (remaining <= 0) return null;
  const backoff = Math.min(30_000, 1000 * (2 ** Math.min(attempt, 5)));
  return Math.min(backoff, remaining);
}

export function observeNoteCollaborationProvider(
  provider: WebrtcProvider,
  {
    onBootstrap,
    onPeerChange,
    onSynced,
  }: {
    onBootstrap: (leader: boolean) => void;
    onPeerChange: (hasPeers: boolean) => void;
    onSynced: () => void;
  },
): void {
  let hasPeers = false;
  const signalingConnection = provider.signalingConns[0] as SignalingConnection | undefined;
  signalingConnection?.on('message', (message) => {
    if (
      typeof message === 'object'
      && message !== null
      && (message as { type?: unknown }).type === 'oms-bootstrap'
      && typeof (message as { leader?: unknown }).leader === 'boolean'
    ) {
      onBootstrap((message as { leader: boolean }).leader);
    }
  });
  provider.on('peers', ({ webrtcPeers, bcPeers }: PeerChange) => {
    hasPeers = webrtcPeers.length > 0 || bcPeers.length > 0;
    onPeerChange(hasPeers);
  });
  provider.on('synced', ({ synced }: SyncChange) => {
    if (synced && hasPeers) onSynced();
  });
}
