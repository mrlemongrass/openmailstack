import { createHash } from 'crypto';

export const pimSyncScopeHash = (username: string, deviceId: string, collectionId: string): string =>
    createHash('sha256').update(username).update('\0').update(deviceId).update('\0').update(collectionId).digest('hex');

export const pimWireServerId = (collectionId: string, sourceId: string): string =>
    createHash('sha256').update(collectionId).update('\0').update(sourceId).digest('hex');

export function deterministicPimAddServerId(scopeHash: string, syncKey: string, clientId: string): string {
    const bytes = createHash('sha256')
        .update(scopeHash)
        .update('\0')
        .update(syncKey)
        .update('\0')
        .update(clientId)
        .digest()
        .subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
