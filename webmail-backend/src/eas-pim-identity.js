"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pimWireServerId = exports.pimSyncScopeHash = void 0;
exports.deterministicPimAddServerId = deterministicPimAddServerId;
const crypto_1 = require("crypto");
const pimSyncScopeHash = (username, deviceId, collectionId) => (0, crypto_1.createHash)('sha256').update(username).update('\0').update(deviceId).update('\0').update(collectionId).digest('hex');
exports.pimSyncScopeHash = pimSyncScopeHash;
const pimWireServerId = (collectionId, sourceId) => (0, crypto_1.createHash)('sha256').update(collectionId).update('\0').update(sourceId).digest('hex');
exports.pimWireServerId = pimWireServerId;
function deterministicPimAddServerId(scopeHash, syncKey, clientId) {
    const bytes = (0, crypto_1.createHash)('sha256')
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
//# sourceMappingURL=eas-pim-identity.js.map