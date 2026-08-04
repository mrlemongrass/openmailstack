import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Check, Loader } from 'lucide-react';
import { LiveNoteEditor } from '../../LiveNoteEditor';
import { ReminderPicker } from './ReminderPicker';
import { AttachmentList } from './AttachmentList';
import type { useNotes } from '../hooks/useNotes';
import { NoteSaveConflictError, saveNote } from '../../shared/api';
import { useToast } from '../../shared/components/Toast';
import type { Note } from '../../shared/types';

const NOTE_COLORS = [
  '#ffffff', '#f28b82', '#fbbc04', '#fff475', '#ccff90',
  '#a7ffeb', '#cbf0f8', '#aecbfa', '#d7aefb', '#fdcfe8',
  '#e6c9a8', '#e8eaed',
];

interface NoteEditorModalProps {
  notesCtx: ReturnType<typeof useNotes>;
}

export function NoteEditorModal({ notesCtx: n }: NoteEditorModalProps) {
  const { showToast } = useToast();
  const titleRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latestDraftRef = useRef<Partial<Note>>(n.editingNote);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | null>(null);

  // ── All hooks MUST be before the early return ──────────────────────────

  useEffect(() => {
    latestDraftRef.current = n.editingNote;
  }, [n.editingNote]);

  const scheduleAutoSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('saving');
    saveTimerRef.current = setTimeout(async () => {
      const latest = latestDraftRef.current;
      const title = titleRef.current?.value || latest.title || '';
      const content = latest.content || '';
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
            expected_sync_token: latest.sync_token,
          });
          if (saved?.id) {
            latestDraftRef.current = {
              ...latestDraftRef.current,
              id: saved.id,
              sync_token: saved.sync_token,
            };
            n.setEditingNote((prev) => ({
              ...prev,
              id: saved.id,
              sync_token: saved.sync_token,
            }));
          }
          if (!latest.id && saved?.id) {
            n.fetchNotes();
          }
          setSaveStatus('saved');
        } catch (e) {
          if (e instanceof NoteSaveConflictError) {
            showToast({ type: 'error', message: e.message });
          } else {
            showToast({ type: 'error', message: 'The note could not be saved. Your draft is still open.' });
          }
          console.error('Auto-save failed', e);
          setSaveStatus(null);
        }
      }
    }, 1500);
  }, [n, showToast]);

  const handleClose = useCallback(async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const latest = latestDraftRef.current;
    const title = titleRef.current?.value || latest.title || '';
    const content = latest.content || '';
    if (title || content) {
      try {
        await saveNote({
          id: latest.id,
          title: title || 'Untitled',
          content: content || '',
          color: latest.color,
          is_pinned: latest.is_pinned,
          is_locked: latest.is_locked,
          folder: latest.folder || 'notes',
          labels_json: latest.labels_json || '[]',
          expected_sync_token: latest.sync_token,
        });
      } catch (e) {
        if (e instanceof NoteSaveConflictError) {
          showToast({ type: 'error', message: e.message });
          return;
        }
        console.error('Save on close failed', e);
        showToast({ type: 'error', message: 'The note could not be saved. Your draft is still open.' });
        return;
      }
    }
    n.setIsNoteModalOpen(false);
    n.setEditingNote({});
    n.fetchNotes();
    if (title || content) showToast({ type: 'success', message: 'Note saved' });
  }, [n, showToast]);

  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    latestDraftRef.current = { ...latestDraftRef.current, title: e.target.value };
    n.setEditingNote((prev) => ({ ...prev, title: e.target.value }));
    scheduleAutoSave();
  }, [n, scheduleAutoSave]);

  const handleContentChange = useCallback((content: string) => {
    latestDraftRef.current = { ...latestDraftRef.current, content };
    n.setEditingNote((prev) => ({ ...prev, content }));
    scheduleAutoSave();
  }, [n, scheduleAutoSave]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const noteId = n.editingNote.id;
    if (!noteId && titleRef.current) {
      titleRef.current.focus();
    }
  }, [n.editingNote.id]);

  // ── Early return after all hooks ──────────────────────────────────────

  if (!n.isNoteModalOpen) return null;

  const note = n.editingNote;

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
          <div className="note-modal-meta">
            <div className="note-color-picker">
              {NOTE_COLORS.map(color => (
                <button
                  key={color}
                  className={`note-color-swatch${note.color === color ? ' active' : ''}`}
                  style={{ backgroundColor: color }}
                  title={color}
                  onClick={() => {
                    latestDraftRef.current = { ...latestDraftRef.current, color };
                    n.setEditingNote((prev) => ({ ...prev, color }));
                    scheduleAutoSave();
                  }}
                />
              ))}
            </div>
            <div className="note-modal-status-controls">
              <ReminderPicker noteId={note.id} />
              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                {(note.content || '').replace(/<[^>]*>/g, '').trim().split(/\s+/).filter(Boolean).length} words
              </span>
              {saveStatus && (
                <span style={{
                  fontSize: '0.72rem', display: 'inline-flex', alignItems: 'center', gap: 4,
                  color: saveStatus === 'saved' ? '#10b981' : 'var(--text-secondary)',
                }}>
                  {saveStatus === 'saving' ? <Loader size={12} className="spin" /> : <Check size={12} />}
                  {saveStatus === 'saving' ? 'Saving...' : 'Saved'}
                </span>
              )}
            </div>
          </div>
          <div className="note-modal-actions">
            <button className="btn btn-ghost btn-sm" onClick={handleClose} title="Close">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="note-modal-editor">
          <LiveNoteEditor
            key={note.id || 'new'}
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
