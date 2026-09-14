"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.senderAddress = senderAddress;
function senderAddress(value) {
    const parse = require('nodemailer/lib/addressparser');
    const addresses = parse(value, { flatten: true });
    if (addresses.length !== 1)
        return null;
    const address = String(addresses[0].address || '').toLowerCase();
    return /^[^\s@<>]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(address) ? address : null;
}
//# sourceMappingURL=rule-address.js.map