import React, { useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { LiveNoteEditor } from '../../LiveNoteEditor';
import type { useNotes } from '../hooks/useNotes';
import { saveNote } from '../../shared/api';

interface NoteEditorModalProps {
  notesCtx: ReturnType<typeof useNotes>;
}

export function NoteEditorModal({ notesCtx: n }: NoteEditorModalProps) {
  const titleRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();

  if (!n.isNoteModalOpen) return null;

  const note = n.editingNote;
  const isNew = !note.id;

  const handleClose = useCallback(() => {
    n.setIsNoteModalOpen(false);
    n.setEditingNote({});
    n.fetchNotes();
  }, [n]);

  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    n.setEditingNote((prev: any) => ({ ...prev, title: e.target.value }));
  }, [n]);

  const handleContentChange = useCallback((content: string) => {
    n.setEditingNote((prev: any) => ({ ...prev, content }));
    // Auto-save debounced
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (n.editingNote.title || n.editingNote.content) {
        try {
          await saveNote({
            id: n.editingNote.id,
            title: n.editingNote.title || 'Untitled',
            content: n.editingNote.content || '',
            color: n.editingNote.color,
            is_pinned: n.editingNote.is_pinned,
            is_locked: n.editingNote.is_locked,
            folder: n.editingNote.folder || 'notes',
            labels_json: n.editingNote.labels_json || '[]',
          } as any);
          if (isNew) {
            n.fetchNotes();
          }
        } catch (e) {
          console.error('Auto-save failed', e);
        }
      }
    }, 1500);
  }, [n]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Focus title on new note
  useEffect(() => {
    if (isNew && titleRef.current) {
      titleRef.current.focus();
    }
  }, [isNew]);

  return (
    <div className="note-modal-overlay" onClick={(e) => {
      if (e.target === e.currentTarget) handleClose();
    }}>
      <div className="note-modal">
        <div className="note-modal-header">
          <input
            ref={titleRef}
            type="text"
            className="note-modal-title"
            placeholder="Note title..."
            value={note.title || ''}
            onChange={handleTitleChange}
          />
          <div className="note-modal-actions">
            <button className="btn btn-ghost btn-sm" onClick={handleClose} title="Close">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="note-modal-editor">
          <LiveNoteEditor
            noteId={note.id || 'new'}
            initialContent={note.content || ''}
            onChange={handleContentChange}
          />
        </div>
      </div>
    </div>
  );
}
