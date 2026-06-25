"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.brandingDefaults = void 0;
exports.ensureBrandingSchema = ensureBrandingSchema;
exports.normalizeBrandingSettings = normalizeBrandingSettings;
exports.getBrandingSettings = getBrandingSettings;
exports.saveBrandingSettings = saveBrandingSettings;
const db_1 = require("./db");
exports.brandingDefaults = {
    appName: 'OpenMailStack',
    companyName: '',
    loginTitle: 'OpenMailStack',
    loginSubtitle: 'Sign in to continue',
    appIconDataUrl: '',
    faviconDataUrl: '',
    loginLogoDataUrl: '',
    loginBackgroundDataUrl: '',
};
const imageLimits = {
    appIconDataUrl: 256 * 1024,
    faviconDataUrl: 256 * 1024,
    loginLogoDataUrl: 512 * 1024,
    loginBackgroundDataUrl: 2 * 1024 * 1024,
};
let schemaPromise = null;
function ensureBrandingSchema() {
    if (!schemaPromise) {
        schemaPromise = db_1.pool.query(`
            CREATE TABLE IF NOT EXISTS webmail_branding_settings (
                id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
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
    if (!trimmed)
        return fallback;
    return trimmed.slice(0, maxLength);
};
const optionalText = (value, maxLength) => (typeof value === 'string' ? value.trim().slice(0, maxLength) : '');
const imageDataUrl = (value, maxDecodedBytes) => {
    if (typeof value !== 'string' || value.trim() === '')
        return '';
    const match = value.match(/^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)$/i);
    if (!match)
        return '';
    const mime = match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase();
    const payload = match[2];
    const decoded = Buffer.from(payload, 'base64');
    if (decoded.length === 0 || decoded.length > maxDecodedBytes)
        return '';
    return `data:image/${mime};base64,${payload}`;
};
function normalizeBrandingSettings(value) {
    const source = isObject(value) ? value : {};
    return {
        appName: textValue(source.appName, exports.brandingDefaults.appName, 80),
        companyName: optionalText(source.companyName, 120),
        loginTitle: textValue(source.loginTitle, exports.brandingDefaults.loginTitle, 120),
        loginSubtitle: textValue(source.loginSubtitle, exports.brandingDefaults.loginSubtitle, 200),
        appIconDataUrl: imageDataUrl(source.appIconDataUrl, imageLimits.appIconDataUrl),
        faviconDataUrl: imageDataUrl(source.faviconDataUrl, imageLimits.faviconDataUrl),
        loginLogoDataUrl: imageDataUrl(source.loginLogoDataUrl, imageLimits.loginLogoDataUrl),
        loginBackgroundDataUrl: imageDataUrl(source.loginBackgroundDataUrl, imageLimits.loginBackgroundDataUrl),
    };
}
async function getBrandingSettings() {
    await ensureBrandingSchema();
    const [rows] = await db_1.pool.query('SELECT settings_json FROM webmail_branding_settings WHERE id = 1 LIMIT 1');
    if (rows.length === 0)
        return exports.brandingDefaults;
    const stored = typeof rows[0].settings_json === 'string'
        ? JSON.parse(rows[0].settings_json)
        : rows[0].settings_json;
    return normalizeBrandingSettings(stored);
}
async function saveBrandingSettings(settings, updatedBy) {
    await ensureBrandingSchema();
    const normalized = normalizeBrandingSettings(settings);
    await db_1.pool.query(`INSERT INTO webmail_branding_settings (id, settings_json, updated_by)
         VALUES (1, ?, ?)
         ON DUPLICATE KEY UPDATE settings_json = VALUES(settings_json), updated_by = VALUES(updated_by), updated_at = NOW()`, [JSON.stringify(normalized), updatedBy]);
    return normalized;
}
//# sourceMappingURL=branding.js.map