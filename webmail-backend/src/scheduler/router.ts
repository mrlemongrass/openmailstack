import { Router, type Request, type Response } from 'express';
import { pool } from '../db';
import { requireAdminSession, requireSession } from '../auth';
import { schedulerConfig } from '../config';
import { getVisibleCalendars } from '../calendar-utils';
import { rateLimit } from '../security';
import { SchedulerStore } from './store';
import { schedulerPublicUrl } from './phase1';

export const schedulerRouter = Router();
const store = new SchedulerStore(pool);

const authenticatedInstalled = (_req: Request, res: Response, next: () => void) => {
    if (!schedulerConfig.enabled) return res.status(403).json({ success: false, error: 'Scheduler is not installed' });
    next();
};

const requestHost = (req: Request): string => String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '');

export const schedulerHostAllowed = (host: string, allowedHosts = schedulerConfig.allowedHosts): boolean => (
    allowedHosts.includes(host.trim().toLowerCase().replace(/:\d+$/, ''))
);

const publicBoundary = (req: Request, res: Response, next: () => void) => {
    if (!schedulerConfig.enabled || !schedulerHostAllowed(requestHost(req))) {
        return res.status(404).json({ success: false, error: 'Not found' });
    }
    next();
};

const publicNotFound = (res: Response) => res.status(404).json({ success: false, error: 'Not found' });
const privateAccessToken = (req: Request): string => String(req.headers['x-scheduler-access'] || '').trim().slice(0, 128);
const ownerError = (res: Response, error: unknown) => {
    const message = error instanceof Error ? error.message : 'Scheduler request failed';
    const status = /not enabled/i.test(message) ? 403 : /not found/i.test(message) ? 404 : 400;
    return res.status(status).json({ success: false, error: message });
};

schedulerRouter.get('/scheduler/v1/status', authenticatedInstalled, requireSession, async (req: any, res) => {
    try {
        const entitlement = await store.getEntitlement(req.user.username);
        res.json({
            success: true,
            installed: true,
            enabled: Boolean(entitlement?.enabled),
            published: Boolean(entitlement?.published),
            entitlement,
            publicBaseUrl: schedulerConfig.publicBaseUrl,
        });
    } catch (error) {
        ownerError(res, error);
    }
});

schedulerRouter.get('/scheduler/v1/me', authenticatedInstalled, requireSession, async (req: any, res) => {
    try {
        const entitlement = await store.requireOwner(req.user.username);
        const [events, bookings, calendars, defaultAvailability, notificationIdentities] = await Promise.all([
            store.listEventTypes(req.user.username),
            store.listBookings(req.user.username, String(req.query.filter || 'upcoming')),
            getVisibleCalendars(req.user.username),
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
            publicBaseUrl: schedulerConfig.publicBaseUrl,
        });
    } catch (error) {
        ownerError(res, error);
    }
});

schedulerRouter.get('/scheduler/v1/availability/default', authenticatedInstalled, requireSession, async (req: any, res) => {
    try {
        res.json({ success: true, availability: await store.getDefaultAvailability(req.user.username) });
    } catch (error) {
        ownerError(res, error);
    }
});

schedulerRouter.put('/scheduler/v1/availability/default', authenticatedInstalled, requireSession, async (req: any, res) => {
    try {
        res.json({ success: true, availability: await store.saveDefaultAvailability(req.user.username, req.body || {}) });
    } catch (error) {
        ownerError(res, error);
    }
});

schedulerRouter.get('/scheduler/v1/availability/preview', authenticatedInstalled, requireSession, async (req: any, res) => {
    try {
        const start = new Date(String(req.query.start || ''));
        const end = new Date(String(req.query.end || ''));
        const preview = await store.previewDefaultAvailability(req.user.username, start, end);
        res.json({ success: true, ...preview });
    } catch (error) {
        ownerError(res, error);
    }
});

schedulerRouter.put('/scheduler/v1/profile', authenticatedInstalled, requireSession, async (req: any, res) => {
    try {
        const entitlement = await store.updateProfile(req.user.username, req.body || {});
        res.json({ success: true, entitlement });
    } catch (error) {
        ownerError(res, error);
    }
});

schedulerRouter.post('/scheduler/v1/event-types', authenticatedInstalled, requireSession, async (req: any, res) => {
    try {
        const event = await store.saveEventType(req.user.username, req.body || {});
        res.status(201).json({ success: true, event });
    } catch (error) {
        ownerError(res, error);
    }
});

