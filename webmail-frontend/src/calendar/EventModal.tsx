import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Save, Trash2, Video, Paperclip, Plus, Minus } from 'lucide-react';
import type { useCalendar } from './hooks/useCalendar';
import { format } from 'date-fns';
import * as api from '../shared/api';
import { useToast } from '../shared/components/Toast';
import type { Contact } from '../shared/types';
import {
  addWallDays,
  convertWallDateTimeZone,
  supportedTimeZones,
  wallDateToInstant,
  type CalendarTimeKind,
} from './calendarTime';

const VIDEO_PROVIDERS = [
  { name: 'Google Meet', prefix: 'https://meet.google.com/' },
  { name: 'Zoom', prefix: 'https://zoom.us/j/' },
  { name: 'Microsoft Teams', prefix: 'https://teams.microsoft.com/l/meetup-join/' },
];

function parseWallInput(value: string, allDay: boolean): Date {
  if (!allDay) return new Date(value);
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0);
}

function allDaySpan(start: Date | undefined, end: Date | undefined): number {
  if (!start || !end) return 1;
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(1, Math.round((endDay - startDay) / 86400000));
}

function generateVideoId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 12; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

export function EventModal({ cal }: { cal: ReturnType<typeof useCalendar> }) {
  const { showToast } = useToast();

  // ── All hooks MUST be before the early return ──────────────────────────

  const [guestInput, setGuestInput] = useState('');
  const [guests, setGuests] = useState<string[]>([]);
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);

  // Contact autocomplete for guest field
  const [guestSuggestions, setGuestSuggestions] = useState<{ name: string; email: string }[]>([]);
  const [guestSelectedIndex, setGuestSelectedIndex] = useState(0);
  const guestBlurRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [allGuestContacts, setAllGuestContacts] = useState<{ name: string; email: string }[]>([]);

  useEffect(() => {
    api.fetchContacts(500, 0).then((data) => {
      if (data.contacts) {
        setAllGuestContacts((data.contacts as Contact[])
          .filter((c) => c.email)
          .map((c) => ({ name: c.name || '', email: c.email })));
      }
    }).catch(() => {});
  }, []);

  const handleGuestInputChange = useCallback((value: string) => {
    setGuestInput(value);
    if (value.length >= 2) {
      const lower = value.toLowerCase();
      const filtered = allGuestContacts.filter((c) =>
        c.name.toLowerCase().includes(lower) || c.email.toLowerCase().includes(lower)
      ).slice(0, 6);
      setGuestSuggestions(filtered);
      setGuestSelectedIndex(0);
    } else {
      setGuestSuggestions([]);
    }
  }, [allGuestContacts]);

  const selectGuestSuggestion = useCallback((s: { name: string; email: string }) => {
    const email = s.email.trim();
    if (email && !guests.includes(email)) {
      setGuests([...guests, email]);
    }
    setGuestInput('');
    setGuestSuggestions([]);
  }, [guests]);

  const handleGuestKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (guestSuggestions.length === 0) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const email = guestInput.trim();
        if (email && email.includes('@') && !guests.includes(email)) {
          setGuests((prev) => [...prev, email]);
          setGuestInput('');
        }
      }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setGuestSelectedIndex((p) => (p + 1) % guestSuggestions.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setGuestSelectedIndex((p) => (p - 1 + guestSuggestions.length) % guestSuggestions.length); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); selectGuestSuggestion(guestSuggestions[guestSelectedIndex]); }
    else if (e.key === 'Escape') { setGuestSuggestions([]); }
  }, [guestSuggestions, guestSelectedIndex, selectGuestSuggestion, guestInput, guests]);

  const handleGuestBlur = useCallback(() => {
    guestBlurRef.current = setTimeout(() => setGuestSuggestions([]), 150);
  }, []);

  const handleGuestFocus = useCallback(() => {
    if (guestBlurRef.current) { clearTimeout(guestBlurRef.current); guestBlurRef.current = null; }
    if (guestInput.length >= 2) handleGuestInputChange(guestInput);
  }, [guestInput, handleGuestInputChange]);

  // Sync guests to newEvent and trigger free/busy lookup
  useEffect(() => {
    const evt = cal.newEvent;
    if (guests.length > 0) {
      cal.setNewEvent((prev) => ({ ...prev, guests }));
    }
    if (guests.length > 0 && evt.start) {
      cal.lookupFreeBusy(guests, evt.start as Date, evt.end as Date);
    }
  }, [guests, cal]);

  // Initialize guests when modal opens
  useEffect(() => {
    if (cal.isEventModalOpen) {
      const timer = window.setTimeout(() => setGuests((cal.newEvent.guests as string[]) || []), 0);
      return () => window.clearTimeout(timer);
    }
  }, [cal.isEventModalOpen, cal.newEvent.guests]);

  // ── Early return after all hooks ──────────────────────────────────────

  if (!cal.isEventModalOpen) return null;

  const evt = cal.newEvent;
  const isEditing = !!cal.editingEvent;
  const eventTimeKind = (evt.timeKind || 'zoned') as CalendarTimeKind;
  const eventTimeZoneValue = eventTimeKind === 'floating'
    ? '__floating__'
    : eventTimeKind === 'utc' ? '__utc__' : (evt.timeZone || cal.displayTimeZone);
  const eventInstantPreview = !evt.isAllDay && eventTimeKind !== 'floating' && evt.start
    ? wallDateToInstant(evt.start as Date, eventTimeKind, eventTimeKind === 'utc' ? 'UTC' : (evt.timeZone || cal.displayTimeZone)).toISOString()
    : null;

  const handleEventTimeZoneChange = (value: string) => {
    const nextKind: CalendarTimeKind = value === '__floating__' ? 'floating' : value === '__utc__' ? 'utc' : 'zoned';
    const nextTimeZone = nextKind === 'floating' ? null : nextKind === 'utc' ? 'UTC' : value;
    cal.setNewEvent(prev => {
      const currentKind = (prev.timeKind || 'zoned') as CalendarTimeKind;
      const currentTimeZone = currentKind === 'utc' ? 'UTC' : (prev.timeZone || cal.displayTimeZone);
      return {
        ...prev,
        start: prev.start ? convertWallDateTimeZone(prev.start as Date, currentKind, currentTimeZone, nextKind, nextTimeZone) : prev.start,
        end: prev.end ? convertWallDateTimeZone(prev.end as Date, currentKind, currentTimeZone, nextKind, nextTimeZone) : prev.end,
        timeKind: nextKind,
        timeZone: nextTimeZone,
      };
    });
  };

  const handleSave = async () => {
    const ok = await cal.saveEvent();
    if (ok !== false) {
      showToast({ type: 'success', message: isEditing ? 'Event updated' : 'Event created' });
    }
  };

  // #4 Video call generation
  const addVideoLink = (provider: typeof VIDEO_PROVIDERS[number]) => {
    const id = generateVideoId();
    cal.setNewEvent((prev) => ({ ...prev, location: `${provider.name}: ${provider.prefix}${id}` }));
  };

  // #10 Event attachments
  const attachmentSize = attachmentFiles.reduce((s, f) => s + f.size, 0);

  const handleAddGuest = () => {
    const email = guestInput.trim();
    if (email && email.includes('@') && !guests.includes(email)) {
      setGuests([...guests, email]);
      setGuestInput('');
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) cal.setIsEventModalOpen(false); }}>
      <div className="glass-panel" style={{ width: 'min(600px, 100%)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid var(--border-glass)' }}>
          <span style={{ fontWeight: 600 }}>{isEditing ? 'Edit Event' : 'New Event'}</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {isEditing && cal.editingEvent?.id && <button className="btn btn-danger" onClick={async () => { await cal.deleteEvent(cal.editingEvent!.id!, cal.editingEvent!.calendarId || 0); showToast({ type: 'success', message: 'Event deleted' }); cal.setIsEventModalOpen(false); }} style={{ padding: '4px 10px' }}><Trash2 size={14} /> Delete</button>}
            <button className="btn btn-ghost" onClick={() => cal.setIsEventModalOpen(false)} style={{ padding: 4 }}><X size={18} /></button>
          </div>
        </div>
        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cal.eventError && <div style={{ padding: '8px 12px', borderRadius: 'var(--radius-md)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--danger)', fontSize: '0.8rem' }}>{cal.eventError}</div>}

          <input className="glass-input" placeholder="Event title" autoFocus
            value={evt.title || ''} onChange={(e) => cal.setNewEvent((prev) => ({ ...prev, title: e.target.value }))} />

          <div style={{ display: 'flex', gap: 8 }}>
            <input type={evt.isAllDay ? 'date' : 'datetime-local'} className="glass-input"
              value={evt.start ? format(evt.start as Date, evt.isAllDay ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm") : ''}
              onChange={(e) => cal.setNewEvent((prev) => {
                const start = parseWallInput(e.target.value, Boolean(evt.isAllDay));
                return {
                  ...prev,
                  start,
                  end: evt.isAllDay ? addWallDays(start, allDaySpan(prev.start as Date | undefined, prev.end as Date | undefined)) : prev.end,
                };
              })}
              style={{ flex: 1, fontSize: '0.85rem' }} />
            {!evt.isAllDay && <input type="datetime-local" className="glass-input"
              value={evt.end ? format(evt.end as Date, "yyyy-MM-dd'T'HH:mm") : ''}
              onChange={(e) => cal.setNewEvent((prev) => ({ ...prev, end: new Date(e.target.value) }))}
              style={{ flex: 1, fontSize: '0.85rem' }} />}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={evt.isAllDay || false}
              onChange={(e) => cal.setNewEvent((prev) => {
                const start = prev.start || cal.displayNow;
                return {
                  ...prev,
                  isAllDay: e.target.checked,
                  timeKind: e.target.checked ? 'all-day' : (prev.timeKind === 'all-day' ? 'zoned' : prev.timeKind),
                  timeZone: e.target.checked ? null : (prev.timeZone || cal.displayTimeZone),
                  end: e.target.checked ? addWallDays(start as Date, 1) : new Date((start as Date).getTime() + cal.calendarSettings.defaultEventDurationMinutes * 60000),
                };
              })} />
            All day
          </label>

          {!evt.isAllDay && (
            <label className="settings-field" style={{ margin: 0 }}>
              <span>Event Time Zone</span>
              <select className="glass-input glass-select" value={eventTimeZoneValue} onChange={event => handleEventTimeZoneChange(event.target.value)}>
                <option value="__floating__">Floating time</option>
                <option value="__utc__">UTC instant</option>
                {supportedTimeZones().map(timeZone => <option key={timeZone} value={timeZone}>{timeZone.replace(/_/g, ' ')}</option>)}
              </select>
              {eventTimeKind === 'floating' ? (
                <small role="note">Floating time keeps this wall time everywhere. Assigning a zone keeps the wall time and changes the represented instant.</small>
              ) : (
                <small>Changing zones preserves the instant. Stored instant: {eventInstantPreview?.replace('.000Z', 'Z')}</small>
              )}
            </label>
          )}

          {/* Calendar selector */}
          {cal.calendars.length > 0 && (
            <select className="glass-select glass-input" value={evt.calendarId || cal.calendars[0]?.id}
              onChange={(e) => cal.setNewEvent((prev) => ({ ...prev, calendarId: parseInt(e.target.value) }))}
              style={{ fontSize: '0.85rem' }}>
              {cal.calendars.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}

          <input className="glass-input" placeholder="Location" value={evt.location || ''}
            onChange={(e) => cal.setNewEvent((prev) => ({ ...prev, location: e.target.value }))} />

          {/* #4 Video call links */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Video size={14} style={{ color: 'var(--text-secondary)' }} />
            {VIDEO_PROVIDERS.map((p) => (
              <button key={p.name} className="btn btn-ghost" onClick={() => addVideoLink(p)}
                style={{ fontSize: '0.75rem', padding: '3px 8px' }}>
                + {p.name}
              </button>
            ))}
          </div>

          {/* Guests */}
          <div>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>Guests</div>
            <div style={{ display: 'flex', gap: 6, position: 'relative' }}>
              <input className="glass-input" placeholder="Add guest email..." value={guestInput}
                onChange={(e) => handleGuestInputChange(e.target.value)}
                onKeyDown={handleGuestKeyDown}
                onFocus={handleGuestFocus}
                onBlur={handleGuestBlur}
                autoComplete="off"
                style={{ flex: 1, fontSize: '0.85rem' }} />
              <button className="btn btn-ghost" onClick={handleAddGuest}><Plus size={14} /></button>
              {guestSuggestions.length > 0 && (
                <div className="glass-panel" style={{ position: 'absolute', top: '100%', left: 0, right: 48, zIndex: 50,
                  marginTop: 2, maxHeight: 160, overflow: 'auto', padding: 4 }}>
                  {guestSuggestions.map((s, i) => (
                    <div key={s.email}
                      onMouseDown={(e) => { e.preventDefault(); selectGuestSuggestion(s); }}
                      style={{
                        padding: '8px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                        background: i === guestSelectedIndex ? 'var(--accent-primary)' : 'transparent',
                        color: i === guestSelectedIndex ? '#fff' : 'var(--text-primary)',
                        fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: 1,
                      }}>
                      <span style={{ fontWeight: 600 }}>{s.name || s.email}</span>
                      {s.name && <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>{s.email}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {guests.map((g) => (
              <div key={g} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '4px 8px', marginTop: 4, borderRadius: 4, background: 'rgba(255,255,255,0.03)', fontSize: '0.8rem' }}>
                <span>{g}</span>
                {/* #2 Free/busy indicator */}
                {cal.freeBusyLoading ? <span style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>checking...</span> :
                  cal.freeBusy[g] && cal.freeBusy[g].some((b) => new Date(b.start) <= cal.draftWallDateToInstant(evt.end as Date) && new Date(b.end) >= cal.draftWallDateToInstant(evt.start as Date)) ?
                    <span style={{ color: '#f59e0b', fontSize: '0.7rem' }}>⚠ Busy</span> :
                    <span style={{ color: '#10b981', fontSize: '0.7rem' }}>Free</span>}
                <button className="btn btn-ghost" onClick={() => setGuests(guests.filter((x) => x !== g))}
                  style={{ padding: '1px 4px' }}><Minus size={12} /></button>
              </div>
            ))}
          </div>

          {/* #10 Event attachments */}
          <div>
            <label className="btn btn-ghost" style={{ cursor: 'pointer', fontSize: '0.8rem' }}>
              <Paperclip size={14} /> Attach files
              <input type="file" multiple hidden onChange={(e) => {
                if (e.target.files) setAttachmentFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
              }} />
            </label>
            {attachmentFiles.length > 0 && (
              <div style={{ marginTop: 4 }}>
                {attachmentFiles.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6,
                    padding: '3px 8px', fontSize: '0.75rem', color: 'var(--accent-primary)' }}>
                    <Paperclip size={10} /> {f.name} ({formatBytes(f.size)})
                    <X size={10} style={{ cursor: 'pointer' }} onClick={() => setAttachmentFiles((prev) => prev.filter((_, j) => j !== i))} />
                  </div>
                ))}
                {attachmentSize > 0 && <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: 2 }}>Total: {formatBytes(attachmentSize)}</div>}
              </div>
            )}
          </div>

          {/* Toggle advanced */}
          <button className="btn btn-ghost" style={{ fontSize: '0.8rem', alignSelf: 'flex-start' }}
            onClick={() => cal.setIsAdvancedEventMode(!cal.isAdvancedEventMode)}>
            {cal.isAdvancedEventMode ? '▲ Less options' : '▼ More options'}
          </button>

          {cal.isAdvancedEventMode && (
            <>
              <textarea className="glass-input" placeholder="Description"
                value={evt.description || ''} onChange={(e) => cal.setNewEvent((prev) => ({ ...prev, description: e.target.value }))}
                style={{ minHeight: 80, resize: 'vertical' }} />

              <select className="glass-select glass-input" value={evt.recurrence || 'none'}
                onChange={(e) => cal.setNewEvent((prev) => ({ ...prev, recurrence: e.target.value }))}
                style={{ fontSize: '0.85rem' }}>
                <option value="none">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </>
          )}
        </div>
        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
          padding: '12px 16px', borderTop: '1px solid var(--border-glass)' }}>
          <button className="btn btn-ghost" onClick={() => cal.setIsEventModalOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={cal.eventSaving}>
            <Save size={14} /> {cal.eventSaving ? 'Saving...' : 'Save Event'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
