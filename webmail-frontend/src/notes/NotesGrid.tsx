import { useRef, useState } from 'react';
import { Star, EyeOff, StickyNote, PenLine, Plus } from 'lucide-react';
import { NoteSkeleton } from './components/NoteSkeleton';
import { SortDropdown } from './components/SortDropdown';
import { EmptyState } from '../shared/components/EmptyState';
import { ErrorBanner } from '../shared/components/ErrorBanner';
import { useToast } from '../shared/components/Toast';
import { ScrollToTop } from '../shared/components/ScrollToTop';
import type { useNotes } from './hooks/useNotes';
import type { Note } from '../shared/types';
import { NoteSaveConflictError } from '../shared/api';
import { ConfirmDialog } from '../shared/components/ConfirmDialog';

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function parseNoteLabels(raw?: string | null): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function NotesGrid({ notesCtx: n, isMobile = false }: {
  notesCtx: ReturnType<typeof useNotes>;
  isMobile?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const openNewNote = () => {
    n.setEditingNote({});
    n.setIsNoteModalOpen(true);
  };
  const filtered = n.notes.filter((note) => {
    if (n.notesView === 'pinned') {
      return note.is_pinned;
    } else if (n.notesView === 'archive') {
      return note.folder === 'archive';
    } else if (n.notesView === 'notes') {
      return note.folder !== 'archive';
    } else if (n.notesLabels.includes(n.notesView)) {
      try { return JSON.parse(note.labels_json || '[]').includes(n.notesView); } catch { return false; }
    }
    return true;
  }).filter((note) => {
    if (!n.notesSearchQuery) return true;
    const q = n.notesSearchQuery.toLowerCase();
    return note.title.toLowerCase().includes(q) || note.content.toLowerCase().includes(q);
  }).sort((a, b) => {
    // Pinned always on top
    if (a.is_pinned && !b.is_pinned) return -1;
    if (!a.is_pinned && b.is_pinned) return 1;
    // Then apply selected sort
    switch (n.notesSort) {
      case 'created': return new Date(b.created_at || '1970-01-01').getTime() - new Date(a.created_at || '1970-01-01').getTime();
      case 'title_asc': return (a.title || '').localeCompare(b.title || '');
      case 'title_desc': return (b.title || '').localeCompare(a.title || '');
      case 'updated':
      default: return new Date(b.updated_at || '1970-01-01').getTime() - new Date(a.updated_at || '1970-01-01').getTime();
    }
  });

  if (n.isLoading && n.notes.length === 0) return <NoteSkeleton count={12} />;

  if (n.notesError) {
    return (
      <div style={{ padding: 20 }}>
        <ErrorBanner error={n.notesError} onRetry={() => n.fetchNotes()} />
      </div>
    );
  }

  if (!n.isLoading && n.notes.length === 0) {
    return (
      <EmptyState
        icon={PenLine}
        title="No notes yet"
        description="Create your first note to start writing. Notes support rich text, attachments, and reminders."
        action={{ label: 'Create Note', onClick: openNewNote }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border-glass)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="text" className="glass-input" placeholder="Search notes..."
            value={n.notesSearchQuery} onChange={(e) => n.setNotesSearchQuery(e.target.value)}
            style={{ flex: 1, fontSize: '0.85rem' }} />
          <SortDropdown value={n.notesSort} onChange={n.setNotesSort} />
        </div>
        {isMobile && (
          <button className="btn btn-primary" onClick={openNewNote} style={{ width: '100%' }}>
            <Plus size={16} /> New Note
          </button>
        )}
      </div>
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: 16,
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16,
        alignContent: 'start' }}>
        {filtered.map((note) => (<NoteCard key={note.id} note={note} n={n} />))}
        {filtered.length === 0 && !n.isLoading && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 60,
            color: 'var(--text-secondary)' }}>
            <StickyNote size={48} style={{ marginBottom: 16, opacity: 0.4 }} />
            <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>No notes found</div>
            <div style={{ marginTop: 4 }}>Create a new note to get started</div>
          </div>
        )}
      </div>
      <ScrollToTop scrollRef={scrollRef} />
    </div>
  );
}

