"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startApplicationAfterRequiredMigrations = startApplicationAfterRequiredMigrations;
/**
 * Keep schema readiness and traffic activation in one executable boundary.
 * Any rejected prerequisite leaves every schema-dependent application worker
 * and the HTTP listener stopped.
 */
async function startApplicationAfterRequiredMigrations(dependencies) {
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
//# sourceMappingURL=application-startup.js.map