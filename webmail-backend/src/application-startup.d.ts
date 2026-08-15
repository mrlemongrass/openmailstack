export interface ApplicationStartupDependencies {
    ensureCalendarSchema: () => Promise<unknown>;
    ensureCalendarSubscriptionSchema: () => Promise<unknown>;
    ensureNotesSchema: () => Promise<unknown>;
    ensureRemindersSchema: () => Promise<unknown>;
    ensureAttachmentsSchema: () => Promise<unknown>;
    ensureContactsSchema: () => Promise<unknown>;
    ensureEasMailSyncSchema: () => Promise<unknown>;
    ensureEasPimSyncSchema: () => Promise<unknown>;
    repairBirthdayCalendarProjections: () => Promise<unknown>;
    startCalendarSubscriptionWorker: () => void;
    listen: () => void;
}
/**
 * Keep schema readiness and traffic activation in one executable boundary.
 * Any rejected prerequisite leaves both the background writer and HTTP
 * listener stopped.
 */
export declare function startApplicationAfterRequiredMigrations(dependencies: ApplicationStartupDependencies): Promise<void>;
//# sourceMappingURL=application-startup.d.ts.map