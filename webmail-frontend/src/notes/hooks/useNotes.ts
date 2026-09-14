import { useState, useCallback, useEffect, useRef } from 'react';
import type { Note } from '../../shared/types';
import * as api from '../../shared/api';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const mutationLock = useRef(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const fetchGeneration = useRef(0);
  const [notesView, setNotesView] = useState('notes');
  const trashView = notesView === 'trash';
  const [notesSource, setNotesSource] = useState(false);
  const [notesSearchQuery, setNotesSearchQuery] = useState('');
  const [notesLabels, setNotesLabels] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('oms_notes_labels') || '["Work","Personal","Ideas"]'); }
    catch { return ['Work', 'Personal', 'Ideas']; }
  });
  const [isLoading, setIsLoading] = useState(false);
  const [notesError, setNotesError] = useState('');
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [editingNote, setEditingNote] = useState<Partial<Note>>({});
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [notesSort, setNotesSort] = useState<string>('updated');

  const fetchNotes = useCallback(async () => {
    const generation = ++fetchGeneration.current;
    setIsLoading(true);
    try {
      const response = await fetch(`/api/notes${trashView ? '?view=trash' : ''}`);
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not load notes.');
      if (generation === fetchGeneration.current) { setNotes(data.notes); setNotesSource(trashView); setNotesError(''); }
    } catch (e: unknown) { if (generation === fetchGeneration.current) setNotesError(errorMessage(e, 'Failed to load notes')); }
    finally { if (generation === fetchGeneration.current) setIsLoading(false); }
  }, [trashView]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchNotes(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchNotes]);

  const saveNote = useCallback(async (note: Partial<Note>) => {
    const saved = await api.saveNote(note);
    await fetchNotes();
    return saved;
  }, [fetchNotes]);

  const changeTrash = useCallback(async (id: string, action: 'trash' | 'restore' | 'permanent') => {
    if (mutationLock.current) throw new Error('Wait for the current note change.');
    mutationLock.current = true; setMutationBusy(true);
    try {
      const response = await fetch(`/api/notes/${encodeURIComponent(id)}${action === 'trash' ? '' : `/${action}`}`, { method: action === 'restore' ? 'POST' : 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: action === 'permanent' }) });
      const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.error || 'The note could not be changed.');
      await fetchNotes();
    } finally { mutationLock.current = false; setMutationBusy(false); }
  }, [fetchNotes]);
  const deleteNote = useCallback((id: string) => changeTrash(id, 'trash'), [changeTrash]);
  const restoreNote = useCallback((id: string) => changeTrash(id, 'restore'), [changeTrash]);
  const purgeNote = useCallback((id: string) => changeTrash(id, 'permanent'), [changeTrash]);

  return {
    notes: notesSource === trashView ? notes : [], notesView, setNotesView, notesSearchQuery, setNotesSearchQuery,
    notesLabels, setNotesLabels, isLoading, notesError,
    selectedNote, setSelectedNote, editingNote, setEditingNote,
    isNoteModalOpen, setIsNoteModalOpen,
    notesSort, setNotesSort,
    fetchNotes, saveNote, deleteNote, restoreNote, purgeNote, mutationBusy,
  };
}
