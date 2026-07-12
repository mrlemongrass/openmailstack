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
exports.schedulerRouter = (0, express_1.Router)();
const store = new store_1.SchedulerStore(db_1.pool);
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
        const [events, bookings, calendars, defaultAvailability, notificationIdentities] = await Promise.all([
            store.listEventTypes(req.user.username),
            store.listBookings(req.user.username, String(req.query.filter || 'upcoming')),
            (0, calendar_utils_1.getVisibleCalendars)(req.user.username),
            store.getDefaultAvailability(req.user.username),
            store.listNotificationIdentities(req.user.username),
        ]);
        res.json({
            success: true,
            entitlement,
            events,
            bookings,
            calendars: calendars.map((calendar) => ({ id: calendar.id, name: calendar.name, color: calendar.color })),
            defaultAvailability,
            notificationIdentities,
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
const publicLimiter = (0, security_1.rateLimit)(60 * 1000, 120);
const bookingLimiter = (0, security_1.rateLimit)(15 * 60 * 1000, 20);
const publicEventView = (event) => ({ ...event, guestAllowList: [], guestDenyList: [] });
exports.schedulerRouter.get('/public/scheduler/v1/profiles/:handle', publicLimiter, publicBoundary, async (req, res) => {
    try {
        const profile = await store.getPublicProfile(String(req.params.handle));
        if (!profile)
            return publicNotFound(res);
        res.json({
            success: true,
            profile: profile.entitlement,
            events: profile.events.map(publicEventView),
            defaultEvent: profile.defaultEvent ? publicEventView(profile.defaultEvent) : null,
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
        res.json({ success: true, profile: result.entitlement, event: publicEventView(result.event) });
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
        const slots = await store.listSlots(String(req.params.handle), String(req.params.slug), start, end, accessToken);
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
        const result = await store.createBooking(String(req.params.handle), String(req.params.slug), {
            eventTypeId: String(req.body?.eventTypeId || ''),
            start: new Date(req.body?.start),
            bookerTimeZone: String(req.body?.bookerTimeZone || ''),
            bookerName: String(req.body?.bookerName || ''),
            bookerEmail: String(req.body?.bookerEmail || ''),
            bookerNotes: String(req.body?.bookerNotes || ''),
            bookingAnswers: req.body?.bookingAnswers,
            attendees: req.body?.attendees,
            seats: req.body?.seats,
            verificationChallengeId: req.body?.verificationChallengeId,
            verificationCode: req.body?.verificationCode,
            idempotencyKey: String(req.headers['idempotency-key'] || req.body?.idempotencyKey || ''),
            privateAccessToken: privateAccessToken(req),
        });
        res.status(result.idempotentReplay ? 200 : 201).json({ success: true, booking: result });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to create booking';
        if (/not found/i.test(message))
            return publicNotFound(res);
        if (/no longer available|enough capacity|slot definition/i.test(message)) {
            return res.status(409).json({ success: false, error: 'The selected time is no longer available' });
        }
        if (/name is required|valid email|time zone|idempotency key|required|booking answers|invalid selection|too long|valid new start|already used for another booking|not eligible|additional guest|seats must/i.test(message)) {
            return res.status(400).json({ success: false, error: message });
        }
        if (/maximum active bookings/i.test(message)) {
            return res.status(409).json({ success: false, code: 'active_booking_limit', error: message });
        }
        res.status(500).json({ success: false, error: 'Unable to create booking' });
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