schedulerRouter.put('/scheduler/v1/event-types/:id', authenticatedInstalled, requireSession, async (req: any, res) => {
    try {
        const event = await store.saveEventType(req.user.username, req.body || {}, req.params.id);
        res.json({ success: true, event });
    } catch (error) {
        ownerError(res, error);
    }
});

schedulerRouter.delete('/scheduler/v1/event-types/:id', authenticatedInstalled, requireSession, async (req: any, res) => {
    try {
        await store.deleteEventType(req.user.username, req.params.id);
        res.json({ success: true });
    } catch (error) {
        ownerError(res, error);
    }
});

schedulerRouter.get('/scheduler/v1/event-types/:id/private-link', authenticatedInstalled, requireSession, async (req: any, res) => {
    try {
        const privateLink = await store.getPrivateLinkState(req.user.username, req.params.id);
        res.set('Cache-Control', 'no-store').json({ success: true, privateLink });
    } catch (error) {
        ownerError(res, error);
    }
});

schedulerRouter.post('/scheduler/v1/event-types/:id/private-link', authenticatedInstalled, requireSession, async (req: any, res) => {
    try {
        const [rotated, entitlement, event] = await Promise.all([
            store.rotatePrivateLink(
                req.user.username,
                req.params.id,
                req.body?.expiresAt,
                req.body?.singleUse === true,
                req.body?.oneOffAvailability ?? null,
            ),
            store.requireOwner(req.user.username),
            store.getOwnedEventType(req.user.username, req.params.id),
        ]);
        if (!event) return ownerError(res, new Error('Event type not found'));
        const url = `${schedulerPublicUrl(schedulerConfig.publicBaseUrl, entitlement.handle, event.slug)}#access=${encodeURIComponent(rotated.token)}`;
        res.set('Cache-Control', 'no-store').status(201).json({ success: true, privateLink: rotated.state, url });
    } catch (error) {
        ownerError(res, error);
    }
});

schedulerRouter.delete('/scheduler/v1/event-types/:id/private-link', authenticatedInstalled, requireSession, async (req: any, res) => {
    try {
        await store.revokePrivateLink(req.user.username, req.params.id);
        res.set('Cache-Control', 'no-store').json({ success: true });
    } catch (error) {
        ownerError(res, error);
    }
});

schedulerRouter.get('/scheduler/v1/bookings', authenticatedInstalled, requireSession, async (req: any, res) => {
    try {
        const bookings = await store.listBookings(req.user.username, String(req.query.filter || 'upcoming'));
        res.json({ success: true, bookings });
    } catch (error) {
        ownerError(res, error);
    }
});

schedulerRouter.post('/scheduler/v1/bookings/:id/cancel', authenticatedInstalled, requireSession, async (req: any, res) => {
    try {
        await store.cancelOwnedBooking(req.user.username, req.params.id);
        res.json({ success: true });
    } catch (error) {
        ownerError(res, error);
    }
});

schedulerRouter.get('/admin/scheduler/v1/mailboxes', authenticatedInstalled, requireSession, requireAdminSession, async (_req, res) => {
    try {
        const mailboxes = await store.listAdminMailboxes();
        res.json({ success: true, installed: true, publicBaseUrl: schedulerConfig.publicBaseUrl, allowedHosts: schedulerConfig.allowedHosts, mailboxes });
    } catch (error) {
        ownerError(res, error);
    }
});

schedulerRouter.put('/admin/scheduler/v1/mailboxes/:username', authenticatedInstalled, requireSession, requireAdminSession, async (req: any, res) => {
    try {
        const entitlement = await store.setEntitlement(req.params.username, req.user.username, req.body || {});
        res.json({ success: true, entitlement });
    } catch (error) {
        ownerError(res, error);
    }
});

const publicLimiter = rateLimit(60 * 1000, 120);
const bookingLimiter = rateLimit(15 * 60 * 1000, 20);

schedulerRouter.get('/public/scheduler/v1/profiles/:handle', publicLimiter, publicBoundary, async (req, res) => {
    try {
        const profile = await store.getPublicProfile(String(req.params.handle));
        if (!profile) return publicNotFound(res);
        res.json({ success: true, profile: profile.entitlement, events: profile.events, defaultEvent: profile.defaultEvent });
    } catch {
        publicNotFound(res);
    }
});

