import { useState, useEffect, useCallback } from 'react';
import { Routes, Route } from 'react-router';
import { AdminSettingsPanel } from './AdminSettingsPanel';
import {
  getAdminSettings,
  saveAdminSettings,
  defaultAdminSettings,
  type AdminSettingsMap,
  type AdminSettingsNamespace,
} from './adminSettingsApi';

const ALL_NAMESPACES: AdminSettingsNamespace[] = [
  'organization',
  'publicUrls',
  'security',
  'mailPolicy',
  'system',
  'webhooks',
];

function AdminLoader() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [settings, setSettings] = useState<AdminSettingsMap>(defaultAdminSettings);

  // Load all admin namespaces on mount
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
          merged[ns] = { ...defaultAdminSettings[ns], ...results[i] };
        });

        setSettings(merged);
      } catch (err: any) {
        if (!cancelled) {
          setStatus(`Failed to load admin settings: ${err.message}`);
        }
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
      <div className="glass-panel" style={{ margin: 20, padding: 24 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 40,
          color: 'var(--text-secondary)',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: 24,
              height: 24,
              border: '3px solid rgba(255,255,255,0.2)',
              borderTopColor: 'var(--accent-primary)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 12px',
            }} />
            <p>Loading admin settings...</p>
          </div>
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

export function AdminRoutes() {
  return (
    <Routes>
      <Route index element={<AdminLoader />} />
      <Route path=":panel" element={<AdminLoader />} />
    </Routes>
  );
}
