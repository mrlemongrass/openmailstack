import { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle, AlertCircle, Box } from 'lucide-react';
import { getUpdates, type UpdatesInfo } from './adminSettingsApi';

export function UpdatesPanel() {
  const [updates, setUpdates] = useState<UpdatesInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    getUpdates()
      .then(setUpdates)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--text-secondary)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 24, height: 24, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
          <p>Checking for updates...</p>
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
        <button className="btn btn-secondary" onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw size={14} /> Check Again
        </button>
      </div>

      <div className="glass-panel" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          {updates.has_update ? (
            <AlertCircle size={20} style={{ color: '#f59e0b' }} />
          ) : (
            <CheckCircle size={20} style={{ color: 'var(--success, #4caf50)' }} />
          )}
          <span style={{ fontSize: '1rem' }}>
            {updates.has_update
              ? `Update available: ${updates.current_version} → ${updates.latest_version}`
              : `You are running the latest version (${updates.current_version})`}
          </span>
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
