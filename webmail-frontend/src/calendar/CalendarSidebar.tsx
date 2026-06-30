import { Plus } from 'lucide-react';
import type { useCalendar } from './hooks/useCalendar';

export function CalendarSidebar({ cal }: { cal: ReturnType<typeof useCalendar> }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 12 }}>
      <button className="btn btn-primary" style={{ width: '100%', marginBottom: 16 }}
        onClick={() => cal.setIsEventModalOpen(true)}>
        <Plus size={16} /> New Event
      </button>
      <div style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase',
        color: 'var(--text-secondary)', marginBottom: 8, letterSpacing: '0.05em' }}>Calendars</div>
      {cal.calendars.map((c) => (
        <div key={c.id} className="nav-item" style={{ display: 'flex', alignItems: 'center', gap: 8,
          padding: '4px 10px', borderRadius: 'var(--radius-md)', fontSize: '0.85rem', cursor: 'pointer' }}>
          <span style={{ width: 10, height: 10, borderRadius: 3,
            background: c.color, flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{c.name}</span>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
            {c.events?.length || 0}
          </span>
        </div>
      ))}
    </div>
  );
}
