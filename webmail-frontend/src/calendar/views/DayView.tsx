import { useRef, useState } from 'react';
import { format, isSameDay, setHours, setMinutes, differenceInMinutes } from 'date-fns';
import type { useCalendar } from '../hooks/useCalendar';
import type { CalendarEvent } from '../../shared/types';
import { formatHourLabel, formatWallTime } from '../calendarTime';
import { calendarKeyboardPoint, calendarTimeAtPointer, dayGridTargetIndex } from '../calendarSurfaceNavigation';

const HOUR_HEIGHT = 56;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function eventStyle(evt: CalendarEvent, color: string): React.CSSProperties {
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
    background: color,
    color: '#fff',
  };
}

export function DayView({ cal }: { cal: ReturnType<typeof useCalendar> }) {
  const day = cal.currentDate;
  const isVisible = (evt: CalendarEvent) => cal.isCalendarVisible(evt.calendarId);
  const visibleEvents = cal.events.filter(isVisible);
  const dayEvents = visibleEvents.filter((e) => isSameDay(e.start, day));
  const allDay = dayEvents.filter((e) => e.isAllDay || differenceInMinutes(e.end, e.start) >= 1440);
  const timed = dayEvents.filter((e) => !e.isAllDay && differenceInMinutes(e.end, e.start) < 1440);

  const now = cal.displayNow;
  const currentTimeTop = isSameDay(day, cal.displayNow) ? (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_HEIGHT : -1;
  const [focusedHour, setFocusedHour] = useState(() => isSameDay(day, cal.displayNow) ? cal.displayNow.getHours() : 9);
  const hourRefs = useRef<Array<HTMLDivElement | null>>([]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Day header */}
      <div style={{
        textAlign: 'center', padding: '8px', borderBottom: '1px solid var(--border-glass)',
        background: isSameDay(day, cal.displayNow) ? 'rgba(59,130,246,0.06)' : 'transparent',
      }}>
        <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>
          {format(day, 'EEEE')}
        </div>
        <div style={{ fontSize: '1.4rem', fontWeight: isSameDay(day, cal.displayNow) ? 700 : 400,
          color: isSameDay(day, cal.displayNow) ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
          {format(day, 'MMM d, yyyy')}
        </div>
      </div>

      {/* All-day events */}
      <div
        style={{ borderBottom: '1px solid var(--border-glass)', padding: '4px 8px', minHeight: 34, cursor: 'pointer' }}
        role="group"
        tabIndex={0}
        aria-label={`${format(day, 'EEEE, MMMM d')}. Press Enter to create an all-day event.`}
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
          }
        }}
      >
          <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', marginBottom: 2 }}>all-day</div>
          {allDay.map((evt) => (
            <div key={evt.id || evt.title} style={{
              padding: '2px 8px', borderRadius: 3, fontSize: '0.75rem', fontWeight: 600,
              background: 'var(--accent-primary)', color: '#fff', marginBottom: 2,
              cursor: 'pointer', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
            }}
              role="button"
              tabIndex={0}
              aria-keyshortcuts="Shift+F10"
              onClick={(event) => { event.stopPropagation(); cal.editExistingEvent(evt); }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.focus();
                cal.openEventContextMenu({ x: event.clientX, y: event.clientY }, evt);
              }}
              onKeyDown={(event) => {
                if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
                  event.preventDefault();
                  event.stopPropagation();
                  cal.openEventContextMenu(calendarKeyboardPoint(event.currentTarget), evt);
                } else if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  cal.editExistingEvent(evt);
                }
              }}
            >
              {evt.title || '(Untitled)'}
            </div>
          ))}
        </div>

      {/* Empty state for the day */}
      {dayEvents.length === 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 40, color: 'var(--text-secondary)', fontSize: '0.9rem', flex: 0 }}>
          No events scheduled for {format(day, 'EEEE, MMM d')}
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
                {formatHourLabel(h, cal.calendarSettings.clockFormat)}
              </div>
            ))}
          </div>

          {/* Day column */}
          <div style={{ flex: 1, position: 'relative', borderLeft: '1px solid var(--border-glass)',
            background: isSameDay(day, cal.displayNow) ? 'rgba(59,130,246,0.02)' : 'transparent' }}>
            {HOURS.map((h) => (
              <div key={h} style={{
                height: HOUR_HEIGHT, borderBottom: '1px solid var(--border-glass)',
                cursor: 'pointer',
              }}
                role="button"
                tabIndex={focusedHour === h ? 0 : -1}
                ref={element => { hourRefs.current[h] = element; }}
                onFocus={() => setFocusedHour(h)}
                aria-label={`Create an event at ${formatHourLabel(h, cal.calendarSettings.clockFormat)}`}
                aria-keyshortcuts="Shift+F10"
                onClick={(event) => cal.openNewEvent(calendarTimeAtPointer(
                  day,
                  h,
                  event.clientY,
                  event.currentTarget.getBoundingClientRect(),
                ))}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.currentTarget.focus();
                  cal.openSlotContextMenu(
                    { x: event.clientX, y: event.clientY },
                    calendarTimeAtPointer(
                      day,
                      h,
                      event.clientY,
                      event.currentTarget.getBoundingClientRect(),
                    ),
                  );
                }}
                onKeyDown={(event) => {
                  const start = setHours(setMinutes(day, 0), h);
                  if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
                    event.preventDefault();
                    cal.openSlotContextMenu(calendarKeyboardPoint(event.currentTarget), start);
                  } else if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    cal.openNewEvent(start);
                  } else {
                    const target = dayGridTargetIndex(event.key, h);
                    if (target !== null) {
                      event.preventDefault();
                      setFocusedHour(target);
                      hourRefs.current[target]?.focus();
                    }
                  }
                }}
              />
            ))}

            {/* Timed events */}
            {timed.map((evt) => (
              <div key={evt.id || `${evt.title}-${evt.start.getTime()}`}
                style={eventStyle(evt, cal.calendars.find(calendar => calendar.id === evt.calendarId)?.color || '#3B82F6')}
                role="button"
                tabIndex={0}
                aria-keyshortcuts="Shift+F10"
                onClick={(e) => { e.stopPropagation(); cal.editExistingEvent(evt); }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.currentTarget.focus();
                  cal.openEventContextMenu({ x: event.clientX, y: event.clientY }, evt);
                }}
                onKeyDown={(event) => {
                  if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
                    event.preventDefault();
                    event.stopPropagation();
                    cal.openEventContextMenu(calendarKeyboardPoint(event.currentTarget), evt);
                  } else if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    event.stopPropagation();
                    cal.editExistingEvent(evt);
                  }
                }}
                title={`${evt.title}\n${formatWallTime(evt.start, cal.calendarSettings.clockFormat)} – ${formatWallTime(evt.end, cal.calendarSettings.clockFormat)}`}
              >
                <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {evt.title || '(Untitled)'}
                </div>
                {differenceInMinutes(evt.end, evt.start) > 45 && (
                  <div style={{ fontSize: '0.65rem', opacity: 0.85 }}>
                    {formatWallTime(evt.start, cal.calendarSettings.clockFormat)}
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
