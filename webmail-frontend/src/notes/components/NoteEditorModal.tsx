import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Check, Loader } from 'lucide-react';
import { LiveNoteEditor } from '../../LiveNoteEditor';
import { ReminderPicker } from './ReminderPicker';
import { AttachmentList } from './AttachmentList';
import type { useNotes } from '../hooks/useNotes';
import { NoteSaveConflictError, saveNote } from '../../shared/api';
import { useToast } from '../../shared/components/Toast';
import type { Note } from '../../shared/types';
import { useModalFocus } from '../../shared/hooks/useModalFocus';
import { createNoteSaveCoordinator } from '../note-save-coordinator';

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latestDraftRef = useRef<Partial<Note>>(n.editingNote);
  const draftRevisionRef = useRef(0);
  const wasModalOpenRef = useRef(false);
  const closePromiseRef = useRef<Promise<void> | null>(null);
  const saveCoordinatorRef = useRef(createNoteSaveCoordinator({
    id: n.editingNote.id || null,
    syncToken: n.editingNote.sync_token ?? null,
  }));
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | null>(null);

  // ── All hooks MUST be before the early return ──────────────────────────

  useEffect(() => {
    latestDraftRef.current = n.editingNote;
  }, [n.editingNote]);

  useEffect(() => {
    if (n.isNoteModalOpen && !wasModalOpenRef.current) {
      latestDraftRef.current = n.editingNote;
      draftRevisionRef.current = 0;
      saveCoordinatorRef.current.reset({
        id: n.editingNote.id || null,
        syncToken: n.editingNote.sync_token ?? null,
      });
      setSaveStatus(null);
    }
    wasModalOpenRef.current = n.isNoteModalOpen;
  }, [n.editingNote, n.isNoteModalOpen]);

  const queueLatestSave = useCallback(() => saveCoordinatorRef.current.enqueue(async (identity) => {
    const latest = latestDraftRef.current;
    const title = titleRef.current?.value ?? latest.title ?? '';
    const content = latest.content || '';
    const id = identity.id || latest.id;
    if (!id && !title && !content) {
      setSaveStatus(null);
      return {};
    }

    const savingRevision = draftRevisionRef.current;
    setSaveStatus('saving');
    const saved = await saveNote({
      id,
      title: title || 'Untitled',
      content,
      color: latest.color,
      is_pinned: latest.is_pinned,
      is_locked: latest.is_locked,
      folder: latest.folder || 'notes',
      labels_json: latest.labels_json || '[]',
      expected_sync_token: identity.syncToken ?? latest.sync_token,
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
      if (!id) void n.fetchNotes();
    }
    setSaveStatus(draftRevisionRef.current === savingRevision ? 'saved' : 'saving');
    return saved;
  }), [n]);

  const reportSaveError = useCallback((error: unknown, automatic: boolean) => {
    if (error instanceof NoteSaveConflictError) {
      showToast({ type: 'error', message: error.message });
    } else {
      showToast({ type: 'error', message: 'The note could not be saved. Your draft is still open.' });
    }
    console.error(automatic ? 'Auto-save failed' : 'Save on close failed', error);
    setSaveStatus(null);
  }, [showToast]);

  const scheduleAutoSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setSaveStatus('saving');
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = undefined;
      void queueLatestSave().catch((error) => reportSaveError(error, true));
    }, 1500);
  }, [queueLatestSave, reportSaveError]);

  const handleClose = useCallback(() => {
    if (closePromiseRef.current) return closePromiseRef.current;
    const operation = (async () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = undefined;
      }
      try {
        await queueLatestSave();
      } catch (error) {
        reportSaveError(error, false);
        return;
      }
      const latest = latestDraftRef.current;
      const title = titleRef.current?.value ?? latest.title ?? '';
      const content = latest.content || '';
      n.setIsNoteModalOpen(false);
      n.setEditingNote({});
      await n.fetchNotes();
      if (latest.id || title || content) showToast({ type: 'success', message: 'Note saved' });
    })();
    closePromiseRef.current = operation.finally(() => {
      closePromiseRef.current = null;
    });
    return closePromiseRef.current;
  }, [n, queueLatestSave, reportSaveError, showToast]);

  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    draftRevisionRef.current += 1;
    latestDraftRef.current = { ...latestDraftRef.current, title: e.target.value };
    n.setEditingNote((prev) => ({ ...prev, title: e.target.value }));
    scheduleAutoSave();
  }, [n, scheduleAutoSave]);

  const handleContentChange = useCallback((content: string) => {
    draftRevisionRef.current += 1;
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

  useModalFocus({
    dialogRef,
    open: n.isNoteModalOpen,
    onClose: handleClose,
  });

  // ── Early return after all hooks ──────────────────────────────────────

  if (!n.isNoteModalOpen) return null;

  const note = n.editingNote;

  return (
    <div className="note-modal-overlay" onClick={(e) => {
      if (e.target === e.currentTarget) handleClose();
    }}>
      <div
        ref={dialogRef}
        className="note-modal"
        role="dialog"
        aria-modal="true"
        aria-label={note.id ? `Edit note ${note.title || 'Untitled'}` : 'New note'}
        tabIndex={-1}
      >
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
                    draftRevisionRef.current += 1;
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
            <button className="btn btn-ghost btn-sm" aria-label="Close note editor" onClick={handleClose} title="Close">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="note-modal-editor">
          <LiveNoteEditor
            key={note.id || 'new'}
            noteId={note.id}
            initialContent={note.content || ''}
            onChange={handleContentChange}
          />
        </div>
        <AttachmentList noteId={note.id} />
      </div>
    </div>
  );
}
