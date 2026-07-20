import { useState } from 'react';
import {
  format, startOfWeek, endOfWeek, addDays, isSameDay,
  setHours, setMinutes, differenceInMinutes,
} from 'date-fns';
import type { useCalendar } from '../hooks/useCalendar';
import type { CalendarEvent } from '../../shared/types';
import { formatHourLabel, formatWallTime } from '../calendarTime';

const HOUR_HEIGHT = 56;
const HOURS = Array.from({ length: 24 }, (_, i) => i); // 0..23

function eventStyle(evt: CalendarEvent, col: number, totalCols: number): React.CSSProperties {
  const startMin = evt.start.getHours() * 60 + evt.start.getMinutes();
  const endMin = evt.end.getHours() * 60 + evt.end.getMinutes();
  const dur = Math.max(endMin - startMin, 15); // minimum 15min height
  const top = (startMin / 60) * HOUR_HEIGHT;
  const height = (dur / 60) * HOUR_HEIGHT;
  const leftPct = (col / totalCols) * 100;
  const widthPct = 100 / totalCols - 1;
  return {
    position: 'absolute',
    top,
    left: `${leftPct + 0.5}%`,
    width: `${widthPct}%`,
    height: Math.max(height, 18),
    padding: '2px 4px',
    borderRadius: 4,
    fontSize: '0.7rem',
    overflow: 'hidden',
    cursor: 'pointer',
    zIndex: 2,
    background: evt.calendarId ? `hsl(${(evt.calendarId * 67) % 360}, 65%, 55%)` : 'var(--accent-primary)',
    color: '#fff',
  };
}

/** Group overlapping events into lanes within the same day. */
function assignLanes(events: CalendarEvent[]): { evt: CalendarEvent; col: number; total: number }[] {
  if (events.length === 0) return [];
  const sorted = [...events].sort((a, b) => a.start.getTime() - b.start.getTime());
  const lanes: CalendarEvent[][] = [];
  for (const evt of sorted) {
    let placed = false;
    for (const lane of lanes) {
      const last = lane[lane.length - 1];
      if (last.end <= evt.start) { lane.push(evt); placed = true; break; }
    }
    if (!placed) lanes.push([evt]);
  }
  const total = lanes.length;
  const result: { evt: CalendarEvent; col: number; total: number }[] = [];
  for (let i = 0; i < lanes.length; i++) {
    for (const evt of lanes[i]) {
      result.push({ evt, col: i, total });
    }
  }
  return result;
}

