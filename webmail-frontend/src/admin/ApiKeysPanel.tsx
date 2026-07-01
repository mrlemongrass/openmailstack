import { useState, useEffect, useCallback } from 'react';
import { Key, Trash2, Plus, X, Copy, Check } from 'lucide-react';
import { CreateApiKeyModal } from './AdminModals';
import { getApiKeys, createApiKey, deleteApiKey, type ApiKeyInfo } from './adminSettingsApi';

export function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  const load = useCallback(() => {
    getApiKeys().then(setKeys).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (data: { description: string }) => {
    try {
      const rawKey = await createApiKey(data.description);
      setShowCreate(false);
      setNewKey(rawKey);
      load();
    } catch (e: any) { setError(e.message); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this API key? Any services using it will lose access.')) return;
    setDeleting(id);
    try { await deleteApiKey(id); load(); } catch (e: any) { setError(e.message); }
    finally { setDeleting(null); }
  };

  const copyKey = async () => {
    if (!newKey) return;
    try { await navigator.clipboard.writeText(newKey); setCopied(true); setTimeout(() => setCopied(false), 3000); } catch { /* ignore */ }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--text-secondary)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 24, height: 24, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
          <p>Loading API keys...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {error && <div className="status-banner status-error" style={{ marginBottom: 12 }}>{error} <button onClick={() => setError('')} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', marginLeft: 8 }}><X size={14} /></button></div>}

      {newKey && (
        <div className="status-banner status-success" style={{ marginBottom: 12, wordBreak: 'break-all', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span><strong>New API Key:</strong> <code style={{ fontSize: '0.8rem' }}>{newKey}</code></span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={copyKey} className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
            </button>
            <button onClick={() => setNewKey(null)} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}><X size={14} /></button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: '1.3rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Key size={20} /> API Keys
        </h2>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={16} /> Generate Key
        </button>
      </div>

      {keys.length === 0 ? (
        <div className="glass-panel" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
          <Key size={40} style={{ opacity: 0.3, marginBottom: 8 }} />
          <p>No API keys configured.</p>
        </div>
      ) : (
        <div className="glass-panel" style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left' }}>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>ID</th>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Description</th>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Created</th>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Last Used</th>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map(k => (
                <tr key={k.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: '0.8rem' }}>{k.id}</td>
                  <td style={{ padding: '10px 12px' }}>{k.description}</td>
                  <td style={{ padding: '10px 12px' }}>{new Date(k.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-secondary)' }}>{k.last_used ? new Date(k.last_used).toLocaleDateString() : 'Never'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleDelete(k.id)}
                      disabled={deleting === k.id}
                      title="Delete"
                      style={{ padding: '4px 8px', fontSize: '0.75rem', color: 'var(--destructive, #ef4444)', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <CreateApiKeyModal onClose={() => setShowCreate(false)} onSubmit={handleCreate} />}
    </div>
  );
}
