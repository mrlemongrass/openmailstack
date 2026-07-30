"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulerJobRepository = exports.SchedulerWorkflowDeliveryDispatcher = exports.SchedulerContactPreferenceRepository = exports.SchedulerDeliveryProviderRepository = exports.SchedulerWorkflowRepository = exports.workflowConditionMatches = exports.bookingConsentAllows = exports.SchedulerProviderError = exports.SchedulerSecretBox = void 0;
exports.normalizeWorkflowDefinition = normalizeWorkflowDefinition;
exports.normalizeCommunicationConsents = normalizeCommunicationConsents;
exports.normalizeProviderConfig = normalizeProviderConfig;
exports.renderWorkflowAction = renderWorkflowAction;
exports.workflowRunAt = workflowRunAt;
exports.schedulerReminderMail = schedulerReminderMail;
exports.runSchedulerJobCycle = runSchedulerJobCycle;
const crypto_1 = __importDefault(require("crypto"));
const provider_http_1 = require("./provider-http");
const MAX_SCHEDULE_SECONDS = 366 * 24 * 60 * 60;
const MAX_JOB_ATTEMPTS = 8;
class SchedulerSecretBox {
    currentVersion;
    rootKeys = new Map();
    constructor(keyMaterial) {
        const ring = typeof keyMaterial === 'string'
            ? { currentVersion: 1, keys: { 1: keyMaterial } }
            : keyMaterial;
        if (!Number.isInteger(ring.currentVersion) || ring.currentVersion < 1 || ring.currentVersion > 65535) {
            throw new Error('Scheduler secret key version is invalid');
        }
        for (const [versionValue, material] of Object.entries(ring.keys || {})) {
            const version = Number(versionValue);
            if (!Number.isInteger(version) || version < 1 || version > 65535 || !material)
                continue;
            this.rootKeys.set(version, crypto_1.default.createHash('sha256').update(material).digest());
        }
        if (!this.rootKeys.has(ring.currentVersion))
            throw new Error('Scheduler current secret key is required');
        this.currentVersion = ring.currentVersion;
    }
    key(purpose, version) {
        const rootKey = this.rootKeys.get(version);
        if (!rootKey)
            throw new Error(`Scheduler secret key version ${version} is unavailable`);
        return crypto_1.default.createHmac('sha256', rootKey).update(`openmailstack:scheduler:${purpose}`).digest();
    }
    encrypt(value, purpose) {
        if (!value)
            throw new Error('Scheduler secret value is required');
        const iv = crypto_1.default.randomBytes(12);
        const cipher = crypto_1.default.createCipheriv('aes-256-gcm', this.key(purpose, this.currentVersion), iv);
        const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        return { ciphertext: encrypted.toString('base64'), iv, tag: cipher.getAuthTag(), keyVersion: this.currentVersion };
    }
    decrypt(value, purpose) {
        const decipher = crypto_1.default.createDecipheriv('aes-256-gcm', this.key(purpose, value.keyVersion || 1), value.iv);
        decipher.setAuthTag(value.tag);
        return Buffer.concat([
            decipher.update(Buffer.from(value.ciphertext, 'base64')),
            decipher.final(),
        ]).toString('utf8');
    }
}
exports.SchedulerSecretBox = SchedulerSecretBox;
class SchedulerProviderError extends Error {
    disposition;
    code;
    constructor(message, disposition, code = 'delivery_failed') {
        super(message);
        this.disposition = disposition;
        this.code = code;
        this.name = 'SchedulerProviderError';
    }
}
exports.SchedulerProviderError = SchedulerProviderError;
const integer = (value, label, minimum, maximum) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
    }
    return parsed;
};
const optionalString = (value, maximum, label) => {
    if (value == null || value === '')
        return undefined;
    const parsed = String(value).trim();
    if (!parsed || parsed.length > maximum)
        throw new Error(`${label} must contain at most ${maximum} characters`);
    return parsed;
};
const WORKFLOW_TRIGGERS = new Set([
    'booking.requested', 'booking.start', 'booking.ended', 'booking.confirmed', 'booking.rejected',
    'booking.cancelled', 'booking.rescheduled', 'booking.completed', 'booking.no_show',
]);
const WORKFLOW_ACTIONS = new Set([
    'message.email.reminder', 'message.email', 'notification.in_app', 'webhook.http', 'message.external',
]);
const EXTERNAL_CHANNELS = new Set(['sms', 'whatsapp', 'voice']);
const PROVIDER_CHANNELS = new Set([
    'webhook', 'sms', 'whatsapp', 'voice', 'translation',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
const WORKFLOW_CONDITION_FIELDS = new Set([
    'booking.status', 'booker.locale', 'booking.consent',
]);
const WORKFLOW_CONDITION_OPERATORS = new Set([
    'equals', 'not_equals', 'contains',
]);
const WORKFLOW_VARIABLE_NAMES = new Set([
    'event.title', 'booking.start', 'booking.manage_url', 'booker.name',
    'booker.email', 'booker.phone', 'host.email',
]);
const templateVariables = (template, label) => {
    const variables = [];
    const source = String(template || '');
    const withoutPlaceholders = source.replace(/{{\s*([^{}]+?)\s*}}/g, (_match, variableValue) => {
        const variable = variableValue.trim();
        if (!WORKFLOW_VARIABLE_NAMES.has(variable))
            throw new Error(`Unsupported workflow variable: ${variable}`);
        variables.push(variable);
        return '';
    });
    if (withoutPlaceholders.includes('{{') || withoutPlaceholders.includes('}}')) {
        throw new Error(`${label} contains a malformed workflow variable`);
    }
    return variables.sort();
};
const requireMatchingVariables = (source, translated, label) => {
    if (!translated)
        return;
    const sourceVariables = templateVariables(source, label);
    const translatedVariables = templateVariables(translated, label);
    if (sourceVariables.length !== translatedVariables.length
        || sourceVariables.some((variable, index) => variable !== translatedVariables[index])) {
        throw new Error(`${label} must preserve the original workflow variables`);
    }
};
const normalizeWorkflowCondition = (value) => {
    if (value == null)
        return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Workflow condition must be an object');
    }
    const condition = value;
    if (!WORKFLOW_CONDITION_FIELDS.has(condition.field)) {
        throw new Error('Workflow condition field is unsupported');
    }
    if (!WORKFLOW_CONDITION_OPERATORS.has(condition.operator)) {
        throw new Error('Workflow condition operator is unsupported');
    }
    const parsedValue = optionalString(condition.value, 120, 'Workflow condition value');
    if (!parsedValue)
        throw new Error('Workflow condition value is required');
    if (condition.field === 'booking.consent' && !EXTERNAL_CHANNELS.has(parsedValue)) {
        throw new Error('Workflow consent condition must name sms, whatsapp, or voice');
    }
    if (condition.field === 'booking.consent' && condition.operator !== 'contains') {
        throw new Error('Workflow consent conditions must use the contains operator');
    }
    return {
        field: condition.field,
        operator: condition.operator,
        value: parsedValue,
    };
};
const normalizeTranslations = (value) => {
    if (value == null)
        return undefined;
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Workflow translations must be an object');
    const entries = Object.entries(value);
    if (entries.length > 10)
        throw new Error('Workflow translations cannot contain more than 10 locales');
    const result = {};
    for (const [locale, translation] of entries) {
        if (!LOCALE_PATTERN.test(locale) || !translation || typeof translation !== 'object' || Array.isArray(translation)) {
            throw new Error('Workflow translation locale is invalid');
        }
        const item = translation;
        result[locale] = {
            subject: optionalString(item.subject, 200, 'Translated subject'),
            body: optionalString(item.body, 8000, 'Translated body'),
        };
        if (!result[locale].subject && !result[locale].body)
            throw new Error('Workflow translation must contain a subject or body');
    }
    return result;
};
const normalizeStepConfig = (action, value) => {
    const config = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    if (action === 'webhook.http') {
        const providerId = String(config.providerId || '');
        if (!UUID_PATTERN.test(providerId))
            throw new Error('Webhook action requires a valid provider id');
        return { providerId };
    }
    if (action === 'message.external') {
        const providerId = String(config.providerId || '');
        if (!UUID_PATTERN.test(providerId))
            throw new Error('External message action requires a valid provider id');
        if (!EXTERNAL_CHANNELS.has(config.channel))
            throw new Error('External message action requires sms, whatsapp, or voice');
        const body = optionalString(config.body, 4000, 'External message body');
        if (!body)
            throw new Error('External message body is required');
        templateVariables(body, 'External message body');
        const translations = normalizeTranslations(config.translations);
        for (const [locale, translation] of Object.entries(translations || {})) {
            requireMatchingVariables(body, translation.body, `Translated ${locale} body`);
            if (translation.subject)
                throw new Error('External message translations cannot contain a subject');
        }
        return { providerId, channel: config.channel, body, translations, requiresConsent: true };
    }
    const recipient = action === 'notification.in_app' || config.recipient === 'host' ? 'host' : 'guest';
    if (action === 'notification.in_app' && recipient !== 'host') {
        throw new Error('In-app notifications can only target the host');
    }
    const subject = optionalString(config.subject, 200, action === 'notification.in_app' ? 'Notification subject' : 'Email subject');
    const title = optionalString(config.title, 200, 'Notification title');
    const body = optionalString(config.body, 8000, action === 'notification.in_app' ? 'Notification body' : 'Email body');
    if (action === 'notification.in_app' && !(title || subject))
        throw new Error('In-app notification title is required');
    templateVariables(subject || title, 'Workflow subject');
    templateVariables(body, 'Workflow body');
    const translations = normalizeTranslations(config.translations);
    for (const [locale, translation] of Object.entries(translations || {})) {
        requireMatchingVariables(subject || title, translation.subject, `Translated ${locale} subject`);
        requireMatchingVariables(body, translation.body, `Translated ${locale} body`);
    }
    return {
        recipient,
        subject,
        title,
        body,
        translations,
        requiresConsent: action === 'message.email' && config.requiresConsent === true,
    };
};
function normalizeWorkflowDefinition(value) {
    if (!value || !WORKFLOW_TRIGGERS.has(value.trigger?.type)) {
        throw new Error('Scheduler workflow trigger is unsupported');
    }
    if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 20) {
        throw new Error('Scheduler workflow must contain between 1 and 20 steps');
    }
    const offsetSeconds = integer(value.trigger.offsetSeconds ?? 0, 'Trigger offset', -MAX_SCHEDULE_SECONDS, MAX_SCHEDULE_SECONDS);
    if (!['booking.start', 'booking.ended'].includes(value.trigger.type) && offsetSeconds < 0) {
        throw new Error('Scheduler workflow cannot run before a lifecycle event');
    }
    return {
        trigger: {
            type: value.trigger.type,
            offsetSeconds,
        },
        steps: value.steps.map((step) => {
            if (!WORKFLOW_ACTIONS.has(step?.action)) {
                throw new Error('Scheduler workflow action is unsupported');
            }
            return {
                action: step.action,
                delaySeconds: integer(step.delaySeconds ?? 0, 'Step delay', 0, MAX_SCHEDULE_SECONDS),
                condition: normalizeWorkflowCondition(step.condition),
                config: normalizeStepConfig(step.action, step.config),
            };
        }),
    };
}
const normalizePhone = (value) => {
    const raw = String(value || '').trim();
    if (!raw)
        return '';
    if (!raw.startsWith('+'))
        throw new Error('Phone number must use international format, such as +16025550123');
    const phone = `+${raw.slice(1).replace(/\D/g, '')}`;
    if (!/^\+[1-9]\d{7,14}$/.test(phone))
        throw new Error('Phone number must use international format, such as +16025550123');
    return phone;
};
function normalizeCommunicationConsents(value) {
    const channels = [];
    for (const candidate of Array.isArray(value?.channels) ? value.channels : []) {
        if (!EXTERNAL_CHANNELS.has(candidate))
            throw new Error('Unsupported communication channel');
        if (!channels.includes(candidate))
            channels.push(candidate);
    }
    const phone = channels.length ? normalizePhone(value?.phone) : '';
    if (channels.length && !phone)
        throw new Error('Phone number is required for external communication consent');
    return { phone, channels };
}
const bookingConsentAllows = (payload, channel) => Array.isArray(payload.communicationConsents) && payload.communicationConsents.includes(channel);
exports.bookingConsentAllows = bookingConsentAllows;
const workflowConditionMatches = (condition, payload) => {
    if (!condition)
        return true;
    const source = condition.field === 'booking.status'
        ? String(payload.status || '')
        : condition.field === 'booker.locale'
            ? String(payload.locale || 'en')
            : payload.communicationConsents || [];
    const matches = condition.operator === 'contains'
        ? Array.isArray(source) ? source.includes(condition.value) : source.includes(condition.value)
        : String(source) === condition.value;
    return condition.operator === 'not_equals' ? !matches : matches;
};
exports.workflowConditionMatches = workflowConditionMatches;
function normalizeProviderConfig(value) {
    const name = String(value?.name || '').trim();
    if (!name || name.length > 120)
        throw new Error('Provider name must contain between 1 and 120 characters');
    if (!PROVIDER_CHANNELS.has(value?.channel))
        throw new Error('Provider channel is unsupported');
    let endpoint;
    try {
        endpoint = new URL(String(value?.endpointUrl || ''));
    }
    catch {
        throw new Error('Provider endpoint must be a valid HTTPS URL');
    }
    if (endpoint.protocol !== 'https:')
        throw new Error('Provider endpoint must use HTTPS');
    if (endpoint.username || endpoint.password)
        throw new Error('Provider endpoint cannot contain credentials');
    const authHeaderName = String(value?.authHeaderName || 'Authorization').trim();
    if (!/^[A-Za-z0-9-]{1,64}$/.test(authHeaderName))
        throw new Error('Provider authentication header name is invalid');
    const secret = value?.secret == null ? undefined : String(value.secret);
    if (secret && secret.length > 4096)
        throw new Error('Provider secret cannot exceed 4096 characters');
    return {
        name,
        channel: value.channel,
        endpointUrl: endpoint.toString(),
        authHeaderName,
        secret,
        timeoutSeconds: integer(value?.timeoutSeconds ?? 15, 'Provider timeout', 2, 30),
        allowPrivateNetwork: value?.allowPrivateNetwork === true,
        enabled: value?.enabled !== false,
    };
}
const WORKFLOW_VARIABLES = {
    'event.title': payload => payload.title,
    'booking.start': payload => payload.start,
    'booking.manage_url': payload => payload.manageUrl,
    'booker.name': payload => payload.bookerName,
    'booker.email': payload => payload.bookerEmail,
    'booker.phone': payload => payload.bookerPhone || '',
    'host.email': payload => payload.hostEmail,
};
const renderTemplate = (template, payload) => template.replace(/{{\s*([^{}]+?)\s*}}/g, (_match, variable) => {
    const resolver = WORKFLOW_VARIABLES[variable];
    if (!resolver)
        throw new Error(`Unsupported workflow variable: ${variable}`);
    return resolver(payload);
});
function renderWorkflowAction(payload, config) {
    const locale = String(payload.locale || 'en');
    const localized = config.translations?.[locale] || config.translations?.[locale.split('-')[0]] || {};
    const subjectTemplate = localized.subject || config.subject || config.title || 'Reminder: {{event.title}}';
    const bodyTemplate = localized.body || config.body || 'This is a reminder for {{event.title}}.\n\nManage booking: {{booking.manage_url}}';
    return {
        recipient: config.recipient === 'host' ? payload.hostEmail : payload.bookerEmail,
        phone: payload.bookerPhone,
        subject: renderTemplate(subjectTemplate, payload),
        body: renderTemplate(bodyTemplate, payload),
    };
}
function workflowRunAt(bookingStart, triggerOffsetSeconds, stepDelaySeconds) {
    if (!Number.isFinite(bookingStart.getTime()))
        throw new Error('Booking start must be a valid date');
    return new Date(bookingStart.getTime() + (triggerOffsetSeconds + stepDelaySeconds) * 1000);
}
function schedulerReminderMail(payload, config) {
    const when = new Intl.DateTimeFormat('en-US', {
        timeZone: payload.timeZone || 'UTC',
        dateStyle: 'full',
        timeStyle: 'short',
    }).format(new Date(payload.start));
    const defaultBody = `This is a reminder that ${payload.title} is scheduled for ${when}.\n\nManage booking: ${payload.manageUrl}`;
    const rendered = renderWorkflowAction(payload, {
        ...config,
        subject: config.subject || 'Reminder: {{event.title}}',
        body: config.body || defaultBody,
    });
    return {
        to: rendered.recipient,
        subject: rendered.subject,
        text: rendered.body,
        from: {
            name: payload.notificationName || payload.hostEmail || 'OpenMailStack Scheduler',
            address: payload.notificationFrom || payload.hostEmail,
        },
        replyTo: payload.hostEmail,
    };
}
async function runSchedulerJobCycle(repository, provider, workerId) {
    const jobs = await repository.claimBatch(workerId, 1, new Date(Date.now() + 120_000));
    for (const job of jobs) {
        const dispatcher = 'deliver' in provider;
        const providerName = dispatcher ? provider.providerName(job) : provider.name;
        if (!(0, exports.workflowConditionMatches)(job.condition, job.payload)) {
            if (repository.skip) {
                await repository.skip(job.id, workerId, 'condition_not_met');
                continue;
            }
        }
        await repository.beginAttempt(job.id, workerId, providerName);
        try {
            if (!job.jobType || job.jobType === 'message.email.reminder' || job.jobType === 'message.email') {
                schedulerReminderMail(job.payload, job.config);
            }
            else if (job.jobType !== 'webhook.http') {
                renderWorkflowAction(job.payload, job.config);
            }
        }
        catch {
            await repository.fail(job.id, workerId, providerName, job.attempts, 'invalid_payload');
            continue;
        }
        let result;
        try {
            if (dispatcher) {
                result = await provider.deliver(job);
            }
            else {
                result = await provider.send(schedulerReminderMail(job.payload, job.config), job.idempotencyKey);
            }
        }
        catch (error) {
            const errorCode = String(error?.code || error?.name || 'delivery_failed').slice(0, 80);
            if (error?.disposition === 'delivery_uncertain') {
                if (!repository.uncertain)
                    throw error;
                await repository.uncertain(job.id, workerId, providerName, job.attempts, errorCode);
                continue;
            }
            if (error?.disposition === 'operator_action' && repository.deadLetter) {
                await repository.deadLetter(job.id, workerId, providerName, job.attempts, errorCode);
                continue;
            }
            if (error?.disposition === 'policy_skip' && repository.cancel) {
                await repository.cancel(job.id, workerId, providerName, errorCode);
                continue;
            }
            await repository.fail(job.id, workerId, providerName, job.attempts, errorCode);
            continue;
        }
        await repository.complete(job.id, workerId, providerName, result.messageId);
    }
    return jobs.length;
}
const mysqlDate = (date) => date.toISOString().slice(0, 23).replace('T', ' ');
const utcDate = (value) => new Date(`${String(value).replace(' ', 'T')}Z`);
const safeJson = (value) => {
    try {
        return JSON.parse(String(value || '{}'));
    }
    catch {
        return {};
    }
};
const writeSchedulerAudit = async (db, tenantKey, actorType, actorId, action, targetType, targetId, metadata = {}) => {
    await db.query(`INSERT INTO scheduler_audit_events
            (id, tenant_key, actor_type, actor_id, action, target_type, target_id, correlation_id, metadata, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`, [crypto_1.default.randomUUID(), tenantKey, actorType, actorId, action, targetType, targetId,
        crypto_1.default.randomUUID(), JSON.stringify(metadata)]);
};
const jobContact = (action, config, payload) => {
    if (action === 'message.external')
        return { email: payload.bookerEmail, channel: config.channel || null };
    if ((action === 'message.email' || action === 'message.email.reminder') && config.requiresConsent) {
        return { email: config.recipient === 'host' ? payload.hostEmail : payload.bookerEmail, channel: 'email' };
    }
    return { email: null, channel: null };
};
const workflowEventRunAt = (trigger, start, end, triggerOffsetSeconds, stepDelaySeconds, lifecycleAt) => workflowRunAt(trigger === 'booking.start' ? start : trigger === 'booking.ended' ? end : lifecycleAt, triggerOffsetSeconds, stepDelaySeconds);
class SchedulerWorkflowRepository {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async listWorkflows(ownerUsername) {
        const [workflowRows] = await this.pool.query(`SELECT w.id, w.tenant_key, w.name, w.enabled, w.applies_to_all_event_types, w.current_version,
                    CAST(w.archived_at AS CHAR) AS archived_at, CAST(w.created_at AS CHAR) AS created_at,
                    CAST(w.updated_at AS CHAR) AS updated_at,
                    v.id AS version_id, v.trigger_type, v.trigger_offset_seconds
             FROM scheduler_workflows w
             LEFT JOIN scheduler_workflow_versions v ON v.workflow_id=w.id AND v.version=w.current_version
             WHERE w.owner_username=? ORDER BY w.archived_at IS NOT NULL, w.updated_at DESC`, [ownerUsername]);
        if (!workflowRows.length)
            return [];
        const ids = workflowRows.map((row) => row.id);
        const placeholders = ids.map(() => '?').join(',');
        const [eventRows] = await this.pool.query(`SELECT workflow_id, event_type_id FROM scheduler_workflow_event_types
             WHERE workflow_id IN (${placeholders}) ORDER BY event_type_id`, ids);
        const versionIds = workflowRows.map((row) => row.version_id).filter(Boolean);
        const stepRows = versionIds.length ? (await this.pool.query(`SELECT workflow_version_id, action_type, delay_seconds, condition_config, config FROM scheduler_workflow_steps
             WHERE workflow_version_id IN (${versionIds.map(() => '?').join(',')}) ORDER BY workflow_version_id, step_order`, versionIds))[0] : [];
        return workflowRows.map((row) => ({
            id: row.id,
            tenantKey: row.tenant_key,
            name: row.name,
            enabled: Boolean(row.enabled),
            appliesToAllEventTypes: Boolean(row.applies_to_all_event_types),
            eventTypeIds: eventRows.filter((item) => item.workflow_id === row.id).map((item) => item.event_type_id),
            currentVersion: row.current_version === null ? null : Number(row.current_version),
            archivedAt: row.archived_at ? utcDate(row.archived_at).toISOString() : null,
            createdAt: utcDate(row.created_at).toISOString(),
            updatedAt: utcDate(row.updated_at).toISOString(),
            definition: row.version_id ? {
                trigger: { type: row.trigger_type, offsetSeconds: Number(row.trigger_offset_seconds) },
                steps: stepRows.filter((step) => step.workflow_version_id === row.version_id).map((step) => ({
                    action: step.action_type,
                    delaySeconds: Number(step.delay_seconds),
                    condition: step.condition_config ? safeJson(step.condition_config) : undefined,
                    config: safeJson(step.config),
                })),
            } : null,
        }));
    }
    async updateWorkflow(ownerUsername, workflowId, input) {
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [rows] = await connection.query('SELECT tenant_key, name, current_version, archived_at FROM scheduler_workflows WHERE id=? AND owner_username=? FOR UPDATE', [workflowId, ownerUsername]);
            if (!rows.length)
                throw new Error('Workflow not found');
            if (rows[0].archived_at)
                throw new Error('Archived workflows cannot be changed');
            const name = input.name === undefined ? rows[0].name : String(input.name || '').trim();
            if (!name || name.length > 160)
                throw new Error('Workflow name must contain between 1 and 160 characters');
            if (input.enabled === true && !rows[0].current_version)
                throw new Error('Publish a workflow version before enabling it');
            const eventTypeIds = input.eventTypeIds === undefined
                ? null
                : Array.from(new Set(input.eventTypeIds.map(String).filter(Boolean)));
            if (eventTypeIds?.length) {
                const [eventRows] = await connection.query(`SELECT id FROM scheduler_event_types WHERE tenant_key=? AND owner_username=?
                     AND id IN (${eventTypeIds.map(() => '?').join(',')}) FOR UPDATE`, [rows[0].tenant_key, ownerUsername, ...eventTypeIds]);
                if (eventRows.length !== eventTypeIds.length)
                    throw new Error('Workflow event types must belong to the workflow owner');
            }
            await connection.query(`UPDATE scheduler_workflows SET name=?, enabled=COALESCE(?, enabled),
                    applies_to_all_event_types=COALESCE(?, applies_to_all_event_types) WHERE id=?`, [name, input.enabled === undefined ? null : input.enabled ? 1 : 0,
                eventTypeIds === null ? null : eventTypeIds.length ? 0 : 1, workflowId]);
            if (eventTypeIds !== null) {
                await connection.query('DELETE FROM scheduler_workflow_event_types WHERE workflow_id=?', [workflowId]);
                for (const eventTypeId of eventTypeIds) {
                    await connection.query('INSERT INTO scheduler_workflow_event_types (tenant_key, workflow_id, event_type_id) VALUES (?, ?, ?)', [rows[0].tenant_key, workflowId, eventTypeId]);
                }
            }
            await writeSchedulerAudit(connection, rows[0].tenant_key, 'user', ownerUsername, 'workflow.update', 'workflow', workflowId, { enabled: input.enabled, eventTypeCount: eventTypeIds?.length });
            await connection.commit();
        }
        catch (error) {
            await connection.rollback();
            throw error;
        }
        finally {
            connection.release();
        }
    }
    async archiveWorkflow(ownerUsername, workflowId) {
        const [result] = await this.pool.query(`UPDATE scheduler_workflows SET enabled=0, archived_at=COALESCE(archived_at, UTC_TIMESTAMP(3))
             WHERE id=? AND owner_username=?`, [workflowId, ownerUsername]);
        if (result.affectedRows !== 1)
            throw new Error('Workflow not found');
        const [rows] = await this.pool.query('SELECT tenant_key FROM scheduler_workflows WHERE id=?', [workflowId]);
        await writeSchedulerAudit(this.pool, rows[0].tenant_key, 'user', ownerUsername, 'workflow.archive', 'workflow', workflowId);
    }
    async createWorkflow(input) {
        const name = String(input.name || '').trim();
        if (!name || name.length > 160)
            throw new Error('Workflow name must contain between 1 and 160 characters');
        const eventTypeIds = Array.from(new Set((input.eventTypeIds || []).map(String).filter(Boolean)));
        const connection = await this.pool.getConnection();
        const id = crypto_1.default.randomUUID();
        try {
            await connection.beginTransaction();
            const [entitlementRows] = await connection.query('SELECT tenant_key FROM scheduler_mailbox_entitlements WHERE username=? FOR UPDATE', [input.ownerUsername]);
            if (!entitlementRows.length || entitlementRows[0].tenant_key !== input.tenantKey) {
                throw new Error('Workflow tenant must match the owner entitlement');
            }
            if (eventTypeIds.length) {
                const placeholders = eventTypeIds.map(() => '?').join(',');
                const [rows] = await connection.query(`SELECT id FROM scheduler_event_types WHERE tenant_key=? AND owner_username=? AND id IN (${placeholders}) FOR UPDATE`, [input.tenantKey, input.ownerUsername, ...eventTypeIds]);
                if (rows.length !== eventTypeIds.length)
                    throw new Error('Workflow event types must belong to the workflow owner');
            }
            await connection.query(`INSERT INTO scheduler_workflows
                    (id, tenant_key, owner_username, name, enabled, applies_to_all_event_types)
                 VALUES (?, ?, ?, ?, ?, ?)`, [id, input.tenantKey, input.ownerUsername, name, input.enabled ? 1 : 0, eventTypeIds.length ? 0 : 1]);
            for (const eventTypeId of eventTypeIds) {
                await connection.query('INSERT INTO scheduler_workflow_event_types (tenant_key, workflow_id, event_type_id) VALUES (?, ?, ?)', [input.tenantKey, id, eventTypeId]);
            }
            await writeSchedulerAudit(connection, input.tenantKey, 'user', input.ownerUsername, 'workflow.create', 'workflow', id, { eventTypeCount: eventTypeIds.length });
            await connection.commit();
            return { id };
        }
        catch (error) {
            await connection.rollback();
            throw error;
        }
        finally {
            connection.release();
        }
    }
    async cloneWorkflow(ownerUsername, workflowId) {
        const connection = await this.pool.getConnection();
        const clonedId = crypto_1.default.randomUUID();
        try {
            await connection.beginTransaction();
            const [rows] = await connection.query(`SELECT tenant_key, name, applies_to_all_event_types, current_version
                 FROM scheduler_workflows WHERE id=? AND owner_username=? AND archived_at IS NULL FOR UPDATE`, [workflowId, ownerUsername]);
            if (!rows.length)
                throw new Error('Workflow not found');
            const source = rows[0];
            const name = `Copy of ${source.name}`.slice(0, 160);
            await connection.query(`INSERT INTO scheduler_workflows
                    (id, tenant_key, owner_username, name, enabled, applies_to_all_event_types)
                 VALUES (?, ?, ?, ?, 0, ?)`, [clonedId, source.tenant_key, ownerUsername, name, source.applies_to_all_event_types]);
            await connection.query(`INSERT INTO scheduler_workflow_event_types (tenant_key, workflow_id, event_type_id)
                 SELECT tenant_key, ?, event_type_id FROM scheduler_workflow_event_types WHERE workflow_id=?`, [clonedId, workflowId]);
            if (source.current_version) {
                const [versions] = await connection.query(`SELECT id, trigger_type, trigger_offset_seconds FROM scheduler_workflow_versions
                     WHERE workflow_id=? AND version=? LIMIT 1`, [workflowId, source.current_version]);
                const sourceVersion = versions[0];
                const clonedVersionId = crypto_1.default.randomUUID();
                await connection.query(`INSERT INTO scheduler_workflow_versions
                        (id, tenant_key, workflow_id, version, trigger_type, trigger_offset_seconds, created_by)
                     VALUES (?, ?, ?, 1, ?, ?, ?)`, [clonedVersionId, source.tenant_key, clonedId, sourceVersion.trigger_type,
                    sourceVersion.trigger_offset_seconds, ownerUsername]);
                await connection.query(`INSERT INTO scheduler_workflow_steps
                        (id, tenant_key, workflow_version_id, step_order, action_type, delay_seconds, condition_config, config)
                     SELECT UUID(), tenant_key, ?, step_order, action_type, delay_seconds, condition_config, config
                     FROM scheduler_workflow_steps WHERE workflow_version_id=? ORDER BY step_order`, [clonedVersionId, sourceVersion.id]);
                await connection.query('UPDATE scheduler_workflows SET current_version=1 WHERE id=?', [clonedId]);
            }
            await writeSchedulerAudit(connection, source.tenant_key, 'user', ownerUsername, 'workflow.clone', 'workflow', clonedId, { sourceWorkflowId: workflowId });
            await connection.commit();
            return { id: clonedId };
        }
        catch (error) {
            await connection.rollback();
            throw error;
        }
        finally {
            connection.release();
        }
    }
    async publishVersion(workflowId, createdBy, value) {
        const definition = normalizeWorkflowDefinition(value);
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [rows] = await connection.query('SELECT tenant_key, owner_username, current_version, archived_at FROM scheduler_workflows WHERE id=? FOR UPDATE', [workflowId]);
            if (!rows.length)
                throw new Error('Workflow not found');
            if (rows[0].owner_username !== createdBy)
                throw new Error('Only the workflow owner can publish a version');
            if (rows[0].archived_at)
                throw new Error('Archived workflows cannot be changed');
            const version = Number(rows[0].current_version || 0) + 1;
            const versionId = crypto_1.default.randomUUID();
            await connection.query(`INSERT INTO scheduler_workflow_versions
                    (id, tenant_key, workflow_id, version, trigger_type, trigger_offset_seconds, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`, [versionId, rows[0].tenant_key, workflowId, version, definition.trigger.type, definition.trigger.offsetSeconds, createdBy]);
            for (const [index, step] of definition.steps.entries()) {
                await connection.query(`INSERT INTO scheduler_workflow_steps
                        (id, tenant_key, workflow_version_id, step_order, action_type, delay_seconds, condition_config, config)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [crypto_1.default.randomUUID(), rows[0].tenant_key, versionId, index + 1, step.action, step.delaySeconds,
                    step.condition ? JSON.stringify(step.condition) : null, JSON.stringify(step.config)]);
            }
            await connection.query('UPDATE scheduler_workflows SET current_version=? WHERE id=?', [version, workflowId]);
            await writeSchedulerAudit(connection, rows[0].tenant_key, 'user', createdBy, 'workflow.publish', 'workflow', workflowId, { version });
            await connection.commit();
            return { id: versionId, version };
        }
        catch (error) {
            await connection.rollback();
            throw error;
        }
        finally {
            connection.release();
        }
    }
    async enqueueTest(ownerUsername, workflowId, payload) {
        const [rows] = await this.pool.query(`SELECT w.tenant_key, v.id AS version_id, v.version, s.id AS step_id, s.step_order,
                    s.action_type, s.config
             FROM scheduler_workflows w
             JOIN scheduler_workflow_versions v ON v.workflow_id=w.id AND v.version=w.current_version
             JOIN scheduler_workflow_steps s ON s.workflow_version_id=v.id
             WHERE w.id=? AND w.owner_username=? AND w.archived_at IS NULL
             ORDER BY s.step_order`, [workflowId, ownerUsername]);
        if (!rows.length)
            throw new Error('Publish a workflow version before sending a test');
        const safePayload = {
            ...payload,
            tenantKey: rows[0].tenant_key,
            hostEmail: ownerUsername,
            bookerEmail: ownerUsername,
            bookerPhone: undefined,
            communicationConsents: [],
        };
        const jobIds = [];
        const skippedActions = [];
        for (const row of rows) {
            if (row.action_type === 'message.external' || row.action_type === 'webhook.http') {
                skippedActions.push(row.action_type);
                continue;
            }
            const config = safeJson(row.config);
            const contact = jobContact(row.action_type, config, safePayload);
            const jobId = crypto_1.default.randomUUID();
            await this.pool.query(`INSERT INTO scheduler_jobs
                    (id, tenant_key, booking_id, workflow_version_id, workflow_step_id, schedule_generation,
                     job_type, contact_email, consent_channel, idempotency_key, payload, available_at)
                 VALUES (?, ?, NULL, ?, ?, 0, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`, [jobId, row.tenant_key, row.version_id, row.step_id, row.action_type, contact.email, contact.channel,
                `workflow-test:${workflowId}:v${row.version}:step:${row.step_order}:${jobId}`, JSON.stringify(safePayload)]);
            jobIds.push(jobId);
        }
        return { jobIds, skippedActions };
    }
    async requiredChannels(ownerUsername, eventTypeId) {
        const [rows] = await this.pool.query(`SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(s.config, '$.channel')) AS channel
             FROM scheduler_workflows w
             JOIN scheduler_workflow_versions v ON v.workflow_id=w.id AND v.version=w.current_version
             JOIN scheduler_workflow_steps s ON s.workflow_version_id=v.id AND s.action_type='message.external'
             WHERE w.owner_username=? AND w.enabled=1 AND w.archived_at IS NULL
               AND (w.applies_to_all_event_types=1 OR EXISTS (
                    SELECT 1 FROM scheduler_workflow_event_types we WHERE we.workflow_id=w.id AND we.event_type_id=?
               ))`, [ownerUsername, eventTypeId]);
        return rows.map((row) => row.channel).filter((channel) => EXTERNAL_CHANNELS.has(channel));
    }
    async listOperations(ownerUsername, limit = 100) {
        const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
        const [jobs] = await this.pool.query(`SELECT j.id, j.job_type, j.attempts, j.last_error_code, j.contact_email,
                    CAST(j.available_at AS CHAR) AS available_at,
                    CAST(j.completed_at AS CHAR) AS completed_at,
                    CAST(j.cancelled_at AS CHAR) AS cancelled_at,
                    CAST(j.dead_lettered_at AS CHAR) AS dead_lettered_at,
                    w.name AS workflow_name
             FROM scheduler_jobs j
             JOIN scheduler_workflow_versions v ON v.id=j.workflow_version_id
             JOIN scheduler_workflows w ON w.id=v.workflow_id
             WHERE w.owner_username=? ORDER BY j.created_at DESC LIMIT ?`, [ownerUsername, boundedLimit]);
        const [alerts] = await this.pool.query(`SELECT a.id, a.job_id, a.severity, a.alert_type, a.error_code,
                    CAST(a.created_at AS CHAR) AS created_at, CAST(a.resolved_at AS CHAR) AS resolved_at
             FROM scheduler_delivery_alerts a
             JOIN scheduler_jobs j ON j.id=a.job_id
             JOIN scheduler_workflow_versions v ON v.id=j.workflow_version_id
             JOIN scheduler_workflows w ON w.id=v.workflow_id
             WHERE w.owner_username=? ORDER BY a.resolved_at IS NOT NULL, a.created_at DESC LIMIT ?`, [ownerUsername, boundedLimit]);
        const time = (value) => value ? utcDate(value).toISOString() : null;
        return {
            jobs: jobs.map((row) => ({
                id: row.id, workflowName: row.workflow_name, jobType: row.job_type, attempts: Number(row.attempts),
                lastErrorCode: row.last_error_code, contactEmail: row.contact_email,
                availableAt: time(row.available_at), completedAt: time(row.completed_at),
                cancelledAt: time(row.cancelled_at), deadLetteredAt: time(row.dead_lettered_at),
            })),
            alerts: alerts.map((row) => ({
                id: row.id, jobId: row.job_id, severity: row.severity, alertType: row.alert_type,
                errorCode: row.error_code, createdAt: time(row.created_at), resolvedAt: time(row.resolved_at),
            })),
        };
    }
    async listAdminOperations(tenantKeyValue, limit = 100) {
        const tenantKey = String(tenantKeyValue || '').trim().toLowerCase();
        if (tenantKey && !/^[a-z0-9.-]{1,255}$/.test(tenantKey))
            throw new Error('Tenant must be a valid domain');
        const boundedLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
        const tenantWhere = tenantKey ? 'WHERE j.tenant_key=?' : '';
        const values = tenantKey ? [tenantKey, boundedLimit] : [boundedLimit];
        const [jobs] = await this.pool.query(`SELECT j.id, j.tenant_key, j.job_type, j.attempts, j.last_error_code, j.contact_email,
                    CAST(j.available_at AS CHAR) AS available_at,
                    CAST(j.completed_at AS CHAR) AS completed_at,
                    CAST(j.cancelled_at AS CHAR) AS cancelled_at,
                    CAST(j.dead_lettered_at AS CHAR) AS dead_lettered_at,
                    w.name AS workflow_name, w.owner_username
             FROM scheduler_jobs j
             JOIN scheduler_workflow_versions v ON v.id=j.workflow_version_id
             JOIN scheduler_workflows w ON w.id=v.workflow_id
             ${tenantWhere} ORDER BY j.created_at DESC LIMIT ?`, values);
        const alertWhere = tenantKey ? 'WHERE a.tenant_key=?' : '';
        const [alerts] = await this.pool.query(`SELECT a.id, a.tenant_key, a.job_id, a.severity, a.alert_type, a.error_code,
                    CAST(a.created_at AS CHAR) AS created_at, CAST(a.resolved_at AS CHAR) AS resolved_at
             FROM scheduler_delivery_alerts a ${alertWhere}
             ORDER BY a.resolved_at IS NOT NULL, a.created_at DESC LIMIT ?`, values);
        const metricWhere = tenantKey ? 'WHERE tenant_key=?' : '';
        const metricValues = tenantKey ? [tenantKey] : [];
        const [jobMetrics] = await this.pool.query(`SELECT COUNT(*) AS total_jobs,
                    SUM(completed_at IS NULL AND cancelled_at IS NULL AND dead_lettered_at IS NULL) AS queued_jobs,
                    SUM(dead_lettered_at IS NOT NULL AND completed_at IS NULL AND cancelled_at IS NULL) AS recovery_jobs
             FROM scheduler_jobs ${metricWhere}`, metricValues);
        const [deliveryMetrics] = await this.pool.query(`SELECT COUNT(*) AS delivered_24h FROM scheduler_jobs j
             WHERE j.completed_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 DAY)
               ${tenantKey ? 'AND j.tenant_key=?' : ''}
               AND EXISTS (
                   SELECT 1 FROM scheduler_delivery_attempts a
                   WHERE a.job_id=j.id AND a.outcome='sent'
               )`, metricValues);
        const [workflowMetrics] = await this.pool.query(`SELECT COUNT(*) AS active_workflows FROM scheduler_workflows
             ${tenantKey ? 'WHERE tenant_key=? AND enabled=1 AND archived_at IS NULL' : 'WHERE enabled=1 AND archived_at IS NULL'}`, metricValues);
        const [alertMetrics] = await this.pool.query(`SELECT COUNT(*) AS open_alerts FROM scheduler_delivery_alerts
             ${tenantKey ? 'WHERE tenant_key=? AND resolved_at IS NULL' : 'WHERE resolved_at IS NULL'}`, metricValues);
        const time = (value) => value ? utcDate(value).toISOString() : null;
        return {
            jobs: jobs.map((row) => ({
                id: row.id, tenantKey: row.tenant_key, ownerUsername: row.owner_username,
                workflowName: row.workflow_name, jobType: row.job_type, attempts: Number(row.attempts),
                lastErrorCode: row.last_error_code, contactEmail: row.contact_email,
                availableAt: time(row.available_at), completedAt: time(row.completed_at),
                cancelledAt: time(row.cancelled_at), deadLetteredAt: time(row.dead_lettered_at),
            })),
            alerts: alerts.map((row) => ({
                id: row.id, tenantKey: row.tenant_key, jobId: row.job_id, severity: row.severity,
                alertType: row.alert_type, errorCode: row.error_code,
                createdAt: time(row.created_at), resolvedAt: time(row.resolved_at),
            })),
            metrics: {
                activeWorkflows: Number(workflowMetrics[0]?.active_workflows || 0),
                totalJobs: Number(jobMetrics[0]?.total_jobs || 0),
                queuedJobs: Number(jobMetrics[0]?.queued_jobs || 0),
                recoveryJobs: Number(jobMetrics[0]?.recovery_jobs || 0),
                delivered24h: Number(deliveryMetrics[0]?.delivered_24h || 0),
                openAlerts: Number(alertMetrics[0]?.open_alerts || 0),
            },
        };
    }
    async reconcileJob(ownerUsername, jobId, action) {
        return this.reconcileJobScoped('user', ownerUsername, jobId, action, ownerUsername);
    }
    async reconcileJobAsAdmin(adminUsername, jobId, action) {
        return this.reconcileJobScoped('admin', adminUsername, jobId, action);
    }
    async reconcileJobScoped(actorType, actorId, jobId, action, ownerUsername) {
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [rows] = await connection.query(`SELECT j.id, j.tenant_key, j.completed_at, j.cancelled_at, j.dead_lettered_at,
                        (j.lease_owner IS NOT NULL AND j.lease_expires_at>UTC_TIMESTAMP(3)) AS lease_active
                 FROM scheduler_jobs j
                 JOIN scheduler_workflow_versions v ON v.id=j.workflow_version_id
                 JOIN scheduler_workflows w ON w.id=v.workflow_id
                 WHERE j.id=? ${ownerUsername ? 'AND w.owner_username=?' : ''} FOR UPDATE`, ownerUsername ? [jobId, ownerUsername] : [jobId]);
            if (!rows.length)
                throw new Error('Scheduler job not found');
            const job = rows[0];
            if (job.completed_at || job.cancelled_at)
                throw new Error('Only an unresolved dead-lettered job can be reconciled');
            if (job.lease_active)
                throw new Error('An actively leased job cannot be reconciled');
            if (!job.dead_lettered_at)
                throw new Error('Only an unresolved dead-lettered job can be reconciled');
            if (action === 'retry') {
                const [result] = await connection.query(`UPDATE scheduler_jobs SET dead_lettered_at=NULL, available_at=UTC_TIMESTAMP(3),
                        last_error_code=NULL, lease_owner=NULL, lease_expires_at=NULL
                     WHERE id=? AND completed_at IS NULL AND payload<>'{}'`, [jobId]);
                if (result.affectedRows !== 1)
                    throw new Error('Scheduler job has no retained payload to retry');
            }
            else if (action === 'delivered') {
                const [attemptResult] = await connection.query(`UPDATE scheduler_delivery_attempts SET outcome='sent', error_code=NULL,
                        provider_message_id=COALESCE(provider_message_id, 'manual-reconciliation')
                     WHERE job_id=? AND attempt_no=(
                        SELECT latest_attempt FROM (
                            SELECT MAX(attempt_no) AS latest_attempt FROM scheduler_delivery_attempts WHERE job_id=?
                        ) latest
                     ) AND outcome='dead_lettered'`, [jobId, jobId]);
                if (attemptResult.affectedRows !== 1)
                    throw new Error('Scheduler delivery attempt is unavailable for reconciliation');
                await connection.query(`UPDATE scheduler_jobs SET completed_at=COALESCE(completed_at, UTC_TIMESTAMP(3)), payload='{}',
                        dead_lettered_at=NULL, cancelled_at=NULL, last_error_code=NULL, lease_owner=NULL, lease_expires_at=NULL WHERE id=?`, [jobId]);
            }
            else {
                await connection.query(`UPDATE scheduler_jobs SET cancelled_at=COALESCE(cancelled_at, UTC_TIMESTAMP(3)), payload='{}',
                        dead_lettered_at=NULL, last_error_code=NULL, lease_owner=NULL, lease_expires_at=NULL
                     WHERE id=? AND completed_at IS NULL`, [jobId]);
            }
            await connection.query(`UPDATE scheduler_delivery_alerts SET resolved_at=UTC_TIMESTAMP(3), resolved_by=?
                 WHERE job_id=? AND resolved_at IS NULL`, [actorId, jobId]);
            await writeSchedulerAudit(connection, job.tenant_key, actorType, actorId, 'workflow_job.reconcile', 'scheduler_job', jobId, { action });
            await connection.commit();
        }
        catch (error) {
            await connection.rollback();
            throw error;
        }
        finally {
            connection.release();
        }
    }
    async listNotifications(ownerUsername, limit = 50) {
        const [rows] = await this.pool.query(`SELECT id, title, body, CAST(read_at AS CHAR) AS read_at, CAST(created_at AS CHAR) AS created_at
             FROM scheduler_in_app_notifications WHERE recipient_username=? ORDER BY created_at DESC LIMIT ?`, [ownerUsername, Math.max(1, Math.min(100, Math.trunc(limit)))]);
        return rows.map((row) => ({
            id: row.id, title: row.title, body: row.body,
            readAt: row.read_at ? utcDate(row.read_at).toISOString() : null,
            createdAt: utcDate(row.created_at).toISOString(),
        }));
    }
    async markNotificationRead(ownerUsername, notificationId) {
        const [result] = await this.pool.query(`UPDATE scheduler_in_app_notifications SET read_at=COALESCE(read_at, UTC_TIMESTAMP(3))
             WHERE id=? AND recipient_username=?`, [notificationId, ownerUsername]);
        if (result.affectedRows !== 1)
            throw new Error('Notification not found');
    }
    async dismissNotification(ownerUsername, notificationId) {
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [rows] = await connection.query(`SELECT tenant_key FROM scheduler_in_app_notifications
                 WHERE id=? AND recipient_username=? FOR UPDATE`, [notificationId, ownerUsername]);
            if (!rows.length)
                throw new Error('Notification not found');
            await connection.query('DELETE FROM scheduler_in_app_notifications WHERE id=? AND recipient_username=?', [notificationId, ownerUsername]);
            await writeSchedulerAudit(connection, rows[0].tenant_key, 'user', ownerUsername, 'workflow_notification.dismiss', 'scheduler_in_app_notification', notificationId, {});
            await connection.commit();
        }
        catch (error) {
            await connection.rollback();
            throw error;
        }
        finally {
            connection.release();
        }
    }
    async captureForBooking(db, input, lifecycleTrigger = 'booking.confirmed') {
        const [rows] = await db.query(`SELECT w.id AS workflow_id, v.id AS version_id, v.version, v.trigger_type, v.trigger_offset_seconds,
                    s.id AS step_id, s.step_order, s.action_type, s.delay_seconds, s.config
             FROM scheduler_workflows w
             JOIN scheduler_workflow_versions v ON v.workflow_id=w.id AND v.version=w.current_version
             JOIN scheduler_workflow_steps s ON s.workflow_version_id=v.id
             WHERE w.tenant_key=? AND w.owner_username=? AND w.enabled=1
               AND w.archived_at IS NULL
               AND (w.applies_to_all_event_types=1 OR EXISTS (
                    SELECT 1 FROM scheduler_workflow_event_types we
                    WHERE we.workflow_id=w.id AND we.event_type_id=?
               ))
             ORDER BY w.id, s.step_order`, [input.tenantKey, input.hostEmail, input.eventTypeId]);
        let captured = 0;
        const lifecycleAt = new Date();
        const newWorkflows = new Set();
        for (const row of rows) {
            if (!newWorkflows.has(row.workflow_id)) {
                const [result] = await db.query(`INSERT IGNORE INTO scheduler_booking_workflow_versions
                        (tenant_key, booking_id, workflow_id, workflow_version_id, schedule_generation, scheduled_start)
                     VALUES (?, ?, ?, ?, 1, ?)`, [input.tenantKey, input.bookingId, row.workflow_id, row.version_id, mysqlDate(input.start)]);
                if (result.affectedRows === 0)
                    continue;
                newWorkflows.add(row.workflow_id);
                captured += 1;
            }
            if (!newWorkflows.has(row.workflow_id))
                continue;
            const captureTriggers = lifecycleTrigger === 'booking.requested'
                ? ['booking.requested']
                : ['booking.start', 'booking.ended', 'booking.confirmed'];
            if (!captureTriggers.includes(row.trigger_type))
                continue;
            const config = safeJson(row.config);
            const contact = jobContact(row.action_type, config, input);
            const idempotencyKey = `workflow:${row.workflow_id}:v${row.version}:booking:${input.bookingId}:g1:${row.trigger_type}:step:${row.step_order}`;
            await db.query(`INSERT IGNORE INTO scheduler_jobs
                    (id, tenant_key, booking_id, workflow_version_id, workflow_step_id, schedule_generation,
                     job_type, contact_email, consent_channel, idempotency_key, payload, available_at)
                 VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`, [crypto_1.default.randomUUID(), input.tenantKey, input.bookingId, row.version_id, row.step_id, row.action_type,
                contact.email, contact.channel, idempotencyKey, JSON.stringify(input),
                mysqlDate(workflowEventRunAt(row.trigger_type, input.start, input.end, Number(row.trigger_offset_seconds), Number(row.delay_seconds), lifecycleAt))]);
        }
        return captured;
    }
    async activateCapturedForBooking(db, input) {
        const [rows] = await db.query(`SELECT b.workflow_id, b.workflow_version_id, b.schedule_generation,
                    v.version, v.trigger_type, v.trigger_offset_seconds,
                    s.id AS step_id, s.step_order, s.action_type, s.delay_seconds, s.config
             FROM scheduler_booking_workflow_versions b
             JOIN scheduler_workflow_versions v ON v.id=b.workflow_version_id AND v.tenant_key=b.tenant_key
             JOIN scheduler_workflow_steps s ON s.workflow_version_id=v.id AND s.tenant_key=b.tenant_key
             WHERE b.tenant_key=? AND b.booking_id=?
               AND v.trigger_type IN ('booking.start','booking.ended','booking.confirmed')
             ORDER BY b.workflow_id, s.step_order`, [input.tenantKey, input.bookingId]);
        const lifecycleAt = new Date();
        for (const row of rows) {
            const config = safeJson(row.config);
            const contact = jobContact(row.action_type, config, input);
            const idempotencyKey = `workflow:${row.workflow_id}:v${row.version}:booking:${input.bookingId}:g${row.schedule_generation}:${row.trigger_type}:step:${row.step_order}`;
            await db.query(`INSERT IGNORE INTO scheduler_jobs
                    (id, tenant_key, booking_id, workflow_version_id, workflow_step_id, schedule_generation,
                     job_type, contact_email, consent_channel, idempotency_key, payload, available_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [crypto_1.default.randomUUID(), input.tenantKey, input.bookingId, row.workflow_version_id, row.step_id,
                row.schedule_generation, row.action_type, contact.email, contact.channel, idempotencyKey,
                JSON.stringify(input), mysqlDate(workflowEventRunAt(row.trigger_type, input.start, input.end, Number(row.trigger_offset_seconds), Number(row.delay_seconds), lifecycleAt))]);
        }
        return rows.length;
    }
    async rescheduleForBooking(db, input) {
        const [rows] = await db.query(`SELECT b.workflow_id, b.workflow_version_id, b.schedule_generation,
                    CAST(b.scheduled_start AS CHAR) AS scheduled_start_utc,
                    v.version, v.trigger_type, v.trigger_offset_seconds,
                    s.id AS step_id, s.step_order, s.action_type, s.delay_seconds, s.config
             FROM scheduler_booking_workflow_versions b
             JOIN scheduler_workflow_versions v ON v.id=b.workflow_version_id AND v.tenant_key=b.tenant_key
             JOIN scheduler_workflow_steps s ON s.workflow_version_id=v.id AND s.tenant_key=b.tenant_key
             WHERE b.tenant_key=? AND b.booking_id=?
             ORDER BY b.workflow_id, s.step_order FOR UPDATE`, [input.tenantKey, input.bookingId]);
        let scheduled = 0;
        const lifecycleAt = new Date();
        const generations = new Map();
        for (const row of rows) {
            if (utcDate(row.scheduled_start_utc).getTime() === input.start.getTime())
                continue;
            let generation = generations.get(row.workflow_id);
            if (!generation) {
                generation = Number(row.schedule_generation) + 1;
                generations.set(row.workflow_id, generation);
                await db.query(`UPDATE scheduler_delivery_attempts a
                     JOIN scheduler_jobs j ON j.id=a.job_id
                     SET a.outcome='dead_lettered', a.error_code='delivery_uncertain_rescheduled'
                     WHERE j.tenant_key=? AND j.booking_id=? AND j.workflow_version_id=? AND a.outcome='sending'`, [input.tenantKey, input.bookingId, row.workflow_version_id]);
                await db.query(`UPDATE scheduler_jobs j
                     JOIN scheduler_workflow_versions v ON v.id=j.workflow_version_id
                     SET j.cancelled_at=UTC_TIMESTAMP(3), j.payload='{}', j.lease_owner=NULL, j.lease_expires_at=NULL
                     WHERE j.tenant_key=? AND j.booking_id=? AND j.workflow_version_id=?
                       AND v.trigger_type IN ('booking.start','booking.ended')
                       AND completed_at IS NULL AND cancelled_at IS NULL AND dead_lettered_at IS NULL`, [input.tenantKey, input.bookingId, row.workflow_version_id]);
                await db.query(`UPDATE scheduler_delivery_alerts a
                     JOIN scheduler_jobs j ON j.id=a.job_id
                     JOIN scheduler_workflow_versions v ON v.id=j.workflow_version_id
                     SET a.resolved_at=UTC_TIMESTAMP(3), a.resolved_by='system'
                     WHERE j.tenant_key=? AND j.booking_id=? AND j.workflow_version_id=?
                       AND v.trigger_type IN ('booking.start','booking.ended') AND a.resolved_at IS NULL`, [input.tenantKey, input.bookingId, row.workflow_version_id]);
                await db.query(`UPDATE scheduler_booking_workflow_versions SET schedule_generation=?, scheduled_start=?
                     WHERE tenant_key=? AND booking_id=? AND workflow_id=?`, [generation, mysqlDate(input.start), input.tenantKey, input.bookingId, row.workflow_id]);
            }
            if (!['booking.start', 'booking.ended', 'booking.rescheduled'].includes(row.trigger_type))
                continue;
            const config = safeJson(row.config);
            const contact = jobContact(row.action_type, config, input);
            const idempotencyKey = `workflow:${row.workflow_id}:v${row.version}:booking:${input.bookingId}:g${generation}:${row.trigger_type}:step:${row.step_order}`;
            await db.query(`INSERT IGNORE INTO scheduler_jobs
                    (id, tenant_key, booking_id, workflow_version_id, workflow_step_id, schedule_generation,
                     job_type, contact_email, consent_channel, idempotency_key, payload, available_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [crypto_1.default.randomUUID(), input.tenantKey, input.bookingId, row.workflow_version_id, row.step_id, generation,
                row.action_type, contact.email, contact.channel, idempotencyKey, JSON.stringify(input),
                mysqlDate(workflowEventRunAt(row.trigger_type, input.start, input.end, Number(row.trigger_offset_seconds), Number(row.delay_seconds), lifecycleAt))]);
            scheduled += 1;
        }
        return scheduled;
    }
    async triggerForBooking(db, input, trigger) {
        const [rows] = await db.query(`SELECT b.workflow_id, b.workflow_version_id, b.schedule_generation,
                    v.version, v.trigger_offset_seconds,
                    s.id AS step_id, s.step_order, s.action_type, s.delay_seconds, s.config
             FROM scheduler_booking_workflow_versions b
             JOIN scheduler_workflow_versions v ON v.id=b.workflow_version_id AND v.tenant_key=b.tenant_key
             JOIN scheduler_workflow_steps s ON s.workflow_version_id=v.id AND s.tenant_key=b.tenant_key
             WHERE b.tenant_key=? AND b.booking_id=? AND v.trigger_type=?
             ORDER BY b.workflow_id, s.step_order`, [input.tenantKey, input.bookingId, trigger]);
        const lifecycleAt = new Date();
        for (const row of rows) {
            const config = safeJson(row.config);
            const contact = jobContact(row.action_type, config, input);
            const idempotencyKey = `workflow:${row.workflow_id}:v${row.version}:booking:${input.bookingId}:g${row.schedule_generation}:${trigger}:step:${row.step_order}`;
            await db.query(`INSERT IGNORE INTO scheduler_jobs
                    (id, tenant_key, booking_id, workflow_version_id, workflow_step_id, schedule_generation,
                     job_type, contact_email, consent_channel, idempotency_key, payload, available_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [crypto_1.default.randomUUID(), input.tenantKey, input.bookingId, row.workflow_version_id, row.step_id,
                row.schedule_generation, row.action_type, contact.email, contact.channel, idempotencyKey,
                JSON.stringify(input), mysqlDate(workflowEventRunAt(trigger, input.start, input.end, Number(row.trigger_offset_seconds), Number(row.delay_seconds), lifecycleAt))]);
        }
        return rows.length;
    }
    async cancelForBooking(db, input) {
        await db.query(`UPDATE scheduler_delivery_attempts a
             JOIN scheduler_jobs j ON j.id=a.job_id
             SET a.outcome='dead_lettered', a.error_code='delivery_uncertain_cancelled'
             WHERE j.tenant_key=? AND j.booking_id=? AND a.outcome='sending'`, [input.tenantKey, input.bookingId]);
        await db.query(`UPDATE scheduler_jobs SET cancelled_at=UTC_TIMESTAMP(3), payload='{}', lease_owner=NULL, lease_expires_at=NULL
             WHERE tenant_key=? AND booking_id=? AND completed_at IS NULL AND cancelled_at IS NULL AND dead_lettered_at IS NULL`, [input.tenantKey, input.bookingId]);
        await db.query(`UPDATE scheduler_delivery_alerts a
             JOIN scheduler_jobs j ON j.id=a.job_id
             SET a.resolved_at=UTC_TIMESTAMP(3), a.resolved_by='system'
             WHERE j.tenant_key=? AND j.booking_id=? AND a.resolved_at IS NULL`, [input.tenantKey, input.bookingId]);
        return this.triggerForBooking(db, input, 'booking.cancelled');
    }
    async listBookingVersions(tenantKey, bookingId) {
        const [rows] = await this.pool.query(`SELECT b.workflow_id, b.workflow_version_id, v.version
             FROM scheduler_booking_workflow_versions b
             JOIN scheduler_workflow_versions v ON v.id=b.workflow_version_id
             WHERE b.tenant_key=? AND b.booking_id=? ORDER BY b.workflow_id`, [tenantKey, bookingId]);
        return rows.map((row) => ({
            workflowId: row.workflow_id,
            versionId: row.workflow_version_id,
            version: Number(row.version),
        }));
    }
}
exports.SchedulerWorkflowRepository = SchedulerWorkflowRepository;
class SchedulerDeliveryProviderRepository {
    pool;
    secrets;
    constructor(pool, secrets) {
        this.pool = pool;
        this.secrets = secrets;
    }
    fromRow(row) {
        return {
            id: row.id,
            tenantKey: row.tenant_key,
            name: row.name,
            channel: row.channel,
            endpointUrl: row.endpoint_url,
            authHeaderName: row.auth_header_name,
            timeoutSeconds: Number(row.timeout_seconds),
            allowPrivateNetwork: Boolean(row.allow_private_network),
            enabled: Boolean(row.enabled),
            hasSecret: Boolean(row.secret_ciphertext),
            lastTestedAt: row.last_tested_at
                ? (row.last_tested_at instanceof Date ? row.last_tested_at : utcDate(row.last_tested_at)).toISOString()
                : null,
            lastTestStatus: row.last_test_status || null,
            lastTestErrorCode: row.last_test_error_code || null,
        };
    }
    async list(tenantKey) {
        const [rows] = await this.pool.query(`SELECT * FROM scheduler_delivery_providers ${tenantKey ? 'WHERE tenant_key=?' : ''}
             ORDER BY tenant_key, name`, tenantKey ? [tenantKey] : []);
        return rows.map((row) => this.fromRow(row));
    }
    async listAvailable(tenantKey) {
        const [rows] = await this.pool.query(`SELECT id, name, channel FROM scheduler_delivery_providers
             WHERE tenant_key=? AND enabled=1 ORDER BY channel, name`, [tenantKey]);
        return rows.map((row) => ({ id: row.id, name: row.name, channel: row.channel }));
    }
    async save(actor, tenantKeyValue, value, providerId) {
        const tenantKey = String(tenantKeyValue || '').trim().toLowerCase();
        if (!/^[a-z0-9.-]{1,255}$/.test(tenantKey))
            throw new Error('Provider tenant must be a valid domain');
        const input = normalizeProviderConfig(value);
        const id = providerId || crypto_1.default.randomUUID();
        if (input.channel === 'webhook' && !input.secret) {
            if (!providerId)
                throw new Error('Signed webhook providers require a secret');
            const [secretRows] = await this.pool.query('SELECT secret_ciphertext FROM scheduler_delivery_providers WHERE id=? AND tenant_key=? LIMIT 1', [providerId, tenantKey]);
            if (!secretRows[0]?.secret_ciphertext)
                throw new Error('Signed webhook providers require a secret');
        }
        const encrypted = input.secret ? this.secrets.encrypt(input.secret, `provider:${id}`) : null;
        if (providerId) {
            const [result] = await this.pool.query(`UPDATE scheduler_delivery_providers SET name=?, channel=?, endpoint_url=?, auth_header_name=?,
                    secret_ciphertext=COALESCE(?, secret_ciphertext), secret_iv=COALESCE(?, secret_iv),
                    secret_tag=COALESCE(?, secret_tag), secret_key_version=COALESCE(?, secret_key_version),
                    timeout_seconds=?, allow_private_network=?, enabled=?, last_tested_at=NULL,
                    last_test_status=NULL, last_test_error_code=NULL
                 WHERE id=? AND tenant_key=?`, [input.name, input.channel, input.endpointUrl, input.authHeaderName, encrypted?.ciphertext || null,
                encrypted?.iv || null, encrypted?.tag || null, encrypted?.keyVersion || null,
                input.timeoutSeconds, input.allowPrivateNetwork ? 1 : 0,
                input.enabled ? 1 : 0, id, tenantKey]);
            if (result.affectedRows !== 1)
                throw new Error('Delivery provider not found');
        }
        else {
            await this.pool.query(`INSERT INTO scheduler_delivery_providers
                    (id, tenant_key, name, channel, endpoint_url, auth_header_name, secret_ciphertext,
                     secret_iv, secret_tag, secret_key_version, timeout_seconds, allow_private_network, enabled, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, tenantKey, input.name, input.channel, input.endpointUrl, input.authHeaderName,
                encrypted?.ciphertext || null, encrypted?.iv || null, encrypted?.tag || null, encrypted?.keyVersion || 1,
                input.timeoutSeconds, input.allowPrivateNetwork ? 1 : 0, input.enabled ? 1 : 0, actor]);
        }
        await writeSchedulerAudit(this.pool, tenantKey, 'admin', actor, providerId ? 'delivery_provider.update' : 'delivery_provider.create', 'delivery_provider', id, { channel: input.channel, allowPrivateNetwork: input.allowPrivateNetwork });
        return (await this.list(tenantKey)).find(provider => provider.id === id);
    }
    async disable(providerId, actor) {
        const [rows] = await this.pool.query('SELECT tenant_key FROM scheduler_delivery_providers WHERE id=?', [providerId]);
        if (!rows.length)
            throw new Error('Delivery provider not found');
        const [result] = await this.pool.query('UPDATE scheduler_delivery_providers SET enabled=0 WHERE id=?', [providerId]);
        if (result.affectedRows !== 1)
            throw new Error('Delivery provider not found');
        await writeSchedulerAudit(this.pool, rows[0].tenant_key, 'admin', actor, 'delivery_provider.disable', 'delivery_provider', providerId);
    }
    async recordTest(providerId, status, errorCode) {
        const [result] = await this.pool.query(`UPDATE scheduler_delivery_providers
             SET last_tested_at=UTC_TIMESTAMP(3), last_test_status=?, last_test_error_code=? WHERE id=?`, [status, errorCode?.slice(0, 80) || null, providerId]);
        if (result.affectedRows !== 1)
            throw new Error('Delivery provider not found');
    }
    async forDelivery(tenantKey, providerId) {
        const [rows] = await this.pool.query('SELECT * FROM scheduler_delivery_providers WHERE id=? AND tenant_key=? AND enabled=1 LIMIT 1', [providerId, tenantKey]);
        if (!rows.length)
            throw new SchedulerProviderError('Delivery provider is unavailable', 'operator_action', 'provider_unavailable');
        const row = rows[0];
        let secret;
        if (row.secret_ciphertext) {
            try {
                secret = this.secrets.decrypt({
                    ciphertext: row.secret_ciphertext, iv: row.secret_iv, tag: row.secret_tag,
                    keyVersion: Number(row.secret_key_version || 1),
                }, `provider:${row.id}`);
            }
            catch {
                throw new SchedulerProviderError('Delivery provider credential cannot be decrypted', 'operator_action', 'provider_secret_invalid');
            }
        }
        if (row.channel === 'webhook' && !secret) {
            throw new SchedulerProviderError('Signed webhook provider credential is missing', 'operator_action', 'provider_secret_missing');
        }
        return { ...this.fromRow(row), secret };
    }
}
exports.SchedulerDeliveryProviderRepository = SchedulerDeliveryProviderRepository;
class SchedulerContactPreferenceRepository {
    pool;
    secrets;
    constructor(pool, secrets) {
        this.pool = pool;
        this.secrets = secrets;
    }
    async recordConsents(db, tenantKey, emailValue, consent) {
        const email = String(emailValue || '').trim().toLowerCase();
        for (const channel of consent.channels) {
            const token = crypto_1.default.randomBytes(32).toString('base64url');
            const encrypted = this.secrets.encrypt(token, `unsubscribe:${tenantKey}:${email}:${channel}`);
            await db.query(`INSERT INTO scheduler_contact_preferences
                    (tenant_key, contact_email, channel, phone, consented_at, unsubscribed_at,
                     unsubscribe_token_hash, unsubscribe_token_ciphertext, unsubscribe_token_iv,
                     unsubscribe_token_tag, unsubscribe_token_key_version)
                 VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), NULL, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE phone=VALUES(phone), consented_at=UTC_TIMESTAMP(3), unsubscribed_at=NULL`, [tenantKey, email, channel, consent.phone, crypto_1.default.createHash('sha256').update(token).digest('hex'),
                encrypted.ciphertext, encrypted.iv, encrypted.tag, encrypted.keyVersion]);
        }
    }
    async current(tenantKey, email, channel) {
        const [rows] = await this.pool.query(`SELECT phone, unsubscribe_token_ciphertext, unsubscribe_token_iv, unsubscribe_token_tag,
                    unsubscribe_token_key_version
             FROM scheduler_contact_preferences
             WHERE tenant_key=? AND contact_email=? AND channel=? AND consented_at IS NOT NULL AND unsubscribed_at IS NULL LIMIT 1`, [tenantKey, email.toLowerCase(), channel]);
        if (!rows.length)
            return null;
        const row = rows[0];
        try {
            return {
                phone: row.phone,
                token: this.secrets.decrypt({
                    ciphertext: row.unsubscribe_token_ciphertext,
                    iv: row.unsubscribe_token_iv,
                    tag: row.unsubscribe_token_tag,
                    keyVersion: Number(row.unsubscribe_token_key_version || 1),
                }, `unsubscribe:${tenantKey}:${email.toLowerCase()}:${channel}`),
            };
        }
        catch {
            throw new SchedulerProviderError('Communication preference cannot be decrypted', 'operator_action', 'preference_secret_invalid');
        }
    }
    async unsubscribe(tokenValue) {
        const token = String(tokenValue || '').trim();
        if (token.length < 32 || token.length > 128)
            return false;
        const [result] = await this.pool.query(`UPDATE scheduler_contact_preferences SET unsubscribed_at=UTC_TIMESTAMP(3)
             WHERE unsubscribe_token_hash=? AND unsubscribed_at IS NULL`, [crypto_1.default.createHash('sha256').update(token).digest('hex')]);
        return result.affectedRows === 1;
    }
}
exports.SchedulerContactPreferenceRepository = SchedulerContactPreferenceRepository;
const responseHeader = (value) => (Array.isArray(value) ? value[0] : value);
class SchedulerWorkflowDeliveryDispatcher {
    pool;
    smtp;
    providers;
    preferences;
    publicBaseUrl;
    providerHttp;
    constructor(pool, smtp, providers, preferences, publicBaseUrl, providerHttp = provider_http_1.postSchedulerProviderJson) {
        this.pool = pool;
        this.smtp = smtp;
        this.providers = providers;
        this.preferences = preferences;
        this.publicBaseUrl = publicBaseUrl;
        this.providerHttp = providerHttp;
    }
    providerName(job) {
        if (job.jobType === 'message.email.reminder' || job.jobType === 'message.email')
            return this.smtp.name;
        if (job.jobType === 'notification.in_app')
            return 'oms-in-app';
        return job.jobType === 'webhook.http' ? 'oms-webhook' : `oms-${job.config.channel || 'external'}`;
    }
    async deliver(job) {
        if (job.jobType === 'message.email.reminder' || job.jobType === 'message.email') {
            return this.smtp.send(schedulerReminderMail(job.payload, job.config), job.idempotencyKey);
        }
        if (job.jobType === 'notification.in_app') {
            const rendered = renderWorkflowAction(job.payload, job.config);
            await this.pool.query(`INSERT IGNORE INTO scheduler_in_app_notifications
                    (id, tenant_key, recipient_username, booking_id, idempotency_key, title, body)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`, [crypto_1.default.randomUUID(), job.tenantKey, job.payload.hostEmail, job.bookingId || null,
                job.idempotencyKey, rendered.subject, rendered.body]);
            return { messageId: `in-app:${job.idempotencyKey}` };
        }
        const providerId = String(job.config.providerId || '');
        const provider = await this.providers.forDelivery(job.tenantKey, providerId);
        const expectedChannel = job.jobType === 'webhook.http' ? 'webhook' : job.config.channel;
        if (provider.channel !== expectedChannel) {
            throw new SchedulerProviderError('Delivery provider channel does not match the workflow', 'operator_action', 'provider_channel_mismatch');
        }
        const endpoint = new URL(provider.endpointUrl);
        const destination = job.payload.bookerPhone || '';
        let body = job.jobType === 'webhook.http' ? '' : renderWorkflowAction(job.payload, job.config).body;
        let unsubscribeUrl;
        if (job.jobType === 'message.external') {
            if (!(0, exports.bookingConsentAllows)(job.payload, job.config.channel)) {
                throw new SchedulerProviderError('This booking did not grant communication consent', 'policy_skip', 'booking_consent_missing');
            }
            const preference = await this.preferences.current(job.tenantKey, job.payload.bookerEmail, job.config.channel);
            if (!preference)
                throw new SchedulerProviderError('Recipient consent is missing or withdrawn', 'policy_skip', 'consent_missing');
            unsubscribeUrl = `${this.publicBaseUrl}/api/public/scheduler/v1/unsubscribe/${encodeURIComponent(preference.token)}`;
            if (job.config.channel !== 'voice') {
                body = `${body}\n\nUnsubscribe: ${unsubscribeUrl}`;
            }
        }
        const requestBody = job.jobType === 'webhook.http'
            ? { id: job.idempotencyKey, type: 'scheduler.workflow', booking: job.payload }
            : { id: job.idempotencyKey, channel: job.config.channel, to: destination, body, unsubscribeUrl };
        const raw = JSON.stringify(requestBody);
        const headers = { 'content-type': 'application/json', 'idempotency-key': job.idempotencyKey };
        if (provider.secret)
            headers[provider.authHeaderName] = provider.secret;
        if (job.jobType === 'webhook.http') {
            if (!provider.secret) {
                throw new SchedulerProviderError('Signed webhook provider credential is missing', 'operator_action', 'provider_secret_missing');
            }
            headers['x-oms-scheduler-signature'] = `sha256=${crypto_1.default.createHmac('sha256', provider.secret).update(raw).digest('hex')}`;
        }
        try {
            const response = await this.providerHttp(endpoint, headers, raw, provider.timeoutSeconds, provider.allowPrivateNetwork);
            if (response.status < 200 || response.status >= 300) {
                throw new SchedulerProviderError(`Delivery provider returned HTTP ${response.status}`, response.status === 429 ? 'safe_to_retry'
                    : response.status >= 500 ? 'delivery_uncertain' : 'operator_action', `provider_http_${response.status}`);
            }
            return {
                messageId: responseHeader(response.headers['x-message-id'])
                    || responseHeader(response.headers.location) || undefined,
            };
        }
        catch (error) {
            if (error instanceof SchedulerProviderError)
                throw error;
            if (error instanceof provider_http_1.SchedulerProviderRequestError) {
                throw new SchedulerProviderError(error.message, error.code === 'provider_private_network' ? 'operator_action'
                    : error.requestStarted ? 'delivery_uncertain' : 'safe_to_retry', error.code);
            }
            throw new SchedulerProviderError(String(error?.message || 'Provider request failed'), 'delivery_uncertain', 'provider_network');
        }
    }
    async testProvider(tenantKey, providerId) {
        try {
            const provider = await this.providers.forDelivery(tenantKey, providerId);
            const endpoint = new URL(provider.endpointUrl);
            const raw = JSON.stringify({ type: 'scheduler.provider.test', channel: provider.channel });
            const headers = { 'content-type': 'application/json' };
            if (provider.secret)
                headers[provider.authHeaderName] = provider.secret;
            if (provider.channel === 'webhook') {
                if (!provider.secret)
                    throw new Error('Signed webhook provider credential is missing');
                headers['x-oms-scheduler-signature'] = `sha256=${crypto_1.default.createHmac('sha256', provider.secret).update(raw).digest('hex')}`;
            }
            const response = await this.providerHttp(endpoint, headers, raw, provider.timeoutSeconds, provider.allowPrivateNetwork);
            if (response.status < 200 || response.status >= 300) {
                throw new SchedulerProviderError(`Provider test returned HTTP ${response.status}`, 'operator_action', `provider_http_${response.status}`);
            }
            await this.providers.recordTest(providerId, 'healthy');
        }
        catch (error) {
            await this.providers.recordTest(providerId, 'failed', String(error?.code || 'provider_test_failed')).catch(() => undefined);
            throw error;
        }
    }
    async translateDefinition(tenantKey, providerId, localeValues, definitionValue) {
        const definition = normalizeWorkflowDefinition(definitionValue);
        const locales = Array.from(new Set((Array.isArray(localeValues) ? localeValues : []).map(value => String(value).trim()).filter(Boolean)));
        if (!locales.length || locales.length > 10 || locales.some(locale => !LOCALE_PATTERN.test(locale))) {
            throw new Error('Translation requires between 1 and 10 valid locale codes');
        }
        const provider = await this.providers.forDelivery(tenantKey, providerId);
        if (provider.channel !== 'translation')
            throw new Error('Selected provider is not a translation adapter');
        const endpoint = new URL(provider.endpointUrl);
        const raw = JSON.stringify({
            type: 'scheduler.workflow.translate',
            sourceLocale: 'en',
            locales,
            steps: definition.steps.map((step, index) => ({
                index,
                subject: step.config.subject || step.config.title || '',
                body: step.config.body || '',
            })),
        });
        const headers = { 'content-type': 'application/json' };
        if (provider.secret)
            headers[provider.authHeaderName] = provider.secret;
        const response = await this.providerHttp(endpoint, headers, raw, provider.timeoutSeconds, provider.allowPrivateNetwork);
        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Translation provider returned HTTP ${response.status}`);
        }
        let parsed;
        try {
            parsed = JSON.parse(response.body);
        }
        catch {
            throw new Error('Translation provider returned invalid JSON');
        }
        if (!Array.isArray(parsed?.steps))
            throw new Error('Translation provider response must contain steps');
        const translatedSteps = definition.steps.map(step => ({ ...step, config: { ...step.config } }));
        for (const item of parsed.steps) {
            const index = Number(item?.index);
            if (!Number.isInteger(index) || index < 0 || index >= translatedSteps.length) {
                throw new Error('Translation provider returned an invalid step index');
            }
            const translations = normalizeTranslations(item.translations);
            if (!translations || Object.keys(translations).some(locale => !locales.includes(locale))) {
                throw new Error('Translation provider returned an unexpected locale');
            }
            translatedSteps[index].config.translations = {
                ...(translatedSteps[index].config.translations || {}),
                ...translations,
            };
        }
        for (const [index, step] of translatedSteps.entries()) {
            const sourceSubject = step.config.subject || step.config.title || '';
            const sourceBody = step.config.body || '';
            if (!sourceSubject && !sourceBody)
                continue;
            for (const locale of locales) {
                const translation = step.config.translations?.[locale];
                if (!translation
                    || (sourceSubject && !translation.subject)
                    || (sourceBody && !translation.body)) {
                    throw new Error(`Translation provider omitted ${locale} text for step ${index + 1}`);
                }
            }
        }
        return normalizeWorkflowDefinition({ ...definition, steps: translatedSteps });
    }
}
exports.SchedulerWorkflowDeliveryDispatcher = SchedulerWorkflowDeliveryDispatcher;
class SchedulerJobRepository {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async claimBatch(workerId, limit, _leaseUntil) {
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query(`UPDATE scheduler_jobs j
                 JOIN scheduler_delivery_attempts a ON a.job_id=j.id AND a.attempt_no=j.attempts AND a.outcome='sending'
                 SET j.dead_lettered_at=UTC_TIMESTAMP(3), j.last_error_code='delivery_uncertain',
                     j.lease_owner=NULL, j.lease_expires_at=NULL,
                     a.outcome='dead_lettered', a.error_code='delivery_uncertain'
                 WHERE j.completed_at IS NULL AND j.cancelled_at IS NULL AND j.dead_lettered_at IS NULL
                   AND j.lease_expires_at<=UTC_TIMESTAMP(3)`);
            await connection.query(`INSERT IGNORE INTO scheduler_delivery_alerts
                    (id, tenant_key, job_id, severity, alert_type, error_code)
                 SELECT UUID(), tenant_key, id, 'critical', 'delivery_uncertain', 'delivery_uncertain'
                 FROM scheduler_jobs WHERE dead_lettered_at IS NOT NULL AND last_error_code='delivery_uncertain'`);
            const [rows] = await connection.query(`SELECT j.id, j.tenant_key, j.booking_id, j.job_type, j.contact_email, j.consent_channel,
                        j.idempotency_key, j.payload, j.attempts, s.condition_config, s.config
                 FROM scheduler_jobs j
                 JOIN scheduler_workflow_steps s ON s.id=j.workflow_step_id
                 WHERE j.completed_at IS NULL AND j.cancelled_at IS NULL AND j.dead_lettered_at IS NULL
                   AND j.available_at<=UTC_TIMESTAMP(3)
                   AND (j.lease_expires_at IS NULL OR j.lease_expires_at<=UTC_TIMESTAMP(3))
                 ORDER BY j.available_at, j.created_at
                 LIMIT ? FOR UPDATE SKIP LOCKED`, [Math.max(1, Math.min(100, Math.trunc(limit)))]);
            for (const row of rows) {
                await connection.query(`UPDATE scheduler_jobs SET lease_owner=?,
                        lease_expires_at=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 120 SECOND), attempts=attempts+1 WHERE id=?`, [workerId, row.id]);
                row.attempts = Number(row.attempts) + 1;
            }
            await connection.commit();
            return rows.map((row) => ({
                id: row.id,
                tenantKey: row.tenant_key,
                bookingId: row.booking_id || undefined,
                jobType: row.job_type,
                idempotencyKey: row.idempotency_key,
                attempts: Number(row.attempts),
                payload: safeJson(row.payload),
                config: safeJson(row.config || '{}'),
                condition: row.condition_config ? safeJson(row.condition_config) : undefined,
                contactEmail: row.contact_email || undefined,
                consentChannel: row.consent_channel || undefined,
            }));
        }
        catch (error) {
            await connection.rollback();
            throw error;
        }
        finally {
            connection.release();
        }
    }
    async beginAttempt(jobId, workerId, provider) {
        const [result] = await this.pool.query(`INSERT INTO scheduler_delivery_attempts
                (id, tenant_key, job_id, attempt_no, provider, outcome)
             SELECT ?, tenant_key, id, attempts, ?, 'sending' FROM scheduler_jobs
             WHERE id=? AND lease_owner=? AND completed_at IS NULL AND cancelled_at IS NULL AND dead_lettered_at IS NULL`, [crypto_1.default.randomUUID(), provider.slice(0, 64), jobId, workerId]);
        if (result.affectedRows !== 1)
            throw new Error('Scheduler job lease was lost before delivery started');
    }
    async skip(jobId, workerId, reason) {
        const [result] = await this.pool.query(`UPDATE scheduler_jobs SET completed_at=UTC_TIMESTAMP(3), payload='{}', last_error_code=?,
                lease_owner=NULL, lease_expires_at=NULL
             WHERE id=? AND lease_owner=? AND completed_at IS NULL AND cancelled_at IS NULL AND dead_lettered_at IS NULL`, [reason.slice(0, 80), jobId, workerId]);
        if (result.affectedRows !== 1)
            throw new Error('Scheduler job lease was lost before condition evaluation');
    }
    async complete(jobId, workerId, provider, providerMessageId) {
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [result] = await connection.query(`UPDATE scheduler_jobs SET completed_at=UTC_TIMESTAMP(3), payload='{}', last_error_code=NULL,
                    lease_owner=NULL, lease_expires_at=NULL
                 WHERE id=? AND lease_owner=? AND cancelled_at IS NULL AND dead_lettered_at IS NULL`, [jobId, workerId]);
            if (result.affectedRows !== 1)
                throw new Error('Scheduler job lease was lost before completion');
            const [attemptResult] = await connection.query(`UPDATE scheduler_delivery_attempts a
                 JOIN scheduler_jobs j ON j.id=a.job_id AND j.attempts=a.attempt_no
                 SET a.outcome='sent', a.provider_message_id=?, a.error_code=NULL
                 WHERE a.job_id=? AND a.provider=? AND a.outcome='sending'`, [providerMessageId?.slice(0, 255) || null, jobId, provider.slice(0, 64)]);
            if (attemptResult.affectedRows !== 1)
                throw new Error('Scheduler delivery attempt was lost before completion');
            await connection.query(`UPDATE scheduler_delivery_alerts SET resolved_at=UTC_TIMESTAMP(3), resolved_by='system'
                 WHERE job_id=? AND resolved_at IS NULL`, [jobId]);
            await connection.commit();
        }
        catch (error) {
            await connection.rollback();
            throw error;
        }
        finally {
            connection.release();
        }
    }
    async fail(jobId, workerId, provider, attempt, errorCode) {
        const connection = await this.pool.getConnection();
        const deadLettered = attempt >= MAX_JOB_ATTEMPTS;
        try {
            await connection.beginTransaction();
            const delaySeconds = Math.min(3600, 2 ** attempt * 15);
            const [result] = await connection.query(deadLettered
                ? `UPDATE scheduler_jobs SET dead_lettered_at=UTC_TIMESTAMP(3), last_error_code=?,
                         lease_owner=NULL, lease_expires_at=NULL
                       WHERE id=? AND lease_owner=? AND cancelled_at IS NULL AND dead_lettered_at IS NULL`
                : `UPDATE scheduler_jobs SET available_at=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND), last_error_code=?,
                         lease_owner=NULL, lease_expires_at=NULL
                       WHERE id=? AND lease_owner=? AND cancelled_at IS NULL AND dead_lettered_at IS NULL`, deadLettered
                ? [errorCode.slice(0, 80), jobId, workerId]
                : [delaySeconds, errorCode.slice(0, 80), jobId, workerId]);
            if (result.affectedRows !== 1)
                throw new Error('Scheduler job lease was lost before failure recording');
            const [attemptResult] = await connection.query(`UPDATE scheduler_delivery_attempts SET outcome=?, error_code=?
                 WHERE job_id=? AND attempt_no=? AND provider=? AND outcome='sending'`, [deadLettered ? 'dead_lettered' : 'retrying', errorCode.slice(0, 80), jobId, attempt, provider.slice(0, 64)]);
            if (attemptResult.affectedRows !== 1)
                throw new Error('Scheduler delivery attempt was lost before failure recording');
            await connection.query(`INSERT INTO scheduler_delivery_alerts
                    (id, tenant_key, job_id, severity, alert_type, error_code)
                 SELECT ?, tenant_key, id, ?, ?, ? FROM scheduler_jobs WHERE id=?
                 ON DUPLICATE KEY UPDATE severity=VALUES(severity), error_code=VALUES(error_code), resolved_at=NULL, resolved_by=NULL`, [crypto_1.default.randomUUID(), deadLettered ? 'critical' : 'warning', deadLettered ? 'dead_lettered' : 'retrying',
                errorCode.slice(0, 80), jobId]);
            await connection.commit();
        }
        catch (error) {
            await connection.rollback();
            throw error;
        }
        finally {
            connection.release();
        }
    }
    async uncertain(jobId, workerId, provider, attempt, errorCode) {
        await this.recordTerminalFailure(jobId, workerId, provider, attempt, errorCode, 'delivery_uncertain');
    }
    async deadLetter(jobId, workerId, provider, attempt, errorCode) {
        await this.recordTerminalFailure(jobId, workerId, provider, attempt, errorCode, 'dead_lettered');
    }
    async recordTerminalFailure(jobId, workerId, provider, attempt, errorCode, alertType) {
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [result] = await connection.query(`UPDATE scheduler_jobs SET dead_lettered_at=UTC_TIMESTAMP(3), last_error_code=?,
                    lease_owner=NULL, lease_expires_at=NULL
                 WHERE id=? AND lease_owner=? AND completed_at IS NULL AND cancelled_at IS NULL AND dead_lettered_at IS NULL`, [errorCode.slice(0, 80), jobId, workerId]);
            if (result.affectedRows !== 1)
                throw new Error('Scheduler job lease was lost before terminal failure recording');
            const [attemptResult] = await connection.query(`UPDATE scheduler_delivery_attempts SET outcome='dead_lettered', error_code=?
                 WHERE job_id=? AND attempt_no=? AND provider=? AND outcome='sending'`, [errorCode.slice(0, 80), jobId, attempt, provider.slice(0, 64)]);
            if (attemptResult.affectedRows !== 1)
                throw new Error('Scheduler delivery attempt was lost before terminal failure recording');
            await connection.query(`INSERT INTO scheduler_delivery_alerts
                    (id, tenant_key, job_id, severity, alert_type, error_code)
                 SELECT ?, tenant_key, id, 'critical', ?, ? FROM scheduler_jobs WHERE id=?
                 ON DUPLICATE KEY UPDATE severity='critical', error_code=VALUES(error_code), resolved_at=NULL, resolved_by=NULL`, [crypto_1.default.randomUUID(), alertType, errorCode.slice(0, 80), jobId]);
            await connection.commit();
        }
        catch (error) {
            await connection.rollback();
            throw error;
        }
        finally {
            connection.release();
        }
    }
    async cancel(jobId, workerId, provider, errorCode) {
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [result] = await connection.query(`UPDATE scheduler_jobs SET cancelled_at=UTC_TIMESTAMP(3), payload='{}', last_error_code=?,
                    lease_owner=NULL, lease_expires_at=NULL
                 WHERE id=? AND lease_owner=? AND completed_at IS NULL AND dead_lettered_at IS NULL`, [errorCode.slice(0, 80), jobId, workerId]);
            if (result.affectedRows !== 1)
                throw new Error('Scheduler job lease was lost before cancellation');
            await connection.query(`UPDATE scheduler_delivery_attempts SET outcome='dead_lettered', error_code=?
                 WHERE job_id=? AND provider=? AND outcome='sending'`, [errorCode.slice(0, 80), jobId, provider.slice(0, 64)]);
            await connection.query(`UPDATE scheduler_delivery_alerts SET resolved_at=UTC_TIMESTAMP(3), resolved_by='system'
                 WHERE job_id=? AND resolved_at IS NULL`, [jobId]);
            await connection.commit();
        }
        catch (error) {
            await connection.rollback();
            throw error;
        }
        finally {
            connection.release();
        }
    }
}
exports.SchedulerJobRepository = SchedulerJobRepository;
//# sourceMappingURL=workflows.js.map