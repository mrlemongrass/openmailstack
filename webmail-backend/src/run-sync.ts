import { pool } from './db';
import { syncNotesWithImap } from './notes-imap-sync';
import crypto from 'crypto';
import { serverConfig } from './config';

const getSessionKey = () => crypto.createHash('sha256').update(serverConfig.sessionSecret).digest();

const decryptPassword = (ciphertext: string, iv: Buffer, tag: Buffer) => {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getSessionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64')),
        decipher.final()
    ]).toString('utf8');
};

async function main() {
    const [rows]: any = await pool.query('SELECT username, password_ciphertext, password_iv, password_tag FROM webmail_sessions LIMIT 1');
    if (rows.length === 0) {
        console.log("No active sessions found.");
        process.exit(0);
    }
    const row = rows[0];
    const password = decryptPassword(row.password_ciphertext, row.password_iv, row.password_tag);
    console.log(`Syncing for ${row.username}...`);
    await syncNotesWithImap(row.username, password);
    console.log("Done.");
    process.exit(0);
}
main();
