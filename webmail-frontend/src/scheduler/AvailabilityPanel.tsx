import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Copy, Plus, Trash2 } from 'lucide-react';
import { previewDefaultAvailability, saveDefaultAvailability, type SchedulerAvailability, type SchedulerAvailabilityExclusion, type SchedulerWindow } from './api';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
type View = 'week' | 'month' | 'day';

const minutesToTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const timeToMinutes = (value: string) => {
  if (!value) return Number.NaN;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};
const windowHasValidTimes = (window: { startMinute: number; endMinute: number }) =>
  Number.isFinite(window.startMinute)
  && Number.isFinite(window.endMinute)
  && window.startMinute >= 0
  && window.endMinute <= 1439;
const windowHasIssue = (
  window: { startMinute: number; endMinute: number },
  windows: Array<{ startMinute: number; endMinute: number }>,
  index: number,
) => !windowHasValidTimes(window)
  || window.startMinute >= window.endMinute
  || windows.some((other, otherIndex) => (
    otherIndex !== index
    && windowHasValidTimes(other)
    && window.startMinute < other.endMinute
    && other.startMinute < window.endMinute
  ));
const validateWindowGroup = (
  windows: Array<{ startMinute: number; endMinute: number }>,
  label: string,
) => {
  const messages: string[] = [];
  if (windows.some(window => !windowHasValidTimes(window))) {
    messages.push(`${label} needs valid start and end times.`);
  }
  const validWindows = windows.filter(windowHasValidTimes);
  if (validWindows.some(window => window.startMinute >= window.endMinute)) {
    messages.push(`${label} must end after it starts.`);
  }
  const sorted = [...validWindows].sort((left, right) => left.startMinute - right.startMinute);
  if (sorted.some((window, index) => index > 0 && window.startMinute < sorted[index - 1].endMinute)) {
    messages.push(`Availability windows cannot overlap for ${label.toLowerCase()}.`);
  }
  return messages;
};
const validateAvailabilityDraft = (draft: SchedulerAvailability) => {
  const messages: string[] = [];
  if (!draft.name.trim()) messages.push('Schedule name is required.');
  WEEKDAYS.forEach((day, weekday) => {
    messages.push(...validateWindowGroup(
      draft.windows.filter(window => window.weekday === weekday),
      day,
    ));
  });
  draft.overrides.forEach((override) => {
    if (!override.unavailableAllDay && override.windows.length === 0) {
      messages.push(`Custom hours for ${override.date} need at least one time window.`);
    }
    messages.push(...validateWindowGroup(override.windows, override.date));
  });
  if (draft.published && draft.windows.length === 0) {
    messages.push('Add default weekly hours before making this schedule bookable.');
  }
  return [...new Set(messages)];
};
const nextWindow = (lastEnd?: number) => {
  const startMinute = lastEnd ?? 540;
  return { startMinute, endMinute: Math.min(1439, startMinute + 120) };
};
const localDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const timeZones = (() => {
  try {
    return (Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }).supportedValuesOf?.('timeZone') || ['UTC'];
  } catch { return ['UTC']; }
})();

