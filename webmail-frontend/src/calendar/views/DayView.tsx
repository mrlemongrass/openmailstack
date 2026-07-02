import { format, isSameDay, isToday, setHours, setMinutes, differenceInMinutes } from 'date-fns';
import type { useCalendar } from '../hooks/useCalendar';
import type { CalendarEvent } from '../../shared/types';

const HOUR_HEIGHT = 56;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function eventStyle(evt: CalendarEvent): React.CSSProperties {
  const startMin = evt.start.getHours() * 60 + evt.start.getMinutes();
  const endMin = evt.end.getHours() * 60 + evt.end.getMinutes();
  const dur = Math.max(endMin - startMin, 15);
  const top = (startMin / 60) * HOUR_HEIGHT;
  const height = (dur / 60) * HOUR_HEIGHT;
  return {
    position: 'absolute', left: 4, right: 4, top,
    height: Math.max(height, 18),
    padding: '2px 6px', borderRadius: 4, fontSize: '0.75rem',
    overflow: 'hidden', cursor: 'pointer', zIndex: 2,
    background: evt.calendarId ? `hsl(${(evt.calendarId * 67) % 360}, 65%, 55%)` : 'var(--accent-primary)',
    color: '#fff',
  };
}

export function DayView({ cal }: { cal: ReturnType<typeof useCalendar> }) {
  const day = cal.currentDate;
  const isVisible = (evt: CalendarEvent) => cal.calendarVisibility[evt.calendarId] !== false;
  const visibleEvents = cal.events.filter(isVisible);
  const dayEvents = visibleEvents.filter((e) => isSameDay(e.start, day));
  const allDay = dayEvents.filter((e) => e.isAllDay || differenceInMinutes(e.end, e.start) >= 1440);
  const timed = dayEvents.filter((e) => !e.isAllDay && differenceInMinutes(e.end, e.start) < 1440);

  const now = new Date();
  const currentTimeTop = isToday(day) ? (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_HEIGHT : -1;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Day header */}
      <div style={{
        textAlign: 'center', padding: '8px', borderBottom: '1px solid var(--border-glass)',
        background: isToday(day) ? 'rgba(59,130,246,0.06)' : 'transparent',
      }}>
        <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
          {format(day, 'EEEE')}
        </div>
        <div style={{ fontSize: '1.4rem', fontWeight: isToday(day) ? 700 : 400,
          color: isToday(day) ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
          {format(day, 'MMM d, yyyy')}
        </div>
      </div>

      {/* All-day events */}
      {allDay.length > 0 && (
        <div style={{ borderBottom: '1px solid var(--border-glass)', padding: '4px 8px' }}>
          <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', marginBottom: 2 }}>all-day</div>
          {allDay.map((evt) => (
            <div key={evt.id || evt.title} style={{
              padding: '2px 8px', borderRadius: 3, fontSize: '0.75rem', fontWeight: 600,
              background: 'var(--accent-primary)', color: '#fff', marginBottom: 2,
              cursor: 'pointer', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
            }} onClick={() => cal.editExistingEvent(evt)}>
              {evt.title || '(Untitled)'}
            </div>
          ))}
        </div>
      )}

      {/* Time grid */}
      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        <div style={{ display: 'flex', height: HOURS.length * HOUR_HEIGHT, position: 'relative' }}>
          {/* Hour labels */}
          <div style={{ width: 52, flexShrink: 0 }}>
            {HOURS.map((h) => (
              <div key={h} style={{
                height: HOUR_HEIGHT, fontSize: '0.65rem', color: 'var(--text-secondary)',
                textAlign: 'right', paddingRight: 6, transform: 'translateY(-8px)',
              }}>
                {h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`}
              </div>
            ))}
          </div>

          {/* Day column */}
          <div style={{ flex: 1, position: 'relative', borderLeft: '1px solid var(--border-glass)',
            background: isToday(day) ? 'rgba(59,130,246,0.02)' : 'transparent' }}>
            {HOURS.map((h) => (
              <div key={h} style={{
                height: HOUR_HEIGHT, borderBottom: '1px solid var(--border-glass)',
                cursor: 'pointer',
              }} onClick={() => {
                cal.setNewEvent({
                  title: '', start: setHours(setMinutes(day, 0), h),
                  end: setHours(setMinutes(day, 0), h + 1),
                  isAllDay: false, location: '', description: '',
                  calendarId: cal.calendars[0]?.id || 0,
                });
                cal.setIsEventModalOpen(true);
              }} />
            ))}

            {/* Timed events */}
            {timed.map((evt) => (
              <div key={evt.id || `${evt.title}-${evt.start.getTime()}`}
                style={eventStyle(evt)}
                onClick={(e) => { e.stopPropagation(); cal.editExistingEvent(evt); }}
                title={`${evt.title}\n${format(evt.start, 'h:mm a')} – ${format(evt.end, 'h:mm a')}`}
              >
                <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {evt.title || '(Untitled)'}
                </div>
                {differenceInMinutes(evt.end, evt.start) > 45 && (
                  <div style={{ fontSize: '0.65rem', opacity: 0.85 }}>
                    {format(evt.start, 'h:mm a')}
                  </div>
                )}
              </div>
            ))}

            {/* Current time indicator */}
            {currentTimeTop >= 0 && (
              <div style={{ position: 'absolute', top: currentTimeTop, left: 0, right: 0, zIndex: 3, pointerEvents: 'none' }}>
                <div style={{ height: 2, background: 'var(--danger)', borderRadius: 1 }} />
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--danger)', position: 'absolute', top: -3, left: -4 }} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
