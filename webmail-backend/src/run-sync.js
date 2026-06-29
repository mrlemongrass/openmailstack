"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("./db");
const notes_imap_sync_1 = require("./notes-imap-sync");
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("./config");
const getSessionKey = () => crypto_1.default.createHash('sha256').update(config_1.serverConfig.sessionSecret).digest();
const decryptPassword = (ciphertext, iv, tag) => {
    const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', getSessionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64')),
        decipher.final()
    ]).toString('utf8');
};
async function main() {
    const [rows] = await db_1.pool.query('SELECT username, password_ciphertext, password_iv, password_tag FROM webmail_sessions LIMIT 1');
    if (rows.length === 0) {
        console.log("No active sessions found.");
        process.exit(0);
    }
    const row = rows[0];
    const password = decryptPassword(row.password_ciphertext, row.password_iv, row.password_tag);
    console.log(`Syncing for ${row.username}...`);
    await (0, notes_imap_sync_1.syncNotesWithImap)(row.username, password);
    console.log("Done.");
    process.exit(0);
}
main();
//# sourceMappingURL=run-sync.js.map