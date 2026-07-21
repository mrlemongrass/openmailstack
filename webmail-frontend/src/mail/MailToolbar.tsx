import { useRef, useState } from 'react';
import { Trash2, Archive, ShieldAlert, Mail, MailOpen, StarIcon, X, FolderOpen } from 'lucide-react';
import type { MailFolder, SearchField, SearchScope } from '../shared/types';
import { MoveToPopover } from './components/MoveToPopover';
import { moveDestinationFolders } from './mail-message-identity';

interface MailToolbarProps {
  selectedCount: number;
  totalCount: number;
  searchQuery: string;
  searchField: SearchField;
  searchScope: SearchScope;
  isSearchActive: boolean;
  selectionDisabled: boolean;
  activeFolder?: string;
  folders: MailFolder[];
  onSearchChange: (q: string) => void;
  onSearchSubmit: () => void;
  onSearchFieldChange: (field: SearchField) => void;
  onSearchScopeChange: (scope: SearchScope) => void;
  onClearSearch: () => void;
  onSelectAll: () => void;
  onBulkAction: (action: string) => void;
  onMoveSelected: (targetFolder: string) => void;
  onMarkAllRead?: () => void;
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

export function MailToolbar({ selectedCount, totalCount, searchQuery, searchField, searchScope, isSearchActive, selectionDisabled, activeFolder, folders, onSearchChange, onSearchSubmit, onSearchFieldChange, onSearchScopeChange, onClearSearch, onSelectAll, onBulkAction, onMoveSelected, onMarkAllRead }: MailToolbarProps) {
  const allSelected = selectedCount > 0 && selectedCount === totalCount;
  const [showHints, setShowHints] = useState(false);
  const [showMoveTo, setShowMoveTo] = useState(false);
  const moveButtonRef = useRef<HTMLButtonElement>(null);
  const moveFolders = moveDestinationFolders(folders, activeFolder || '');
  const closeMoveTo = () => {
    setShowMoveTo(false);
    window.requestAnimationFrame(() => moveButtonRef.current?.focus());
  };

  return (
    <div style={{ borderBottom: '1px solid var(--border-glass)' }}>
      {/* Search row — always visible */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        background: 'rgba(0,0,0,0.1)', position: 'relative', flexWrap: 'wrap' }}>
        <input type="checkbox" checked={allSelected} onChange={onSelectAll} title={selectionDisabled ? 'Bulk selection is unavailable across folders' : 'Select all'} disabled={selectionDisabled} />
        <input type="text" className="glass-input" placeholder="Search messages..."
          value={searchQuery} onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSearchSubmit(); } }}
          onFocus={() => setShowHints(true)}
          onBlur={() => setTimeout(() => setShowHints(false), 200)}
          style={{ flex: 1, minWidth: 160, fontSize: '0.85rem' }} />
        <select className="glass-input glass-select" aria-label="Search field" value={searchField}
          onChange={(e) => onSearchFieldChange(e.target.value as SearchField)}>
          <option value="all">Everything</option>
          <option value="from">From</option>
          <option value="to">To</option>
          <option value="subject">Subject</option>
          <option value="body">Body</option>
          <option value="attachments">Attachments</option>
          <option value="unread">Unread</option>
          <option value="starred">Starred</option>
        </select>
        <select className="glass-input glass-select" aria-label="Search scope" value={searchScope}
          onChange={(e) => onSearchScopeChange(e.target.value as SearchScope)}>
          <option value="folder">Current folder</option>
          <option value="all">All mail</option>
        </select>
        {isSearchActive && (
          <button className="btn btn-ghost" aria-label="Clear search" title="Clear search" onClick={onClearSearch}
            style={{ padding: 4, flexShrink: 0 }}>
            <X size={16} />
          </button>
        )}
        {activeFolder && (
          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
            {searchScope === 'folder' ? `in ${activeFolder}` : 'all folders'}
          </span>
        )}
        {onMarkAllRead && totalCount > 0 && (
          <button className="btn btn-ghost" onClick={onMarkAllRead}
            style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }} title="Mark all as read">
            Mark all read
          </button>
        )}
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
      {selectedCount > 0 && !selectionDisabled && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', flexWrap: 'wrap',
          background: 'rgba(59,130,246,0.08)', borderTop: '1px solid var(--border-glass)' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', fontWeight: 500 }}>
            {selectedCount} selected
          </span>
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={() => onBulkAction('read')} title="Mark read"><Mail size={16} /></button>
          <button className="btn btn-ghost" onClick={() => onBulkAction('unread')} title="Mark unread"><MailOpen size={16} /></button>
          <button className="btn btn-ghost" onClick={() => onBulkAction('archive')} title="Archive"><Archive size={16} /></button>
          <div style={{ position: 'relative' }}>
            <button ref={moveButtonRef} className="btn btn-ghost" onClick={() => setShowMoveTo((visible) => !visible)}
              title="Move to folder" aria-haspopup="dialog" aria-expanded={showMoveTo} disabled={moveFolders.length === 0}>
              <FolderOpen size={16} />
            </button>
            {showMoveTo && (
              <MoveToPopover folders={moveFolders} align="right"
                onMove={onMoveSelected}
                onClose={closeMoveTo} />
            )}
          </div>
          <button className="btn btn-ghost" onClick={() => onBulkAction('star')} title="Star"><StarIcon size={16} /></button>
          <button className="btn btn-ghost" onClick={() => onBulkAction('spam')} title="Mark as spam"><ShieldAlert size={16} /></button>
          <button className="btn btn-danger" onClick={() => onBulkAction('delete')} title="Delete"><Trash2 size={16} /></button>
        </div>
      )}
    </div>
  );
}
