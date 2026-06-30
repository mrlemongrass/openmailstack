import { Star, Lock, StickyNote } from 'lucide-react';
import { NoteSkeleton } from './components/NoteSkeleton';
import { SortDropdown } from './components/SortDropdown';
import type { useNotes } from './hooks/useNotes';
import type { Note } from '../shared/types';

export function NotesGrid({ notesCtx: n }: { notesCtx: ReturnType<typeof useNotes> }) {
  const filtered = n.notes.filter((note) => {
    if (n.notesView === 'pinned') {
      return note.is_pinned;
    } else if (n.notesView === 'locked') {
      return note.is_locked;
    } else if (n.notesView === 'archive') {
      return note.folder === 'archive';
    } else if (n.notesView === 'trash') {
      return note.folder === 'trash';
    } else if (n.notesView === 'notes') {
      return note.folder !== 'trash' && note.folder !== 'archive';
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border-glass)', alignItems: 'center' }}>
        <input type="text" className="glass-input" placeholder="Search notes..."
          value={n.notesSearchQuery} onChange={(e) => n.setNotesSearchQuery(e.target.value)}
          style={{ flex: 1, fontSize: '0.85rem' }} />
        <SortDropdown value={n.notesSort} onChange={n.setNotesSort} />
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16,
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
    </div>
  );
}

function NoteCard({ note, n }: { note: Note; n: ReturnType<typeof useNotes> }) {
  note.labels_json = note.labels_json || '[]';
  let labels: string[] = [];
  try { labels = JSON.parse(note.labels_json); } catch { labels = []; }

  const stripsHtml = note.content?.replace(/<[^>]*>/g, '') || '';

  return (
    <div className="contact-card glass-panel" style={{
      padding: 0, borderRadius: 'var(--radius-md)', overflow: 'hidden',
      cursor: 'pointer', position: 'relative',
      borderTop: `4px solid ${note.color || '#3B82F6'}`,
    }} onClick={() => { n.setEditingNote(note); n.setIsNoteModalOpen(true); }}>
      <div style={{ padding: 16 }}>
        <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: 6,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {note.title || 'Untitled'}
        </div>
        {note.is_locked ? (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Lock size={12} /> Locked Note
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
      {/* Hover actions */}
      <div className="note-card-actions" style={{
        display: 'flex', gap: 4, padding: '0 16px 10px', opacity: 0, transition: 'opacity 0.15s',
      }} onClick={(e) => e.stopPropagation()}>
        {note.folder === 'archive' ? (
          <button className="btn btn-ghost btn-xs"
            style={{ fontSize: '0.7rem' }}
            onClick={(e) => {
              e.stopPropagation();
              n.saveNote({ id: note.id, folder: 'notes' });
            }}>
            Unarchive
          </button>
        ) : note.folder !== 'trash' ? (
          <button className="btn btn-ghost btn-xs"
            style={{ fontSize: '0.7rem' }}
            onClick={(e) => {
              e.stopPropagation();
              n.saveNote({ id: note.id, folder: 'archive' });
            }}>
            Archive
          </button>
        ) : null}
      </div>
      {note.is_pinned ? (
        <div style={{ position: 'absolute', top: 8, right: 8 }}>
          <Star size={14} fill="#f59e0b" color="#f59e0b" />
        </div>
      ) : null}
    </div>
  );
}
