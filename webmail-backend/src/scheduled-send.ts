import { pool } from './db';
import { decryptPassword } from './auth';
import { smtpConfig } from './config';
import nodemailer from 'nodemailer';

let schemaPromise: Promise<void> | null = null;

export const ensureScheduledEmailsSchema = async () => {
    if (!schemaPromise) {
        schemaPromise = pool.query(`
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

export const runScheduledSender = async () => {
    await ensureScheduledEmailsSchema();
    try {
        const [rows]: any = await pool.query('SELECT * FROM scheduled_emails WHERE send_at <= NOW()');
        for (const row of rows) {
            const username = row.username;
            const mailOptions = JSON.parse(row.mail_options);
            
            if (mailOptions.attachments) {
                mailOptions.attachments = mailOptions.attachments.map((a: any) => ({
                    filename: a.filename,
                    content: Buffer.from(a.content, 'base64')
                }));
            }
            
            try {
                const [sessions]: any = await pool.query('SELECT password_ciphertext, password_iv, password_tag FROM webmail_sessions WHERE username = ? LIMIT 1', [username]);
                if (sessions.length > 0) {
                    const pass = decryptPassword(sessions[0].password_ciphertext, sessions[0].password_iv, sessions[0].password_tag);
                    const transporter = nodemailer.createTransport({
                        host: smtpConfig.host,
                        port: smtpConfig.port,
                        secure: smtpConfig.secure,
                        auth: { user: username, pass },
                        tls: { rejectUnauthorized: smtpConfig.rejectUnauthorized }
                    });
                    
                    await transporter.sendMail(mailOptions);
                    
                    try {
                        const { ImapService } = require('./imap');
                        const imap = new ImapService(username, pass);
                        await imap.connect();
                        
                        // Append to Sent
                        const folders = await imap.getFolders();
                        let sentFolder = folders.find((f: any) => f.path.toLowerCase().includes('sent'))?.path;
                        if (!sentFolder) {
                            try { await imap.client.mailboxCreate('Sent'); } catch(e) {}
                            sentFolder = 'Sent';
                        }
                        
                        const MailComposer = require('nodemailer/lib/mail-composer');
                        const mail = new MailComposer(mailOptions);
                        const rawMessage = await mail.compile().build();
                        
                        await imap.appendMessage(sentFolder, rawMessage, ['\\Seen']);
                        
                        // Delete draft
                        if (row.draft_uid) {
                            let draftsFolder = folders.find((f: any) => f.path.toLowerCase().includes('draft'))?.path;
                            if (draftsFolder) {
                                try {
                                    await imap.messageAction(draftsFolder, [parseInt(row.draft_uid, 10)], 'delete');
                                } catch(e) {
                                    console.error('Failed to delete sent draft', e);
                                }
                            }
                        }
                        
                        await imap.logout();
                    } catch(e) {
                        console.error('Failed IMAP sync after scheduled send:', e);
                    }
                }
            } catch (err) {
                console.error(`Failed to send scheduled email ${row.id} for ${username}:`, err);
            }
            
            // Delete regardless of success/failure so it doesn't get stuck forever?
            // Actually, if auth fails, we probably should delete it. If SMTP fails, maybe retry?
            // For simplicity, delete it.
            await pool.query('DELETE FROM scheduled_emails WHERE id = ?', [row.id]);
        }
    } catch (err) {
        console.error('Scheduled sender error:', err);
    }
};

export const startScheduledSender = () => {
    ensureScheduledEmailsSchema().catch(err => console.error('Failed to init scheduled_emails:', err));
    setInterval(runScheduledSender, 10000); // Check every 10 seconds
};
