import { useMemo, useState } from 'react';
import { CalendarPlus, Copy, Download, Upload } from 'lucide-react';
import {
  bookSchedulerOnBehalf,
  createSchedulerPoll,
  finalizeSchedulerPoll,
  getPublicSlots,
  importSchedulerData,
  type SchedulerState,
} from './api';

const localIso = (value: string) => value ? new Date(value).toISOString() : '';

export function SchedulerToolsPanel({ state, onChanged }: { state: SchedulerState; onChanged: () => Promise<void> | void }) {
  const firstEvent = state.events.find(event => event.active && event.visibility !== 'private');
  const [eventId, setEventId] = useState(firstEvent?.id || '');
  const [booking, setBooking] = useState({ start: '', bookerName: '', bookerEmail: '' });
  const [poll, setPoll] = useState({ title: '', starts: ['', ''] });
  const [newPollUrl, setNewPollUrl] = useState('');
  const [source, setSource] = useState<'openmailstack' | 'calendly' | 'calcom'>('openmailstack');
  const [status, setStatus] = useState('');
  const selectedEvent = useMemo(() => state.events.find(event => event.id === eventId), [eventId, state.events]);
  const publicUrl = selectedEvent ? `${state.publicBaseUrl}/scheduler/${state.entitlement.handle}/${selectedEvent.slug}` : '';

  const copy = async (value: string, success: string) => {
    try { await navigator.clipboard.writeText(value); setStatus(success); }
    catch { setStatus('Clipboard access was unavailable'); }
  };
  const book = async (event: React.FormEvent) => {
    event.preventDefault(); setStatus('Booking…');
    try {
      await bookSchedulerOnBehalf({ ...booking, eventTypeId: eventId, start: localIso(booking.start), bookerTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', idempotencyKey: crypto.randomUUID() });
      setStatus('Booking created on behalf of the guest'); setBooking({ start: '', bookerName: '', bookerEmail: '' }); await onChanged();
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Unable to create booking'); }
  };
  const createPoll = async (event: React.FormEvent) => {
    event.preventDefault(); setStatus('Creating poll…');
    try {
      const result = await createSchedulerPoll({ eventTypeId: eventId, title: poll.title, starts: poll.starts.map(localIso) });
      setNewPollUrl(result.url); setStatus('Poll created. Copy this link now; its secret token is shown once.'); await onChanged();
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Unable to create poll'); }
  };
  const copyEmailSlots = async () => {
    if (!selectedEvent) return;
    setStatus('Loading available times…');
    try {
      const start = new Date(); const end = new Date(start.getTime() + 14 * 86_400_000);
      const slots = (await getPublicSlots(state.entitlement.handle, selectedEvent.slug, start, end)).slice(0, 3);
      if (!slots.length) throw new Error('No available times in the next 14 days');
      const text = slots.map(slot => `${new Date(slot.start).toLocaleString()}: ${publicUrl}?slot=${encodeURIComponent(slot.start)}`).join('\n');
      await copy(text, `${slots.length} email-ready slots copied`);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Unable to create email slots'); }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    setStatus('Importing as inactive, unlisted drafts…');
    try {
      const payload = JSON.parse(await file.text());
      const result = await importSchedulerData(source, payload);
      setStatus(`Imported ${result.imported}; skipped ${result.skipped}${result.errors.length ? ` · ${result.errors[0]}` : ''}`);
      await onChanged();
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Unable to import file'); }
  };
  const inlineEmbed = `<iframe src="${publicUrl}?embed=inline" title="Book ${selectedEvent?.title || 'a meeting'}" width="100%" height="720" loading="lazy"></iframe>`;
  const popupEmbed = `<a href="${publicUrl}?embed=popup" target="_blank" rel="noopener">Book ${selectedEvent?.title || 'a meeting'}</a>`;
  const floatingEmbed = `<a href="${publicUrl}?embed=floating" target="_blank" rel="noopener" style="position:fixed;right:24px;bottom:24px">Book a meeting</a>`;

  return <div className="scheduler-tools">
    <div className="scheduler-section-title"><div><h1>Tools</h1><p>Delegated booking, polls, waitlists, sharing, and migration</p></div><span>{status}</span></div>
    <section className="scheduler-tool-card"><header><div><h2>Book on behalf</h2><p>Create a normal policy-checked booking for a guest. The audit record identifies you as the scheduler.</p></div><CalendarPlus size={20} /></header><form className="scheduler-form-grid" onSubmit={book}><label>Event type<select required value={eventId} onChange={event => setEventId(event.target.value)}><option value="">Choose an event</option>{state.events.filter(item => !item.systemManaged).map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label><label>Start<input required type="datetime-local" value={booking.start} onChange={event => setBooking({ ...booking, start: event.target.value })} /></label><label>Guest name<input required value={booking.bookerName} onChange={event => setBooking({ ...booking, bookerName: event.target.value })} /></label><label>Guest email<input required type="email" value={booking.bookerEmail} onChange={event => setBooking({ ...booking, bookerEmail: event.target.value })} /></label><button className="btn btn-primary span-2">Create booking</button></form></section>
    <section className="scheduler-tool-card"><header><div><h2>Meeting polls</h2><p>Offer two to ten currently available times, collect votes, then finalize one into a real booking.</p></div></header><form className="scheduler-form-grid" onSubmit={createPoll}><label className="span-2">Poll title<input required value={poll.title} onChange={event => setPoll({ ...poll, title: event.target.value })} /></label>{poll.starts.map((start, index) => <label key={index}>Option {index + 1}<span className="scheduler-inline-field"><input required type="datetime-local" value={start} onChange={event => setPoll(current => ({ ...current, starts: current.starts.map((value, itemIndex) => itemIndex === index ? event.target.value : value) }))} />{poll.starts.length > 2 && <button type="button" aria-label={`Remove poll option ${index + 1}`} onClick={() => setPoll(current => ({ ...current, starts: current.starts.filter((_, itemIndex) => itemIndex !== index) }))}>Remove</button>}</span></label>)}{poll.starts.length < 10 && <button type="button" className="btn btn-secondary" onClick={() => setPoll(current => ({ ...current, starts: [...current.starts, ''] }))}>Add poll option</button>}<button className="btn btn-primary">Create poll</button></form>{newPollUrl && <div className="scheduler-copy-row"><input readOnly value={newPollUrl} /><button className="btn btn-secondary" onClick={() => void copy(newPollUrl, 'Poll link copied')}><Copy size={15} /> Copy</button></div>}<div className="scheduler-tool-list">{(state.polls || []).map(item => <article key={item.id}><div><strong>{item.title}</strong><span>{item.status} · {item.options.map(option => `${new Date(option.start).toLocaleString()} (${option.votes})`).join(' · ')}</span></div>{item.status === 'open' && item.options.length > 0 && <button className="btn btn-secondary" onClick={async () => { await finalizeSchedulerPoll(item.id, [...item.options].sort((a,b) => b.votes-a.votes)[0].id); setStatus('Poll finalized'); await onChanged(); }}>Finalize top choice</button>}</article>)}</div></section>
    <section className="scheduler-tool-card"><header><div><h2>Capacity waitlist</h2><p>Oldest eligible parties promote automatically when enough seats are released.</p></div></header><div className="scheduler-tool-list">{(state.waitlist || []).length === 0 ? <p>No waitlist entries.</p> : state.waitlist.map(item => <article key={item.id}><div><strong>{item.booker_name} · {item.seats} seats</strong><span>{item.title} · {new Date(item.desiredStart).toLocaleString()} · {item.status}</span></div></article>)}</div></section>
    <section className="scheduler-tool-card"><header><div><h2>Share and embed</h2><p>Generate safe snippets, email-ready slot links, or prefilled links using name, email, and UTM query parameters.</p></div></header><label>Event type<select value={eventId} onChange={event => setEventId(event.target.value)}>{state.events.filter(item => item.visibility !== 'private').map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label><div className="scheduler-share-grid"><button className="btn btn-secondary" onClick={() => void copy(inlineEmbed, 'Inline embed copied')}>Copy inline embed</button><button className="btn btn-secondary" onClick={() => void copy(popupEmbed, 'Popup link copied')}>Copy popup embed</button><button className="btn btn-secondary" onClick={() => void copy(floatingEmbed, 'Floating button copied')}>Copy floating button</button><button className="btn btn-secondary" onClick={() => void copyEmailSlots()}>Copy email slots</button></div><small>Booking confirmations emit a privacy-safe <code>oms.scheduler.booking.confirmed</code> postMessage event to an embedding parent.</small></section>
    <section className="scheduler-tool-card"><header><div><h2>Export and migration</h2><p>Back up OMS configuration or import Calendly, Cal.com, and OMS JSON as inactive, unlisted drafts for review.</p></div></header><div className="scheduler-share-grid"><a className="btn btn-secondary" href="/api/scheduler/v1/export"><Download size={15} /> Export configuration</a><a className="btn btn-secondary" href="/api/scheduler/v1/export?format=csv"><Download size={15} /> Export bookings CSV</a></div><div className="scheduler-import-row"><label>Import source<select value={source} onChange={event => setSource(event.target.value as typeof source)}><option value="openmailstack">OpenMailStack</option><option value="calendly">Calendly</option><option value="calcom">Cal.com</option></select></label><label className="btn btn-secondary"><Upload size={15} /> Choose JSON<input hidden type="file" accept="application/json,.json" onChange={event => void importFile(event.target.files?.[0])} /></label></div></section>
  </div>;
}
