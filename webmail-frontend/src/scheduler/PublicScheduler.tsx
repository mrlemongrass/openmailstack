import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, CalendarCheck, CalendarClock, Check, Clock3, Download, Globe2, MapPin } from 'lucide-react';
import { ErrorBanner } from '../shared/components/ErrorBanner';
import {
  applyBookingAction,
  createPublicBooking,
  getBookingAction,
  getPublicEvent,
  getPublicProfile,
  getPublicSlots,
  type SchedulerEntitlement,
  type SchedulerEventType,
} from './api';
import './scheduler.css';

interface Slot { start: string; end: string }
interface ActionBooking { event: SchedulerEventType; handle: string; status: string; start: string; end: string }

const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const timeZones = (() => {
  try { return (Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }).supportedValuesOf?.('timeZone') || ['UTC']; }
  catch { return ['UTC']; }
})();
const dateLabel = (value: string, timeZone: string) => new Intl.DateTimeFormat([], { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(value));
const timeLabel = (value: string, timeZone: string) => new Intl.DateTimeFormat([], { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(value));
const consumePrivateAccessToken = (handle: string, slug: string) => {
  const storageKey = `oms-scheduler-private:${handle}:${slug}`;
  const fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get('access') || '';
  if (fragmentToken) {
    sessionStorage.setItem(storageKey, fragmentToken);
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`);
    return fragmentToken;
  }
  return sessionStorage.getItem(storageKey) || '';
};
const calendarDownload = (profile: SchedulerEntitlement, event: SchedulerEventType, slot: Slot) => {
  const compact = (value: string) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, character => `\\${character}`);
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenMailStack//Scheduler//EN', 'BEGIN:VEVENT', `UID:scheduler-${event.id}-${Date.parse(slot.start)}@openmailstack`, `DTSTAMP:${compact(new Date().toISOString())}`, `DTSTART:${compact(slot.start)}`, `DTEND:${compact(slot.end)}`, `SUMMARY:${escape(event.title)}`, `DESCRIPTION:${escape(`Scheduled with ${profile.displayName || profile.username}`)}`, 'STATUS:CONFIRMED', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
};

function PublicHeader() {
  return <header className="public-scheduler-header"><div><CalendarClock size={21} /><strong>Scheduler</strong></div><span>OpenMailStack</span></header>;
}

function EventDirectory({ profile, events }: { profile: SchedulerEntitlement; events: SchedulerEventType[] }) {
  return <div className="public-scheduler-page"><PublicHeader /><main className="public-profile">
    <section className="public-profile-intro"><div className="public-avatar">{(profile.displayName || profile.handle).slice(0, 1).toUpperCase()}</div><h1>{profile.displayName || profile.handle}</h1>{profile.welcomeMessage && <p>{profile.welcomeMessage}</p>}</section>
    {events.length === 0 ? <section className="public-empty-schedule"><CalendarClock size={30} /><h2>No meetings available right now</h2><p>This scheduling page is active, but no booking types are currently published. Please check back soon.</p></section> : <section className="public-event-directory">{events.map(event => <Link key={event.id} to={`/scheduler/${profile.handle}/${event.slug}`}><div><h2>{event.title}</h2><p>{event.description || event.locationLabel}</p><span><Clock3 size={14} /> {event.durationMinutes} min</span></div><CalendarClock size={20} /></Link>)}</section>}
  </main></div>;
}

function BookingEvent({ profile, event, rootDefault = false, accessToken = '' }: { profile: SchedulerEntitlement; event: SchedulerEventType; rootDefault?: boolean; accessToken?: string }) {
  const [timeZone, setTimeZone] = useState(browserTimeZone());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [form, setForm] = useState({ bookerName: '', bookerEmail: '', bookerNotes: '' });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirmed, setConfirmed] = useState<Slot | null>(null);
  const bookingAttemptKeyRef = useRef(crypto.randomUUID());
  const loadSlots = useCallback(async () => {
    const start = new Date();
    const end = new Date(start.getTime() + 62 * 24 * 60 * 60 * 1000);
    setLoading(true);
    try {
      const available = await getPublicSlots(profile.handle, event.slug, start, end, accessToken);
      setSlots(available);
      setSelected(current => current && available.some(slot => slot.start === current.start) ? current : null);
      setError('');
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to load times'); }
    finally { setLoading(false); }
  }, [accessToken, event.slug, profile.handle]);
  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void loadSlots(); }, 0);
    const refreshVisibleSlots = () => { if (document.visibilityState === 'visible') void loadSlots(); };
    window.addEventListener('focus', refreshVisibleSlots);
    document.addEventListener('visibilitychange', refreshVisibleSlots);
    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener('focus', refreshVisibleSlots);
      document.removeEventListener('visibilitychange', refreshVisibleSlots);
    };
  }, [loadSlots]);
  const grouped = useMemo(() => {
    const groups = new Map<string, Slot[]>();
    slots.forEach(slot => { const key = dateLabel(slot.start, timeZone); groups.set(key, [...(groups.get(key) || []), slot]); });
    return Array.from(groups.entries()).slice(0, 14);
  }, [slots, timeZone]);
  const submit = async (submitEvent: React.FormEvent) => {
    submitEvent.preventDefault(); if (!selected) return;
    setSubmitting(true); setError('');
    try {
      await createPublicBooking(profile.handle, event.slug, { eventTypeId: event.id, start: selected.start, bookerTimeZone: timeZone, ...form }, accessToken, bookingAttemptKeyRef.current);
      setSlots(current => current.filter(slot => slot.start !== selected.start));
      setConfirmed(selected);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to book this time'); await loadSlots(); }
    finally { setSubmitting(false); }
  };
  if (confirmed) return <div className="public-scheduler-page"><PublicHeader /><main className="booking-confirmation"><div className="confirmation-mark"><Check size={28} /></div><h1>You're booked</h1><p>{event.title} with {profile.displayName || profile.username}</p><dl><div><dt>Date</dt><dd>{dateLabel(confirmed.start, timeZone)}</dd></div><div><dt>Time</dt><dd>{timeLabel(confirmed.start, timeZone)} · {event.durationMinutes} min</dd></div><div><dt>Time zone</dt><dd>{timeZone}</dd></div></dl><a className="btn btn-secondary confirmation-download" href={calendarDownload(profile, event, confirmed)} download={`${event.slug || 'booking'}.ics`}><Download size={16} /> Download calendar file</a><p className="confirmation-email">A calendar invitation and management links are on their way to {form.bookerEmail}.</p></main></div>;
  return <div className="public-scheduler-page"><PublicHeader /><main className="public-booking-layout">
    <section className="public-event-summary">{!rootDefault && <Link to={`/scheduler/${profile.handle}`}><ArrowLeft size={16} /> {profile.displayName || profile.handle}</Link>}<h1>{event.title}</h1>{event.description && <p>{event.description}</p>}<ul><li><Clock3 size={16} /> {event.durationMinutes} minutes</li>{event.locationLabel && <li><MapPin size={16} /> {event.locationLabel}</li>}<li><Globe2 size={16} /> {timeZone}</li></ul></section>
    <section className="public-slot-picker"><div className="public-picker-heading"><h2>Select a time</h2><label><Globe2 size={15} /><select aria-label="Booking time zone" value={timeZone} onChange={e => setTimeZone(e.target.value)}>{!timeZones.includes(timeZone) && <option value={timeZone}>{timeZone}</option>}{timeZones.map(zone => <option value={zone} key={zone}>{zone.replaceAll('_', ' ')}</option>)}</select></label></div>
      {error && <ErrorBanner error={error} />}{loading ? <p className="public-muted">Loading available times...</p> : grouped.length === 0 ? <p className="public-muted">No available times in the next 62 days.</p> : <div className="public-slot-days">{grouped.map(([day, daySlots]) => <div key={day}><h3>{day}</h3><div>{daySlots.map(slot => <button className={selected?.start === slot.start ? 'selected' : ''} onClick={() => { if (selected?.start !== slot.start) bookingAttemptKeyRef.current = crypto.randomUUID(); setSelected(slot); }} key={slot.start}>{timeLabel(slot.start, timeZone)}</button>)}</div></div>)}</div>}
    </section>
    {selected && <form className="public-booking-form" onSubmit={submit}><h2>Your details</h2><p>{dateLabel(selected.start, timeZone)} at {timeLabel(selected.start, timeZone)}</p><label>Name<input required autoComplete="name" value={form.bookerName} onChange={e => setForm({ ...form, bookerName: e.target.value })} /></label><label>Email<input required type="email" autoComplete="email" value={form.bookerEmail} onChange={e => setForm({ ...form, bookerEmail: e.target.value })} /></label><label>Notes<textarea rows={3} value={form.bookerNotes} onChange={e => setForm({ ...form, bookerNotes: e.target.value })} /></label><button className="btn btn-primary" disabled={submitting}>{submitting ? 'Booking...' : 'Confirm booking'}</button></form>}
  </main></div>;
}

export function PublicSchedulerPage() {
  const { handle = '', slug } = useParams();
  const [data, setData] = useState<{ profile: SchedulerEntitlement; events?: SchedulerEventType[]; event?: SchedulerEventType; defaultEvent?: SchedulerEventType | null; accessToken?: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const token = slug ? consumePrivateAccessToken(handle, slug) : '';
    const load = slug ? getPublicEvent(handle, slug, token) : getPublicProfile(handle);
    load.then(result => setData({ ...result, accessToken: token })).catch(err => setError(err instanceof Error ? err.message : 'This scheduling page is unavailable'));
  }, [handle, slug]);
  if (error) return <div className="public-scheduler-page"><PublicHeader /><main className="public-not-found"><CalendarClock size={32} /><h1>Scheduling page unavailable</h1><p>The link may be incorrect or no longer published.</p></main></div>;
  if (!data) return <div className="public-scheduler-page"><PublicHeader /><main className="public-not-found">Loading...</main></div>;
  if (data.event) return <BookingEvent profile={data.profile} event={data.event} accessToken={data.accessToken} />;
  if (data.defaultEvent && (data.events?.length || 0) === 0) return <BookingEvent profile={data.profile} event={data.defaultEvent} rootDefault />;
  return <EventDirectory profile={data.profile} events={data.events || []} />;
}

export function SchedulerActionPage() {
  const { scope: rawScope, token = '' } = useParams();
  const scope = rawScope === 'reschedule' ? 'reschedule' : 'cancel';
  const [data, setData] = useState<{ booking: ActionBooking } | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const timeZone = browserTimeZone();
  useEffect(() => {
    getBookingAction(scope, token).then(result => {
      const booking = result.booking as unknown as ActionBooking;
      setData({ booking });
      if (scope === 'reschedule') {
        const start = new Date(); const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000);
        void getPublicSlots(booking.handle, booking.event.slug, start, end, token).then(setSlots);
      }
    }).catch(err => setError(err instanceof Error ? err.message : 'This management link is unavailable'));
  }, [scope, token]);
  const apply = async () => {
    setStatus(scope === 'cancel' ? 'Cancelling...' : 'Rescheduling...');
    try { await applyBookingAction(scope, token, selected?.start); setStatus(scope === 'cancel' ? 'Booking cancelled' : 'Booking rescheduled'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to update booking'); setStatus(''); }
  };
  return <div className="public-scheduler-page"><PublicHeader /><main className="scheduler-action-page">
    {error ? <ErrorBanner error={error} /> : !data ? <p>Loading...</p> : <><CalendarCheck size={30} /><h1>{scope === 'cancel' ? 'Cancel booking' : 'Choose a new time'}</h1><p>{data.booking.event.title}</p>
      {scope === 'reschedule' && <div className="action-slots">{slots.slice(0, 24).map(slot => <button className={selected?.start === slot.start ? 'selected' : ''} onClick={() => setSelected(slot)} key={slot.start}>{dateLabel(slot.start, timeZone)} · {timeLabel(slot.start, timeZone)}</button>)}</div>}
      <button className={`btn ${scope === 'cancel' ? 'btn-danger' : 'btn-primary'}`} disabled={Boolean(status) || (scope === 'reschedule' && !selected)} onClick={apply}>{status || (scope === 'cancel' ? 'Cancel booking' : 'Confirm new time')}</button></>}
  </main></div>;
}
