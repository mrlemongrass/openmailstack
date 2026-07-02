import { useState } from 'react';
import { Trash2, Archive, ShieldAlert, Mail, MailOpen, StarIcon } from 'lucide-react';

interface MailToolbarProps {
  selectedCount: number;
  totalCount: number;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelectAll: () => void;
  onBulkAction: (action: string) => void;
}

const SEARCH_HINTS = [
  { syntax: 'from:john', desc: 'Messages from sender' },
  { syntax: 'to:alice', desc: 'Messages to recipient' },
  { syntax: 'subject:meeting', desc: 'Words in subject line' },
  { syntax: 'has:attachment', desc: 'Messages with attachments' },
  { syntax: 'is:unread', desc: 'Unread messages only' },
  { syntax: 'is:starred', desc: 'Starred messages' },
  { syntax: 'before:2026-01-01', desc: 'Messages before date' },
  { syntax: 'after:2026-01-01', desc: 'Messages after date' },
];

export function MailToolbar({ selectedCount, totalCount, searchQuery, onSearchChange, onSelectAll, onBulkAction }: MailToolbarProps) {
  const allSelected = selectedCount > 0 && selectedCount === totalCount;
  const [showHints, setShowHints] = useState(false);

  return (
    <div style={{ borderBottom: '1px solid var(--border-glass)' }}>
      {/* Search row — always visible */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        background: 'rgba(0,0,0,0.1)', position: 'relative' }}>
        <input type="checkbox" checked={allSelected} onChange={onSelectAll} title="Select all" />
        <input type="text" className="glass-input" placeholder="Search messages..."
          value={searchQuery} onChange={(e) => onSearchChange(e.target.value)}
          onFocus={() => setShowHints(true)}
          onBlur={() => setTimeout(() => setShowHints(false), 200)}
          style={{ flex: 1, fontSize: '0.85rem' }} />
        {showHints && !searchQuery && (
          <div className="glass-panel" style={{
            position: 'absolute', top: '100%', left: 48, right: 12, zIndex: 20,
            marginTop: 2, padding: 8, maxHeight: 220, overflow: 'auto',
          }}>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginBottom: 6, padding: '0 4px' }}>
              Search syntax
            </div>
            {SEARCH_HINTS.map((h) => (
              <div key={h.syntax}
                onMouseDown={(e) => { e.preventDefault(); onSearchChange(h.syntax); setShowHints(false); }}
                style={{
                  display: 'flex', justifyContent: 'space-between', gap: 12,
                  padding: '6px 8px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                  fontSize: '0.8rem',
                }}
                className="nav-item"
              >
                <code style={{ color: 'var(--accent-primary)', fontSize: '0.78rem' }}>{h.syntax}</code>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{h.desc}</span>
              </div>
            ))}
          </div>
        )}
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
