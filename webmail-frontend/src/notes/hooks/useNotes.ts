import { useState, useCallback, useEffect } from 'react';
import type { Note } from '../../shared/types';
import * as api from '../../shared/api';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesView, setNotesView] = useState('notes');
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
    setIsLoading(true);
    try { setNotes(await api.fetchNotesApi()); setNotesError(''); } catch (e: unknown) { setNotesError(errorMessage(e, 'Failed to load notes')); console.error('Failed to fetch notes', e); }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchNotes(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchNotes]);

  const saveNote = useCallback(async (note: Partial<Note>) => {
    try { await api.saveNote(note); await fetchNotes(); } catch (e) { console.error(e); }
  }, [fetchNotes]);

  const deleteNote = useCallback(async (id: string) => {
    try { await api.deleteNoteApi(id); await fetchNotes(); } catch (e) { console.error(e); }
  }, [fetchNotes]);

  return {
    notes, notesView, setNotesView, notesSearchQuery, setNotesSearchQuery,
    notesLabels, setNotesLabels, isLoading, notesError,
    selectedNote, setSelectedNote, editingNote, setEditingNote,
    isNoteModalOpen, setIsNoteModalOpen,
    notesSort, setNotesSort,
    fetchNotes, saveNote, deleteNote,
  };
}
