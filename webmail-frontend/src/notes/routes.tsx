import { Routes, Route } from 'react-router';
import { NotesLayout } from './NotesLayout';

export function NotesRoutes() {
  return (
    <Routes>
      <Route index element={<NotesLayout />} />
      <Route path=":id" element={<NotesLayout />} />
    </Routes>
  );
}
