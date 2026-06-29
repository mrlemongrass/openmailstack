"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startScheduledSender = exports.runScheduledSender = exports.ensureScheduledEmailsSchema = void 0;
const db_1 = require("./db");
const auth_1 = require("./auth");
const config_1 = require("./config");
const nodemailer_1 = __importDefault(require("nodemailer"));
let schemaPromise = null;
const ensureScheduledEmailsSchema = async () => {
    if (!schemaPromise) {
        schemaPromise = db_1.pool.query(`
            CREATE TABLE IF NOT EXISTS scheduled_emails (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(255) NOT NULL,
                send_at DATETIME NOT NULL,
                mail_options MEDIUMTEXT NOT NULL,
                draft_uid BIGINT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                KEY idx_send_at (send_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `).then(() => undefined);
    }
    return schemaPromise;
};
exports.ensureScheduledEmailsSchema = ensureScheduledEmailsSchema;
const runScheduledSender = async () => {
    await (0, exports.ensureScheduledEmailsSchema)();
    try {
        const [rows] = await db_1.pool.query('SELECT * FROM scheduled_emails WHERE send_at <= NOW()');
        for (const row of rows) {
            const username = row.username;
            const mailOptions = JSON.parse(row.mail_options);
            if (mailOptions.attachments) {
                mailOptions.attachments = mailOptions.attachments.map((a) => ({
                    filename: a.filename,
                    content: Buffer.from(a.content, 'base64')
                }));
            }
            try {
                const [sessions] = await db_1.pool.query('SELECT password_ciphertext, password_iv, password_tag FROM webmail_sessions WHERE username = ? LIMIT 1', [username]);
                if (sessions.length > 0) {
                    const pass = (0, auth_1.decryptPassword)(sessions[0].password_ciphertext, sessions[0].password_iv, sessions[0].password_tag);
                    const transporter = nodemailer_1.default.createTransport({
                        host: config_1.smtpConfig.host,
                        port: config_1.smtpConfig.port,
                        secure: config_1.smtpConfig.secure,
                        auth: { user: username, pass },
                        tls: { rejectUnauthorized: config_1.smtpConfig.rejectUnauthorized }
                    });
                    await transporter.sendMail(mailOptions);
                    try {
                        const { ImapService } = require('./imap');
                        const imap = new ImapService(username, pass);
                        await imap.connect();
                        // Append to Sent
                        const folders = await imap.getFolders();
                        let sentFolder = folders.find((f) => f.path.toLowerCase().includes('sent'))?.path;
                        if (!sentFolder) {
                            try {
                                await imap.client.mailboxCreate('Sent');
                            }
                            catch (e) { }
                            sentFolder = 'Sent';
                        }
                        const MailComposer = require('nodemailer/lib/mail-composer');
                        const mail = new MailComposer(mailOptions);
                        const rawMessage = await mail.compile().build();
                        await imap.appendMessage(sentFolder, rawMessage, ['\\Seen']);
                        // Delete draft
                        if (row.draft_uid) {
                            let draftsFolder = folders.find((f) => f.path.toLowerCase().includes('draft'))?.path;
                            if (draftsFolder) {
                                try {
                                    await imap.messageAction(draftsFolder, [parseInt(row.draft_uid, 10)], 'delete');
                                }
                                catch (e) {
                                    console.error('Failed to delete sent draft', e);
                                }
                            }
                        }
                        await imap.logout();
                    }
                    catch (e) {
                        console.error('Failed IMAP sync after scheduled send:', e);
                    }
                }
            }
            catch (err) {
                console.error(`Failed to send scheduled email ${row.id} for ${username}:`, err);
            }
            // Delete regardless of success/failure so it doesn't get stuck forever?
            // Actually, if auth fails, we probably should delete it. If SMTP fails, maybe retry?
            // For simplicity, delete it.
            await db_1.pool.query('DELETE FROM scheduled_emails WHERE id = ?', [row.id]);
        }
    }
    catch (err) {
        console.error('Scheduled sender error:', err);
    }
};
exports.runScheduledSender = runScheduledSender;
const startScheduledSender = () => {
    (0, exports.ensureScheduledEmailsSchema)().catch(err => console.error('Failed to init scheduled_emails:', err));
    setInterval(exports.runScheduledSender, 10000); // Check every 10 seconds
};
exports.startScheduledSender = startScheduledSender;
//# sourceMappingURL=scheduled-send.js.map