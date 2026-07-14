import { type SchedulerMessageProvider, type SchedulerReminderMail } from './workflows';
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
    notificationFrom?: string;
    notificationName?: string;
    verificationCode?: string;
    seats?: number;
    additionalAttendees?: Array<{
        name: string;
        email: string;
    }>;
}
export interface SchedulerMail {
    to: string;
    subject: string;
    text: string;
    ical?: string;
    from: {
        name: string;
        address: string;
    };
    replyTo: string;
}
interface SchedulerSmtpOptions {
    smtpHost: string;
    smtpPort: number;
    smtpServerName: string;
    smtpRejectUnauthorized: boolean;
}
export declare function schedulerTransportOptions(config?: SchedulerSmtpOptions): Record<string, unknown>;
export declare function schedulerNotificationMails(eventType: string, payload: NotificationPayload, baseUrl: string): SchedulerMail[];
export declare class OmsSchedulerMessageProvider implements SchedulerMessageProvider {
    readonly name = "oms-smtp";
    send(mail: SchedulerReminderMail, idempotencyKey: string): Promise<{
        messageId?: string;
    }>;
}
export declare function runSchedulerOutboxCycle(workerId: string): Promise<number>;
export declare function runSchedulerWorkerCycle(workerId: string, provider?: SchedulerMessageProvider): Promise<{
    outbox: number;
    jobs: number;
}>;
export {};
//# sourceMappingURL=worker.d.ts.map