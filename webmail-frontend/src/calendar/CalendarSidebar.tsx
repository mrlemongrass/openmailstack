import { Plus, Eye, EyeOff } from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, isSameMonth, isSameDay } from 'date-fns';
import type { useCalendar } from './hooks/useCalendar';

export function CalendarSidebar({ cal }: { cal: ReturnType<typeof useCalendar> }) {
  const today = new Date();
  const miniStart = startOfWeek(startOfMonth(cal.currentDate));
  const miniEnd = endOfWeek(endOfMonth(cal.currentDate));
  const miniDays: Date[] = [];
  let d = miniStart;
  while (d <= miniEnd) { miniDays.push(d); d = addDays(d, 1); }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 12, gap: 12 }}>
      <button className="btn btn-primary" style={{ width: '100%' }}
        onClick={() => cal.openNewEvent()}>
        <Plus size={16} /> New Event
      </button>

      {/* #5 Mini-calendar */}
      <div style={{ border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-md)', padding: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
          {['S','M','T','W','T','F','S'].map((n, i) => (
            <div key={i} style={{ textAlign: 'center', fontSize: '0.6rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{n}</div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
          {miniDays.map((day) => {
            const hasEvents = cal.events.some((e) => isSameDay(e.start, day));
            const isCurrent = isSameMonth(day, cal.currentDate);
            const isToday = isSameDay(day, today);
            return (
              <div key={day.toISOString()} onClick={() => cal.setCurrentDate(day)}
                style={{ textAlign: 'center', padding: 2, cursor: 'pointer', borderRadius: 4, fontSize: '0.65rem',
                  background: isToday ? 'var(--accent-primary)' : 'transparent',
                  color: !isCurrent ? 'rgba(255,255,255,0.2)' : isToday ? 'white' : 'var(--text-secondary)',
                  fontWeight: isToday ? 600 : 400, position: 'relative' }}>
                {format(day, 'd')}
                {hasEvents && <span style={{ position: 'absolute', bottom: 1, left: '50%', transform: 'translateX(-50%)',
                  width: 3, height: 3, borderRadius: '50%', background: isToday ? 'white' : 'var(--accent-primary)' }} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Calendar list */}
      <div style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase',
        color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>Calendars</div>
      {cal.calendars.map((c) => {
        const isVisible = cal.calendarVisibility[c.id] !== false;
        return (
          <div key={c.id} className="nav-item" style={{ display: 'flex', alignItems: 'center', gap: 8,
            padding: '4px 10px', borderRadius: 'var(--radius-md)', fontSize: '0.85rem' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: c.color, flexShrink: 0 }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: isVisible ? 1 : 0.4 }}>
              {c.name}
            </span>
            <button className="btn btn-ghost" style={{ padding: '1px 4px' }}
              onClick={() => cal.setCalendarVisibility((prev) => ({ ...prev, [c.id]: !isVisible }))}
              title={isVisible ? 'Hide' : 'Show'}>
              {isVisible ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
          </div>
        );
      })}
    </div>
  );
}
