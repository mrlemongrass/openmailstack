import { StickyNote, Star, Lock, Archive, Trash2 } from 'lucide-react';
import type { useNotes } from './hooks/useNotes';

export function NotesSidebar({ notesCtx: n }: { notesCtx: ReturnType<typeof useNotes> }) {
  const filters = [
    { id: 'notes', label: 'All Notes', icon: StickyNote },
    { id: 'pinned', label: 'Pinned', icon: Star },
    { id: 'locked', label: 'Locked', icon: Lock },
    { id: 'archive', label: 'Archive', icon: Archive },
    { id: 'trash', label: 'Trash', icon: Trash2 },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 12 }}>
      <button className="btn btn-primary" style={{ width: '100%', marginBottom: 16 }}
        onClick={() => { n.setEditingNote({}); n.setIsNoteModalOpen(true); }}>
        + New Note
      </button>

      <div style={{ marginBottom: 16 }}>
        {filters.map((f) => (
          <div key={f.id} className="nav-item" style={{ display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
            background: n.notesView === f.id ? 'rgba(59,130,246,0.15)' : 'transparent',
            fontWeight: n.notesView === f.id ? 600 : 400,
            color: 'var(--text-secondary)', fontSize: '0.9rem' }}
            onClick={() => n.setNotesView(f.id)}>
            <f.icon size={16} />
            <span>{f.label}</span>
          </div>
        ))}
      </div>

      <div style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase',
        color: 'var(--text-secondary)', marginBottom: 8, letterSpacing: '0.05em' }}>
        Labels
      </div>
      {n.notesLabels.map((label) => (
        <div key={label} className="nav-item" style={{ display: 'flex', alignItems: 'center', gap: 8,
          padding: '4px 10px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
          background: n.notesView === label ? 'rgba(59,130,246,0.15)' : 'transparent',
          fontSize: '0.85rem' }}
          onClick={() => n.setNotesView(n.notesView === label ? 'notes' : label)}>
          <span style={{ width: 8, height: 8, borderRadius: '50%',
            background: 'var(--accent-primary)', flexShrink: 0 }} />
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}
