import { Routes, Route, Navigate } from 'react-router';
import { AuthGate } from './shared/layouts/AuthGate';
import { AppShell } from './shared/layouts/AppShell';
import { MailRoutes } from './mail/routes';
import { CalendarRoutes } from './calendar/routes';
import { ContactsRoutes } from './contacts/routes';
import { NotesRoutes } from './notes/routes';
import { SettingsRoutes } from './settings/routes';
import { AdminRoutes } from './admin/routes';

function SyncView() {
  return (
    <div className="glass-panel" style={{ margin: 20, padding: 40 }}>
      <h2 style={{ margin: '0 0 16px' }}>Sync Setup</h2>
      <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        Configure your devices to sync mail, calendars, and contacts.
        Use the settings below to find your server URLs.
      </p>
      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="glass-panel" style={{ padding: 16 }}>
          <strong>IMAP Server:</strong> your-server.com:993 (SSL)
        </div>
        <div className="glass-panel" style={{ padding: 16 }}>
          <strong>SMTP Server:</strong> your-server.com:587 (STARTTLS)
        </div>
        <div className="glass-panel" style={{ padding: 16 }}>
          <strong>CalDAV URL:</strong> https://your-server.com/caldav
        </div>
        <div className="glass-panel" style={{ padding: 16 }}>
          <strong>CardDAV URL:</strong> https://your-server.com/carddav
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<AuthGate />}>
        <Route element={<AppShell />}>
          <Route path="mail/*" element={<MailRoutes />} />
          <Route path="calendar/*" element={<CalendarRoutes />} />
          <Route path="contacts/*" element={<ContactsRoutes />} />
          <Route path="notes/*" element={<NotesRoutes />} />
          <Route path="settings/*" element={<SettingsRoutes />} />
          <Route path="admin/*" element={<AdminRoutes />} />
          <Route path="sync" element={<SyncView />} />
          <Route index element={<Navigate to="/mail/inbox" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
