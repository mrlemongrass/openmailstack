import { ImapService } from './imap';

interface PoolEntry {
  imap: ImapService;
  lastUsed: number;
  timer: ReturnType<typeof setTimeout>;
}

const pool = new Map<string, PoolEntry>();
const IDLE_TIMEOUT = 30000; // 30 seconds

function getKey(user: string, pass: string): string {
  return `${user}:${pass.slice(0, 4)}`;
}

/** Get or create a connected IMAP service for the given user. */
export async function getImapConnection(user: string, pass: string): Promise<ImapService> {
  const key = getKey(user, pass);
  const existing = pool.get(key);

  if (existing) {
    // Refresh idle timer
    clearTimeout(existing.timer);
    existing.lastUsed = Date.now();
    existing.timer = setTimeout(() => closeConnection(key), IDLE_TIMEOUT);

    // Verify connection is still alive
    try {
      await existing.imap.client.noop();
      return existing.imap;
    } catch {
      // Connection dead — remove and create new
      pool.delete(key);
    }
  }

  // Create new connection
  const imap = new ImapService(user, pass);
  await imap.connect();

  const entry: PoolEntry = {
    imap,
    lastUsed: Date.now(),
    timer: setTimeout(() => closeConnection(key), IDLE_TIMEOUT),
  };
  pool.set(key, entry);

  return imap;
}

/** Close and remove a pooled connection. */
async function closeConnection(key: string): Promise<void> {
  const entry = pool.get(key);
  if (!entry) return;
  pool.delete(key);
  clearTimeout(entry.timer);
  try { await entry.imap.logout(); } catch { /* ignore */ }
}

/** Release a connection back to the pool (renews idle timer). */
export function releaseConnection(user: string, pass: string): void {
  const key = getKey(user, pass);
  const entry = pool.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.lastUsed = Date.now();
  entry.timer = setTimeout(() => closeConnection(key), IDLE_TIMEOUT);
}

/** Force-close all pooled connections (for shutdown). */
export async function closeAllConnections(): Promise<void> {
  const keys = Array.from(pool.keys());
  for (const key of keys) {
    await closeConnection(key);
  }
}
