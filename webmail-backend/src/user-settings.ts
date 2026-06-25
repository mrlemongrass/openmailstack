import { pool } from './db';

export type SettingsNamespace = 'mail' | 'calendar' | 'contacts' | 'appearance';

export interface MailSettings {
    signatures: {
        id: string;
        name: string;
        content: string;
        isDefault?: boolean;
        defaultForNew?: boolean;
        defaultForReply?: boolean;
    }[];
    identity: {
        defaultFrom: string;
        replyTo: string;
        alwaysBccSelf: boolean;
    };
    compose: {
        defaultMode: 'rich' | 'plain';
        defaultFont: 'system' | 'serif' | 'mono';
        attachmentReminder: boolean;
        undoSendSeconds: 0 | 5 | 10 | 20 | 30;
    };
    reading: {
        threaded: boolean;
        density: 'comfortable' | 'cozy' | 'compact';
        previewPane: 'right' | 'bottom' | 'off';
        snippets: boolean;
        externalImages: 'ask' | 'trusted' | 'always';
        markReadDelaySeconds: 0 | 1 | 3 | 5;
    };
}

export interface CalendarSettings {
    defaultCalendarId: number | null;
    defaultView: 'day' | 'week' | 'month' | 'year';
    defaultEventDurationMinutes: number;
    defaultReminderMinutes: 0 | 5 | 10 | 15 | 30 | 60 | 1440;
    weekStartsOn: 0 | 1 | 6;
    timeZone: string;
}

export interface ContactsSettings {
    nameFormat: 'firstLast' | 'lastFirst';
    sortBy: 'name' | 'email';
    listDensity: 'comfortable' | 'cozy' | 'compact';
    autoCreateFromSent: boolean;
}

export interface AppearanceSettings {
    themeMode: 'system' | 'dark' | 'light' | 'contrast';
    density: 'comfortable' | 'cozy' | 'compact';
    fontScale: 'small' | 'normal' | 'large';
    radius: 'sharp' | 'soft' | 'round';
    accentColor: 'blue' | 'cyan' | 'green' | 'amber' | 'rose' | 'violet';
    reduceMotion: boolean;
}

export type UserSettings = MailSettings | CalendarSettings | ContactsSettings | AppearanceSettings;

export const settingsDefaults = {
    mail: {
        signatures: [],
        identity: {
            defaultFrom: '',
            replyTo: '',
            alwaysBccSelf: false,
        },
        compose: {
            defaultMode: 'rich',
            defaultFont: 'system',
            attachmentReminder: true,
            undoSendSeconds: 10,
        },
        reading: {
            threaded: false,
            density: 'cozy',
            previewPane: 'right',
            snippets: true,
            externalImages: 'ask',
            markReadDelaySeconds: 1,
        },
    } satisfies MailSettings,
    calendar: {
        defaultCalendarId: null,
        defaultView: 'month',
        defaultEventDurationMinutes: 60,
        defaultReminderMinutes: 10,
        weekStartsOn: 0,
        timeZone: 'UTC',
    } satisfies CalendarSettings,
    contacts: {
        nameFormat: 'firstLast',
        sortBy: 'name',
        listDensity: 'cozy',
        autoCreateFromSent: true,
    } satisfies ContactsSettings,
    appearance: {
        themeMode: 'dark',
        density: 'cozy',
        fontScale: 'normal',
        radius: 'soft',
        accentColor: 'blue',
        reduceMotion: false,
    } satisfies AppearanceSettings,
};

const namespaces = Object.keys(settingsDefaults) as SettingsNamespace[];
let schemaPromise: Promise<void> | null = null;

export function isSettingsNamespace(value: string): value is SettingsNamespace {
    return namespaces.includes(value as SettingsNamespace);
}

export async function ensureUserSettingsSchema(): Promise<void> {
    if (!schemaPromise) {
        schemaPromise = pool.query(`
            CREATE TABLE IF NOT EXISTS webmail_user_settings (
                username VARCHAR(255) NOT NULL,
                namespace VARCHAR(32) NOT NULL,
                settings_json JSON NOT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (username, namespace),
                KEY idx_namespace (namespace)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `).then(() => undefined);
    }

    return schemaPromise;
}

