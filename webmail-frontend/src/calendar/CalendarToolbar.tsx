import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { format, addMonths, subMonths, addWeeks, subWeeks, addDays, subDays } from 'date-fns';
import type { useCalendar } from './hooks/useCalendar';
import { useToast } from '../shared/components/Toast';
import { useMediaQuery } from '../shared/hooks/useMediaQuery';
import { formatWallTime, shortTimeZoneName } from './calendarTime';

// #7 Natural language event parsing
function parseQuickCreate(text: string, currentWallTime: Date): { title: string; start: Date; duration: number } | null {
  if (!text.trim()) return null;
  const now = currentWallTime;
  let title = text;
  let start = new Date(now);
  let duration = 60; // default 1 hour

  // Time patterns: "at 3pm", "at noon", "at 14:00"
  const timeMatch = text.match(/\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i) ||
                    text.match(/\b(noon|midnight)\b/i);
  if (timeMatch) {
    title = title.replace(timeMatch[0], '').trim();
    const t = timeMatch[1]?.toLowerCase() || timeMatch[0].toLowerCase();
    if (t === 'noon') start.setHours(12, 0, 0, 0);
    else if (t === 'midnight') start.setHours(0, 0, 0, 0);
    else {
      const parsed = new Date(`2000-01-01 ${t}`);
      if (!isNaN(parsed.getTime())) {
        start.setHours(parsed.getHours(), parsed.getMinutes(), 0, 0);
      }
    }
  }

  // Date patterns: "Friday", "tomorrow", "today", "next Monday", "June 15"
  const dateMatch = text.match(/\b(today|tomorrow|next\s+\w+day|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (dateMatch) {
    title = title.replace(dateMatch[0], '').trim();
    const d = dateMatch[1].toLowerCase();
    const dayNames = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    if (d === 'today') { /* keep now */ }
    else if (d === 'tomorrow') { start = addDays(start, 1); }
    else if (d.startsWith('next ')) {
      const target = dayNames.indexOf(d.replace('next ', ''));
      if (target >= 0) {
        const daysUntil = (target + 7 - start.getDay()) % 7 || 7;
        start = addDays(start, daysUntil);
      }
    } else {
      const target = dayNames.indexOf(d);
      if (target >= 0) {
        const daysUntil = (target + 7 - start.getDay()) % 7 || 7;
        start = addDays(start, daysUntil);
      }
    }
  }

  // Duration: "for 1 hour", "for 30 minutes", "for 2h"
  const durMatch = text.match(/\bfor\s+(\d+)\s*(hour|hr|h|minute|min|m)s?\b/i);
  if (durMatch) {
    title = title.replace(durMatch[0], '').trim();
    const val = parseInt(durMatch[1]);
    const unit = durMatch[2].toLowerCase();
    duration = unit.startsWith('h') || unit === 'hr' ? val * 60 : val;
  }

  title = title.replace(/\s+/g, ' ').trim();
  if (!title) title = 'Untitled Event';
  return { title, start, duration };
}

export function CalendarToolbar({ cal }: { cal: ReturnType<typeof useCalendar> }) {
  const { showToast } = useToast();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const handleQuickCreate = () => {
    const parsed = parseQuickCreate(cal.quickCreateText, cal.displayNow);
    if (parsed) {
      cal.setNewEvent({
        title: parsed.title,
        start: parsed.start,
        end: new Date(parsed.start.getTime() + parsed.duration * 60000),
        isAllDay: false, location: '', description: '',
        calendarId: cal.calendars[0]?.id || 0,
      });
      cal.setIsEventModalOpen(true);
      cal.setQuickCreateText('');
      showToast({ type: 'success', message: `Event "${parsed.title}" ready — fill in details and save` });
    }
  };

  const nav = cal.calendarView === 'month'
    ? { prev: () => cal.setCurrentDate(subMonths(cal.currentDate, 1)), next: () => cal.setCurrentDate(addMonths(cal.currentDate, 1)), label: format(cal.currentDate, 'MMMM yyyy') }
    : cal.calendarView === 'week'
    ? { prev: () => cal.setCurrentDate(subWeeks(cal.currentDate, 1)), next: () => cal.setCurrentDate(addWeeks(cal.currentDate, 1)), label: format(cal.currentDate, "'Week of' MMM d, yyyy") }
    : { prev: () => cal.setCurrentDate(subDays(cal.currentDate, 1)), next: () => cal.setCurrentDate(addDays(cal.currentDate, 1)), label: format(cal.currentDate, 'EEEE, MMMM d, yyyy') };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
      borderBottom: '1px solid var(--border-glass)', flexWrap: 'wrap' }}>
      <button className="btn btn-ghost" onClick={() => { cal.setCurrentDate(cal.displayNow); showToast({ type: 'info', message: 'Jumped to today' }); }}
        style={{ fontSize: '0.85rem' }}>Today</button>
      <button className="btn btn-ghost" aria-label={`Previous ${cal.calendarView}`} style={{ padding: '4px 8px' }} onClick={nav.prev}><ChevronLeft size={16} /></button>
      <button className="btn btn-ghost" aria-label={`Next ${cal.calendarView}`} style={{ padding: '4px 8px' }} onClick={nav.next}><ChevronRight size={16} /></button>
      <span style={{ fontWeight: 600, fontSize: '1rem' }}>{nav.label}</span>
      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
        · {cal.events.filter((e) => cal.calendarVisibility[e.calendarId] !== false).length} events
      </span>
      <span title={`Calendar times shown in ${cal.displayTimeZone}`} style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
        {cal.calendarSettings.timeZoneMode === 'system' ? 'System' : 'Home'} · {cal.displayTimeZone.replace(/_/g, ' ')} ({shortTimeZoneName(new Date(), cal.displayTimeZone)})
      </span>
      {isMobile && !cal.isLoading && !cal.calendarError && cal.calendarSettings.showHeaderClock && (
        <time
          dateTime={new Date().toISOString()}
          title={`Current time in ${cal.displayTimeZone}`}
          aria-label={`Current time in ${cal.displayTimeZone}: ${formatWallTime(cal.displayNow, cal.calendarSettings.clockFormat)}`}
          style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}
        >
          {formatWallTime(cal.displayNow, cal.calendarSettings.clockFormat)} {shortTimeZoneName(new Date(), cal.displayTimeZone)}
        </time>
      )}

      {/* #7 Quick create */}
      <div style={{ display: 'flex', flex: 1, gap: 6, alignItems: 'center' }}>
        <Search size={14} style={{ color: 'var(--text-secondary)' }} />
        <input className="glass-input" placeholder='Quick create: "Lunch Friday at noon"'
          value={cal.quickCreateText} onChange={(e) => cal.setQuickCreateText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleQuickCreate(); }}
          style={{ flex: 1, fontSize: '0.8rem', padding: '6px 10px' }} />
        <button className="btn btn-ghost" onClick={handleQuickCreate}
          style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>Create</button>
      </div>

      {/* View switcher — Month and Week are implemented */}
      <div style={{ display: 'flex', gap: 2 }}>
        {(['month', 'week', 'day'] as const).map((v) => (
          <button key={v} className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: '0.8rem', textTransform: 'capitalize',
            background: cal.calendarView === v ? 'rgba(59,130,246,0.15)' : 'transparent',
            fontWeight: cal.calendarView === v ? 600 : 400 }}
            onClick={() => cal.setCalendarView(v)}>{v}</button>
        ))}
        <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: '0.7rem', opacity: 0.6 }}
          onClick={() => {
            const next = localStorage.getItem('oms_week_numbers') !== '0' ? '0' : '1';
            localStorage.setItem('oms_week_numbers', next);
            window.dispatchEvent(new Event('oms:weeknumbers'));
            showToast({ type: 'info', message: next === '0' ? 'Week numbers hidden' : 'Week numbers shown' });
          }}>
          W#
        </button>
      </div>
    </div>
  );
}
