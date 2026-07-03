import { CalendarPlus, MapPin, Clock, User, Check } from 'lucide-react';
import { format } from 'date-fns';
import type { CalendarData, CalendarInvite } from '../types';
import { useState, useMemo } from 'react';

/** Parse minimal ICS VEVENT data for display. */
function parseIcsInvite(ics: string): CalendarInvite | null {
  try {
    const title = ics.match(/^SUMMARY(?:;.*?)?:(.+)$/im)?.[1]?.replace(/\\,/g, ',').trim();
    const location = ics.match(/^LOCATION(?:;.*?)?:(.+)$/im)?.[1]?.replace(/\\,/g, ',').trim();
    const desc = ics.match(/^DESCRIPTION(?:;.*?)?:(.+)$/im)?.[1]?.replace(/\\n/g, '\n').replace(/\\,/g, ',').trim();
    const organizer = ics.match(/^ORGANIZER(?:;.*?)?:mailto:(.+)$/im)?.[1]?.trim();

    const parseDate = (field: string): Date | null => {
      const m = ics.match(new RegExp(`^${field}(?:;.*?)?:(\\d{8}T\\d{6}Z?)`, 'im'));
      if (!m) return null;
      const v = m[1];
      const y = parseInt(v.slice(0, 4)), mo = parseInt(v.slice(4, 6)) - 1, d = parseInt(v.slice(6, 8));
      const h = parseInt(v.slice(9, 11)), mi = parseInt(v.slice(11, 13)), s = parseInt(v.slice(13, 15));
      return new Date(Date.UTC(y, mo, d, h, mi, s));
    };

    const start = parseDate('DTSTART');
    const end = parseDate('DTEND');

    if (!title || !start) return null;

    return { title, start, end: end || new Date(start.getTime() + 3600000), location, description: desc, organizer };
  } catch {
    return null;
  }
}

export function CalendarInviteCard({ calendarData }: { calendarData?: CalendarData }) {
  const invite = useMemo(() => {
    if (!calendarData?.ics) return null;
    return parseIcsInvite(calendarData.ics);
  }, [calendarData?.ics]);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!invite) return null;

  const handleAddToCalendar = async () => {
    setSaving(true);
    try {
      // Use existing API — POST ICS data as a new event
      const res = await fetch('/api/apps/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: calendarData?.ics }),
      });
      const result = await res.json();
      if (result.success || result.event) {
        setSaved(true);
      }
    } catch (e) {
      console.error('Failed to add event to calendar', e);
    }
    setSaving(false);
  };

  const isPast = invite.end < new Date();

  return (
    <div className="glass-panel" style={{
      margin: '12px 0', padding: 16, borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border-glass)',
      background: 'linear-gradient(135deg, rgba(59,130,246,0.08), rgba(139,92,246,0.08))',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {/* Calendar icon */}
        <div style={{
          width: 44, height: 44, borderRadius: 'var(--radius-md)',
          background: 'rgba(59,130,246,0.15)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <CalendarPlus size={22} style={{ color: 'var(--accent-primary)' }} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: 2 }}>
            {invite.title}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginTop: 6 }}>
            {/* Date/time */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4,
              color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
              <Clock size={13} />
              <span>
                {format(invite.start, 'EEE, MMM d, yyyy')}
                {' · '}
                {format(invite.start, 'h:mm a')}
                {' – '}
                {format(invite.end, 'h:mm a')}
              </span>
            </div>

            {/* Location */}
            {invite.location && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4,
                color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                <MapPin size={13} />
                <span>{invite.location}</span>
              </div>
            )}

            {/* Organizer */}
            {invite.organizer && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4,
                color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                <User size={13} />
                <span>Organized by {invite.organizer}</span>
              </div>
            )}
          </div>

          {/* Description */}
          {invite.description && (
            <div style={{
              marginTop: 8, padding: '8px 10px', borderRadius: 'var(--radius-sm)',
              background: 'rgba(255,255,255,0.04)', fontSize: '0.8rem',
              color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap',
            }}>
              {invite.description}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {saved ? (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '6px 14px', borderRadius: 'var(--radius-md)',
                background: 'rgba(16,185,129,0.15)', color: '#10b981',
                fontSize: '0.8rem', fontWeight: 600,
              }}>
                <Check size={14} /> Added to Calendar
              </span>
            ) : (
              <button
                className="btn btn-primary"
                onClick={handleAddToCalendar}
                disabled={saving || isPast}
                style={{ fontSize: '0.8rem', padding: '6px 14px' }}
              >
                <CalendarPlus size={14} />
                {saving ? 'Adding...' : 'Add to Calendar'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
