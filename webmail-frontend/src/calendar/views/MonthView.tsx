import { useRef, useState } from 'react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, isSameMonth, isSameDay, getWeek } from 'date-fns';
import type { useCalendar } from '../hooks/useCalendar';
import type { CalendarEvent } from '../../shared/types';
import { useMediaQuery } from '../../shared/hooks/useMediaQuery';
import { calendarEventPresentation } from '../calendarTime';
import { calendarKeyboardPoint, monthGridTargetIndex } from '../calendarSurfaceNavigation';

export function MonthView({ cal }: { cal: ReturnType<typeof useCalendar> }) {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const monthStart = startOfMonth(cal.currentDate);
  const monthEnd = endOfMonth(cal.currentDate);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);
  const days: Date[] = [];
  let d = startDate;
  while (d <= endDate) { days.push(d); d = addDays(d, 1); }

  // #6 Drag state
  const [dragEvent, setDragEvent] = useState<CalendarEvent | null>(null);
  const [focusedDayIndex, setFocusedDayIndex] = useState(() => Math.max(
    0,
    days.findIndex(day => isSameDay(day, cal.currentDate)),
  ));
  const dayRefs = useRef<Array<HTMLDivElement | null>>([]);

  const isVisible = (evt: CalendarEvent) => cal.isCalendarVisible(evt.calendarId);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '24px repeat(7, minmax(0, 1fr))',
        borderBottom: '1px solid var(--border-glass)', padding: '4px 0' }}>
        <div />{/* #8 week number column */}
        {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((name) => (
          <div key={name} style={{ textAlign: 'center', fontSize: '0.7rem', fontWeight: 600,
            color: 'var(--text-secondary)', padding: 4 }}>{name}</div>
        ))}
      </div>
      {/* Day grid */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '24px repeat(7, minmax(0, 1fr))',
        gridTemplateRows: 'repeat(6, 1fr)' }} role="grid" aria-label={format(cal.currentDate, 'MMMM yyyy')}>
        {Array.from({ length: 6 }).map((_, weekIdx) => {
          const weekDays = days.slice(weekIdx * 7, (weekIdx + 1) * 7);
          const weekNum = weekDays.length > 0 ? getWeek(weekDays[0]) : '';
          return (
            <div key={weekIdx} style={{ display: 'contents' }} role="row">
              {/* #8 Week number */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.6rem', color: 'var(--text-secondary)', border: '1px solid var(--border-glass)',
                borderRight: 'none' }}>
                {weekNum}
              </div>
              {weekDays.map((day, dayIndex) => {
                const gridIndex = weekIdx * 7 + dayIndex;
                const dayEvents = cal.events.filter((e) => isSameDay(e.start, day) && isVisible(e));
                const isCurrentMonth = isSameMonth(day, cal.currentDate);
                const isToday = isSameDay(day, cal.displayNow);
                return (
                  <div key={day.toISOString()} style={{
                    border: '1px solid var(--border-glass)', padding: 2,
                    opacity: isCurrentMonth ? 1 : 0.4,
                    background: isToday ? 'rgba(59,130,246,0.1)' : 'transparent',
                    cursor: 'pointer', minHeight: 60, position: 'relative',
                  }}
                    role="gridcell"
                    tabIndex={focusedDayIndex === gridIndex ? 0 : -1}
                    ref={element => { dayRefs.current[gridIndex] = element; }}
                    onFocus={() => setFocusedDayIndex(gridIndex)}
                    aria-label={`${format(day, 'EEEE, MMMM d')}. Press Enter to create an event.`}
                    aria-keyshortcuts="Shift+F10"
                    onClick={() => cal.openNewEvent(day, true)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.currentTarget.focus();
                      cal.openSlotContextMenu({ x: event.clientX, y: event.clientY }, day, true);
                    }}
                    onKeyDown={(event) => {
                      if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
                        event.preventDefault();
                        cal.openSlotContextMenu(calendarKeyboardPoint(event.currentTarget), day, true);
                      } else if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        cal.openNewEvent(day, true);
                      } else {
                        const target = monthGridTargetIndex(event.key, gridIndex, days.length);
                        if (target !== null) {
                          event.preventDefault();
                          setFocusedDayIndex(target);
                          dayRefs.current[target]?.focus();
                        }
                      }
                    }}
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
                    {dayEvents.slice(0, 3).map((evt) => {
                      const presentation = calendarEventPresentation(evt, cal.calendarSettings.clockFormat);
                      const editable = cal.writableCalendars.some(calendar => calendar.id === evt.calendarId);
                      return (
                        <div key={evt.id + (evt.occurrenceId || '')} draggable={editable}
                          onDragStart={event => {
                            if (!editable) {
                              event.preventDefault();
                              return;
                            }
                            setDragEvent(evt);
                          }}
                          onClick={(e) => { e.stopPropagation(); cal.editExistingEvent(evt); }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            event.currentTarget.focus();
                            cal.openEventContextMenu({ x: event.clientX, y: event.clientY }, evt);
                          }}
                          onKeyDown={(e) => {
                            if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
                              e.preventDefault();
                              e.stopPropagation();
                              cal.openEventContextMenu(calendarKeyboardPoint(e.currentTarget), evt);
                            } else if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              cal.editExistingEvent(evt);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          aria-keyshortcuts="Shift+F10"
                          aria-label={presentation.title}
                          title={presentation.title}
                        style={{ fontSize: '0.6rem', padding: '1px 3px', borderRadius: 2, cursor: editable ? 'grab' : 'pointer',
                          background: `${cal.calendars.find((c) => c.id === evt.calendarId)?.color || '#3B82F6'}33`,
                          color: 'var(--text-primary)', overflow: 'hidden',
                          textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 1 }}>
                        {isMobile ? presentation.compactText : presentation.text}
                      </div>
                      );
                    })}
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
