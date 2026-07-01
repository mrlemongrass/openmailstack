import React, { useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { LiveNoteEditor } from '../../LiveNoteEditor';
import { ReminderPicker } from './ReminderPicker';
import { AttachmentList } from './AttachmentList';
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
      // Read latest metadata at save time to avoid stale closure
      const latest = n.editingNote;
      const title = titleRef.current?.value || latest.title || '';
      if (title || content) {
        try {
          const saved = await saveNote({
            id: latest.id,
            title: title || 'Untitled',
            content: content || '',
            color: latest.color,
            is_pinned: latest.is_pinned,
            is_locked: latest.is_locked,
            folder: latest.folder || 'notes',
            labels_json: latest.labels_json || '[]',
          } as any);
          // For new notes, update editingNote.id with the returned saved.id
          if (!latest.id && saved?.id) {
            n.setEditingNote((prev: any) => ({ ...prev, id: saved.id }));
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
    if (!note.id && titleRef.current) {
      titleRef.current.focus();
    }
  }, [note.id]);

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
          <ReminderPicker noteId={note.id} />
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
        <AttachmentList noteId={note.id} />
      </div>
    </div>
  );
}
