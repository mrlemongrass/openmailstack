import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Info, Box } from 'lucide-react';
import { adminErrorMessage, getUpdates, type UpdatesInfo } from './adminSettingsApi';

export function UpdatesPanel() {
  const [updates, setUpdates] = useState<UpdatesInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    getUpdates()
      .then((u) => { setUpdates(u); setLastChecked(new Date()); })
      .catch((e: unknown) => setError(adminErrorMessage(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--text-secondary)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 24, height: 24, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
          <p>Loading version information...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <div className="status-banner status-error" style={{ marginBottom: 16 }}>{error}</div>
        <button className="btn btn-secondary" onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  if (!updates) return null;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: '1.3rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Box size={20} /> Updates & Versions
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {lastChecked && <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Last refreshed {lastChecked.toLocaleTimeString()}</span>}
          <button className="btn btn-secondary" onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: 24, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
          <div style={{ display: 'grid', placeItems: 'center', width: 36, height: 36, borderRadius: 10, background: 'color-mix(in srgb, var(--accent-primary) 14%, transparent)', color: 'var(--accent-primary)', flex: '0 0 auto' }}>
            <Info size={19} aria-hidden="true" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 5 }}>
              Installed OpenMailStack version
            </div>
            <div style={{ fontSize: '1.25rem', fontFamily: 'monospace', fontWeight: 600, marginBottom: 16 }}>
              {updates.current_version}
            </div>
            <div style={{ fontSize: '0.9rem', lineHeight: 1.55 }}>
              <strong style={{ display: 'block', marginBottom: 4 }}>Manual update policy</strong>
              <span style={{ color: 'var(--text-secondary)' }}>{updates.update_policy.message}</span>
              <span style={{ display: 'block', color: 'var(--text-secondary)', marginTop: 4 }}>
                This page does not check for or install releases.
              </span>
            </div>
          </div>
        </div>
      </div>

      <h3 style={{ fontSize: '1rem', color: 'var(--text-secondary)', marginBottom: 12 }}>Component Versions</h3>
      <div className="glass-panel" style={{ overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left' }}>
              <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Component</th>
              <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Version</th>
            </tr>
          </thead>
          <tbody>
            {updates.components.map(c => (
              <tr key={c.name} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <td style={{ padding: '10px 12px', fontWeight: 500 }}>{c.name}</td>
                <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>{c.version || 'Not detected'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
