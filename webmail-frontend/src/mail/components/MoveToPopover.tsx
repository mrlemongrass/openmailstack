import { useState } from 'react';
import type { MailFolder } from '../../shared/types';
import { Search } from 'lucide-react';

interface MoveToPopoverProps {
  folders: MailFolder[];
  onMove: (folderPath: string) => void;
  onClose: () => void;
}

export function MoveToPopover({ folders, onMove, onClose }: MoveToPopoverProps) {
  const [filter, setFilter] = useState('');
  const filtered = folders.filter((f) =>
    f.path.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 50, marginTop: 4, minWidth: 200 }}
      onClick={(e) => e.stopPropagation()}>
      <div className="glass-panel" style={{ padding: 8, maxHeight: 300, overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', marginBottom: 4 }}>
          <Search size={14} style={{ color: 'var(--text-secondary)' }} />
          <input className="glass-input" placeholder="Filter folders..." value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ flex: 1, padding: '4px 8px', fontSize: '0.8rem' }} />
        </div>
        {filtered.map((f) => (
          <div key={f.path} className="nav-item" style={{
            padding: '6px 10px', cursor: 'pointer', borderRadius: 'var(--radius-sm)',
            fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }} onClick={() => { onMove(f.path); onClose(); }}>
            {f.path}
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: 8, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>No folders match</div>
        )}
      </div>
    </div>
  );
}
