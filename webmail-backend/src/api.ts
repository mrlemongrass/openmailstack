import { Router } from 'express';
import crypto from 'crypto';
import { exec } from 'child_process';
import fs from 'fs';
import os from 'os';
import util from 'util';
import type { PoolConnection } from 'mysql2/promise';
import { ManageSieveClient } from './managesieve';
import bcrypt from 'bcryptjs';
import { pool } from './db';
import { clearSession, createSession, requireAdminSession, requireSession } from './auth';
import { normalizeMailboxUsername, serverConfig, sieveConfig, smtpConfig } from './config';
import { compileSieve, extractJsonFromSieve } from './sieve-compiler';
import {
    createSavedMailSearch,
    deleteMailSearchRows,
    deleteSavedMailSearch,
    getMaxIndexedUid,
    getMailSearchIndexStatus,
    listSavedMailSearches,
    searchMailIndex,
    updateMailSearchFlags,
    upsertMailSearchRows,
    type IndexedMailSearchField,
    type MailSearchIndexRow
} from './search-index';
import { getUserSettings, isSettingsNamespace, saveUserSettings } from './user-settings';
import { getAdminSettings, isAdminSettingsNamespace, saveAdminSettings } from './admin-settings';
import { getBrandingSettings, saveBrandingSettings } from './branding';
import { getSearchWorkerStatus, purgeUserSearchIndex } from './search-worker';

export const apiRouter = Router();

// Auth failure log for fail2ban integration
const AUTH_LOG = '/var/log/openmailstack/auth.log';
const logAuthFailure = (ip: string, username: string, reason: string) => {
    try {
        const ts = new Date().toISOString();
        fs.appendFileSync(AUTH_LOG, `${ts} [${ip}] failed login for "${username}": ${reason}\n`);
    } catch {}
};
const requireAuth = requireSession;
const requireAdmin = requireAdminSession;
const execPromise = util.promisify(exec);

import * as promClient from 'prom-client';
promClient.collectDefaultMetrics({ prefix: 'openmailstack_' });
const apiRequestsCounter = new promClient.Counter({
    name: 'openmailstack_api_requests_total',
    help: 'Total number of API requests',
    labelNames: ['method', 'status']
});

const mailQueueGauge = new promClient.Gauge({ name: 'openmailstack_mail_queue_size', help: 'Number of emails currently queued in Postfix' });
const imapConnectionsGauge = new promClient.Gauge({ name: 'openmailstack_network_connections_imap', help: 'Active IMAP connections' });
const smtpConnectionsGauge = new promClient.Gauge({ name: 'openmailstack_network_connections_smtp', help: 'Active SMTP connections' });
const httpConnectionsGauge = new promClient.Gauge({ name: 'openmailstack_network_connections_http', help: 'Active HTTP connections' });
const rspamdScannedGauge = new promClient.Gauge({ name: 'openmailstack_rspamd_scanned_total', help: 'Total emails scanned by Rspamd' });
const rspamdSpamGauge = new promClient.Gauge({ name: 'openmailstack_rspamd_spam_total', help: 'Total spam emails detected' });
const rspamdRejectedGauge = new promClient.Gauge({ name: 'openmailstack_rspamd_rejected_total', help: 'Total emails rejected' });

// System resource gauges
const systemCpuLoad1mGauge = new promClient.Gauge({ name: 'openmailstack_system_cpu_load_1m', help: 'System CPU load 1-minute average' });
const systemCpuLoad5mGauge = new promClient.Gauge({ name: 'openmailstack_system_cpu_load_5m', help: 'System CPU load 5-minute average' });
const systemCpuLoad15mGauge = new promClient.Gauge({ name: 'openmailstack_system_cpu_load_15m', help: 'System CPU load 15-minute average' });
const systemMemoryTotalGauge = new promClient.Gauge({ name: 'openmailstack_system_memory_total_bytes', help: 'System total memory in bytes' });
const systemMemoryFreeGauge = new promClient.Gauge({ name: 'openmailstack_system_memory_free_bytes', help: 'System free memory in bytes' });
const systemDiskTotalGauge = new promClient.Gauge({ name: 'openmailstack_system_disk_total_bytes', help: 'System disk total bytes', labelNames: ['mountpoint'] });
const systemDiskUsedGauge = new promClient.Gauge({ name: 'openmailstack_system_disk_used_bytes', help: 'System disk used bytes', labelNames: ['mountpoint'] });

// Service health gauges (1=running, 0=stopped)
const servicePostfixGauge = new promClient.Gauge({ name: 'openmailstack_service_postfix_status', help: 'Postfix service status (1=running)' });
const serviceDovecotGauge = new promClient.Gauge({ name: 'openmailstack_service_dovecot_status', help: 'Dovecot service status (1=running)' });
const serviceRspamdGauge = new promClient.Gauge({ name: 'openmailstack_service_rspamd_status', help: 'Rspamd service status (1=running)' });
const serviceFail2banGauge = new promClient.Gauge({ name: 'openmailstack_service_fail2ban_status', help: 'Fail2ban service status (1=running)' });

// Fail2ban per-jail banned IP count
const fail2banBannedGauge = new promClient.Gauge({ name: 'openmailstack_fail2ban_banned_total', help: 'Currently banned IPs per jail', labelNames: ['jail'] });

setInterval(async () => {
    try {
        try {
            const { stdout } = await execPromise('postqueue -j || true');
            const lines = stdout.split('\n').filter((l: string) => l.trim().length > 0).length;
            mailQueueGauge.set(lines);
        } catch (e) {}

        try {
            const { stdout } = await execPromise('ss -tn state established');
            let imap = 0, smtp = 0, http = 0;
            stdout.split('\n').forEach((line: string) => {
                if (line.includes(':993 ') || line.includes(':143 ')) imap++;
                else if (line.includes(':25 ') || line.includes(':465 ') || line.includes(':587 ')) smtp++;
                else if (line.includes(':80 ') || line.includes(':443 ') || line.includes(':20000 ')) http++;
            });
            imapConnectionsGauge.set(imap);
            smtpConnectionsGauge.set(smtp);
            httpConnectionsGauge.set(http);
        } catch (e) {}

        try {
            const res = await fetch('http://localhost:11334/stat');
            if (res.ok) {
                const data = await res.json();
                if (data.scanned !== undefined) rspamdScannedGauge.set(data.scanned);
                if (data.spam_count !== undefined) rspamdSpamGauge.set(data.spam_count);
                if (data.actions && data.actions.reject !== undefined) rspamdRejectedGauge.set(data.actions.reject);
            }
        } catch (e) {}

        // System resources: CPU load, memory, disk
        try {
            const [load1, load5, load15] = os.loadavg();
            systemCpuLoad1mGauge.set(load1);
            systemCpuLoad5mGauge.set(load5);
            systemCpuLoad15mGauge.set(load15);
            systemMemoryTotalGauge.set(os.totalmem());
            systemMemoryFreeGauge.set(os.freemem());

            const { stdout: dfOut } = await execPromise('df -B1 / | tail -1');
            const dfParts = dfOut.trim().split(/\s+/);
            const diskTotal = parseInt(dfParts[1], 10); // 1K blocks in bytes
            const diskUsed = parseInt(dfParts[2], 10);
            systemDiskTotalGauge.set({ mountpoint: '/' }, diskTotal);
            systemDiskUsedGauge.set({ mountpoint: '/' }, diskUsed);
        } catch (e) {}

        // Service health status
        try {
            const services = ['postfix', 'dovecot', 'rspamd', 'fail2ban'];
            const gauges: Record<string, promClient.Gauge> = {
                postfix: servicePostfixGauge,
                dovecot: serviceDovecotGauge,
                rspamd: serviceRspamdGauge,
                fail2ban: serviceFail2banGauge,
            };
            for (const svc of services) {
                try {
                    await execPromise(`systemctl is-active --quiet ${svc}`);
                    gauges[svc].set(1);
                } catch {
                    gauges[svc].set(0);
                }
            }
        } catch (e) {}

        // Fail2ban banned IP counts per jail
        try {
            const jails = ['sshd', 'postfix', 'dovecot', 'openmailstack-webmail'];
            for (const jail of jails) {
                try {
                    const { stdout } = await execPromise(`sudo fail2ban-client status ${jail} 2>/dev/null`);
                    const match = stdout.match(/Currently banned:\s*(\d+)/);
                    fail2banBannedGauge.set({ jail }, match ? parseInt(match[1], 10) : 0);
                } catch {
                    fail2banBannedGauge.set({ jail }, 0);
                }
            }
        } catch (e) {}
    } catch (err) {
        // Silent catch
    }
}, 15000);

apiRouter.use((req, res, next) => {
    res.on('finish', () => {
        apiRequestsCounter.inc({ method: req.method, status: res.statusCode });
    });
    next();
});

const withTransaction = async <T>(callback: (connection: PoolConnection) => Promise<T>): Promise<T> => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const result = await callback(connection);
        await connection.commit();
        return result;
    } catch (err) {
        await connection.rollback();
        throw err;
    } finally {
        connection.release();
    }
};

const getAddressText = (value: any) => value?.text || '';

const getAttachmentNames = (parsed: any) => {
    if (!Array.isArray(parsed.attachments)) return '';
    return parsed.attachments
        .map((attachment: any) => attachment?.filename)
        .filter(Boolean)
        .join('\n');
};

const getVisibleAttachments = (parsed: any) => {
    if (!Array.isArray(parsed.attachments)) return [];
    return parsed.attachments.filter((attachment: any) => (
        attachment && (attachment.filename || attachment.contentDisposition === 'attachment' || !attachment.related)
    ));
};

const isPreviewableAttachment = (contentType: string) => (
    contentType.startsWith('image/') ||
    contentType.startsWith('text/') ||
    contentType === 'application/pdf' ||
    contentType === 'application/msword' ||
    contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    contentType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    contentType === 'application/vnd.oasis.opendocument.text' ||
    contentType === 'application/vnd.oasis.opendocument.spreadsheet' ||
    contentType === 'application/rtf'
);

