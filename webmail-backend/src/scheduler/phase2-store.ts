import crypto from 'crypto';
import type { Pool } from 'mysql2/promise';
import { assertSchedulerGuestEligible, createSchedulerToken, schedulerTokenHash } from './phase1';
import { normalizeImportSource } from './phase2';
import { SchedulerStore } from './store';

const mysqlDate = (date: Date): string => date.toISOString().slice(0, 23).replace('T', ' ');
const utcDate = (value: string): Date => new Date(`${String(value).replace(' ', 'T')}Z`);
const csvCell = (value: unknown): string => {
    const text = String(value ?? '');
    const spreadsheetSafe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${spreadsheetSafe.replace(/"/g, '""')}"`;
};

export class SchedulerPhase2Store {
    constructor(private readonly pool: Pool, private readonly scheduler: SchedulerStore) {}

    async createPoll(username: string, input: any): Promise<any> {
        const entitlement = await this.scheduler.requireOwner(username);
        const event = await this.scheduler.getOwnedEventType(username, String(input.eventTypeId || ''));
        if (!event || event.systemManaged) throw new Error('Event type not found');
        if (event.visibility === 'private') throw new Error('Meeting polls require a listed or unlisted event type');
        const title = String(input.title || event.title).trim().slice(0, 160);
        if (!title) throw new Error('Poll title is required');
        const starts = Array.isArray(input.starts) ? [...new Set<string>(input.starts.map(String))].map(value => new Date(value)) : [];
        if (starts.length < 2 || starts.length > 10 || starts.some(start => !Number.isFinite(start.getTime()))) {
            throw new Error('Meeting polls require between 2 and 10 valid proposed times');
        }
        starts.sort((left, right) => left.getTime() - right.getTime());
        const available = await this.scheduler.listSlots(
            entitlement.handle, event.slug,
            new Date(starts[0].getTime() - 1),
            new Date(starts.at(-1)!.getTime() + event.durationMinutes * 60_000 + 1),
        );
        const availableStarts = new Set(available.map(slot => slot.start.getTime()));
        if (starts.some(start => !availableStarts.has(start.getTime()))) throw new Error('Every poll option must currently be an available time');
        const id = crypto.randomUUID();
        const token = createSchedulerToken();
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query(
                `INSERT INTO scheduler_meeting_polls (id,tenant_key,owner_username,event_type_id,title,token_hash)
                 VALUES (?,?,?,?,?,?)`,
                [id, entitlement.tenantKey, username, event.id, title, schedulerTokenHash(token)]
            );
            for (const [position, start] of starts.entries()) {
                await connection.query(
                    `INSERT INTO scheduler_poll_options (id,poll_id,slot_start,slot_end,position) VALUES (?,?,?,?,?)`,
                    [crypto.randomUUID(), id, mysqlDate(start), mysqlDate(new Date(start.getTime() + event.durationMinutes * 60_000)), position]
                );
            }
            await connection.query(
                `INSERT INTO scheduler_audit_events
                 (id,tenant_key,actor_type,actor_id,action,target_type,target_id,correlation_id,metadata)
                 VALUES (?,?,'user',?,'poll.create','poll',?,?,'{}')`,
                [crypto.randomUUID(), entitlement.tenantKey, username, id, crypto.randomUUID()]
            );
            await connection.commit();
        } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
        return { id, token, title, status: 'open', eventTypeId: event.id };
    }

    async listPolls(username: string): Promise<any[]> {
        await this.scheduler.requireOwner(username);
        const [rows]: any = await this.pool.query(
            `SELECT p.id,p.title,p.status,p.event_type_id,p.finalized_option_id,e.title AS event_title,
                    o.id AS option_id,CAST(o.slot_start AS CHAR) AS slot_start_utc,COUNT(v.id) AS votes
             FROM scheduler_meeting_polls p JOIN scheduler_event_types e ON e.id=p.event_type_id
             JOIN scheduler_poll_options o ON o.poll_id=p.id LEFT JOIN scheduler_poll_votes v ON v.option_id=o.id
             WHERE p.owner_username=? GROUP BY p.id,o.id ORDER BY p.created_at DESC,o.position`, [username]
        );
        const polls = new Map<string, any>();
        for (const row of rows) {
            const poll = polls.get(row.id) || { id: row.id, title: row.title, status: row.status, eventTypeId: row.event_type_id, eventTitle: row.event_title, finalizedOptionId: row.finalized_option_id, options: [] };
            poll.options.push({ id: row.option_id, start: utcDate(row.slot_start_utc), votes: Number(row.votes) });
            polls.set(row.id, poll);
        }
        return Array.from(polls.values());
    }

    async getPublicPoll(token: string): Promise<any | null> {
        const [rows]: any = await this.pool.query(
            `SELECT p.id,p.title,p.status,e.title AS event_title,e.require_email_verification,m.display_name,
                    o.id AS option_id,CAST(o.slot_start AS CHAR) AS slot_start_utc,CAST(o.slot_end AS CHAR) AS slot_end_utc,COUNT(v.id) AS votes
             FROM scheduler_meeting_polls p JOIN scheduler_event_types e ON e.id=p.event_type_id
             JOIN scheduler_mailbox_entitlements m ON m.username=p.owner_username
             JOIN scheduler_poll_options o ON o.poll_id=p.id LEFT JOIN scheduler_poll_votes v ON v.option_id=o.id
             WHERE p.token_hash=? AND m.enabled=1 AND m.published=1
             GROUP BY p.id,o.id ORDER BY o.position`, [schedulerTokenHash(token)]
        );
        if (!rows.length) return null;
        return {
            id: rows[0].id, title: rows[0].title, status: rows[0].status,
            eventTitle: rows[0].event_title, hostName: rows[0].display_name,
            requireEmailVerification: Number(rows[0].require_email_verification) === 1,
            options: rows.map((row: any) => ({ id: row.option_id, start: utcDate(row.slot_start_utc), end: utcDate(row.slot_end_utc), votes: Number(row.votes) })),
        };
    }

    async votePoll(token: string, input: any): Promise<void> {
        const poll = await this.getPublicPoll(token);
        if (!poll || poll.status !== 'open') throw new Error('Meeting poll is not available');
        const voterName = String(input.voterName || '').trim().slice(0, 160);
        const voterEmail = String(input.voterEmail || '').trim().toLowerCase();
        const optionIds = Array.isArray(input.optionIds) ? [...new Set(input.optionIds.map(String))] : [];
        if (!voterName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(voterEmail)) throw new Error('A valid name and email are required');
        if (!optionIds.length || optionIds.some(id => !poll.options.some((option: any) => option.id === id))) throw new Error('Choose at least one valid poll option');
        const [policyRows]: any = await this.pool.query(
            `SELECT p.event_type_id,e.guest_allow_list,e.guest_deny_list,e.require_email_verification
             FROM scheduler_meeting_polls p JOIN scheduler_event_types e ON e.id=p.event_type_id WHERE p.id=? LIMIT 1`, [poll.id]
        );
        const policy = policyRows[0];
        const rules = (value: unknown): string[] => { try { const parsed = JSON.parse(String(value || '[]')); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } };
        assertSchedulerGuestEligible(voterEmail, rules(policy.guest_allow_list), rules(policy.guest_deny_list));
        let verification: any = null;
        if (Number(policy.require_email_verification) === 1) {
            const challengeId = String(input.verificationChallengeId || '');
            const [verificationRows]: any = await this.pool.query(
                `SELECT * FROM scheduler_email_verifications WHERE id=? AND event_type_id=? AND booker_email=?
                 AND used_at IS NULL AND expires_at>UTC_TIMESTAMP(3) AND attempts<5 LIMIT 1`,
                [challengeId, policy.event_type_id, voterEmail]
            );
            verification = verificationRows[0];
            if (!verification || schedulerTokenHash(`${challengeId}:${String(input.verificationCode || '')}`) !== verification.code_hash) {
                if (verification) {
                    await this.pool.query(
                        'UPDATE scheduler_email_verifications SET attempts=attempts+1 WHERE id=? AND used_at IS NULL',
                        [verification.id]
                    );
                }
                throw new Error('A valid email verification code is required');
            }
        }
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            if (verification) {
                const [locked]: any = await connection.query(
                    `SELECT id FROM scheduler_email_verifications WHERE id=? AND used_at IS NULL
                     AND expires_at>UTC_TIMESTAMP(3) AND attempts<5 FOR UPDATE`, [verification.id]
                );
                if (!locked.length) throw new Error('A valid email verification code is required');
                await connection.query('UPDATE scheduler_email_verifications SET used_at=UTC_TIMESTAMP(3) WHERE id=?', [verification.id]);
            }
            await connection.query('DELETE FROM scheduler_poll_votes WHERE poll_id=? AND voter_email=?', [poll.id, voterEmail]);
            for (const optionId of optionIds) {
                await connection.query(
                    `INSERT INTO scheduler_poll_votes (id,poll_id,option_id,voter_name,voter_email) VALUES (?,?,?,?,?)`,
                    [crypto.randomUUID(), poll.id, optionId, voterName, voterEmail]
                );
            }
            await connection.commit();
        } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
    }

    async requestPollVerification(token: string, email: unknown): Promise<any> {
        const [rows]: any = await this.pool.query(
            `SELECT m.public_handle,e.slug FROM scheduler_meeting_polls p
             JOIN scheduler_event_types e ON e.id=p.event_type_id
             JOIN scheduler_mailbox_entitlements m ON m.username=p.owner_username
             WHERE p.token_hash=? AND p.status='open' LIMIT 1`, [schedulerTokenHash(token)]
        );
        if (!rows.length) throw new Error('Meeting poll is not available');
        return this.scheduler.requestEmailVerification(rows[0].public_handle, rows[0].slug, email);
    }

    async finalizePoll(username: string, pollId: string, optionId: string): Promise<any> {
        await this.scheduler.requireOwner(username);
        const [pollRows]: any = await this.pool.query(
            `SELECT p.*,e.capacity,e.max_additional_guests,m.public_handle,CAST(o.slot_start AS CHAR) AS slot_start_utc
             FROM scheduler_meeting_polls p JOIN scheduler_event_types e ON e.id=p.event_type_id
             JOIN scheduler_mailbox_entitlements m ON m.username=p.owner_username
             JOIN scheduler_poll_options o ON o.poll_id=p.id AND o.id=?
             WHERE p.id=? AND p.owner_username=? LIMIT 1`, [optionId, pollId, username]
        );
        const poll = pollRows[0];
        if (!poll) throw new Error('Meeting poll not found');
        const [lockResult]: any = await this.pool.query("UPDATE scheduler_meeting_polls SET status='closed' WHERE id=? AND status='open'", [pollId]);
        if (!lockResult.affectedRows) throw new Error('Meeting poll is already finalized or closed');
        try {
            const [voterRows]: any = await this.pool.query(
                `SELECT voter_name,voter_email FROM scheduler_poll_votes
                 WHERE poll_id=? AND option_id=? GROUP BY voter_email,voter_name ORDER BY MIN(created_at)`, [pollId, optionId]
            );
            const primary = voterRows[0] || { voter_name: username, voter_email: username };
            const additional = voterRows.slice(1, Number(poll.max_additional_guests || 0) + 1)
                .map((row: any) => ({ name: row.voter_name, email: row.voter_email }));
            const booking = await this.scheduler.bookOnBehalf(username, poll.event_type_id, {
                start: utcDate(poll.slot_start_utc), bookerTimeZone: 'UTC', bookerName: primary.voter_name,
                bookerEmail: primary.voter_email, attendees: additional, seats: additional.length + 1,
                idempotencyKey: `poll-finalize:${pollId}`,
            });
            await this.pool.query("UPDATE scheduler_meeting_polls SET status='finalized',finalized_option_id=? WHERE id=?", [optionId, pollId]);
            return booking;
        } catch (error) {
            await this.pool.query("UPDATE scheduler_meeting_polls SET status='open' WHERE id=? AND status='closed'", [pollId]);
            throw error;
        }
    }

    async exportOwnerData(username: string): Promise<any> {
        const entitlement = await this.scheduler.requireOwner(username);
        const [events, availability] = await Promise.all([
            this.scheduler.listEventTypes(username), this.scheduler.getDefaultAvailability(username),
        ]);
        return { schema: 'openmailstack.scheduler', version: 1, exportedAt: new Date().toISOString(), profile: entitlement, availability, events };
    }

    async exportBookingsCsv(username: string): Promise<string> {
        const bookings = await this.scheduler.listBookings(username, 'all');
        const header = ['id','status','event','start','end','booker_name','booker_email','seats','series_id','utm_source','utm_campaign'];
        return [header.map(csvCell).join(','), ...bookings.map((booking: any) => [
            booking.id, booking.status, booking.event.title, booking.start.toISOString(), booking.end.toISOString(),
            booking.bookerName, booking.bookerEmail, booking.seats, booking.seriesId || '', booking.attribution?.utm_source || '', booking.attribution?.utm_campaign || '',
        ].map(csvCell).join(','))].join('\r\n');
    }

    async importOwnerData(username: string, sourceValue: unknown, payload: any): Promise<any> {
        const source = normalizeImportSource(sourceValue);
        const entitlement = await this.scheduler.requireOwner(username);
        const rawEvents = source === 'openmailstack' ? payload?.events : source === 'calendly' ? payload?.event_types : payload?.eventTypes;
        if (!Array.isArray(rawEvents) || rawEvents.length > 100) throw new Error('Import must contain between 0 and 100 event types');
        let imported = 0;
        let skipped = 0;
        const errors: string[] = [];
        for (const [index, raw] of rawEvents.entries()) {
            try {
                const title = String(raw.title || raw.name || '').trim();
                const duration = Number(raw.durationMinutes || raw.duration || raw.length || 30);
                await this.scheduler.saveEventType(username, {
                    title, slug: String(raw.slug || title), description: String(raw.description || ''),
                    durationMinutes: duration, intervalMinutes: Number(raw.intervalMinutes || duration),
                    locationType: 'custom', locationLabel: String(raw.locationLabel || raw.location || ''),
                    destinationCalendarId: entitlement.defaultCalendarId, conflictCalendarIds: [], visibility: 'unlisted', active: false,
                });
                imported += 1;
            } catch (error) {
                skipped += 1;
                errors.push(`Item ${index + 1}: ${error instanceof Error ? error.message : 'invalid event'}`);
            }
        }
        const id = crypto.randomUUID();
        await this.pool.query(
            `INSERT INTO scheduler_import_runs (id,tenant_key,owner_username,source,imported_events,skipped_events) VALUES (?,?,?,?,?,?)`,
            [id, entitlement.tenantKey, username, source, imported, skipped]
        );
        return { id, source, imported, skipped, errors: errors.slice(0, 20) };
    }
}
