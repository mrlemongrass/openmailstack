import { ChevronLeft, ChevronRight } from 'lucide-react';
import { format, addMonths, subMonths } from 'date-fns';
import type { useCalendar } from './hooks/useCalendar';

export function CalendarToolbar({ cal }: { cal: ReturnType<typeof useCalendar> }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
      borderBottom: '1px solid var(--border-glass)' }}>
      <button className="btn btn-ghost" onClick={() => cal.setCurrentDate(new Date())}
        style={{ fontSize: '0.85rem' }}>Today</button>
      <button className="btn btn-ghost" style={{ padding: '4px 8px' }}
        onClick={() => cal.setCurrentDate(subMonths(cal.currentDate, 1))}>
        <ChevronLeft size={16} />
      </button>
      <button className="btn btn-ghost" style={{ padding: '4px 8px' }}
        onClick={() => cal.setCurrentDate(addMonths(cal.currentDate, 1))}>
        <ChevronRight size={16} />
      </button>
      <span style={{ fontWeight: 600, fontSize: '1rem' }}>
        {format(cal.currentDate, 'MMMM yyyy')}
      </span>
      <div style={{ flex: 1 }} />
      {(['month', 'week', 'day', 'agenda', 'year'] as const).map((v) => (
        <button key={v} className="btn btn-ghost" style={{
          padding: '4px 10px', fontSize: '0.8rem', textTransform: 'capitalize',
          background: cal.calendarView === v ? 'rgba(59,130,246,0.15)' : 'transparent',
          fontWeight: cal.calendarView === v ? 600 : 400,
        }} onClick={() => cal.setCalendarView(v)}>
          {v}
        </button>
      ))}
    </div>
  );
}
