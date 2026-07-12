import crypto from 'crypto';

export type SchedulerExclusionKind = 'holiday' | 'out_of_office';
export interface SchedulerAvailabilityExclusion {
    id?: string;
    kind: SchedulerExclusionKind;
    startDate: string;
    endDate: string;
    label: string;
}

const validDate = (value: string): boolean => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export function normalizeSchedulerExclusions(value: unknown): SchedulerAvailabilityExclusion[] {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > 100) throw new Error('Availability exclusions must contain at most 100 ranges');
    const normalized = value.map((candidate) => {
        const input = candidate as Partial<SchedulerAvailabilityExclusion>;
        const kind: SchedulerExclusionKind | null = input.kind === 'holiday' ? 'holiday' : input.kind === 'out_of_office' ? 'out_of_office' : null;
        const startDate = String(input.startDate || '');
        const endDate = String(input.endDate || '');
        if (!kind) throw new Error('Availability exclusion kind must be holiday or out_of_office');
        if (!validDate(startDate) || !validDate(endDate) || endDate < startDate) throw new Error('Availability exclusion dates are invalid');
        const days = Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
        if (days > 366) throw new Error('Availability exclusions cannot exceed 366 days');
        return { id: String(input.id || crypto.randomUUID()), kind, startDate, endDate, label: String(input.label || '').trim().slice(0, 160) };
    });
    return normalized.sort((left, right) => left.startDate.localeCompare(right.startDate));
}

export function exclusionDateKeys(exclusions: SchedulerAvailabilityExclusion[], rangeStart: Date, rangeEnd: Date): Set<string> {
    const keys = new Set<string>();
    // Availability ranges are UTC instants while exclusions are host-local calendar dates.
    // Keep a one-day edge on both sides so UTC offsets cannot omit the first or last local day.
    const firstDate = new Date(rangeStart.getTime() - 86_400_000).toISOString().slice(0, 10);
    const lastDate = new Date(rangeEnd.getTime() + 86_400_000).toISOString().slice(0, 10);
    for (const exclusion of exclusions) {
        let cursor = new Date(`${exclusion.startDate}T00:00:00.000Z`);
        const last = new Date(`${exclusion.endDate}T00:00:00.000Z`);
        while (cursor <= last) {
            const key = cursor.toISOString().slice(0, 10);
            if (key > lastDate) break;
            if (key >= firstDate) keys.add(key);
            cursor = new Date(cursor.getTime() + 86_400_000);
        }
    }
    return keys;
}

const safeUrl = (value: unknown): string => {
    const text = String(value || '').trim().slice(0, 500);
    if (!text) return '';
    let parsed: URL;
    try { parsed = new URL(text); } catch { throw new Error('Public policy links must be valid HTTPS URLs'); }
    if (parsed.protocol !== 'https:') throw new Error('Public policy links must be valid HTTPS URLs');
    return parsed.toString();
};

const supportedLocales = new Set(['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'ja', 'ko', 'zh']);
const assertPublicTimeZone = (value: string): string => {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return value;
};

export function normalizeSchedulerPublicSettings(input: Record<string, unknown>): {
    publicAccentColor: string;
    publicIntro: string;
    privacyUrl: string;
    termsUrl: string;
    locale: string;
    lockedTimeZone: string | null;
} {
    const publicAccentColor = String(input.publicAccentColor || '#245fc7').trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(publicAccentColor)) throw new Error('Public accent color must be a six-digit hex color');
    const locale = String(input.locale || 'en').trim().toLowerCase();
    if (!supportedLocales.has(locale)) throw new Error('Unsupported Scheduler locale');
    const lockedTimeZone = input.lockedTimeZone == null || input.lockedTimeZone === '' ? null : assertPublicTimeZone(String(input.lockedTimeZone));
    return {
        publicAccentColor,
        publicIntro: String(input.publicIntro || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 500),
        privacyUrl: safeUrl(input.privacyUrl),
        termsUrl: safeUrl(input.termsUrl),
        locale,
        lockedTimeZone,
    };
}

const attributionFields = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'referrer'] as const;
export function normalizeSchedulerAttribution(value: unknown): Record<string, string> {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) return {};
    const input = value as Record<string, unknown>;
    return Object.fromEntries(attributionFields.flatMap((field) => {
        const text = String(input[field] || '').trim().slice(0, 255);
        return text ? [[field, text]] : [];
    }));
}

export function normalizeRecurrenceCount(value: unknown, maximum: number): number {
    const count = Number(value ?? 1);
    if (!Number.isInteger(count) || count < 1 || count > maximum) throw new Error(`Recurrence count must be between 1 and ${maximum}`);
    return count;
}

export function normalizeImportSource(value: unknown): 'openmailstack' | 'calendly' | 'calcom' {
    if (value === 'openmailstack' || value === 'calendly' || value === 'calcom') return value;
    throw new Error('Import source must be openmailstack, calendly, or calcom');
}