schedulerRouter.get('/public/scheduler/v1/profiles/:handle/events/:slug', publicLimiter, publicBoundary, async (req, res) => {
    try {
        const accessToken = privateAccessToken(req);
        const result = await store.getPublicEvent(String(req.params.handle), String(req.params.slug), accessToken);
        if (!result) return publicNotFound(res);
        if (accessToken) res.set('Cache-Control', 'no-store');
        res.json({ success: true, profile: result.entitlement, event: result.event });
    } catch {
        publicNotFound(res);
    }
});

schedulerRouter.get('/public/scheduler/v1/profiles/:handle/events/:slug/slots', publicLimiter, publicBoundary, async (req, res) => {
    try {
        const start = new Date(String(req.query.start || ''));
        const end = new Date(String(req.query.end || ''));
        const accessToken = privateAccessToken(req);
        const slots = await store.listSlots(String(req.params.handle), String(req.params.slug), start, end, accessToken);
        if (accessToken) res.set('Cache-Control', 'no-store');
        res.json({ success: true, slots });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid availability request';
        if (/invalid availability range|cannot exceed 62 days/i.test(message)) {
            return res.status(400).json({ success: false, error: message });
        }
        res.status(500).json({ success: false, error: 'Unable to load availability' });
    }
});

schedulerRouter.post('/public/scheduler/v1/profiles/:handle/events/:slug/bookings', bookingLimiter, publicBoundary, async (req, res) => {
    try {
        const result = await store.createBooking(String(req.params.handle), String(req.params.slug), {
            eventTypeId: String(req.body?.eventTypeId || ''),
            start: new Date(req.body?.start),
            bookerTimeZone: String(req.body?.bookerTimeZone || ''),
            bookerName: String(req.body?.bookerName || ''),
            bookerEmail: String(req.body?.bookerEmail || ''),
            bookerNotes: String(req.body?.bookerNotes || ''),
            idempotencyKey: String(req.headers['idempotency-key'] || req.body?.idempotencyKey || ''),
            privateAccessToken: privateAccessToken(req),
        });
        res.status(result.idempotentReplay ? 200 : 201).json({ success: true, booking: result });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to create booking';
        if (/not found/i.test(message)) return publicNotFound(res);
        if (/no longer available|enough capacity|slot definition/i.test(message)) {
            return res.status(409).json({ success: false, error: 'The selected time is no longer available' });
        }
        if (/name is required|valid email|time zone|idempotency key|required|valid new start|already used for another booking/i.test(message)) {
            return res.status(400).json({ success: false, error: message });
        }
        res.status(500).json({ success: false, error: 'Unable to create booking' });
    }
});

schedulerRouter.get('/public/scheduler/v1/actions/:scope/:token', publicLimiter, publicBoundary, async (req, res) => {
    try {
        const scope = req.params.scope === 'cancel' ? 'cancel' : req.params.scope === 'reschedule' ? 'reschedule' : null;
        if (!scope) return publicNotFound(res);
        const booking = await store.getCapabilityBooking(String(req.params.token), scope);
        if (!booking) return publicNotFound(res);
        res.json({ success: true, booking, scope });
    } catch {
        res.status(500).json({ success: false, error: 'Unable to load booking' });
    }
});

schedulerRouter.post('/public/scheduler/v1/actions/cancel/:token', bookingLimiter, publicBoundary, async (req, res) => {
    try {
        const booking = await store.cancelBookingByToken(String(req.params.token));
        if (!booking) return publicNotFound(res);
        res.json({ success: true, booking });
    } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (/not found/i.test(message)) return publicNotFound(res);
        res.status(500).json({ success: false, error: 'Unable to cancel booking' });
    }
});

schedulerRouter.post('/public/scheduler/v1/actions/reschedule/:token', bookingLimiter, publicBoundary, async (req, res) => {
    try {
        const booking = await store.rescheduleBookingByToken(String(req.params.token), new Date(req.body?.start));
        if (!booking) return publicNotFound(res);
        res.json({ success: true, booking });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to reschedule booking';
        if (/no longer available|enough capacity|slot definition/i.test(message)) {
            return res.status(409).json({ success: false, error: 'The selected time is no longer available' });
        }
        if (/valid new start/i.test(message)) return res.status(400).json({ success: false, error: message });
        res.status(500).json({ success: false, error: 'Unable to reschedule booking' });
    }
});
