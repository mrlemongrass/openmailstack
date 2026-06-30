import { Routes, Route, Navigate } from 'react-router';
import { AuthGate } from './shared/layouts/AuthGate';
import { AppShell } from './shared/layouts/AppShell';

function MailPlaceholder() {
  return <div className="glass-panel" style={{ margin: 20, padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Mail — coming soon</div>;
}
function CalendarPlaceholder() {
  return <div className="glass-panel" style={{ margin: 20, padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Calendar — coming soon</div>;
}
function ContactsPlaceholder() {
  return <div className="glass-panel" style={{ margin: 20, padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Contacts — coming soon</div>;
}
function NotesPlaceholder() {
  return <div className="glass-panel" style={{ margin: 20, padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Notes — coming soon</div>;
}
function SettingsPlaceholder() {
  return <div className="glass-panel" style={{ margin: 20, padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Settings — coming soon</div>;
}
function AdminPlaceholder() {
  return <div className="glass-panel" style={{ margin: 20, padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Admin — coming soon</div>;
}
function SyncPlaceholder() {
  return <div className="glass-panel" style={{ margin: 20, padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Sync Info — coming soon</div>;
}

export default function App() {
  return (
    <Routes>
      <Route element={<AuthGate />}>
        <Route element={<AppShell />}>
          <Route path="mail/*" element={<MailPlaceholder />} />
          <Route path="calendar/*" element={<CalendarPlaceholder />} />
          <Route path="contacts/*" element={<ContactsPlaceholder />} />
          <Route path="notes/*" element={<NotesPlaceholder />} />
          <Route path="settings/*" element={<SettingsPlaceholder />} />
          <Route path="admin/*" element={<AdminPlaceholder />} />
          <Route path="sync" element={<SyncPlaceholder />} />
          <Route index element={<Navigate to="/mail/inbox" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
