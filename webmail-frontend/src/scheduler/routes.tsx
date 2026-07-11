import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, CalendarDays, Clock3, Copy, ExternalLink, Plus, Settings2, Trash2, X } from 'lucide-react';
import { EmptyState } from '../shared/components/EmptyState';
import { ErrorBanner } from '../shared/components/ErrorBanner';
import {
  cancelSchedulerBooking,
  deleteSchedulerEvent,
  getSchedulerState,
  saveSchedulerEvent,
  saveSchedulerProfile,
  type SchedulerEntitlement,
  type SchedulerEventType,
  type SchedulerState,
  type SchedulerWindow,
} from './api';
import './scheduler.css';

type SchedulerTab = 'events' | 'bookings' | 'availability' | 'profile';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DEFAULT_WINDOWS: SchedulerWindow[] = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1020 }));

const minutesToTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const timeToMinutes = (value: string) => {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
};

function EventEditor({ event, calendars, onClose, onSaved }: {
  event: Partial<SchedulerEventType> | null;
  calendars: SchedulerState['calendars'];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<SchedulerEventType>>({
    title: event?.title || '', slug: event?.slug || '', description: event?.description || '',
    durationMinutes: event?.durationMinutes || 30, intervalMinutes: event?.intervalMinutes || 30,
    minimumNoticeMinutes: event?.minimumNoticeMinutes ?? 60, bufferBeforeMinutes: event?.bufferBeforeMinutes || 0,
    bufferAfterMinutes: event?.bufferAfterMinutes || 0, capacity: event?.capacity || 1,
    locationType: event?.locationType || 'custom', locationLabel: event?.locationLabel || '',
    destinationCalendarId: event?.destinationCalendarId || calendars[0]?.id || null,
    conflictCalendarIds: event?.conflictCalendarIds?.length ? event.conflictCalendarIds : calendars.map(calendar => calendar.id),
    active: event?.active ?? true, windows: event?.windows?.length ? event.windows : DEFAULT_WINDOWS,
    id: event?.id,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggleWeekday = (weekday: number) => {
    const windows = form.windows || [];
    setForm({ ...form, windows: windows.some(window => window.weekday === weekday)
      ? windows.filter(window => window.weekday !== weekday)
      : [...windows, { weekday, startMinute: 540, endMinute: 1020 }].sort((a, b) => a.weekday - b.weekday) });
  };

  const updateWindow = (weekday: number, key: 'startMinute' | 'endMinute', value: number) => {
    setForm({ ...form, windows: (form.windows || []).map(window => window.weekday === weekday ? { ...window, [key]: value } : window) });
  };

  const submit = async (eventSubmit: React.FormEvent) => {
    eventSubmit.preventDefault();
    setSaving(true); setError('');
    try { await saveSchedulerEvent(form); onSaved(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to save event type'); }
    finally { setSaving(false); }
  };

  return (
    <div className="scheduler-modal-backdrop" onMouseDown={onClose}>
      <form className="scheduler-modal" onSubmit={submit} onMouseDown={eventMouse => eventMouse.stopPropagation()}>
        <header><div><h2>{form.id ? 'Edit event type' : 'New event type'}</h2><p>Individual booking link</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
        {error && <ErrorBanner error={error} />}
        <div className="scheduler-form-grid">
          <label className="span-2">Title<input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></label>
          <label>Link<input value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} placeholder="intro-call" /></label>
          <label>Duration<select value={form.durationMinutes} onChange={e => setForm({ ...form, durationMinutes: Number(e.target.value), intervalMinutes: Number(e.target.value) })}><option value={15}>15 minutes</option><option value={30}>30 minutes</option><option value={45}>45 minutes</option><option value={60}>60 minutes</option></select></label>
          <label className="span-2">Description<textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
          <label>Location<select value={form.locationType} onChange={e => setForm({ ...form, locationType: e.target.value as SchedulerEventType['locationType'] })}><option value="custom">Custom</option><option value="phone">Phone</option><option value="in_person">In person</option><option value="conference">Conference link</option></select></label>
          <label>Location details<input value={form.locationLabel} onChange={e => setForm({ ...form, locationLabel: e.target.value })} /></label>
          <label>Destination calendar<select value={form.destinationCalendarId || ''} onChange={e => setForm({ ...form, destinationCalendarId: Number(e.target.value) })}>{calendars.map(calendar => <option value={calendar.id} key={calendar.id}>{calendar.name}</option>)}</select></label>
          <label>Minimum notice<select value={form.minimumNoticeMinutes} onChange={e => setForm({ ...form, minimumNoticeMinutes: Number(e.target.value) })}><option value={0}>None</option><option value={60}>1 hour</option><option value={240}>4 hours</option><option value={1440}>1 day</option></select></label>
          <fieldset className="scheduler-calendar-checks span-2"><legend>Check conflicts on</legend>{calendars.map(calendar => <label key={calendar.id}><input type="checkbox" checked={form.conflictCalendarIds?.includes(calendar.id) ?? false} onChange={e => setForm({ ...form, conflictCalendarIds: e.target.checked ? [...(form.conflictCalendarIds || []), calendar.id] : (form.conflictCalendarIds || []).filter(id => id !== calendar.id) })} /><span>{calendar.name}</span></label>)}</fieldset>
        </div>
        <section className="scheduler-window-editor">
          <h3>Weekly availability</h3>
          {WEEKDAYS.map((day, weekday) => {
            const window = form.windows?.find(candidate => candidate.weekday === weekday);
            return <div className="scheduler-window-row" key={day}>
              <label className="weekday-toggle"><input type="checkbox" checked={Boolean(window)} onChange={() => toggleWeekday(weekday)} /><span>{day}</span></label>
              {window ? <><input aria-label={`${day} start`} type="time" value={minutesToTime(window.startMinute)} onChange={e => updateWindow(weekday, 'startMinute', timeToMinutes(e.target.value))} /><span>to</span><input aria-label={`${day} end`} type="time" value={minutesToTime(window.endMinute)} onChange={e => updateWindow(weekday, 'endMinute', timeToMinutes(e.target.value))} /></> : <span className="unavailable">Unavailable</span>}
            </div>;
          })}
        </section>
        <footer><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save event type'}</button></footer>
      </form>
    </div>
  );
}

function ProfilePanel({ state, onSaved }: { state: SchedulerState; onSaved: () => void }) {
  const [profile, setProfile] = useState<Partial<SchedulerEntitlement>>(state.entitlement);
  const [status, setStatus] = useState('');
  const publicUrl = `${state.publicBaseUrl}/scheduler/${state.entitlement.handle}`;
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setStatus('Saving...');
    try { await saveSchedulerProfile(profile); setStatus('Saved'); onSaved(); }
    catch (err) { setStatus(err instanceof Error ? err.message : 'Save failed'); }
  };
  return <form className="scheduler-settings" onSubmit={save}>
    <div className="scheduler-section-title"><div><h2>Public profile</h2><p>{publicUrl}</p></div><a className="btn btn-secondary" href={publicUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Preview</a></div>
    <div className="scheduler-form-grid">
      <label>Display name<input value={profile.displayName || ''} onChange={e => setProfile({ ...profile, displayName: e.target.value })} /></label>
      <label>Time zone<input value={profile.timeZone || ''} onChange={e => setProfile({ ...profile, timeZone: e.target.value })} /></label>
      <label className="span-2">Welcome message<textarea rows={4} value={profile.welcomeMessage || ''} onChange={e => setProfile({ ...profile, welcomeMessage: e.target.value })} /></label>
      <label className="scheduler-publish span-2"><input type="checkbox" checked={profile.published !== false} onChange={e => setProfile({ ...profile, published: e.target.checked })} /><span>Publish profile</span></label>
    </div>
    <div className="scheduler-actions"><span>{status}</span><button className="btn btn-primary">Save profile</button></div>
  </form>;
}

export function SchedulerRoutes() {
  const [tab, setTab] = useState<SchedulerTab>('events');
  const [state, setState] = useState<SchedulerState | null>(null);
  const [filter, setFilter] = useState('upcoming');
  const [editor, setEditor] = useState<Partial<SchedulerEventType> | null | undefined>(undefined);
  const [selectedBooking, setSelectedBooking] = useState<SchedulerState['bookings'][number] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try { setState(await getSchedulerState(filter)); setError(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to load Scheduler'); }
    finally { setLoading(false); }
  }, [filter]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (loading) return <div className="scheduler-loading">Loading Scheduler...</div>;
  if (!state) return <div className="scheduler-loading"><ErrorBanner error={error || 'Scheduler is unavailable'} /></div>;

  const tabs: Array<{ id: SchedulerTab; label: string; icon: React.ElementType }> = [
    { id: 'events', label: 'Event Types', icon: CalendarClock },
    { id: 'bookings', label: 'Bookings', icon: CalendarDays },
    { id: 'availability', label: 'Availability', icon: Clock3 },
    { id: 'profile', label: 'Profile', icon: Settings2 },
  ];
  return <div className="scheduler-app">
    <aside className="scheduler-sidebar"><div className="scheduler-app-title"><CalendarClock size={21} /><strong>Scheduler</strong></div><nav>{tabs.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><item.icon size={17} />{item.label}</button>)}</nav></aside>
    <main className="scheduler-main">
      {error && <ErrorBanner error={error} />}
      {tab === 'events' && <>
        <div className="scheduler-section-title"><div><h1>Event Types</h1><p>{state.events.length} booking {state.events.length === 1 ? 'link' : 'links'}</p></div><button className="btn btn-primary" onClick={() => setEditor(null)}><Plus size={16} /> New event</button></div>
        {state.events.length === 0 ? <EmptyState icon={CalendarClock} title="No event types" action={{ label: 'Create event type', onClick: () => setEditor(null) }} /> : <div className="scheduler-event-list">{state.events.map(event => <article key={event.id}>
          <div className="scheduler-event-accent" /><div className="scheduler-event-copy"><div><h3>{event.title}</h3><p>{event.durationMinutes} min · {event.locationLabel || 'Location set when booking'}</p></div><code>/{state.entitlement.handle}/{event.slug}</code></div>
          <div className="scheduler-row-actions"><button className="icon-button" title="Copy public link" onClick={() => void navigator.clipboard.writeText(`${state.publicBaseUrl}/scheduler/${state.entitlement.handle}/${event.slug}`)}><Copy size={16} /></button><button className="icon-button" title="Edit" onClick={() => setEditor(event)}><Settings2 size={16} /></button><button className="icon-button danger" title="Delete" onClick={async () => { if (confirm(`Delete ${event.title}?`)) { await deleteSchedulerEvent(event.id); await load(); } }}><Trash2 size={16} /></button></div>
        </article>)}</div>}
      </>}
      {tab === 'bookings' && <>
        <div className="scheduler-section-title"><div><h1>Bookings</h1><p>Calendar-backed meetings</p></div><div className="segmented-control">{['upcoming', 'past', 'cancelled'].map(value => <button className={filter === value ? 'active' : ''} onClick={() => setFilter(value)} key={value}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div></div>
        {state.bookings.length === 0 ? <EmptyState icon={CalendarDays} title={`No ${filter} bookings`} description="" /> : <div className="scheduler-booking-list">{state.bookings.map(booking => <article key={booking.id}><time>{new Date(booking.start).toLocaleDateString([], { month: 'short', day: 'numeric' })}<strong>{new Date(booking.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</strong></time><div><h3>{booking.event.title}</h3><p>{booking.bookerName} · {booking.bookerEmail}</p></div><span className={`booking-status ${booking.status}`}>{booking.status}</span><button className="btn btn-secondary" onClick={() => setSelectedBooking(booking)}>View</button>{booking.status === 'confirmed' && <button className="btn btn-secondary" onClick={async () => { if (confirm('Cancel this booking?')) { await cancelSchedulerBooking(booking.id); await load(); } }}>Cancel</button>}</article>)}</div>}
      </>}
      {tab === 'availability' && <><div className="scheduler-section-title"><div><h1>Availability</h1><p>Reusable weekly schedules by event type</p></div></div><div className="scheduler-availability-list">{state.events.map(event => <button key={event.id} onClick={() => setEditor(event)}><div><strong>{event.title}</strong><span>{event.windows.length} available days</span></div><Settings2 size={17} /></button>)}</div></>}
      {tab === 'profile' && <ProfilePanel state={state} onSaved={load} />}
    </main>
    {editor !== undefined && <EventEditor event={editor} calendars={state.calendars} onClose={() => setEditor(undefined)} onSaved={async () => { setEditor(undefined); await load(); }} />}
    {selectedBooking && <div className="scheduler-modal-backdrop" onMouseDown={() => setSelectedBooking(null)}><section className="scheduler-booking-detail" onMouseDown={event => event.stopPropagation()}><header><div><h2>{selectedBooking.event.title}</h2><p>{selectedBooking.status}</p></div><button className="icon-button" onClick={() => setSelectedBooking(null)} aria-label="Close"><X size={18} /></button></header><dl><div><dt>Guest</dt><dd>{selectedBooking.bookerName}<span>{selectedBooking.bookerEmail}</span></dd></div><div><dt>When</dt><dd>{new Date(selectedBooking.start).toLocaleString()}<span>{selectedBooking.event.durationMinutes} minutes</span></dd></div><div><dt>Location</dt><dd>{selectedBooking.event.locationLabel || 'Not specified'}</dd></div>{selectedBooking.bookerNotes && <div><dt>Notes</dt><dd>{selectedBooking.bookerNotes}</dd></div>}</dl></section></div>}
  </div>;
}
