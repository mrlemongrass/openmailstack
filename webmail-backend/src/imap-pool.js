"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getImapConnection = getImapConnection;
exports.withDedicatedImapConnection = withDedicatedImapConnection;
exports.releaseConnection = releaseConnection;
exports.closeAllConnections = closeAllConnections;
const imap_1 = require("./imap");
const pool = new Map();
const IDLE_TIMEOUT = 30000; // 30 seconds
function getKey(user, pass) {
    return `${user}:${pass.slice(0, 4)}`;
}
/** Get or create a connected IMAP service for the given user. */
async function getImapConnection(user, pass) {
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
        }
        catch {
            // Connection dead — remove and create new
            pool.delete(key);
        }
    }
    // Create new connection
    const imap = new imap_1.ImapService(user, pass);
    await imap.connect();
    const entry = {
        imap,
        lastUsed: Date.now(),
        timer: setTimeout(() => closeConnection(key), IDLE_TIMEOUT),
    };
    pool.set(key, entry);
    return imap;
}
/** Run selected-mailbox work on a short-lived client that cannot race the shared pool. */
async function withDedicatedImapConnection(user, pass, operation) {
    const imap = new imap_1.ImapService(user, pass);
    let connected = false;
    try {
        await imap.connect();
        connected = true;
        return await operation(imap);
    }
    finally {
        if (connected) {
            try {
                await imap.logout();
            }
            catch {
                try {
                    imap.close();
                }
                catch { /* connection cleanup is best effort */ }
            }
        }
        else {
            try {
                imap.close();
            }
            catch { /* connection cleanup is best effort */ }
        }
    }
}
/** Close and remove a pooled connection. */
async function closeConnection(key) {
    const entry = pool.get(key);
    if (!entry)
        return;
    pool.delete(key);
    clearTimeout(entry.timer);
    try {
        await entry.imap.logout();
    }
    catch { /* ignore */ }
}
/** Release a connection back to the pool (renews idle timer). */
function releaseConnection(user, pass) {
    const key = getKey(user, pass);
    const entry = pool.get(key);
    if (!entry)
        return;
    clearTimeout(entry.timer);
    entry.lastUsed = Date.now();
    entry.timer = setTimeout(() => closeConnection(key), IDLE_TIMEOUT);
}
/** Force-close all pooled connections (for shutdown). */
async function closeAllConnections() {
    const keys = Array.from(pool.keys());
    for (const key of keys) {
        await closeConnection(key);
    }
}
//# sourceMappingURL=imap-pool.js.map