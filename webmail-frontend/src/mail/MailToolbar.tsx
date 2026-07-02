import { Trash2, Archive, ShieldAlert, Mail, MailOpen, StarIcon } from 'lucide-react';

interface MailToolbarProps {
  selectedCount: number;
  totalCount: number;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelectAll: () => void;
  onBulkAction: (action: string) => void;
}

export function MailToolbar({ selectedCount, totalCount, searchQuery, onSearchChange, onSelectAll, onBulkAction }: MailToolbarProps) {
  const allSelected = selectedCount > 0 && selectedCount === totalCount;
  return (
    <div style={{ borderBottom: '1px solid var(--border-glass)' }}>
      {/* Search row — always visible */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        background: 'rgba(0,0,0,0.1)' }}>
        <input type="checkbox" checked={allSelected} onChange={onSelectAll} title="Select all" />
        <input type="text" className="glass-input" placeholder="Search messages..."
          value={searchQuery} onChange={(e) => onSearchChange(e.target.value)}
          style={{ flex: 1, fontSize: '0.85rem' }} />
      </div>
      {/* Bulk action bar — visible when messages are selected */}
      {selectedCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
          background: 'rgba(59,130,246,0.08)', borderTop: '1px solid var(--border-glass)' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', fontWeight: 500 }}>
            {selectedCount} selected
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={() => onBulkAction('read')} title="Mark read"><Mail size={16} /></button>
          <button className="btn btn-ghost" onClick={() => onBulkAction('unread')} title="Mark unread"><MailOpen size={16} /></button>
          <button className="btn btn-ghost" onClick={() => onBulkAction('archive')} title="Archive"><Archive size={16} /></button>
          <button className="btn btn-ghost" onClick={() => onBulkAction('star')} title="Star"><StarIcon size={16} /></button>
          <button className="btn btn-ghost" onClick={() => onBulkAction('spam')} title="Mark as spam"><ShieldAlert size={16} /></button>
          <button className="btn btn-danger" onClick={() => onBulkAction('delete')} title="Delete"><Trash2 size={16} /></button>
        </div>
      )}
    </div>
  );
}