export function AvailabilityPanel({ availability, onSaved }: { availability: SchedulerAvailability; onSaved: () => Promise<void> | void }) {
  const [draft, setDraft] = useState(availability);
  const [savedDraft, setSavedDraft] = useState(availability);
  const [view, setView] = useState<View>('week');
  const [selectedDate, setSelectedDate] = useState(localDate(new Date()));
  const [monthCursor, setMonthCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [blockStart, setBlockStart] = useState('');
  const [blockEnd, setBlockEnd] = useState('');
  const [status, setStatus] = useState('');
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [exclusion, setExclusion] = useState<SchedulerAvailabilityExclusion>({ kind: 'holiday', startDate: '', endDate: '', label: '' });
  const [preview, setPreview] = useState<{ slots: Array<{ start: string; end: string }>; busyIntervalCount: number; overrideCount: number } | null>(null);

  const isDirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(savedDraft), [draft, savedDraft]);
  const validationMessages = useMemo(() => validateAvailabilityDraft(draft), [draft]);
  const publishValidationMessages = useMemo(
    () => validateAvailabilityDraft({ ...draft, published: true }),
    [draft],
  );
  const saveStatus = isSaving ? 'Saving…' : saveError || (isDirty ? status || 'Unsaved changes' : status || 'All changes saved');
  const updateDraft = (nextDraft: SchedulerAvailability) => {
    setDraft(nextDraft);
    setStatus('');
    setSaveError('');
  };
  const windowsFor = (weekday: number) => draft.windows.filter(window => window.weekday === weekday).sort((a, b) => a.startMinute - b.startMinute);
  const replaceDay = (weekday: number, windows: SchedulerWindow[]) => updateDraft({ ...draft, windows: [...draft.windows.filter(window => window.weekday !== weekday), ...windows].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute) });
  const dateOverride = draft.overrides.find(override => override.date === selectedDate);
  const selectedWeekday = new Date(`${selectedDate}T12:00:00`).getDay();
  const effectiveDayWindows = dateOverride ? dateOverride.windows : windowsFor(selectedWeekday).map(({ startMinute, endMinute }) => ({ startMinute, endMinute }));

  const save = async (nextDraft = draft) => {
    const messages = validateAvailabilityDraft(nextDraft);
    if (messages.length > 0) {
      setSaveError('Fix the highlighted availability errors before saving.');
      return;
    }
    setIsSaving(true);
    setStatus('');
    setSaveError('');
    try {
      const saved = await saveDefaultAvailability(nextDraft);
      setDraft(saved);
      setSavedDraft(saved);
      setStatus(saved.published ? 'Availability saved and bookable' : 'Draft saved');
      await onSaved();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to save availability');
    } finally {
      setIsSaving(false);
    }
  };

  const enableBooking = async () => {
    const nextDraft = { ...draft, published: true };
    updateDraft(nextDraft);
    await save(nextDraft);
  };

  const runPreview = async () => {
    setStatus('Checking calendar conflicts…');
    try {
      const start = new Date(`${selectedDate}T00:00:00`);
      const end = new Date(start); end.setDate(end.getDate() + 1);
      const result = await previewDefaultAvailability(start, end);
      setPreview(result);
      setStatus('Preview updated');
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Unable to preview availability'); }
  };

  const setOverride = (unavailableAllDay: boolean, windows = effectiveDayWindows) => {
    const override = { date: selectedDate, unavailableAllDay, windows: unavailableAllDay ? [] : windows };
    updateDraft({ ...draft, overrides: [...draft.overrides.filter(item => item.date !== selectedDate), override].sort((a, b) => a.date.localeCompare(b.date)) });
  };
  const clearOverride = () => updateDraft({ ...draft, overrides: draft.overrides.filter(item => item.date !== selectedDate) });

  const addBlock = () => {
    if (!blockStart || !blockEnd || blockStart > blockEnd) { setStatus('Choose a valid start and end date'); return; }
    const additions = [];
    const cursor = new Date(`${blockStart}T12:00:00`);
    const end = new Date(`${blockEnd}T12:00:00`);
    while (cursor <= end && additions.length < 366) {
      additions.push({ date: localDate(cursor), unavailableAllDay: true, windows: [] });
      cursor.setDate(cursor.getDate() + 1);
    }
    const dates = new Set(additions.map(item => item.date));
    updateDraft({ ...draft, overrides: [...draft.overrides.filter(item => !dates.has(item.date)), ...additions].sort((a, b) => a.date.localeCompare(b.date)) });
    setStatus(`${additions.length} ${additions.length === 1 ? 'day' : 'days'} blocked. Save to apply.`);
    setBlockStart(''); setBlockEnd('');
  };
  const addExclusion = () => {
    if (!exclusion.startDate || !exclusion.endDate || exclusion.endDate < exclusion.startDate) { setStatus('Choose a valid exclusion date range'); return; }
    updateDraft({ ...draft, exclusions: [...(draft.exclusions || []), exclusion] });
    setExclusion({ kind: 'holiday', startDate: '', endDate: '', label: '' });
    setStatus('Holiday or out-of-office range added. Save to apply.');
  };

  const monthDays = useMemo(() => {
    const first = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1);
    const cursor = new Date(first); cursor.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, () => { const value = new Date(cursor); cursor.setDate(cursor.getDate() + 1); return value; });
  }, [monthCursor]);

  return <div className="availability-workspace">
    <div className="scheduler-section-title"><div><h1>Availability</h1><p>Set your normal hours once, then make exceptions for specific dates.</p></div><div className="availability-save"><span className={saveError ? 'error' : ''} role="status" aria-live="polite" aria-atomic="true">{saveStatus}</span><button className="btn btn-primary" type="button" disabled={!isDirty || isSaving || validationMessages.length > 0} onClick={() => void save()}>Save availability</button></div></div>
    {!draft.published && <section className="availability-callout"><CalendarDays size={20} /><div><strong>Publish your default schedule to start taking bookings</strong><span>Until you create an event type, visitors will be offered a private, system-managed 30-minute booking option.</span>{publishValidationMessages.map(message => <span className="availability-callout-error" key={message}>{message}</span>)}</div><button className="btn btn-primary" type="button" disabled={isSaving || publishValidationMessages.length > 0} onClick={() => void enableBooking()}>Enable booking now</button></section>}
    {validationMessages.length > 0 && <div id="availability-validation" className="availability-validation" role="alert"><strong>Fix before saving</strong><ul>{validationMessages.map(message => <li key={message}>{message}</li>)}</ul></div>}
    <section className="availability-toolbar">
      <div className="segmented-control" aria-label="Availability view">{(['week', 'month', 'day'] as View[]).map(item => <button type="button" className={view === item ? 'active' : ''} onClick={() => setView(item)} key={item}>{item[0].toUpperCase() + item.slice(1)}</button>)}</div>
      <label>Schedule name<input aria-invalid={!draft.name.trim() || undefined} aria-describedby={!draft.name.trim() ? 'availability-validation' : undefined} value={draft.name} onChange={event => updateDraft({ ...draft, name: event.target.value })} /></label>
      <label>Time zone<select value={draft.timeZone} onChange={event => updateDraft({ ...draft, timeZone: event.target.value })}>{!timeZones.includes(draft.timeZone) && <option>{draft.timeZone}</option>}{timeZones.map(zone => <option value={zone} key={zone}>{zone.replaceAll('_', ' ')}</option>)}</select></label>
      <label className="availability-publish"><input type="checkbox" checked={draft.published} onChange={event => updateDraft({ ...draft, published: event.target.checked })} /><span>Bookable</span></label>
    </section>

    {view === 'week' && <section className="availability-card"><header><div><h2>Default week</h2><p>Use multiple windows for split shifts, breaks, or extended appointments.</p></div><button className="btn btn-secondary" type="button" onClick={() => { const monday = windowsFor(1); updateDraft({ ...draft, windows: [0, 1, 2, 3, 4, 5, 6].flatMap(weekday => monday.map(window => ({ ...window, weekday }))) }); }}><Copy size={15} /> Copy Monday to all days</button></header><div className="availability-week">{WEEKDAYS.map((day, weekday) => {
      const windows = windowsFor(weekday);
      return <div className="availability-week-row" key={day}><label className="weekday-toggle"><input type="checkbox" checked={windows.length > 0} onChange={event => replaceDay(weekday, event.target.checked ? [{ weekday, startMinute: 540, endMinute: 1020 }] : [])} /><strong>{day}</strong></label><div className="availability-window-stack">{windows.length === 0 ? <span className="unavailable">Unavailable</span> : windows.map((window, index) => {
        const invalid = windowHasIssue(window, windows, index);
        return <div className="availability-window" key={`${weekday}-${index}`}><input aria-label={`${day} start ${index + 1}`} aria-invalid={invalid || undefined} aria-describedby={invalid ? 'availability-validation' : undefined} step={300} type="time" value={minutesToTime(window.startMinute)} onChange={event => replaceDay(weekday, windows.map((item, itemIndex) => itemIndex === index ? { ...item, startMinute: timeToMinutes(event.target.value) } : item))} /><span>to</span><input aria-label={`${day} end ${index + 1}`} aria-invalid={invalid || undefined} aria-describedby={invalid ? 'availability-validation' : undefined} step={300} type="time" value={minutesToTime(window.endMinute)} onChange={event => replaceDay(weekday, windows.map((item, itemIndex) => itemIndex === index ? { ...item, endMinute: timeToMinutes(event.target.value) } : item))} /><button type="button" className="icon-button danger" aria-label={`Remove ${day} window`} onClick={() => replaceDay(weekday, windows.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button></div>;
      })}</div><button type="button" className="icon-button" aria-label={`Add ${day} hours`} title="Add hours" disabled={(windows.at(-1)?.endMinute ?? 0) >= 1439} onClick={() => replaceDay(weekday, [...windows, { weekday, ...nextWindow(windows.at(-1)?.endMinute) }])}><Plus size={16} /></button></div>;
    })}</div></section>}

    {view === 'month' && <section className="availability-card"><header className="availability-month-header"><button className="icon-button" type="button" aria-label="Previous month" onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1))}><ChevronLeft size={18} /></button><h2>{monthCursor.toLocaleDateString([], { month: 'long', year: 'numeric' })}</h2><button className="icon-button" type="button" aria-label="Next month" onClick={() => setMonthCursor(new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1))}><ChevronRight size={18} /></button></header><div className="availability-month-weekdays">{WEEKDAYS.map(day => <span key={day}>{day.slice(0, 3)}</span>)}</div><div className="availability-month-grid">{monthDays.map(day => {
      const date = localDate(day); const override = draft.overrides.find(item => item.date === date); const normal = windowsFor(day.getDay()).length > 0;
      return <button type="button" key={date} className={`${day.getMonth() !== monthCursor.getMonth() ? 'outside' : ''} ${override?.unavailableAllDay ? 'blocked' : override ? 'custom' : normal ? 'available' : ''}`} onClick={() => { setSelectedDate(date); setView('day'); }}><strong>{day.getDate()}</strong><span>{override?.unavailableAllDay ? 'Blocked' : override ? 'Custom' : normal ? 'Open' : 'Off'}</span></button>;
    })}</div></section>}

    {view === 'day' && <section className="availability-card"><header><div><h2>Date override</h2><p>Change one date without changing your default week.</p></div><input aria-label="Selected availability date" type="date" value={selectedDate} onChange={event => setSelectedDate(event.target.value)} /></header><div className="availability-day-actions"><button type="button" className={`btn ${dateOverride?.unavailableAllDay ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setOverride(true)}>Unavailable all day</button><button type="button" className={`btn ${dateOverride && !dateOverride.unavailableAllDay ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setOverride(false)}>Custom hours</button>{dateOverride && <button type="button" className="btn btn-secondary" onClick={clearOverride}>Use default hours</button>}</div>{dateOverride && !dateOverride.unavailableAllDay && <div className="availability-window-stack availability-day-windows">{dateOverride.windows.map((window, index) => {
      const invalid = windowHasIssue(window, dateOverride.windows, index);
      return <div className="availability-window" key={index}><input aria-label={`Selected date start ${index + 1}`} aria-invalid={invalid || undefined} aria-describedby={invalid ? 'availability-validation' : undefined} step={300} type="time" value={minutesToTime(window.startMinute)} onChange={event => setOverride(false, dateOverride.windows.map((item, itemIndex) => itemIndex === index ? { ...item, startMinute: timeToMinutes(event.target.value) } : item))} /><span>to</span><input aria-label={`Selected date end ${index + 1}`} aria-invalid={invalid || undefined} aria-describedby={invalid ? 'availability-validation' : undefined} step={300} type="time" value={minutesToTime(window.endMinute)} onChange={event => setOverride(false, dateOverride.windows.map((item, itemIndex) => itemIndex === index ? { ...item, endMinute: timeToMinutes(event.target.value) } : item))} /><button className="icon-button danger" type="button" aria-label="Remove hours" onClick={() => setOverride(false, dateOverride.windows.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button></div>;
    })}<button className="btn btn-secondary" type="button" disabled={(dateOverride.windows.at(-1)?.endMinute ?? 0) >= 1439} onClick={() => setOverride(false, [...dateOverride.windows, nextWindow(dateOverride.windows.at(-1)?.endMinute)])}><Plus size={15} /> Add hours</button></div>}<div className="availability-preview"><div><strong>30-minute default booking preview</strong><span>Checks the selected date against your connected calendars and overrides.</span></div><button className="btn btn-secondary" type="button" onClick={() => void runPreview()}>Check availability</button>{preview && <p><strong>{preview.slots.length}</strong> bookable times · {preview.busyIntervalCount} busy calendar {preview.busyIntervalCount === 1 ? 'event' : 'events'} · {preview.overrideCount} date {preview.overrideCount === 1 ? 'override' : 'overrides'}</p>}</div></section>}

    <section className="availability-card availability-block"><div><h2>Block a date range</h2><p>Turn off a vacation, holiday, salon closure, or any other all-day period.</p></div><label>From<input type="date" value={blockStart} onChange={event => setBlockStart(event.target.value)} /></label><label>Through<input type="date" value={blockEnd} min={blockStart} onChange={event => setBlockEnd(event.target.value)} /></label><button className="btn btn-secondary" type="button" onClick={addBlock}>Block dates</button></section>
    <section className="availability-card availability-exclusions"><header><div><h2>Holidays and out of office</h2><p>Label reusable closure ranges so the reason stays clear to you without appearing publicly.</p></div></header><div className="availability-exclusion-form"><label>Type<select value={exclusion.kind} onChange={event => setExclusion({ ...exclusion, kind: event.target.value as SchedulerAvailabilityExclusion['kind'] })}><option value="holiday">Holiday</option><option value="out_of_office">Out of office</option></select></label><label>From<input type="date" value={exclusion.startDate} onChange={event => setExclusion({ ...exclusion, startDate: event.target.value, endDate: exclusion.endDate || event.target.value })} /></label><label>Through<input type="date" min={exclusion.startDate} value={exclusion.endDate} onChange={event => setExclusion({ ...exclusion, endDate: event.target.value })} /></label><label>Label<input maxLength={160} value={exclusion.label} onChange={event => setExclusion({ ...exclusion, label: event.target.value })} placeholder="Company holiday" /></label><button className="btn btn-secondary" type="button" onClick={addExclusion}>Add range</button></div>{(draft.exclusions || []).length === 0 ? <p className="public-muted">No labeled exclusions.</p> : <div className="availability-exclusion-list">{draft.exclusions.map((item, index) => <article key={item.id || `${item.startDate}-${index}`}><div><strong>{item.label || (item.kind === 'holiday' ? 'Holiday' : 'Out of office')}</strong><span>{item.startDate} through {item.endDate} · {item.kind === 'holiday' ? 'Holiday' : 'Out of office'}</span></div><button type="button" className="icon-button danger" aria-label={`Remove exclusion ${index + 1}`} onClick={() => updateDraft({ ...draft, exclusions: draft.exclusions.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={15} /></button></article>)}</div>}</section>
  </div>;
}
