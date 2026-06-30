import { ArrowUpDown } from 'lucide-react';

interface SortDropdownProps {
  value: string;
  onChange: (value: string) => void;
}

const SORT_OPTIONS = [
  { value: 'updated', label: 'Date modified' },
  { value: 'created', label: 'Date created' },
  { value: 'title_asc', label: 'Title A-Z' },
  { value: 'title_desc', label: 'Title Z-A' },
];

export function SortDropdown({ value, onChange }: SortDropdownProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <ArrowUpDown size={14} style={{ color: 'var(--text-secondary)' }} />
      <select
        className="glass-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ fontSize: '0.85rem', padding: '4px 8px', background: 'var(--bg-secondary)' }}
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}
