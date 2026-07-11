type CalendarEventEtagInput = {
    uid: string;
    ical_data?: string | null;
    updated_at?: Date | string | null;
};
export declare const calendarEventEtag: (event: CalendarEventEtagInput) => string;
export {};
//# sourceMappingURL=dav-etag.d.ts.map