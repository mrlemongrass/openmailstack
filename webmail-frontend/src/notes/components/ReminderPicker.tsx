import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Clock, X } from 'lucide-react';
import { fetchNoteReminder, saveNoteReminder, deleteNoteReminder } from '../../shared/api';

interface ReminderPickerProps {
  noteId: string | undefined;
}

export function ReminderPicker({ noteId }: ReminderPickerProps) {
  const [remindAt, setRemindAt] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const abortedRef = useRef(false);

  useEffect(() => {
    if (!noteId || noteId === 'new') return;
    abortedRef.current = false;
    fetchNoteReminder(noteId).then((r) => {
      if (!abortedRef.current && r) setRemindAt(r.remind_at);
    }).catch((e) => { console.error('Failed to fetch reminder', e); });
    return () => { abortedRef.current = true; };
  }, [noteId]);

  // Convert UTC ISO string to local datetime-local format (YYYY-MM-DDTHH:MM)
  const toLocalDatetime = (isoString: string): string => {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const handleSet = useCallback(async (datetime: string) => {
    if (!noteId || noteId === 'new') return;
    setLoading(true);
    try {
      await saveNoteReminder(noteId, datetime);
      setRemindAt(datetime);
      setIsOpen(false);
    } catch (e) {
      console.error('Failed to set reminder', e);
    }
    setLoading(false);
  }, [noteId]);

  const handleClear = useCallback(async () => {
    if (!noteId || noteId === 'new') return;
    setLoading(true);
    try {
      await deleteNoteReminder(noteId);
      setRemindAt(null);
      setIsOpen(false);
    } catch (e) {
      console.error('Failed to clear reminder', e);
    }
    setLoading(false);
  }, [noteId]);

  // Format date for display
  const formatted = remindAt
    ? new Date(remindAt).toLocaleString(undefined, {
        month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit'
      })
    : null;

  // For new notes, show disabled state
  if (!noteId || noteId === 'new') {
    return (
      <button className="btn btn-ghost btn-sm" disabled title="Save note first to set a reminder">
        <Clock size={16} style={{ opacity: 0.4 }} />
      </button>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        className={`btn btn-ghost btn-sm ${remindAt ? 'has-reminder' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title={formatted || 'Set reminder'}
        style={{ color: remindAt ? 'var(--accent-primary)' : undefined }}
      >
        <Clock size={16} />
        {formatted && (
          <span style={{ fontSize: '0.7rem', marginLeft: 4 }}>{formatted}</span>
        )}
      </button>
      {isOpen && (
        <div className="reminder-popover" style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 10,
          background: 'var(--bg-secondary)', border: '1px solid var(--border-glass)',
          borderRadius: 'var(--radius-md)', padding: 12, minWidth: 240,
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8 }}>Set reminder</div>
          <input
            type="datetime-local"
            className="glass-input"
            value={remindAt ? toLocalDatetime(remindAt) : ''}
            onChange={(e) => {
              const val = e.target.value;
              if (!val) return;
              handleSet(new Date(val).toISOString());
            }}
            style={{ width: '100%', marginBottom: 8, fontSize: '0.85rem' }}
            disabled={loading}
          />
          {remindAt && (
            <button
              className="btn btn-ghost btn-xs"
              onClick={handleClear}
              disabled={loading}
              style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}
            >
              <X size={12} /> Clear reminder
            </button>
          )}
        </div>
      )}
    </div>
  );
}
