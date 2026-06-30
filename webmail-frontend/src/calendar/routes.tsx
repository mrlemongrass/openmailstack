import { Routes, Route } from 'react-router';
import { CalendarLayout } from './CalendarLayout';

export function CalendarRoutes() {
  return (
    <Routes>
      <Route index element={<CalendarLayout />} />
      <Route path=":view" element={<CalendarLayout />} />
    </Routes>
  );
}
