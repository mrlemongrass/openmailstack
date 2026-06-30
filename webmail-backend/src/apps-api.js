"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appsApiRouter = void 0;
const express_1 = require("express");
const db_1 = require("./db");
const auth_1 = require("./auth");
const calendar_utils_1 = require("./calendar-utils");
const contact_utils_1 = require("./contact-utils");
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
    const { name, email, phone, vcard_data, emails_json, phones_json, addresses_json, job_title, organization, notes, labels_json, photo_url } = req.body;
    try {
        const davUid = `contact-${Date.now()}`;
        const newVcardData = vcard_data || (0, contact_utils_1.patchVCardData)('', davUid, {
            name, email, phone, emails_json, phones_json, job_title, organization, notes
        });
        const [result] = await db_1.pool.query(`INSERT INTO contacts 
            (username, name, email, phone, vcard_data, dav_uid, emails_json, phones_json, addresses_json, job_title, organization, notes, labels_json, photo_url, sync_token) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`, [
            user,
            name || '',
            email || '',
            phone || '',
            newVcardData,
            davUid,
            emails_json ? JSON.stringify(emails_json) : null,
            phones_json ? JSON.stringify(phones_json) : null,
            addresses_json ? JSON.stringify(addresses_json) : null,
            job_title || null,
            organization || null,
            notes || null,
            labels_json ? JSON.stringify(labels_json) : null,
            photo_url || null
        ]);
        res.json({ success: true, id: result.insertId });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.put('/contacts/:id', async (req, res) => {
    const user = req.username;
    const { name, email, phone, vcard_data, emails_json, phones_json, addresses_json, job_title, organization, notes, labels_json, photo_url } = req.body;
    try {
        const [existing] = await db_1.pool.query('SELECT * FROM contacts WHERE id=? AND username=?', [req.params.id, user]);
        if (existing.length === 0)
            return res.status(404).json({ success: false, error: 'Contact not found' });
        const existingContact = existing[0];
        let newVcardData = vcard_data;
        if (typeof vcard_data !== 'string') {
            newVcardData = (0, contact_utils_1.patchVCardData)(existingContact.vcard_data || '', existingContact.dav_uid || `contact-${existingContact.id}`, {
                name, email, phone, emails_json, phones_json, job_title, organization, notes
            });
        }
        const queryParams = [
            name || '',
            email || '',
            phone || '',
            newVcardData || '',
            emails_json ? JSON.stringify(emails_json) : null,
            phones_json ? JSON.stringify(phones_json) : null,
            addresses_json ? JSON.stringify(addresses_json) : null,
            job_title || null,
            organization || null,
            notes || null,
            labels_json ? JSON.stringify(labels_json) : null,
        ];
        let updateSql = `UPDATE contacts SET name=?, email=?, phone=?, vcard_data=?, emails_json=?, phones_json=?, addresses_json=?, job_title=?, organization=?, notes=?, labels_json=?, sync_token = sync_token + 1`;
        if (photo_url !== undefined) {
            updateSql += `, photo_url=?`;
            queryParams.push(photo_url || null);
        }
        updateSql += ` WHERE id=? AND username=?`;
        queryParams.push(req.params.id, user);
        await db_1.pool.query(updateSql, queryParams);
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
exports.appsApiRouter.get('/contacts-export', async (req, res) => {
    const user = req.username;
    const format = req.query.format || 'vcard';
    try {
        const [rows] = await db_1.pool.query('SELECT * FROM contacts WHERE username = ?', [user]);
        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
            let csv = 'Name,Email,Phone,Job Title,Organization,Notes\n';
            for (const row of rows) {
                const escapeCsv = (str) => `"${(str || '').replace(/"/g, '""')}"`;
                csv += `${escapeCsv(row.name)},${escapeCsv(row.email)},${escapeCsv(row.phone)},${escapeCsv(row.job_title)},${escapeCsv(row.organization)},${escapeCsv(row.notes)}\n`;
            }
            res.send(csv);
        }
        else {
            res.setHeader('Content-Type', 'text/vcard');
            res.setHeader('Content-Disposition', 'attachment; filename="contacts.vcf"');
            let vcards = '';
            for (const row of rows) {
                vcards += (0, contact_utils_1.normalizeVCardData)(row.vcard_data || '', (0, contact_utils_1.getContactDavUid)(row), { name: row.name, email: row.email, phone: row.phone });
            }
            res.send(vcards);
        }
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/contacts-import', async (req, res) => {
    const user = req.username;
    const { data, format } = req.body;
    if (!data)
        return res.status(400).json({ success: false, error: 'No data provided' });
    try {
        let imported = 0;
        if (format === 'csv') {
            const lines = data.split('\n');
            const headers = lines[0].toLowerCase().split(',').map((h) => h.trim().replace(/"/g, ''));
            const nameIdx = headers.findIndex((h) => h.includes('name'));
            const emailIdx = headers.findIndex((h) => h.includes('email'));
            const phoneIdx = headers.findIndex((h) => h.includes('phone'));
            for (let i = 1; i < lines.length; i++) {
                if (!lines[i].trim())
                    continue;
                // Simple CSV split handling quotes correctly is hard without a library, but let's do a basic split for now
                // This is a naive regex that splits by comma ignoring commas inside quotes
                const match = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
                if (!match)
                    continue;
                const cols = match.map((c) => c.replace(/^"|"$/g, '').trim());
                const name = nameIdx >= 0 ? cols[nameIdx] || '' : '';
                const email = emailIdx >= 0 ? cols[emailIdx] || '' : '';
                const phone = phoneIdx >= 0 ? cols[phoneIdx] || '' : '';
                const jobTitleIdx = headers.findIndex((h) => h.includes('job'));
                const orgIdx = headers.findIndex((h) => h.includes('organization'));
                const notesIdx = headers.findIndex((h) => h.includes('notes'));
                const jobTitle = jobTitleIdx >= 0 ? cols[jobTitleIdx] || '' : '';
                const organization = orgIdx >= 0 ? cols[orgIdx] || '' : '';
                const notes = notesIdx >= 0 ? cols[notesIdx] || '' : '';
                if (name || email) {
                    await db_1.pool.query('INSERT INTO contacts (username, name, email, phone, job_title, organization, notes) VALUES (?, ?, ?, ?, ?, ?, ?)', [user, name, email, phone, jobTitle, organization, notes]);
                    imported++;
                }
            }
        }
        else {
            // vCard import
            const vcards = data.split(/(?=BEGIN:VCARD)/i);
            for (const vcard of vcards) {
                if (!vcard.trim().toUpperCase().startsWith('BEGIN:VCARD'))
                    continue;
                const parsed = (0, contact_utils_1.parseVCard)(vcard);
                if (parsed.name || parsed.email) {
                    const emailsJson = (parsed.emails && parsed.emails.length > 0) ? JSON.stringify(parsed.emails.map((e) => ({ value: e, label: 'Other' }))) : null;
                    const phonesJson = (parsed.phones && parsed.phones.length > 0) ? JSON.stringify(parsed.phones.map((p) => ({ value: p, label: 'Other' }))) : null;
                    await db_1.pool.query('INSERT INTO contacts (username, name, email, phone, job_title, organization, notes, emails_json, phones_json, vcard_data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [user, parsed.name || '', parsed.email || '', parsed.phone || '', parsed.title || '', parsed.organization || '', parsed.note || '', emailsJson, phonesJson, vcard]);
                    imported++;
                }
            }
        }
        res.json({ success: true, count: imported });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.get('/contacts-duplicates', async (req, res) => {
    const user = req.username;
    try {
        const [rows] = await db_1.pool.query('SELECT * FROM contacts WHERE username = ?', [user]);
        const duplicates = [];
        const seen = new Set();
        for (let i = 0; i < rows.length; i++) {
            if (seen.has(rows[i].id))
                continue;
            const matches = [rows[i]];
            for (let j = i + 1; j < rows.length; j++) {
                if (seen.has(rows[j].id))
                    continue;
                let isMatch = false;
                const c1 = rows[i];
                const c2 = rows[j];
                if (c1.email && c1.email.toLowerCase() === c2.email?.toLowerCase())
                    isMatch = true;
                else if (c1.phone && c1.phone === c2.phone)
                    isMatch = true;
                else if (c1.name && c1.name.toLowerCase() === c2.name?.toLowerCase())
                    isMatch = true;
                if (isMatch) {
                    matches.push(c2);
                    seen.add(c2.id);
                }
            }
            if (matches.length > 1) {
                duplicates.push(matches);
            }
            seen.add(rows[i].id);
        }
        res.json({ success: true, duplicates });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/contacts-merge', async (req, res) => {
    const user = req.username;
    const { primaryId, duplicateIds } = req.body;
    if (!primaryId || !duplicateIds || !Array.isArray(duplicateIds) || duplicateIds.length === 0) {
        return res.status(400).json({ success: false, error: 'Invalid input' });
    }
    try {
        const [primaryRows] = await db_1.pool.query('SELECT * FROM contacts WHERE id=? AND username=?', [primaryId, user]);
        if (primaryRows.length === 0)
            return res.status(404).json({ success: false, error: 'Primary contact not found' });
        const primary = primaryRows[0];
        const [dupRows] = await db_1.pool.query('SELECT * FROM contacts WHERE id IN (?) AND username=?', [duplicateIds, user]);
        if (dupRows.length === 0)
            return res.json({ success: true });
        let emails = primary.emails_json ? (typeof primary.emails_json === 'string' ? JSON.parse(primary.emails_json) : primary.emails_json) : [];
        let phones = primary.phones_json ? (typeof primary.phones_json === 'string' ? JSON.parse(primary.phones_json) : primary.phones_json) : [];
        let addresses = primary.addresses_json ? (typeof primary.addresses_json === 'string' ? JSON.parse(primary.addresses_json) : primary.addresses_json) : [];
        let labels = primary.labels_json ? (typeof primary.labels_json === 'string' ? JSON.parse(primary.labels_json) : primary.labels_json) : [];
        let { name, email, phone, job_title, organization, notes } = primary;
        let photo_url = primary.photo_url;
        for (const dup of dupRows) {
            name = name || dup.name;
            email = email || dup.email;
            phone = phone || dup.phone;
            job_title = job_title || dup.job_title;
            organization = organization || dup.organization;
            photo_url = photo_url || dup.photo_url;
            notes = [notes, dup.notes].filter(Boolean).join('\n\n');
            const dEmails = dup.emails_json ? (typeof dup.emails_json === 'string' ? JSON.parse(dup.emails_json) : dup.emails_json) : [];
            const dPhones = dup.phones_json ? (typeof dup.phones_json === 'string' ? JSON.parse(dup.phones_json) : dup.phones_json) : [];
            const dAddresses = dup.addresses_json ? (typeof dup.addresses_json === 'string' ? JSON.parse(dup.addresses_json) : dup.addresses_json) : [];
            const dLabels = dup.labels_json ? (typeof dup.labels_json === 'string' ? JSON.parse(dup.labels_json) : dup.labels_json) : [];
            emails = [...emails, ...dEmails];
            phones = [...phones, ...dPhones];
            addresses = [...addresses, ...dAddresses];
            labels = [...labels, ...dLabels];
        }
        const uniqueByValue = (arr) => Array.from(new Map(arr.map(item => [item.value, item])).values());
        emails = uniqueByValue(emails);
        phones = uniqueByValue(phones);
        addresses = uniqueByValue(addresses);
        labels = Array.from(new Set(labels));
        const newVcardData = (0, contact_utils_1.patchVCardData)(primary.vcard_data || '', primary.dav_uid || `contact-${primary.id}`, {
            name, email, phone, emails_json: emails, phones_json: phones, job_title, organization, notes
        });
        await db_1.pool.query(`UPDATE contacts SET name=?, email=?, phone=?, job_title=?, organization=?, notes=?, emails_json=?, phones_json=?, addresses_json=?, labels_json=?, vcard_data=?, photo_url=?, sync_token = sync_token + 1 WHERE id=? AND username=?`, [name, email, phone, job_title, organization, notes, JSON.stringify(emails), JSON.stringify(phones), JSON.stringify(addresses), JSON.stringify(labels), newVcardData, photo_url || null, primaryId, user]);
        await db_1.pool.query('DELETE FROM contacts WHERE id IN (?) AND username=?', [dupRows.map((d) => d.id), user]);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
// ==========================================
// CONTACT LABELS API
// ==========================================
exports.appsApiRouter.get('/contact-labels', async (req, res) => {
    const user = req.username;
    try {
        const [rows] = await db_1.pool.query('SELECT * FROM contact_labels WHERE username = ? ORDER BY name ASC', [user]);
        res.json({ success: true, labels: rows });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/contact-labels', async (req, res) => {
    const user = req.username;
    const { name, color } = req.body;
    try {
        const [result] = await db_1.pool.query('INSERT INTO contact_labels (username, name, color) VALUES (?, ?, ?)', [user, name || 'New Label', color || '#60a5fa']);
        res.json({ success: true, id: result.insertId });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.put('/contact-labels/:id', async (req, res) => {
    const user = req.username;
    const { name, color } = req.body;
    try {
        await db_1.pool.query('UPDATE contact_labels SET name=?, color=? WHERE id=? AND username=?', [name, color, req.params.id, user]);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.delete('/contact-labels/:id', async (req, res) => {
    const user = req.username;
    try {
        await db_1.pool.query('DELETE FROM contact_labels WHERE id=? AND username=?', [req.params.id, user]);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
// ==========================================
// CONTACT GROUPS API
// ==========================================
exports.appsApiRouter.get('/contact-groups', async (req, res) => {
    const user = req.username;
    try {
        const [groups] = await db_1.pool.query(`SELECT g.*, COUNT(m.contact_id) as member_count
             FROM contact_groups g LEFT JOIN contact_group_members m ON g.id = m.group_id
             WHERE g.username = ? GROUP BY g.id ORDER BY g.name`, [user]);
        res.json({ success: true, groups });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/contact-groups', async (req, res) => {
    const user = req.username;
    const { name, color } = req.body;
    if (!name || !name.trim())
        return res.status(400).json({ success: false, error: 'Group name is required' });
    try {
        const [result] = await db_1.pool.query('INSERT INTO contact_groups (username, name, color) VALUES (?, ?, ?)', [user, name.trim(), color || '#60a5fa']);
        res.json({ success: true, id: result.insertId });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.put('/contact-groups/:id', async (req, res) => {
    const user = req.username;
    const { name, color } = req.body;
    try {
        const [result] = await db_1.pool.query('UPDATE contact_groups SET name = COALESCE(?, name), color = COALESCE(?, color) WHERE id = ? AND username = ?', [name?.trim() || null, color || null, req.params.id, user]);
        if (result.affectedRows === 0)
            return res.status(404).json({ success: false, error: 'Group not found' });
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.delete('/contact-groups/:id', async (req, res) => {
    const user = req.username;
    try {
        await db_1.pool.query('DELETE FROM contact_group_members WHERE group_id = ?', [req.params.id]);
        const [result] = await db_1.pool.query('DELETE FROM contact_groups WHERE id = ? AND username = ?', [req.params.id, user]);
        if (result.affectedRows === 0)
            return res.status(404).json({ success: false, error: 'Group not found' });
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.get('/contact-groups/:id/members', async (req, res) => {
    const user = req.username;
    try {
        const [rows] = await db_1.pool.query(`SELECT m.contact_id, c.name, c.email FROM contact_group_members m
             JOIN contacts c ON c.id = m.contact_id
             JOIN contact_groups g ON g.id = m.group_id
             WHERE m.group_id = ? AND g.username = ?`, [req.params.id, user]);
        res.json({ success: true, members: rows });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/contact-groups/:id/members', async (req, res) => {
    const user = req.username;
    const { contactIds } = req.body;
    if (!Array.isArray(contactIds))
        return res.status(400).json({ success: false, error: 'contactIds array required' });
    try {
        const [group] = await db_1.pool.query('SELECT id FROM contact_groups WHERE id = ? AND username = ?', [req.params.id, user]);
        if (group.length === 0)
            return res.status(404).json({ success: false, error: 'Group not found' });
        let added = 0;
        for (const contactId of contactIds) {
            try {
                await db_1.pool.query('INSERT IGNORE INTO contact_group_members (group_id, contact_id) VALUES (?, ?)', [req.params.id, contactId]);
                added++;
            }
            catch { }
        }
        res.json({ success: true, added });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.delete('/contact-groups/:id/members/:contactId', async (req, res) => {
    const user = req.username;
    try {
        await db_1.pool.query(`DELETE m FROM contact_group_members m
             JOIN contact_groups g ON g.id = m.group_id
             WHERE m.group_id = ? AND m.contact_id = ? AND g.username = ?`, [req.params.id, req.params.contactId, user]);
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
// NOTES API
// ==========================================
const notes_utils_1 = require("./notes-utils");
const notes_imap_sync_1 = require("./notes-imap-sync");
exports.appsApiRouter.get('/notes', async (req, res) => {
    const user = req.username;
    const pass = req.user?.password;
    try {
        if (pass) {
            // Run IMAP sync in background (non-blocking) or foreground?
            // Let's await it so the response includes fresh notes.
            await (0, notes_imap_sync_1.syncNotesWithImap)(user, pass);
        }
        const rows = await (0, notes_utils_1.listNotes)(user);
        res.json({ success: true, notes: rows });
    }
    catch (e) {
        console.error("GET notes error", e);
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/notes', async (req, res) => {
    const user = req.username;
    const { title, content } = req.body;
    try {
        const saved = await (0, notes_utils_1.saveNote)({ title, content, owner: user });
        res.json({ success: true, id: saved.id });
    }
    catch (e) {
        console.error("POST notes error", e);
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.put('/notes/:id', async (req, res) => {
    const user = req.username;
    const { title, content, color, is_pinned, is_locked, folder, labels_json } = req.body;
    try {
        await (0, notes_utils_1.saveNote)({
            id: req.params.id,
            owner: user,
            title,
            content,
            color,
            is_pinned: is_pinned ? 1 : 0,
            is_locked: is_locked ? 1 : 0,
            folder,
            labels_json
        });
        res.json({ success: true });
    }
    catch (e) {
        console.error("PUT notes error", e);
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.delete('/notes/:id', async (req, res) => {
    const user = req.username;
    try {
        await (0, notes_utils_1.deleteNote)(req.params.id, user);
        res.json({ success: true });
    }
    catch (e) {
        console.error("DELETE notes error", e);
        res.status(500).json({ success: false, error: e.message });
    }
});
// ==========================================
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
            const expansionStart = new Date();
            expansionStart.setUTCFullYear(expansionStart.getUTCFullYear() - 1, 0, 1);
            expansionStart.setUTCHours(0, 0, 0, 0);
            const expansionEnd = new Date();
            expansionEnd.setUTCFullYear(expansionEnd.getUTCFullYear() + 2, 11, 31);
            expansionEnd.setUTCHours(23, 59, 59, 999);
            const parsedEvents = events.flatMap((ev) => {
                const parsed = (0, calendar_utils_1.parseIcalEvent)(ev.uid, ev.ical_data || '');
                const occurrences = parsed.recurrence
                    ? (0, calendar_utils_1.expandRecurringEvent)(parsed, expansionStart, expansionEnd)
                    : [parsed];
                return occurrences.map((occurrence) => ({
                    id: ev.uid,
                    occurrenceId: occurrence.occurrenceId,
                    calendarId: cal.id,
                    title: occurrence.title,
                    start: occurrence.start,
                    end: occurrence.end,
                    isAllDay: occurrence.isAllDay,
                    location: occurrence.location,
                    description: occurrence.description,
                    recurrence: occurrence.recurrence?.raw || '',
                    recurrenceLabel: occurrence.recurrenceLabel,
                    rawIcal: ev.ical_data || ''
                }));
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
    const { name, color, subscribed_url } = req.body;
    try {
        const calendar = await (0, calendar_utils_1.createCalendar)(user, name || 'New Calendar', { color, subscribed_url });
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
    const subscribed_url = typeof req.body.subscribed_url === 'string' ? req.body.subscribed_url.trim() : null;
    if (!name) {
        return res.status(400).json({ success: false, error: 'Calendar name is required' });
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
        return res.status(400).json({ success: false, error: 'Calendar color must be a #RRGGBB value' });
    }
    try {
        const [result] = await db_1.pool.query('UPDATE calendars SET name = ?, color = ?, subscribed_url = ?, sync_token = sync_token + 1 WHERE id = ? AND user_id = ?', [name, color, subscribed_url, req.params.id, user]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Calendar not found' });
        }
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.get('/calendars/:id/shares', async (req, res) => {
    const user = req.username;
    try {
        const [rows] = await db_1.pool.query('SELECT shared_with_user_id, permission FROM calendar_shares WHERE calendar_id = ? AND calendar_id IN (SELECT id FROM calendars WHERE user_id = ?)', [req.params.id, user]);
        res.json({ success: true, shares: rows });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.get('/calendars/:id/export', async (req, res) => {
    const user = req.username;
    try {
        const [calRows] = await db_1.pool.query('SELECT * FROM calendars WHERE id = ? AND user_id = ?', [req.params.id, user]);
        if (calRows.length === 0)
            return res.status(404).json({ success: false, error: 'Calendar not found' });
        const [events] = await db_1.pool.query('SELECT ical_data FROM events WHERE calendar_id = ?', [req.params.id]);
        let icsData = [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//OpenMailStack//WebCalendar//EN"
        ];
        for (const ev of events) {
            if (!ev.ical_data)
                continue;
            // Extract everything between BEGIN:VEVENT and END:VEVENT
            const match = ev.ical_data.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/i);
            if (match)
                icsData.push(match[0]);
        }
        icsData.push("END:VCALENDAR");
        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="calendar-${req.params.id}.ics"`);
        res.send(icsData.join('\r\n'));
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/calendars/:id/import', async (req, res) => {
    const user = req.username;
    const { ics_data } = req.body;
    try {
        const [calRows] = await db_1.pool.query('SELECT * FROM calendars WHERE id = ? AND user_id = ?', [req.params.id, user]);
        if (calRows.length === 0)
            return res.status(404).json({ success: false, error: 'Calendar not found' });
        const events = ics_data.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/gi) || [];
        let imported = 0;
        for (const ev of events) {
            const uidMatch = ev.match(/UID:(.+)/i);
            const uid = uidMatch ? uidMatch[1].trim() : `imported-${Math.random().toString(36).substring(2)}@openmailstack`;
            const icalLine = [
                "BEGIN:VCALENDAR",
                "VERSION:2.0",
                "PRODID:-//OpenMailStack//WebCalendar//EN",
                ev,
                "END:VCALENDAR"
            ].join('\r\n');
            await db_1.pool.query(`INSERT INTO events (calendar_id, uid, ical_data, sync_token) VALUES (?, ?, ?, 1)
                 ON DUPLICATE KEY UPDATE ical_data=?, sync_token=sync_token+1`, [req.params.id, uid, icalLine, icalLine]);
            imported++;
        }
        res.json({ success: true, count: imported });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/calendars/:id/shares', async (req, res) => {
    const user = req.username;
    const { email, permission = 'read' } = req.body;
    if (!email)
        return res.status(400).json({ success: false, error: 'email required' });
    try {
        const [calRows] = await db_1.pool.query('SELECT id FROM calendars WHERE id = ? AND user_id = ?', [req.params.id, user]);
        if (calRows.length === 0)
            return res.status(403).json({ success: false, error: 'Not authorized' });
        await db_1.pool.query('INSERT INTO calendar_shares (calendar_id, shared_with_user_id, permission) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE permission = VALUES(permission)', [req.params.id, email, permission]);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.delete('/calendars/:id/shares/:email', async (req, res) => {
    const user = req.username;
    const { email } = req.params;
    try {
        const [calRows] = await db_1.pool.query('SELECT id FROM calendars WHERE id = ? AND user_id = ?', [req.params.id, user]);
        if (calRows.length === 0 && email !== user)
            return res.status(403).json({ success: false, error: 'Not authorized' });
        await db_1.pool.query('DELETE FROM calendar_shares WHERE calendar_id = ? AND shared_with_user_id = ?', [req.params.id, email]);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.delete('/calendars/:id', async (req, res) => {
    const user = req.username;
    const calendarId = Number(req.params.id);
    if (!Number.isInteger(calendarId) || calendarId <= 0) {
        return res.status(400).json({ success: false, error: 'Invalid calendar id' });
    }
    try {
        const visibleCalendars = await (0, calendar_utils_1.getVisibleCalendars)(user);
        const calendar = visibleCalendars.find((cal) => cal.id === calendarId);
        if (!calendar) {
            return res.status(404).json({ success: false, error: 'Calendar not found' });
        }
        if (visibleCalendars.length <= 1) {
            return res.status(409).json({ success: false, error: 'You must keep at least one calendar' });
        }
        const connection = await db_1.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [eventRows] = await connection.query('SELECT COUNT(*) AS event_count FROM events WHERE calendar_id = ?', [calendarId]);
            const deletedEvents = Number(eventRows[0]?.event_count || 0);
            await connection.query('DELETE FROM events WHERE calendar_id = ?', [calendarId]);
            const [result] = await connection.query('DELETE FROM calendars WHERE id = ? AND user_id = ?', [calendarId, user]);
            if (result.affectedRows === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, error: 'Calendar not found' });
            }
            await connection.commit();
            res.json({ success: true, deletedEvents });
        }
        catch (e) {
            await connection.rollback();
            throw e;
        }
        finally {
            connection.release();
        }
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
        const [cals] = await db_1.pool.query(`
            SELECT c.id 
            FROM calendars c 
            LEFT JOIN calendar_shares cs ON cs.calendar_id = c.id AND cs.shared_with_user_id = ?
            WHERE c.id = ? AND (c.user_id = ? OR cs.permission = 'write')
        `, [user, calendar_id, user]);
        if (cals.length === 0)
            return res.status(403).json({ success: false, error: 'Unauthorized calendar' });
        await db_1.pool.query('INSERT INTO events (calendar_id, uid, ical_data) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE ical_data=?', [calendar_id, uid, ical_data, ical_data]);
        await db_1.pool.query('UPDATE calendars SET sync_token = sync_token + 1 WHERE id = ?', [calendar_id]);
        try {
            const { io } = require('./index');
            io.to(user).emit('calendar_updated', { calendarId: calendar_id });
        }
        catch (e) { }
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
        const [cals] = await db_1.pool.query(`
            SELECT c.id 
            FROM calendars c 
            LEFT JOIN calendar_shares cs ON cs.calendar_id = c.id AND cs.shared_with_user_id = ?
            WHERE c.id = ? AND (c.user_id = ? OR cs.permission = 'write')
        `, [user, calendar_id, user]);
        if (cals.length === 0)
            return res.status(403).json({ success: false, error: 'Unauthorized calendar' });
        const excludeDate = req.query.exclude;
        if (excludeDate) {
            const [events] = await db_1.pool.query('SELECT uid, ical_data FROM events WHERE calendar_id=? AND uid=?', [calendar_id, uid]);
            if (events.length === 0)
                return res.status(404).json({ success: false, error: 'Event not found' });
            let icalData = events[0].ical_data || '';
            const excludeDateClean = excludeDate.replace(/[-:]/g, '').split('.')[0];
            if (icalData.includes('EXDATE:')) {
                icalData = icalData.replace(/(EXDATE:.*)/, `$1,${excludeDateClean}Z`);
            }
            else {
                icalData = icalData.replace(/(END:VEVENT)/, `EXDATE:${excludeDateClean}Z\r\n$1`);
            }
            await db_1.pool.query('UPDATE events SET ical_data = ? WHERE calendar_id=? AND uid=?', [icalData, calendar_id, uid]);
        }
        else {
            await db_1.pool.query('DELETE FROM events WHERE calendar_id=? AND uid=?', [calendar_id, uid]);
        }
        await db_1.pool.query('UPDATE calendars SET sync_token = sync_token + 1 WHERE id = ?', [calendar_id]);
        try {
            const { io } = require('./index');
            io.to(user).emit('calendar_updated', { calendarId: calendar_id });
        }
        catch (e) { }
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
//# sourceMappingURL=apps-api.js.map