import { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Routes, Route, NavLink, Outlet, Navigate } from 'react-router';
import {
  LayoutDashboard, Globe, Mail, Forward, GitMerge, Shield,
  Settings, Palette, BarChart3, Key, Box, ShieldAlert, AlertTriangle, Menu, X,
  MessageSquareText,
} from 'lucide-react';
import { AdminSettingsPanel } from './AdminSettingsPanel';
import { BrandingPanel } from './BrandingPanel';
import { SystemHealthDashboard } from './SystemHealthDashboard';
import { TelemetryPanel } from './TelemetryPanel';
import { Fail2banPanel } from './Fail2banPanel';
import { DomainsPanel } from './DomainsPanel';
import { MailboxesPanel } from './MailboxesPanel';
import { AliasesPanel } from './AliasesPanel';
import { RoutingPanel } from './RoutingPanel';
import { AdminsPanel } from './AdminsPanel';
import { ApiKeysPanel } from './ApiKeysPanel';
import { UpdatesPanel } from './UpdatesPanel';
import { SpamPanel } from './SpamPanel';
import {
  getAdminSettings,
  saveAdminSettings,
  defaultAdminSettings,
  fetchAdminBranding,
  saveAdminBranding,
  defaultBranding,
  type AdminSettingsMap,
  type AdminSettingsNamespace,
  type BrandingSettings,
} from './adminSettingsApi';
import { useBranding } from '../branding-context';
import { resolveBrandingPresentation } from '../branding';

const SchedulerDeliveryPanel = lazy(() => import('./SchedulerDeliveryPanel').then(module => ({
  default: module.SchedulerDeliveryPanel,
})));

// ─── Sidebar config ──────────────────────────────────────────────────────────

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    path: '/admin/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { path: '/admin/domains',     label: 'Domains',   icon: <Globe size={18} /> },
  { path: '/admin/mailboxes',   label: 'Mailboxes', icon: <Mail size={18} /> },
  { path: '/admin/aliases',     label: 'Aliases',   icon: <Forward size={18} /> },
  { path: '/admin/routing',     label: 'Routing',   icon: <GitMerge size={18} /> },
  { path: '/admin/admins',      label: 'Admins',    icon: <Shield size={18} /> },
  { path: '/admin/settings',    label: 'Settings',  icon: <Settings size={18} /> },
  { path: '/admin/branding',    label: 'Branding',  icon: <Palette size={18} /> },
  { path: '/admin/scheduler-delivery', label: 'Scheduler Delivery', icon: <MessageSquareText size={18} /> },
  { path: '/admin/telemetry',   label: 'Telemetry', icon: <BarChart3 size={18} /> },
  { path: '/admin/intrusion',   label: 'Intrusion Detection', icon: <ShieldAlert size={18} /> },
  { path: '/admin/apikeys',     label: 'API Keys',  icon: <Key size={18} /> },
  { path: '/admin/updates',     label: 'Updates',   icon: <Box size={18} /> },
  { path: '/admin/spam',        label: 'Spam',      icon: <AlertTriangle size={18} /> },
];

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function Sidebar({
  open,
  onClose,
  sidebarRef,
}: {
  open: boolean;
  onClose: () => void;
  sidebarRef: React.RefObject<HTMLElement | null>;
}) {
  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          onClick={onClose}
          aria-hidden="true"
          style={{
            position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.4)',
            display: 'none',
          }}
          className="sidebar-overlay"
        />
      )}
      <aside
        id="admin-navigation"
        ref={sidebarRef}
        role={open ? 'dialog' : undefined}
        aria-modal={open || undefined}
        aria-labelledby="admin-navigation-title"
        style={{
        width: 240,
        minWidth: 240,
        height: '100%',
        overflowY: 'auto',
        borderRight: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(255,255,255,0.02)',
        display: 'flex',
        flexDirection: 'column',
        padding: '12px 0',
        transition: 'transform 0.2s ease',
        zIndex: 100,
        }}
        className={`admin-sidebar${open ? ' open' : ''}`}
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px 12px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          marginBottom: 8,
        }}>
          <h2 id="admin-navigation-title" style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Admin Panel</h2>
          {open && (
            <button
              type="button"
              className="btn btn-secondary admin-sidebar-close"
              aria-label="Close Admin menu"
              onClick={onClose}
              autoFocus
              style={{ display: 'none', padding: 6 }}
            >
              <X size={18} />
            </button>
          )}
        </div>
        <nav aria-label="Admin sections" style={{ flex: 1 }}>
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={onClose}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 16px',
                color: isActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                background: isActive ? 'rgba(255,255,255,0.06)' : 'transparent',
                textDecoration: 'none',
                fontSize: '0.88rem',
                fontWeight: isActive ? 500 : 400,
                borderRight: isActive ? '2px solid var(--accent-primary)' : '2px solid transparent',
                transition: 'all 0.15s ease',
              })}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div style={{
          marginTop: 'auto', padding: '12px 18px', borderTop: '1px solid var(--border-glass)',
          fontSize: '0.72rem', color: 'var(--text-secondary)',
        }}>
          OpenMailStack v0.1.5
        </div>
      </aside>
    </>
  );
}

