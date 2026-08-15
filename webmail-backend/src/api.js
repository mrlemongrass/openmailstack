"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiRouter = void 0;
const express_1 = require("express");
const crypto_1 = __importDefault(require("crypto"));
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const net_1 = __importDefault(require("net"));
const os_1 = __importDefault(require("os"));
const util_1 = __importDefault(require("util"));
const managesieve_1 = require("./managesieve");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_1 = require("./db");
const contact_utils_1 = require("./contact-utils");
const auth_1 = require("./auth");
const config_1 = require("./config");
const sieve_compiler_1 = require("./sieve-compiler");
const rule_engine_1 = require("./rule-engine");
const rule_semantics_1 = require("./rule-semantics");
const imap_1 = require("./imap");
const rule_run_ledger_1 = require("./rule-run-ledger");
const search_index_1 = require("./search-index");
const user_settings_1 = require("./user-settings");
const admin_settings_1 = require("./admin-settings");
const branding_1 = require("./branding");
const search_worker_1 = require("./search-worker");
const rspamd_health_1 = require("./rspamd-health");
const password_verification_1 = require("./password-verification");
const security_1 = require("./security");
const version_info_1 = require("./version-info");
const outbound_mail_1 = require("./outbound-mail");
const scheduled_send_1 = require("./scheduled-send");
const account_security_1 = require("./account-security");
exports.apiRouter = (0, express_1.Router)();
// Auth failure log for fail2ban integration
const AUTH_LOG = '/var/log/openmailstack/auth.log';
const logAuthFailure = (ip, username, reason) => {
    try {
        const ts = new Date().toISOString();
        fs_1.default.appendFileSync(AUTH_LOG, `${ts} [${ip}] failed login for "${username}": ${reason}\n`);
    }
    catch { }
};
const requireAuth = auth_1.requireSession;
const requireAdmin = auth_1.requireAdminSession;
const execPromise = util_1.default.promisify(child_process_1.exec);
const notesCollaborationSessionLimit = (0, security_1.rateLimit)(60 * 1000, 30);
// IMAP connection pool — reuses connections instead of creating new ones per request
let _imapPool = null;
async function getPooledImap(user, pass) {
    if (!_imapPool) {
        const pool = require('./imap-pool');
        _imapPool = pool;
    }
    return _imapPool.getImapConnection(user, pass);
}
const promClient = __importStar(require("prom-client"));
promClient.collectDefaultMetrics({ prefix: 'openmailstack_' });
const apiRequestsCounter = new promClient.Counter({
    name: 'openmailstack_api_requests_total',
    help: 'Total number of API requests',
    labelNames: ['method', 'status']
});
const mailSearchDurationHistogram = new promClient.Histogram({
    name: 'openmailstack_mail_search_duration_seconds',
    help: 'Webmail search request duration by bounded search path',
    labelNames: ['scope', 'field', 'source'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
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
const serviceOpenmailstackGauge = new promClient.Gauge({ name: 'openmailstack_service_backend_status', help: 'OpenMailStack backend service status (1=running)' });
const serviceNginxGauge = new promClient.Gauge({ name: 'openmailstack_service_nginx_status', help: 'Nginx service status (1=running)' });
const activeSyncReadyGauge = new promClient.Gauge({ name: 'openmailstack_protocol_activesync_ready', help: 'ActiveSync OPTIONS readiness (1=ready)' });
const activeSyncLatencyGauge = new promClient.Gauge({ name: 'openmailstack_protocol_activesync_latency_ms', help: 'ActiveSync OPTIONS probe latency in milliseconds' });
const imapReadyGauge = new promClient.Gauge({ name: 'openmailstack_protocol_imap_ready', help: 'IMAP greeting readiness (1=ready)' });
const imapLatencyGauge = new promClient.Gauge({ name: 'openmailstack_protocol_imap_latency_ms', help: 'IMAP greeting probe latency in milliseconds' });
const smtpReadyGauge = new promClient.Gauge({ name: 'openmailstack_protocol_smtp_ready', help: 'SMTP submission greeting readiness (1=ready)' });
const smtpLatencyGauge = new promClient.Gauge({ name: 'openmailstack_protocol_smtp_latency_ms', help: 'SMTP submission greeting probe latency in milliseconds' });
const caldavReadyGauge = new promClient.Gauge({ name: 'openmailstack_protocol_caldav_ready', help: 'CalDAV challenge readiness (1=ready)' });
const caldavLatencyGauge = new promClient.Gauge({ name: 'openmailstack_protocol_caldav_latency_ms', help: 'CalDAV challenge probe latency in milliseconds' });
const carddavReadyGauge = new promClient.Gauge({ name: 'openmailstack_protocol_carddav_ready', help: 'CardDAV challenge readiness (1=ready)' });
const carddavLatencyGauge = new promClient.Gauge({ name: 'openmailstack_protocol_carddav_latency_ms', help: 'CardDAV challenge probe latency in milliseconds' });
const rspamdReadyGauge = new promClient.Gauge({ name: 'openmailstack_rspamd_functional_ready', help: 'Rspamd scan and Milter readiness (1=ready)' });
const rspamdLatencyGauge = new promClient.Gauge({ name: 'openmailstack_rspamd_functional_latency_ms', help: 'Rspamd scan and Milter probe latency in milliseconds' });
// Fail2ban per-jail banned IP count
const fail2banBannedGauge = new promClient.Gauge({ name: 'openmailstack_fail2ban_banned_total', help: 'Currently banned IPs per jail', labelNames: ['jail'] });
const MONITORED_SERVICES = ['postfix', 'dovecot', 'rspamd', 'fail2ban', 'openmailstack', 'nginx'];
const SERVICE_GAUGES = {
    postfix: servicePostfixGauge,
    dovecot: serviceDovecotGauge,
    rspamd: serviceRspamdGauge,
    fail2ban: serviceFail2banGauge,
    openmailstack: serviceOpenmailstackGauge,
    nginx: serviceNginxGauge,
};
const localBackendHost = () => {
    if (config_1.serverConfig.host === '0.0.0.0' || config_1.serverConfig.host === '::')
        return '127.0.0.1';
    if (config_1.serverConfig.host.includes(':') && !config_1.serverConfig.host.startsWith('['))
        return `[${config_1.serverConfig.host}]`;
    return config_1.serverConfig.host;
};
const activeSyncProbeUrl = () => `http://${localBackendHost()}:${config_1.serverConfig.port}/Microsoft-Server-ActiveSync`;
const localBackendUrl = (path) => `http://${localBackendHost()}:${config_1.serverConfig.port}${path}`;
const checkTcpGreetingHealth = (label, host, port, expectedGreeting, timeoutMs = 4000) => new Promise((resolve) => {
    const endpoint = `${host}:${port}`;
    const checkedAt = new Date().toISOString();
    const startedAt = Date.now();
    let settled = false;
    let greeting = '';
    const socket = net_1.default.createConnection({ host, port });
    let timer;
    const finish = (result) => {
        if (settled)
            return;
        settled = true;
        if (timer)
            clearTimeout(timer);
        socket.destroy();
        resolve({
            checkedAt,
            endpoint,
            latencyMs: result.latencyMs === undefined ? Date.now() - startedAt : result.latencyMs,
            ...result,
        });
    };
    timer = setTimeout(() => finish({
        ok: false,
        status: null,
        latencyMs: null,
        lastError: `${label} greeting timed out`,
        greeting: greeting || null,
    }), timeoutMs);
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
        greeting += chunk;
        if (expectedGreeting.test(greeting)) {
            finish({
                ok: true,
                status: null,
                lastError: null,
                greeting: greeting.trim().slice(0, 120),
            });
        }
    });
    socket.on('error', (err) => finish({
        ok: false,
        status: null,
        latencyMs: null,
        lastError: err?.message || `${label} connection failed`,
        greeting: greeting || null,
    }));
});
const checkHttpChallengeHealth = async (label, path, expectedRealm) => {
    const endpoint = localBackendUrl(path);
    const checkedAt = new Date().toISOString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const startedAt = Date.now();
    try {
        const response = await fetch(endpoint, { method: 'GET', signal: controller.signal });
        const latencyMs = Date.now() - startedAt;
        const challenge = response.headers.get('www-authenticate') || '';
        const ok = response.status === 401 && challenge.toLowerCase().includes(expectedRealm.toLowerCase());
        return {
            ok,
            status: response.status,
            latencyMs,
            lastError: ok ? null : `${label} did not return the expected Basic auth challenge`,
            checkedAt,
            endpoint,
        };
    }
    catch (err) {
        return {
            ok: false,
            status: null,
            latencyMs: null,
            lastError: err?.name === 'AbortError' ? `${label} probe timed out` : err?.message || `${label} probe failed`,
            checkedAt,
            endpoint,
        };
    }
    finally {
        clearTimeout(timeout);
    }
};
const checkImapHealth = () => checkTcpGreetingHealth('IMAP', config_1.imapConfig.host, config_1.imapConfig.port, /^\* OK/im);
const checkSmtpHealth = () => checkTcpGreetingHealth('SMTP submission', config_1.smtpConfig.host, config_1.smtpConfig.port, /^220/im, 8000);
const checkCalDavHealth = () => checkHttpChallengeHealth('CalDAV', '/caldav/', 'OpenMailStack CalDAV');
const checkCardDavHealth = () => checkHttpChallengeHealth('CardDAV', '/carddav/', 'OpenMailStack CardDAV');
const checkRspamdHealth = async () => {
    try {
        const raw = await fs_1.default.promises.readFile('/run/openmailstack-rspamd-health/status.json', 'utf8');
        return (0, rspamd_health_1.parseRspamdHealthStatus)(raw);
    }
    catch {
        return (0, rspamd_health_1.parseRspamdHealthStatus)('');
    }
};
const setHealthGauge = (readyGauge, latencyGauge, health) => {
    readyGauge.set(health.ok ? 1 : 0);
    if (health.latencyMs !== null)
        latencyGauge.set(health.latencyMs);
};
const countRecentActiveSyncErrors = async () => {
    try {
        const { stdout } = await execPromise('journalctl -u openmailstack --since "15 minutes ago" --no-pager -g "ActiveSync|Unknown tag|\\[EAS\\] Error sending email" -n 300 2>/dev/null || true', { timeout: 4000 });
        return stdout.split('\n').filter((line) => (/Error handling ActiveSync/i.test(line) ||
            /Unknown tag .*page/i.test(line) ||
            /\[EAS\] Error sending email/i.test(line) ||
            /ActiveSync.*(TypeError|ReferenceError|SyntaxError)/i.test(line))).length;
    }
    catch {
        return null;
    }
};
const checkActiveSyncHealth = async (includeRecentErrors = false) => {
    const endpoint = activeSyncProbeUrl();
    const checkedAt = new Date().toISOString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const recentErrorsPromise = includeRecentErrors ? countRecentActiveSyncErrors() : Promise.resolve(undefined);
    const startedAt = Date.now();
    try {
        const response = await fetch(endpoint, { method: 'OPTIONS', signal: controller.signal });
        const latencyMs = Date.now() - startedAt;
        const recentErrors = await recentErrorsPromise;
        const protocolVersions = response.headers.get('ms-asprotocolversions');
        const ok = response.ok && Boolean(protocolVersions) && (recentErrors === undefined || recentErrors === null || recentErrors === 0);
        return {
            ok,
            status: response.status,
            latencyMs,
            lastError: ok ? null : recentErrors ? `${recentErrors} ActiveSync server errors in the last 15 minutes` : 'ActiveSync OPTIONS did not return protocol metadata',
            checkedAt,
            endpoint,
            protocolVersions,
            recentErrors,
            recentErrorWindowMinutes: includeRecentErrors ? 15 : undefined,
        };
    }
    catch (err) {
        const recentErrors = await recentErrorsPromise;
        return {
            ok: false,
            status: null,
            latencyMs: null,
            lastError: recentErrors ? `${recentErrors} ActiveSync server errors in the last 15 minutes` : err?.name === 'AbortError' ? 'ActiveSync OPTIONS timed out' : err?.message || 'ActiveSync OPTIONS failed',
            checkedAt,
            endpoint,
            protocolVersions: null,
            recentErrors,
            recentErrorWindowMinutes: includeRecentErrors ? 15 : undefined,
        };
    }
    finally {
        clearTimeout(timeout);
    }
};
setInterval(async () => {
    try {
        try {
            const { stdout } = await execPromise('postqueue -j || true');
            const lines = stdout.split('\n').filter((l) => l.trim().length > 0).length;
            mailQueueGauge.set(lines);
        }
        catch (e) { }
        try {
            const { stdout } = await execPromise('ss -tn state established');
            let imap = 0, smtp = 0, http = 0;
            stdout.split('\n').forEach((line) => {
                if (line.includes(':993 ') || line.includes(':143 '))
                    imap++;
                else if (line.includes(':25 ') || line.includes(':465 ') || line.includes(':587 '))
                    smtp++;
                else if (line.includes(':80 ') || line.includes(':443 ') || line.includes(':20000 '))
                    http++;
            });
            imapConnectionsGauge.set(imap);
            smtpConnectionsGauge.set(smtp);
            httpConnectionsGauge.set(http);
        }
        catch (e) { }
        try {
            const res = await fetch('http://localhost:11334/stat');
            if (res.ok) {
                const data = await res.json();
                if (data.scanned !== undefined)
                    rspamdScannedGauge.set(data.scanned);
                if (data.spam_count !== undefined)
                    rspamdSpamGauge.set(data.spam_count);
                if (data.actions && data.actions.reject !== undefined)
                    rspamdRejectedGauge.set(data.actions.reject);
            }
        }
        catch (e) { }
        // System resources: CPU load, memory, disk
        try {
            const [load1, load5, load15] = os_1.default.loadavg();
            systemCpuLoad1mGauge.set(load1);
            systemCpuLoad5mGauge.set(load5);
            systemCpuLoad15mGauge.set(load15);
            systemMemoryTotalGauge.set(os_1.default.totalmem());
            systemMemoryFreeGauge.set(os_1.default.freemem());
            const { stdout: dfOut } = await execPromise('df -B1 / | tail -1');
            const dfParts = dfOut.trim().split(/\s+/);
            const diskTotal = parseInt(dfParts[1], 10); // 1K blocks in bytes
            const diskUsed = parseInt(dfParts[2], 10);
            systemDiskTotalGauge.set({ mountpoint: '/' }, diskTotal);
            systemDiskUsedGauge.set({ mountpoint: '/' }, diskUsed);
        }
        catch (e) { }
        // Service health status
        try {
            for (const svc of MONITORED_SERVICES) {
                try {
                    await execPromise(`systemctl is-active --quiet ${svc}`);
                    SERVICE_GAUGES[svc].set(1);
                }
                catch {
                    SERVICE_GAUGES[svc].set(0);
                }
            }
        }
        catch (e) { }
        try {
            const [activeSync, imap, smtp, caldav, carddav, rspamd] = await Promise.all([
                checkActiveSyncHealth(),
                checkImapHealth(),
                checkSmtpHealth(),
                checkCalDavHealth(),
                checkCardDavHealth(),
                checkRspamdHealth(),
            ]);
            setHealthGauge(activeSyncReadyGauge, activeSyncLatencyGauge, activeSync);
            setHealthGauge(imapReadyGauge, imapLatencyGauge, imap);
            setHealthGauge(smtpReadyGauge, smtpLatencyGauge, smtp);
            setHealthGauge(caldavReadyGauge, caldavLatencyGauge, caldav);
            setHealthGauge(carddavReadyGauge, carddavLatencyGauge, carddav);
            setHealthGauge(rspamdReadyGauge, rspamdLatencyGauge, rspamd);
        }
        catch (e) {
            activeSyncReadyGauge.set(0);
            imapReadyGauge.set(0);
            smtpReadyGauge.set(0);
            caldavReadyGauge.set(0);
            carddavReadyGauge.set(0);
            rspamdReadyGauge.set(0);
        }
        // Fail2ban banned IP counts per jail
        try {
            const jails = ['sshd', 'postfix', 'dovecot', 'openmailstack-webmail'];
            for (const jail of jails) {
                try {
                    const { stdout } = await execPromise(`sudo fail2ban-client status ${jail} 2>/dev/null`);
                    const match = stdout.match(/Currently banned:\s*(\d+)/);
                    fail2banBannedGauge.set({ jail }, match ? parseInt(match[1], 10) : 0);
                }
                catch {
                    fail2banBannedGauge.set({ jail }, 0);
                }
            }
        }
        catch (e) { }
    }
    catch (err) {
        // Silent catch
    }
}, 15000);
exports.apiRouter.use((req, res, next) => {
    res.on('finish', () => {
        apiRequestsCounter.inc({ method: req.method, status: res.statusCode });
    });
    next();
});
const withTransaction = async (callback) => {
    const connection = await db_1.pool.getConnection();
    try {
        await connection.beginTransaction();
        const result = await callback(connection);
        await connection.commit();
        return result;
    }
    catch (err) {
        await connection.rollback();
        throw err;
    }
    finally {
        connection.release();
    }
};
const getAddressText = (value) => value?.text || '';
const scheduledAddressText = (value) => {
    if (typeof value === 'string')
        return value;
    if (Array.isArray(value)) {
        return value.map((entry) => {
            if (typeof entry === 'string')
                return entry;
            const address = String(entry?.address || '').trim();
            const name = String(entry?.name || '').trim();
            return address && name ? `${name} <${address}>` : address;
        }).filter(Boolean).join(', ');
    }
    if (value && typeof value.text === 'string')
        return value.text;
    if (value && typeof value.address === 'string') {
        const address = value.address.trim();
        const name = typeof value.name === 'string' ? value.name.trim() : '';
        return address && name ? `${name} <${address}>` : address;
    }
    return '';
};
const scheduledRejectedRecipients = (value) => {
    try {
        const parsed = JSON.parse(String(value || '[]'));
        if (!Array.isArray(parsed))
            return [];
        const seen = new Set();
        const recipients = [];
        for (const item of parsed.slice(0, 100)) {
            const address = (0, outbound_mail_1.normalizeMailboxAddress)(item);
            if (!address || seen.has(address))
                continue;
            seen.add(address);
            recipients.push(address);
        }
        return recipients;
    }
    catch {
        return [];
    }
};
const getAttachmentNames = (parsed) => {
    if (!Array.isArray(parsed.attachments))
        return '';
    return parsed.attachments
        .map((attachment) => attachment?.filename)
        .filter(Boolean)
        .join('\n');
};
const getVisibleAttachments = (parsed) => {
    if (!Array.isArray(parsed.attachments))
        return [];
    return parsed.attachments.filter((attachment) => (attachment && (attachment.filename || attachment.contentDisposition === 'attachment' || !attachment.related)));
};
const isPreviewableAttachment = (contentType) => (contentType.startsWith('image/') ||
    contentType.startsWith('text/') ||
    contentType === 'application/pdf' ||
    contentType === 'application/msword' ||
    contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    contentType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    contentType === 'application/vnd.oasis.opendocument.text' ||
    contentType === 'application/vnd.oasis.opendocument.spreadsheet' ||
    contentType === 'application/rtf');
const sanitizeAttachmentFilename = (filename) => filename.replace(/[\r\n"]/g, '').trim() || 'attachment';
const encodeAttachmentFilename = (filename) => {
    const cleaned = sanitizeAttachmentFilename(filename);
    return `filename="${cleaned.replace(/\\/g, '\\\\')}"; filename*=UTF-8''${encodeURIComponent(cleaned)}`;
};
const getAttachmentMetadata = (parsed) => getVisibleAttachments(parsed).map((attachment, index) => {
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
/** Extract text/calendar ICS content from parsed MIME parts for invite rendering. */
const extractCalendarData = (parsed) => {
    if (!Array.isArray(parsed.attachments))
        return null;
    const calPart = parsed.attachments.find((a) => a?.contentType === 'text/calendar' && typeof a.content === 'string' && a.content.length > 0);
    if (!calPart)
        return null;
    // Parse the method from the ICS content (e.g., REQUEST, REPLY, CANCEL)
    const methodMatch = calPart.content.match(/^METHOD:(\S+)$/im);
    return { ics: calPart.content, method: methodMatch?.[1]?.toUpperCase() || undefined };
};
const parsedMailToSummary = (folder, msg, parsed, previewLength = 100) => ({
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
const envelopeAddressesToText = (addresses) => (Array.isArray(addresses)
    ? addresses.map((address) => (address?.name
        ? `${address.name} <${address.address || ''}>`
        : address?.address || '')).filter(Boolean).join(', ')
    : '');
const envelopeMailToSummary = (msg) => ({
    folder: msg.folder,
    uid: msg.uid,
    subject: msg.envelope?.subject || '(No Subject)',
    from: envelopeAddressesToText(msg.envelope?.from),
    to: envelopeAddressesToText(msg.envelope?.to),
    date: msg.envelope?.date || '',
    isRead: msg.flags.includes('\\Seen'),
    isStarred: msg.flags.includes('\\Flagged'),
    hasAttachments: false,
    preview: '',
    messageId: msg.envelope?.messageId || '',
    inReplyTo: msg.envelope?.inReplyTo || '',
    references: [],
});
const searchUsesMutableFlags = (query, field) => (field === 'unread'
    || field === 'starred'
    || /(?:^|\s)(?:is:(?:unread|read|starred|flagged|unstarred)|label:unread|-is:(?:starred|flagged))(?:\s|$)/i.test(query));
const matchesCurrentSearchFlags = (message, query, field) => {
    if (field === 'unread' && message.isRead)
        return false;
    if (field === 'starred' && !message.isStarred)
        return false;
    const normalized = query.toLowerCase();
    if (/(?:^|\s)(?:is:unread|label:unread)(?:\s|$)/.test(normalized) && message.isRead)
        return false;
    if (/(?:^|\s)is:read(?:\s|$)/.test(normalized) && !message.isRead)
        return false;
    if (/(?:^|\s)(?:is:starred|is:flagged)(?:\s|$)/.test(normalized) && !message.isStarred)
        return false;
    if (/(?:^|\s)(?:is:unstarred|-is:starred|-is:flagged)(?:\s|$)/.test(normalized) && message.isStarred)
        return false;
    return true;
};
const parsedMailToIndexRow = (folder, msg, parsed) => ({
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
const allowedSearchFields = ['all', 'from', 'to', 'subject', 'body', 'attachments', 'unread', 'starred'];
function folderParam(req) {
    const folder = req.params.folder;
    return Array.isArray(folder) ? folder.join('/') : String(folder || '');
}
const isBlankAllowedSearchField = (field) => ['unread', 'starred'].includes(field);
const domainPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const localPartPattern = /^[a-z0-9._%+-]+$/i;
const normalizeDomainInput = (value) => String(value || '').trim().toLowerCase();
const normalizeEmailInput = (value) => String(value || '').trim().toLowerCase();
const parseQuotaBytes = (value, fallbackBytes = 0) => {
    if (value === undefined || value === null || value === '')
        return fallbackBytes;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < -1)
        return fallbackBytes;
    if (numeric === -1)
        return -1;
    return Math.round(numeric * 1048576);
};
const requireValidDomain = (value) => {
    const domain = normalizeDomainInput(value);
    if (!domainPattern.test(domain)) {
        throw new Error('Invalid domain format');
    }
    return domain;
};
const requireValidLocalPart = (value) => {
    const localPart = String(value || '').trim().toLowerCase();
    if (!localPartPattern.test(localPart)) {
        throw new Error('Invalid username format');
    }
    return localPart;
};
const requireValidMailbox = (value) => {
    const email = normalizeEmailInput(value);
    const [localPart, domain, ...extra] = email.split('@');
    if (!localPart || !domain || extra.length > 0 || !localPartPattern.test(localPart) || !domainPattern.test(domain)) {
        throw new Error('Invalid email address');
    }
    return `${localPart}@${domain}`;
};
const getDomainDefaultQuota = async (domain) => {
    const [rows] = await db_1.pool.query('SELECT quota FROM domain WHERE domain = ? LIMIT 1', [domain]);
    return rows.length > 0 ? Number(rows[0].quota || 0) : 0;
};
const quotaInputToBytes = async (value, domain, fallbackBytes = 0) => {
    const parsed = parseQuotaBytes(value, fallbackBytes);
    if (parsed === -1)
        return getDomainDefaultQuota(domain);
    return Math.max(0, parsed);
};
const hashMailboxPassword = async (password) => {
    if (password.length < 12 || password.length > 128) {
        throw new Error('Password must be between 12 and 128 characters');
    }
    const hash = await bcryptjs_1.default.hash(password, 12);
    return hash.replace('$2b$', '$2y$');
};
const verifyPrimaryMailboxPassword = async (username, password) => {
    const [rows] = await db_1.pool.query('SELECT password FROM mailbox WHERE username = ? AND active = 1 LIMIT 1', [username]);
    return (0, password_verification_1.verifyStoredPassword)(password, rows[0]?.password);
};
const deriveDomainFromAddress = (address) => {
    if (address.startsWith('@'))
        return address.slice(1);
    const parts = address.split('@');
    return parts[1] || '';
};
const normalizeAliasTargets = (value) => {
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
const normalizeAliasAddress = (value, fallbackDomain) => {
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
const adminErrorStatus = (err) => {
    if (err?.code === 'ER_DUP_ENTRY')
        return 409;
    if (err?.message && /invalid|required|cannot|missing|target domain must/i.test(err.message))
        return 400;
    return 500;
};
let adminAuditSchemaPromise = null;
const ensureAdminAuditSchema = async () => {
    if (!adminAuditSchemaPromise) {
        adminAuditSchemaPromise = (async () => {
            await db_1.pool.query(`
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
            await db_1.pool.query(`
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
            await db_1.pool.query(`
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
            await db_1.pool.query(`
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
const auditDetails = (details = {}) => {
    const serialized = JSON.stringify(details);
    return serialized.length > 2000 ? serialized.slice(0, 1997) + '...' : serialized;
};
const auditDomainFromTarget = (targetId) => targetId.includes('@') ? targetId.split('@').pop() || '' : targetId;
const logAdminAction = async (req, action, targetType, targetId, details = {}) => {
    try {
        await ensureAdminAuditSchema();
        const actor = req.user?.username || 'unknown';
        const normalizedTargetId = String(targetId || '').slice(0, 255);
        const targetDomain = String(details.domain || auditDomainFromTarget(normalizedTargetId)).slice(0, 255);
        await db_1.pool.query(`INSERT INTO webmail_admin_audit
                (actor, action, target_type, target_id, target_domain, details, ip_address)
             VALUES (?, ?, ?, ?, ?, ?, ?)`, [
            actor,
            action.slice(0, 128),
            targetType.slice(0, 64),
            normalizedTargetId,
            targetDomain,
            auditDetails(details),
            String(req.ip || req.socket?.remoteAddress || '').slice(0, 64),
        ]);
        // Fire webhooks
        (0, admin_settings_1.getAdminSettings)('webhooks').then(settings => {
            const hookSettings = settings;
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
                    const headers = { 'Content-Type': 'application/json' };
                    if (config_1.serverConfig.webhookSecret) {
                        const hmac = crypto_1.default.createHmac('sha256', config_1.serverConfig.webhookSecret).update(payload).digest('hex');
                        headers['X-Webhook-Signature'] = `sha256=${hmac}`;
                    }
                    for (const endpoint of hookSettings.endpoints) {
                        const startTime = Date.now();
                        fetch(endpoint, {
                            method: 'POST',
                            headers,
                            body: payload,
                            signal: AbortSignal.timeout(10000)
                        }).then(async (res) => {
                            const logStatus = res.ok ? 'delivered' : 'failed';
                            db_1.pool.query(`INSERT INTO webhook_deliveries (endpoint, action, status, response_code, duration_ms)
                                 VALUES (?, ?, ?, ?, ?)`, [endpoint.slice(0, 500), action.slice(0, 128), logStatus, res.status, Date.now() - startTime]).catch(() => { });
                        }).catch(e => {
                            db_1.pool.query(`INSERT INTO webhook_deliveries (endpoint, action, status, response_code, error, duration_ms)
                                 VALUES (?, ?, 'failed', 0, ?, ?)`, [endpoint.slice(0, 500), action.slice(0, 128), String(e.message).slice(0, 500), Date.now() - startTime]).catch(() => { });
                        });
                    }
                }
            }
        }).catch(e => console.error('Failed to get webhook settings:', e));
    }
    catch (err) {
        console.error('Failed to write admin audit log:', err);
    }
};
let mailboxProfileSchemaPromise = null;
const ensureMailboxProfileSchema = async () => {
    if (!mailboxProfileSchemaPromise) {
        mailboxProfileSchemaPromise = (async () => {
            await db_1.pool.query(`
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
            const [columns] = await db_1.pool.query('SHOW COLUMNS FROM webmail_mailbox_profiles');
            const columnNames = new Set(columns.map((column) => column.Field));
            const missingColumns = [
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
                    await db_1.pool.query(statement);
                }
            }
        })();
    }
    return mailboxProfileSchemaPromise;
};
const cleanTextInput = (value, maxLength = 255) => (String(value || '').trim().slice(0, maxLength));
const normalizeOptionalEmailInput = (value) => {
    const email = normalizeEmailInput(value);
    return email ? requireValidMailbox(email) : '';
};
const hasBodyField = (body, field) => Object.prototype.hasOwnProperty.call(body || {}, field);
const hasMailboxProfileFields = (body) => [
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
const mailboxProfileValues = (body, updatedBy) => ({
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
const upsertMailboxProfile = async (connection, username, body, updatedBy) => {
    const profile = mailboxProfileValues(body, updatedBy);
    await connection.query(`INSERT INTO webmail_mailbox_profiles
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
            updated_by = VALUES(updated_by)`, [
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
    ]);
};
exports.apiRouter.get('/branding', async (_req, res) => {
    try {
        const settings = await (0, branding_1.getBrandingSettings)();
        res.json({ success: true, settings });
    }
    catch (err) {
        console.error('Failed to load branding settings:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/auth/login', async (req, res) => {
    const { username, password, secondFactor } = req.body;
    const normalizedUsername = (0, config_1.normalizeMailboxUsername)(username || '');
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    try {
        const isValid = await verifyPrimaryMailboxPassword(normalizedUsername, password);
        if (isValid) {
            if (await (0, account_security_1.isTwoFactorEnabled)(normalizedUsername)) {
                if (!secondFactor) {
                    return res.status(401).json({
                        success: false,
                        requiresTwoFactor: true,
                        error: 'Authentication code required',
                    });
                }
                if (!await (0, account_security_1.verifyAccountSecondFactor)(normalizedUsername, String(secondFactor))) {
                    logAuthFailure(clientIp, normalizedUsername, 'invalid second factor');
                    return res.status(401).json({
                        success: false,
                        requiresTwoFactor: true,
                        error: 'Invalid authentication code',
                    });
                }
            }
            // The modern Admin app is global-only until domain-admin scoping is implemented.
            const [adminRows] = await db_1.pool.query('SELECT superadmin FROM admin WHERE username = ? AND active = 1 LIMIT 1', [normalizedUsername]);
            const isAdmin = adminRows.length > 0 && (0, auth_1.hasGlobalAdminAccess)(adminRows[0]);
            await (0, auth_1.createSession)(res, { username: normalizedUsername, password, isAdmin });
            res.json({ success: true, isAdmin, username: normalizedUsername });
        }
        else {
            logAuthFailure(clientIp, normalizedUsername, 'invalid password');
            res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
    }
    catch (err) {
        console.error('Authentication failed unexpectedly:', err);
        res.status(500).json({ success: false, error: 'Authentication is temporarily unavailable' });
    }
});
exports.apiRouter.post('/auth/logout', async (req, res) => {
    await (0, auth_1.clearSession)(req, res);
    res.json({ success: true });
});
exports.apiRouter.get('/auth/me', requireAuth, (req, res) => {
    res.json({ success: true, user: { username: req.user.username, isAdmin: req.user.isAdmin } });
});
exports.apiRouter.get('/account/security', requireAuth, async (req, res) => {
    try {
        const summary = await (0, account_security_1.getAccountSecuritySummary)(req.user.username);
        res.json({ success: true, ...summary });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/account/2fa/setup', requireAuth, async (req, res) => {
    try {
        if (await (0, account_security_1.isTwoFactorEnabled)(req.user.username)) {
            return res.status(400).json({ success: false, error: 'Two-factor authentication is already enabled' });
        }
        if (!await verifyPrimaryMailboxPassword(req.user.username, req.body?.currentPassword)) {
            return res.status(400).json({ success: false, error: 'Current password is incorrect' });
        }
        const setup = await (0, account_security_1.beginTotpSetup)(req.user.username);
        res.json({ success: true, ...setup });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/account/2fa/confirm', requireAuth, async (req, res) => {
    try {
        const rawSessionId = String(req.cookies?.[auth_1.SESSION_COOKIE] || '');
        const currentSessionHash = crypto_1.default.createHash('sha256').update(rawSessionId).digest('hex');
        const recoveryCodes = await (0, account_security_1.confirmTotpSetup)(req.user.username, String(req.body?.code || ''), currentSessionHash);
        res.json({ success: true, recoveryCodes });
    }
    catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/account/2fa/disable', requireAuth, async (req, res) => {
    try {
        if (!await verifyPrimaryMailboxPassword(req.user.username, req.body?.currentPassword)) {
            return res.status(400).json({ success: false, error: 'Current password is incorrect' });
        }
        if (!await (0, account_security_1.verifyAccountSecondFactor)(req.user.username, String(req.body?.code || ''))) {
            return res.status(400).json({ success: false, error: 'Invalid authentication code' });
        }
        await (0, account_security_1.disableTwoFactor)(req.user.username);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/account/app-passwords', requireAuth, async (req, res) => {
    try {
        if (!await (0, account_security_1.isTwoFactorEnabled)(req.user.username)) {
            return res.status(400).json({ success: false, error: 'Enable two-factor authentication first' });
        }
        if (!await verifyPrimaryMailboxPassword(req.user.username, req.body?.currentPassword)) {
            return res.status(400).json({ success: false, error: 'Current password is incorrect' });
        }
        if (!await (0, account_security_1.verifyAccountSecondFactor)(req.user.username, String(req.body?.code || ''))) {
            return res.status(400).json({ success: false, error: 'Invalid authentication code' });
        }
        const appPassword = await (0, account_security_1.createAppPassword)(req.user.username, req.body?.label);
        res.status(201).json({ success: true, appPassword });
    }
    catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/account/app-passwords/:id/revoke', requireAuth, async (req, res) => {
    try {
        if (!await verifyPrimaryMailboxPassword(req.user.username, req.body?.currentPassword)) {
            return res.status(400).json({ success: false, error: 'Current password is incorrect' });
        }
        const revoked = await (0, account_security_1.revokeAppPassword)(req.user.username, String(req.params.id));
        if (!revoked)
            return res.status(404).json({ success: false, error: 'App password not found' });
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/account/password', requireAuth, async (req, res) => {
    const { current, new: newPassword } = req.body;
    const normalizedUsername = req.user.username;
    try {
        const securitySettings = await (0, admin_settings_1.getAdminSettings)('security');
        if (securitySettings?.allowUserPasswordChange === false) {
            return res.status(403).json({ success: false, error: 'Password changes are disabled by your administrator.' });
        }
        if (!await verifyPrimaryMailboxPassword(normalizedUsername, current)) {
            return res.status(400).json({ success: false, error: 'Current password incorrect' });
        }
        if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 128) {
            return res.status(400).json({ success: false, error: 'New password must be between 12 and 128 characters' });
        }
        const newHash = await bcryptjs_1.default.hash(newPassword, 12);
        const dovecotCompatHash = newHash.replace(/^\$2b\$/, '$2y$');
        const connection = await db_1.pool.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query('UPDATE mailbox SET password = ?, modified = NOW() WHERE username = ?', [dovecotCompatHash, normalizedUsername]);
            await connection.query('UPDATE app_passwords SET revoked_at = NOW() WHERE username = ? AND revoked_at IS NULL', [normalizedUsername]);
            await connection.query('DELETE FROM webmail_sessions WHERE username = ?', [normalizedUsername]);
            await connection.commit();
        }
        catch (error) {
            await connection.rollback();
            throw error;
        }
        finally {
            connection.release();
        }
        await (0, auth_1.clearSession)(req, res);
        res.json({
            success: true,
            message: 'Password updated and app passwords revoked. Please log in again.',
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/account/sessions', requireAuth, async (req, res) => {
    try {
        const db = await db_1.pool.getConnection();
        try {
            const [rows] = await db.query(`SELECT id_hash, created_at, updated_at FROM webmail_sessions
                 WHERE username = ? AND expires_at > NOW() ORDER BY updated_at DESC`, [req.user.username]);
            const rawId = req.cookies?.oms_session || '';
            const currentHash = crypto_1.default.createHash('sha256').update(rawId).digest('hex');
            const sessions = rows.map(r => ({
                id: r.id_hash.substring(0, 8),
                created_at: r.created_at,
                updated_at: r.updated_at,
                isCurrent: r.id_hash === currentHash
            }));
            res.json({ success: true, sessions });
        }
        finally {
            db.release();
        }
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.delete('/account/sessions/:id', requireAuth, async (req, res) => {
    try {
        const rawId = req.cookies?.oms_session || '';
        const currentHash = crypto_1.default.createHash('sha256').update(rawId).digest('hex');
        if (currentHash.startsWith(req.params.id)) {
            return res.status(400).json({ success: false, error: 'Cannot revoke your current session.' });
        }
        const db = await db_1.pool.getConnection();
        try {
            const [result] = await db.query(`DELETE FROM webmail_sessions WHERE id_hash LIKE ? AND username = ?`, [`${req.params.id}%`, req.user.username]);
            const affected = result.affectedRows || 0;
            res.json({ success: true, revoked: affected });
        }
        finally {
            db.release();
        }
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/rules', requireAuth, async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    try {
        const client = new managesieve_1.ManageSieveClient(config_1.sieveConfig.host, config_1.sieveConfig.port, config_1.sieveConfig.masterUser, config_1.sieveConfig.masterPass);
        await client.connect();
        await client.login(user, pass);
        let script = '';
        try {
            script = await client.getScript('webmail');
        }
        catch (e) {
            // Script might not exist yet
        }
        await client.logout();
        const jsonData = (0, sieve_compiler_1.extractJsonFromSieve)(script);
        res.json(jsonData);
    }
    catch (err) {
        console.error('Failed to get rules:', err);
        res.status(500).json({ error: err.message });
    }
});
exports.apiRouter.post('/rules', requireAuth, async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    try {
        const jsonData = req.body;
        const scriptContent = (0, sieve_compiler_1.compileSieve)(jsonData);
        const client = new managesieve_1.ManageSieveClient(config_1.sieveConfig.host, config_1.sieveConfig.port, config_1.sieveConfig.masterUser, config_1.sieveConfig.masterPass);
        await client.connect();
        await client.login(user, pass);
        await client.putScript('webmail', scriptContent);
        await client.setActive('webmail');
        await client.logout();
        res.json({ success: true, message: 'Rules updated and activated' });
    }
    catch (err) {
        console.error('Failed to save rules:', err);
        res.status(500).json({ error: err.message });
    }
});
const ruleIdentity = (rule, index) => String(rule.id || rule.name || `rule-${index + 1}`);
const envelopeAddressText = (addresses) => (Array.isArray(addresses)
    ? addresses
        .map(address => {
        const email = String(address?.address || '');
        const name = String(address?.name || '');
        return name && email ? `${name} <${email}>` : email || name;
    })
        .filter(Boolean)
        .join(', ')
    : '');
async function getActiveRulesDocument(user, pass) {
    const client = new managesieve_1.ManageSieveClient(config_1.sieveConfig.host, config_1.sieveConfig.port, config_1.sieveConfig.masterUser, config_1.sieveConfig.masterPass);
    await client.connect();
    try {
        await client.login(user, pass);
        try {
            return (0, sieve_compiler_1.extractJsonFromSieve)(await client.getScript('webmail'));
        }
        catch {
            return { rules: [] };
        }
    }
    finally {
        try {
            await client.logout();
        }
        catch { }
    }
}
exports.apiRouter.post('/rules/run', requireAuth, async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const folder = typeof req.body?.folder === 'string' ? req.body.folder.trim() : '';
    const mode = req.body?.mode === 'apply' ? 'apply' : req.body?.mode === 'preview' ? 'preview' : '';
    const cursor = req.body?.cursor === undefined ? 0 : Number(req.body.cursor);
    const requestedMaxUid = req.body?.maxUid === undefined ? undefined : Number(req.body.maxUid);
    const requestedUidValidity = typeof req.body?.uidValidity === 'string'
        ? req.body.uidValidity.trim()
        : '';
    const requestedRuleRevision = typeof req.body?.ruleRevision === 'string'
        ? req.body.ruleRevision.trim()
        : '';
    const copyResolution = req.body?.copyResolution === 'completed'
        ? 'completed'
        : req.body?.copyResolution === 'retry'
            ? 'retry'
            : '';
    const copyActionKeys = Array.isArray(req.body?.copyActionKeys)
        ? req.body.copyActionKeys.map((value) => String(value))
        : [];
    if (!folder
        || folder.length > 512
        || !mode
        || !Number.isInteger(cursor)
        || cursor < 0
        || (requestedMaxUid !== undefined && (!Number.isInteger(requestedMaxUid) || requestedMaxUid < 0))
        || (requestedUidValidity && !/^\d{1,64}$/.test(requestedUidValidity))
        || requestedRuleRevision.length > 128
        || (req.body?.copyResolution !== undefined && !copyResolution)
        || (req.body?.copyActionKeys !== undefined
            && (!Array.isArray(req.body.copyActionKeys)
                || copyActionKeys.length < 1
                || copyActionKeys.length > 200
                || copyActionKeys.some((key) => !/^[a-f0-9]{64}$/.test(key))))
        || (copyResolution && copyActionKeys.length === 0)
        || (!copyResolution && copyActionKeys.length > 0)
        || (copyResolution && mode !== 'apply')
        || (cursor > 0 && (!requestedRuleRevision || !requestedUidValidity))
        || (mode === 'apply' && (requestedMaxUid === undefined
            || !requestedUidValidity
            || !requestedRuleRevision))) {
        return res.status(400).json({ success: false, error: 'Invalid rule-run request.' });
    }
    try {
        const imap = await getPooledImap(user, pass);
        const folders = await imap.getFolders();
        const folderPaths = new Set(folders.map((candidate) => String(candidate.path || '')));
        if (!folderPaths.has(folder)) {
            return res.status(400).json({ success: false, error: 'Choose an existing source folder.' });
        }
        const document = await getActiveRulesDocument(user, pass);
        const ruleRevision = crypto_1.default
            .createHash('sha256')
            .update(JSON.stringify(document.rules || []))
            .digest('base64url');
        if (requestedRuleRevision && requestedRuleRevision !== ruleRevision) {
            return res.status(409).json({
                success: false,
                error: 'Rules changed since preview. Preview again before applying.',
            });
        }
        const rules = (Array.isArray(document.rules) ? document.rules : []).filter(rule => rule.enabled !== false);
        const includesBodyRules = rules.some(rule => ((0, rule_semantics_1.executableRuleCriteria)(rule).some(criterion => criterion.field === 'body')));
        const page = await imap.getRuleRunBatch(folder, cursor, requestedMaxUid, includesBodyRules ? 25 : 200, includesBodyRules);
        if (requestedUidValidity && requestedUidValidity !== page.uidValidity) {
            return res.status(409).json({
                success: false,
                error: 'The source folder changed since preview. Preview again before applying.',
            });
        }
        const plans = [];
        const ruleMatchCounts = new Map();
        const destinationCounts = new Map();
        const invalidDestinations = new Set();
        let matchedMessages = 0;
        let deliveryOnlyMatches = 0;
        let bodySkippedMessages = 0;
        for (const message of page.messages) {
            let parsed = null;
            if (includesBodyRules && message.sourceComplete && message.source) {
                parsed = await require('mailparser').simpleParser(message.source);
            }
            const evaluation = (0, rule_engine_1.evaluateRulesForMessage)(rules, {
                uid: message.uid,
                subject: String(parsed?.subject || message.envelope?.subject || ''),
                from: String(parsed?.from?.text || envelopeAddressText(message.envelope?.from)),
                to: String(parsed?.to?.text || envelopeAddressText(message.envelope?.to)),
                body: String(parsed?.text || ''),
                ...(!message.sourceComplete ? { unavailableFields: ['body'] } : {}),
            });
            if (evaluation.unevaluatedRuleIds.length > 0)
                bodySkippedMessages += 1;
            if (evaluation.matchedRuleIds.length > 0)
                matchedMessages += 1;
            if (evaluation.deliveryOnlyActions.length > 0)
                deliveryOnlyMatches += 1;
            for (const ruleId of evaluation.matchedRuleIds) {
                ruleMatchCounts.set(ruleId, (ruleMatchCounts.get(ruleId) || 0) + 1);
            }
            const moveFolders = evaluation.moveFolders.filter(destination => {
                if (destination === folder)
                    return false;
                if (folderPaths.has(destination))
                    return true;
                invalidDestinations.add(destination);
                return false;
            });
            if (moveFolders.length === 0)
                continue;
            plans.push({ uid: message.uid, moveFolders });
            for (const destination of moveFolders) {
                destinationCounts.set(destination, (destinationCounts.get(destination) || 0) + 1);
            }
        }
        const reconcileAppliedMoves = async (result) => {
            if (result.movedUids.length > 0) {
                await (0, search_index_1.deleteMailSearchRows)(user, folder, result.movedUids);
            }
            if (result.affected > 0)
                await (0, search_worker_1.invalidateSearchIndexSnapshot)(user);
        };
        let applyResult = {
            affected: 0,
            copied: 0,
            moved: 0,
            movedUids: [],
        };
        if (mode === 'apply') {
            const operationKey = crypto_1.default
                .createHash('sha256')
                .update(`${user}\0${folder}\0${page.uidValidity}`)
                .digest('hex')
                .slice(0, 32);
            const ledger = new rule_run_ledger_1.RuleRunLedger(user, folder, page.uidValidity);
            if (copyResolution) {
                await ledger.resolvePending(operationKey, copyActionKeys, copyResolution);
            }
            try {
                applyResult = await imap.applyRuleMoves(folder, plans, operationKey, ledger);
            }
            catch (err) {
                if (err instanceof imap_1.RuleMoveApplyError) {
                    await reconcileAppliedMoves(err.result);
                }
                throw err;
            }
            await reconcileAppliedMoves(applyResult);
        }
        const ruleMatches = rules
            .map((rule, index) => ({
            id: ruleIdentity(rule, index),
            name: String(rule.name || `Rule ${index + 1}`),
            count: ruleMatchCounts.get(ruleIdentity(rule, index)) || 0,
        }))
            .filter(rule => rule.count > 0);
        res.json({
            success: true,
            mode,
            folder,
            processed: page.messages.length,
            matchedMessages,
            affectedMessages: plans.length,
            appliedMessages: applyResult.affected,
            copiedMessages: applyResult.copied,
            movedMessages: applyResult.moved,
            deliveryOnlyMatches,
            bodySkippedMessages,
            invalidDestinations: [...invalidDestinations],
            ruleMatches,
            destinations: [...destinationCounts].map(([destination, count]) => ({
                folder: destination,
                count,
            })),
            ruleRevision,
            cursor: page.nextCursor,
            maxUid: page.maxUid,
            uidValidity: page.uidValidity,
            done: page.done,
        });
    }
    catch (err) {
        console.error('Failed to run rules:', err);
        res.status(500).json({
            success: false,
            error: err.message || 'Failed to run rules.',
            ...(err instanceof imap_1.RuleMoveApplyError
                ? {
                    retrySafe: err.retrySafe,
                    pendingCopies: err.pendingCopies.map(copy => ({
                        actionKey: copy.actionKey,
                        uid: copy.uid,
                        destination: copy.destination,
                    })),
                }
                : {}),
        });
    }
});
exports.apiRouter.get('/quota', requireAuth, async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    try {
        const imap = await getPooledImap(user, pass);
        const quota = await imap.getQuota();
        res.json({ success: true, quota });
    }
    catch (err) {
        res.status(500).json({ error: err.message });
    }
});
exports.apiRouter.get('/folders', requireAuth, async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    try {
        const imap = await getPooledImap(user, pass);
        const folders = [...await imap.getFolders()];
        const [scheduledRows] = await db_1.pool.query(`SELECT COUNT(*) AS total
             FROM scheduled_emails
             WHERE username = ? AND status NOT IN ('completed', 'cancelled')`, [user]);
        if (Number(scheduledRows?.[0]?.total || 0) > 0 && !folders.some((folder) => folder.path === 'SCHEDULED')) {
            folders.push({ path: 'SCHEDULED', delimiter: '/', unseen: 0 });
        }
        res.json({ success: true, folders });
    }
    catch (err) {
        console.error('Failed to fetch folders:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/events', requireAuth, async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const user = req.user.username;
    const pass = req.user.password;
    const folder = req.query.folder || 'INBOX';
    const { ImapService } = require('./imap');
    const imap = await getPooledImap(user, pass);
    try {
        let isClosed = false;
        req.on('close', async () => {
            isClosed = true;
        });
        // Start listening to the folder
        const lock = await imap.client.getMailboxLock(folder);
        const onExists = () => {
            if (!isClosed)
                res.write(`data: ${JSON.stringify({ type: 'newMessage', folder })}\n\n`);
        };
        const onFlags = () => {
            if (!isClosed)
                res.write(`data: ${JSON.stringify({ type: 'flagsUpdate', folder })}\n\n`);
        };
        imap.client.on('exists', onExists);
        imap.client.on('flags', onFlags);
        // Optional: Send a ping every 15 seconds to keep connection alive
        const pingInterval = setInterval(() => {
            if (!isClosed)
                res.write(': ping\n\n');
        }, 15000);
        req.on('close', () => {
            clearInterval(pingInterval);
            imap.client.removeListener('exists', onExists);
            imap.client.removeListener('flags', onFlags);
            lock.release();
        });
    }
    catch (e) {
        console.error('SSE Error:', e);
        res.end();
    }
});
exports.apiRouter.get('/folders/*folder/messages', requireAuth, async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const folder = folderParam(req);
    const olderThan = parseInt(String(req.query.olderThan || ''), 10);
    const fetchOlderThan = Number.isFinite(olderThan) && olderThan > 1 ? olderThan : undefined;
    if (folder === 'SCHEDULED') {
        try {
            const [rows] = await db_1.pool.query(`SELECT id, send_at, mail_options, sender_address, status, last_error_code,
                        rejected_recipients_json
                 FROM scheduled_emails
                 WHERE username = ? AND status NOT IN ('completed', 'cancelled')
                 ORDER BY send_at ASC`, [user]);
            const messages = rows.map((r) => {
                let opts = {};
                try {
                    opts = JSON.parse(r.mail_options);
                }
                catch (e) { }
                return {
                    uid: r.id + 100000000, // fake high UID to avoid collisions
                    id: r.id,
                    subject: opts.subject || '(No Subject)',
                    from: scheduledAddressText(r.sender_address || opts.from || user),
                    to: scheduledAddressText(opts.to),
                    cc: scheduledAddressText(opts.cc),
                    bcc: scheduledAddressText(opts.bcc),
                    date: r.send_at,
                    flags: [],
                    unseen: false,
                    is_scheduled: true,
                    delivery_state: r.status,
                    delivery_error: r.last_error_code || undefined,
                    rejectedRecipients: scheduledRejectedRecipients(r.rejected_recipients_json),
                };
            });
            return res.json({ success: true, messages, moreAvailable: false });
        }
        catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }
    try {
        const { ImapService } = require('./imap');
        const simpleParser = require('mailparser').simpleParser;
        const imap = await getPooledImap(user, pass);
        await restoreExpiredSnoozes(user, imap);
        const { messages, uidNext, lowestUid, moreAvailable } = await imap.getMessages(folder, undefined, fetchOlderThan);
        // Parse messages in parallel — sequential parsing is the main bottleneck
        const parsed = await Promise.all(messages.map(async (msg) => {
            const parsed = await simpleParser(msg.source);
            return {
                summary: parsedMailToSummary(folder, msg, parsed),
                indexRow: parsedMailToIndexRow(folder, msg, parsed),
            };
        }));
        const parsedMessages = parsed.map(p => p.summary);
        const indexRows = parsed.map(p => p.indexRow);
        // Update search index asynchronously — don't block the response
        (0, search_index_1.upsertMailSearchRows)(user, indexRows).catch(indexErr => {
            console.error('Failed to update mail search index:', indexErr);
        });
        res.json({
            success: true,
            messages: parsedMessages.reverse(),
            uidNext,
            lowestUid,
            moreAvailable
        });
    }
    catch (err) {
        console.error('Failed to fetch messages:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
// GET raw message source
exports.apiRouter.get('/folders/*folder/messages/:uid/raw', requireAuth, async (req, res) => {
    try {
        const folder = folderParam(req);
        const imap = await getPooledImap(req.user.username, req.user.password);
        await imap.client.mailboxOpen(folder);
        const msg = await imap.client.fetchOne(req.params.uid, { source: true });
        if (!msg || !msg.source)
            return res.status(404).json({ error: 'Message not found' });
        res.set('Content-Type', 'text/plain; charset=utf-8');
        res.send(msg.source.toString());
    }
    catch (err) {
        res.status(500).json({ error: err.message || 'Failed to fetch raw message' });
    }
});
// Snooze messages
exports.apiRouter.post('/messages/snooze', requireAuth, async (req, res) => {
    try {
        const { ImapService } = require('./imap');
        const { folder, uids, until } = req.body;
        if (!uids || !uids.length || !until)
            return res.status(400).json({ error: 'Missing uids or until' });
        const untilDate = new Date(until);
        if (isNaN(untilDate.getTime()))
            return res.status(400).json({ error: 'Invalid until date' });
        const imap = await getPooledImap(req.user.username, req.user.password);
        try {
            await imap.client.mailboxCreate('Snoozed');
        }
        catch (e) { /* may exist */ }
        await imap.client.mailboxOpen(folder);
        await imap.client.messageMove(uids.map(String), 'Snoozed');
        await db_1.pool.execute(`INSERT INTO snooze_queue (owner, original_folder, imap_uid, snooze_until) VALUES ${uids.map(() => '(?, ?, ?, ?)').join(', ')}`, uids.flatMap((uid) => [req.user.username, folder, uid, untilDate.toISOString()]));
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: err.message || 'Snooze failed' });
    }
});
// Restore expired snoozes (best-effort)
async function restoreExpiredSnoozes(user, imapService) {
    try {
        const [expired] = await db_1.pool.execute(`SELECT id, original_folder, imap_uid FROM snooze_queue WHERE owner = ? AND snooze_until <= NOW()`, [user]);
        if (Array.isArray(expired) && expired.length > 0) {
            try {
                await imapService.client.mailboxOpen('Snoozed');
            }
            catch (e) {
                return;
            }
            for (const row of expired) {
                try {
                    await imapService.client.messageMove([String(row.imap_uid)], row.original_folder);
                }
                catch (e) { }
            }
            await db_1.pool.execute(`DELETE FROM snooze_queue WHERE owner = ? AND snooze_until <= NOW()`, [user]);
        }
    }
    catch (e) { }
}
// Mute thread
exports.apiRouter.post('/messages/mute', requireAuth, async (req, res) => {
    try {
        const { uids } = req.body;
        if (!uids || !uids.length)
            return res.status(400).json({ error: 'Missing uids' });
        const user = req.user.username;
        await db_1.pool.execute(`INSERT IGNORE INTO muted_threads (owner, imap_uid) VALUES ${uids.map(() => '(?, ?)').join(', ')}`, uids.flatMap((uid) => [user, uid]));
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ error: err.message || 'Mute failed' });
    }
});
// Check muted UIDs for filtering
async function getMutedUids(user) {
    try {
        const [rows] = await db_1.pool.execute('SELECT imap_uid FROM muted_threads WHERE owner = ?', [user]);
        return new Set((rows || []).map((r) => r.imap_uid));
    }
    catch {
        return new Set();
    }
}
exports.apiRouter.get('/messages/search/index/status', requireAuth, async (req, res) => {
    try {
        const status = await (0, search_index_1.getMailSearchIndexStatus)(req.user.username);
        res.json({ success: true, ...status });
    }
    catch (err) {
        console.error('Failed to get mail search index status:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/messages/search/worker/status', requireAuth, async (req, res) => {
    try {
        const status = await (0, search_worker_1.getSearchWorkerStatus)();
        res.json({ success: true, ...status });
    }
    catch (err) {
        console.error('Failed to get search worker status:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.delete('/messages/search/index', requireAuth, async (req, res) => {
    try {
        const username = req.user.username;
        const deletedCount = await (0, search_worker_1.purgeUserSearchIndex)(username);
        res.json({ success: true, deletedCount, message: `Purged ${deletedCount} index entries. Background worker will re-index automatically.` });
    }
    catch (err) {
        console.error('Failed to purge search index:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/messages/search/index/sync', requireAuth, async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const scope = req.body?.scope === 'all' ? 'all' : 'folder';
    const folder = String(req.body?.folder || 'INBOX');
    const requestedLimit = Math.max(1, Math.min(parseInt(String(req.body?.limit || (scope === 'all' ? '40' : '100')), 10) || 100, 250));
    const perFolderLimit = scope === 'all' ? Math.min(requestedLimit, 40) : requestedLimit;
    const simpleParser = require('mailparser').simpleParser;
    const imap = await getPooledImap(user, pass);
    try {
        const folderPaths = scope === 'all'
            ? (await imap.getFolders()).map((f) => f.path)
            : [folder];
        let indexed = 0;
        for (const folderPath of folderPaths) {
            const maxUid = await (0, search_index_1.getMaxIndexedUid)(user, folderPath);
            const messages = maxUid > 0
                ? (await imap.getMessagesSinceUid(folderPath, maxUid + 1, perFolderLimit)).messages
                : await imap.getRecentMessagesForIndex(folderPath, Math.min(perFolderLimit, 50));
            const parsedResults = await Promise.all(messages.map(async (msg) => {
                const parsed = await simpleParser(msg.source);
                return parsedMailToIndexRow(folderPath, msg, parsed);
            }));
            indexed += await (0, search_index_1.upsertMailSearchRows)(user, parsedResults);
        }
        res.json({ success: true, indexed, folders: folderPaths.length, perFolderLimit, mode: 'incremental' });
    }
    catch (err) {
        console.error('Failed to synchronize mail search index:', err);
        res.status(500).json({ success: false, error: err.message });
    }
    finally {
    }
});
exports.apiRouter.post('/messages/search/index', requireAuth, async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const scope = req.body?.scope === 'all' ? 'all' : 'folder';
    const folder = String(req.body?.folder || 'INBOX');
    const requestedLimit = Math.max(1, Math.min(parseInt(String(req.body?.limit || (scope === 'all' ? '50' : '200')), 10) || 50, 250));
    const perFolderLimit = scope === 'all' ? Math.min(requestedLimit, 75) : requestedLimit;
    const simpleParser = require('mailparser').simpleParser;
    const imap = await getPooledImap(user, pass);
    try {
        const folderPaths = scope === 'all'
            ? (await imap.getFolders()).map((f) => f.path)
            : [folder];
        let indexed = 0;
        for (const folderPath of folderPaths) {
            const messages = await imap.getRecentMessagesForIndex(folderPath, perFolderLimit);
            const parsedResults = await Promise.all(messages.map(async (msg) => {
                const parsed = await simpleParser(msg.source);
                return parsedMailToIndexRow(folderPath, msg, parsed);
            }));
            indexed += await (0, search_index_1.upsertMailSearchRows)(user, parsedResults);
        }
        res.json({ success: true, indexed, folders: folderPaths.length, perFolderLimit });
    }
    catch (err) {
        console.error('Failed to rebuild mail search index:', err);
        res.status(500).json({ success: false, error: err.message });
    }
    finally {
    }
});
exports.apiRouter.get('/messages/search/saved', requireAuth, async (req, res) => {
    try {
        const savedSearches = await (0, search_index_1.listSavedMailSearches)(req.user.username);
        res.json({ success: true, savedSearches });
    }
    catch (err) {
        console.error('Failed to list saved mail searches:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/messages/search/saved', requireAuth, async (req, res) => {
    const name = String(req.body?.name || '').trim();
    const query = String(req.body?.query || '').trim();
    const field = allowedSearchFields.includes(req.body?.field) ? req.body.field : 'all';
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
        const savedSearch = await (0, search_index_1.createSavedMailSearch)(req.user.username, { name, query, field, scope, folder });
        res.json({ success: true, savedSearch });
    }
    catch (err) {
        console.error('Failed to save mail search:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.delete('/messages/search/saved/:id', requireAuth, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id < 1) {
        return res.status(400).json({ success: false, error: 'Invalid saved search id.' });
    }
    try {
        const deleted = await (0, search_index_1.deleteSavedMailSearch)(req.user.username, id);
        res.json({ success: true, deleted });
    }
    catch (err) {
        console.error('Failed to delete saved mail search:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/messages/search', requireAuth, async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const query = String(req.query.q || '').trim();
    const field = allowedSearchFields.includes(req.query.field) ? req.query.field : 'all';
    const scope = req.query.scope === 'all' ? 'all' : 'folder';
    const folder = String(req.query.folder || 'INBOX');
    const limit = Math.max(1, Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 100));
    if (!isBlankAllowedSearchField(field) && query.length < 2) {
        return res.status(400).json({ success: false, error: 'Search query must be at least 2 characters.' });
    }
    if (query.length > 128) {
        return res.status(400).json({ success: false, error: 'Search query is too long.' });
    }
    const simpleParser = require('mailparser').simpleParser;
    const usesMutableFlags = searchUsesMutableFlags(query, field);
    let imap = null;
    let requestCancelled = false;
    let telemetryRecorded = false;
    let indexDurationMs = 0;
    const searchStartedAt = Date.now();
    const recordSearchTelemetry = (source, folderCount, liveFolderCount, resultCount, partial) => {
        if (telemetryRecorded)
            return;
        telemetryRecorded = true;
        const totalDurationMs = Date.now() - searchStartedAt;
        const reconcileDurationMs = Math.max(0, totalDurationMs - indexDurationMs);
        if (!res.headersSent) {
            res.setHeader('Server-Timing', `index;dur=${indexDurationMs}, reconcile;dur=${reconcileDurationMs}, total;dur=${totalDurationMs}`);
        }
        mailSearchDurationHistogram.labels(scope, field, source).observe(totalDurationMs / 1000);
        console.info(JSON.stringify({
            event: 'mail.search.completed',
            durationMs: totalDurationMs,
            indexMs: indexDurationMs,
            reconcileMs: reconcileDurationMs,
            scope,
            field,
            source,
            folderCount,
            liveFolderCount,
            resultCount,
            partial,
        }));
    };
    const markSearchCancelled = () => {
        requestCancelled = true;
        recordSearchTelemetry('cancelled', 0, 0, 0, true);
    };
    req.once('aborted', markSearchCancelled);
    res.once('close', () => {
        if (!res.writableEnded)
            markSearchCancelled();
    });
    try {
        const indexedSearch = (async () => {
            const startedAt = Date.now();
            try {
                return await (0, search_index_1.searchMailIndex)(user, { query, field, scope, folder, limit });
            }
            finally {
                indexDurationMs = Date.now() - startedAt;
            }
        })();
        let [indexedMessages, freshSnapshot] = await Promise.all([
            indexedSearch,
            usesMutableFlags
                ? Promise.resolve(null)
                : (0, search_worker_1.getFreshSearchIndexSnapshot)(user, scope, folder),
        ]);
        let folderPaths;
        let folderCoverage;
        if (freshSnapshot) {
            folderPaths = freshSnapshot.folderPaths;
            folderCoverage = { ...freshSnapshot, failedFolders: [] };
        }
        else {
            imap = await getPooledImap(user, pass);
            if (scope === 'all') {
                const currentSnapshot = await imap.getSearchFolderSnapshot();
                folderPaths = currentSnapshot.folderPaths;
                folderCoverage = currentSnapshot;
            }
            else {
                folderPaths = [folder];
                folderCoverage = await imap.getFolderUidNext(folderPaths);
            }
        }
        const indexCoverage = await (0, search_worker_1.getSearchIndexCoverage)(user, folderPaths);
        const invalidIdentityFolders = new Set();
        const liveSearchFolders = new Set();
        for (const folderPath of folderPaths) {
            const currentUidValidity = folderCoverage.uidValidityByFolder.get(folderPath) || '';
            const coverage = indexCoverage.get(folderPath);
            if (currentUidValidity && coverage?.uidValidity !== currentUidValidity) {
                await (0, search_worker_1.invalidateSearchIndexFolderIdentity)(user, folderPath, currentUidValidity);
                invalidIdentityFolders.add(folderPath);
            }
            const coverageIsComplete = !folderCoverage.failedFolders.includes(folderPath)
                && coverage?.uidValidity === currentUidValidity
                && (coverage?.lastUidIndexed || 0) >= ((folderCoverage.uidNextByFolder.get(folderPath) || 1) - 1);
            if (!coverageIsComplete)
                liveSearchFolders.add(folderPath);
        }
        if (invalidIdentityFolders.size > 0) {
            indexedMessages = indexedMessages.filter(message => !invalidIdentityFolders.has(message.folder));
        }
        const indexedByFolder = new Map();
        const currentFolders = new Set(folderPaths);
        for (const message of indexedMessages) {
            const messages = indexedByFolder.get(message.folder) || [];
            messages.push(message);
            indexedByFolder.set(message.folder, messages);
        }
        const verifiedIndexedMessages = [];
        for (const [indexedFolder, messages] of indexedByFolder) {
            if (scope === 'all' && !currentFolders.has(indexedFolder)) {
                await (0, search_index_1.deleteMailSearchRows)(user, indexedFolder, messages.map(message => message.uid));
                continue;
            }
            if (usesMutableFlags)
                continue;
            if (!liveSearchFolders.has(indexedFolder)) {
                verifiedIndexedMessages.push(...messages);
                continue;
            }
            try {
                if (!imap)
                    imap = await getPooledImap(user, pass);
                const states = new Map((await imap.getExistingUidStates(indexedFolder, messages.map(message => message.uid))).map((state) => [state.uid, state]));
                const staleUids = [];
                for (const message of messages) {
                    const state = states.get(message.uid);
                    if (!state) {
                        staleUids.push(message.uid);
                        continue;
                    }
                    const currentMessage = {
                        ...message,
                        isRead: state.flags.includes('\\Seen'),
                        isStarred: state.flags.includes('\\Flagged'),
                    };
                    if (matchesCurrentSearchFlags(currentMessage, query, field)) {
                        verifiedIndexedMessages.push(currentMessage);
                    }
                }
                if (staleUids.length > 0) {
                    await (0, search_index_1.deleteMailSearchRows)(user, indexedFolder, staleUids);
                }
            }
            catch (verificationErr) {
                console.error('Failed to reconcile mail search index:', verificationErr);
                if (currentFolders.has(indexedFolder))
                    liveSearchFolders.add(indexedFolder);
            }
        }
        if (usesMutableFlags) {
            for (const folderPath of folderPaths)
                liveSearchFolders.add(folderPath);
        }
        const liveSearchFolderPaths = folderPaths.filter((folderPath) => liveSearchFolders.has(folderPath));
        const needsLiveSearch = liveSearchFolderPaths.length > 0;
        if (needsLiveSearch && !imap)
            imap = await getPooledImap(user, pass);
        const liveResult = needsLiveSearch
            ? await imap.searchMessages(liveSearchFolderPaths, query, field, limit, () => requestCancelled)
            : { messages: [], failedFolders: [], partialFolders: [] };
        if (requestCancelled)
            return;
        if (needsLiveSearch
            && liveResult.failedFolders.length === liveSearchFolderPaths.length
            && verifiedIndexedMessages.length === 0) {
            recordSearchTelemetry('error', folderPaths.length, liveSearchFolderPaths.length, 0, true);
            return res.status(503).json({ success: false, error: 'Search is temporarily unavailable.' });
        }
        const verifyAttachments = field === 'attachments' || /(?:^|\s)has:attachment(?:\s|$)/i.test(query);
        const liveSummaries = verifyAttachments
            ? (await Promise.all(liveResult.messages.map(async (message) => {
                const parsed = await require('mailparser').simpleParser(message.source);
                const visibleAttachments = getVisibleAttachments(parsed);
                const matches = field === 'attachments'
                    ? visibleAttachments.some((attachment) => (String(attachment.filename || '').toLowerCase().includes(query.toLowerCase())))
                    : visibleAttachments.length > 0;
                return matches ? parsedMailToSummary(message.folder, message, parsed, 180) : null;
            }))).filter(Boolean)
            : liveResult.messages.map(envelopeMailToSummary);
        const mergedMessages = new Map();
        for (const message of verifiedIndexedMessages) {
            mergedMessages.set(`${message.folder}\u0000${message.uid}`, message);
        }
        for (const liveSummary of liveSummaries) {
            const key = `${liveSummary.folder}\u0000${liveSummary.uid}`;
            const cachedMessage = mergedMessages.get(key);
            mergedMessages.set(key, cachedMessage
                ? {
                    ...cachedMessage,
                    ...liveSummary,
                    preview: cachedMessage.preview,
                    hasAttachments: cachedMessage.hasAttachments,
                }
                : liveSummary);
        }
        const messages = [...mergedMessages.values()]
            .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
            .slice(0, limit);
        if (requestCancelled)
            return;
        const source = needsLiveSearch
            ? (verifiedIndexedMessages.length > 0 ? 'hybrid' : 'imap')
            : 'index';
        const partial = liveResult.failedFolders.length > 0 || liveResult.partialFolders.length > 0;
        recordSearchTelemetry(source, folderPaths.length, liveSearchFolderPaths.length, messages.length, partial);
        res.json({
            success: true,
            messages,
            query,
            scope,
            field,
            source,
            partial,
            failedFolders: liveResult.failedFolders,
        });
    }
    catch (err) {
        recordSearchTelemetry('error', 0, 0, 0, true);
        console.error('Failed to search messages:', err);
        if (!requestCancelled)
            res.status(500).json({ success: false, error: err.message });
    }
    finally {
    }
});
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config_1.serverConfig.uploadLimitBytes } });
const MAX_SCHEDULE_DELAY_SECONDS = 5 * 366 * 24 * 60 * 60;
const MAX_IMAP_UID = 4_294_967_295;
const strictInteger = (value, minimum, maximum) => {
    const text = String(value ?? '').trim();
    if (!/^\d+$/.test(text))
        return null;
    const parsed = Number(text);
    return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
};
const optionalDraftUid = (value) => {
    if (value === undefined || value === null || String(value).trim() === '')
        return null;
    const uid = strictInteger(value, 1, MAX_IMAP_UID);
    if (uid === null)
        throw new outbound_mail_1.OutboundMessageValidationError('Draft UID is invalid');
    return uid;
};
exports.apiRouter.post('/messages/send', requireAuth, upload.array('attachments'), async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const { from, to, cc, bcc, replyTo, subject, html, text, body, draftUid, inReplyTo, references } = req.body;
    const files = req.files || [];
    try {
        const parsedDraftUid = optionalDraftUid(draftUid);
        const nodemailer = require('nodemailer');
        const sender = await (0, outbound_mail_1.authorizeOutboundSender)(db_1.pool, user, from);
        const compiled = await (0, outbound_mail_1.compileOutboundMessage)({
            sender,
            to,
            cc,
            bcc,
            replyTo,
            subject,
            text,
            body,
            html,
            inReplyTo,
            references,
            attachments: files.map((f) => ({
                filename: f.originalname,
                content: f.buffer,
                contentType: f.mimetype,
            })),
        });
        const rawDelaySeconds = req.body.delaySeconds;
        const delayText = rawDelaySeconds == null ? '0' : String(rawDelaySeconds).trim();
        if (!/^\d+$/.test(delayText)) {
            throw new outbound_mail_1.OutboundMessageValidationError('Scheduled delivery delay is invalid');
        }
        const delaySeconds = Number(delayText);
        if (!Number.isSafeInteger(delaySeconds) || delaySeconds > MAX_SCHEDULE_DELAY_SECONDS) {
            throw new outbound_mail_1.OutboundMessageValidationError('Scheduled delivery delay is invalid');
        }
        if (delaySeconds > 0) {
            const sendAt = new Date(Date.now() + delaySeconds * 1000);
            const scheduledId = await (0, scheduled_send_1.enqueueScheduledEmail)(db_1.pool, {
                username: user,
                sendAt,
                senderAddress: sender.address,
                messageId: compiled.messageId,
                envelope: compiled.envelope,
                raw: compiled.raw,
                sentRaw: compiled.sentRaw,
                metadata: compiled.metadata,
                draftUid: parsedDraftUid,
            });
            let draftCleanupStatus;
            if (parsedDraftUid) {
                try {
                    const imap = await getPooledImap(user, pass);
                    const folders = await imap.getFolders();
                    const draftsFolder = folders.find((folder) => folder.path.toLowerCase().includes('draft'))?.path;
                    if (draftsFolder) {
                        await imap.messageAction(draftsFolder, [parsedDraftUid], 'delete');
                    }
                    draftCleanupStatus = 'removed';
                }
                catch (draftCleanupError) {
                    let schedulingAborted = false;
                    try {
                        schedulingAborted = await (0, scheduled_send_1.abortScheduledEmailBeforeDelivery)(db_1.pool, scheduledId, user);
                    }
                    catch (abortError) {
                        console.error('Could not abort scheduling after Draft cleanup failed:', abortError);
                    }
                    if (schedulingAborted)
                        throw draftCleanupError;
                    draftCleanupStatus = 'failed';
                }
            }
            return res.json({
                success: true,
                scheduledId,
                sendAt,
                draftCleanupStatus,
                message: draftCleanupStatus === 'failed'
                    ? 'Message scheduled, but its old Draft could not be removed'
                    : 'Message scheduled',
            });
        }
        const transporter = nodemailer.createTransport((0, config_1.smtpTransportOptions)({ user, pass }));
        let smtpRecipientOutcome;
        try {
            const smtpInfo = await transporter.sendMail({ raw: compiled.raw, envelope: compiled.envelope });
            smtpRecipientOutcome = (0, outbound_mail_1.classifySmtpRecipientOutcome)(smtpInfo, compiled.envelope.to);
        }
        finally {
            try {
                transporter.close?.();
            }
            catch { }
        }
        // SMTP acceptance is irreversible. Every remaining side effect is best-effort
        // and must never turn an accepted delivery into an HTTP failure.
        try {
            const contactsSettings = await (0, user_settings_1.getUserSettings)(user, 'contacts');
            if (contactsSettings.autoCreateFromSent !== false) {
                for (const contactEmail of smtpRecipientOutcome.accepted) {
                    const contactName = contactEmail.split('@')[0];
                    try {
                        await db_1.pool.query('INSERT IGNORE INTO contacts (username, name, email) VALUES (?, ?, ?)', [user, contactName, contactEmail]);
                    }
                    catch { }
                }
            }
        }
        catch (error) {
            console.error('Failed to update contacts after accepted delivery:', error);
        }
        try {
            const imap = await getPooledImap(user, pass);
            const folders = await imap.getFolders();
            let sentFolder = folders.find((folder) => folder.path.toLowerCase().includes('sent'))?.path;
            if (!sentFolder) {
                try {
                    await imap.client.mailboxCreate('Sent');
                }
                catch { }
                sentFolder = 'Sent';
            }
            await imap.appendMessage(sentFolder, compiled.sentRaw, ['\\Seen']);
            if (parsedDraftUid) {
                const draftsFolder = folders.find((folder) => folder.path.toLowerCase().includes('draft'))?.path;
                if (draftsFolder) {
                    try {
                        await imap.messageAction(draftsFolder, [parsedDraftUid], 'delete');
                    }
                    catch { }
                }
            }
            return res.json({
                success: true,
                deliveryStatus: smtpRecipientOutcome.partial ? 'partial' : 'accepted',
                rejectedRecipients: smtpRecipientOutcome.rejected,
                sentCopyStatus: 'saved',
                messageId: compiled.messageId,
            });
        }
        catch (sentCopyError) {
            console.error('Failed to save accepted message in Sent:', sentCopyError);
            let scheduledId;
            let sentCopyStatus = 'pending';
            try {
                scheduledId = await (0, scheduled_send_1.retainAcceptedSentCopy)(db_1.pool, {
                    username: user,
                    sendAt: new Date(),
                    senderAddress: sender.address,
                    messageId: compiled.messageId,
                    envelope: compiled.envelope,
                    raw: compiled.raw,
                    sentRaw: compiled.sentRaw,
                    metadata: compiled.metadata,
                    draftUid: parsedDraftUid,
                });
            }
            catch (persistError) {
                console.error('Failed to retain accepted message for Sent-copy retry:', persistError);
                sentCopyStatus = 'unavailable';
            }
            return res.json({
                success: true,
                deliveryStatus: smtpRecipientOutcome.partial ? 'partial' : 'accepted',
                rejectedRecipients: smtpRecipientOutcome.rejected,
                sentCopyStatus,
                scheduledId,
                messageId: compiled.messageId,
            });
        }
    }
    catch (err) {
        if (err instanceof outbound_mail_1.SenderAuthorizationError) {
            return res.status(403).json({ success: false, error: err.message, code: err.code });
        }
        if (err instanceof outbound_mail_1.OutboundMessageValidationError) {
            return res.status(400).json({ success: false, error: err.message, code: err.code });
        }
        console.error('Failed to send message:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/messages/undo', requireAuth, async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const { scheduledId, uids, targetFolder, sourceFolder } = req.body;
    // Handle scheduled send cancellation
    if (scheduledId) {
        const cancellationWorkerId = `cancel-${process.pid}-${crypto_1.default.randomUUID()}`;
        try {
            const id = Number(scheduledId);
            if (!Number.isSafeInteger(id) || id < 1) {
                return res.status(400).json({ success: false, error: 'scheduledId is invalid' });
            }
            await (0, scheduled_send_1.ensureScheduledEmailsSchema)();
            const claim = await (0, scheduled_send_1.claimScheduledCancellation)(db_1.pool, id, user, cancellationWorkerId);
            if (claim.outcome === 'ready') {
                try {
                    const row = claim.row;
                    const retainedRaw = row.sent_raw_message || row.raw_message;
                    let raw = retainedRaw
                        ? (Buffer.isBuffer(retainedRaw) ? retainedRaw : Buffer.from(retainedRaw))
                        : null;
                    if (!raw) {
                        const legacy = JSON.parse(String(row.mail_options || '{}'));
                        const sender = await (0, outbound_mail_1.authorizeOutboundSender)(db_1.pool, user, row.sender_address || legacy.from);
                        const compiled = await (0, outbound_mail_1.compileOutboundMessage)({
                            sender,
                            to: legacy.to,
                            cc: legacy.cc,
                            bcc: legacy.bcc,
                            replyTo: legacy.replyTo,
                            subject: legacy.subject,
                            text: legacy.text,
                            body: legacy.body,
                            html: legacy.html,
                            inReplyTo: legacy.inReplyTo,
                            references: legacy.references,
                            attachments: Array.isArray(legacy.attachments)
                                ? legacy.attachments.map((attachment) => ({
                                    filename: String(attachment.filename || 'attachment'),
                                    content: Buffer.from(String(attachment.content || ''), 'base64'),
                                    contentType: attachment.contentType,
                                }))
                                : [],
                            keepBcc: true,
                        });
                        raw = compiled.raw;
                        row.message_id = compiled.messageId;
                    }
                    const imap = await getPooledImap(user, pass);
                    const folders = await imap.getFolders();
                    let draftsFolder = folders.find((folder) => folder.path.toLowerCase().includes('draft'))?.path;
                    if (!draftsFolder) {
                        try {
                            await imap.client.mailboxCreate('Drafts');
                        }
                        catch { }
                        draftsFolder = 'Drafts';
                    }
                    await imap.client.mailboxOpen(draftsFolder);
                    const messageId = String(row.message_id || '');
                    let matchingUids = messageId
                        ? await imap.client.search({ header: { 'message-id': messageId } })
                        : [];
                    let restoredDraftUid = Math.max(0, ...(matchingUids || []).map((value) => Number(value) || 0));
                    if (!restoredDraftUid) {
                        const appendResult = await imap.client.append(draftsFolder, raw, ['\\Draft', '\\Seen']);
                        restoredDraftUid = Number(appendResult?.uid || 0);
                        if (!restoredDraftUid && messageId) {
                            matchingUids = await imap.client.search({ header: { 'message-id': messageId } });
                            restoredDraftUid = Math.max(0, ...(matchingUids || []).map((value) => Number(value) || 0));
                        }
                    }
                    if (!Number.isSafeInteger(restoredDraftUid) || restoredDraftUid < 1) {
                        throw new Error('The cancelled message was restored but its Draft UID could not be confirmed');
                    }
                    if (row.draft_uid && Number(row.draft_uid) !== restoredDraftUid) {
                        try {
                            await imap.messageAction(draftsFolder, [Number(row.draft_uid)], 'delete');
                        }
                        catch { }
                    }
                    await (0, scheduled_send_1.completeScheduledCancellation)(db_1.pool, id, user, cancellationWorkerId, restoredDraftUid);
                    return res.json({
                        success: true,
                        message: 'Message send undone and restored to Drafts',
                        draftUid: restoredDraftUid,
                        draftFolder: draftsFolder,
                    });
                }
                catch (restoreError) {
                    try {
                        await (0, scheduled_send_1.releaseScheduledCancellation)(db_1.pool, id, user, cancellationWorkerId, String(restoreError?.code || restoreError?.name || 'draft_restore_failed'));
                    }
                    catch (releaseError) {
                        console.error('Failed to retain cancelled message payload:', releaseError);
                    }
                    throw restoreError;
                }
            }
            if (claim.outcome === 'conflict') {
                return res.status(409).json({
                    success: false,
                    error: 'Scheduled message is already being delivered and can no longer be cancelled',
                    code: 'SCHEDULED_SEND_IN_PROGRESS',
                });
            }
            return res.status(404).json({ success: false, error: 'Scheduled message not found or already sent' });
        }
        catch (err) {
            console.error('Undo error:', err);
            return res.status(500).json({ success: false, error: err.message });
        }
    }
    // Handle IMAP message restoration
    if (!uids || !Array.isArray(uids) || uids.length === 0 || !targetFolder) {
        return res.status(400).json({ success: false, error: 'scheduledId or uids+targetFolder is required' });
    }
    try {
        const imap = await getPooledImap(user, pass);
        const restoreFolder = sourceFolder || 'INBOX';
        await imap.client.mailboxOpen(targetFolder);
        await imap.client.messageMove(uids.map(String), restoreFolder, { uid: true });
        try {
            await (0, search_index_1.deleteMailSearchRows)(user, targetFolder, uids);
            await (0, search_worker_1.invalidateSearchIndexSnapshot)(user);
        }
        catch (indexErr) {
            console.error('Failed to update mail search index after undo:', indexErr);
        }
        res.json({ success: true, message: 'Messages restored' });
    }
    catch (err) {
        console.error('Undo IMAP restore error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.delete('/messages/scheduled/:id', requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) {
        return res.status(400).json({ success: false, error: 'Scheduled message id is invalid' });
    }
    try {
        await (0, scheduled_send_1.ensureScheduledEmailsSchema)();
        const outcome = await (0, scheduled_send_1.removeTerminalScheduledEmail)(db_1.pool, id, req.user.username);
        if (outcome === 'removed') {
            return res.json({ success: true, message: 'Scheduled message removed' });
        }
        if (outcome === 'conflict') {
            return res.status(409).json({
                success: false,
                error: 'Only failed or delivery-uncertain messages can be removed',
                code: 'SCHEDULED_MESSAGE_NOT_TERMINAL',
            });
        }
        return res.status(404).json({ success: false, error: 'Scheduled message not found' });
    }
    catch (err) {
        console.error('Scheduled message removal error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/messages/draft', requireAuth, upload.array('attachments'), async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const { from, to, cc, bcc, replyTo, subject, html, text, body, draftUid, inReplyTo, references } = req.body;
    const files = req.files || [];
    try {
        const parsedDraftUid = optionalDraftUid(draftUid);
        const sender = await (0, outbound_mail_1.authorizeOutboundSender)(db_1.pool, user, from);
        const draftId = String(req.body.draftId || crypto_1.default.randomUUID());
        const compiled = await (0, outbound_mail_1.compileOutboundMessage)({
            sender,
            to: to || '',
            cc: cc || '',
            bcc: bcc || '',
            replyTo: replyTo || '',
            subject: subject || 'No Subject',
            text,
            body,
            html,
            inReplyTo,
            references,
            headers: { 'X-Draft-Id': draftId },
            attachments: files.map((f) => ({
                filename: f.originalname,
                content: f.buffer,
                contentType: f.mimetype,
            })),
            allowNoRecipients: true,
            keepBcc: true,
        });
        const imap = await getPooledImap(user, pass);
        const folders = await imap.getFolders();
        let draftsFolder = folders.find((f) => f.path.toLowerCase().includes('draft'))?.path;
        if (!draftsFolder) {
            try {
                await imap.client.mailboxCreate('Drafts');
            }
            catch { }
            draftsFolder = 'Drafts';
        }
        // Append-first preserves the previous good draft if the new write fails.
        const appendRes = await imap.client.append(draftsFolder, compiled.raw, ['\\Draft', '\\Seen']);
        const newUid = Number(appendRes?.uid);
        const uidsToDelete = new Set();
        const previousUid = parsedDraftUid;
        if (Number.isInteger(newUid) && Number.isInteger(previousUid) && previousUid > 0 && previousUid < newUid) {
            uidsToDelete.add(previousUid);
        }
        if (Number.isInteger(newUid)) {
            try {
                await imap.client.mailboxOpen(draftsFolder);
                const searchRes = await imap.client.search({ header: { 'x-draft-id': draftId } });
                for (const uidValue of searchRes || []) {
                    const uid = Number(uidValue);
                    // A concurrent save with a higher UID is newer and must survive.
                    if (Number.isInteger(uid) && uid > 0 && uid < newUid)
                        uidsToDelete.add(uid);
                }
            }
            catch (error) {
                console.error('Failed to reconcile old drafts by draftId:', error);
            }
        }
        if (uidsToDelete.size > 0) {
            try {
                await imap.messageAction(draftsFolder, Array.from(uidsToDelete).sort((a, b) => a - b), 'delete');
            }
            catch (error) {
                console.error('Failed to delete replaced drafts:', error);
            }
        }
        res.json({ success: true, draftId, draftUid: appendRes?.uid, messageId: compiled.messageId });
    }
    catch (err) {
        if (err instanceof outbound_mail_1.SenderAuthorizationError) {
            return res.status(403).json({ success: false, error: err.message, code: err.code });
        }
        if (err instanceof outbound_mail_1.OutboundMessageValidationError) {
            return res.status(400).json({ success: false, error: err.message, code: err.code });
        }
        console.error('Failed to save draft:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/messages/action', requireAuth, async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const { folder, uids, action, targetFolder } = req.body;
    const allowedActions = ['delete', 'archive', 'spam', 'move', 'read', 'unread', 'star', 'unstar'];
    if (!folder || !uids || !Array.isArray(uids) || uids.length === 0 || !allowedActions.includes(action)) {
        return res.status(400).json({ success: false, error: 'Missing required parameters' });
    }
    try {
        const imap = await getPooledImap(user, pass);
        const actionResult = await imap.messageAction(folder, uids, action, targetFolder);
        try {
            if (action === 'read') {
                await (0, search_index_1.updateMailSearchFlags)(user, folder, uids, { isRead: true });
            }
            else if (action === 'unread') {
                await (0, search_index_1.updateMailSearchFlags)(user, folder, uids, { isRead: false });
            }
            else if (action === 'star') {
                await (0, search_index_1.updateMailSearchFlags)(user, folder, uids, { isStarred: true });
            }
            else if (action === 'unstar') {
                await (0, search_index_1.updateMailSearchFlags)(user, folder, uids, { isStarred: false });
            }
            else {
                await (0, search_index_1.deleteMailSearchRows)(user, folder, uids);
                await (0, search_worker_1.invalidateSearchIndexSnapshot)(user);
            }
        }
        catch (indexErr) {
            console.error('Failed to update mail search index after message action:', indexErr);
        }
        const uidMap = actionResult?.uidMap || null;
        const undoUids = uidMap
            ? uids.map((uid) => Number(uidMap[String(uid)] || uidMap[uid])).filter((uid) => Number.isFinite(uid))
            : [];
        res.json({
            success: true,
            targetFolder: actionResult?.targetFolder,
            undoUids,
        });
    }
    catch (err) {
        console.error('Failed to perform action:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/folders/*folder/messages/:uid/attachments/:attachmentId', requireAuth, async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const folder = folderParam(req);
    const uid = strictInteger(req.params.uid, 1, MAX_IMAP_UID);
    const attachmentId = strictInteger(req.params.attachmentId, 0, Number.MAX_SAFE_INTEGER);
    const forceDownload = req.query.download === '1';
    if (uid === null || attachmentId === null) {
        return res.status(400).json({ success: false, error: 'Invalid attachment request' });
    }
    const { ImapService } = require('./imap');
    const simpleParser = require('mailparser').simpleParser;
    const imap = await getPooledImap(user, pass);
    try {
        const msg = await imap.getMessageByUid(folder, uid);
        if (!msg)
            return res.status(404).json({ success: false, error: 'Message not found' });
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
    }
    catch (err) {
        console.error('Failed to fetch attachment:', err);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
    finally {
    }
});
exports.apiRouter.get('/folders/*folder/messages/:uid', requireAuth, async (req, res) => {
    const user = req.user.username;
    const pass = req.user.password;
    const folder = folderParam(req);
    const uid = strictInteger(req.params.uid, 1, folder === 'SCHEDULED' ? Number.MAX_SAFE_INTEGER : MAX_IMAP_UID);
    if (uid === null)
        return res.status(400).json({ success: false, error: 'Message UID is invalid' });
    if (folder === 'SCHEDULED') {
        try {
            const realId = uid - 100000000;
            const [rows] = await db_1.pool.query(`SELECT * FROM scheduled_emails
                 WHERE id = ? AND username = ? AND status NOT IN ('completed', 'cancelled')`, [realId, user]);
            if (rows.length === 0)
                return res.status(404).json({ success: false, error: 'Not found' });
            let opts = {};
            try {
                opts = JSON.parse(rows[0].mail_options);
            }
            catch (e) { }
            return res.json({
                success: true,
                message: {
                    uid,
                    subject: opts.subject || '(No Subject)',
                    from: scheduledAddressText(rows[0].sender_address || opts.from || user),
                    to: scheduledAddressText(opts.to),
                    cc: scheduledAddressText(opts.cc),
                    bcc: scheduledAddressText(opts.bcc),
                    date: rows[0].send_at,
                    html: opts.html || '',
                    text: opts.text || '',
                    attachments: [], // We won't try to parse attachments for scheduled messages for now
                    is_scheduled: true,
                    scheduled_id: realId,
                    delivery_state: rows[0].status,
                    delivery_error: rows[0].last_error_code || undefined,
                    rejectedRecipients: scheduledRejectedRecipients(rows[0].rejected_recipients_json),
                }
            });
        }
        catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    }
    try {
        const simpleParser = require('mailparser').simpleParser;
        // Per-message fetch uses its own connection to avoid pool race conditions
        // when pre-fetching multiple messages concurrently.
        const { ImapService: FreshImap } = require('./imap');
        const imap = new FreshImap(user, pass);
        await imap.connect();
        const msg = await imap.getMessageByUid(folder, uid);
        try {
            await imap.logout();
        }
        catch (e) { }
        if (!msg)
            return res.status(404).json({ success: false, error: 'Not found' });
        const parsed = await simpleParser(msg.source);
        const calData = extractCalendarData(parsed);
        res.json({
            success: true,
            message: {
                uid: msg.uid,
                subject: parsed.subject || '(No Subject)',
                from: parsed.from?.text || '',
                to: parsed.to?.text || '',
                cc: parsed.cc?.text || '',
                bcc: parsed.bcc?.text || '',
                replyTo: parsed.replyTo?.text || '',
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
                references: parsed.references || [],
                calendarData: calData || undefined
            }
        });
    }
    catch (err) {
        console.error('Failed to fetch message:', err);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});
exports.apiRouter.get('/user/identities', requireAuth, async (req, res) => {
    try {
        const username = req.user.username;
        const identities = await (0, outbound_mail_1.listOwnedSenderIdentities)(db_1.pool, username);
        res.json({
            success: true,
            name: identities.name,
            address: identities.primary,
            aliases: identities.addresses
                .filter(address => address !== identities.primary)
                .map(address => ({ address, name: identities.name || undefined })),
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/contacts', requireAuth, async (req, res) => {
    const user = req.user.username;
    try {
        const [rows] = await db_1.pool.query('SELECT id, name, email, phone FROM contacts WHERE username = ?', [user]);
        res.json({ success: true, contacts: rows });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/directory', requireAuth, async (req, res) => {
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
        const params = [];
        if (q) {
            sql += ` AND (m.username LIKE ? OR m.name LIKE ? OR m.phone LIKE ? OR p.job_title LIKE ? OR p.company LIKE ?)`;
            const likeTerm = `%${q}%`;
            params.push(likeTerm, likeTerm, likeTerm, likeTerm, likeTerm);
        }
        sql += ` ORDER BY m.name ASC, m.username ASC LIMIT 100`;
        const [rows] = await db_1.pool.query(sql, params);
        res.json({
            success: true,
            contacts: rows.map((row) => ({
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
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/contacts', requireAuth, async (req, res) => {
    const user = req.user.username;
    const { name, email, phone } = req.body;
    if (!name || !email)
        return res.status(400).json({ success: false, error: 'Name and email required' });
    try {
        const cleanName = cleanTextInput(name);
        const cleanEmail = requireValidMailbox(email);
        const cleanPhone = cleanTextInput(phone, 30);
        const davUid = (0, contact_utils_1.createContactUid)();
        const vcard = (0, contact_utils_1.patchVCardData)('', davUid, {
            name: cleanName,
            email: cleanEmail,
            phone: cleanPhone,
        });
        await (0, contact_utils_1.withContactMutation)(user, async (connection) => {
            const syncToken = await (0, contact_utils_1.nextContactSyncTokenOnConnection)(connection, user);
            await connection.query(`INSERT INTO contacts (username, name, email, phone, vcard_data, dav_uid, sync_token)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE name = VALUES(name), phone = VALUES(phone), sync_token = VALUES(sync_token)`, [user, cleanName, cleanEmail, cleanPhone, vcard, davUid, syncToken]);
        });
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/settings/forwarding', requireAuth, async (req, res) => {
    const user = req.user.username;
    try {
        const [rows] = await db_1.pool.query('SELECT goto FROM alias WHERE address = ?', [user]);
        res.json({ success: true, goto: rows.length > 0 ? rows[0].goto : '' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/settings/forwarding', requireAuth, async (req, res) => {
    const user = req.user.username;
    const { goto } = req.body;
    try {
        await db_1.pool.query('UPDATE alias SET goto = ?, modified = NOW() WHERE address = ?', [goto, user]);
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/settings/:namespace', requireAuth, async (req, res) => {
    const namespace = req.params.namespace;
    if (!(0, user_settings_1.isSettingsNamespace)(namespace)) {
        return res.status(404).json({ success: false, error: 'Unknown settings namespace' });
    }
    try {
        const settings = await (0, user_settings_1.getUserSettings)(req.user.username, namespace);
        res.json({ success: true, namespace, settings });
    }
    catch (err) {
        console.error('Failed to load user settings:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.put('/settings/:namespace', requireAuth, async (req, res) => {
    const namespace = req.params.namespace;
    if (!(0, user_settings_1.isSettingsNamespace)(namespace)) {
        return res.status(404).json({ success: false, error: 'Unknown settings namespace' });
    }
    try {
        const settings = await (0, user_settings_1.saveUserSettings)(req.user.username, namespace, req.body?.settings);
        res.json({ success: true, namespace, settings });
    }
    catch (err) {
        console.error('Failed to save user settings:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
// Admin Endpoints
exports.apiRouter.get('/admin/branding', requireAuth, requireAdmin, async (_req, res) => {
    try {
        const settings = await (0, branding_1.getBrandingSettings)();
        res.json({ success: true, settings });
    }
    catch (err) {
        console.error('Failed to load admin branding settings:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.put('/admin/branding', requireAuth, requireAdmin, async (req, res) => {
    try {
        const settings = await (0, branding_1.saveBrandingSettings)(req.body?.settings, req.user.username);
        await logAdminAction(req, 'branding.update', 'branding', 'global', {
            appName: settings.appName,
            companyName: settings.companyName,
            imagesUpdated: ['appIconDataUrl', 'faviconDataUrl', 'loginLogoDataUrl', 'loginBackgroundDataUrl']
                .filter((key) => Object.prototype.hasOwnProperty.call(req.body?.settings || {}, key)),
        });
        res.json({ success: true, settings });
    }
    catch (err) {
        console.error('Failed to save admin branding settings:', err);
        res.status(err instanceof branding_1.BrandingValidationError ? 400 : 500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/admin/settings/:namespace', requireAuth, requireAdmin, async (req, res) => {
    const namespace = req.params.namespace;
    if (!(0, admin_settings_1.isAdminSettingsNamespace)(namespace)) {
        return res.status(404).json({ success: false, error: 'Unknown admin settings namespace' });
    }
    try {
        const settings = await (0, admin_settings_1.getAdminSettings)(namespace);
        res.json({ success: true, namespace, settings });
    }
    catch (err) {
        console.error('Failed to load admin settings:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.put('/admin/settings/:namespace', requireAuth, requireAdmin, async (req, res) => {
    const namespace = req.params.namespace;
    if (!(0, admin_settings_1.isAdminSettingsNamespace)(namespace)) {
        return res.status(404).json({ success: false, error: 'Unknown admin settings namespace' });
    }
    try {
        const settings = await (0, admin_settings_1.saveAdminSettings)(namespace, req.body?.settings, req.user.username);
        await logAdminAction(req, `settings.${namespace}.update`, 'admin_settings', namespace, { namespace });
        res.json({ success: true, namespace, settings });
    }
    catch (err) {
        console.error('Failed to save admin settings:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/admin/domains', requireAuth, requireAdmin, async (req, res) => {
    try {
        const [rows] = await db_1.pool.query(`
            SELECT
                d.domain,
                d.description,
                COALESCE(a.alias_count, 0) AS aliases,
                COALESCE(m.mailbox_count, 0) AS mailboxes,
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
            LEFT JOIN (
                SELECT domain, COUNT(*) AS alias_count FROM \`alias\` GROUP BY domain
            ) a ON a.domain = d.domain
            LEFT JOIN (
                SELECT domain, COUNT(*) AS mailbox_count FROM mailbox GROUP BY domain
            ) m ON m.domain = d.domain
            WHERE d.domain != "ALL"
        `);
        res.json({ success: true, data: rows });
    }
    catch (err) {
        console.error('Database Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/admin/domains', requireAuth, requireAdmin, async (req, res) => {
    try {
        const domain = requireValidDomain(req.body?.domain);
        const maxquota = Math.max(0, parseQuotaBytes(req.body?.maxquota, 0));
        const quota = Math.max(0, parseQuotaBytes(req.body?.quota, 0));
        await db_1.pool.query('INSERT INTO domain (domain, description, maxquota, quota, transport, active, created, modified) VALUES (?, "", ?, ?, "virtual", 1, NOW(), NOW())', [domain, maxquota, quota]);
        await logAdminAction(req, 'domain.create', 'domain', domain, { domain, maxquota, quota });
        res.json({ success: true });
    }
    catch (err) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/admin/domains/:domain/dns', requireAuth, requireAdmin, async (req, res) => {
    try {
        const domain = requireValidDomain(req.params.domain);
        let mailHost = os_1.default.hostname();
        try {
            mailHost = new URL(config_1.serverConfig.publicBaseUrl || `https://${config_1.serverConfig.defaultDomain || os_1.default.hostname()}`).hostname || mailHost;
        }
        catch {
            mailHost = config_1.serverConfig.defaultDomain || mailHost;
        }
        const records = [
            { type: 'MX', name: '@', value: `10 ${mailHost}.`, description: 'Mail exchanger' },
            { type: 'TXT', name: '@', value: `v=spf1 mx a:${mailHost} -all`, description: 'SPF record' },
            { type: 'TXT', name: '_dmarc', value: 'v=DMARC1; p=quarantine; sp=quarantine; adkim=r; aspf=r;', description: 'DMARC record' },
        ];
        const dkimPath = `/var/lib/rspamd/dkim/${domain}.pub`;
        if (fs_1.default.existsSync(dkimPath)) {
            const publicKey = fs_1.default.readFileSync(dkimPath, 'utf8');
            const match = publicKey.match(/\(\s*([^)]+)\s*\)/s);
            const value = match ? match[1].replace(/["\s]/g, '') : publicKey.replace(/-----[^-]+-----|\s/g, '');
            records.push({ type: 'TXT', name: 'mail._domainkey', value, description: 'DKIM public key' });
        }
        else {
            records.push({ type: 'TXT', name: 'mail._domainkey', value: 'Pending generation... (check back later)', description: 'DKIM public key' });
        }
        const [verificationRows] = await db_1.pool.query('SELECT token FROM domain_verification WHERE domain = ? LIMIT 1', [domain]);
        if (verificationRows.length > 0) {
            records.push({
                type: 'TXT',
                name: '_openmailstack',
                value: `openmailstack-verify=${verificationRows[0].token}`,
                description: 'Domain verification',
            });
        }
        res.json({ success: true, data: records });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.delete('/admin/domains/:domain', requireAuth, requireAdmin, async (req, res) => {
    try {
        const domain = requireValidDomain(req.params.domain);
        await withTransaction(async (connection) => {
            await connection.query('DELETE ap FROM app_passwords ap INNER JOIN mailbox m ON m.username = ap.username WHERE m.domain = ?', [domain]);
            await connection.query('DELETE s FROM account_security s INNER JOIN mailbox m ON m.username = s.username WHERE m.domain = ?', [domain]);
            await connection.query('DELETE ws FROM webmail_sessions ws INNER JOIN mailbox m ON m.username = ws.username WHERE m.domain = ?', [domain]);
            await connection.query('DELETE mc FROM mailbox_credentials mc INNER JOIN mailbox m ON m.username = mc.username WHERE m.domain = ?', [domain]);
            await connection.query('DELETE FROM mailbox WHERE domain = ?', [domain]);
            await connection.query('DELETE FROM alias WHERE domain = ?', [domain]);
            await connection.query('DELETE FROM alias_domain WHERE alias_domain = ? OR target_domain = ?', [domain, domain]);
            await connection.query('DELETE FROM domain_admins WHERE domain = ?', [domain]);
            await connection.query('DELETE FROM domain_verification WHERE domain = ?', [domain]);
            await connection.query('DELETE FROM domain WHERE domain = ?', [domain]);
        });
        await logAdminAction(req, 'domain.delete', 'domain', domain, { domain });
        res.json({ success: true });
    }
    catch (err) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});
// Admins
exports.apiRouter.get('/admin/admins', requireAuth, requireAdmin, async (req, res) => {
    try {
        const [rows] = await db_1.pool.query('SELECT username, created, modified, active, superadmin FROM admin');
        res.json({ success: true, data: rows });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
const activeSuperAdminCount = async () => {
    const [rows] = await db_1.pool.query('SELECT COUNT(*) AS count FROM admin WHERE active = 1 AND superadmin = 1');
    return Number(rows[0]?.count || 0);
};
const isSuperAdmin = async (username) => {
    const [rows] = await db_1.pool.query('SELECT superadmin FROM admin WHERE username = ? AND active = 1 LIMIT 1', [username]);
    return rows.length > 0 && (0, auth_1.hasGlobalAdminAccess)(rows[0]);
};
exports.apiRouter.post('/admin/admins', requireAuth, requireAdmin, async (req, res) => {
    try {
        const username = requireValidMailbox(req.body?.username);
        const superadmin = req.body?.superadmin === true || req.body?.superadmin === 1 ? 1 : 0;
        // Copy password from mailbox if they exist, otherwise use dummy password
        const [mbRows] = await db_1.pool.query('SELECT password FROM mailbox WHERE username = ?', [username]);
        const pass = mbRows.length > 0 ? mbRows[0].password : '';
        await db_1.pool.query(`INSERT INTO admin (username, password, created, modified, superadmin)
             VALUES (?, ?, NOW(), NOW(), ?)
             ON DUPLICATE KEY UPDATE active = 1, superadmin = IF(COALESCE(superadmin, 0) = 1 OR VALUES(superadmin) = 1, 1, 0), modified = NOW()`, [username, pass, superadmin]);
        await logAdminAction(req, superadmin ? 'admin.promote_superadmin' : 'admin.promote', 'admin', username, { username, superadmin: Boolean(superadmin) });
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/admin/admins/:username/superadmin', requireAuth, requireAdmin, async (req, res) => {
    try {
        const username = requireValidMailbox(req.params.username);
        const [result] = await db_1.pool.query('UPDATE admin SET superadmin = 1, active = 1, modified = NOW() WHERE username = ?', [username]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Admin not found' });
        }
        await logAdminAction(req, 'admin.promote_superadmin', 'admin', username, { username, superadmin: true });
        res.json({ success: true });
    }
    catch (err) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});
exports.apiRouter.delete('/admin/admins/:username/superadmin', requireAuth, requireAdmin, async (req, res) => {
    try {
        const username = requireValidMailbox(req.params.username);
        const count = await activeSuperAdminCount();
        const decision = (0, auth_1.canDemoteGlobalAdmin)(req.user.username, username, count);
        if (!decision.allowed) {
            return res.status(400).json({ success: false, error: decision.reason });
        }
        const [result] = await db_1.pool.query('UPDATE admin SET superadmin = 0, modified = NOW() WHERE username = ? AND active = 1 AND superadmin = 1', [username]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Superadmin not found' });
        }
        await logAdminAction(req, 'admin.demote_superadmin', 'admin', username, { username, superadmin: false });
        res.json({ success: true });
    }
    catch (err) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});
exports.apiRouter.delete('/admin/admins/:username', requireAuth, requireAdmin, async (req, res) => {
    try {
        const username = requireValidMailbox(req.params.username);
        if (await isSuperAdmin(username)) {
            return res.status(400).json({ success: false, error: 'Remove the superadmin role before demoting this admin.' });
        }
        await db_1.pool.query('DELETE FROM admin WHERE username = ?', [username]);
        await logAdminAction(req, 'admin.demote', 'admin', username, { username });
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// Telemetry & Metrics
exports.apiRouter.get('/admin/telemetry/metrics', requireAuth, requireAdmin, async (req, res) => {
    try {
        res.set('Content-Type', promClient.register.contentType);
        res.end(await promClient.register.metrics());
    }
    catch (ex) {
        res.status(500).end(ex.message);
    }
});
exports.apiRouter.get('/admin/telemetry/logs/live', requireAuth, requireAdmin, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const { spawn } = require('child_process');
    const journalctl = spawn('journalctl', ['-f', '-n', '100', '-u', 'postfix', '-u', 'dovecot', '-u', 'openmailstack']);
    journalctl.stdout.on('data', (data) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
            if (line.trim()) {
                res.write(`data: ${line}\n\n`);
            }
        }
    });
    journalctl.stderr.on('data', (data) => {
        console.error(`[Telemetry Logs] journalctl err: ${data}`);
    });
    req.on('close', () => {
        journalctl.kill();
    });
});
// System Health snapshot for dashboard
exports.apiRouter.get('/admin/telemetry/system-health', requireAuth, requireAdmin, async (_req, res) => {
    try {
        const [load1, load5, load15] = os_1.default.loadavg();
        const memTotal = os_1.default.totalmem();
        const memFree = os_1.default.freemem();
        const { stdout: dfOut } = await execPromise('df -B1 / | tail -1');
        const dfParts = dfOut.trim().split(/\s+/);
        const diskTotal = parseInt(dfParts[1], 10);
        const diskUsed = parseInt(dfParts[2], 10);
        const services = {};
        for (const svc of MONITORED_SERVICES) {
            try {
                await execPromise(`systemctl is-active --quiet ${svc}`);
                services[svc] = true;
            }
            catch {
                services[svc] = false;
            }
        }
        let mailQueue = 0;
        try {
            const { stdout } = await execPromise('postqueue -j 2>/dev/null || true');
            mailQueue = stdout.split('\n').filter((l) => l.trim().length > 0).length;
        }
        catch { }
        let connections = { imap: 0, smtp: 0, http: 0 };
        try {
            const { stdout: ssOut } = await execPromise('ss -tn state established 2>/dev/null');
            ssOut.split('\n').forEach((line) => {
                if (line.includes(':993 ') || line.includes(':143 '))
                    connections.imap++;
                else if (line.includes(':25 ') || line.includes(':465 ') || line.includes(':587 '))
                    connections.smtp++;
                else if (line.includes(':80 ') || line.includes(':443 ') || line.includes(':20000 '))
                    connections.http++;
            });
        }
        catch { }
        const [activeSync, imap, smtp, caldav, carddav, rspamd] = await Promise.all([
            checkActiveSyncHealth(true),
            checkImapHealth(),
            checkSmtpHealth(),
            checkCalDavHealth(),
            checkCardDavHealth(),
            checkRspamdHealth(),
        ]);
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
            protocols: {
                activeSync,
                imap,
                smtp,
                caldav,
                carddav,
            },
            filtering: { rspamd },
            mailQueue,
            connections,
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
const REMEDIATION_ACTIONS = {
    'restart-openmailstack': {
        label: 'Restart OpenMailStack backend',
        command: 'sudo /usr/local/sbin/openmailstack-remediate restart-openmailstack',
        targetType: 'service',
        targetId: 'openmailstack',
    },
};
exports.apiRouter.post('/admin/telemetry/remediate', requireAuth, requireAdmin, async (req, res) => {
    const action = String(req.body?.action || '');
    const remedy = REMEDIATION_ACTIONS[action];
    if (!remedy) {
        return res.status(400).json({ success: false, error: 'Unsupported remediation action' });
    }
    try {
        await execPromise(remedy.command, { timeout: 10000 });
        await logAdminAction(req, 'telemetry.remediate', remedy.targetType, remedy.targetId, {
            action,
            label: remedy.label,
            result: 'scheduled',
        });
        res.json({ success: true, action, message: `${remedy.label} scheduled.` });
    }
    catch (err) {
        await logAdminAction(req, 'telemetry.remediate_failed', remedy.targetType, remedy.targetId, {
            action,
            label: remedy.label,
            result: 'failed',
            error: String(err?.message || err || 'unknown').slice(0, 300),
        });
        res.status(500).json({ success: false, error: err.message || 'Remediation failed' });
    }
});
// Fail2ban status with jail details
exports.apiRouter.get('/admin/telemetry/fail2ban/status', requireAuth, requireAdmin, async (_req, res) => {
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
        const jailNames = jailListMatch ? jailListMatch[1].split(',').map((j) => j.trim()).filter(Boolean) : [];
        const jails = [];
        for (const name of jailNames) {
            try {
                const { stdout: jailOut } = await execPromise(`sudo fail2ban-client status ${name} 2>/dev/null`);
                const currentlyFailed = parseInt((jailOut.match(/Currently failed:\s*(\d+)/) || [])[1] || '0', 10);
                const totalFailed = parseInt((jailOut.match(/Total failed:\s*(\d+)/) || [])[1] || '0', 10);
                const currentlyBanned = parseInt((jailOut.match(/Currently banned:\s*(\d+)/) || [])[1] || '0', 10);
                // Extract banned IPs
                const bannedMatch = jailOut.match(/Banned IP list:\s*([\s\S]*?)(?:\n\s*\n|$)/);
                const bannedIPs = [];
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
            }
            catch {
                jails.push({ name, enabled: false, currentlyFailed: 0, totalFailed: 0, currentlyBanned: 0, bannedIPs: [] });
            }
        }
        res.json({ success: true, installed: true, jails });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// Unban a specific IP from a jail
exports.apiRouter.post('/admin/telemetry/fail2ban/unban', requireAuth, requireAdmin, async (req, res) => {
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
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// Audit Logs
exports.apiRouter.get('/admin/logs', requireAuth, requireAdmin, async (req, res) => {
    try {
        await ensureAdminAuditSchema();
        const [rows] = await db_1.pool.query(`
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
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/admin/mailboxes', requireAuth, requireAdmin, async (req, res) => {
    try {
        await ensureMailboxProfileSchema();
        const [rows] = await db_1.pool.query(`
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
    }
    catch (err) {
        console.error('Database Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/admin/mailboxes', requireAuth, requireAdmin, async (req, res) => {
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
            await connection.query('INSERT INTO mailbox (username, password, name, maildir, quota, local_part, domain, active, phone, email_other, created, modified) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NOW(), NOW())', [fullEmail, hash, name, `${domain}/${localPart}/`, quota, localPart, domain, phone, emailOther]);
            await connection.query('INSERT INTO alias (address, goto, domain, active, created, modified) VALUES (?, ?, ?, 1, NOW(), NOW()) ON DUPLICATE KEY UPDATE goto = VALUES(goto), active = 1, modified = NOW()', [fullEmail, fullEmail, domain]);
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
    }
    catch (err) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});
exports.apiRouter.put('/admin/mailboxes/:username', requireAuth, requireAdmin, async (req, res) => {
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
        const [existingRows] = await db_1.pool.query('SELECT phone, email_other FROM mailbox WHERE username = ? LIMIT 1', [oldUsername]);
        if (existingRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Mailbox not found' });
        }
        const hasPhone = hasBodyField(req.body, 'phone');
        const hasEmailOther = hasBodyField(req.body, 'email_other') || hasBodyField(req.body, 'alternate_email');
        const phone = hasPhone ? cleanTextInput(req.body?.phone, 30) : existingRows[0].phone || '';
        const emailOther = hasEmailOther ? normalizeOptionalEmailInput(req.body?.email_other || req.body?.alternate_email) : existingRows[0].email_other || '';
        await withTransaction(async (connection) => {
            await connection.query('UPDATE mailbox SET name = ?, quota = ?, active = ?, phone = ?, email_other = ?, modified = NOW() WHERE username = ?', [name, quota, active, phone, emailOther, oldUsername]);
            await connection.query('UPDATE alias SET active = ?, modified = NOW() WHERE address = ? AND goto = ?', [active, oldUsername, oldUsername]);
            if (config_1.schedulerConfig.enabled && active === 0) {
                await connection.query('UPDATE scheduler_mailbox_entitlements SET enabled = 0, published = 0 WHERE username = ?', [oldUsername]);
            }
            if (active === 0) {
                await connection.query('UPDATE app_passwords SET revoked_at = NOW() WHERE username = ? AND revoked_at IS NULL', [oldUsername]);
                await connection.query('DELETE FROM webmail_sessions WHERE username = ?', [oldUsername]);
            }
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
    }
    catch (err) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/admin/mailboxes/:username/password', requireAuth, requireAdmin, async (req, res) => {
    try {
        const username = requireValidMailbox(req.params.username);
        const hash = await hashMailboxPassword(String(req.body?.password || ''));
        await withTransaction(async (connection) => {
            await connection.query('UPDATE mailbox SET password = ?, modified = NOW() WHERE username = ?', [hash, username]);
            await connection.query('UPDATE admin SET password = ?, modified = NOW() WHERE username = ?', [hash, username]);
            await connection.query('UPDATE app_passwords SET revoked_at = NOW() WHERE username = ? AND revoked_at IS NULL', [username]);
            await connection.query('DELETE FROM webmail_sessions WHERE username = ?', [username]);
        });
        await logAdminAction(req, 'mailbox.password_reset', 'mailbox', username);
        res.json({ success: true });
    }
    catch (err) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});
exports.apiRouter.delete('/admin/mailboxes/:username', requireAuth, requireAdmin, async (req, res) => {
    try {
        const username = requireValidMailbox(req.params.username);
        await withTransaction(async (connection) => {
            if (config_1.schedulerConfig.enabled) {
                await connection.query('UPDATE scheduler_mailbox_entitlements SET enabled = 0, published = 0 WHERE username = ?', [username]);
            }
            await connection.query('DELETE FROM app_passwords WHERE username = ?', [username]);
            await connection.query('DELETE FROM account_security WHERE username = ?', [username]);
            await connection.query('DELETE FROM webmail_sessions WHERE username = ?', [username]);
            await connection.query('DELETE FROM mailbox_credentials WHERE username = ?', [username]);
            await connection.query('DELETE FROM mailbox WHERE username = ?', [username]);
            await connection.query('DELETE FROM alias WHERE address = ? AND goto = ?', [username, username]);
        });
        await logAdminAction(req, 'mailbox.delete', 'mailbox', username);
        res.json({ success: true });
    }
    catch (err) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/admin/aliases', requireAuth, requireAdmin, async (req, res) => {
    try {
        const [rows] = await db_1.pool.query(`
            SELECT address, goto, domain, created, modified, active
            FROM alias
            WHERE address != goto
            ORDER BY domain ASC, address ASC
        `);
        res.json({ success: true, data: rows });
    }
    catch (err) {
        console.error('Database Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/admin/aliases', requireAuth, requireAdmin, async (req, res) => {
    try {
        const address = normalizeAliasAddress(req.body?.address, req.body?.domain);
        const domain = deriveDomainFromAddress(address);
        const goto = normalizeAliasTargets(req.body?.goto);
        await db_1.pool.query('INSERT INTO alias (address, goto, domain, active, created, modified) VALUES (?, ?, ?, 1, NOW(), NOW())', [address, goto, domain]);
        await logAdminAction(req, 'alias.create', 'alias', address, {
            domain,
            targetCount: goto.split(',').filter(Boolean).length,
        });
        res.json({ success: true });
    }
    catch (err) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});
exports.apiRouter.put('/admin/aliases/:address', requireAuth, requireAdmin, async (req, res) => {
    try {
        const oldAddress = normalizeAliasAddress(req.params.address);
        const address = normalizeAliasAddress(req.body?.address || oldAddress, req.body?.domain);
        const domain = deriveDomainFromAddress(address);
        const goto = normalizeAliasTargets(req.body?.goto);
        const [result] = await db_1.pool.query('UPDATE alias SET address = ?, goto = ?, domain = ?, modified = NOW() WHERE address = ?', [address, goto, domain, oldAddress]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Alias not found' });
        }
        await logAdminAction(req, 'alias.update', 'alias', address, {
            domain,
            previousAddress: oldAddress,
            targetCount: goto.split(',').filter(Boolean).length,
        });
        res.json({ success: true });
    }
    catch (err) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});
exports.apiRouter.delete('/admin/aliases/:address', requireAuth, requireAdmin, async (req, res) => {
    try {
        const address = normalizeAliasAddress(req.params.address);
        await db_1.pool.query('DELETE FROM alias WHERE address = ?', [address]);
        await logAdminAction(req, 'alias.delete', 'alias', address);
        res.json({ success: true });
    }
    catch (err) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/admin/routing', requireAuth, requireAdmin, async (_req, res) => {
    try {
        const [rows] = await db_1.pool.query(`
            SELECT alias_domain, target_domain, created, modified, active
            FROM alias_domain
            ORDER BY alias_domain ASC
        `);
        res.json({ success: true, data: rows });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/admin/routing', requireAuth, requireAdmin, async (req, res) => {
    try {
        const aliasDomain = requireValidDomain(req.body?.alias_domain);
        const targetDomain = requireValidDomain(req.body?.target_domain);
        if (aliasDomain === targetDomain) {
            return res.status(400).json({ success: false, error: 'Target domain must be different from alias domain' });
        }
        const [domainRows] = await db_1.pool.query('SELECT 1 FROM domain WHERE domain = ? LIMIT 1', [targetDomain]);
        if (domainRows.length === 0) {
            return res.status(404).json({ success: false, error: 'Target domain not found' });
        }
        await db_1.pool.query('INSERT INTO alias_domain (alias_domain, target_domain, active, created, modified) VALUES (?, ?, 1, NOW(), NOW())', [aliasDomain, targetDomain]);
        await logAdminAction(req, 'routing.create', 'routing', aliasDomain, {
            domain: aliasDomain,
            targetDomain,
        });
        res.json({ success: true });
    }
    catch (err) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});
exports.apiRouter.delete('/admin/routing/:aliasDomain', requireAuth, requireAdmin, async (req, res) => {
    try {
        const aliasDomain = requireValidDomain(req.params.aliasDomain);
        await db_1.pool.query('DELETE FROM alias_domain WHERE alias_domain = ?', [aliasDomain]);
        await logAdminAction(req, 'routing.delete', 'routing', aliasDomain, { domain: aliasDomain });
        res.json({ success: true });
    }
    catch (err) {
        res.status(adminErrorStatus(err)).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/admin/apikeys', requireAuth, requireAdmin, async (req, res) => {
    try {
        const [rows] = await db_1.pool.query('SELECT id, description, created_at, last_used FROM api_keys ORDER BY created_at DESC');
        res.json({ success: true, data: rows });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/admin/apikeys', requireAuth, requireAdmin, async (req, res) => {
    const { description } = req.body;
    try {
        const raw_key = 'sk_' + crypto_1.default.randomBytes(32).toString('hex');
        const key_hash = await bcryptjs_1.default.hash(raw_key, 10);
        await db_1.pool.query('INSERT INTO api_keys (description, key_hash, created_at) VALUES (?, ?, NOW())', [description, key_hash]);
        await logAdminAction(req, 'apikey.create', 'api_key', String(description || '').slice(0, 255), {
            description: String(description || '').slice(0, 255),
        });
        res.json({ success: true, raw_key });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.delete('/admin/apikeys/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        await db_1.pool.query('DELETE FROM api_keys WHERE id = ?', [req.params.id]);
        await logAdminAction(req, 'apikey.delete', 'api_key', String(req.params.id || ''));
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/admin/updates', requireAuth, requireAdmin, async (req, res) => {
    try {
        const currentVersion = (0, version_info_1.readInstalledVersion)();
        const components = {};
        try {
            const { stdout } = await execPromise("nginx -v 2>&1 | awk -F/ '{print $2}' | awk '{print $1}'");
            components.Nginx = stdout.trim();
        }
        catch (e) {
            components.Nginx = 'Not Installed';
        }
        try {
            const { stdout } = await execPromise("postconf -h mail_version 2>/dev/null");
            components.Postfix = stdout.trim();
        }
        catch (e) {
            components.Postfix = 'Not Installed';
        }
        try {
            const { stdout } = await execPromise("dovecot --version 2>/dev/null | awk '{print $1}'");
            components.Dovecot = stdout.trim();
        }
        catch (e) {
            components.Dovecot = 'Not Installed';
        }
        const componentList = Object.entries(components).map(([name, version]) => ({ name, version: version }));
        res.json({
            success: true,
            current_version: currentVersion,
            update_policy: {
                mode: 'manual',
                message: 'Updates use the release-specific manual procedure; this page does not check for or install releases.',
            },
            components: componentList
        });
    }
    catch (err) {
        const status = err instanceof version_info_1.InstalledVersionError ? 503 : 500;
        res.status(status).json({ success: false, error: err.message });
    }
});
exports.apiRouter.get('/admin/spam_policies', requireAuth, requireAdmin, async (req, res) => {
    try {
        const [rows] = await db_1.pool.query('SELECT rules_json FROM global_spam_rules WHERE id = 1');
        const rules = rows.length > 0 ? rows[0].rules_json : null;
        res.json({ success: true, rules: rules ? JSON.parse(rules) : null });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/admin/spam_policies', requireAuth, requireAdmin, async (req, res) => {
    const { rules } = req.body;
    try {
        const rulesStr = JSON.stringify(rules);
        await db_1.pool.query('INSERT INTO global_spam_rules (id, rules_json) VALUES (1, ?) ON DUPLICATE KEY UPDATE rules_json = ?', [rulesStr, rulesStr]);
        await logAdminAction(req, 'spam_policy.update', 'spam_policy', 'global', {
            bytes: Buffer.byteLength(rulesStr, 'utf8'),
        });
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
const notes_utils_1 = require("./notes-utils");
const notes_imap_sync_1 = require("./notes-imap-sync");
const notes_collaboration_1 = require("./notes-collaboration");
const path_1 = __importDefault(require("path"));
const notesUploadDir = path_1.default.join(__dirname, '..', 'uploads', 'notes');
if (!fs_1.default.existsSync(notesUploadDir)) {
    fs_1.default.mkdirSync(notesUploadDir, { recursive: true });
}
const notesImageUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
            const user = _req.user?.username || 'unknown';
            const userDir = path_1.default.join(notesUploadDir, user);
            if (!fs_1.default.existsSync(userDir))
                fs_1.default.mkdirSync(userDir, { recursive: true });
            cb(null, userDir);
        },
        filename: (_req, file, cb) => {
            cb(null, `${crypto_1.default.randomUUID()}${path_1.default.extname(file.originalname) || '.png'}`);
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        }
        else {
            cb(new Error('Only PNG, JPEG, GIF, and WebP images are allowed'));
        }
    }
});
const attachmentsUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
            const user = _req.user?.username || 'unknown';
            const userDir = path_1.default.join(notesUploadDir, user);
            if (!fs_1.default.existsSync(userDir))
                fs_1.default.mkdirSync(userDir, { recursive: true });
            cb(null, userDir);
        },
        filename: (_req, file, cb) => {
            cb(null, `${crypto_1.default.randomUUID()}${path_1.default.extname(file.originalname)}`);
        }
    }),
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const blocked = ['application/x-msdownload', 'application/x-msdos-program', 'application/x-executable', 'application/x-sh', 'application/x-shockwave-flash'];
        if (blocked.includes(file.mimetype)) {
            cb(new Error('Executable files are not allowed'));
        }
        else {
            cb(null, true);
        }
    }
});
exports.apiRouter.get('/notes', requireAuth, async (req, res) => {
    try {
        await (0, notes_imap_sync_1.syncNotesWithImap)(req.user.username, req.user.password);
        const notes = await (0, notes_utils_1.listNotesWithReminders)(req.user.username);
        console.log(`[NOTES GET] User: ${req.user.username}, count: ${notes.length}`);
        res.json({ success: true, notes });
    }
    catch (err) {
        console.error(`[NOTES GET] ERROR:`, err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/notes', requireAuth, async (req, res) => {
    try {
        const { title, content, color, is_pinned, is_locked, folder, labels_json } = req.body;
        const note = await (0, notes_utils_1.saveNote)({
            title, content, owner: req.user.username,
            color, is_pinned, is_locked, folder, labels_json
        });
        (0, notes_imap_sync_1.syncNotesWithImap)(req.user.username, req.user.password).catch(e => console.error(e));
        res.json({ success: true, note });
    }
    catch (err) {
        if (err instanceof notes_utils_1.NoteValidationError) {
            res.status(err.statusCode).json((0, notes_utils_1.noteValidationErrorBody)(err));
            return;
        }
        console.error('Notes POST error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.post('/notes/:id/collaboration-session', requireAuth, notesCollaborationSessionLimit, async (req, res) => {
    try {
        const capability = await (0, notes_collaboration_1.authorizeNoteCollaboration)({
            enabled: config_1.serverConfig.notesCollaborationEnabled,
            noteId: req.params.id,
            owner: req.user.username,
            sessionId: req.user.sessionId,
            secret: config_1.serverConfig.sessionSecret,
            findOwnedNote: notes_utils_1.getNote,
        });
        res.setHeader('Cache-Control', 'no-store');
        res.json({
            success: true,
            ...capability,
            signalingPath: notes_collaboration_1.NOTES_SIGNALING_PATH,
        });
    }
    catch (error) {
        if (error instanceof notes_collaboration_1.NoteCollaborationError) {
            res.status(error.statusCode).json({ success: false, error: error.message });
            return;
        }
        console.error('Notes collaboration session error:', error);
        res.status(500).json({ success: false, error: 'Collaboration is temporarily unavailable' });
    }
});
exports.apiRouter.put('/notes/:id', requireAuth, async (req, res) => {
    try {
        const { title, content, color, is_pinned, is_locked, folder, labels_json, expected_sync_token } = req.body;
        if (expected_sync_token === undefined) {
            res.status(428).json({ success: false, error: 'The current note revision is required.' });
            return;
        }
        const note = await (0, notes_utils_1.saveNote)({
            id: req.params.id, owner: req.user.username,
            title, content, color, is_pinned, is_locked, folder, labels_json, expected_sync_token
        });
        (0, notes_imap_sync_1.syncNotesWithImap)(req.user.username, req.user.password).catch(e => console.error(e));
        res.json({ success: true, note });
    }
    catch (err) {
        if (err instanceof notes_utils_1.NoteConflictError) {
            res.status(409).json({ success: false, error: err.message });
            return;
        }
        if (err instanceof notes_utils_1.NoteValidationError) {
            res.status(err.statusCode).json((0, notes_utils_1.noteValidationErrorBody)(err));
            return;
        }
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.apiRouter.delete('/notes/:id', requireAuth, async (req, res) => {
    try {
        await (0, notes_utils_1.deleteNote)(req.params.id, req.user.username);
        (0, notes_imap_sync_1.syncNotesWithImap)(req.user.username, req.user.password).catch(e => console.error(e));
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// ---- Notes: Image upload ----
exports.apiRouter.post('/notes/upload', requireAuth, notesImageUpload.single('file'), async (req, res) => {
    if (!req.file) {
        res.status(400).json({ success: false, error: 'No file uploaded' });
        return;
    }
    const user = req.user.username || 'unknown';
    const url = `/uploads/notes/${user}/${req.file.filename}`;
    res.json({ success: true, url });
});
// ---- Notes: Reminders ----
exports.apiRouter.get('/notes/:id/reminder', requireAuth, async (req, res) => {
    try {
        const reminder = await (0, notes_utils_1.getNoteReminder)(req.params.id, req.user.username);
        if (!reminder) {
            res.json({ success: true, reminder: null });
            return;
        }
        res.json({ success: true, reminder: { remind_at: reminder.remind_at } });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.apiRouter.post('/notes/:id/reminder', requireAuth, async (req, res) => {
    try {
        if (!req.body.remind_at) {
            res.status(400).json({ success: false, error: 'remind_at is required' });
            return;
        }
        await (0, notes_utils_1.saveNoteReminder)(req.params.id, req.body.remind_at, req.user.username);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.apiRouter.delete('/notes/:id/reminder', requireAuth, async (req, res) => {
    try {
        await (0, notes_utils_1.deleteNoteReminder)(req.params.id, req.user.username);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
// ---- Notes: Attachments ----
exports.apiRouter.get('/notes/:id/attachments', requireAuth, async (req, res) => {
    try {
        const attachments = await (0, notes_utils_1.listNoteAttachments)(req.params.id, req.user.username);
        const attachmentsWithUrl = attachments.map((att) => ({
            ...att,
            url: `/uploads/${att.storage_path}`,
        }));
        res.json({ success: true, attachments: attachmentsWithUrl });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.apiRouter.post('/notes/:id/attachments', requireAuth, attachmentsUpload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            res.status(400).json({ success: false, error: 'No file uploaded' });
            return;
        }
        const id = crypto_1.default.randomUUID();
        const user = req.user.username || 'unknown';
        const storagePath = path_1.default.join('notes', user, req.file.filename);
        const attachment = {
            id,
            note_id: req.params.id,
            filename: req.file.originalname,
            mime_type: req.file.mimetype,
            size_bytes: req.file.size,
            storage_path: storagePath,
        };
        await (0, notes_utils_1.saveNoteAttachment)(attachment, user);
        res.json({ success: true, attachment: { ...attachment, url: `/uploads/${storagePath}` } });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.apiRouter.delete('/notes/:id/attachments/:attachmentId', requireAuth, async (req, res) => {
    try {
        const deleted = await (0, notes_utils_1.deleteNoteAttachment)(req.params.attachmentId, req.user.username);
        if (!deleted) {
            res.status(404).json({ success: false, error: 'Attachment not found' });
            return;
        }
        const filePath = path_1.default.join(__dirname, '..', 'uploads', deleted.storage_path);
        if (fs_1.default.existsSync(filePath)) {
            fs_1.default.unlinkSync(filePath);
        }
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
//# sourceMappingURL=api.js.map