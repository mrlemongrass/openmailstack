"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appsApiRouter = void 0;
const express_1 = require("express");
const db_1 = require("./db");
const auth_1 = require("./auth");
const calendar_utils_1 = require("./calendar-utils");
exports.appsApiRouter = (0, express_1.Router)();
// Middleware to protect routes and extract username
const authenticateApp = (req, res, next) => {
    (0, auth_1.requireSession)(req, res, () => {
        req.username = req.user.username;
        next();
    });
};
exports.appsApiRouter.use(authenticateApp);
// ==========================================
// CONTACTS API
// ==========================================
exports.appsApiRouter.get('/contacts', async (req, res) => {
    const user = req.username;
    try {
        const [rows] = await db_1.pool.query('SELECT * FROM contacts WHERE username = ?', [user]);
        res.json({ success: true, contacts: rows });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/contacts', async (req, res) => {
    const user = req.username;
    const { name, email, phone, vcard_data } = req.body;
    try {
        const [result] = await db_1.pool.query('INSERT INTO contacts (username, name, email, phone, vcard_data) VALUES (?, ?, ?, ?, ?)', [user, name || '', email || '', phone || '', vcard_data || '']);
        res.json({ success: true, id: result.insertId });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.put('/contacts/:id', async (req, res) => {
    const user = req.username;
    const { name, email, phone, vcard_data } = req.body;
    try {
        await db_1.pool.query('UPDATE contacts SET name=?, email=?, phone=?, vcard_data=? WHERE id=? AND username=?', [name, email, phone, vcard_data, req.params.id, user]);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.delete('/contacts/:id', async (req, res) => {
    const user = req.username;
    try {
        await db_1.pool.query('DELETE FROM contacts WHERE id=? AND username=?', [req.params.id, user]);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
// ==========================================
// TASKS API
// ==========================================
exports.appsApiRouter.get('/tasks', async (req, res) => {
    const user = req.username;
    try {
        const [rows] = await db_1.pool.query('SELECT * FROM tasks WHERE username = ? ORDER BY created_at DESC', [user]);
        res.json({ success: true, tasks: rows });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/tasks', async (req, res) => {
    const user = req.username;
    const { title, description, due_date, completed } = req.body;
    try {
        const [result] = await db_1.pool.query('INSERT INTO tasks (username, title, description, due_date, completed) VALUES (?, ?, ?, ?, ?)', [user, title, description || '', due_date || null, completed ? 1 : 0]);
        res.json({ success: true, id: result.insertId });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.put('/tasks/:id', async (req, res) => {
    const user = req.username;
    const { title, description, due_date, completed } = req.body;
    try {
        await db_1.pool.query('UPDATE tasks SET title=?, description=?, due_date=?, completed=? WHERE id=? AND username=?', [title, description, due_date, completed ? 1 : 0, req.params.id, user]);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.delete('/tasks/:id', async (req, res) => {
    const user = req.username;
    try {
        await db_1.pool.query('DELETE FROM tasks WHERE id=? AND username=?', [req.params.id, user]);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
// ==========================================
// NOTES API
// ==========================================
exports.appsApiRouter.get('/notes', async (req, res) => {
    const user = req.username;
    try {
        const [rows] = await db_1.pool.query('SELECT * FROM notes WHERE username = ? ORDER BY updated_at DESC', [user]);
        res.json({ success: true, notes: rows });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/notes', async (req, res) => {
    const user = req.username;
    const { title, content } = req.body;
    try {
        const [result] = await db_1.pool.query('INSERT INTO notes (username, title, content) VALUES (?, ?, ?)', [user, title || 'Untitled', content || '']);
        res.json({ success: true, id: result.insertId });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.put('/notes/:id', async (req, res) => {
    const user = req.username;
    const { title, content } = req.body;
    try {
        await db_1.pool.query('UPDATE notes SET title=?, content=? WHERE id=? AND username=?', [title, content, req.params.id, user]);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.delete('/notes/:id', async (req, res) => {
    const user = req.username;
    try {
        await db_1.pool.query('DELETE FROM notes WHERE id=? AND username=?', [req.params.id, user]);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
// ==========================================
// CALENDARS & EVENTS API
// ==========================================
exports.appsApiRouter.get('/calendars', async (req, res) => {
    const user = req.username;
    try {
        const calendars = await (0, calendar_utils_1.getVisibleCalendars)(user);
        const result = [];
        for (const cal of calendars) {
            const [events] = await db_1.pool.query('SELECT * FROM events WHERE calendar_id = ?', [cal.id]);
            const parsedEvents = events.map((ev) => {
                const parsed = (0, calendar_utils_1.parseIcalEvent)(ev.uid, ev.ical_data || '');
                return {
                    id: ev.uid,
                    calendarId: cal.id,
                    title: parsed.title,
                    start: parsed.start,
                    end: parsed.end,
                    isAllDay: parsed.isAllDay,
                    location: parsed.location,
                    description: parsed.description,
                    rawIcal: ev.ical_data || ''
                };
            });
            result.push({
                ...cal,
                events: parsedEvents
            });
        }
        res.json({ success: true, calendars: result });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/calendars', async (req, res) => {
    const user = req.username;
    const { name, color } = req.body;
    try {
        const calendar = await (0, calendar_utils_1.createCalendar)(user, name || 'New Calendar', { color });
        res.json({ success: true, id: calendar.id });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.put('/calendars/:id', async (req, res) => {
    const user = req.username;
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const color = typeof req.body.color === 'string' ? req.body.color.trim() : '';
    if (!name) {
        return res.status(400).json({ success: false, error: 'Calendar name is required' });
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
        return res.status(400).json({ success: false, error: 'Calendar color must be a #RRGGBB value' });
    }
    try {
        const [result] = await db_1.pool.query('UPDATE calendars SET name = ?, color = ?, sync_token = sync_token + 1 WHERE id = ? AND user_id = ?', [name, color, req.params.id, user]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Calendar not found' });
        }
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/events', async (req, res) => {
    const user = req.username;
    const { calendar_id, uid, ical_data } = req.body;
    try {
        // verify calendar ownership
        const [cals] = await db_1.pool.query('SELECT id FROM calendars WHERE id=? AND user_id=?', [calendar_id, user]);
        if (cals.length === 0)
            return res.status(403).json({ success: false, error: 'Unauthorized calendar' });
        await db_1.pool.query('INSERT INTO events (calendar_id, uid, ical_data) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE ical_data=?', [calendar_id, uid, ical_data, ical_data]);
        await db_1.pool.query('UPDATE calendars SET sync_token = sync_token + 1 WHERE id = ?', [calendar_id]);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.delete('/events/:calendar_id/:uid', async (req, res) => {
    const user = req.username;
    const { calendar_id, uid } = req.params;
    try {
        const [cals] = await db_1.pool.query('SELECT id FROM calendars WHERE id=? AND user_id=?', [calendar_id, user]);
        if (cals.length === 0)
            return res.status(403).json({ success: false, error: 'Unauthorized calendar' });
        await db_1.pool.query('DELETE FROM events WHERE calendar_id=? AND uid=?', [calendar_id, uid]);
        await db_1.pool.query('UPDATE calendars SET sync_token = sync_token + 1 WHERE id = ?', [calendar_id]);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
//# sourceMappingURL=apps-api.js.map