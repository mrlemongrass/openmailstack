import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, NavLink, Outlet, Navigate } from 'react-router';
import {
  LayoutDashboard, Globe, Mail, Forward, GitMerge, Shield,
  Settings, Palette, BarChart3, Key, Box, ShieldAlert, Menu, X,
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

// ─── Sidebar config ──────────────────────────────────────────────────────────

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { path: '/admin/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { path: '/admin/domains', label: 'Domains', icon: <Globe size={18} /> },
  { path: '/admin/mailboxes', label: 'Mailboxes', icon: <Mail size={18} /> },
  { path: '/admin/aliases', label: 'Aliases', icon: <Forward size={18} /> },
  { path: '/admin/routing', label: 'Routing', icon: <GitMerge size={18} /> },
  { path: '/admin/admins', label: 'Admins', icon: <Shield size={18} /> },
  { path: '/admin/settings', label: 'Settings', icon: <Settings size={18} /> },
  { path: '/admin/branding', label: 'Branding', icon: <Palette size={18} /> },
  { path: '/admin/telemetry', label: 'Telemetry', icon: <BarChart3 size={18} /> },
  { path: '/admin/apikeys', label: 'API Keys', icon: <Key size={18} /> },
  { path: '/admin/updates', label: 'Updates', icon: <Box size={18} /> },
  { path: '/admin/spam', label: 'Spam', icon: <ShieldAlert size={18} /> },
];

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.4)',
            display: 'none',
          }}
          className="sidebar-overlay"
        />
      )}
      <aside style={{
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
      }} className={`admin-sidebar${open ? ' open' : ''}`}>
        <div style={{ padding: '0 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Admin Panel</h2>
        </div>
        <nav style={{ flex: 1 }}>
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
      </aside>
    </>
  );
}

// ─── Layout ──────────────────────────────────────────────────────────────────

function AdminLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main style={{
        flex: 1,
        overflowY: 'auto',
        padding: '20px 24px',
        minWidth: 0,
      }}>
        {/* Mobile menu toggle */}
        <button
          className="btn btn-secondary sidebar-toggle"
          onClick={() => setSidebarOpen(v => !v)}
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
          }
          .admin-sidebar.open {
            transform: translateX(0);
          }
          .sidebar-overlay {
            display: block !important;
          }
          .sidebar-toggle {
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
        const merged: AdminSettingsMap = { ...defaultAdminSettings };
        ALL_NAMESPACES.forEach((ns, i) => {
          merged[ns] = { ...defaultAdminSettings[ns], ...(results[i] as any) };
        });
        setSettings(merged);
      } catch (err: any) {
        if (!cancelled) setStatus(`Failed to load admin settings: ${err.message}`);
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
    } catch (err: any) {
      setStatus(`Save failed: ${err.message}`);
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [branding, setBranding] = useState<BrandingSettings>(defaultBranding);

  useEffect(() => {
    let cancelled = false;
    fetchAdminBranding()
      .then(b => { if (!cancelled) setBranding(b); })
      .catch(e => { if (!cancelled) setStatus(`Failed to load branding: ${e.message}`); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleChange = useCallback((b: BrandingSettings) => setBranding(b), []);
  const handleReset = useCallback(() => setBranding(defaultBranding), []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setStatus('');
    try {
      await saveAdminBranding(branding);
      setStatus('Branding saved successfully.');
    } catch (err: any) {
      setStatus(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }, [branding]);

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
      onChange={handleChange}
      onReset={handleReset}
      onSave={handleSave}
    />
  );
}

// ─── Telemetry Tab (combines TelemetryPanel + Fail2banPanel) ─────────────────

function TelemetryTab() {
  return (
    <div>
      <TelemetryPanel />
      <div style={{ marginTop: 24 }}>
        <Fail2banPanel />
      </div>
    </div>
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
        <Route path="telemetry" element={<TelemetryTab />} />
        <Route path="apikeys" element={<ApiKeysPanel />} />
        <Route path="updates" element={<UpdatesPanel />} />
        <Route path="spam" element={<SpamPanel />} />
      </Route>
    </Routes>
  );
}
