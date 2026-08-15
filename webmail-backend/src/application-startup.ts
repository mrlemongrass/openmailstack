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
export async function startApplicationAfterRequiredMigrations(
    dependencies: ApplicationStartupDependencies,
): Promise<void> {
    await dependencies.ensureCalendarSchema();
    await dependencies.ensureCalendarSubscriptionSchema();
    await dependencies.ensureNotesSchema();
    await dependencies.ensureRemindersSchema();
    await dependencies.ensureAttachmentsSchema();
    await dependencies.ensureContactsSchema();
    await dependencies.ensureEasMailSyncSchema();
    await dependencies.ensureEasPimSyncSchema();
    await dependencies.repairBirthdayCalendarProjections();
    dependencies.startCalendarSubscriptionWorker();
    dependencies.listen();
}
