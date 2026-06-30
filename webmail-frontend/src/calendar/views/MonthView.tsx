import { useState } from 'react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, isSameMonth, isSameDay, getWeek } from 'date-fns';
import type { useCalendar } from '../hooks/useCalendar';
import type { CalendarEvent } from '../../shared/types';

export function MonthView({ cal }: { cal: ReturnType<typeof useCalendar> }) {
  const monthStart = startOfMonth(cal.currentDate);
  const monthEnd = endOfMonth(cal.currentDate);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);
  const days: Date[] = [];
  let d = startDate;
  while (d <= endDate) { days.push(d); d = addDays(d, 1); }

  // #6 Drag state
  const [dragEvent, setDragEvent] = useState<CalendarEvent | null>(null);

  const isVisible = (evt: CalendarEvent) => {
    return cal.calendarVisibility[evt.calendarId] !== false;
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '24px repeat(7, 1fr)',
        borderBottom: '1px solid var(--border-glass)', padding: '4px 0' }}>
        <div />{/* #8 week number column */}
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((name) => (
          <div key={name} style={{ textAlign: 'center', fontSize: '0.7rem', fontWeight: 600,
            color: 'var(--text-secondary)', padding: 4 }}>{name}</div>
        ))}
      </div>
      {/* Day grid */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '24px repeat(7, 1fr)',
        gridTemplateRows: 'repeat(6, 1fr)' }}>
        {Array.from({ length: 6 }).map((_, weekIdx) => {
          const weekDays = days.slice(weekIdx * 7, (weekIdx + 1) * 7);
          const weekNum = weekDays.length > 0 ? getWeek(weekDays[0]) : '';
          return (
            <div key={weekIdx} style={{ display: 'contents' }}>
              {/* #8 Week number */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.6rem', color: 'var(--text-secondary)', border: '1px solid var(--border-glass)',
                borderRight: 'none' }}>
                {weekNum}
              </div>
              {weekDays.map((day) => {
                const dayEvents = cal.events.filter((e) => isSameDay(e.start, day) && isVisible(e));
                const isCurrentMonth = isSameMonth(day, cal.currentDate);
                const isToday = isSameDay(day, new Date());
                return (
                  <div key={day.toISOString()} style={{
                    border: '1px solid var(--border-glass)', padding: 2,
                    opacity: isCurrentMonth ? 1 : 0.4,
                    background: isToday ? 'rgba(59,130,246,0.1)' : 'transparent',
                    cursor: 'pointer', minHeight: 60, position: 'relative',
                  }}
                    onClick={() => cal.openNewEvent(day, true)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragEvent) {
                        const oldDate = new Date(dragEvent.start as Date);
                        const diff = day.getTime() - oldDate.getTime();
                        const newStart = new Date((dragEvent.start as Date).getTime() + diff);
                        const newEnd = new Date((dragEvent.end as Date).getTime() + diff);
                        cal.setNewEvent({ ...dragEvent, start: newStart, end: newEnd });
                        cal.saveEvent();
                        setDragEvent(null);
                      }
                    }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: isToday ? 700 : 400,
                      color: isToday ? 'var(--accent-primary)' : 'var(--text-secondary)',
                      textAlign: 'center', marginBottom: 1 }}>
                      {format(day, 'd')}
                    </div>
                    {dayEvents.slice(0, 3).map((evt) => (
                      <div key={evt.id + (evt.occurrenceId || '')} draggable
                        onDragStart={() => setDragEvent(evt)}
                        onClick={(e) => { e.stopPropagation(); cal.editExistingEvent(evt); }}
                        style={{ fontSize: '0.6rem', padding: '1px 3px', borderRadius: 2, cursor: 'grab',
                          background: `${cal.calendars.find((c) => c.id === evt.calendarId)?.color || '#3B82F6'}33`,
                          color: 'var(--text-primary)', overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 1 }}>
                        {!evt.isAllDay && format(new Date(evt.start), 'HH:mm') + ' '}{evt.title}
                      </div>
                    ))}
                    {dayEvents.length > 3 && (
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)' }}>+{dayEvents.length - 3}</div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