const isObject = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

const stringOption = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => (
    typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback
);

const booleanValue = (value: unknown, fallback: boolean): boolean => (
    typeof value === 'boolean' ? value : fallback
);

const boundedNumber = (value: unknown, fallback: number, min: number, max: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
};

const weekStartValue = (value: unknown, fallback: 0 | 1 | 6): 0 | 1 | 6 => {
    if (value === 0 || value === 1 || value === 6) return value;
    if (value === '0' || value === '1' || value === '6') return Number(value) as 0 | 1 | 6;
    return fallback;
};

const numberOption = <T extends number>(value: unknown, allowed: readonly T[], fallback: T): T => (
    typeof value === 'number' && allowed.includes(value as T) ? value as T : fallback
);

const optionalPositiveInteger = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return null;
    return Math.round(value);
};

const textValue = (value: unknown, maxLength: number): string => (
    typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
);

function normalizeSignatures(value: unknown): MailSettings['signatures'] {
    if (!Array.isArray(value)) return [];

    const seen = new Set<string>();
    const signatures = value.slice(0, 20).flatMap(item => {
        if (!isObject(item)) return [];
        const id = typeof item.id === 'string' && item.id.trim()
            ? item.id.trim().slice(0, 80)
            : Math.random().toString(36).slice(2, 11);
        if (seen.has(id)) return [];
        seen.add(id);

        return [{
            id,
            name: typeof item.name === 'string' && item.name.trim() ? item.name.trim().slice(0, 120) : 'Signature',
            content: typeof item.content === 'string' ? item.content.slice(0, 20000) : '',
            isDefault: !!item.isDefault,
            defaultForNew: !!item.defaultForNew,
            defaultForReply: !!item.defaultForReply,
        }];
    });

    const defaultIndex = signatures.findIndex(signature => signature.isDefault);
    const defaultNewIndex = signatures.findIndex(signature => signature.defaultForNew);
    const defaultReplyIndex = signatures.findIndex(signature => signature.defaultForReply);
    return signatures.map((signature, index) => ({
        ...signature,
        isDefault: defaultIndex === -1 ? index === 0 : index === defaultIndex,
        defaultForNew: defaultNewIndex === -1 ? index === defaultIndex || (defaultIndex === -1 && index === 0) : index === defaultNewIndex,
        defaultForReply: defaultReplyIndex === -1 ? index === defaultIndex || (defaultIndex === -1 && index === 0) : index === defaultReplyIndex,
    }));
}

