"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminSettingsDefaults = void 0;
exports.isAdminSettingsNamespace = isAdminSettingsNamespace;
exports.ensureAdminSettingsSchema = ensureAdminSettingsSchema;
exports.normalizeAdminSettings = normalizeAdminSettings;
exports.getAdminSettings = getAdminSettings;
exports.saveAdminSettings = saveAdminSettings;
const db_1 = require("./db");
exports.adminSettingsDefaults = {
    organization: {
        organizationName: '',
        supportEmail: '',
        supportUrl: '',
        defaultLocale: 'en-US',
        defaultTimeZone: 'UTC',
    },
    publicUrls: {
        webmailUrl: '',
        autodiscoverHost: '',
        mailHost: '',
        caldavUrl: '',
        carddavUrl: '',
    },
    security: {
        sessionLifetimeHours: 8,
        requireSecureCookies: true,
        allowUserPasswordChange: false,
        showLastLoginNotice: true,
    },
    mailPolicy: {
        maxAttachmentMb: 25,
        defaultQuotaMb: 1024,
        spamPolicyMode: 'standard',
        allowExternalForwarding: true,
    },
    system: {
        updateChannel: 'stable',
        maintenanceWindow: 'Sunday 02:00',
        telemetryMode: 'off',
        adminNotice: '',
    },
    webhooks: {
        endpoints: [],
        events: [],
    },
};
const namespaces = Object.keys(exports.adminSettingsDefaults);
let schemaPromise = null;
function isAdminSettingsNamespace(value) {
    return namespaces.includes(value);
}
function ensureAdminSettingsSchema() {
    if (!schemaPromise) {
        schemaPromise = db_1.pool.query(`
            CREATE TABLE IF NOT EXISTS webmail_admin_settings (
                namespace VARCHAR(32) NOT NULL PRIMARY KEY,
                settings_json JSON NOT NULL,
                updated_by VARCHAR(255) NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `).then(() => undefined);
    }
    return schemaPromise;
}
const isObject = (value) => (typeof value === 'object' && value !== null && !Array.isArray(value));
const textValue = (value, fallback, maxLength) => {
    if (typeof value !== 'string')
        return fallback;
    const trimmed = value.trim();
    return (trimmed || fallback).slice(0, maxLength);
};
const optionalText = (value, maxLength) => (typeof value === 'string' ? value.trim().slice(0, maxLength) : '');
const booleanValue = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
const stringOption = (value, allowed, fallback) => (typeof value === 'string' && allowed.includes(value) ? value : fallback);
const numberOption = (value, allowed, fallback) => (typeof value === 'number' && allowed.includes(value) ? value : fallback);
const boundedNumber = (value, fallback, min, max) => {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
};
function normalizeAdminSettings(namespace, value) {
    const source = isObject(value) ? value : {};
    if (namespace === 'organization') {
        return {
            organizationName: optionalText(source.organizationName, 120),
            supportEmail: optionalText(source.supportEmail, 255),
            supportUrl: optionalText(source.supportUrl, 500),
            defaultLocale: textValue(source.defaultLocale, exports.adminSettingsDefaults.organization.defaultLocale, 35),
            defaultTimeZone: textValue(source.defaultTimeZone, exports.adminSettingsDefaults.organization.defaultTimeZone, 80),
        };
    }
    if (namespace === 'publicUrls') {
        return {
            webmailUrl: optionalText(source.webmailUrl, 500),
            autodiscoverHost: optionalText(source.autodiscoverHost, 255),
            mailHost: optionalText(source.mailHost, 255),
            caldavUrl: optionalText(source.caldavUrl, 500),
            carddavUrl: optionalText(source.carddavUrl, 500),
        };
    }
    if (namespace === 'security') {
        return {
            sessionLifetimeHours: numberOption(source.sessionLifetimeHours, [8, 12, 24, 72, 168], exports.adminSettingsDefaults.security.sessionLifetimeHours),
            requireSecureCookies: booleanValue(source.requireSecureCookies, exports.adminSettingsDefaults.security.requireSecureCookies),
            allowUserPasswordChange: booleanValue(source.allowUserPasswordChange, exports.adminSettingsDefaults.security.allowUserPasswordChange),
            showLastLoginNotice: booleanValue(source.showLastLoginNotice, exports.adminSettingsDefaults.security.showLastLoginNotice),
        };
    }
    if (namespace === 'mailPolicy') {
        return {
            maxAttachmentMb: boundedNumber(source.maxAttachmentMb, exports.adminSettingsDefaults.mailPolicy.maxAttachmentMb, 1, 100),
            defaultQuotaMb: boundedNumber(source.defaultQuotaMb, exports.adminSettingsDefaults.mailPolicy.defaultQuotaMb, 128, 1048576),
            spamPolicyMode: stringOption(source.spamPolicyMode, ['standard', 'strict', 'permissive'], exports.adminSettingsDefaults.mailPolicy.spamPolicyMode),
            allowExternalForwarding: booleanValue(source.allowExternalForwarding, exports.adminSettingsDefaults.mailPolicy.allowExternalForwarding),
        };
    }
    return {
        updateChannel: stringOption(source.updateChannel, ['stable', 'preview'], exports.adminSettingsDefaults.system.updateChannel),
        maintenanceWindow: textValue(source.maintenanceWindow, exports.adminSettingsDefaults.system.maintenanceWindow, 120),
        telemetryMode: stringOption(source.telemetryMode, ['off', 'basic'], exports.adminSettingsDefaults.system.telemetryMode),
        adminNotice: optionalText(source.adminNotice, 500),
    };
}
async function getAdminSettings(namespace) {
    await ensureAdminSettingsSchema();
    const [rows] = await db_1.pool.query('SELECT settings_json FROM webmail_admin_settings WHERE namespace = ? LIMIT 1', [namespace]);
    if (rows.length === 0)
        return normalizeAdminSettings(namespace, exports.adminSettingsDefaults[namespace]);
    const stored = typeof rows[0].settings_json === 'string'
        ? JSON.parse(rows[0].settings_json)
        : rows[0].settings_json;
    return normalizeAdminSettings(namespace, stored);
}
async function saveAdminSettings(namespace, settings, updatedBy) {
    await ensureAdminSettingsSchema();
    const normalized = normalizeAdminSettings(namespace, settings);
    await db_1.pool.query(`INSERT INTO webmail_admin_settings (namespace, settings_json, updated_by)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json), updated_by = VALUES(updated_by), updated_at = NOW()`, [namespace, JSON.stringify(normalized), updatedBy]);
    return normalized;
}
//# sourceMappingURL=admin-settings.js.map