export interface ApplicationStartupDependencies {
    ensureMailSearchSchema: () => Promise<unknown>;
    initializeSessionStore: () => Promise<unknown>;
    ensureUserSettingsSchema: () => Promise<unknown>;
    ensureAdminSettingsSchema: () => Promise<unknown>;
    ensureBrandingSchema: () => Promise<unknown>;
    ensureAccountSecuritySchema: () => Promise<unknown>;
    ensureCalendarSchema: () => Promise<unknown>;
    ensureCalendarSubscriptionSchema: () => Promise<unknown>;
    ensureScheduledEmailsSchema: () => Promise<unknown>;
    ensureNotesSchema: () => Promise<unknown>;
    ensureRemindersSchema: () => Promise<unknown>;
    ensureAttachmentsSchema: () => Promise<unknown>;
    ensureContactsSchema: () => Promise<unknown>;
    ensureEasMailSyncSchema: () => Promise<unknown>;
    ensureEasPimSyncSchema: () => Promise<unknown>;
    repairBirthdayCalendarProjections: () => Promise<unknown>;
    startSearchWorker: () => void;
    startScheduledSender: () => void;
    startCalendarSubscriptionWorker: () => void;
    listen: () => void;
}

/**
 * Keep schema readiness and traffic activation in one executable boundary.
 * Any rejected prerequisite leaves every schema-dependent application worker
 * and the HTTP listener stopped.
 */
export async function startApplicationAfterRequiredMigrations(
    dependencies: ApplicationStartupDependencies,
): Promise<void> {
    await dependencies.ensureMailSearchSchema();
    await dependencies.initializeSessionStore();
    await dependencies.ensureUserSettingsSchema();
    await dependencies.ensureAdminSettingsSchema();
    await dependencies.ensureBrandingSchema();
    await dependencies.ensureAccountSecuritySchema();
    await dependencies.ensureCalendarSchema();
    await dependencies.ensureCalendarSubscriptionSchema();
    await dependencies.ensureScheduledEmailsSchema();
    await dependencies.ensureNotesSchema();
    await dependencies.ensureRemindersSchema();
    await dependencies.ensureAttachmentsSchema();
    await dependencies.ensureContactsSchema();
    await dependencies.ensureEasMailSyncSchema();
    await dependencies.ensureEasPimSyncSchema();
    await dependencies.repairBirthdayCalendarProjections();
    dependencies.startSearchWorker();
    dependencies.startScheduledSender();
    dependencies.startCalendarSubscriptionWorker();
    dependencies.listen();
}
