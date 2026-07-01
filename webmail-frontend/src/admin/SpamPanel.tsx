import { useState, useEffect, useCallback } from 'react';
import { ShieldAlert, ExternalLink, Save, X } from 'lucide-react';
import { getSpamPolicies, saveSpamPolicies } from './adminSettingsApi';

export function SpamPanel() {
  const [rules, setRules] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    getSpamPolicies()
      .then(r => setRules(r ? JSON.stringify(r, null, 2) : '{}'))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setStatus('');
    setError('');
    try {
      const parsed = JSON.parse(rules);
      await saveSpamPolicies(parsed);
      setStatus('Spam policies saved successfully.');
    } catch (e: any) {
      if (e instanceof SyntaxError) {
        setError('Invalid JSON: ' + e.message);
      } else {
        setError(e.message);
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--text-secondary)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 24, height: 24, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
          <p>Loading spam policies...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: '1.3rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShieldAlert size={20} /> Spam & Security
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <a
            href="/rspamd"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none', fontSize: '0.85rem' }}
          >
            <ExternalLink size={14} /> Open Rspamd
          </a>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Save size={14} /> {saving ? 'Saving...' : 'Save Policies'}
          </button>
        </div>
      </div>

      {error && <div className="status-banner status-error" style={{ marginBottom: 12 }}>{error} <button onClick={() => setError('')} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', marginLeft: 8 }}><X size={14} /></button></div>}
      {status && <div className="status-banner status-success" style={{ marginBottom: 12 }}>{status} <button onClick={() => setStatus('')} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', marginLeft: 8 }}><X size={14} /></button></div>}

      <div className="glass-panel" style={{ padding: 16, marginBottom: 16 }}>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 0 }}>
          Configure global spam filtering rules. These are applied as a JSON policy document processed by Rspamd.
        </p>
        <textarea
          className="glass-input"
          value={rules}
          onChange={e => setRules(e.target.value)}
          style={{
            width: '100%', minHeight: 300, fontFamily: 'monospace', fontSize: '0.8rem',
            padding: 12, resize: 'vertical', boxSizing: 'border-box',
          }}
          spellCheck={false}
        />
      </div>

      <div className="glass-panel" style={{ padding: 16 }}>
        <h3 style={{ margin: '0 0 8px 0', fontSize: '0.95rem' }}>Quick Actions</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href="/rspamd" target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ textDecoration: 'none', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6 }}>
            <ExternalLink size={14} /> Rspamd Web Interface
          </a>
          <button className="btn btn-secondary" onClick={() => { if (confirm('Reset to empty policy?')) { setRules('{}'); } }} style={{ fontSize: '0.85rem' }}>
            Reset to Default
          </button>
        </div>
      </div>
    </div>
  );
}
