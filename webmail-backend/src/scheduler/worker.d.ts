interface NotificationPayload {
    bookingId: string;
    hostEmail: string;
    bookerEmail: string;
    bookerName: string;
    title?: string;
    start: string;
    end?: string;
    timeZone?: string;
    cancelToken?: string;
    rescheduleToken?: string;
    ical?: string;
    event?: {
        title?: string;
    };
}
export interface SchedulerMail {
    to: string;
    subject: string;
    text: string;
    ical?: string;
}
export declare function schedulerNotificationMails(eventType: string, payload: NotificationPayload, baseUrl: string): SchedulerMail[];
export declare function startSchedulerWorker(): void;
export {};
//# sourceMappingURL=worker.d.ts.map