// ─── Layout ──────────────────────────────────────────────────────────────────

function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
    window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!sidebarOpen || !sidebarRef.current) return;

    const drawer = sidebarRef.current;
    const focusable = Array.from(
      drawer.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
    );

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSidebar();
        return;
      }
      if (event.key !== 'Tab' || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!drawer.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeSidebar, sidebarOpen]);

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <Sidebar open={sidebarOpen} onClose={closeSidebar} sidebarRef={sidebarRef} />
      <main inert={sidebarOpen || undefined} style={{
        flex: 1,
        overflowY: 'auto',
        padding: '20px 24px',
        minWidth: 0,
      }}>
        {/* Mobile menu toggle */}
        <button
          type="button"
          ref={menuButtonRef}
          className="btn btn-secondary sidebar-toggle"
          onClick={() => setSidebarOpen(true)}
          aria-expanded={sidebarOpen}
          aria-controls="admin-navigation"
          style={{
            display: 'none',
            marginBottom: 12,
            padding: '6px 10px',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          Menu
        </button>
        <Outlet />
      </main>
      {/* Responsive styles */}
      <style>{`
        @media (max-width: 768px) {
          .admin-sidebar {
            position: fixed;
            left: 0;
            top: 0;
            bottom: 0;
            transform: translateX(-100%);
            visibility: hidden;
            background: var(--surface-color) !important;
            box-shadow: 8px 0 28px rgba(0, 0, 0, 0.36);
          }
          .admin-sidebar.open {
            transform: translateX(0);
            visibility: visible;
          }
          .sidebar-overlay {
            display: block !important;
          }
          .sidebar-toggle {
            display: flex !important;
          }
          .admin-sidebar-close {
            display: flex !important;
          }
        }
      `}</style>
    </div>
  );
}

// ─── Settings Loader (wraps AdminSettingsPanel) ──────────────────────────────

