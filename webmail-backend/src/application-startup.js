"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startApplicationAfterRequiredMigrations = startApplicationAfterRequiredMigrations;
/**
 * Keep schema readiness and traffic activation in one executable boundary.
 * Any rejected prerequisite leaves both the background writer and HTTP
 * listener stopped.
 */
async function startApplicationAfterRequiredMigrations(dependencies) {
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
//# sourceMappingURL=application-startup.js.map