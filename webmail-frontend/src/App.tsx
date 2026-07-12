import { lazy, Suspense, useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router';
import { AuthGate } from './shared/layouts/AuthGate';
import { AppShell } from './shared/layouts/AppShell';
import { ErrorBoundary } from './shared/components/ErrorBoundary';
import { Skeleton } from './shared/components/Skeleton';
import { ToastProvider } from './shared/components/Toast';
import { BrandingProvider } from './BrandingProvider';
import { useBranding } from './branding-context';
import { Mail, Globe, CalendarDays, Users, Copy, Check, ChevronDown } from 'lucide-react';
const MailRoutes = lazy(() => import('./mail/routes').then(m => ({ default: m.MailRoutes })));
const CalendarRoutes = lazy(() => import('./calendar/routes').then(m => ({ default: m.CalendarRoutes })));
const ContactsRoutes = lazy(() => import('./contacts/routes').then(m => ({ default: m.ContactsRoutes })));
const NotesRoutes = lazy(() => import('./notes/routes').then(m => ({ default: m.NotesRoutes })));
const SchedulerRoutes = lazy(() => import('./scheduler/routes').then(m => ({ default: m.SchedulerRoutes })));
const PublicSchedulerPage = lazy(() => import('./scheduler/PublicScheduler').then(m => ({ default: m.PublicSchedulerPage })));
const SchedulerActionPage = lazy(() => import('./scheduler/PublicScheduler').then(m => ({ default: m.SchedulerActionPage })));
const PublicSchedulerPollPage = lazy(() => import('./scheduler/PublicScheduler').then(m => ({ default: m.PublicSchedulerPollPage })));
const SettingsRoutes = lazy(() => import('./settings/routes').then(m => ({ default: m.SettingsRoutes })));
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

const DEVICE_GUIDES: { title: string; steps: string[] }[] = [
  { title: 'iPhone / iPad', steps: ['Open Settings → Mail → Accounts → Add Account', 'Choose Other → Add Mail Account', 'Enter name, email, password, and the server addresses above', 'Tap Next — iOS will verify and enable Mail, Calendar & Contacts'] },
  { title: 'Android (Gmail app)', steps: ['Open Gmail → Settings → Add account → Other', 'Enter your email address and password', 'Choose IMAP, then enter the server addresses above', 'Tap Next to finish setup'] },
  { title: 'macOS Mail', steps: ['Open Mail → Settings → Accounts → Add Account', 'Choose Other Mail Account → Continue', 'Enter name, email, password, and the server addresses above', 'Sign in to enable Mail, Calendar & Contacts sync'] },
  { title: 'Outlook (Windows / Mac)', steps: ['Open Outlook → File → Add Account', 'Enter your email address', 'Choose Advanced setup → IMAP', 'Enter the server addresses and port numbers above, then click Connect'] },
  { title: 'Thunderbird', steps: ['Open Thunderbird → Account Settings → Account Actions → Add Mail Account', 'Enter your name, email, and password', 'Thunderbird will try to auto-detect. Choose Manual config if needed.', 'Set IMAP server and SMTP server to the addresses above, then click Done'] },
];

function DeviceGuides() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <div style={{ marginTop: 20 }}>
      <h3 style={{ fontSize: '0.9rem', fontWeight: 600, margin: '0 0 10px' }}>Device Setup Guides</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {DEVICE_GUIDES.map((guide, i) => (
          <div key={guide.title} style={{
            border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-md)',
            overflow: 'hidden',
          }}>
            <button
              onClick={() => setOpenIdx(openIdx === i ? null : i)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', background: 'rgba(255,255,255,0.02)',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: '0.85rem', color: 'var(--text-primary)',
              }}
            >
              <span style={{ fontWeight: 500 }}>{guide.title}</span>
              <ChevronDown size={14} style={{
                color: 'var(--text-secondary)',
                transform: openIdx === i ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.2s',
              }} />
            </button>
            {openIdx === i && (
              <div style={{ padding: '8px 14px 12px', borderTop: '1px solid var(--border-glass)' }}>
                <ol style={{ margin: 0, paddingLeft: 18, fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                  {guide.steps.map((s) => <li key={s}>{s}</li>)}
                </ol>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SyncView() {
  const { branding } = useBranding();
  const [serverStatus, setServerStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [diagResults, setDiagResults] = useState<Record<string, 'checking' | 'ok' | 'fail'>>({});
  const hostname = window.location.hostname;

  const checkStatus = () => {
    setServerStatus('checking');
    fetch('/api/auth/me')
      .then((r) => { setServerStatus(r.ok ? 'online' : 'offline'); setLastChecked(new Date()); })
      .catch(() => { setServerStatus('offline'); setLastChecked(new Date()); });
  };

  const runDiagnostics = () => {
    const endpoints: Record<string, string> = {
      'Mail API': '/api/auth/me',
      'Calendar (CalDAV)': '/caldav',
      'Contacts (CardDAV)': '/carddav',
    };
    const results: Record<string, 'checking' | 'ok' | 'fail'> = {};
    Object.keys(endpoints).forEach((k) => { results[k] = 'checking'; });
    setDiagResults({ ...results });

    Object.entries(endpoints).forEach(([name, url]) => {
      fetch(url, { method: 'HEAD' })
        .then((r) => setDiagResults((prev) => ({ ...prev, [name]: r.ok || r.status === 405 ? 'ok' : 'fail' })))
        .catch(() => setDiagResults((prev) => ({ ...prev, [name]: 'fail' })));
    });
  };

  useEffect(() => {
    const timer = window.setTimeout(checkStatus, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const rows: SyncRowProps[] = [
    { icon: Mail, label: 'Incoming Mail (IMAP)', host: hostname, detail: 'Port 993 · SSL/TLS required', },
    { icon: Globe, label: 'Outgoing Mail (SMTP)', host: hostname, detail: 'Port 587 · STARTTLS required', },
    { icon: CalendarDays, label: 'Calendar (CalDAV)', host: `https://${hostname}/caldav`, detail: 'HTTPS — paste this full URL into your calendar client', },
    { icon: Users, label: 'Contacts (CardDAV)', host: `https://${hostname}/carddav`, detail: 'HTTPS — paste this full URL into your contacts client', },
    { icon: CalendarDays, label: 'Calendar Subscription (ICS)', host: `https://${hostname}/caldav`, detail: 'Use this URL to subscribe to calendars from other apps', },
  ];

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
      <div className="glass-panel" style={{ maxWidth: 640, margin: '0 auto', padding: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <h2 style={{ margin: 0 }}>Sync Setup</h2>
          <span style={{
            fontSize: '0.7rem', padding: '2px 10px', borderRadius: 999,
            background: serverStatus === 'online' ? 'rgba(16,185,129,0.15)' : serverStatus === 'offline' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.05)',
            color: serverStatus === 'online' ? '#10b981' : serverStatus === 'offline' ? 'var(--danger)' : 'var(--text-secondary)',
          }}>
            {serverStatus === 'checking' ? 'Checking...' : serverStatus === 'online' ? 'Server Online' : 'Server Offline'}
          </span>
          <button className="btn btn-ghost" onClick={checkStatus} style={{ fontSize: '0.75rem', marginLeft: 8 }}>Refresh</button>
          {lastChecked && <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Checked {lastChecked.toLocaleTimeString()}</span>}
        </div>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 24px', fontSize: '0.9rem' }}>
          Configure your devices to sync mail, calendars, and contacts with {branding.appName}.
          Use the server details below in your email client, calendar app, or device settings.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((r) => <SyncRow key={r.label} {...r} />)}
        </div>

        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, margin: 0 }}>Connection Diagnostics</h3>
            <button className="btn btn-ghost" onClick={runDiagnostics} style={{ fontSize: '0.8rem' }}>Run Tests</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {Object.entries(diagResults).length === 0 ? (
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Click "Run Tests" to check service availability.</p>
            ) : (
              Object.entries(diagResults).map(([name, status]) => (
                <div key={name} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 12px', borderRadius: 'var(--radius-md)',
                  background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-glass)',
                  fontSize: '0.85rem',
                }}>
                  <span>{name}</span>
                  <span style={{
                    fontSize: '0.7rem', padding: '2px 8px', borderRadius: 999, fontWeight: 600,
                    background: status === 'ok' ? 'rgba(16,185,129,0.15)' : status === 'fail' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.05)',
                    color: status === 'ok' ? '#10b981' : status === 'fail' ? 'var(--danger)' : 'var(--text-secondary)',
                  }}>
                    {status === 'checking' ? '...' : status === 'ok' ? 'Reachable' : 'Unreachable'}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <DeviceGuides />
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
    <BrandingProvider>
    <ToastProvider>
    <Routes>
      <Route path="scheduler/action/:scope/:token" element={<Suspense fallback={<Skeleton />}><SchedulerActionPage /></Suspense>} />
      <Route path="scheduler/poll/:token" element={<Suspense fallback={<Skeleton />}><PublicSchedulerPollPage /></Suspense>} />
      <Route path="scheduler/:handle/:slug?" element={<Suspense fallback={<Skeleton />}><PublicSchedulerPage /></Suspense>} />
      <Route element={<AuthGate />}>
        <Route element={<ErrorBoundary><AppShell /></ErrorBoundary>}>
          <Route path="mail/*" element={<Suspense fallback={<Skeleton />}><MailRoutes /></Suspense>} />
          <Route path="calendar/*" element={<Suspense fallback={<Skeleton />}><CalendarRoutes /></Suspense>} />
          <Route path="contacts/*" element={<Suspense fallback={<Skeleton />}><ContactsRoutes /></Suspense>} />
          <Route path="notes/*" element={<Suspense fallback={<Skeleton />}><NotesRoutes /></Suspense>} />
          <Route path="scheduler-app/*" element={<Suspense fallback={<Skeleton />}><SchedulerRoutes /></Suspense>} />
          <Route path="settings/*" element={<Suspense fallback={<Skeleton />}><SettingsRoutes /></Suspense>} />
          <Route path="admin/*" element={<Suspense fallback={<Skeleton />}><AdminRoutes /></Suspense>} />
          <Route path="sync" element={<SyncView />} />
          <Route index element={<Navigate to="/mail/inbox" replace />} />
        </Route>
      </Route>
    </Routes>
    </ToastProvider>
    </BrandingProvider>
  );
}
