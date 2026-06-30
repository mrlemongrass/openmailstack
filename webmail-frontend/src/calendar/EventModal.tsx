import { useState, useEffect } from 'react';
import { X, Save, Trash2, Video, Paperclip, Plus, Minus } from 'lucide-react';
import type { useCalendar } from './hooks/useCalendar';
import { format } from 'date-fns';

const VIDEO_PROVIDERS = [
  { name: 'Google Meet', prefix: 'https://meet.google.com/' },
  { name: 'Zoom', prefix: 'https://zoom.us/j/' },
  { name: 'Microsoft Teams', prefix: 'https://teams.microsoft.com/l/meetup-join/' },
];

function generateVideoId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 12; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

export function EventModal({ cal }: { cal: ReturnType<typeof useCalendar> }) {
  if (!cal.isEventModalOpen) return null;
  const evt = cal.newEvent;
  const isEditing = !!cal.editingEvent;

  const [guestInput, setGuestInput] = useState('');
  const [guests, setGuests] = useState<string[]>((evt.guests as string[]) || []);
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);

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

  useEffect(() => {
    if (guests.length > 0) {
      cal.setNewEvent((prev) => ({ ...prev, guests }));
    }
  }, [guests]);

  // #2 Free/busy lookup when guests change
  useEffect(() => {
    if (guests.length > 0 && evt.start) {
      cal.lookupFreeBusy(guests, evt.start as Date, evt.end as Date);
    }
  }, [guests.length]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) cal.setIsEventModalOpen(false); }}>
      <div className="glass-panel" style={{ width: 600, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid var(--border-glass)' }}>
          <span style={{ fontWeight: 600 }}>{isEditing ? 'Edit Event' : 'New Event'}</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {isEditing && cal.editingEvent?.id && <button className="btn btn-danger" onClick={() => { cal.deleteEvent(cal.editingEvent!.id!, cal.editingEvent!.calendarId || 0); cal.setIsEventModalOpen(false); }} style={{ padding: '4px 10px' }}><Trash2 size={14} /> Delete</button>}
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
              value={evt.start ? format(evt.start as Date, "yyyy-MM-dd'T'HH:mm") : ''}
              onChange={(e) => cal.setNewEvent((prev) => ({ ...prev, start: new Date(e.target.value) }))}
              style={{ flex: 1, fontSize: '0.85rem' }} />
            {!evt.isAllDay && <input type="datetime-local" className="glass-input"
              value={evt.end ? format(evt.end as Date, "yyyy-MM-dd'T'HH:mm") : ''}
              onChange={(e) => cal.setNewEvent((prev) => ({ ...prev, end: new Date(e.target.value) }))}
              style={{ flex: 1, fontSize: '0.85rem' }} />}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked={evt.isAllDay || false}
              onChange={(e) => cal.setNewEvent((prev) => ({ ...prev, isAllDay: e.target.checked }))} />
            All day
          </label>

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
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="glass-input" placeholder="Add guest email..." value={guestInput}
                onChange={(e) => setGuestInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddGuest(); } }}
                style={{ flex: 1, fontSize: '0.85rem' }} />
              <button className="btn btn-ghost" onClick={handleAddGuest}><Plus size={14} /></button>
            </div>
            {guests.map((g) => (
              <div key={g} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '4px 8px', marginTop: 4, borderRadius: 4, background: 'rgba(255,255,255,0.03)', fontSize: '0.8rem' }}>
                <span>{g}</span>
                {/* #2 Free/busy indicator */}
                {cal.freeBusyLoading ? <span style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>checking...</span> :
                  cal.freeBusy[g] && cal.freeBusy[g].some((b) => new Date(b.start) <= (evt.end as Date) && new Date(b.end) >= (evt.start as Date)) ?
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
          <button className="btn btn-primary" onClick={cal.saveEvent} disabled={cal.eventSaving}>
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
