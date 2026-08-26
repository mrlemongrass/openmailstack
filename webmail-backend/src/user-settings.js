"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.settingsDefaults = void 0;
exports.isSettingsNamespace = isSettingsNamespace;
exports.ensureUserSettingsSchema = ensureUserSettingsSchema;
exports.normalizeSettings = normalizeSettings;
exports.getUserSettings = getUserSettings;
exports.saveUserSettings = saveUserSettings;
exports.saveMailFavoriteSettings = saveMailFavoriteSettings;
const db_1 = require("./db");
exports.settingsDefaults = {
    mail: {
        signatures: [],
        identity: {
            defaultFrom: '',
            replyTo: '',
            alwaysBccSelf: false,
        },
        compose: {
            defaultMode: 'plain',
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
        spam: {
            blockedSenders: [],
            safeSenders: [],
        },
        folders: {
            favorites: [],
            favoriteUidValidities: {},
        },
    },
    calendar: {
        defaultCalendarId: null,
        defaultView: 'month',
        defaultEventDurationMinutes: 60,
        defaultReminderMinutes: 10,
        weekStartsOn: 0,
        timeZoneMode: 'system',
        timeZone: 'UTC',
        clockFormat: '12h',
        showHeaderClock: true,
        workingHoursStart: '09:00',
        workingHoursEnd: '17:00',
        visibleDays: [0, 1, 2, 3, 4, 5, 6],
    },
    contacts: {
        nameFormat: 'firstLast',
        sortBy: 'firstName',
        listDensity: 'cozy',
        autoCreateFromSent: true,
    },
    appearance: {
        themeMode: 'dark',
        density: 'cozy',
        fontScale: 'normal',
        radius: 'soft',
        accentColor: 'blue',
        reduceMotion: false,
    },
    templates: {
        templates: [],
    },
};
const namespaces = Object.keys(exports.settingsDefaults);
let schemaPromise = null;
function isSettingsNamespace(value) {
    return namespaces.includes(value);
}
async function ensureUserSettingsSchema() {
    if (!schemaPromise) {
        schemaPromise = db_1.pool.query(`
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
const isObject = (value) => (typeof value === 'object' && value !== null && !Array.isArray(value));
const stringOption = (value, allowed, fallback) => (typeof value === 'string' && allowed.includes(value) ? value : fallback);
const booleanValue = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
const boundedNumber = (value, fallback, min, max) => {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
};
const weekStartValue = (value, fallback) => {
    if (value === 0 || value === 1 || value === 6)
        return value;
    if (value === '0' || value === '1' || value === '6')
        return Number(value);
    return fallback;
};
const numberOption = (value, allowed, fallback) => (typeof value === 'number' && allowed.includes(value) ? value : fallback);
const optionalPositiveInteger = (value) => {
    if (value === null || value === undefined || value === '')
        return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1)
        return null;
    return Math.round(value);
};
const textValue = (value, maxLength) => (typeof value === 'string' ? value.trim().slice(0, maxLength) : '');
const timeZoneValue = (value, fallback) => {
    if (typeof value !== 'string' || !value.trim())
        return fallback;
    const normalized = value.trim().slice(0, 80);
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(new Date());
        return normalized;
    }
    catch {
        return fallback;
    }
};
const stringArray = (value, maxItems, maxLength) => {
    if (!Array.isArray(value))
        return [];
    return [...new Set(value
            .map(v => typeof v === 'string' ? v.trim().toLowerCase().slice(0, maxLength) : '')
            .filter(v => v !== ''))].slice(0, maxItems);
};
const folderPathArray = (value) => {
    if (!Array.isArray(value))
        return [];
    const seen = new Set();
    const paths = [];
    for (const item of value) {
        if (typeof item !== 'string')
            continue;
        const path = item.trim();
        if (!path || path.length > 1024 || /[\u0000-\u001f\u007f]/u.test(path) || seen.has(path))
            continue;
        seen.add(path);
        paths.push(path);
        if (paths.length === 100)
            break;
    }
    return paths;
};
const favoriteUidValidityMap = (value, favorites) => {
    if (!isObject(value))
        return {};
    const values = new Map(Object.entries(value));
    return Object.fromEntries(favorites.flatMap(path => {
        const rawValue = values.get(path);
        if (typeof rawValue !== 'string')
            return [];
        const uidValidity = rawValue.trim();
        if (!/^\d{1,10}$/.test(uidValidity))
            return [];
        const parsed = BigInt(uidValidity);
        return parsed > 0n && parsed <= 4294967295n ? [[path, parsed.toString()]] : [];
    }));
};
function normalizeSignatures(value) {
    if (!Array.isArray(value))
        return [];
    const seen = new Set();
    const signatures = value.slice(0, 20).flatMap(item => {
        if (!isObject(item))
            return [];
        const id = typeof item.id === 'string' && item.id.trim()
            ? item.id.trim().slice(0, 80)
            : Math.random().toString(36).slice(2, 11);
        if (seen.has(id))
            return [];
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
function normalizeSettings(namespace, value) {
    const source = isObject(value) ? value : {};
    if (namespace === 'templates') {
        const templates = Array.isArray(source.templates) ? source.templates : [];
        return {
            templates: templates.slice(0, 50).flatMap(item => {
                if (!isObject(item) || typeof item.name !== 'string' || !item.name.trim())
                    return [];
                return [{
                        name: item.name.trim().slice(0, 120),
                        content: typeof item.content === 'string' ? item.content.slice(0, 20000) : '',
                    }];
            }),
        };
    }
    if (namespace === 'mail') {
        const reading = isObject(source.reading) ? source.reading : {};
        const identity = isObject(source.identity) ? source.identity : {};
        const compose = isObject(source.compose) ? source.compose : {};
        const folders = isObject(source.folders) ? source.folders : {};
        const favorites = folderPathArray(folders.favorites);
        return {
            signatures: normalizeSignatures(source.signatures),
            identity: {
                defaultFrom: textValue(identity.defaultFrom, 255),
                replyTo: textValue(identity.replyTo, 255),
                alwaysBccSelf: booleanValue(identity.alwaysBccSelf, exports.settingsDefaults.mail.identity.alwaysBccSelf),
            },
            compose: {
                defaultMode: 'plain',
                defaultFont: stringOption(compose.defaultFont, ['system', 'serif', 'mono'], exports.settingsDefaults.mail.compose.defaultFont),
                attachmentReminder: booleanValue(compose.attachmentReminder, exports.settingsDefaults.mail.compose.attachmentReminder),
                undoSendSeconds: numberOption(compose.undoSendSeconds, [0, 5, 10, 20, 30], exports.settingsDefaults.mail.compose.undoSendSeconds),
            },
            reading: {
                threaded: booleanValue(reading.threaded, exports.settingsDefaults.mail.reading.threaded),
                density: stringOption(reading.density, ['comfortable', 'cozy', 'compact'], exports.settingsDefaults.mail.reading.density),
                previewPane: stringOption(reading.previewPane, ['right', 'bottom', 'off'], exports.settingsDefaults.mail.reading.previewPane),
                snippets: booleanValue(reading.snippets, exports.settingsDefaults.mail.reading.snippets),
                externalImages: stringOption(reading.externalImages, ['ask', 'trusted', 'always'], exports.settingsDefaults.mail.reading.externalImages),
                markReadDelaySeconds: numberOption(reading.markReadDelaySeconds, [0, 1, 3, 5], exports.settingsDefaults.mail.reading.markReadDelaySeconds),
            },
            spam: {
                blockedSenders: stringArray(isObject(source.spam) ? source.spam.blockedSenders : undefined, 500, 255),
                safeSenders: stringArray(isObject(source.spam) ? source.spam.safeSenders : undefined, 500, 255),
            },
            folders: {
                favorites,
                favoriteUidValidities: favoriteUidValidityMap(folders.favoriteUidValidities, favorites),
            },
        };
    }
    if (namespace === 'calendar') {
        const normalizedTimeZone = timeZoneValue(source.timeZone, exports.settingsDefaults.calendar.timeZone);
        const hasLegacyTimeZone = typeof source.timeZone === 'string'
            && source.timeZone.trim() !== ''
            && normalizedTimeZone === source.timeZone.trim().slice(0, 80);
        return {
            defaultCalendarId: optionalPositiveInteger(source.defaultCalendarId),
            defaultView: stringOption(source.defaultView, ['day', 'week', 'month', 'year', 'agenda'], exports.settingsDefaults.calendar.defaultView),
            defaultEventDurationMinutes: boundedNumber(source.defaultEventDurationMinutes, exports.settingsDefaults.calendar.defaultEventDurationMinutes, 5, 480),
            defaultReminderMinutes: numberOption(source.defaultReminderMinutes, [0, 5, 10, 15, 30, 60, 1440], exports.settingsDefaults.calendar.defaultReminderMinutes),
            weekStartsOn: weekStartValue(source.weekStartsOn, exports.settingsDefaults.calendar.weekStartsOn),
            timeZoneMode: stringOption(source.timeZoneMode, ['system', 'home'], hasLegacyTimeZone ? 'home' : exports.settingsDefaults.calendar.timeZoneMode),
            timeZone: normalizedTimeZone,
            clockFormat: stringOption(source.clockFormat, ['12h', '24h'], exports.settingsDefaults.calendar.clockFormat),
            showHeaderClock: booleanValue(source.showHeaderClock, exports.settingsDefaults.calendar.showHeaderClock),
            workingHoursStart: typeof source.workingHoursStart === 'string' && /^\d{2}:\d{2}$/.test(source.workingHoursStart) ? source.workingHoursStart : exports.settingsDefaults.calendar.workingHoursStart,
            workingHoursEnd: typeof source.workingHoursEnd === 'string' && /^\d{2}:\d{2}$/.test(source.workingHoursEnd) ? source.workingHoursEnd : exports.settingsDefaults.calendar.workingHoursEnd,
            visibleDays: Array.isArray(source.visibleDays) && source.visibleDays.every(d => typeof d === 'number' && d >= 0 && d <= 6) ? Array.from(new Set(source.visibleDays)).sort() : exports.settingsDefaults.calendar.visibleDays,
        };
    }
    if (namespace === 'contacts') {
        return {
            nameFormat: stringOption(source.nameFormat, ['firstLast', 'lastFirst'], exports.settingsDefaults.contacts.nameFormat),
            sortBy: stringOption(source.sortBy, ['firstName', 'lastName', 'email'], exports.settingsDefaults.contacts.sortBy),
            listDensity: stringOption(source.listDensity, ['comfortable', 'cozy', 'compact'], exports.settingsDefaults.contacts.listDensity),
            autoCreateFromSent: booleanValue(source.autoCreateFromSent, exports.settingsDefaults.contacts.autoCreateFromSent),
        };
    }
    return {
        themeMode: stringOption(source.themeMode, ['system', 'dark', 'light', 'contrast'], exports.settingsDefaults.appearance.themeMode),
        density: stringOption(source.density, ['comfortable', 'cozy', 'compact'], exports.settingsDefaults.appearance.density),
        fontScale: stringOption(source.fontScale, ['small', 'normal', 'large'], exports.settingsDefaults.appearance.fontScale),
        radius: stringOption(source.radius, ['sharp', 'soft', 'round'], exports.settingsDefaults.appearance.radius),
        accentColor: stringOption(source.accentColor, ['blue', 'cyan', 'green', 'amber', 'rose', 'violet'], exports.settingsDefaults.appearance.accentColor),
        reduceMotion: booleanValue(source.reduceMotion, exports.settingsDefaults.appearance.reduceMotion),
    };
}
async function getUserSettings(username, namespace) {
    await ensureUserSettingsSchema();
    const [rows] = await db_1.pool.query('SELECT settings_json FROM webmail_user_settings WHERE username = ? AND namespace = ?', [username, namespace]);
    if (rows.length === 0)
        return normalizeSettings(namespace, exports.settingsDefaults[namespace]);
    const stored = typeof rows[0].settings_json === 'string'
        ? JSON.parse(rows[0].settings_json)
        : rows[0].settings_json;
    return normalizeSettings(namespace, stored);
}
async function saveUserSettings(username, namespace, settings) {
    await ensureUserSettingsSchema();
    const normalized = normalizeSettings(namespace, settings);
    if (namespace === 'mail') {
        await db_1.pool.query(`INSERT INTO webmail_user_settings (username, namespace, settings_json)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE
                settings_json = JSON_SET(
                    VALUES(settings_json),
                    '$.folders',
                    COALESCE(
                        JSON_EXTRACT(settings_json, '$.folders'),
                        JSON_EXTRACT(VALUES(settings_json), '$.folders')
                    )
                ),
                updated_at = NOW()`, [username, namespace, JSON.stringify(normalized)]);
        return getUserSettings(username, namespace);
    }
    await db_1.pool.query(`INSERT INTO webmail_user_settings (username, namespace, settings_json)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json), updated_at = NOW()`, [username, namespace, JSON.stringify(normalized)]);
    return normalized;
}
async function saveMailFavoriteSettings(username, folders) {
    await ensureUserSettingsSchema();
    const normalized = normalizeSettings('mail', { folders });
    const initialSettings = {
        ...exports.settingsDefaults.mail,
        folders: normalized.folders,
    };
    await db_1.pool.query(`INSERT INTO webmail_user_settings (username, namespace, settings_json)
         VALUES (?, 'mail', ?)
         ON DUPLICATE KEY UPDATE
            settings_json = JSON_SET(settings_json, '$.folders', JSON_EXTRACT(?, '$')),
            updated_at = NOW()`, [username, JSON.stringify(initialSettings), JSON.stringify(normalized.folders)]);
    return getUserSettings(username, 'mail');
}
//# sourceMappingURL=user-settings.js.map