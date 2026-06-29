import { Router, Request, Response, NextFunction } from 'express';
import { pool } from './db';
import { requireSession } from './auth';
import { createCalendar, getVisibleCalendars, parseIcalEvent } from './calendar-utils';

export const appsApiRouter = Router();

// Middleware to protect routes and extract username
const authenticateApp = (req: Request, res: Response, next: NextFunction) => {
    requireSession(req, res, () => {
        (req as any).username = (req as any).user.username;
        next();
    });
};

appsApiRouter.use(authenticateApp);

// ==========================================
// CONTACTS API
// ==========================================
appsApiRouter.get('/contacts', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        const [rows] = await pool.query('SELECT * FROM contacts WHERE username = ?', [user]);
        res.json({ success: true, contacts: rows });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.post('/contacts', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { name, email, phone, vcard_data } = req.body;
    try {
        const [result]: any = await pool.query(
            'INSERT INTO contacts (username, name, email, phone, vcard_data) VALUES (?, ?, ?, ?, ?)',
            [user, name || '', email || '', phone || '', vcard_data || '']
        );
        res.json({ success: true, id: result.insertId });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.put('/contacts/:id', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { name, email, phone, vcard_data } = req.body;
    try {
        await pool.query(
            'UPDATE contacts SET name=?, email=?, phone=?, vcard_data=? WHERE id=? AND username=?',
            [name, email, phone, vcard_data, req.params.id, user]
        );
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.delete('/contacts/:id', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        await pool.query('DELETE FROM contacts WHERE id=? AND username=?', [req.params.id, user]);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// TASKS API
// ==========================================
appsApiRouter.get('/tasks', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        const [rows] = await pool.query('SELECT * FROM tasks WHERE username = ? ORDER BY created_at DESC', [user]);
        res.json({ success: true, tasks: rows });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.post('/tasks', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { title, description, due_date, completed } = req.body;
    try {
        const [result]: any = await pool.query(
            'INSERT INTO tasks (username, title, description, due_date, completed) VALUES (?, ?, ?, ?, ?)',
            [user, title, description || '', due_date || null, completed ? 1 : 0]
        );
        res.json({ success: true, id: result.insertId });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.put('/tasks/:id', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { title, description, due_date, completed } = req.body;
    try {
        await pool.query(
            'UPDATE tasks SET title=?, description=?, due_date=?, completed=? WHERE id=? AND username=?',
            [title, description, due_date, completed ? 1 : 0, req.params.id, user]
        );
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.delete('/tasks/:id', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        await pool.query('DELETE FROM tasks WHERE id=? AND username=?', [req.params.id, user]);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// NOTES API
// ==========================================
appsApiRouter.get('/notes', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        const [rows] = await pool.query('SELECT * FROM notes WHERE username = ? ORDER BY updated_at DESC', [user]);
        res.json({ success: true, notes: rows });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.post('/notes', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { title, content } = req.body;
    try {
        const [result]: any = await pool.query(
            'INSERT INTO notes (username, title, content) VALUES (?, ?, ?)',
            [user, title || 'Untitled', content || '']
        );
        res.json({ success: true, id: result.insertId });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.put('/notes/:id', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { title, content } = req.body;
    try {
        await pool.query(
            'UPDATE notes SET title=?, content=? WHERE id=? AND username=?',
            [title, content, req.params.id, user]
        );
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.delete('/notes/:id', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        await pool.query('DELETE FROM notes WHERE id=? AND username=?', [req.params.id, user]);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// CALENDARS & EVENTS API
// ==========================================
appsApiRouter.get('/calendars', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        const calendars = await getVisibleCalendars(user);
        const result = [];
        for (const cal of calendars) {
            const [events]: any = await pool.query('SELECT * FROM events WHERE calendar_id = ?', [cal.id]);
            const parsedEvents = events.map((ev: any) => {
                const parsed = parseIcalEvent(ev.uid, ev.ical_data || '');

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
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.post('/calendars', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { name, color } = req.body;
    try {
        const calendar = await createCalendar(user, name || 'New Calendar', { color });
        res.json({ success: true, id: calendar.id });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.put('/calendars/:id', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const color = typeof req.body.color === 'string' ? req.body.color.trim() : '';

    if (!name) {
        return res.status(400).json({ success: false, error: 'Calendar name is required' });
    }

    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
        return res.status(400).json({ success: false, error: 'Calendar color must be a #RRGGBB value' });
    }

    try {
        const [result]: any = await pool.query(
            'UPDATE calendars SET name = ?, color = ?, sync_token = sync_token + 1 WHERE id = ? AND user_id = ?',
            [name, color, req.params.id, user]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Calendar not found' });
        }

        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.post('/events', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { calendar_id, uid, ical_data } = req.body;
    try {
        // verify calendar ownership
        const [cals]: any = await pool.query('SELECT id FROM calendars WHERE id=? AND user_id=?', [calendar_id, user]);
        if (cals.length === 0) return res.status(403).json({success: false, error: 'Unauthorized calendar'});

        await pool.query(
            'INSERT INTO events (calendar_id, uid, ical_data) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE ical_data=?',
            [calendar_id, uid, ical_data, ical_data]
        );
        await pool.query('UPDATE calendars SET sync_token = sync_token + 1 WHERE id = ?', [calendar_id]);

        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.delete('/events/:calendar_id/:uid', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { calendar_id, uid } = req.params;
    try {
        const [cals]: any = await pool.query('SELECT id FROM calendars WHERE id=? AND user_id=?', [calendar_id, user]);
        if (cals.length === 0) return res.status(403).json({success: false, error: 'Unauthorized calendar'});

        await pool.query('DELETE FROM events WHERE calendar_id=? AND uid=?', [calendar_id, uid]);
        await pool.query('UPDATE calendars SET sync_token = sync_token + 1 WHERE id = ?', [calendar_id]);

        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});
