import { Clock, X } from 'lucide-react';
import { format, addDays, startOfDay, setHours, nextSaturday } from 'date-fns';

interface SnoozePopoverProps {
  onSelect: (until: Date) => void;
  onClose: () => void;
}

function getPresets(): { label: string; date: Date }[] {
  const now = new Date();
  const today6pm = setHours(startOfDay(now), 18);
  const tomorrow8am = setHours(startOfDay(addDays(now, 1)), 8);
  const saturday10am = setHours(startOfDay(nextSaturday(now)), 10);
  const nextMonday8am = (() => {
    const d = new Date(now);
    d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7));
    return setHours(startOfDay(d), 8);
  })();

  return [
    { label: `Later today (${format(today6pm, 'h:mm a')})`, date: today6pm },
    { label: `Tomorrow (${format(tomorrow8am, 'h:mm a')})`, date: tomorrow8am },
    { label: `This weekend (${format(saturday10am, 'EEE h:mm a')})`, date: saturday10am },
    { label: `Next week (${format(nextMonday8am, 'EEE h:mm a')})`, date: nextMonday8am },
  ];
}

export function SnoozePopover({ onSelect, onClose }: SnoozePopoverProps) {
  const presets = getPresets();

  return (
    <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 50, marginTop: 4 }}
      className="snooze-popover" onClick={(e) => e.stopPropagation()}>
      <div className="glass-panel" style={{ width: 260, padding: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '4px 8px', marginBottom: 4 }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>Snooze until</span>
          <button className="btn btn-ghost" onClick={onClose} style={{ padding: 2 }}><X size={14} /></button>
        </div>
        {presets.map((preset) => (
          <div key={preset.label} style={{ padding: '8px 12px', cursor: 'pointer',
            borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }}
            className="nav-item" onClick={() => onSelect(preset.date)}>
            <Clock size={14} style={{ marginRight: 8 }} />
            {preset.label}
          </div>
        ))}
        <div style={{ borderTop: '1px solid var(--border-glass)', margin: '4px 0' }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          cursor: 'pointer', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }}
          className="nav-item">
          <Clock size={14} />
          Custom...
          <input type="datetime-local"
            style={{ marginLeft: 'auto', background: 'transparent', border: '1px solid var(--border-glass)',
              borderRadius: 4, color: 'var(--text-primary)', padding: '2px 4px', fontSize: '0.8rem' }}
            onChange={(e) => { if (e.target.value) onSelect(new Date(e.target.value)); }} />
        </label>
      </div>
    </div>
  );
}
