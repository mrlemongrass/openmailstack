import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, CalendarDays, Clock3, Copy, ExternalLink, Link2, Plus, Settings2, Trash2, X } from 'lucide-react';
import { EmptyState } from '../shared/components/EmptyState';
import { ErrorBanner } from '../shared/components/ErrorBanner';
import { useToast } from '../shared/components/Toast';
import {
  cancelSchedulerBooking,
  decideSchedulerBooking,
  deleteSchedulerEvent,
  getSchedulerPrivateLink,
  getSchedulerState,
  revokeSchedulerPrivateLink,
  rotateSchedulerPrivateLink,
  saveSchedulerEvent,
  saveSchedulerProfile,
  type SchedulerEntitlement,
  type SchedulerBookingQuestion,
  type SchedulerBookingQuestionType,
  type SchedulerEventType,
  type SchedulerOneOffWindow,
  type SchedulerPrivateLinkState,
  type SchedulerState,
  type SchedulerWindow,
} from './api';
import { AvailabilityPanel } from './AvailabilityPanel';
import './scheduler.css';

type SchedulerTab = 'events' | 'bookings' | 'availability' | 'profile';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DEFAULT_WINDOWS: SchedulerWindow[] = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1020 }));

const minutesToTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const timeToMinutes = (value: string) => {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
};
const durationLabel = (minutes: number) => {
  if (minutes < 5) return 'Minimum 5 minutes';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return [hours && `${hours} ${hours === 1 ? 'hour' : 'hours'}`, remainder && `${remainder} ${remainder === 1 ? 'minute' : 'minutes'}`].filter(Boolean).join(' ');
};
const dateInTimeZone = (value: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

function EventEditor({ event, calendars, defaultAvailability, onClose, onSaved }: {
  event: Partial<SchedulerEventType> | null;
  calendars: SchedulerState['calendars'];
  defaultAvailability: SchedulerState['defaultAvailability'];
  onClose: () => void;
  onSaved: (close?: boolean) => Promise<void> | void;
}) {
  const { showToast } = useToast();
  const [section, setSection] = useState<'setup' | 'availability' | 'limits' | 'advanced'>('setup');
  const [form, setForm] = useState<Partial<SchedulerEventType>>({
    title: event?.title || '', slug: event?.slug || '', description: event?.description || '',
    durationMinutes: event?.durationMinutes || 30, intervalMinutes: event?.intervalMinutes || 30,
    minimumNoticeMinutes: event?.minimumNoticeMinutes ?? 60, bufferBeforeMinutes: event?.bufferBeforeMinutes || 0,
    bufferAfterMinutes: event?.bufferAfterMinutes || 0, capacity: event?.capacity || 1,
    locationType: event?.locationType || 'custom', locationLabel: event?.locationLabel || '',
    destinationCalendarId: event?.destinationCalendarId || calendars[0]?.id || null,
    conflictCalendarIds: event?.conflictCalendarIds?.length ? event.conflictCalendarIds : calendars.map(calendar => calendar.id),
    active: event?.active ?? true, windows: event?.windows?.length ? event.windows : DEFAULT_WINDOWS,
    visibility: event?.visibility || 'public',
    requiresConfirmation: event?.requiresConfirmation ?? false,
    availabilityScheduleId: event ? event.availabilityScheduleId : defaultAvailability.id,
    questions: event?.questions || [],
    id: event?.id,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [privateLink, setPrivateLink] = useState<SchedulerPrivateLinkState | null>(null);
  const [privateLinkUrl, setPrivateLinkUrl] = useState('');
  const [privateLinkExpiry, setPrivateLinkExpiry] = useState('');
  const [privateLinkSingleUse, setPrivateLinkSingleUse] = useState(false);
  const [privateLinkOneOff, setPrivateLinkOneOff] = useState(false);
  const [oneOffTimeZone, setOneOffTimeZone] = useState(defaultAvailability.timeZone);
  const [oneOffDateAnchor] = useState(() => new Date());
  const [oneOffWindows, setOneOffWindows] = useState<SchedulerOneOffWindow[]>(() => [{
    date: dateInTimeZone(new Date(Date.now() + 36 * 60 * 60 * 1000), defaultAvailability.timeZone),
    startMinute: 540,
    endMinute: 600,
  }]);
  const [privateLinkBusy, setPrivateLinkBusy] = useState(false);
  const [privateLinkLoading, setPrivateLinkLoading] = useState(Boolean(event?.id));
  const durationMinutes = form.durationMinutes ?? 30;
  const durationHours = Math.floor(durationMinutes / 60);
  const durationMinutePart = durationMinutes % 60;
  const durationValid = Number.isInteger(durationMinutes) && durationMinutes >= 5 && durationMinutes <= 1440;
  useEffect(() => {
    const closeOnEscape = (keyboardEvent: KeyboardEvent) => { if (keyboardEvent.key === 'Escape') onClose(); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);
  useEffect(() => {
    if (!event?.id) return;
    void getSchedulerPrivateLink(event.id).then(state => {
      setPrivateLink(state);
      setPrivateLinkSingleUse(state.singleUse);
      setPrivateLinkOneOff(state.oneOff);
      if (state.oneOffTimeZone) setOneOffTimeZone(state.oneOffTimeZone);
      if (state.oneOffWindows.length) setOneOffWindows(state.oneOffWindows);
      if (state.expiresAt) {
        const value = new Date(state.expiresAt);
        const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        setPrivateLinkExpiry(local);
      }
    }).catch(err => setError(err instanceof Error ? err.message : 'Unable to load private link status')).finally(() => setPrivateLinkLoading(false));
  }, [event?.id]);

  const updateDuration = (hours: number, minutes: number) => {
    const safeHours = Math.max(0, Math.min(24, Number.isFinite(hours) ? Math.trunc(hours) : 0));
    const safeMinutes = safeHours === 24 ? 0 : Math.max(0, Math.min(59, Number.isFinite(minutes) ? Math.trunc(minutes) : 0));
    setForm({ ...form, durationMinutes: safeHours * 60 + safeMinutes });
  };

  const toggleWeekday = (weekday: number) => {
    const windows = form.windows || [];
    setForm({ ...form, windows: windows.some(window => window.weekday === weekday)
      ? windows.filter(window => window.weekday !== weekday)
      : [...windows, { weekday, startMinute: 540, endMinute: 1020 }].sort((a, b) => a.weekday - b.weekday) });
  };

  const updateWindow = (weekday: number, key: 'startMinute' | 'endMinute', value: number) => {
    setForm({ ...form, windows: (form.windows || []).map(window => window.weekday === weekday ? { ...window, [key]: value } : window) });
  };

  const addQuestion = () => {
    if ((form.questions?.length || 0) >= 10) return;
    setForm({
      ...form,
      questions: [...(form.questions || []), {
        id: crypto.randomUUID(), label: '', type: 'short_text', required: false, options: [],
      }],
    });
  };

  const updateQuestion = (id: string, patch: Partial<SchedulerBookingQuestion>) => {
    setForm({ ...form, questions: (form.questions || []).map(question => question.id === id ? { ...question, ...patch } : question) });
  };

  const updateQuestionType = (question: SchedulerBookingQuestion, type: SchedulerBookingQuestionType) => {
    updateQuestion(question.id, { type, options: type === 'select' ? (question.options.length >= 2 ? question.options : ['Option 1', 'Option 2']) : [] });
  };

  const privateLinkOptions = () => ({
    expiresAt: privateLinkExpiry ? new Date(privateLinkExpiry).toISOString() : null,
    singleUse: privateLinkSingleUse || privateLinkOneOff,
    oneOffAvailability: privateLinkOneOff ? { timeZone: oneOffTimeZone, windows: oneOffWindows } : null,
  });

  const updateOneOffWindow = (index: number, patch: Partial<SchedulerOneOffWindow>) => {
    setOneOffWindows(current => current.map((window, windowIndex) => windowIndex === index ? { ...window, ...patch } : window));
  };

  const submit = async (eventSubmit: React.FormEvent) => {
    eventSubmit.preventDefault();
    if (!durationValid) { setError('Duration must be between 5 minutes and 24 hours'); return; }
    setSaving(true); setError('');
    try {
      const saved = await saveSchedulerEvent(form);
      if (!form.id && saved.visibility === 'private') {
        setForm(saved);
        setSection('advanced');
        await onSaved(false);
        const result = await rotateSchedulerPrivateLink(saved.id, privateLinkOptions());
        setPrivateLink(result.privateLink);
        setPrivateLinkUrl(result.url);
        showToast({ type: 'success', message: 'Private link created. Copy it before closing.' });
      } else {
        await onSaved();
      }
    }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to save event type'); }
    finally { setSaving(false); }
  };

  const rotatePrivateLink = async () => {
    if (!form.id) return;
    setPrivateLinkBusy(true); setError('');
    try {
      const result = await rotateSchedulerPrivateLink(form.id, privateLinkOptions());
      setPrivateLink(result.privateLink);
      setPrivateLinkUrl(result.url);
      showToast({ type: 'success', message: 'Private link rotated. The previous link no longer works.' });
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to rotate private link'); }
    finally { setPrivateLinkBusy(false); }
  };

  const copyPrivateLink = async () => {
    try { await navigator.clipboard.writeText(privateLinkUrl); showToast({ type: 'success', message: 'Private link copied' }); }
    catch { showToast({ type: 'error', message: 'Unable to copy the private link' }); }
  };

  const revokePrivateLink = async () => {
    if (!form.id || !confirm('Revoke this private link? Anyone using it will lose access immediately.')) return;
    setPrivateLinkBusy(true); setError('');
    try {
      await revokeSchedulerPrivateLink(form.id);
      setPrivateLink({
        active: false, expired: false, consumed: false, singleUse: false, remainingUses: null,
        oneOff: false, oneOffTimeZone: null, oneOffWindows: [], tokenHint: null, expiresAt: null,
      });
      setPrivateLinkUrl('');
      showToast({ type: 'success', message: 'Private link revoked' });
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to revoke private link'); }
    finally { setPrivateLinkBusy(false); }
  };

  const oneOffMinDate = dateInTimeZone(oneOffDateAnchor, oneOffTimeZone);
  const oneOffMaxDate = dateInTimeZone(new Date(oneOffDateAnchor.getTime() + 62 * 24 * 60 * 60 * 1000), oneOffTimeZone);
  const privateLinkStatus = privateLinkLoading
    ? 'Checking private link status…'
    : privateLink?.active
      ? `${privateLink.oneOff ? 'One-off' : privateLink.singleUse ? 'Single-use' : 'Reusable'} link ending ${privateLink.tokenHint}`
      : privateLink?.consumed
        ? `The ${privateLink.oneOff ? 'one-off' : 'single-use'} link has already been used.`
        : privateLink?.expired
          ? 'The current private link has expired.'
          : 'No active private link.';

  return (
    <div className="scheduler-modal-backdrop" onMouseDown={onClose}>
      <form className="scheduler-modal" role="dialog" aria-modal="true" aria-labelledby="event-editor-title" onSubmit={submit} onMouseDown={eventMouse => eventMouse.stopPropagation()}>
        <header><div><h2 id="event-editor-title">{form.id ? 'Edit event type' : 'New event type'}</h2><p>Choose the service length, schedule, calendar rules, and booking limits.</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
        {error && <ErrorBanner error={error} />}
        <nav className="scheduler-editor-tabs" aria-label="Event type settings">{(['setup', 'availability', 'limits', 'advanced'] as const).map(item => <button type="button" className={section === item ? 'active' : ''} onClick={() => setSection(item)} key={item}>{item[0].toUpperCase() + item.slice(1)}</button>)}</nav>
        {section === 'setup' && <div className="scheduler-form-grid">
          <label className="span-2">Title<input autoFocus required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Hair coloring" /></label>
          <label>Booking link<input value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })} placeholder="hair-coloring" /></label>
          <fieldset className="scheduler-duration"><legend>Duration</legend><div><label>Hours<input aria-label="Duration hours" type="number" min={0} max={24} step={1} value={durationHours} onChange={e => updateDuration(Number(e.target.value), durationMinutePart)} /></label><label>Minutes<input aria-label="Duration minutes" type="number" min={0} max={59} step={1} value={durationMinutePart} disabled={durationHours === 24} onChange={e => updateDuration(durationHours, Number(e.target.value))} /></label></div><span className={durationValid ? '' : 'invalid'}>{durationLabel(durationMinutes)}</span></fieldset>
          <label className="span-2">Description<textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
          <label>Location<select value={form.locationType} onChange={e => setForm({ ...form, locationType: e.target.value as SchedulerEventType['locationType'] })}><option value="custom">Custom</option><option value="phone">Phone</option><option value="in_person">In person</option><option value="conference">Conference link</option></select></label>
          <label>Location details<input value={form.locationLabel} onChange={e => setForm({ ...form, locationLabel: e.target.value })} /></label>
          <label className="span-2">Destination calendar<select value={form.destinationCalendarId || ''} onChange={e => setForm({ ...form, destinationCalendarId: Number(e.target.value) })}>{calendars.map(calendar => <option value={calendar.id} key={calendar.id}>{calendar.name}</option>)}</select></label>
          <section className="scheduler-question-editor span-2"><header><div><strong>Booking questions</strong><span>Ask up to 10 required or optional questions.</span></div><button type="button" className="btn btn-secondary" disabled={(form.questions?.length || 0) >= 10} onClick={addQuestion}><Plus size={15} /> Add question</button></header>{(form.questions || []).length === 0 ? <p>Guests will only be asked for their name, email, and notes.</p> : <div className="scheduler-question-list">{(form.questions || []).map((question, index) => <article key={question.id}><div className="scheduler-question-row"><label>Question {index + 1}<input required maxLength={160} value={question.label} onChange={e => updateQuestion(question.id, { label: e.target.value })} placeholder="What should we prepare?" /></label><label>Answer type<select value={question.type} onChange={e => updateQuestionType(question, e.target.value as SchedulerBookingQuestionType)}><option value="short_text">Short answer</option><option value="long_text">Long answer</option><option value="select">Dropdown</option></select></label><label className="scheduler-question-required"><input type="checkbox" checked={question.required} onChange={e => updateQuestion(question.id, { required: e.target.checked })} /><span>Required</span></label><button type="button" className="icon-button danger" aria-label={`Remove booking question ${index + 1}`} onClick={() => setForm({ ...form, questions: (form.questions || []).filter(candidate => candidate.id !== question.id) })}><Trash2 size={15} /></button></div>{question.type === 'select' && <label>Dropdown options<textarea aria-label={`Options for booking question ${index + 1}`} rows={3} value={question.options.join('\n')} onChange={e => updateQuestion(question.id, { options: e.target.value.split('\n') })} /><small>One option per line, between 2 and 20 choices.</small></label>}</article>)}</div>}</section>
        </div>}
        {section === 'availability' && <section className="scheduler-window-editor scheduler-editor-section">
          <div className="scheduler-schedule-choice"><label><input type="radio" checked={form.availabilityScheduleId === defaultAvailability.id} onChange={() => setForm({ ...form, availabilityScheduleId: defaultAvailability.id })} /><span><strong>Use default availability</strong><small>{defaultAvailability.name} · changes stay in sync automatically</small></span></label><label><input type="radio" checked={!form.availabilityScheduleId} onChange={() => setForm({ ...form, availabilityScheduleId: null })} /><span><strong>Use custom hours</strong><small>Only this event type uses the hours below</small></span></label></div>
          {!form.availabilityScheduleId && <><h3>Custom weekly hours</h3>
          {WEEKDAYS.map((day, weekday) => {
            const window = form.windows?.find(candidate => candidate.weekday === weekday);
            return <div className="scheduler-window-row" key={day}>
              <label className="weekday-toggle"><input type="checkbox" checked={Boolean(window)} onChange={() => toggleWeekday(weekday)} /><span>{day}</span></label>
              {window ? <><input aria-label={`${day} start`} type="time" value={minutesToTime(window.startMinute)} onChange={e => updateWindow(weekday, 'startMinute', timeToMinutes(e.target.value))} /><span>to</span><input aria-label={`${day} end`} type="time" value={minutesToTime(window.endMinute)} onChange={e => updateWindow(weekday, 'endMinute', timeToMinutes(e.target.value))} /></> : <span className="unavailable">Unavailable</span>}
            </div>;
          })}</>}
        </section>}
        {section === 'limits' && <div className="scheduler-form-grid scheduler-editor-section">
          <label className="scheduler-publish span-2"><input type="checkbox" checked={form.requiresConfirmation === true} onChange={e => setForm({ ...form, requiresConfirmation: e.target.checked })} /><span>Require host approval<small>Reserve the requested time, then add it to Calendar only after you approve it.</small></span></label>
          <label>Start-time increments<input type="number" min={5} max={1440} step={5} value={form.intervalMinutes} onChange={e => setForm({ ...form, intervalMinutes: Number(e.target.value) })} /><small>Minutes between offered start times</small></label>
          <label>Minimum notice<input type="number" min={0} max={525600} step={15} value={form.minimumNoticeMinutes} onChange={e => setForm({ ...form, minimumNoticeMinutes: Number(e.target.value) })} /><small>Minutes guests must book ahead</small></label>
          <label>Buffer before<input type="number" min={0} max={1440} step={5} value={form.bufferBeforeMinutes} onChange={e => setForm({ ...form, bufferBeforeMinutes: Number(e.target.value) })} /></label>
          <label>Buffer after<input type="number" min={0} max={1440} step={5} value={form.bufferAfterMinutes} onChange={e => setForm({ ...form, bufferAfterMinutes: Number(e.target.value) })} /></label>
          <label>Capacity<input type="number" min={1} max={100} value={form.capacity} onChange={e => setForm({ ...form, capacity: Number(e.target.value) })} /><small>Use more than 1 for group bookings</small></label>
        </div>}
        {section === 'advanced' && <div className="scheduler-editor-section">
          <fieldset className="scheduler-calendar-checks"><legend>Check busy time on these calendars</legend>{calendars.map(calendar => <label key={calendar.id}><input type="checkbox" checked={form.conflictCalendarIds?.includes(calendar.id) ?? false} onChange={e => setForm({ ...form, conflictCalendarIds: e.target.checked ? [...(form.conflictCalendarIds || []), calendar.id] : (form.conflictCalendarIds || []).filter(id => id !== calendar.id) })} /><span>{calendar.name}</span></label>)}</fieldset>
          <div className="scheduler-visibility-options"><strong>Booking-page visibility</strong><label><input type="radio" checked={form.visibility === 'public'} onChange={() => setForm({ ...form, visibility: 'public' })} /><span><strong>Listed</strong><small>Show this event on your public booking page.</small></span></label><label><input type="radio" checked={form.visibility === 'unlisted'} onChange={() => setForm({ ...form, visibility: 'unlisted' })} /><span><strong>Unlisted</strong><small>Hide it from your profile. Anyone with its exact link can still book.</small></span></label><label><input type="radio" checked={form.visibility === 'private'} onChange={() => setForm({ ...form, visibility: 'private' })} /><span><strong>Private link</strong><small>Require a random access token that you can rotate, expire, or revoke.</small></span></label></div>
          {form.visibility === 'private' && <section className="scheduler-private-link">
            <div><strong>Private access</strong><span>Tokens are shown once and are removed from the guest's address bar after opening.</span></div>
            <label>New link expires (optional)<input type="datetime-local" value={privateLinkExpiry} onChange={e => setPrivateLinkExpiry(e.target.value)} /></label>
            <label className="scheduler-publish scheduler-one-off-toggle"><input type="checkbox" checked={privateLinkOneOff} onChange={e => { setPrivateLinkOneOff(e.target.checked); if (e.target.checked) setPrivateLinkSingleUse(true); }} /><span>Offer only selected one-off times<small>These windows replace the recurring schedule for this link.</small></span></label>
            {privateLinkOneOff && <div className="scheduler-one-off-editor"><div><strong>One-off availability</strong><span>{oneOffTimeZone} · automatically single-use</span></div>{oneOffWindows.map((window, index) => <div className="scheduler-one-off-row" key={`${window.date}-${index}`}><input aria-label={`One-off date ${index + 1}`} type="date" min={oneOffMinDate} max={oneOffMaxDate} value={window.date} onChange={e => updateOneOffWindow(index, { date: e.target.value })} /><input aria-label={`One-off start ${index + 1}`} type="time" value={minutesToTime(window.startMinute)} onChange={e => updateOneOffWindow(index, { startMinute: timeToMinutes(e.target.value) })} /><span>to</span><input aria-label={`One-off end ${index + 1}`} type="time" value={minutesToTime(window.endMinute)} onChange={e => updateOneOffWindow(index, { endMinute: timeToMinutes(e.target.value) })} /><button type="button" className="icon-button danger" aria-label={`Remove one-off window ${index + 1}`} disabled={oneOffWindows.length === 1} onClick={() => setOneOffWindows(current => current.filter((_, windowIndex) => windowIndex !== index))}><Trash2 size={15} /></button></div>)}<button type="button" className="btn btn-secondary" disabled={oneOffWindows.length >= 14} onClick={() => setOneOffWindows(current => [...current, { ...current[current.length - 1] }])}><Plus size={15} /> Add time window</button></div>}
            <label className="scheduler-publish"><input type="checkbox" checked={privateLinkSingleUse || privateLinkOneOff} disabled={privateLinkOneOff} onChange={e => setPrivateLinkSingleUse(e.target.checked)} /><span>Single-use link: disable it after the first successful booking.<small>Viewing times or a failed booking will not use the link.</small></span></label>
            {form.id ? <><p>{privateLinkStatus}</p>{privateLinkUrl && <div className="scheduler-private-link-reveal"><input aria-label="New private link" readOnly value={privateLinkUrl} /><button type="button" className="btn btn-secondary" onClick={() => void copyPrivateLink()}><Copy size={15} /> Copy</button></div>}<div className="scheduler-private-link-actions"><button type="button" className="btn btn-secondary" disabled={privateLinkBusy || privateLinkLoading} onClick={() => void rotatePrivateLink()}><Link2 size={15} /> {privateLink?.active ? 'Rotate link' : privateLinkOneOff ? 'Generate one-off link' : 'Generate link'}</button>{(privateLink?.active || privateLink?.expired || privateLink?.consumed) && <button type="button" className="btn btn-secondary" disabled={privateLinkBusy || privateLinkLoading} onClick={() => void revokePrivateLink()}>Revoke</button>}</div></> : <p>Save this private event to generate its first link. The new link will remain visible here so you can copy it.</p>}
          </section>}
          <label className="scheduler-publish scheduler-event-active"><input type="checkbox" checked={form.active !== false} onChange={e => setForm({ ...form, active: e.target.checked })} /><span>Event type is active and bookable</span></label>
        </div>}
        <footer><button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={saving || !durationValid}>{saving ? 'Saving...' : 'Save event type'}</button></footer>
      </form>
    </div>
  );
}

function ProfilePanel({ state, onSaved }: { state: SchedulerState; onSaved: () => void }) {
  const [profile, setProfile] = useState<Partial<SchedulerEntitlement>>(state.entitlement);
  const [status, setStatus] = useState('');
  const publicUrl = `${state.publicBaseUrl}/scheduler/${state.entitlement.handle}`;
  const hasActiveEvents = state.events.some(event => event.active) || state.defaultAvailability.published;
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setStatus('Saving...');
    try { await saveSchedulerProfile(profile); setStatus('Saved'); onSaved(); }
    catch (err) { setStatus(err instanceof Error ? err.message : 'Save failed'); }
  };
  return <form className="scheduler-settings" onSubmit={save}>
    <div className="scheduler-section-title"><div><h2>Public profile</h2><p>{publicUrl}</p></div><a className="btn btn-secondary" href={publicUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Preview</a></div>
    {!hasActiveEvents && profile.published !== false && <div className="scheduler-inline-warning"><AlertTriangle size={18} /><div><strong>Your profile is published but has no bookable availability.</strong><span>Publish your default availability or activate an event type before sharing this page.</span></div></div>}
    <div className="scheduler-form-grid">
      <label>Display name<input value={profile.displayName || ''} onChange={e => setProfile({ ...profile, displayName: e.target.value })} /></label>
      <label>Time zone<input value={profile.timeZone || ''} onChange={e => setProfile({ ...profile, timeZone: e.target.value })} /></label>
      <label className="span-2">Scheduler email sender<select value={profile.notificationFrom || state.entitlement.username} onChange={e => setProfile({ ...profile, notificationFrom: e.target.value })}>{state.notificationIdentities.map(identity => <option value={identity.address} key={identity.address}>{identity.name} &lt;{identity.address}&gt;</option>)}</select><small>Confirmations use this owned mailbox or active alias. Replies go to your primary mailbox.</small></label>
      <label className="span-2">Welcome message<textarea rows={4} value={profile.welcomeMessage || ''} onChange={e => setProfile({ ...profile, welcomeMessage: e.target.value })} /></label>
      <label className="scheduler-publish span-2"><input type="checkbox" checked={profile.published !== false} onChange={e => setProfile({ ...profile, published: e.target.checked })} /><span>Publish profile</span></label>
    </div>
    <div className="scheduler-actions"><span>{status}</span><button className="btn btn-primary">Save profile</button></div>
  </form>;
}

export function SchedulerRoutes() {
  const { showToast } = useToast();
  const [tab, setTab] = useState<SchedulerTab>('events');
  const [state, setState] = useState<SchedulerState | null>(null);
  const [filter, setFilter] = useState('upcoming');
  const [editor, setEditor] = useState<Partial<SchedulerEventType> | null | undefined>(undefined);
  const [selectedBooking, setSelectedBooking] = useState<SchedulerState['bookings'][number] | null>(null);
  const [reviewingBookingId, setReviewingBookingId] = useState('');
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

  const publicUrl = `${state.publicBaseUrl}/scheduler/${state.entitlement.handle}`;
  const copyLink = async (url: string, label: string) => {
    try {
      await navigator.clipboard.writeText(url);
      showToast({ type: 'success', message: `${label} copied` });
    } catch {
      showToast({ type: 'error', message: 'Unable to copy the link' });
    }
  };
  const reviewBooking = async (bookingId: string, decision: 'confirm' | 'reject') => {
    setReviewingBookingId(bookingId); setError('');
    try {
      await decideSchedulerBooking(bookingId, decision);
      showToast({ type: 'success', message: decision === 'confirm' ? 'Booking approved' : 'Booking rejected' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to review booking');
    } finally {
      setReviewingBookingId('');
    }
  };

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
      <section className="scheduler-public-bar" aria-label="Public booking site"><div><span>Your booking site</span><strong>{publicUrl}</strong></div><div className="scheduler-public-actions"><button className="btn btn-secondary" type="button" onClick={() => void copyLink(publicUrl, 'Booking link')}><Copy size={15} /> Copy booking link</button><a className="btn btn-primary" href={publicUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open booking site</a></div></section>
      {tab === 'events' && <>
        <div className="scheduler-section-title"><div><h1>Event Types</h1><p>{state.events.length} booking {state.events.length === 1 ? 'link' : 'links'}</p></div><button className="btn btn-primary" onClick={() => setEditor(null)}><Plus size={16} /> New event</button></div>
        {state.events.length === 0 ? <section className="scheduler-first-run"><div><span className="scheduler-eyebrow">Get started</span><h2>Create your first booking type</h2><p>Set the meeting length, choose which calendars block busy time, and publish a link guests can book without emailing back and forth.</p><button className="btn btn-primary" type="button" onClick={() => setEditor(null)}><Plus size={16} /> Create first event</button></div><ol><li><span>1</span><div><strong>Create an event type</strong><p>For example, a 30-minute discovery call or 60-minute consultation.</p></div></li><li><span>2</span><div><strong>Set availability and calendars</strong><p>Choose working hours, the destination calendar, and calendars to check for conflicts.</p></div></li><li><span>3</span><div><strong>Preview and share</strong><p>Open your booking site above, then copy the public link wherever you need it.</p></div></li></ol></section> : <div className="scheduler-event-list">{state.events.map(event => <article key={event.id}>
          <div className="scheduler-event-accent" /><div className="scheduler-event-copy"><div><h3>{event.title}{event.visibility !== 'public' && <span className="scheduler-event-badge">{event.visibility === 'private' ? 'Private' : 'Unlisted'}</span>}</h3><p>{event.durationMinutes} min · {event.locationLabel || 'Location set when booking'}</p></div><code>/{state.entitlement.handle}/{event.slug}</code></div>
          <div className="scheduler-row-actions">{event.visibility === 'private' ? <button className="icon-button" title="Manage private link" aria-label={`Manage ${event.title} private link`} onClick={() => setEditor(event)}><Link2 size={16} /></button> : <button className="icon-button" title="Copy public link" aria-label={`Copy ${event.title} booking link`} onClick={() => void copyLink(`${publicUrl}/${event.slug}`, `${event.title} link`)}><Copy size={16} /></button>}<button className="icon-button" title="Edit" aria-label={`Edit ${event.title}`} onClick={() => setEditor(event)}><Settings2 size={16} /></button><button className="icon-button danger" title="Delete" aria-label={`Delete ${event.title}`} onClick={async () => { if (confirm(`Delete ${event.title}?`)) { await deleteSchedulerEvent(event.id); await load(); } }}><Trash2 size={16} /></button></div>
        </article>)}</div>}
      </>}
      {tab === 'bookings' && <>
        <div className="scheduler-section-title"><div><h1>Bookings</h1><p>Calendar-backed meetings and approval requests</p></div><div className="segmented-control">{['upcoming', 'past', 'cancelled', 'rejected'].map(value => <button className={filter === value ? 'active' : ''} onClick={() => setFilter(value)} key={value}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div></div>
        {state.bookings.length === 0 ? <EmptyState icon={CalendarDays} title={`No ${filter} bookings`} description="" /> : <div className="scheduler-booking-list">{state.bookings.map(booking => <article key={booking.id}><time>{new Date(booking.start).toLocaleDateString([], { month: 'short', day: 'numeric' })}<strong>{new Date(booking.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</strong></time><div><h3>{booking.event.title}</h3><p>{booking.bookerName} · {booking.bookerEmail}</p></div><span className={`booking-status ${booking.status}`}>{booking.status}</span><button className="btn btn-secondary" onClick={() => setSelectedBooking(booking)}>View</button>{booking.status === 'requested' && <><button className="btn btn-primary" disabled={reviewingBookingId === booking.id} onClick={() => void reviewBooking(booking.id, 'confirm')}>Approve</button><button className="btn btn-secondary" disabled={reviewingBookingId === booking.id} onClick={() => { if (confirm('Reject this booking request?')) void reviewBooking(booking.id, 'reject'); }}>Reject</button></>}{booking.status === 'confirmed' && <button className="btn btn-secondary" onClick={async () => { if (confirm('Cancel this booking?')) { await cancelSchedulerBooking(booking.id); await load(); } }}>Cancel</button>}</article>)}</div>}
      </>}
      {tab === 'availability' && <AvailabilityPanel availability={state.defaultAvailability} onSaved={load} />}
      {tab === 'profile' && <ProfilePanel state={state} onSaved={load} />}
    </main>
    {editor !== undefined && <EventEditor event={editor} calendars={state.calendars} defaultAvailability={state.defaultAvailability} onClose={() => setEditor(undefined)} onSaved={async (close = true) => { if (close) setEditor(undefined); await load(); }} />}
    {selectedBooking && <div className="scheduler-modal-backdrop" onMouseDown={() => setSelectedBooking(null)}><section className="scheduler-booking-detail" onMouseDown={event => event.stopPropagation()}><header><div><h2>{selectedBooking.event.title}</h2><p>{selectedBooking.status}</p></div><button className="icon-button" onClick={() => setSelectedBooking(null)} aria-label="Close"><X size={18} /></button></header><dl><div><dt>Guest</dt><dd>{selectedBooking.bookerName}<span>{selectedBooking.bookerEmail}</span></dd></div><div><dt>When</dt><dd>{new Date(selectedBooking.start).toLocaleString()}<span>{selectedBooking.event.durationMinutes} minutes</span></dd></div><div><dt>Location</dt><dd>{selectedBooking.event.locationLabel || 'Not specified'}</dd></div>{selectedBooking.bookerNotes && <div><dt>Notes</dt><dd>{selectedBooking.bookerNotes}</dd></div>}{(selectedBooking.bookingAnswers || []).map(answer => <div key={answer.questionId}><dt>{answer.label}</dt><dd>{answer.value}</dd></div>)}</dl></section></div>}
  </div>;
}