export function WeekView({ cal }: { cal: ReturnType<typeof useCalendar> }) {
  const weekStart = startOfWeek(cal.currentDate);
  const weekEnd = endOfWeek(cal.currentDate);
  const days: Date[] = [];
  let d = weekStart;
  while (d <= weekEnd) { days.push(d); d = addDays(d, 1); }

  const [dragOverDay, setDragOverDay] = useState<Date | null>(null);

  const isVisible = (evt: CalendarEvent) => cal.calendarVisibility[evt.calendarId] !== false;
  const visibleEvents = cal.events.filter(isVisible);

  const allDayEvents = visibleEvents.filter((e) => e.isAllDay || (differenceInMinutes(e.end, e.start) >= 1440));

  const now = cal.displayNow;
  const currentTimeTop = (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_HEIGHT;
  const currentDayIndex = days.findIndex((day) => isSameDay(day, cal.displayNow));

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '52px repeat(7, minmax(0, 1fr))',
        borderBottom: '1px solid var(--border-glass)' }}>
        <div />
        {days.map((day) => (
          <div key={day.toISOString()} style={{
            textAlign: 'center', padding: '6px 2px', fontSize: '0.7rem',
            fontWeight: isSameDay(day, cal.displayNow) ? 700 : 400,
            color: isSameDay(day, cal.displayNow) ? 'var(--accent-primary)' : 'var(--text-secondary)',
            background: isSameDay(day, cal.displayNow) ? 'rgba(59,130,246,0.08)' : 'transparent',
          }}>
            <div style={{ fontSize: '0.6rem', textTransform: 'uppercase' }}>{format(day, 'EEE')}</div>
            <div style={{ fontSize: '1rem' }}>{format(day, 'd')}</div>
          </div>
        ))}
      </div>

      {/* All-day events */}
      {allDayEvents.length > 0 && (
        <div style={{ borderBottom: '1px solid var(--border-glass)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '52px repeat(7, minmax(0, 1fr))' }}>
            <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', padding: '2px 4px',
              display: 'flex', alignItems: 'center' }}>all-day</div>
            {days.map((day) => {
              const dayAllDay = allDayEvents.filter((e) => isSameDay(e.start, day));
              return (
                <div key={day.toISOString()} style={{ padding: '1px 2px', minHeight: 20 }}>
                  {dayAllDay.map((evt) => (
                    <div key={evt.id || evt.id || evt.title} style={{
                      padding: '1px 4px', borderRadius: 3, fontSize: '0.65rem',
                      background: 'var(--accent-primary)', color: '#fff',
                      marginBottom: 1, cursor: 'pointer', overflow: 'hidden',
                      whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                    }} onClick={() => cal.editExistingEvent(evt)}>
                      {evt.title}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Time grid */}
      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '52px repeat(7, minmax(0, 1fr))',
          height: HOURS.length * HOUR_HEIGHT, position: 'relative' }}>
          {/* Hour labels */}
          {HOURS.map((h) => (
            <div key={`label-${h}`} style={{
              gridColumn: 1, gridRow: h + 1,
              fontSize: '0.65rem', color: 'var(--text-secondary)',
              textAlign: 'right', paddingRight: 6,
              transform: 'translateY(-8px)',
            }}>
              {formatHourLabel(h, cal.calendarSettings.clockFormat)}
            </div>
          ))}

          {/* Day columns */}
          {days.map((day, colIdx) => (
            <div key={day.toISOString()} style={{
              gridColumn: colIdx + 2, gridRow: '1 / 25',
              display: 'grid', gridTemplateRows: `repeat(${HOURS.length}, ${HOUR_HEIGHT}px)`,
              borderLeft: '1px solid var(--border-glass)',
              background: isSameDay(day, cal.displayNow) ? 'rgba(59,130,246,0.03)' : 'transparent',
            }}>
              {HOURS.map((h) => (
                <div key={h} style={{
                  borderBottom: '1px solid var(--border-glass)',
                  cursor: 'pointer',
                  background: dragOverDay && isSameDay(dragOverDay, day) ? 'rgba(59,130,246,0.06)' : undefined,
                }}
                  onClick={() => {
                    cal.setNewEvent({
                      title: '', start: setHours(setMinutes(day, 0), h),
                      end: setHours(setMinutes(day, 0), h + 1),
                      isAllDay: false, location: '', description: '',
                      calendarId: cal.calendars[0]?.id || 0,
                    });
                    cal.setIsEventModalOpen(true);
                  }}
                  onDragOver={(e) => { e.preventDefault(); setDragOverDay(day); }}
                  onDragLeave={() => setDragOverDay(null)}
                />
              ))}
            </div>
          ))}

          {/* Time-slotted events */}
          {days.map((day, colIdx) => {
            const dayEvents = visibleEvents.filter(
              (e) => isSameDay(e.start, day) && !e.isAllDay && differenceInMinutes(e.end, e.start) < 1440
            );
            const laned = assignLanes(dayEvents);

            return laned.map(({ evt, col, total }) => (
              <div key={evt.id || evt.id || `${evt.title}-${evt.start.getTime()}`}
                style={{
                  ...eventStyle(evt, col, total),
                  gridColumn: colIdx + 2,
                  gridRow: '1 / 25',
                }}
                onClick={(e) => { e.stopPropagation(); cal.editExistingEvent(evt); }}
                title={`${evt.title}\n${formatWallTime(evt.start, cal.calendarSettings.clockFormat)} – ${formatWallTime(evt.end, cal.calendarSettings.clockFormat)}`}
              >
                <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {evt.title || '(Untitled)'}
                </div>
                {height(evt) > 36 && (
                  <div style={{ fontSize: '0.6rem', opacity: 0.85 }}>
                    {formatWallTime(evt.start, cal.calendarSettings.clockFormat)}
                  </div>
                )}
              </div>
            ));
          })}

          {/* Current time indicator */}
          {currentDayIndex >= 0 && (
            <div data-testid="current-time-indicator" style={{
              gridColumn: currentDayIndex + 2, gridRow: '1 / 25',
              position: 'relative', zIndex: 3, pointerEvents: 'none',
            }}>
              <div style={{
                position: 'absolute', top: currentTimeTop, left: 0, right: 0,
                height: 2, background: 'var(--danger)', borderRadius: 1,
              }} />
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: 'var(--danger)', position: 'absolute',
                top: currentTimeTop - 3, left: -4,
              }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function height(evt: CalendarEvent): number {
  const dur = Math.max(differenceInMinutes(evt.end, evt.start), 15);
  return (dur / 60) * HOUR_HEIGHT;
}
