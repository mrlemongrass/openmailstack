"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.schedulerHostAllowed = exports.schedulerRouter = void 0;
const express_1 = require("express");
const db_1 = require("../db");
const auth_1 = require("../auth");
const config_1 = require("../config");
const calendar_utils_1 = require("../calendar-utils");
const security_1 = require("../security");
const store_1 = require("./store");
const phase1_1 = require("./phase1");
const phase2_store_1 = require("./phase2-store");
const workflows_1 = require("./workflows");
const worker_1 = require("./worker");
exports.schedulerRouter = (0, express_1.Router)();
const store = new store_1.SchedulerStore(db_1.pool);
const phase2Store = new phase2_store_1.SchedulerPhase2Store(db_1.pool, store);
const schedulerSecrets = new workflows_1.SchedulerSecretBox(config_1.schedulerConfig.secretKeys);
const workflows = new workflows_1.SchedulerWorkflowRepository(db_1.pool);
const deliveryProviders = new workflows_1.SchedulerDeliveryProviderRepository(db_1.pool, schedulerSecrets);
const contactPreferences = new workflows_1.SchedulerContactPreferenceRepository(db_1.pool, schedulerSecrets);
const workflowDispatcher = new workflows_1.SchedulerWorkflowDeliveryDispatcher(db_1.pool, new worker_1.OmsSchedulerMessageProvider(), deliveryProviders, contactPreferences, config_1.schedulerConfig.publicBaseUrl);
const authenticatedInstalled = (_req, res, next) => {
    if (!config_1.schedulerConfig.enabled)
        return res.status(403).json({ success: false, error: 'Scheduler is not installed' });
    next();
};
const requestHost = (req) => String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '');
const schedulerHostAllowed = (host, allowedHosts = config_1.schedulerConfig.allowedHosts) => (allowedHosts.includes(host.trim().toLowerCase().replace(/:\d+$/, '')));
exports.schedulerHostAllowed = schedulerHostAllowed;
const publicBoundary = (req, res, next) => {
    if (!config_1.schedulerConfig.enabled || !(0, exports.schedulerHostAllowed)(requestHost(req))) {
        return res.status(404).json({ success: false, error: 'Not found' });
    }
    next();
};
const publicNotFound = (res) => res.status(404).json({ success: false, error: 'Not found' });
const privateAccessToken = (req) => String(req.headers['x-scheduler-access'] || '').trim().slice(0, 128);
const ownerError = (res, error) => {
    const message = error instanceof Error ? error.message : 'Scheduler request failed';
    const status = /not enabled/i.test(message) ? 403 : /not found/i.test(message) ? 404 : 400;
    return res.status(status).json({ success: false, error: message });
};
exports.schedulerRouter.get('/scheduler/v1/status', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        const entitlement = await store.getEntitlement(req.user.username);
        res.json({
            success: true,
            installed: true,
            enabled: Boolean(entitlement?.enabled),
            published: Boolean(entitlement?.published),
            entitlement,
            publicBaseUrl: config_1.schedulerConfig.publicBaseUrl,
        });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.get('/scheduler/v1/me', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        const entitlement = await store.requireOwner(req.user.username);
        const [events, bookings, calendars, defaultAvailability, notificationIdentities, waitlist, polls] = await Promise.all([
            store.listEventTypes(req.user.username),
            store.listBookings(req.user.username, String(req.query.filter || 'upcoming')),
            (0, calendar_utils_1.getVisibleCalendars)(req.user.username),
            store.getDefaultAvailability(req.user.username),
            store.listNotificationIdentities(req.user.username),
            store.listWaitlist(req.user.username),
            phase2Store.listPolls(req.user.username),
        ]);
        res.json({
            success: true,
            entitlement,
            events,
            bookings,
            calendars: calendars.map((calendar) => ({ id: calendar.id, name: calendar.name, color: calendar.color })),
            defaultAvailability,
            notificationIdentities,
            waitlist,
            polls,
            publicBaseUrl: config_1.schedulerConfig.publicBaseUrl,
        });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.get('/scheduler/v1/availability/default', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        res.json({ success: true, availability: await store.getDefaultAvailability(req.user.username) });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.put('/scheduler/v1/availability/default', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        res.json({ success: true, availability: await store.saveDefaultAvailability(req.user.username, req.body || {}) });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.get('/scheduler/v1/availability/preview', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        const start = new Date(String(req.query.start || ''));
        const end = new Date(String(req.query.end || ''));
        const preview = await store.previewDefaultAvailability(req.user.username, start, end);
        res.json({ success: true, ...preview });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.put('/scheduler/v1/profile', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        const entitlement = await store.updateProfile(req.user.username, req.body || {});
        res.json({ success: true, entitlement });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.post('/scheduler/v1/event-types', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        const event = await store.saveEventType(req.user.username, req.body || {});
        res.status(201).json({ success: true, event });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.put('/scheduler/v1/event-types/:id', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        const event = await store.saveEventType(req.user.username, req.body || {}, req.params.id);
        res.json({ success: true, event });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.delete('/scheduler/v1/event-types/:id', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        await store.deleteEventType(req.user.username, req.params.id);
        res.json({ success: true });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.get('/scheduler/v1/event-types/:id/private-link', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        const privateLink = await store.getPrivateLinkState(req.user.username, req.params.id);
        res.set('Cache-Control', 'no-store').json({ success: true, privateLink });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.post('/scheduler/v1/event-types/:id/private-link', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        const [rotated, entitlement, event] = await Promise.all([
            store.rotatePrivateLink(req.user.username, req.params.id, req.body?.expiresAt, req.body?.singleUse === true, req.body?.oneOffAvailability ?? null),
            store.requireOwner(req.user.username),
            store.getOwnedEventType(req.user.username, req.params.id),
        ]);
        if (!event)
            return ownerError(res, new Error('Event type not found'));
        const url = `${(0, phase1_1.schedulerPublicUrl)(config_1.schedulerConfig.publicBaseUrl, entitlement.handle, event.slug)}#access=${encodeURIComponent(rotated.token)}`;
        res.set('Cache-Control', 'no-store').status(201).json({ success: true, privateLink: rotated.state, url });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.delete('/scheduler/v1/event-types/:id/private-link', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        await store.revokePrivateLink(req.user.username, req.params.id);
        res.set('Cache-Control', 'no-store').json({ success: true });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.get('/scheduler/v1/bookings', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        const bookings = await store.listBookings(req.user.username, String(req.query.filter || 'upcoming'));
        res.json({ success: true, bookings });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.post('/scheduler/v1/bookings/:id/cancel', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        await store.cancelOwnedBooking(req.user.username, req.params.id);
        res.json({ success: true });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.post('/scheduler/v1/bookings/:id/confirm', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        res.json({ success: true, booking: await store.decideBooking(req.user.username, req.params.id, 'confirmed') });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.post('/scheduler/v1/bookings/:id/reject', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        res.json({ success: true, booking: await store.decideBooking(req.user.username, req.params.id, 'rejected') });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.post('/scheduler/v1/bookings/on-behalf', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        const booking = await store.bookOnBehalf(req.user.username, String(req.body?.eventTypeId || ''), {
            start: new Date(req.body?.start), bookerTimeZone: String(req.body?.bookerTimeZone || 'UTC'),
            bookerName: String(req.body?.bookerName || ''), bookerEmail: String(req.body?.bookerEmail || ''),
            bookerNotes: String(req.body?.bookerNotes || ''), attendees: req.body?.attendees, seats: req.body?.seats,
            idempotencyKey: String(req.headers['idempotency-key'] || req.body?.idempotencyKey || ''),
        });
        res.status(201).json({ success: true, booking });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.post('/scheduler/v1/bookings/:id/outcome', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        const outcome = req.body?.outcome === 'completed' ? 'completed' : req.body?.outcome === 'no_show' ? 'no_show' : null;
        if (!outcome)
            throw new Error('Outcome must be completed or no_show');
        await store.markBookingOutcome(req.user.username, req.params.id, outcome);
        res.json({ success: true });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.get('/scheduler/v1/waitlist', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        res.json({ success: true, waitlist: await store.listWaitlist(req.user.username) });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.post('/scheduler/v1/polls', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        const poll = await phase2Store.createPoll(req.user.username, req.body || {});
        res.set('Cache-Control', 'no-store').status(201).json({
            success: true, poll, url: `${config_1.schedulerConfig.publicBaseUrl}/scheduler/poll/${encodeURIComponent(poll.token)}`,
        });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.get('/scheduler/v1/polls', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        res.json({ success: true, polls: await phase2Store.listPolls(req.user.username) });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.post('/scheduler/v1/polls/:id/finalize', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        res.json({ success: true, booking: await phase2Store.finalizePoll(req.user.username, req.params.id, String(req.body?.optionId || '')) });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.get('/scheduler/v1/export', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        if (req.query.format === 'csv') {
            const csv = await phase2Store.exportBookingsCsv(req.user.username);
            return res.type('text/csv').set('Content-Disposition', 'attachment; filename="scheduler-bookings.csv"').send(csv);
        }
        res.set('Content-Disposition', 'attachment; filename="scheduler-config.json"').json({ success: true, export: await phase2Store.exportOwnerData(req.user.username) });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.post('/scheduler/v1/import', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        res.status(201).json({ success: true, result: await phase2Store.importOwnerData(req.user.username, req.body?.source, req.body?.payload) });
    }
    catch (error) {
        ownerError(res, error);
    }
});
const workflowSamplePayload = (username, value = {}) => ({
    bookingId: 'preview',
    hostEmail: username,
    notificationFrom: username,
    notificationName: String(value.notificationName || username.split('@')[0]),
    bookerEmail: username,
    bookerName: String(value.bookerName || 'Guest'),
    title: String(value.title || 'Sample meeting'),
    start: String(value.start || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()),
    end: String(value.end || new Date(Date.now() + 24.5 * 60 * 60 * 1000).toISOString()),
    status: String(value.status || 'confirmed'),
    timeZone: String(value.timeZone || 'UTC'),
    locale: String(value.locale || 'en'),
    communicationConsents: [],
    manageUrl: `${config_1.schedulerConfig.publicBaseUrl}/scheduler`,
});
exports.schedulerRouter.get('/scheduler/v1/workflows', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        await store.requireOwner(req.user.username);
        res.json({ success: true, workflows: await workflows.listWorkflows(req.user.username) });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.post('/scheduler/v1/workflows', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        const entitlement = await store.requireOwner(req.user.username);
        const workflow = await workflows.createWorkflow({
            tenantKey: entitlement.tenantKey,
            ownerUsername: req.user.username,
            name: req.body?.name,
            enabled: false,
            eventTypeIds: req.body?.eventTypeIds,
        });
        res.status(201).json({ success: true, workflow });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.put('/scheduler/v1/workflows/:id', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        await store.requireOwner(req.user.username);
        await workflows.updateWorkflow(req.user.username, req.params.id, req.body || {});
        res.json({ success: true });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.delete('/scheduler/v1/workflows/:id', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        await store.requireOwner(req.user.username);
        await workflows.archiveWorkflow(req.user.username, req.params.id);
        res.json({ success: true });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.post('/scheduler/v1/workflows/:id/clone', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        await store.requireOwner(req.user.username);
        const workflow = await workflows.cloneWorkflow(req.user.username, req.params.id);
        res.status(201).json({ success: true, workflow });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.post('/scheduler/v1/workflows/:id/publish', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        await store.requireOwner(req.user.username);
        const version = await workflows.publishVersion(req.params.id, req.user.username, req.body?.definition);
        res.status(201).json({ success: true, version });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.post('/scheduler/v1/workflows/preview', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        await store.requireOwner(req.user.username);
        const definition = (0, workflows_1.normalizeWorkflowDefinition)(req.body?.definition);
        const payload = workflowSamplePayload(req.user.username, req.body?.sample);
        const preview = definition.steps.map(step => step.action === 'webhook.http'
            ? { action: step.action, body: JSON.stringify({ type: 'scheduler.workflow', booking: payload }, null, 2) }
            : { action: step.action, ...(0, workflows_1.renderWorkflowAction)(payload, step.config) });
        res.json({ success: true, preview });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.post('/scheduler/v1/workflows/translate', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        const entitlement = await store.requireOwner(req.user.username);
        const definition = await workflowDispatcher.translateDefinition(entitlement.tenantKey, String(req.body?.providerId || ''), req.body?.locales, req.body?.definition);
        res.json({ success: true, definition });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.post('/scheduler/v1/workflows/:id/test', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        await store.requireOwner(req.user.username);
        const result = await workflows.enqueueTest(req.user.username, req.params.id, workflowSamplePayload(req.user.username, req.body));
        res.status(202).json({ success: true, ...result });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.get('/scheduler/v1/delivery-providers', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        const entitlement = await store.requireOwner(req.user.username);
        res.set('Cache-Control', 'no-store').json({
            success: true,
            providers: await deliveryProviders.listAvailable(entitlement.tenantKey),
        });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.get('/scheduler/v1/workflow-operations', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        await store.requireOwner(req.user.username);
        res.json({ success: true, ...await workflows.listOperations(req.user.username, Number(req.query.limit || 100)) });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.post('/scheduler/v1/workflow-operations/:id/reconcile', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        await store.requireOwner(req.user.username);
        const action = ['retry', 'delivered', 'cancel'].includes(req.body?.action) ? req.body.action : null;
        if (!action)
            throw new Error('Reconciliation action must be retry, delivered, or cancel');
        await workflows.reconcileJob(req.user.username, req.params.id, action);
        res.json({ success: true });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.get('/scheduler/v1/notifications', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        await store.requireOwner(req.user.username);
        res.json({ success: true, notifications: await workflows.listNotifications(req.user.username) });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.post('/scheduler/v1/notifications/:id/read', authenticatedInstalled, auth_1.requireSession, async (req, res) => {
    try {
        await store.requireOwner(req.user.username);
        await workflows.markNotificationRead(req.user.username, req.params.id);
        res.json({ success: true });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.get('/admin/scheduler/v1/mailboxes', authenticatedInstalled, auth_1.requireSession, auth_1.requireAdminSession, async (_req, res) => {
    try {
        const mailboxes = await store.listAdminMailboxes();
        res.json({ success: true, installed: true, publicBaseUrl: config_1.schedulerConfig.publicBaseUrl, allowedHosts: config_1.schedulerConfig.allowedHosts, mailboxes });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.put('/admin/scheduler/v1/mailboxes/:username', authenticatedInstalled, auth_1.requireSession, auth_1.requireAdminSession, async (req, res) => {
    try {
        const entitlement = await store.setEntitlement(req.params.username, req.user.username, req.body || {});
        res.json({ success: true, entitlement });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.get('/admin/scheduler/v1/providers', authenticatedInstalled, auth_1.requireSession, auth_1.requireAdminSession, async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store').json({
            success: true,
            providers: await deliveryProviders.list(req.query.tenantKey ? String(req.query.tenantKey) : undefined),
        });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.post('/admin/scheduler/v1/providers', authenticatedInstalled, auth_1.requireSession, auth_1.requireAdminSession, async (req, res) => {
    try {
        const provider = await deliveryProviders.save(req.user.username, req.body?.tenantKey, req.body || {});
        res.set('Cache-Control', 'no-store').status(201).json({ success: true, provider });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.put('/admin/scheduler/v1/providers/:id', authenticatedInstalled, auth_1.requireSession, auth_1.requireAdminSession, async (req, res) => {
    try {
        const provider = await deliveryProviders.save(req.user.username, req.body?.tenantKey, req.body || {}, req.params.id);
        res.set('Cache-Control', 'no-store').json({ success: true, provider });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.delete('/admin/scheduler/v1/providers/:id', authenticatedInstalled, auth_1.requireSession, auth_1.requireAdminSession, async (req, res) => {
    try {
        await deliveryProviders.disable(String(req.params.id), req.user.username);
        res.json({ success: true });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.post('/admin/scheduler/v1/providers/:id/test', authenticatedInstalled, auth_1.requireSession, auth_1.requireAdminSession, async (req, res) => {
    try {
        await workflowDispatcher.testProvider(String(req.body?.tenantKey || ''), String(req.params.id));
        res.json({ success: true });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.get('/admin/scheduler/v1/workflow-operations', authenticatedInstalled, auth_1.requireSession, auth_1.requireAdminSession, async (req, res) => {
    try {
        res.json({
            success: true,
            ...await workflows.listAdminOperations(req.query.tenantKey ? String(req.query.tenantKey) : undefined, Number(req.query.limit || 100)),
        });
    }
    catch (error) {
        ownerError(res, error);
    }
});
exports.schedulerRouter.post('/admin/scheduler/v1/workflow-operations/:id/reconcile', authenticatedInstalled, auth_1.requireSession, auth_1.requireAdminSession, async (req, res) => {
    try {
        const action = ['retry', 'delivered', 'cancel'].includes(req.body?.action) ? req.body.action : null;
        if (!action)
            throw new Error('Reconciliation action must be retry, delivered, or cancel');
        await workflows.reconcileJobAsAdmin(req.user.username, req.params.id, action);
        res.json({ success: true });
    }
    catch (error) {
        ownerError(res, error);
    }
});
const publicLimiter = (0, security_1.rateLimit)(60 * 1000, 120);
const bookingLimiter = (0, security_1.rateLimit)(15 * 60 * 1000, 20);
const publicEventView = (event) => ({ ...event, guestAllowList: [], guestDenyList: [] });
exports.schedulerRouter.get('/public/scheduler/v1/profiles/:handle', publicLimiter, publicBoundary, async (req, res) => {
    try {
        const profile = await store.getPublicProfile(String(req.params.handle));
        if (!profile)
            return publicNotFound(res);
        const events = await Promise.all(profile.events.map(async (event) => ({
            ...publicEventView(event),
            communicationChannels: await workflows.requiredChannels(profile.entitlement.username, event.id),
        })));
        const defaultEvent = profile.defaultEvent ? {
            ...publicEventView(profile.defaultEvent),
            communicationChannels: await workflows.requiredChannels(profile.entitlement.username, profile.defaultEvent.id),
        } : null;
        res.json({
            success: true,
            profile: profile.entitlement,
            events,
            defaultEvent,
        });
    }
    catch {
        publicNotFound(res);
    }
});
exports.schedulerRouter.get('/public/scheduler/v1/profiles/:handle/events/:slug', publicLimiter, publicBoundary, async (req, res) => {
    try {
        const accessToken = privateAccessToken(req);
        const result = await store.getPublicEvent(String(req.params.handle), String(req.params.slug), accessToken);
        if (!result)
            return publicNotFound(res);
        if (accessToken)
            res.set('Cache-Control', 'no-store');
        const communicationChannels = await workflows.requiredChannels(result.entitlement.username, result.event.id);
        res.json({ success: true, profile: result.entitlement, event: { ...publicEventView(result.event), communicationChannels } });
    }
    catch {
        publicNotFound(res);
    }
});
exports.schedulerRouter.get('/public/scheduler/v1/profiles/:handle/events/:slug/slots', publicLimiter, publicBoundary, async (req, res) => {
    try {
        const start = new Date(String(req.query.start || ''));
        const end = new Date(String(req.query.end || ''));
        const accessToken = privateAccessToken(req);
        const slots = await store.listSlots(String(req.params.handle), String(req.params.slug), start, end, accessToken, req.query.includeFull === 'true');
        if (accessToken)
            res.set('Cache-Control', 'no-store');
        res.json({ success: true, slots });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid availability request';
        if (/invalid availability range|cannot exceed 62 days/i.test(message)) {
            return res.status(400).json({ success: false, error: message });
        }
        res.status(500).json({ success: false, error: 'Unable to load availability' });
    }
});
exports.schedulerRouter.post('/public/scheduler/v1/profiles/:handle/events/:slug/bookings', bookingLimiter, publicBoundary, async (req, res) => {
    try {
        const bookingInput = {
            eventTypeId: String(req.body?.eventTypeId || ''),
            start: new Date(req.body?.start),
            bookerTimeZone: String(req.body?.bookerTimeZone || ''),
            bookerName: String(req.body?.bookerName || ''),
            bookerEmail: String(req.body?.bookerEmail || ''),
            communicationConsents: req.body?.communicationConsents,
            bookerNotes: String(req.body?.bookerNotes || ''),
            bookingAnswers: req.body?.bookingAnswers,
            attendees: req.body?.attendees,
            seats: req.body?.seats,
            verificationChallengeId: req.body?.verificationChallengeId,
            verificationCode: req.body?.verificationCode,
            recurrenceCount: req.body?.recurrenceCount,
            attribution: req.body?.attribution,
            idempotencyKey: String(req.headers['idempotency-key'] || req.body?.idempotencyKey || ''),
            privateAccessToken: privateAccessToken(req),
        };
        const result = Number(req.body?.recurrenceCount || 1) > 1
            ? await store.createRecurringBooking(String(req.params.handle), String(req.params.slug), bookingInput)
            : await store.createBooking(String(req.params.handle), String(req.params.slug), bookingInput);
        res.status(result.idempotentReplay ? 200 : 201).json({ success: true, booking: result });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to create booking';
        if (/not found/i.test(message))
            return publicNotFound(res);
        if (/no longer available|enough capacity|slot definition|recurring occurrence .* not available/i.test(message)) {
            return res.status(409).json({ success: false, error: 'The selected time is no longer available' });
        }
        if (/name is required|valid email|time zone|idempotency key|required|booking answers|invalid selection|too long|valid new start|already used for another booking|not eligible|additional guest|seats must|recurrence count|recurring bookings/i.test(message)) {
            return res.status(400).json({ success: false, error: message });
        }
        if (/maximum active bookings/i.test(message)) {
            return res.status(409).json({ success: false, code: 'active_booking_limit', error: message });
        }
        res.status(500).json({ success: false, error: 'Unable to create booking' });
    }
});
exports.schedulerRouter.get('/public/scheduler/v1/unsubscribe/:token', publicLimiter, publicBoundary, async (req, res) => {
    const token = String(req.params.token || '').trim();
    const action = `/api/public/scheduler/v1/unsubscribe/${encodeURIComponent(token)}`;
    res.set('Cache-Control', 'no-store').type('html').send(`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribe from Scheduler messages</title>
<main><h1>Stop Scheduler messages?</h1><p>This will stop future messages for this communication channel.</p>
<form method="post" action="${action}"><button type="submit">Confirm unsubscribe</button></form></main></html>`);
});
exports.schedulerRouter.post('/public/scheduler/v1/unsubscribe/:token', publicLimiter, publicBoundary, async (req, res) => {
    try {
        const changed = await contactPreferences.unsubscribe(String(req.params.token));
        res.set('Cache-Control', 'no-store').type('text/plain').send(changed ? 'You have been unsubscribed from Scheduler messages.' : 'This unsubscribe link is no longer active.');
    }
    catch {
        res.status(500).type('text/plain').send('Unable to update communication preferences.');
    }
});
exports.schedulerRouter.post('/public/scheduler/v1/profiles/:handle/events/:slug/waitlist', bookingLimiter, publicBoundary, async (req, res) => {
    try {
        const result = await store.joinWaitlist(String(req.params.handle), String(req.params.slug), {
            eventTypeId: String(req.body?.eventTypeId || ''), start: new Date(req.body?.start),
            bookerTimeZone: String(req.body?.bookerTimeZone || ''), bookerName: String(req.body?.bookerName || ''),
            bookerEmail: String(req.body?.bookerEmail || ''), bookerNotes: String(req.body?.bookerNotes || ''),
            communicationConsents: req.body?.communicationConsents,
            attendees: req.body?.attendees, seats: req.body?.seats,
            verificationChallengeId: req.body?.verificationChallengeId, verificationCode: req.body?.verificationCode,
            idempotencyKey: String(req.headers['idempotency-key'] || req.body?.idempotencyKey || ''), privateAccessToken: privateAccessToken(req),
        });
        res.status(result.idempotentReplay ? 200 : 201).json({ success: true, waitlist: result });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to join waitlist';
        if (/not available|not found/i.test(message))
            return publicNotFound(res);
        if (/required|valid|eligible|seats|capacity|time zone|idempotency key/i.test(message))
            return res.status(400).json({ success: false, error: message });
        res.status(500).json({ success: false, error: 'Unable to join waitlist' });
    }
});
exports.schedulerRouter.get('/public/scheduler/v1/polls/:token', publicLimiter, publicBoundary, async (req, res) => {
    try {
        const poll = await phase2Store.getPublicPoll(String(req.params.token));
        if (!poll)
            return publicNotFound(res);
        res.set('Cache-Control', 'no-store').json({ success: true, poll });
    }
    catch {
        publicNotFound(res);
    }
});
exports.schedulerRouter.post('/public/scheduler/v1/polls/:token/votes', bookingLimiter, publicBoundary, async (req, res) => {
    try {
        await phase2Store.votePoll(String(req.params.token), req.body || {});
        res.status(201).json({ success: true });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to save poll vote';
        if (/not available/i.test(message))
            return publicNotFound(res);
        res.status(400).json({ success: false, error: message });
    }
});
exports.schedulerRouter.post('/public/scheduler/v1/polls/:token/verification', bookingLimiter, publicBoundary, async (req, res) => {
    try {
        const verification = await phase2Store.requestPollVerification(String(req.params.token), req.body?.voterEmail);
        res.status(202).json({ success: true, verification });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to send verification code';
        if (/not available|not found/i.test(message))
            return publicNotFound(res);
        res.status(400).json({ success: false, error: message });
    }
});
exports.schedulerRouter.post('/public/scheduler/v1/profiles/:handle/events/:slug/verification', bookingLimiter, publicBoundary, async (req, res) => {
    try {
        const verification = await store.requestEmailVerification(String(req.params.handle), String(req.params.slug), req.body?.bookerEmail, privateAccessToken(req));
        res.status(202).json({ success: true, verification });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (/not found/i.test(message))
            return publicNotFound(res);
        if (/valid email|not eligible|not required/i.test(message))
            return res.status(400).json({ success: false, error: message });
        res.status(500).json({ success: false, error: 'Unable to send verification code' });
    }
});
exports.schedulerRouter.get('/public/scheduler/v1/actions/:scope/:token', publicLimiter, publicBoundary, async (req, res) => {
    try {
        const scope = req.params.scope === 'cancel' ? 'cancel' : req.params.scope === 'reschedule' ? 'reschedule' : null;
        if (!scope)
            return publicNotFound(res);
        const result = await store.getCapabilityBooking(String(req.params.token), scope);
        if (!result)
            return publicNotFound(res);
        const { policy, ...booking } = result;
        res.json({ success: true, booking, scope, policy });
    }
    catch {
        res.status(500).json({ success: false, error: 'Unable to load booking' });
    }
});
exports.schedulerRouter.post('/public/scheduler/v1/actions/cancel/:token', bookingLimiter, publicBoundary, async (req, res) => {
    try {
        const booking = await store.cancelBookingByToken(String(req.params.token), req.body?.reason);
        if (!booking)
            return publicNotFound(res);
        res.json({ success: true, booking });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (/not found/i.test(message))
            return publicNotFound(res);
        if (/reason is required|reason must be/i.test(message))
            return res.status(400).json({ success: false, error: message });
        if (/window has closed/i.test(message))
            return res.status(409).json({ success: false, error: message });
        res.status(500).json({ success: false, error: 'Unable to cancel booking' });
    }
});
exports.schedulerRouter.post('/public/scheduler/v1/actions/reschedule/:token', bookingLimiter, publicBoundary, async (req, res) => {
    try {
        const booking = await store.rescheduleBookingByToken(String(req.params.token), new Date(req.body?.start), req.body?.reason);
        if (!booking)
            return publicNotFound(res);
        res.json({ success: true, booking });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to reschedule booking';
        if (/no longer available|enough capacity|slot definition/i.test(message)) {
            return res.status(409).json({ success: false, error: 'The selected time is no longer available' });
        }
        if (/valid new start|reason is required|reason must be/i.test(message))
            return res.status(400).json({ success: false, error: message });
        if (/window has closed/i.test(message))
            return res.status(409).json({ success: false, error: message });
        res.status(500).json({ success: false, error: 'Unable to reschedule booking' });
    }
});
//# sourceMappingURL=router.js.map