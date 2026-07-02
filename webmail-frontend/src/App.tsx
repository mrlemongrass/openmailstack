import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router';
import { AuthGate } from './shared/layouts/AuthGate';
import { AppShell } from './shared/layouts/AppShell';
import { ErrorBoundary } from './shared/components/ErrorBoundary';
import { Skeleton } from './shared/components/Skeleton';
import { MailRoutes } from './mail/routes';
import { CalendarRoutes } from './calendar/routes';
import { ContactsRoutes } from './contacts/routes';
import { SettingsRoutes } from './settings/routes';
const NotesRoutes = lazy(() => import('./notes/routes').then(m => ({ default: m.NotesRoutes })));
const AdminRoutes = lazy(() => import('./admin/routes').then(m => ({ default: m.AdminRoutes })));

function SyncView() {
  const hostname = window.location.hostname;
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
      <div className="glass-panel" style={{ maxWidth: 600, margin: '0 auto', padding: 40 }}>
        <h2 style={{ margin: '0 0 8px' }}>Sync Setup</h2>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 24px' }}>
          Configure your devices to sync mail, calendars, and contacts with OpenMailStack.
          Use the settings below in your email client, calendar app, or device settings.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="glass-panel" style={{ padding: 16 }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 4 }}>Incoming Mail (IMAP)</div>
            <div style={{ fontWeight: 600, fontFamily: 'monospace' }}>{hostname}:993</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>SSL/TLS required</div>
          </div>
          <div className="glass-panel" style={{ padding: 16 }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 4 }}>Outgoing Mail (SMTP)</div>
            <div style={{ fontWeight: 600, fontFamily: 'monospace' }}>{hostname}:587</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>STARTTLS required</div>
          </div>
          <div className="glass-panel" style={{ padding: 16 }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 4 }}>Calendar (CalDAV)</div>
            <div style={{ fontWeight: 600, fontFamily: 'monospace' }}>https://{hostname}/caldav</div>
          </div>
          <div className="glass-panel" style={{ padding: 16 }}>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 4 }}>Contacts (CardDAV)</div>
            <div style={{ fontWeight: 600, fontFamily: 'monospace' }}>https://{hostname}/carddav</div>
          </div>
        </div>
        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 24, lineHeight: 1.5 }}>
          Use your email address and password to authenticate. On most devices, choose "Manual Setup"
          and enter the server details above.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<AuthGate />}>
        <Route element={<ErrorBoundary><AppShell /></ErrorBoundary>}>
          <Route path="mail/*" element={<MailRoutes />} />
          <Route path="calendar/*" element={<CalendarRoutes />} />
          <Route path="contacts/*" element={<ContactsRoutes />} />
          <Route path="notes/*" element={<Suspense fallback={<Skeleton />}><NotesRoutes /></Suspense>} />
          <Route path="settings/*" element={<SettingsRoutes />} />
          <Route path="admin/*" element={<Suspense fallback={<Skeleton />}><AdminRoutes /></Suspense>} />
          <Route path="sync" element={<SyncView />} />
          <Route index element={<Navigate to="/mail/inbox" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
