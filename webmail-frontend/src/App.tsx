import { lazy, Suspense, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router';
import { AuthGate } from './shared/layouts/AuthGate';
import { AppShell } from './shared/layouts/AppShell';
import { ErrorBoundary } from './shared/components/ErrorBoundary';
import { Skeleton } from './shared/components/Skeleton';
import { ToastProvider } from './shared/components/Toast';
import { MailRoutes } from './mail/routes';
import { CalendarRoutes } from './calendar/routes';
import { ContactsRoutes } from './contacts/routes';
import { SettingsRoutes } from './settings/routes';
import { Mail, Globe, CalendarDays, Users, Copy, Check } from 'lucide-react';
const NotesRoutes = lazy(() => import('./notes/routes').then(m => ({ default: m.NotesRoutes })));
const AdminRoutes = lazy(() => import('./admin/routes').then(m => ({ default: m.AdminRoutes })));

interface SyncRowProps {
  icon: React.ElementType;
  label: string;
  host: string;
  detail: string;
}

function SyncRow({ icon: Icon, label, host, detail }: SyncRowProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(host);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = host;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: 14,
      borderRadius: 'var(--radius-md)', background: 'rgba(255,255,255,0.02)',
      border: '1px solid var(--border-glass)',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 'var(--radius-sm)',
        background: 'rgba(59,130,246,0.12)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Icon size={18} style={{ color: 'var(--accent-primary)' }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>{label}</div>
        <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--text-primary)', marginTop: 2 }}>
          {host}
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 2 }}>
          {detail}
        </div>
      </div>
      <button
        onClick={handleCopy}
        className="btn btn-ghost"
        style={{ padding: '6px 10px', fontSize: '0.75rem', flexShrink: 0 }}
        title="Copy to clipboard"
      >
        {copied ? <Check size={14} style={{ color: '#10b981' }} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

function SyncView() {
  const hostname = window.location.hostname;
  const rows: SyncRowProps[] = [
    { icon: Mail, label: 'Incoming Mail (IMAP)', host: hostname, detail: 'Port 993 · SSL/TLS required', },
    { icon: Globe, label: 'Outgoing Mail (SMTP)', host: hostname, detail: 'Port 587 · STARTTLS required', },
    { icon: CalendarDays, label: 'Calendar (CalDAV)', host: `https://${hostname}/caldav`, detail: 'HTTPS — paste this full URL into your calendar client', },
    { icon: Users, label: 'Contacts (CardDAV)', host: `https://${hostname}/carddav`, detail: 'HTTPS — paste this full URL into your contacts client', },
  ];

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
      <div className="glass-panel" style={{ maxWidth: 640, margin: '0 auto', padding: 40 }}>
        <h2 style={{ margin: '0 0 6px' }}>Sync Setup</h2>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 24px', fontSize: '0.9rem' }}>
          Configure your devices to sync mail, calendars, and contacts with OpenMailStack.
          Use the server details below in your email client, calendar app, or device settings.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((r) => <SyncRow key={r.label} {...r} />)}
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 24, lineHeight: 1.6,
          padding: '12px 16px', borderRadius: 'var(--radius-md)',
          background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)' }}>
          <strong>Authentication:</strong> Use your full email address and password.
          On most devices, choose <strong>Manual Setup</strong> and enter the server
          addresses shown above. Your username is your email address.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
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
    </ToastProvider>
  );
}