const sanitizeAttachmentFilename = (filename: string) => filename.replace(/[\r\n"]/g, '').trim() || 'attachment';

const encodeAttachmentFilename = (filename: string) => {
    const cleaned = sanitizeAttachmentFilename(filename);
    return `filename="${cleaned.replace(/\\/g, '\\\\')}"; filename*=UTF-8''${encodeURIComponent(cleaned)}`;
};

const getAttachmentMetadata = (parsed: any) => getVisibleAttachments(parsed).map((attachment: any, index: number) => {
    const contentType = attachment.contentType || 'application/octet-stream';
    return {
        id: index,
        filename: attachment.filename || `attachment-${index + 1}`,
        contentType,
        size: attachment.size || attachment.content?.length || 0,
        disposition: attachment.contentDisposition || 'attachment',
        previewable: isPreviewableAttachment(contentType)
    };
});

const parsedMailToSummary = (folder: string, msg: any, parsed: any, previewLength = 100) => ({
    folder,
    uid: msg.uid,
    subject: parsed.subject || '(No Subject)',
    from: getAddressText(parsed.from),
    to: getAddressText(parsed.to),
    date: parsed.date,
    isRead: msg.flags.includes('\\Seen'),
    isStarred: msg.flags.includes('\\Flagged'),
    hasAttachments: getVisibleAttachments(parsed).length > 0,
    preview: parsed.text ? parsed.text.substring(0, previewLength) : '',
    messageId: parsed.messageId || '',
    inReplyTo: parsed.inReplyTo || '',
    references: parsed.references || []
});

const parsedMailToIndexRow = (folder: string, msg: any, parsed: any): MailSearchIndexRow => ({
    folder,
    uid: msg.uid,
    messageId: parsed.messageId || '',
    subject: parsed.subject || '(No Subject)',
    sender: getAddressText(parsed.from),
    recipients: [getAddressText(parsed.to), getAddressText(parsed.cc), getAddressText(parsed.bcc)].filter(Boolean).join(', '),
    sentAt: parsed.date || null,
    preview: parsed.text ? parsed.text.substring(0, 180) : '',
    bodyText: (() => {
        let txt = parsed.text || '';
        if (parsed.attachments && Array.isArray(parsed.attachments)) {
            for (const att of parsed.attachments) {
                if (att.contentType && (att.contentType.startsWith('text/') || att.contentType === 'application/json')) {
                    if (att.content && att.content.length < 50000) {
                        txt += '\n\n--- ' + (att.filename || 'attachment') + ' ---\n' + att.content.toString('utf8');
                    }
                }
            }
        }
        return txt;
    })(),
    attachmentNames: getAttachmentNames(parsed),
    inReplyTo: parsed.inReplyTo || '',
    references: parsed.references || [],
    isRead: msg.flags.includes('\\Seen'),
    isStarred: msg.flags.includes('\\Flagged'),
    messageSize: msg.source ? msg.source.length : 0
});

const allowedSearchFields: IndexedMailSearchField[] = ['all', 'from', 'to', 'subject', 'body', 'attachments', 'unread', 'starred'];

const isBlankAllowedSearchField = (field: IndexedMailSearchField) => ['unread', 'starred'].includes(field);

const domainPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const localPartPattern = /^[a-z0-9._%+-]+$/i;

const normalizeDomainInput = (value: unknown): string => String(value || '').trim().toLowerCase();

const normalizeEmailInput = (value: unknown): string => String(value || '').trim().toLowerCase();

const parseQuotaBytes = (value: unknown, fallbackBytes = 0): number => {
    if (value === undefined || value === null || value === '') return fallbackBytes;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < -1) return fallbackBytes;
    if (numeric === -1) return -1;
    return Math.round(numeric * 1048576);
};

const requireValidDomain = (value: unknown): string => {
    const domain = normalizeDomainInput(value);
    if (!domainPattern.test(domain)) {
        throw new Error('Invalid domain format');
    }
    return domain;
};

const requireValidLocalPart = (value: unknown): string => {
    const localPart = String(value || '').trim().toLowerCase();
    if (!localPartPattern.test(localPart)) {
        throw new Error('Invalid username format');
    }
    return localPart;
};

const requireValidMailbox = (value: unknown): string => {
    const email = normalizeEmailInput(value);
    const [localPart, domain, ...extra] = email.split('@');
    if (!localPart || !domain || extra.length > 0 || !localPartPattern.test(localPart) || !domainPattern.test(domain)) {
        throw new Error('Invalid email address');
    }
    return `${localPart}@${domain}`;
};

const getDomainDefaultQuota = async (domain: string): Promise<number> => {
    const [rows]: any = await pool.query('SELECT quota FROM domain WHERE domain = ? LIMIT 1', [domain]);
    return rows.length > 0 ? Number(rows[0].quota || 0) : 0;
};

const quotaInputToBytes = async (value: unknown, domain: string, fallbackBytes = 0): Promise<number> => {
    const parsed = parseQuotaBytes(value, fallbackBytes);
    if (parsed === -1) return getDomainDefaultQuota(domain);
    return Math.max(0, parsed);
};

const hashMailboxPassword = async (password: string): Promise<string> => {
    if (!password) throw new Error('Password is required');
    const hash = await bcrypt.hash(password, 12);
    return hash.replace('$2b$', '$2y$');
};

const deriveDomainFromAddress = (address: string): string => {
    if (address.startsWith('@')) return address.slice(1);
    const parts = address.split('@');
    return parts[1] || '';
};

const normalizeAliasTargets = (value: unknown): string => {
    const targets = String(value || '')
        .split(/[\n,]+/)
        .map(target => target.trim())
        .filter(Boolean)
        .map(target => requireValidMailbox(target))
        .join(',');
    if (!targets) {
        throw new Error('Alias targets are required');
    }
    return targets;
};

const normalizeAliasAddress = (value: unknown, fallbackDomain?: unknown): string => {
    const rawAddress = normalizeEmailInput(value);
    const domain = fallbackDomain ? requireValidDomain(fallbackDomain) : '';

    if (!rawAddress) {
        throw new Error('Alias address is required');
    }

    if (rawAddress.startsWith('@')) {
        const catchAllDomain = requireValidDomain(rawAddress.slice(1) || domain);
        return `@${catchAllDomain}`;
    }

    if (rawAddress.includes('@')) {
        return requireValidMailbox(rawAddress);
    }

    if (!domain) {
        throw new Error('Alias domain is required');
    }

    return `${requireValidLocalPart(rawAddress)}@${domain}`;
};

const adminErrorStatus = (err: any) => {
    if (err?.code === 'ER_DUP_ENTRY') return 409;
    if (err?.message && /invalid|required|cannot|missing|target domain must/i.test(err.message)) return 400;
    return 500;
};

let adminAuditSchemaPromise: Promise<void> | null = null;

const ensureAdminAuditSchema = async () => {
    if (!adminAuditSchemaPromise) {
        adminAuditSchemaPromise = (async () => {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS webmail_admin_audit (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    actor VARCHAR(255) NOT NULL,
                    action VARCHAR(128) NOT NULL,
                    target_type VARCHAR(64) NOT NULL DEFAULT '',
                    target_id VARCHAR(255) NOT NULL DEFAULT '',
                    target_domain VARCHAR(255) NOT NULL DEFAULT '',
                    details TEXT NULL,
                    ip_address VARCHAR(64) NOT NULL DEFAULT '',
                    KEY idx_admin_audit_created (created_at),
                    KEY idx_admin_audit_actor (actor),
                    KEY idx_admin_audit_target (target_type, target_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            await pool.query(`
                CREATE TABLE IF NOT EXISTS webhook_deliveries (
                    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    endpoint VARCHAR(500) NOT NULL,
                    action VARCHAR(128) NOT NULL DEFAULT '',
                    status VARCHAR(32) NOT NULL DEFAULT 'pending',
                    response_code INT NOT NULL DEFAULT 0,
                    error TEXT NULL,
                    duration_ms INT NOT NULL DEFAULT 0,
                    KEY idx_webhook_deliveries_created (created_at),
                    KEY idx_webhook_deliveries_status (status)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS snooze_queue (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    owner VARCHAR(255) NOT NULL,
                    original_folder VARCHAR(255) NOT NULL,
                    imap_uid INT NOT NULL,
                    snooze_until DATETIME NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_snooze_owner (owner),
                    INDEX idx_snooze_until (snooze_until)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            await pool.query(`
                CREATE TABLE IF NOT EXISTS muted_threads (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    owner VARCHAR(255) NOT NULL,
                    imap_uid INT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY idx_muted_owner_uid (owner, imap_uid)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
        })();
    }
    return adminAuditSchemaPromise;
};

const auditDetails = (details: Record<string, unknown> = {}) => {
    const serialized = JSON.stringify(details);
    return serialized.length > 2000 ? serialized.slice(0, 1997) + '...' : serialized;
};

const auditDomainFromTarget = (targetId: string) => targetId.includes('@') ? targetId.split('@').pop() || '' : targetId;

const logAdminAction = async (
    req: any,
    action: string,
    targetType: string,
    targetId: string,
    details: Record<string, unknown> = {}
) => {
    try {
        await ensureAdminAuditSchema();
        const actor = req.user?.username || 'unknown';
        const normalizedTargetId = String(targetId || '').slice(0, 255);
        const targetDomain = String((details.domain as string) || auditDomainFromTarget(normalizedTargetId)).slice(0, 255);
        await pool.query(
            `INSERT INTO webmail_admin_audit
                (actor, action, target_type, target_id, target_domain, details, ip_address)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                actor,
                action.slice(0, 128),
                targetType.slice(0, 64),
                normalizedTargetId,
                targetDomain,
                auditDetails(details),
                String(req.ip || req.socket?.remoteAddress || '').slice(0, 64),
            ]
        );

        // Fire webhooks
        getAdminSettings('webhooks').then(settings => {
            const hookSettings = settings as import('./admin-settings').WebhooksAdminSettings;
            if (hookSettings.endpoints && hookSettings.endpoints.length > 0) {
                if (hookSettings.events.length === 0 || hookSettings.events.includes(action)) {
                    const payload = JSON.stringify({
                        timestamp: new Date().toISOString(),
                        actor,
                        action,
                        target_type: targetType,
                        target_id: normalizedTargetId,
                        target_domain: targetDomain,
                        details,
                        ip_address: req.ip || req.socket?.remoteAddress
                    });
                    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                    if (serverConfig.webhookSecret) {
                        const hmac = crypto.createHmac('sha256', serverConfig.webhookSecret).update(payload).digest('hex');
                        headers['X-Webhook-Signature'] = `sha256=${hmac}`;
                    }
                    for (const endpoint of hookSettings.endpoints) {
                        const startTime = Date.now();
                        fetch(endpoint, {
                            method: 'POST',
                            headers,
                            body: payload,
                            signal: AbortSignal.timeout(10000)
                        }).then(async res => {
                            const logStatus = res.ok ? 'delivered' : 'failed';
                            pool.query(
                                `INSERT INTO webhook_deliveries (endpoint, action, status, response_code, duration_ms)
                                 VALUES (?, ?, ?, ?, ?)`,
                                [endpoint.slice(0, 500), action.slice(0, 128), logStatus, res.status, Date.now() - startTime]
                            ).catch(() => {});
                        }).catch(e => {
                            pool.query(
                                `INSERT INTO webhook_deliveries (endpoint, action, status, response_code, error, duration_ms)
                                 VALUES (?, ?, 'failed', 0, ?, ?)`,
                                [endpoint.slice(0, 500), action.slice(0, 128), String(e.message).slice(0, 500), Date.now() - startTime]
                            ).catch(() => {});
                        });
                    }
                }
            }
        }).catch(e => console.error('Failed to get webhook settings:', e));
    } catch (err) {
        console.error('Failed to write admin audit log:', err);
    }
};

let mailboxProfileSchemaPromise: Promise<void> | null = null;

const ensureMailboxProfileSchema = async () => {
    if (!mailboxProfileSchemaPromise) {
        mailboxProfileSchemaPromise = (async () => {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS webmail_mailbox_profiles (
                    username VARCHAR(255) NOT NULL PRIMARY KEY,
                    company VARCHAR(255) NOT NULL DEFAULT '',
                    job_title VARCHAR(255) NOT NULL DEFAULT '',
                    street_address VARCHAR(255) NOT NULL DEFAULT '',
                    city VARCHAR(128) NOT NULL DEFAULT '',
                    region VARCHAR(128) NOT NULL DEFAULT '',
                    postal_code VARCHAR(64) NOT NULL DEFAULT '',
                    country VARCHAR(128) NOT NULL DEFAULT '',
                    notes TEXT NULL,
                    show_in_directory TINYINT(1) NOT NULL DEFAULT 1,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    updated_by VARCHAR(255) NOT NULL DEFAULT '',
                    KEY idx_mailbox_profiles_directory (show_in_directory, username)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            const [columns]: any = await pool.query('SHOW COLUMNS FROM webmail_mailbox_profiles');
            const columnNames = new Set(columns.map((column: any) => column.Field));
            const missingColumns: Array<[string, string]> = [
                ['company', "ALTER TABLE webmail_mailbox_profiles ADD COLUMN company VARCHAR(255) NOT NULL DEFAULT '' AFTER username"],
                ['job_title', "ALTER TABLE webmail_mailbox_profiles ADD COLUMN job_title VARCHAR(255) NOT NULL DEFAULT '' AFTER company"],
                ['street_address', "ALTER TABLE webmail_mailbox_profiles ADD COLUMN street_address VARCHAR(255) NOT NULL DEFAULT '' AFTER job_title"],
                ['city', "ALTER TABLE webmail_mailbox_profiles ADD COLUMN city VARCHAR(128) NOT NULL DEFAULT '' AFTER street_address"],
                ['region', "ALTER TABLE webmail_mailbox_profiles ADD COLUMN region VARCHAR(128) NOT NULL DEFAULT '' AFTER city"],
                ['postal_code', "ALTER TABLE webmail_mailbox_profiles ADD COLUMN postal_code VARCHAR(64) NOT NULL DEFAULT '' AFTER region"],
                ['country', "ALTER TABLE webmail_mailbox_profiles ADD COLUMN country VARCHAR(128) NOT NULL DEFAULT '' AFTER postal_code"],
                ['notes', 'ALTER TABLE webmail_mailbox_profiles ADD COLUMN notes TEXT NULL AFTER country'],
                ['show_in_directory', 'ALTER TABLE webmail_mailbox_profiles ADD COLUMN show_in_directory TINYINT(1) NOT NULL DEFAULT 1 AFTER notes'],
                ['updated_by', "ALTER TABLE webmail_mailbox_profiles ADD COLUMN updated_by VARCHAR(255) NOT NULL DEFAULT '' AFTER updated_at"],
            ];
            for (const [columnName, statement] of missingColumns) {
                if (!columnNames.has(columnName)) {
                    await pool.query(statement);
                }
            }
        })();
    }
    return mailboxProfileSchemaPromise;
};

const cleanTextInput = (value: unknown, maxLength = 255): string => (
    String(value || '').trim().slice(0, maxLength)
);

const normalizeOptionalEmailInput = (value: unknown): string => {
    const email = normalizeEmailInput(value);
    return email ? requireValidMailbox(email) : '';
};

const hasBodyField = (body: any, field: string) => Object.prototype.hasOwnProperty.call(body || {}, field);

const hasMailboxProfileFields = (body: any) => [
    'company',
    'job_title',
    'street_address',
    'address',
    'city',
    'region',
    'postal_code',
    'country',
    'notes',
    'show_in_directory'
].some(field => hasBodyField(body, field));

const mailboxProfileValues = (body: any, updatedBy: string) => ({
    company: cleanTextInput(body?.company),
    jobTitle: cleanTextInput(body?.job_title, 255),
    streetAddress: cleanTextInput(body?.street_address ?? body?.address, 255),
    city: cleanTextInput(body?.city, 128),
    region: cleanTextInput(body?.region, 128),
    postalCode: cleanTextInput(body?.postal_code, 64),
    country: cleanTextInput(body?.country, 128),
    notes: cleanTextInput(body?.notes, 2000),
    showInDirectory: body?.show_in_directory === 0 || body?.show_in_directory === false ? 0 : 1,
    updatedBy,
});

const upsertMailboxProfile = async (connection: PoolConnection, username: string, body: any, updatedBy: string) => {
    const profile = mailboxProfileValues(body, updatedBy);
    await connection.query(
        `INSERT INTO webmail_mailbox_profiles
            (username, company, job_title, street_address, city, region, postal_code, country, notes, show_in_directory, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            company = VALUES(company),
            job_title = VALUES(job_title),
            street_address = VALUES(street_address),
            city = VALUES(city),
            region = VALUES(region),
            postal_code = VALUES(postal_code),
            country = VALUES(country),
            notes = VALUES(notes),
            show_in_directory = VALUES(show_in_directory),
            updated_by = VALUES(updated_by)`,
        [
            username,
            profile.company,
            profile.jobTitle,
            profile.streetAddress,
            profile.city,
            profile.region,
            profile.postalCode,
            profile.country,
            profile.notes,
            profile.showInDirectory,
            profile.updatedBy,
        ]
    );
};

apiRouter.get('/branding', async (_req, res) => {
    try {
        const settings = await getBrandingSettings();
        res.json({ success: true, settings });
    } catch (err: any) {
        console.error('Failed to load branding settings:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.post('/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const normalizedUsername = normalizeMailboxUsername(username || '');
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    try {
        const [rows]: any = await pool.query('SELECT password FROM mailbox WHERE username = ? AND active = 1', [normalizedUsername]);
        if (rows.length === 0) {
            logAuthFailure(clientIp, normalizedUsername, 'unknown user');
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        const dbHash = rows[0].password;

        // Dovecot sometimes stores bcrypt hashes starting with $2y$
        let isValid = false;
        if (dbHash.startsWith('$2y$') || dbHash.startsWith('$2a$') || dbHash.startsWith('$2b$')) {
            isValid = await bcrypt.compare(password, dbHash);
        } else {
            // For now, if it's some other format we can't parse easily with bcryptjs, we'll reject or mock
            // In a real scenario we'd handle Dovecot SHA512-CRYPT
            isValid = false;
        }

        if (isValid) {
            // Check if user is an admin
            const [adminRows]: any = await pool.query('SELECT 1 FROM admin WHERE username = ? AND active = 1', [normalizedUsername]);
            const isAdmin = adminRows.length > 0;

            await createSession(res, { username: normalizedUsername, password, isAdmin });
            res.json({ success: true, isAdmin, username: normalizedUsername });
        } else {
            logAuthFailure(clientIp, normalizedUsername, 'invalid password');
            res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.post('/auth/logout', async (req, res) => {
    await clearSession(req, res);
    res.json({ success: true });
});

apiRouter.get('/auth/me', requireAuth, (req: any, res) => {
    res.json({ success: true, user: { username: req.user.username, isAdmin: req.user.isAdmin } });
});

apiRouter.post('/account/password', requireAuth, async (req: any, res) => {
    const { current, new: newPassword } = req.body;
    const normalizedUsername = req.user.username;

    try {
        const securitySettings = await getAdminSettings('security') as any;
        if (securitySettings?.allowUserPasswordChange === false) {
            return res.status(403).json({ success: false, error: 'Password changes are disabled by your administrator.' });
        }

        const [rows]: any = await pool.query('SELECT password FROM mailbox WHERE username = ? AND active = 1', [normalizedUsername]);
        if (rows.length === 0) {
            return res.status(401).json({ success: false, error: 'User not found' });
        }
        
        const dbHash = rows[0].password;
        let isValid = false;
        if (dbHash.startsWith('$2y$') || dbHash.startsWith('$2a$') || dbHash.startsWith('$2b$')) {
            isValid = await bcrypt.compare(current, dbHash);
        } else {
            return res.status(400).json({ success: false, error: 'Unsupported password hash format' });
        }

        if (!isValid) {
            return res.status(400).json({ success: false, error: 'Current password incorrect' });
        }

        const newHash = await bcrypt.hash(newPassword, 10);
        const dovecotCompatHash = newHash.replace(/^\$2b\$/, '$2y$');

        await pool.query('UPDATE mailbox SET password = ?, modified = NOW() WHERE username = ?', [dovecotCompatHash, normalizedUsername]);
        
        await clearSession(req, res);
        res.json({ success: true, message: 'Password updated successfully. Please log in again.' });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.get('/account/sessions', requireAuth, async (req: any, res) => {
    try {
        const db = await pool.getConnection();
        try {
            const [rows] = await db.query(
                `SELECT id_hash, created_at, updated_at FROM webmail_sessions
                 WHERE username = ? AND expires_at > NOW() ORDER BY updated_at DESC`,
                [req.user.username]
            );
            const rawId = req.cookies?.oms_session || '';
            const currentHash = crypto.createHash('sha256').update(rawId).digest('hex');
            const sessions = (rows as any[]).map(r => ({
                id: r.id_hash.substring(0, 8),
                created_at: r.created_at,
                updated_at: r.updated_at,
                isCurrent: r.id_hash === currentHash
            }));
            res.json({ success: true, sessions });
        } finally {
            db.release();
        }
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.delete('/account/sessions/:id', requireAuth, async (req: any, res) => {
    try {
        const rawId = req.cookies?.oms_session || '';
        const currentHash = crypto.createHash('sha256').update(rawId).digest('hex');
        if (currentHash.startsWith(req.params.id)) {
            return res.status(400).json({ success: false, error: 'Cannot revoke your current session.' });
        }
        const db = await pool.getConnection();
        try {
            const [result] = await db.query(
                `DELETE FROM webmail_sessions WHERE id_hash LIKE ? AND username = ?`,
                [`${req.params.id}%`, req.user.username]
            );
            const affected = (result as any).affectedRows || 0;
            res.json({ success: true, revoked: affected });
        } finally {
            db.release();
        }
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.get('/rules', requireAuth, async (req: any, res) => {
    const user = req.user.username;
    const pass = req.user.password;

    try {
        const client = new ManageSieveClient(sieveConfig.host, sieveConfig.port, sieveConfig.masterUser, sieveConfig.masterPass);
        await client.connect();
        await client.login(user, pass);
        
        let script = '';
        try {
            script = await client.getScript('webmail');
        } catch (e) {
            // Script might not exist yet
        }
        
        await client.logout();
        
        const jsonData = extractJsonFromSieve(script);
        res.json(jsonData);
    } catch (err: any) {
        console.error('Failed to get rules:', err);
        res.status(500).json({ error: err.message });
    }
});

apiRouter.post('/rules', requireAuth, async (req: any, res) => {
    const user = req.user.username;
    const pass = req.user.password;

    try {
        const jsonData = req.body;
        const scriptContent = compileSieve(jsonData);

        const client = new ManageSieveClient(sieveConfig.host, sieveConfig.port, sieveConfig.masterUser, sieveConfig.masterPass);
        await client.connect();
        await client.login(user, pass);
        
        await client.putScript('webmail', scriptContent);
        await client.setActive('webmail');
        await client.logout();
        
        res.json({ success: true, message: 'Rules updated and activated' });
    } catch (err: any) {
        console.error('Failed to save rules:', err);
        res.status(500).json({ error: err.message });
    }
});

apiRouter.get('/quota', requireAuth, async (req: any, res) => {
    const user = req.user.username;
    const pass = req.user.password;

    try {
        const { ImapService } = require('./imap');
        const imap = new ImapService(user, pass);
        await imap.connect();
        const quota = await imap.getQuota();
        await imap.logout();
        
        res.json({ success: true, quota });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

apiRouter.get('/folders', requireAuth, async (req: any, res) => {
    const user = req.user.username;
    const pass = req.user.password;

    try {
        const { ImapService } = require('./imap');
        const imap = new ImapService(user, pass);
        await imap.connect();
        const folders = await imap.getFolders();
        await imap.logout();
        
        res.json({ success: true, folders });
    } catch (err: any) {
        console.error('Failed to fetch folders:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.get('/events', requireAuth, async (req: any, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const user = req.user.username;
    const pass = req.user.password;
    const folder = req.query.folder || 'INBOX';
    
    const { ImapService } = require('./imap');
    const imap = new ImapService(user, pass);
    
    try {
        await imap.connect();
        
        let isClosed = false;
        
        req.on('close', async () => {
            isClosed = true;
            try { await imap.logout(); } catch(e) {}
        });

        // Start listening to the folder
        const lock = await imap.client.getMailboxLock(folder);
        
        const onExists = () => {
            if (!isClosed) res.write(`data: ${JSON.stringify({ type: 'newMessage', folder })}\n\n`);
        };
        const onFlags = () => {
            if (!isClosed) res.write(`data: ${JSON.stringify({ type: 'flagsUpdate', folder })}\n\n`);
        };
        
        imap.client.on('exists', onExists);
        imap.client.on('flags', onFlags);

        // Optional: Send a ping every 15 seconds to keep connection alive
        const pingInterval = setInterval(() => {
            if (!isClosed) res.write(': ping\n\n');
        }, 15000);

        req.on('close', () => {
            clearInterval(pingInterval);
            imap.client.removeListener('exists', onExists);
            imap.client.removeListener('flags', onFlags);
            lock.release();
        });
        
    } catch (e: any) {
        console.error('SSE Error:', e);
        res.end();
    }
});

apiRouter.get('/folders/:folder/messages', requireAuth, async (req: any, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const folder = req.params.folder;
    const olderThan = parseInt(String(req.query.olderThan || ''), 10);
    const fetchOlderThan = Number.isFinite(olderThan) && olderThan > 1 ? olderThan : undefined;
    
    if (folder === 'SCHEDULED') {
        try {
            const [rows]: any = await pool.query('SELECT id, send_at, mail_options FROM scheduled_emails WHERE username = ? ORDER BY send_at ASC', [user]);
            const messages = rows.map((r: any) => {
                let opts: any = {};
                try { opts = JSON.parse(r.mail_options); } catch (e) {}
                return {
                    uid: r.id + 100000000, // fake high UID to avoid collisions
                    id: r.id,
                    subject: opts.subject || '(No Subject)',
                    from: [{ address: opts.from || user, name: '' }],
                    to: opts.to ? opts.to.split(',').map((t: string) => ({ address: t, name: '' })) : [],
                    date: r.send_at,
                    flags: [],
                    unseen: false,
                    is_scheduled: true
                };
            });
            return res.json({ success: true, messages, moreAvailable: false });
        } catch (err: any) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }
    
    try {
        const { ImapService } = require('./imap');
        const simpleParser = require('mailparser').simpleParser;
        const imap = new ImapService(user, pass);
        await imap.connect();
        await restoreExpiredSnoozes(user, imap);
        const { messages, uidNext, lowestUid, moreAvailable } = await imap.getMessages(folder, undefined, fetchOlderThan);
        await imap.logout();
        
        const parsedMessages = [];
        const indexRows: MailSearchIndexRow[] = [];
        for (let msg of messages) {
            const parsed = await simpleParser(msg.source);
            const summary = parsedMailToSummary(folder, msg, parsed);
            parsedMessages.push(summary);
            indexRows.push(parsedMailToIndexRow(folder, msg, parsed));
        }
        try {
            await upsertMailSearchRows(user, indexRows);
        } catch (indexErr) {
            console.error('Failed to update mail search index:', indexErr);
        }
        res.json({
            success: true,
            messages: parsedMessages.reverse(),
            uidNext,
            lowestUid,
            moreAvailable
        });
    } catch (err: any) {
        console.error('Failed to fetch messages:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET raw message source
apiRouter.get('/folders/:folder/messages/:uid/raw', requireAuth, async (req: any, res) => {
    try {
        const { ImapService } = require('./imap');
        const imap = new ImapService(req.user.username, req.user.password);
        await imap.connect();
        await imap.client.mailboxOpen(req.params.folder);
        const msg = await imap.client.fetchOne(req.params.uid, { source: true });
        await imap.logout();
        if (!msg || !msg.source) return res.status(404).json({ error: 'Message not found' });
        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.send(msg.source.toString());
    } catch (err: any) {
        res.status(500).json({ error: err.message || 'Failed to fetch raw message' });
    }
});

// Snooze messages
apiRouter.post('/messages/snooze', requireAuth, async (req: any, res) => {
    try {
        const { ImapService } = require('./imap');
        const { folder, uids, until } = req.body;
        if (!uids || !uids.length || !until) return res.status(400).json({ error: 'Missing uids or until' });
        const untilDate = new Date(until);
        if (isNaN(untilDate.getTime())) return res.status(400).json({ error: 'Invalid until date' });

        const imap = new ImapService(req.user.username, req.user.password);
        await imap.connect();
        try { await imap.client.mailboxCreate('Snoozed'); } catch (e) { /* may exist */ }
        await imap.client.mailboxOpen(folder);
        await imap.client.messageMove(uids.map(String), 'Snoozed');
        await pool.execute(
            `INSERT INTO snooze_queue (owner, original_folder, imap_uid, snooze_until) VALUES ${uids.map(() => '(?, ?, ?, ?)').join(', ')}`,
            uids.flatMap((uid: number) => [req.user.username, folder, uid, untilDate.toISOString()])
        );
        await imap.logout();
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message || 'Snooze failed' });
    }
});

// Restore expired snoozes (best-effort)
async function restoreExpiredSnoozes(user: string, imapService: any) {
    try {
        const [expired]: any = await pool.execute(
            `SELECT id, original_folder, imap_uid FROM snooze_queue WHERE owner = ? AND snooze_until <= NOW()`, [user]
        );
        if (Array.isArray(expired) && expired.length > 0) {
            try { await imapService.client.mailboxOpen('Snoozed'); } catch (e) { return; }
            for (const row of expired) {
                try { await imapService.client.messageMove([String(row.imap_uid)], row.original_folder); } catch (e) {}
            }
            await pool.execute(`DELETE FROM snooze_queue WHERE owner = ? AND snooze_until <= NOW()`, [user]);
        }
    } catch (e) {}
}

// Mute thread
apiRouter.post('/messages/mute', requireAuth, async (req: any, res) => {
    try {
        const { uids } = req.body;
        if (!uids || !uids.length) return res.status(400).json({ error: 'Missing uids' });
        const user = req.user.username;
        await pool.execute(
            `INSERT IGNORE INTO muted_threads (owner, imap_uid) VALUES ${uids.map(() => '(?, ?)').join(', ')}`,
            uids.flatMap((uid: number) => [user, uid])
        );
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message || 'Mute failed' });
    }
});

// Check muted UIDs for filtering
async function getMutedUids(user: string): Promise<Set<number>> {
    try {
        const [rows]: any = await pool.execute('SELECT imap_uid FROM muted_threads WHERE owner = ?', [user]);
        return new Set((rows || []).map((r: any) => r.imap_uid));
    } catch { return new Set(); }
}

apiRouter.get('/messages/search/index/status', requireAuth, async (req: any, res) => {
    try {
        const status = await getMailSearchIndexStatus(req.user.username);
        res.json({ success: true, ...status });
    } catch (err: any) {
        console.error('Failed to get mail search index status:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.get('/messages/search/worker/status', requireAuth, async (req: any, res) => {
    try {
        const status = await getSearchWorkerStatus();
        res.json({ success: true, ...status });
    } catch (err: any) {
        console.error('Failed to get search worker status:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.delete('/messages/search/index', requireAuth, async (req: any, res) => {
    try {
        const username = req.user.username;
        const deletedCount = await purgeUserSearchIndex(username);
        res.json({ success: true, deletedCount, message: `Purged ${deletedCount} index entries. Background worker will re-index automatically.` });
    } catch (err: any) {
        console.error('Failed to purge search index:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.post('/messages/search/index/sync', requireAuth, async (req: any, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const scope = req.body?.scope === 'all' ? 'all' : 'folder';
    const folder = String(req.body?.folder || 'INBOX');
    const requestedLimit = Math.max(1, Math.min(parseInt(String(req.body?.limit || (scope === 'all' ? '40' : '100')), 10) || 100, 250));
    const perFolderLimit = scope === 'all' ? Math.min(requestedLimit, 40) : requestedLimit;

    const { ImapService } = require('./imap');
    const simpleParser = require('mailparser').simpleParser;
    const imap = new ImapService(user, pass);

    try {
        await imap.connect();
        const folderPaths = scope === 'all'
            ? (await imap.getFolders()).map((f: any) => f.path)
            : [folder];

        let indexed = 0;
        for (const folderPath of folderPaths) {
            const maxUid = await getMaxIndexedUid(user, folderPath);
            const messages = maxUid > 0
                ? await imap.getMessagesSinceUid(folderPath, maxUid + 1, perFolderLimit)
                : await imap.getRecentMessagesForIndex(folderPath, Math.min(perFolderLimit, 50));
            const rows: MailSearchIndexRow[] = [];
            for (const msg of messages) {
                const parsed = await simpleParser(msg.source);
                rows.push(parsedMailToIndexRow(folderPath, msg, parsed));
            }
            indexed += await upsertMailSearchRows(user, rows);
        }

        res.json({ success: true, indexed, folders: folderPaths.length, perFolderLimit, mode: 'incremental' });
    } catch (err: any) {
        console.error('Failed to synchronize mail search index:', err);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        try { await imap.logout(); } catch (e) {}
    }
});

apiRouter.post('/messages/search/index', requireAuth, async (req: any, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const scope = req.body?.scope === 'all' ? 'all' : 'folder';
    const folder = String(req.body?.folder || 'INBOX');
    const requestedLimit = Math.max(1, Math.min(parseInt(String(req.body?.limit || (scope === 'all' ? '50' : '200')), 10) || 50, 250));
    const perFolderLimit = scope === 'all' ? Math.min(requestedLimit, 75) : requestedLimit;

    const { ImapService } = require('./imap');
    const simpleParser = require('mailparser').simpleParser;
    const imap = new ImapService(user, pass);

    try {
        await imap.connect();
        const folderPaths = scope === 'all'
            ? (await imap.getFolders()).map((f: any) => f.path)
            : [folder];

        let indexed = 0;
        for (const folderPath of folderPaths) {
            const messages = await imap.getRecentMessagesForIndex(folderPath, perFolderLimit);
            const rows: MailSearchIndexRow[] = [];
            for (const msg of messages) {
                const parsed = await simpleParser(msg.source);
                rows.push(parsedMailToIndexRow(folderPath, msg, parsed));
            }
            indexed += await upsertMailSearchRows(user, rows);
        }

        res.json({ success: true, indexed, folders: folderPaths.length, perFolderLimit });
    } catch (err: any) {
        console.error('Failed to rebuild mail search index:', err);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        try { await imap.logout(); } catch (e) {}
    }
});

apiRouter.get('/messages/search/saved', requireAuth, async (req: any, res) => {
    try {
        const savedSearches = await listSavedMailSearches(req.user.username);
        res.json({ success: true, savedSearches });
    } catch (err: any) {
        console.error('Failed to list saved mail searches:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.post('/messages/search/saved', requireAuth, async (req: any, res) => {
    const name = String(req.body?.name || '').trim();
    const query = String(req.body?.query || '').trim();
    const field: IndexedMailSearchField = allowedSearchFields.includes(req.body?.field) ? req.body.field : 'all';
    const scope = req.body?.scope === 'all' ? 'all' : 'folder';
    const folder = String(req.body?.folder || 'INBOX');

    if (name.length < 1 || name.length > 80) {
        return res.status(400).json({ success: false, error: 'Saved search name must be 1-80 characters.' });
    }
    if (!isBlankAllowedSearchField(field) && query.length < 2) {
        return res.status(400).json({ success: false, error: 'Search query must be at least 2 characters.' });
    }
    if (query.length > 128) {
        return res.status(400).json({ success: false, error: 'Search query is too long.' });
    }

    try {
        const savedSearch = await createSavedMailSearch(req.user.username, { name, query, field, scope, folder });
        res.json({ success: true, savedSearch });
    } catch (err: any) {
        console.error('Failed to save mail search:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.delete('/messages/search/saved/:id', requireAuth, async (req: any, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id < 1) {
        return res.status(400).json({ success: false, error: 'Invalid saved search id.' });
    }

    try {
        const deleted = await deleteSavedMailSearch(req.user.username, id);
        res.json({ success: true, deleted });
    } catch (err: any) {
        console.error('Failed to delete saved mail search:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.get('/messages/search', requireAuth, async (req: any, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const query = String(req.query.q || '').trim();
    const field: IndexedMailSearchField = allowedSearchFields.includes(req.query.field) ? req.query.field : 'all';
    const scope = req.query.scope === 'all' ? 'all' : 'folder';
    const folder = String(req.query.folder || 'INBOX');
    const limit = Math.max(1, Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 100));

    if (!isBlankAllowedSearchField(field) && query.length < 2) {
        return res.status(400).json({ success: false, error: 'Search query must be at least 2 characters.' });
    }
    if (query.length > 128) {
        return res.status(400).json({ success: false, error: 'Search query is too long.' });
    }

    const { ImapService } = require('./imap');
    const simpleParser = require('mailparser').simpleParser;
    const imap = new ImapService(user, pass);

    try {
        const indexedMessages = await searchMailIndex(user, { query, field, scope, folder, limit });
        if (indexedMessages.length > 0 || field === 'attachments') {
            return res.json({ success: true, messages: indexedMessages, query, scope, field, source: 'index' });
        }

        await imap.connect();
        const folderPaths = scope === 'all'
            ? (await imap.getFolders()).map((f: any) => f.path)
            : [folder];
        const results = await imap.searchMessages(folderPaths, query, field, limit);

        const parsedMessages = [];
        const indexRows: MailSearchIndexRow[] = [];
        for (let msg of results) {
            const parsed = await simpleParser(msg.source);
            parsedMessages.push(parsedMailToSummary(msg.folder, msg, parsed, 180));
            indexRows.push(parsedMailToIndexRow(msg.folder, msg, parsed));
        }
        try {
            await upsertMailSearchRows(user, indexRows);
        } catch (indexErr) {
            console.error('Failed to update mail search index from IMAP search:', indexErr);
        }

        parsedMessages.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
        res.json({ success: true, messages: parsedMessages.slice(0, limit), query, scope, field, source: 'imap' });
    } catch (err: any) {
        console.error('Failed to search messages:', err);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        try { await imap.logout(); } catch (e) {}
    }
});

const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: serverConfig.uploadLimitBytes } });

apiRouter.post('/messages/send', requireAuth, upload.array('attachments'), async (req: any, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const { from, to, cc, bcc, replyTo, subject, html, text, draftUid } = req.body;
    const files = req.files || [];

    try {
        const nodemailer = require('nodemailer');
        
        const transporter = nodemailer.createTransport({
            host: smtpConfig.host,
            port: smtpConfig.port,
            secure: smtpConfig.secure,
            auth: { user, pass },
            tls: { rejectUnauthorized: smtpConfig.rejectUnauthorized }
        });

        // Ensure "from" is valid. If it's just an email, format it. If we can get a name, use it.
        // If the user didn't specify from or it's empty, default to their username.
        const senderEmail = from || user;
        const [mailboxRows]: any = await pool.query('SELECT name FROM mailbox WHERE username = ?', [user]);
        const senderName = mailboxRows.length > 0 && mailboxRows[0].name ? mailboxRows[0].name : '';
        const fromHeader = senderName ? `"${senderName}" <${senderEmail}>` : senderEmail;

        const mailOptions: any = {
            from: fromHeader,
            to,
            cc,
            bcc,
            replyTo,
            subject,
            text,
            html,
            attachments: files.map((f: any) => ({
                filename: f.originalname,
                content: f.buffer
            }))
        };

        const delaySeconds = parseInt(req.body.delaySeconds || '0', 10);
        
        if (delaySeconds > 0) {
            const scheduledOptions = {
                ...mailOptions,
                attachments: files.map((f: any) => ({
                    filename: f.originalname,
                    content: f.buffer.toString('base64'),
                    encoding: 'base64'
                }))
            };
            const sendAt = new Date(Date.now() + delaySeconds * 1000);
            
            const { ensureScheduledEmailsSchema } = require('./scheduled-send');
            await ensureScheduledEmailsSchema();
            
            const [insertRes]: any = await pool.query(
                'INSERT INTO scheduled_emails (username, send_at, mail_options, draft_uid) VALUES (?, ?, ?, ?)',
                [user, sendAt, JSON.stringify(scheduledOptions), draftUid ? parseInt(draftUid, 10) : null]
            );
            
            return res.json({ success: true, scheduledId: insertRes.insertId, sendAt, message: 'Message scheduled' });
        }

        const info = await transporter.sendMail(mailOptions);
        
        const contactsSettings = await getUserSettings(user, 'contacts') as any;
        
        if (contactsSettings.autoCreateFromSent !== false) {
            const allRecipients = [to, cc, bcc].filter(Boolean).join(',');
            if (allRecipients) {
                const emails = allRecipients.split(',').map((e: string) => e.trim());
                for (const email of emails) {
                    if (email) {
                        const match = email.match(/(.*)<(.+)>/);
                        let contactName = '';
                        let contactEmail = email;
                        if (match) {
                            contactName = match[1].replace(/"/g, '').trim();
                            contactEmail = match[2].trim();
                        }
                        if (!contactName) contactName = contactEmail.split('@')[0];
                        try {
                            await pool.query('INSERT IGNORE INTO contacts (username, name, email) VALUES (?, ?, ?)', [user, contactName, contactEmail]);
                        } catch(e) {}
                    }
                }
            }
        }
        
        const { ImapService } = require('./imap');
        const imap = new ImapService(user, pass);
        await imap.connect();
        
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

        // Delete draft if one exists
        if (draftUid) {
            let draftsFolder = folders.find((f: any) => f.path.toLowerCase().includes('draft'))?.path;
            if (draftsFolder) {
                try {
                    await imap.messageAction(draftsFolder, [parseInt(draftUid, 10)], 'delete');
                } catch(e) {
                    console.error('Failed to delete sent draft', e);
                }
            }
        }

        await imap.logout();

        res.json({ success: true });
    } catch (err: any) {
        console.error('Failed to parse message:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.post('/messages/undo', requireAuth, require('express').json(), async (req: any, res) => {
    const user = req.user.username;
    const { scheduledId } = req.body;
    
    if (!scheduledId) {
        return res.status(400).json({ success: false, error: 'scheduledId is required' });
    }
    
    try {
        const [result]: any = await pool.query('DELETE FROM scheduled_emails WHERE id = ? AND username = ?', [scheduledId, user]);
        if (result.affectedRows > 0) {
            res.json({ success: true, message: 'Message send undone' });
        } else {
            res.status(404).json({ success: false, error: 'Scheduled message not found or already sent' });
        }
    } catch (err: any) {
        console.error('Undo error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.post('/messages/draft', requireAuth, upload.array('attachments'), async (req: any, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const { from, to, cc, bcc, replyTo, subject, html, text, draftUid } = req.body;
    const files = req.files || [];

    try {
        const nodemailer = require('nodemailer');
        const senderEmail = from || user;
        const [mailboxRows]: any = await pool.query('SELECT name FROM mailbox WHERE username = ?', [user]);
        const senderName = mailboxRows.length > 0 && mailboxRows[0].name ? mailboxRows[0].name : '';
        const fromHeader = senderName ? `"${senderName}" <${senderEmail}>` : senderEmail;

        const mailOptions: any = {
            from: fromHeader,
            to: to || '',
            cc: cc || '',
            bcc: bcc || '',
            replyTo: replyTo || '',
            subject: subject || 'No Subject',
            text: text || '',
            html: html || '',
            headers: {},
            attachments: files.map((f: any) => ({
                filename: f.originalname,
                content: f.buffer
            }))
        };
        
        const draftId = req.body.draftId;
        if (draftId) {
            mailOptions.headers['X-Draft-Id'] = draftId;
        }

        const { ImapService } = require('./imap');
        const imap = new ImapService(user, pass);
        await imap.connect();
        
        const folders = await imap.getFolders();
        let draftsFolder = folders.find((f: any) => f.path.toLowerCase().includes('draft'))?.path;
        if (!draftsFolder) {
            try { await imap.client.mailboxCreate('Drafts'); } catch(e) {}
            draftsFolder = 'Drafts';
        }
        
        const MailComposer = require('nodemailer/lib/mail-composer');
        const mail = new MailComposer(mailOptions);
        const rawMessage = await mail.compile().build();
        
        const uidsToDelete: number[] = [];
        
        // If there's a previous draftUid, add it to deletion list
        if (draftUid) {
            uidsToDelete.push(parseInt(draftUid, 10));
        }
        
        // Search for any existing drafts with this draftId
        if (draftId) {
            try {
                await imap.client.mailboxOpen(draftsFolder);
                const searchRes = await imap.client.search({ header: { 'x-draft-id': draftId } });
                if (searchRes && searchRes.length > 0) {
                    for (const uid of searchRes) {
                        if (!uidsToDelete.includes(uid)) uidsToDelete.push(uid);
                    }
                }
            } catch(e) {
                console.error('Failed to search for existing drafts by draftId', e);
            }
        }
        
        if (uidsToDelete.length > 0) {
            try {
                await imap.messageAction(draftsFolder, uidsToDelete, 'delete');
            } catch(e) {
                console.error('Failed to delete old drafts', e);
            }
        }

        const appendRes = await imap.client.append(draftsFolder, rawMessage, ['\\Draft', '\\Seen']);
        await imap.logout();

        res.json({ success: true, draftUid: appendRes.uid });
    } catch (err: any) {
        console.error('Failed to save draft:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.post('/messages/action', requireAuth, async (req: any, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const { folder, uids, action, targetFolder } = req.body;
    const allowedActions = ['delete', 'archive', 'spam', 'move', 'read', 'unread', 'star', 'unstar'];

    if (!folder || !uids || !Array.isArray(uids) || uids.length === 0 || !allowedActions.includes(action)) {
        return res.status(400).json({ success: false, error: 'Missing required parameters' });
    }

    try {
        const { ImapService } = require('./imap');
        const imap = new ImapService(user, pass);
        await imap.connect();
        const actionResult = await imap.messageAction(folder, uids, action, targetFolder);
        await imap.logout();

        try {
            if (action === 'read') {
                await updateMailSearchFlags(user, folder, uids, { isRead: true });
            } else if (action === 'unread') {
                await updateMailSearchFlags(user, folder, uids, { isRead: false });
            } else if (action === 'star') {
                await updateMailSearchFlags(user, folder, uids, { isStarred: true });
            } else if (action === 'unstar') {
                await updateMailSearchFlags(user, folder, uids, { isStarred: false });
            } else {
                await deleteMailSearchRows(user, folder, uids);
            }
        } catch (indexErr) {
            console.error('Failed to update mail search index after message action:', indexErr);
        }
        
        const uidMap = actionResult?.uidMap || null;
        const undoUids = uidMap
            ? uids.map((uid: number) => Number(uidMap[String(uid)] || uidMap[uid])).filter((uid: number) => Number.isFinite(uid))
            : [];

        res.json({
            success: true,
            targetFolder: actionResult?.targetFolder,
            undoUids,
        });
    } catch (err: any) {
        console.error('Failed to perform action:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.get('/folders/:folder/messages/:uid/attachments/:attachmentId', requireAuth, async (req: any, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const folder = req.params.folder;
    const uid = parseInt(req.params.uid, 10);
    const attachmentId = parseInt(req.params.attachmentId, 10);
    const forceDownload = req.query.download === '1';

    if (!Number.isFinite(uid) || uid < 1 || !Number.isFinite(attachmentId) || attachmentId < 0) {
        return res.status(400).json({ success: false, error: 'Invalid attachment request' });
    }

    const { ImapService } = require('./imap');
    const simpleParser = require('mailparser').simpleParser;
    const imap = new ImapService(user, pass);

    try {
        await imap.connect();
        const msg = await imap.getMessageByUid(folder, uid);
        await imap.logout();

        if (!msg) return res.status(404).json({ success: false, error: 'Message not found' });

        const parsed = await simpleParser(msg.source);
        const attachments = getVisibleAttachments(parsed);
        const attachment = attachments[attachmentId];

        if (!attachment || !attachment.content) {
            return res.status(404).json({ success: false, error: 'Attachment not found' });
        }

        const contentType = attachment.contentType || 'application/octet-stream';
        const filename = attachment.filename || `attachment-${attachmentId + 1}`;
        const disposition = forceDownload || !isPreviewableAttachment(contentType) ? 'attachment' : 'inline';

        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', attachment.content.length);
        res.setHeader('Content-Disposition', `${disposition}; ${encodeAttachmentFilename(filename)}`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.send(attachment.content);
    } catch (err: any) {
        console.error('Failed to fetch attachment:', err);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    } finally {
        try { await imap.logout(); } catch (e) {}
    }
});

apiRouter.get('/folders/:folder/messages/:uid', requireAuth, async (req: any, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const folder = req.params.folder;
    const uid = parseInt(req.params.uid);
    
    if (folder === 'SCHEDULED') {
        try {
            const realId = uid - 100000000;
            const [rows]: any = await pool.query('SELECT * FROM scheduled_emails WHERE id = ? AND username = ?', [realId, user]);
            if (rows.length === 0) return res.status(404).json({ success: false, error: 'Not found' });
            
            let opts: any = {};
            try { opts = JSON.parse(rows[0].mail_options); } catch (e) {}
            
            return res.json({
                success: true,
                message: {
                    uid,
                    subject: opts.subject || '(No Subject)',
                    from: [{ address: opts.from || user, name: '' }],
                    to: opts.to ? opts.to.split(',').map((t: string) => ({ address: t, name: '' })) : [],
                    cc: opts.cc ? opts.cc.split(',').map((t: string) => ({ address: t, name: '' })) : [],
                    bcc: opts.bcc ? opts.bcc.split(',').map((t: string) => ({ address: t, name: '' })) : [],
                    date: rows[0].send_at,
                    html: opts.html || '',
                    text: opts.text || '',
                    attachments: [], // We won't try to parse attachments for scheduled messages for now
                    is_scheduled: true,
                    scheduled_id: realId
                }
            });
        } catch (err: any) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }
    
    try {
        const { ImapService } = require('./imap');
        const simpleParser = require('mailparser').simpleParser;
        const imap = new ImapService(user, pass);
        await imap.connect();
        const msg = await imap.getMessageByUid(folder, uid);
        await imap.logout();
        
        if (!msg) return res.status(404).json({ success: false, error: 'Not found' });
        
        const parsed = await simpleParser(msg.source);
        res.json({ 
            success: true, 
            message: {
                uid: msg.uid,
                subject: parsed.subject || '(No Subject)',
                from: (parsed.from as any)?.text || '',
                to: (parsed.to as any)?.text || '',
                date: parsed.date,
                html: parsed.html || parsed.textAsHtml,
                text: parsed.text,
                isRead: msg.flags.includes('\\Seen'),
                isStarred: msg.flags.includes('\\Flagged'),
                hasAttachments: getVisibleAttachments(parsed).length > 0,
                attachments: getAttachmentMetadata(parsed),
                draftId: parsed.headers.get('x-draft-id'),
                messageId: parsed.messageId || '',
                inReplyTo: parsed.inReplyTo || '',
                references: parsed.references || []
            }
        });
    } catch (err: any) {
        console.error('Failed to fetch message:', err);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

apiRouter.get('/user/identities', requireAuth, async (req: any, res) => {
    try {
        const username = req.user.username;
        const [mailboxRows]: any = await pool.query('SELECT name FROM mailbox WHERE username = ?', [username]);
        const name = mailboxRows.length > 0 ? mailboxRows[0].name : '';
        
        const [aliasRows]: any = await pool.query('SELECT address FROM alias WHERE goto LIKE ? AND active = 1', [`%${username}%`]);
        const aliases = aliasRows.map((row: any) => row.address).filter((addr: string) => addr !== username);

        res.json({ success: true, name, address: username, aliases });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.get('/contacts', requireAuth, async (req: any, res) => {
    const user = req.user.username;
    try {
        const [rows]: any = await pool.query('SELECT id, name, email, phone FROM contacts WHERE username = ?', [user]);
        res.json({ success: true, contacts: rows });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.get('/directory', requireAuth, async (req: any, res) => {
    try {
        await ensureMailboxProfileSchema();
        const q = req.query.q ? String(req.query.q) : '';
        
        let sql = `
            SELECT
                m.username AS email,
                m.name,
                m.phone,
                m.email_other,
                p.company,
                p.job_title,
                p.street_address,
                p.city,
                p.region,
                p.postal_code,
                p.country,
                p.notes
            FROM mailbox m
            LEFT JOIN webmail_mailbox_profiles p ON p.username = m.username
            WHERE m.active = 1
              AND COALESCE(p.show_in_directory, 1) = 1
        `;
        
        const params: any[] = [];
        
        if (q) {
            sql += ` AND (m.username LIKE ? OR m.name LIKE ? OR m.phone LIKE ? OR p.job_title LIKE ? OR p.company LIKE ?)`;
            const likeTerm = `%${q}%`;
            params.push(likeTerm, likeTerm, likeTerm, likeTerm, likeTerm);
        }
        
        sql += ` ORDER BY m.name ASC, m.username ASC LIMIT 100`;
        
        const [rows]: any = await pool.query(sql, params);
        res.json({
            success: true,
            contacts: rows.map((row: any) => ({
                id: `directory:${row.email}`,
                name: row.name || row.email,
                email: row.email,
                phone: row.phone || '',
                alternateEmail: row.email_other || '',
                company: row.company || '',
                jobTitle: row.job_title || '',
                address: [row.street_address, row.city, row.region, row.postal_code, row.country].filter(Boolean).join(', '),
                notes: row.notes || '',
                source: 'directory',
            })),
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.post('/contacts', requireAuth, async (req: any, res) => {
    const user = req.user.username;
    const { name, email, phone } = req.body;
    if (!name || !email) return res.status(400).json({ success: false, error: 'Name and email required' });
    try {
        await pool.query(
            'INSERT INTO contacts (username, name, email, phone) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), phone = VALUES(phone)',
            [user, cleanTextInput(name), requireValidMailbox(email), cleanTextInput(phone, 30)]
        );
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.get('/settings/forwarding', requireAuth, async (req: any, res) => {
    const user = req.user.username;
    try {
        const [rows]: any = await pool.query('SELECT goto FROM alias WHERE address = ?', [user]);
        res.json({ success: true, goto: rows.length > 0 ? rows[0].goto : '' });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.post('/settings/forwarding', requireAuth, async (req: any, res) => {
    const user = req.user.username;
    const { goto } = req.body;
    try {
        await pool.query('UPDATE alias SET goto = ?, modified = NOW() WHERE address = ?', [goto, user]);
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.get('/settings/:namespace', requireAuth, async (req: any, res) => {
    const namespace = req.params.namespace;
    if (!isSettingsNamespace(namespace)) {
        return res.status(404).json({ success: false, error: 'Unknown settings namespace' });
    }

    try {
        const settings = await getUserSettings(req.user.username, namespace);
        res.json({ success: true, namespace, settings });
    } catch (err: any) {
        console.error('Failed to load user settings:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.put('/settings/:namespace', requireAuth, async (req: any, res) => {
    const namespace = req.params.namespace;
    if (!isSettingsNamespace(namespace)) {
        return res.status(404).json({ success: false, error: 'Unknown settings namespace' });
    }

    try {
        const settings = await saveUserSettings(req.user.username, namespace, req.body?.settings);
        res.json({ success: true, namespace, settings });
    } catch (err: any) {
        console.error('Failed to save user settings:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Admin Endpoints

apiRouter.get('/admin/branding', requireAuth, requireAdmin, async (_req: any, res) => {
    try {
        const settings = await getBrandingSettings();
        res.json({ success: true, settings });
    } catch (err: any) {
        console.error('Failed to load admin branding settings:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.put('/admin/branding', requireAuth, requireAdmin, async (req: any, res) => {
    try {
        const settings = await saveBrandingSettings(req.body?.settings, req.user.username);
        await logAdminAction(req, 'branding.update', 'branding', 'global', {
            appName: settings.appName,
            companyName: settings.companyName,
            imagesUpdated: ['appIconDataUrl', 'faviconDataUrl', 'loginLogoDataUrl', 'loginBackgroundDataUrl']
                .filter((key) => Object.prototype.hasOwnProperty.call(req.body?.settings || {}, key)),
        });
        res.json({ success: true, settings });
    } catch (err: any) {
        console.error('Failed to save admin branding settings:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.get('/admin/settings/:namespace', requireAuth, requireAdmin, async (req: any, res) => {
    const namespace = req.params.namespace;
    if (!isAdminSettingsNamespace(namespace)) {
        return res.status(404).json({ success: false, error: 'Unknown admin settings namespace' });
    }

    try {
        const settings = await getAdminSettings(namespace);
        res.json({ success: true, namespace, settings });
    } catch (err: any) {
        console.error('Failed to load admin settings:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.put('/admin/settings/:namespace', requireAuth, requireAdmin, async (req: any, res) => {
    const namespace = req.params.namespace;
    if (!isAdminSettingsNamespace(namespace)) {
        return res.status(404).json({ success: false, error: 'Unknown admin settings namespace' });
    }

    try {
        const settings = await saveAdminSettings(namespace, req.body?.settings, req.user.username);
        await logAdminAction(req, `settings.${namespace}.update`, 'admin_settings', namespace, { namespace });
        res.json({ success: true, namespace, settings });
    } catch (err: any) {
        console.error('Failed to save admin settings:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.get('/admin/domains', requireAuth, requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT
                d.domain,
                d.description,
                d.aliases,
                d.mailboxes,
                d.maxquota,
                d.quota,
                d.transport,
                d.backupmx,
                d.created,
                d.modified,
                d.active,
                dv.token AS verify_token
            FROM domain d
            LEFT JOIN domain_verification dv ON dv.domain = d.domain
            WHERE d.domain != "ALL"
        `);
        res.json({ success: true, data: rows });
    } catch (err: any) {
        console.error('Database Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.post('/admin/domains', requireAuth, requireAdmin, async (req, res) => {
    try {
        const domain = requireValidDomain(req.body?.domain);
        const maxquota = Math.max(0, parseQuotaBytes(req.body?.maxquota, 0));
        const quota = Math.max(0, parseQuotaBytes(req.body?.quota, 0));
        await pool.query(
            'INSERT INTO domain (domain, description, maxquota, quota, transport, active, created, modified) VALUES (?, "", ?, ?, "virtual", 1, NOW(), NOW())',
            [domain, maxquota, quota]
        );
        await logAdminAction(req, 'domain.create', 'domain', domain, { domain, maxquota, quota });
        res.json({ success: true });
    } catch (err: any) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});

apiRouter.get('/admin/domains/:domain/dns', requireAuth, requireAdmin, async (req, res) => {
    try {
        const domain = requireValidDomain(req.params.domain);
        let mailHost = os.hostname();
        try {
            mailHost = new URL(serverConfig.publicBaseUrl || `https://${serverConfig.defaultDomain || os.hostname()}`).hostname || mailHost;
        } catch {
            mailHost = serverConfig.defaultDomain || mailHost;
        }

        const records = [
            { type: 'MX', name: '@', value: `10 ${mailHost}.`, description: 'Mail exchanger' },
            { type: 'TXT', name: '@', value: `v=spf1 mx a:${mailHost} -all`, description: 'SPF record' },
            { type: 'TXT', name: '_dmarc', value: 'v=DMARC1; p=quarantine; sp=quarantine; adkim=r; aspf=r;', description: 'DMARC record' },
        ];

        const dkimPath = `/var/lib/rspamd/dkim/${domain}.pub`;
        if (fs.existsSync(dkimPath)) {
            const publicKey = fs.readFileSync(dkimPath, 'utf8');
            const match = publicKey.match(/\(\s*([^)]+)\s*\)/s);
            const value = match ? match[1].replace(/["\s]/g, '') : publicKey.replace(/-----[^-]+-----|\s/g, '');
            records.push({ type: 'TXT', name: 'mail._domainkey', value, description: 'DKIM public key' });
        } else {
            records.push({ type: 'TXT', name: 'mail._domainkey', value: 'Pending generation... (check back later)', description: 'DKIM public key' });
        }

        const [verificationRows]: any = await pool.query('SELECT token FROM domain_verification WHERE domain = ? LIMIT 1', [domain]);
        if (verificationRows.length > 0) {
            records.push({
                type: 'TXT',
                name: '_openmailstack',
                value: `openmailstack-verify=${verificationRows[0].token}`,
                description: 'Domain verification',
            });
        }

        res.json({ success: true, data: records });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.delete('/admin/domains/:domain', requireAuth, requireAdmin, async (req, res) => {
    try {
        const domain = requireValidDomain(req.params.domain);
        await withTransaction(async (connection) => {
            await connection.query('DELETE FROM mailbox WHERE domain = ?', [domain]);
            await connection.query('DELETE FROM alias WHERE domain = ?', [domain]);
            await connection.query('DELETE FROM alias_domain WHERE alias_domain = ? OR target_domain = ?', [domain, domain]);
            await connection.query('DELETE FROM domain_admins WHERE domain = ?', [domain]);
            await connection.query('DELETE FROM domain_verification WHERE domain = ?', [domain]);
            await connection.query('DELETE FROM domain WHERE domain = ?', [domain]);
        });
        await logAdminAction(req, 'domain.delete', 'domain', domain, { domain });
        res.json({ success: true });
    } catch (err: any) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});

// Admins
apiRouter.get('/admin/admins', requireAuth, requireAdmin, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT username, created, modified, active, superadmin FROM admin');
        res.json({ success: true, data: rows });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.post('/admin/admins', requireAuth, requireAdmin, async (req, res) => {
    try {
        const username = requireValidMailbox(req.body?.username);
        // Copy password from mailbox if they exist, otherwise use dummy password
        const [mbRows]: any = await pool.query('SELECT password FROM mailbox WHERE username = ?', [username]);
        const pass = mbRows.length > 0 ? mbRows[0].password : '';
        await pool.query('INSERT INTO admin (username, password, created, modified) VALUES (?, ?, NOW(), NOW()) ON DUPLICATE KEY UPDATE active=1', [username, pass]);
        await logAdminAction(req, 'admin.promote', 'admin', username, { username });
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.delete('/admin/admins/:username', requireAuth, requireAdmin, async (req, res) => {
    try {
        const username = requireValidMailbox(req.params.username);
        await pool.query('DELETE FROM admin WHERE username = ?', [username]);
        await logAdminAction(req, 'admin.demote', 'admin', username, { username });
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Telemetry & Metrics
apiRouter.get('/admin/telemetry/metrics', requireAuth, requireAdmin, async (req, res) => {
    try {
        res.set('Content-Type', promClient.register.contentType);
        res.end(await promClient.register.metrics());
    } catch (ex: any) {
        res.status(500).end(ex.message);
    }
});

apiRouter.get('/admin/telemetry/logs/live', requireAuth, requireAdmin, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const { spawn } = require('child_process');
    const journalctl = spawn('journalctl', ['-f', '-n', '100', '-u', 'postfix', '-u', 'dovecot', '-u', 'openmailstack']);

    journalctl.stdout.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
            if (line.trim()) {
                res.write(`data: ${line}\n\n`);
            }
        }
    });

    journalctl.stderr.on('data', (data: Buffer) => {
        console.error(`[Telemetry Logs] journalctl err: ${data}`);
    });

    req.on('close', () => {
        journalctl.kill();
    });
});

// System Health snapshot for dashboard
apiRouter.get('/admin/telemetry/system-health', requireAuth, requireAdmin, async (_req, res) => {
    try {
        const [load1, load5, load15] = os.loadavg();
        const memTotal = os.totalmem();
        const memFree = os.freemem();

        const { stdout: dfOut } = await execPromise('df -B1 / | tail -1');
        const dfParts = dfOut.trim().split(/\s+/);
        const diskTotal = parseInt(dfParts[1], 10);
        const diskUsed = parseInt(dfParts[2], 10);

        const services: Record<string, boolean> = {};
        for (const svc of ['postfix', 'dovecot', 'rspamd', 'fail2ban']) {
            try {
                await execPromise(`systemctl is-active --quiet ${svc}`);
                services[svc] = true;
            } catch { services[svc] = false; }
        }

        let mailQueue = 0;
        try {
            const { stdout } = await execPromise('postqueue -j 2>/dev/null || true');
            mailQueue = stdout.split('\n').filter((l: string) => l.trim().length > 0).length;
        } catch {}

        let connections = { imap: 0, smtp: 0, http: 0 };
        try {
            const { stdout: ssOut } = await execPromise('ss -tn state established 2>/dev/null');
            ssOut.split('\n').forEach((line: string) => {
                if (line.includes(':993 ') || line.includes(':143 ')) connections.imap++;
                else if (line.includes(':25 ') || line.includes(':465 ') || line.includes(':587 ')) connections.smtp++;
                else if (line.includes(':80 ') || line.includes(':443 ') || line.includes(':20000 ')) connections.http++;
            });
        } catch {}

        res.json({
            success: true,
            cpu: { load1, load5, load15 },
            memory: {
                total: memTotal,
                free: memFree,
                used: memTotal - memFree,
                usedPercent: Math.round(((memTotal - memFree) / memTotal) * 100),
            },
            disk: {
                total: diskTotal,
                used: diskUsed,
                usedPercent: Math.round((diskUsed / diskTotal) * 100),
            },
            services,
            mailQueue,
            connections,
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Fail2ban status with jail details
apiRouter.get('/admin/telemetry/fail2ban/status', requireAuth, requireAdmin, async (_req, res) => {
    try {
        const { stdout: statusOut } = await execPromise('sudo fail2ban-client status 2>/dev/null || echo "NOT_INSTALLED"');
        if (statusOut.includes('NOT_INSTALLED') || statusOut.includes('command not found')) {
            return res.json({ success: true, installed: false, jails: [] });
        }

        // Parse jail list from "|- Number of jail: N" and list of jail names
        const jailMatch = statusOut.match(/\|- Number of jail:\s*(\d+)/);
        if (!jailMatch || parseInt(jailMatch[1], 10) === 0) {
            return res.json({ success: true, installed: true, jails: [] });
        }

        const jailListMatch = statusOut.match(/Jail list:\s*(.+)/);
        const jailNames = jailListMatch ? jailListMatch[1].split(',').map((j: string) => j.trim()).filter(Boolean) : [];

        const jails = [];
        for (const name of jailNames) {
            try {
                const { stdout: jailOut } = await execPromise(`sudo fail2ban-client status ${name} 2>/dev/null`);
                const currentlyFailed = parseInt((jailOut.match(/Currently failed:\s*(\d+)/) || [])[1] || '0', 10);
                const totalFailed = parseInt((jailOut.match(/Total failed:\s*(\d+)/) || [])[1] || '0', 10);
                const currentlyBanned = parseInt((jailOut.match(/Currently banned:\s*(\d+)/) || [])[1] || '0', 10);

                // Extract banned IPs
                const bannedMatch = jailOut.match(/Banned IP list:\s*([\s\S]*?)(?:\n\s*\n|$)/);
                const bannedIPs: string[] = [];
                if (bannedMatch && bannedMatch[1].trim()) {
                    bannedIPs.push(...bannedMatch[1].trim().split(/\s+/).filter(Boolean));
                }

                jails.push({
                    name,
                    enabled: true,
                    currentlyFailed,
                    totalFailed,
                    currentlyBanned,
                    bannedIPs,
                });
            } catch {
                jails.push({ name, enabled: false, currentlyFailed: 0, totalFailed: 0, currentlyBanned: 0, bannedIPs: [] });
            }
        }

        res.json({ success: true, installed: true, jails });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Unban a specific IP from a jail
apiRouter.post('/admin/telemetry/fail2ban/unban', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { jail, ip } = req.body;
        if (!jail || !ip) {
            return res.status(400).json({ success: false, error: 'Missing jail or ip' });
        }
        // Validate IP format to prevent command injection
        if (!/^[a-zA-Z0-9.-]+$/.test(jail) || !/^[0-9a-fA-F.:]+$/.test(ip)) {
            return res.status(400).json({ success: false, error: 'Invalid jail or ip format' });
        }
        await execPromise(`sudo fail2ban-client set ${jail} unbanip ${ip} 2>/dev/null`);
        await logAdminAction(req, 'fail2ban.unban', jail, ip, { jail, ip });
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Audit Logs
apiRouter.get('/admin/logs', requireAuth, requireAdmin, async (req, res) => {
    try {
        await ensureAdminAuditSchema();
        const [rows] = await pool.query(`
            SELECT
                id,
                created_at AS timestamp,
                actor AS username,
                target_domain AS domain,
                action,
                details AS data
            FROM webmail_admin_audit
            ORDER BY created_at DESC
            LIMIT 100
        `);
        res.json({ success: true, data: rows });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.get('/admin/mailboxes', requireAuth, requireAdmin, async (req: any, res) => {
    try {
        await ensureMailboxProfileSchema();
        const [rows] = await pool.query(`
            SELECT
                m.username,
                m.name,
                m.maildir,
                m.quota,
                m.local_part,
                m.domain,
                m.created,
                m.modified,
                m.active,
                m.phone,
                m.email_other,
                m.token,
                m.token_validity,
                p.company,
                p.job_title,
                p.street_address,
                p.city,
                p.region,
                p.postal_code,
                p.country,
                p.notes,
                COALESCE(p.show_in_directory, 1) AS show_in_directory
            FROM mailbox m
            LEFT JOIN webmail_mailbox_profiles p ON p.username = m.username
            ORDER BY m.domain ASC, m.username ASC
        `);
        res.json({ success: true, data: rows });
    } catch (err: any) {
        console.error('Database Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.post('/admin/mailboxes', requireAuth, requireAdmin, async (req: any, res) => {
    try {
        await ensureMailboxProfileSchema();
        const localPart = requireValidLocalPart(req.body?.username);
        const domain = requireValidDomain(req.body?.domain);
        const fullEmail = `${localPart}@${domain}`;
        const name = String(req.body?.name || '').trim();
        const quota = await quotaInputToBytes(req.body?.quota, domain, 0);
        const hash = await hashMailboxPassword(String(req.body?.password || ''));
        const phone = cleanTextInput(req.body?.phone, 30);
        const emailOther = normalizeOptionalEmailInput(req.body?.email_other || req.body?.alternate_email);

        await withTransaction(async (connection) => {
            await connection.query(
                'INSERT INTO mailbox (username, password, name, maildir, quota, local_part, domain, active, phone, email_other, created, modified) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NOW(), NOW())',
                [fullEmail, hash, name, `${domain}/${localPart}/`, quota, localPart, domain, phone, emailOther]
            );
            await connection.query(
                'INSERT INTO alias (address, goto, domain, active, created, modified) VALUES (?, ?, ?, 1, NOW(), NOW()) ON DUPLICATE KEY UPDATE goto = VALUES(goto), active = 1, modified = NOW()',
                [fullEmail, fullEmail, domain]
            );
            if (hasMailboxProfileFields(req.body)) {
                await upsertMailboxProfile(connection, fullEmail, req.body, req.user.username);
            }
        });
        await logAdminAction(req, 'mailbox.create', 'mailbox', fullEmail, {
            domain,
            name,
            quota,
            hasProfile: hasMailboxProfileFields(req.body),
        });
        res.json({ success: true });
    } catch (err: any) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});

apiRouter.put('/admin/mailboxes/:username', requireAuth, requireAdmin, async (req: any, res) => {
    try {
        await ensureMailboxProfileSchema();
        const oldUsername = requireValidMailbox(req.params.username);
        const newUsername = requireValidMailbox(req.body?.username || oldUsername);
        if (newUsername !== oldUsername) {
            return res.status(400).json({ success: false, error: 'Mailbox renaming is not available from this admin panel yet' });
        }
        const domain = oldUsername.split('@')[1];
        const name = String(req.body?.name || '').trim();
        const quota = await quotaInputToBytes(req.body?.quota, domain, 0);
        const active = req.body?.active === 0 || req.body?.active === false ? 0 : 1;
        const [existingRows]: any = await pool.query('SELECT phone, email_other FROM mailbox WHERE username = ? LIMIT 1', [oldUsername]);
        if (existingRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Mailbox not found' });
        }
        const hasPhone = hasBodyField(req.body, 'phone');
        const hasEmailOther = hasBodyField(req.body, 'email_other') || hasBodyField(req.body, 'alternate_email');
        const phone = hasPhone ? cleanTextInput(req.body?.phone, 30) : existingRows[0].phone || '';
        const emailOther = hasEmailOther ? normalizeOptionalEmailInput(req.body?.email_other || req.body?.alternate_email) : existingRows[0].email_other || '';

        await withTransaction(async (connection) => {
            await connection.query(
                'UPDATE mailbox SET name = ?, quota = ?, active = ?, phone = ?, email_other = ?, modified = NOW() WHERE username = ?',
                [name, quota, active, phone, emailOther, oldUsername]
            );
            await connection.query(
                'UPDATE alias SET active = ?, modified = NOW() WHERE address = ? AND goto = ?',
                [active, oldUsername, oldUsername]
            );
            if (hasMailboxProfileFields(req.body)) {
                await upsertMailboxProfile(connection, oldUsername, req.body, req.user.username);
            }
        });
        await logAdminAction(req, 'mailbox.update', 'mailbox', oldUsername, {
            domain,
            name,
            quota,
            active,
            profileUpdated: hasMailboxProfileFields(req.body),
        });
        res.json({ success: true });
    } catch (err: any) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});

apiRouter.post('/admin/mailboxes/:username/password', requireAuth, requireAdmin, async (req: any, res) => {
    try {
        const username = requireValidMailbox(req.params.username);
        const hash = await hashMailboxPassword(String(req.body?.password || ''));
        await withTransaction(async (connection) => {
            await connection.query('UPDATE mailbox SET password = ?, modified = NOW() WHERE username = ?', [hash, username]);
            await connection.query('UPDATE admin SET password = ?, modified = NOW() WHERE username = ?', [hash, username]);
        });
        await logAdminAction(req, 'mailbox.password_reset', 'mailbox', username);
        res.json({ success: true });
    } catch (err: any) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});

apiRouter.delete('/admin/mailboxes/:username', requireAuth, requireAdmin, async (req: any, res) => {
    try {
        const username = requireValidMailbox(req.params.username);
        await withTransaction(async (connection) => {
            await connection.query('DELETE FROM mailbox WHERE username = ?', [username]);
            await connection.query('DELETE FROM alias WHERE address = ? AND goto = ?', [username, username]);
        });
        await logAdminAction(req, 'mailbox.delete', 'mailbox', username);
        res.json({ success: true });
    } catch (err: any) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});

apiRouter.get('/admin/aliases', requireAuth, requireAdmin, async (req: any, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT address, goto, domain, created, modified, active
            FROM alias
            WHERE address != goto
            ORDER BY domain ASC, address ASC
        `);
        res.json({ success: true, data: rows });
    } catch (err: any) {
        console.error('Database Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.post('/admin/aliases', requireAuth, requireAdmin, async (req: any, res) => {
    try {
        const address = normalizeAliasAddress(req.body?.address, req.body?.domain);
        const domain = deriveDomainFromAddress(address);
        const goto = normalizeAliasTargets(req.body?.goto);

        await pool.query(
            'INSERT INTO alias (address, goto, domain, active, created, modified) VALUES (?, ?, ?, 1, NOW(), NOW())',
            [address, goto, domain]
        );
        await logAdminAction(req, 'alias.create', 'alias', address, {
            domain,
            targetCount: goto.split(',').filter(Boolean).length,
        });
        res.json({ success: true });
    } catch (err: any) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});

apiRouter.put('/admin/aliases/:address', requireAuth, requireAdmin, async (req: any, res) => {
    try {
        const oldAddress = normalizeAliasAddress(req.params.address);
        const address = normalizeAliasAddress(req.body?.address || oldAddress, req.body?.domain);
        const domain = deriveDomainFromAddress(address);
        const goto = normalizeAliasTargets(req.body?.goto);
        const [result]: any = await pool.query(
            'UPDATE alias SET address = ?, goto = ?, domain = ?, modified = NOW() WHERE address = ?',
            [address, goto, domain, oldAddress]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Alias not found' });
        }
        await logAdminAction(req, 'alias.update', 'alias', address, {
            domain,
            previousAddress: oldAddress,
            targetCount: goto.split(',').filter(Boolean).length,
        });
        res.json({ success: true });
    } catch (err: any) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});

apiRouter.delete('/admin/aliases/:address', requireAuth, requireAdmin, async (req: any, res) => {
    try {
        const address = normalizeAliasAddress(req.params.address);
        await pool.query('DELETE FROM alias WHERE address = ?', [address]);
        await logAdminAction(req, 'alias.delete', 'alias', address);
        res.json({ success: true });
    } catch (err: any) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});

apiRouter.get('/admin/routing', requireAuth, requireAdmin, async (_req: any, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT alias_domain, target_domain, created, modified, active
            FROM alias_domain
            ORDER BY alias_domain ASC
        `);
        res.json({ success: true, data: rows });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.post('/admin/routing', requireAuth, requireAdmin, async (req: any, res) => {
    try {
        const aliasDomain = requireValidDomain(req.body?.alias_domain);
        const targetDomain = requireValidDomain(req.body?.target_domain);
        if (aliasDomain === targetDomain) {
            return res.status(400).json({ success: false, error: 'Target domain must be different from alias domain' });
        }

        const [domainRows]: any = await pool.query('SELECT 1 FROM domain WHERE domain = ? LIMIT 1', [targetDomain]);
        if (domainRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Target domain not found' });
        }

        await pool.query(
            'INSERT INTO alias_domain (alias_domain, target_domain, active, created, modified) VALUES (?, ?, 1, NOW(), NOW())',
            [aliasDomain, targetDomain]
        );
        await logAdminAction(req, 'routing.create', 'routing', aliasDomain, {
            domain: aliasDomain,
            targetDomain,
        });
        res.json({ success: true });
    } catch (err: any) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});

apiRouter.delete('/admin/routing/:aliasDomain', requireAuth, requireAdmin, async (req: any, res) => {
    try {
        const aliasDomain = requireValidDomain(req.params.aliasDomain);
        await pool.query('DELETE FROM alias_domain WHERE alias_domain = ?', [aliasDomain]);
        await logAdminAction(req, 'routing.delete', 'routing', aliasDomain, { domain: aliasDomain });
        res.json({ success: true });
    } catch (err: any) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});


apiRouter.get('/admin/apikeys', requireAuth, requireAdmin, async (req: any, res) => {
    try {
        const [rows] = await pool.query('SELECT id, description, created_at, last_used FROM api_keys ORDER BY created_at DESC');
        res.json({ success: true, data: rows });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.post('/admin/apikeys', requireAuth, requireAdmin, async (req: any, res) => {
    const { description } = req.body;
    try {
        const raw_key = 'sk_' + crypto.randomBytes(32).toString('hex');
        const key_hash = await bcrypt.hash(raw_key, 10);
        await pool.query('INSERT INTO api_keys (description, key_hash, created_at) VALUES (?, ?, NOW())', [description, key_hash]);
        await logAdminAction(req, 'apikey.create', 'api_key', String(description || '').slice(0, 255), {
            description: String(description || '').slice(0, 255),
        });
        res.json({ success: true, raw_key });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.delete('/admin/apikeys/:id', requireAuth, requireAdmin, async (req: any, res) => {
    try {
        await pool.query('DELETE FROM api_keys WHERE id = ?', [req.params.id]);
        await logAdminAction(req, 'apikey.delete', 'api_key', String(req.params.id || ''));
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.get('/admin/updates', requireAuth, requireAdmin, async (req: any, res) => {
    try {
        const components: any = {};
        
        try { const { stdout } = await execPromise("nginx -v 2>&1 | awk -F/ '{print $2}' | awk '{print $1}'"); components.Nginx = stdout.trim(); } catch(e) { components.Nginx = 'Not Installed'; }
        try { const { stdout } = await execPromise("postconf -h mail_version 2>/dev/null"); components.Postfix = stdout.trim(); } catch(e) { components.Postfix = 'Not Installed'; }
        try { const { stdout } = await execPromise("dovecot --version 2>/dev/null | awk '{print $1}'"); components.Dovecot = stdout.trim(); } catch(e) { components.Dovecot = 'Not Installed'; }
        
        res.json({
            success: true,
            current_version: '1.2.0',
            latest_version: '1.2.0',
            has_update: false,
            components
        });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.get('/admin/spam_policies', requireAuth, requireAdmin, async (req: any, res) => {
    try {
        const [rows]: any = await pool.query('SELECT rules_json FROM global_spam_rules WHERE id = 1');
        const rules = rows.length > 0 ? rows[0].rules_json : null;
        res.json({ success: true, rules: rules ? JSON.parse(rules) : null });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.post('/admin/spam_policies', requireAuth, requireAdmin, async (req: any, res) => {
    const { rules } = req.body;
    try {
        const rulesStr = JSON.stringify(rules);
        await pool.query('INSERT INTO global_spam_rules (id, rules_json) VALUES (1, ?) ON DUPLICATE KEY UPDATE rules_json = ?', [rulesStr, rulesStr]);
        await logAdminAction(req, 'spam_policy.update', 'spam_policy', 'global', {
            bytes: Buffer.byteLength(rulesStr, 'utf8'),
        });
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

import { listNotes, getNote, saveNote, deleteNote } from './notes-utils';
import { syncNotesWithImap } from './notes-imap-sync';

apiRouter.get('/notes', requireAuth, async (req: any, res) => {
    try {
        await syncNotesWithImap(req.user.username, req.user.password);
        const notes = await listNotes(req.user.username);
        console.log(`[NOTES GET] User: ${req.user.username}, count: ${notes.length}`);
        res.json({ success: true, notes });
    } catch (err: any) {
        console.error(`[NOTES GET] ERROR:`, err);
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.post('/notes', requireAuth, async (req: any, res) => {
    try {
        const note = await saveNote({ ...req.body, owner: req.user.username });
        syncNotesWithImap(req.user.username, req.user.password).catch(e => console.error(e));
        res.json({ success: true, note });
    } catch (err: any) {
        console.error('Notes POST error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.put('/notes/:id', requireAuth, async (req: any, res) => {
    try {
        const note = await saveNote({ ...req.body, id: req.params.id, owner: req.user.username });
        syncNotesWithImap(req.user.username, req.user.password).catch(e => console.error(e));
        res.json({ success: true, note });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});

apiRouter.delete('/notes/:id', requireAuth, async (req: any, res) => {
    try {
        await deleteNote(req.params.id, req.user.username);
        syncNotesWithImap(req.user.username, req.user.password).catch(e => console.error(e));
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
});
