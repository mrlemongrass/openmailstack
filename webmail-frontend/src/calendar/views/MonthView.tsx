import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, isSameMonth, isSameDay } from 'date-fns';
import type { useCalendar } from '../hooks/useCalendar';

export function MonthView({ cal }: { cal: ReturnType<typeof useCalendar> }) {
  const monthStart = startOfMonth(cal.currentDate);
  const monthEnd = endOfMonth(cal.currentDate);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);
  const days: Date[] = [];
  let d = startDate;
  while (d <= endDate) { days.push(d); d = addDays(d, 1); }

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
        borderBottom: '1px solid var(--border-glass)', padding: '4px 0' }}>
        {dayNames.map((name) => (
          <div key={name} style={{ textAlign: 'center', fontSize: '0.7rem', fontWeight: 600,
            color: 'var(--text-secondary)', padding: 4 }}>
            {name}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridTemplateRows: 'repeat(6, 1fr)' }}>
        {days.map((day) => {
          const dayEvents = cal.events.filter((e) => isSameDay(e.start, day));
          const isCurrentMonth = isSameMonth(day, cal.currentDate);
          const isToday = isSameDay(day, new Date());
          return (
            <div key={day.toISOString()} style={{
              border: '1px solid var(--border-glass)',
              padding: 4, opacity: isCurrentMonth ? 1 : 0.4,
              background: isToday ? 'rgba(59,130,246,0.1)' : 'transparent',
              cursor: 'pointer',
            }} onClick={() => cal.setIsEventModalOpen(true)}>
              <div style={{ fontSize: '0.8rem', fontWeight: isToday ? 700 : 400,
                color: isToday ? 'var(--accent-primary)' : 'var(--text-secondary)',
                textAlign: 'center', marginBottom: 2 }}>
                {format(day, 'd')}
              </div>
              {dayEvents.slice(0, 3).map((evt) => (
                <div key={evt.id} style={{
                  fontSize: '0.65rem', padding: '1px 4px', borderRadius: 3,
                  background: `${cal.calendars.find((c) => c.id === evt.calendarId)?.color || '#3B82F6'}33`,
                  color: 'var(--text-primary)', overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 1,
                }}>
                  {evt.title}
                </div>
              ))}
              {dayEvents.length > 3 && (
                <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)' }}>
                  +{dayEvents.length - 3} more
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