const ALL_NAMESPACES: AdminSettingsNamespace[] = [
  'organization',
  'publicUrls',
  'security',
  'mailPolicy',
  'system',
  'webhooks',
];

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function SettingsLoader() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [settings, setSettings] = useState<AdminSettingsMap>(defaultAdminSettings);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        const results = await Promise.all(
          ALL_NAMESPACES.map((ns) => getAdminSettings(ns)),
        );
        if (cancelled) return;
        setSettings({
          organization: { ...defaultAdminSettings.organization, ...results[0] },
          publicUrls: { ...defaultAdminSettings.publicUrls, ...results[1] },
          security: { ...defaultAdminSettings.security, ...results[2] },
          mailPolicy: { ...defaultAdminSettings.mailPolicy, ...results[3] },
          system: { ...defaultAdminSettings.system, ...results[4] },
          webhooks: { ...defaultAdminSettings.webhooks, ...results[5] },
        });
      } catch (err: unknown) {
        if (!cancelled) setStatus(`Failed to load admin settings: ${errorMessage(err, 'Failed to load admin settings')}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const handleChange = useCallback((newSettings: AdminSettingsMap) => {
    setSettings(newSettings);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setStatus('');
    try {
      await Promise.all(
        ALL_NAMESPACES.map((ns) => saveAdminSettings(ns, settings[ns])),
      );
      setStatus('All settings saved successfully.');
    } catch (err: unknown) {
      setStatus(`Save failed: ${errorMessage(err, 'Failed to save admin settings')}`);
    } finally {
      setSaving(false);
    }
  }, [settings]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--text-secondary)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 24, height: 24, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
          <p>Loading admin settings...</p>
        </div>
      </div>
    );
  }

  return (
    <AdminSettingsPanel
      settings={settings}
      saving={saving}
      status={status}
      onChange={handleChange}
      onSave={handleSave}
    />
  );
}

// ─── Branding Loader (wraps BrandingPanel) ───────────────────────────────────

function BrandingLoader() {
  const { setBranding: applySavedBranding } = useBranding();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [statusIsError, setStatusIsError] = useState(false);
  const [branding, setBranding] = useState<BrandingSettings>(defaultBranding);
  const [savedBranding, setSavedBranding] = useState<BrandingSettings>(defaultBranding);
  const dirty = useMemo(() => Object.keys(defaultBranding).some(key => (
    branding[key as keyof BrandingSettings] !== savedBranding[key as keyof BrandingSettings]
  )), [branding, savedBranding]);

  useEffect(() => {
    let cancelled = false;
    fetchAdminBranding()
      .then(b => {
        if (!cancelled) {
          const reconciled = { ...b, loginTitle: resolveBrandingPresentation(b).loginTitle };
          setBranding(reconciled);
          setSavedBranding(reconciled);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setStatusIsError(true);
          setStatus(`Failed to load branding: ${errorMessage(e, 'Failed to load branding')}`);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleChange = useCallback((b: BrandingSettings) => {
    setBranding(b);
    setStatus('');
    setStatusIsError(false);
  }, []);
  const handleReset = useCallback(() => {
    setBranding(defaultBranding);
    setStatus('');
    setStatusIsError(false);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setStatus('');
    setStatusIsError(false);
    try {
      const saved = await saveAdminBranding(branding);
      setBranding(saved);
      setSavedBranding(saved);
      applySavedBranding(saved);
      setStatus('Branding saved. The sign-in page and app header are now updated.');
    } catch (err: unknown) {
      setStatusIsError(true);
      setStatus(`Save failed: ${errorMessage(err, 'Failed to save branding')}`);
    } finally {
      setSaving(false);
    }
  }, [applySavedBranding, branding]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--text-secondary)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 24, height: 24, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
          <p>Loading branding...</p>
        </div>
      </div>
    );
  }

  return (
    <BrandingPanel
      branding={branding}
      saving={saving}
      status={status}
      statusIsError={statusIsError}
      dirty={dirty}
      onChange={handleChange}
      onReset={handleReset}
      onSave={handleSave}
    />
  );
}

// ─── Route export ────────────────────────────────────────────────────────────

export function AdminRoutes() {
  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="dashboard" element={<SystemHealthDashboard />} />
        <Route path="domains" element={<DomainsPanel />} />
        <Route path="mailboxes" element={<MailboxesPanel />} />
        <Route path="aliases" element={<AliasesPanel />} />
        <Route path="routing" element={<RoutingPanel />} />
        <Route path="admins" element={<AdminsPanel />} />
        <Route path="settings" element={<SettingsLoader />} />
        <Route path="branding" element={<BrandingLoader />} />
        <Route path="scheduler-delivery" element={(
          <Suspense fallback={<p style={{ color: 'var(--text-secondary)' }}>Loading Scheduler delivery…</p>}>
            <SchedulerDeliveryPanel />
          </Suspense>
        )} />
        <Route path="telemetry" element={<TelemetryPanel />} />
        <Route path="intrusion" element={<Fail2banPanel />} />
        <Route path="apikeys" element={<ApiKeysPanel />} />
        <Route path="updates" element={<UpdatesPanel />} />
        <Route path="spam" element={<SpamPanel />} />
      </Route>
    </Routes>
  );
}
