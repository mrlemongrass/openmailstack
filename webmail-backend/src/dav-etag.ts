import crypto from 'crypto';

type CalendarEventEtagInput = {
    uid: string;
    ical_data?: string | null;
    updated_at?: Date | string | null;
};

const normalizeUpdatedAt = (updatedAt: CalendarEventEtagInput['updated_at']): string => {
    if (!updatedAt) return '';
    if (updatedAt instanceof Date) return updatedAt.toISOString();
    return String(updatedAt);
};

export const calendarEventEtag = (event: CalendarEventEtagInput): string => {
    const hash = crypto
        .createHash('sha256')
        .update(event.uid || '')
        .update('\0')
        .update(event.ical_data || '')
        .update('\0')
        .update(normalizeUpdatedAt(event.updated_at))
        .digest('hex')
        .slice(0, 24);

    return `"${event.uid}-${hash}"`;
};
