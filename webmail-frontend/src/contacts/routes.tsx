import { Routes, Route } from 'react-router';
import { ContactsLayout } from './ContactsLayout';

export function ContactsRoutes() {
  return (
    <Routes>
      <Route index element={<ContactsLayout />} />
    </Routes>
  );
}
