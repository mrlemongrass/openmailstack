import { pool } from './db';

export type AdminSettingsNamespace = 'organization' | 'publicUrls' | 'security' | 'mailPolicy' | 'system' | 'webhooks';

export interface OrganizationAdminSettings {
    organizationName: string;
    supportEmail: string;
    supportUrl: string;
    defaultLocale: string;
    defaultTimeZone: string;
}

export interface PublicUrlsAdminSettings {
    webmailUrl: string;
    autodiscoverHost: string;
    mailHost: string;
    caldavUrl: string;
    carddavUrl: string;
}

export interface SecurityAdminSettings {
    sessionLifetimeHours: 8 | 12 | 24 | 72 | 168;
    requireSecureCookies: boolean;
    allowUserPasswordChange: boolean;
    showLastLoginNotice: boolean;
}

export interface MailPolicyAdminSettings {
    maxAttachmentMb: number;
    defaultQuotaMb: number;
    spamPolicyMode: 'standard' | 'strict' | 'permissive';
    allowExternalForwarding: boolean;
}

export interface SystemAdminSettings {
    updateChannel: 'stable' | 'preview';
    maintenanceWindow: string;
    telemetryMode: 'off' | 'basic';
    adminNotice: string;
}

export interface WebhooksAdminSettings {
    endpoints: string[];
    events: string[];
}

export type AdminSettings =
    | OrganizationAdminSettings
    | PublicUrlsAdminSettings
    | SecurityAdminSettings
    | MailPolicyAdminSettings
    | SystemAdminSettings
    | WebhooksAdminSettings;

export const adminSettingsDefaults = {
    organization: {
        organizationName: '',
        supportEmail: '',
        supportUrl: '',
        defaultLocale: 'en-US',
        defaultTimeZone: 'UTC',
    } satisfies OrganizationAdminSettings,
    publicUrls: {
        webmailUrl: '',
        autodiscoverHost: '',
        mailHost: '',
        caldavUrl: '',
        carddavUrl: '',
    } satisfies PublicUrlsAdminSettings,
    security: {
        sessionLifetimeHours: 8,
        requireSecureCookies: true,
        allowUserPasswordChange: false,
        showLastLoginNotice: true,
    } satisfies SecurityAdminSettings,
    mailPolicy: {
        maxAttachmentMb: 25,
        defaultQuotaMb: 1024,
        spamPolicyMode: 'standard',
        allowExternalForwarding: true,
    } satisfies MailPolicyAdminSettings,
    system: {
        updateChannel: 'stable',
        maintenanceWindow: 'Sunday 02:00',
        telemetryMode: 'off',
        adminNotice: '',
    } satisfies SystemAdminSettings,
    webhooks: {
        endpoints: [],
        events: [],
    } satisfies WebhooksAdminSettings,
};

const namespaces = Object.keys(adminSettingsDefaults) as AdminSettingsNamespace[];
let schemaPromise: Promise<void> | null = null;

export function isAdminSettingsNamespace(value: string): value is AdminSettingsNamespace {
    return namespaces.includes(value as AdminSettingsNamespace);
}

export function ensureAdminSettingsSchema(): Promise<void> {
    if (!schemaPromise) {
        schemaPromise = pool.query(`
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

const isObject = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

const textValue = (value: unknown, fallback: string, maxLength: number): string => {
    if (typeof value !== 'string') return fallback;
    const trimmed = value.trim();
    return (trimmed || fallback).slice(0, maxLength);
};

const optionalText = (value: unknown, maxLength: number): string => (
    typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
);

const booleanValue = (value: unknown, fallback: boolean): boolean => (
    typeof value === 'boolean' ? value : fallback
);

const stringOption = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (
    typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback
);

const numberOption = <T extends number>(value: unknown, allowed: readonly T[], fallback: T): T => (
    typeof value === 'number' && allowed.includes(value as T) ? value as T : fallback
);

const boundedNumber = (value: unknown, fallback: number, min: number, max: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
};

export function normalizeAdminSettings(namespace: AdminSettingsNamespace, value: unknown): AdminSettings {
    const source = isObject(value) ? value : {};

    if (namespace === 'organization') {
        return {
            organizationName: optionalText(source.organizationName, 120),
            supportEmail: optionalText(source.supportEmail, 255),
            supportUrl: optionalText(source.supportUrl, 500),
            defaultLocale: textValue(source.defaultLocale, adminSettingsDefaults.organization.defaultLocale, 35),
            defaultTimeZone: textValue(source.defaultTimeZone, adminSettingsDefaults.organization.defaultTimeZone, 80),
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
            sessionLifetimeHours: numberOption(source.sessionLifetimeHours, [8, 12, 24, 72, 168], adminSettingsDefaults.security.sessionLifetimeHours),
            requireSecureCookies: booleanValue(source.requireSecureCookies, adminSettingsDefaults.security.requireSecureCookies),
            allowUserPasswordChange: booleanValue(source.allowUserPasswordChange, adminSettingsDefaults.security.allowUserPasswordChange),
            showLastLoginNotice: booleanValue(source.showLastLoginNotice, adminSettingsDefaults.security.showLastLoginNotice),
        };
    }

    if (namespace === 'mailPolicy') {
        return {
            maxAttachmentMb: boundedNumber(source.maxAttachmentMb, adminSettingsDefaults.mailPolicy.maxAttachmentMb, 1, 100),
            defaultQuotaMb: boundedNumber(source.defaultQuotaMb, adminSettingsDefaults.mailPolicy.defaultQuotaMb, 128, 1048576),
            spamPolicyMode: stringOption(source.spamPolicyMode, ['standard', 'strict', 'permissive'], adminSettingsDefaults.mailPolicy.spamPolicyMode),
            allowExternalForwarding: booleanValue(source.allowExternalForwarding, adminSettingsDefaults.mailPolicy.allowExternalForwarding),
        };
    }

    return {
        updateChannel: stringOption(source.updateChannel, ['stable', 'preview'], adminSettingsDefaults.system.updateChannel),
        maintenanceWindow: textValue(source.maintenanceWindow, adminSettingsDefaults.system.maintenanceWindow, 120),
        telemetryMode: stringOption(source.telemetryMode, ['off', 'basic'], adminSettingsDefaults.system.telemetryMode),
        adminNotice: optionalText(source.adminNotice, 500),
    };
}

export async function getAdminSettings(namespace: AdminSettingsNamespace): Promise<AdminSettings> {
    await ensureAdminSettingsSchema();
    const [rows]: any = await pool.query(
        'SELECT settings_json FROM webmail_admin_settings WHERE namespace = ? LIMIT 1',
        [namespace]
    );

    if (rows.length === 0) return normalizeAdminSettings(namespace, adminSettingsDefaults[namespace]);

    const stored = typeof rows[0].settings_json === 'string'
        ? JSON.parse(rows[0].settings_json)
        : rows[0].settings_json;
    return normalizeAdminSettings(namespace, stored);
}

export async function saveAdminSettings(namespace: AdminSettingsNamespace, settings: unknown, updatedBy: string): Promise<AdminSettings> {
    await ensureAdminSettingsSchema();
    const normalized = normalizeAdminSettings(namespace, settings);

    await pool.query(
        `INSERT INTO webmail_admin_settings (namespace, settings_json, updated_by)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json), updated_by = VALUES(updated_by), updated_at = NOW()`,
        [namespace, JSON.stringify(normalized), updatedBy]
    );

    return normalized;
}
