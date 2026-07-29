import { useEffect, useRef, useState } from 'react';
import type { MailFolder } from '../../shared/types';
import { Search } from 'lucide-react';
import { selectMoveDestination } from './move-picker-selection';

interface MoveToPopoverProps {
  folders: MailFolder[];
  onMove: (folderPath: string) => void;
  onClose: () => void;
  align?: 'left' | 'right';
}

export function MoveToPopover({ folders, onMove, onClose, align = 'left' }: MoveToPopoverProps) {
  const [filter, setFilter] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);
  const filtered = folders.filter((f) =>
    f.path.toLowerCase().includes(filter.toLowerCase())
  );

  useEffect(() => {
    filterRef.current?.focus();
  }, []);

  return (
    <div role="dialog" aria-label="Move to folder" style={{
      position: 'absolute', top: '100%', zIndex: 50, marginTop: 4, minWidth: 220,
      ...(align === 'right' ? { right: 0 } : { left: 0 }),
    }}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}>
      <div className="glass-panel move-to-popover-panel" style={{ padding: 8, maxHeight: 300, overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', marginBottom: 4 }}>
          <Search size={14} style={{ color: 'var(--text-secondary)' }} />
          <input ref={filterRef} className="glass-input" aria-label="Filter folders" placeholder="Filter folders..." value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ flex: 1, padding: '4px 8px', fontSize: '0.8rem' }} />
        </div>
        {filtered.map((f) => (
          <button key={f.path} type="button" className="nav-item" style={{
            padding: '6px 10px', cursor: 'pointer', borderRadius: 'var(--radius-sm)',
            width: '100%', border: 0, background: 'transparent', textAlign: 'left', color: 'inherit',
            fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }} onClick={() => selectMoveDestination(f.path, onMove, onClose)}>
            {f.path}
          </button>
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: 8, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>No folders match</div>
        )}
      </div>
    </div>
  );
}