function NoteCard({ note, n }: { note: Note; n: ReturnType<typeof useNotes> }) {
  const { showToast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const labels = parseNoteLabels(note.labels_json);
  const isPinned = Boolean(note.is_pinned);
  const isLocked = Boolean(note.is_locked);

  const stripsHtml = note.content?.replace(/<[^>]*>/g, '') || '';
  const updatedAt = note.updated_at ? new Date(note.updated_at) : null;
  const relativeTime = updatedAt ? formatRelativeTime(updatedAt) : '';

  const saveCardChange = async (changes: Partial<Note>, successMessage: string) => {
    try {
      await n.saveNote({
        ...note,
        ...changes,
        expected_sync_token: note.sync_token,
      });
      showToast({ type: 'info', message: successMessage });
    } catch (error) {
      showToast({
        type: 'error',
        message: error instanceof NoteSaveConflictError
          ? error.message
          : 'The note could not be updated. Try again.',
      });
    }
  };

  const deleteCard = async () => {
    try {
      await n.deleteNote(note.id);
      setConfirmDelete(false);
      showToast({ type: 'info', message: 'Note deleted permanently' });
    } catch {
      showToast({ type: 'error', message: 'The note could not be deleted. Try again.' });
    }
  };

  return (
    <>
      <div className="contact-card glass-panel" style={{
      padding: 0, borderRadius: 'var(--radius-md)', overflow: 'hidden',
      position: 'relative',
      borderTop: `4px solid ${note.color || '#3B82F6'}`,
    }}>
      <div
        role="button"
        tabIndex={0}
        aria-label={`Open note ${note.title || 'Untitled'}`}
        onClick={() => { n.setEditingNote(note); n.setIsNoteModalOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            n.setEditingNote(note);
            n.setIsNoteModalOpen(true);
          }
        }}
        style={{
          display: 'block', width: '100%', padding: 0, border: 0,
          background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer',
        }}
      >
      <div style={{ padding: 16 }}>
        <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: 6,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {note.title || 'Untitled'}
        </div>
        {isLocked ? (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <EyeOff size={12} /> Preview hidden
          </div>
        ) : (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)',
            display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
            overflow: 'hidden', lineHeight: 1.4 }}>
            {stripsHtml || 'No content'}
          </div>
        )}
      </div>
      {labels.length > 0 && (
        <div style={{ display: 'flex', gap: 4, padding: '0 16px 8px', flexWrap: 'wrap' }}>
          {labels.map((l) => (
            <span key={l} style={{
              fontSize: '0.65rem', padding: '1px 6px', borderRadius: 999,
              background: 'rgba(59,130,246,0.15)', color: 'var(--accent-primary)',
            }}>{l}</span>
          ))}
        </div>
      )}
      {/* Footer: timestamp + pin indicator */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '4px 16px 8px', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
        <span>{relativeTime || 'Draft'}</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {isPinned && <Star size={11} style={{ color: '#f59e0b' }} />}
          {isLocked && <EyeOff size={11} />}
        </div>
      </div>
      </div>
      {/* Hover actions */}
      <div className="note-card-actions" style={{
        display: 'flex', gap: 4, padding: '0 16px 10px', opacity: 0, transition: 'opacity 0.15s',
      }} onClick={(e) => e.stopPropagation()}>
        {note.folder === 'archive' ? (
          <button className="btn btn-ghost btn-xs"
            style={{ fontSize: '0.7rem' }}
            onClick={(e) => {
              e.stopPropagation();
              void saveCardChange({ folder: 'notes' }, 'Note restored');
            }}>
            Unarchive
          </button>
        ) : (
          <button className="btn btn-ghost btn-xs"
            style={{ fontSize: '0.7rem' }}
            onClick={(e) => {
              e.stopPropagation();
              void saveCardChange({ folder: 'archive' }, 'Note archived');
            }}>
            Archive
          </button>
        )}
        <button className="btn btn-ghost btn-xs"
          style={{ fontSize: '0.7rem', color: 'var(--danger)' }}
          onClick={(e) => {
            e.stopPropagation();
            setConfirmDelete(true);
          }}>
          Delete
        </button>
        <button className="btn btn-ghost btn-xs"
          style={{ fontSize: '0.7rem', color: isPinned ? '#f59e0b' : undefined }}
          onClick={(e) => {
            e.stopPropagation();
            const newPinned = !isPinned;
            void saveCardChange(
              { is_pinned: newPinned ? 1 : 0 },
              newPinned ? 'Note pinned' : 'Note unpinned',
            );
          }}>
          <Star size={12} fill={isPinned ? '#f59e0b' : 'none'} /> {isPinned ? 'Unpin' : 'Pin'}
        </button>
      </div>
      {isPinned ? (
        <div style={{ position: 'absolute', top: 8, right: 8 }}>
          <Star size={14} fill="#f59e0b" color="#f59e0b" />
        </div>
      ) : null}
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete note permanently?"
        message="This permanently deletes the note, its attachments, and its reminder. This action cannot be undone."
        confirmLabel="Delete permanently"
        danger
        onConfirm={() => { void deleteCard(); }}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
