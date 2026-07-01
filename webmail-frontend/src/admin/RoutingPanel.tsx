import { useState, useEffect, useCallback } from 'react';
import { GitMerge, Trash2, Plus, X } from 'lucide-react';
import { CreateRoutingModal } from './AdminModals';
import { getRouting, createRouting, deleteRouting, type RoutingInfo } from './adminSettingsApi';

export function RoutingPanel() {
  const [routes, setRoutes] = useState<RoutingInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(() => {
    getRouting().then(setRoutes).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (data: { aliasDomain: string }) => {
    try {
      await createRouting(data.aliasDomain);
      setShowCreate(false);
      setLoading(true);
      load();
    } catch (e: any) { setError(e.message); }
  };

  const handleDelete = async (aliasDomain: string) => {
    if (!confirm(`Delete routing for "${aliasDomain}"?`)) return;
    setDeleting(aliasDomain);
    try { await deleteRouting(aliasDomain); load(); } catch (e: any) { setError(e.message); }
    finally { setDeleting(null); }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--text-secondary)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 24, height: 24, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
          <p>Loading routing...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {error && <div className="status-banner status-error" style={{ marginBottom: 12 }}>{error} <button onClick={() => setError('')} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', marginLeft: 8 }}><X size={14} /></button></div>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: '1.3rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          <GitMerge size={20} /> Domain Routing
        </h2>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={16} /> Add Routing
        </button>
      </div>

      {routes.length === 0 ? (
        <div className="glass-panel" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
          <GitMerge size={40} style={{ opacity: 0.3, marginBottom: 8 }} />
          <p>No routing rules configured. Alias domains will forward mail to their target domain.</p>
        </div>
      ) : (
        <div className="glass-panel" style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left' }}>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Alias Domain</th>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Target Domain</th>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Active</th>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {routes.map(r => (
                <tr key={r.alias_domain} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 500 }}>{r.alias_domain}</td>
                  <td style={{ padding: '10px 12px' }}>{r.target_domain}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ color: r.active ? 'var(--success, #4caf50)' : 'var(--text-muted, #666)' }}>{r.active ? 'Yes' : 'No'}</span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleDelete(r.alias_domain)}
                      disabled={deleting === r.alias_domain}
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

      {showCreate && <CreateRoutingModal onClose={() => setShowCreate(false)} onSubmit={handleCreate} />}
    </div>
  );
}
