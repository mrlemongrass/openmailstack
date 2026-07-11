import { useEffect, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { Settings, ShieldAlert, Activity, Mail, CalendarDays, Users, StickyNote, CalendarClock, MoreHorizontal } from 'lucide-react';
import { SCHEDULER_ENTITLEMENT_CHANGED } from '../../scheduler/entitlement';

function useActiveApp(): string {
  const { pathname } = useLocation();
  if (pathname.startsWith('/mail')) return 'mail';
  if (pathname.startsWith('/calendar')) return 'calendar';
  if (pathname.startsWith('/contacts')) return 'contacts';
  if (pathname.startsWith('/notes')) return 'notes';
  if (pathname.startsWith('/scheduler-app')) return 'scheduler';
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/admin')) return 'admin';
  if (pathname.startsWith('/sync')) return 'sync';
  return 'mail';
}

export function AppShell() {
  const { user, logout } = useAuth();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const activeApp = useActiveApp();
  const [schedulerEnabled, setSchedulerEnabled] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refreshSchedulerStatus = () => {
      fetch('/api/scheduler/v1/status', { credentials: 'include' })
        .then(async response => response.ok ? response.json() as Promise<{ enabled?: boolean }> : null)
        .then(result => { if (!cancelled) setSchedulerEnabled(Boolean(result?.enabled)); })
        .catch(() => { if (!cancelled) setSchedulerEnabled(false); });
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshSchedulerStatus();
    };

    refreshSchedulerStatus();
    window.addEventListener(SCHEDULER_ENTITLEMENT_CHANGED, refreshSchedulerStatus);
    window.addEventListener('focus', refreshSchedulerStatus);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      cancelled = true;
      window.removeEventListener(SCHEDULER_ENTITLEMENT_CHANGED, refreshSchedulerStatus);
      window.removeEventListener('focus', refreshSchedulerStatus);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [user?.email]);

  const navItems = [
    { id: 'mail', label: 'Mail', icon: Mail, path: '/mail/inbox' },
    { id: 'calendar', label: 'Calendar', icon: CalendarDays, path: '/calendar/month' },
    { id: 'contacts', label: 'Contacts', icon: Users, path: '/contacts' },
    { id: 'notes', label: 'Notes', icon: StickyNote, path: '/notes' },
    ...(schedulerEnabled ? [{ id: 'scheduler', label: 'Scheduler', icon: CalendarClock, path: '/scheduler-app' }] : []),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', minHeight: 0, overflow: 'hidden' }}>
      {!isMobile && (
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 20px', height: 56, borderBottom: '1px solid var(--border-glass)',
          background: 'var(--bg-glass)', backdropFilter: 'blur(12px)',
        }}>
          <nav style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{
              fontWeight: 700, fontSize: '1.1rem', marginRight: 16,
              background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-purple))',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              OpenMailStack
            </span>
            {navItems.map((item) => (
              <Link key={item.id} to={item.path}
                style={{
                  padding: '8px 16px', borderRadius: 'var(--radius-md)',
                  fontWeight: activeApp === item.id ? 700 : 400,
                  color: activeApp === item.id ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  textDecoration: 'none', fontSize: '0.9rem',
                }}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Link to="/sync" style={{
              padding: '8px 12px', borderRadius: 'var(--radius-md)',
              color: activeApp === 'sync' ? 'var(--accent-primary)' : 'var(--text-secondary)',
              textDecoration: 'none', fontSize: '0.85rem',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <Activity size={16} /> Sync
            </Link>
            <Link to="/settings" style={{ color: 'var(--text-secondary)', padding: 4 }}>
              <Settings size={18} />
            </Link>
            <Link to="/admin" style={{ color: 'var(--text-secondary)', padding: 4 }}>
              <ShieldAlert size={18} />
            </Link>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{user?.email}</span>
            <button onClick={logout} className="btn btn-ghost" style={{ fontSize: '0.85rem' }}>
              Logout
            </button>
          </div>
        </header>
      )}

      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', paddingBottom: isMobile ? 56 : 0 }}>
        <Outlet />
      </main>

      {isMobile && (
        <nav className="mobile-tab-bar" style={{
          display: 'flex', position: 'fixed', bottom: 0, left: 0, right: 0,
          height: 56, paddingBottom: 'env(safe-area-inset-bottom, 0)',
          background: 'var(--bg-glass)', backdropFilter: 'blur(12px)',
          borderTop: '1px solid var(--border-glass)', zIndex: 100,
        }}>
          {navItems.map((item) => (
            <Link key={item.id} to={item.path}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                color: activeApp === item.id ? 'var(--accent-primary)' : 'var(--text-secondary)',
                textDecoration: 'none', fontSize: '0.7rem', gap: 2,
              }}>
              <item.icon size={20} />
              {item.label}
            </Link>
          ))}
          <button type="button" onClick={() => setMoreOpen(open => !open)} aria-label="More applications"
            style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              color: ['settings', 'sync', 'admin'].includes(activeApp) ? 'var(--accent-primary)' : 'var(--text-secondary)',
              background: 'transparent', border: 0, fontSize: '0.7rem', gap: 2,
            }}>
            <MoreHorizontal size={20} />
            More
          </button>
          {moreOpen && <div style={{
            position: 'fixed', right: 10, bottom: 64, minWidth: 180, padding: 6,
            border: '1px solid var(--border-glass)', borderRadius: 'var(--radius-md)',
            background: 'var(--bg-primary)', boxShadow: '0 12px 36px rgba(0,0,0,.3)', zIndex: 120,
          }}>
            <Link to="/settings" onClick={() => setMoreOpen(false)} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', color: 'var(--text-primary)', textDecoration: 'none' }}><Settings size={17} /> Settings</Link>
            <Link to="/sync" onClick={() => setMoreOpen(false)} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', color: 'var(--text-primary)', textDecoration: 'none' }}><Activity size={17} /> Sync</Link>
            <Link to="/admin" onClick={() => setMoreOpen(false)} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 12px', color: 'var(--text-primary)', textDecoration: 'none' }}><ShieldAlert size={17} /> Admin</Link>
          </div>}
        </nav>
      )}
    </div>
  );
}