export function normalizeSettings(namespace: SettingsNamespace, value: unknown): UserSettings {
    const source = isObject(value) ? value : {};

    if (namespace === 'mail') {
        const reading = isObject(source.reading) ? source.reading : {};
        const identity = isObject(source.identity) ? source.identity : {};
        const compose = isObject(source.compose) ? source.compose : {};
        return {
            signatures: normalizeSignatures(source.signatures),
            identity: {
                defaultFrom: textValue(identity.defaultFrom, 255),
                replyTo: textValue(identity.replyTo, 255),
                alwaysBccSelf: booleanValue(identity.alwaysBccSelf, settingsDefaults.mail.identity.alwaysBccSelf),
            },
            compose: {
                defaultMode: stringOption(compose.defaultMode, ['rich', 'plain'], settingsDefaults.mail.compose.defaultMode),
                defaultFont: stringOption(compose.defaultFont, ['system', 'serif', 'mono'], settingsDefaults.mail.compose.defaultFont),
                attachmentReminder: booleanValue(compose.attachmentReminder, settingsDefaults.mail.compose.attachmentReminder),
                undoSendSeconds: numberOption(compose.undoSendSeconds, [0, 5, 10, 20, 30], settingsDefaults.mail.compose.undoSendSeconds),
            },
            reading: {
                threaded: booleanValue(reading.threaded, settingsDefaults.mail.reading.threaded),
                density: stringOption(reading.density, ['comfortable', 'cozy', 'compact'], settingsDefaults.mail.reading.density),
                previewPane: stringOption(reading.previewPane, ['right', 'bottom', 'off'], settingsDefaults.mail.reading.previewPane),
                snippets: booleanValue(reading.snippets, settingsDefaults.mail.reading.snippets),
                externalImages: stringOption(reading.externalImages, ['ask', 'trusted', 'always'], settingsDefaults.mail.reading.externalImages),
                markReadDelaySeconds: numberOption(reading.markReadDelaySeconds, [0, 1, 3, 5], settingsDefaults.mail.reading.markReadDelaySeconds),
            },
        };
    }

    if (namespace === 'calendar') {
        return {
            defaultCalendarId: optionalPositiveInteger(source.defaultCalendarId),
            defaultView: stringOption(source.defaultView, ['day', 'week', 'month', 'year'], settingsDefaults.calendar.defaultView),
            defaultEventDurationMinutes: boundedNumber(source.defaultEventDurationMinutes, settingsDefaults.calendar.defaultEventDurationMinutes, 5, 480),
            defaultReminderMinutes: numberOption(source.defaultReminderMinutes, [0, 5, 10, 15, 30, 60, 1440], settingsDefaults.calendar.defaultReminderMinutes),
            weekStartsOn: weekStartValue(source.weekStartsOn, settingsDefaults.calendar.weekStartsOn),
            timeZone: typeof source.timeZone === 'string' && source.timeZone.trim() ? source.timeZone.trim().slice(0, 80) : settingsDefaults.calendar.timeZone,
        };
    }

    if (namespace === 'contacts') {
        return {
            nameFormat: stringOption(source.nameFormat, ['firstLast', 'lastFirst'], settingsDefaults.contacts.nameFormat),
            sortBy: stringOption(source.sortBy, ['name', 'email'], settingsDefaults.contacts.sortBy),
            listDensity: stringOption(source.listDensity, ['comfortable', 'cozy', 'compact'], settingsDefaults.contacts.listDensity),
            autoCreateFromSent: booleanValue(source.autoCreateFromSent, settingsDefaults.contacts.autoCreateFromSent),
        };
    }

    return {
        themeMode: stringOption(source.themeMode, ['system', 'dark', 'light', 'contrast'], settingsDefaults.appearance.themeMode),
        density: stringOption(source.density, ['comfortable', 'cozy', 'compact'], settingsDefaults.appearance.density),
        fontScale: stringOption(source.fontScale, ['small', 'normal', 'large'], settingsDefaults.appearance.fontScale),
        radius: stringOption(source.radius, ['sharp', 'soft', 'round'], settingsDefaults.appearance.radius),
        accentColor: stringOption(source.accentColor, ['blue', 'cyan', 'green', 'amber', 'rose', 'violet'], settingsDefaults.appearance.accentColor),
        reduceMotion: booleanValue(source.reduceMotion, settingsDefaults.appearance.reduceMotion),
    };
}

export async function getUserSettings(username: string, namespace: SettingsNamespace): Promise<UserSettings> {
    await ensureUserSettingsSchema();
    const [rows]: any = await pool.query(
        'SELECT settings_json FROM webmail_user_settings WHERE username = ? AND namespace = ?',
        [username, namespace]
    );

    if (rows.length === 0) return normalizeSettings(namespace, settingsDefaults[namespace]);

    const stored = typeof rows[0].settings_json === 'string'
        ? JSON.parse(rows[0].settings_json)
        : rows[0].settings_json;
    return normalizeSettings(namespace, stored);
}

export async function saveUserSettings(username: string, namespace: SettingsNamespace, settings: unknown): Promise<UserSettings> {
    await ensureUserSettingsSchema();
    const normalized = normalizeSettings(namespace, settings);

    await pool.query(
        `INSERT INTO webmail_user_settings (username, namespace, settings_json)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json), updated_at = NOW()`,
        [username, namespace, JSON.stringify(normalized)]
    );

    return normalized;
}
