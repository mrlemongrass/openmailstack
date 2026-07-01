import { useState, useEffect, useCallback } from 'react';
import { Forward, Trash2, Plus, X, Edit3 } from 'lucide-react';
import { CreateAliasModal } from './AdminModals';
import { getAliases, createAlias, updateAlias, deleteAlias, getDomains, type AliasInfo, type DomainInfo } from './adminSettingsApi';

function EditAliasModal({ alias, onClose, onSave, domains }: { alias: AliasInfo; onClose: () => void; onSave: (data: { address: string; domain: string; goto: string }) => Promise<void>; domains: DomainInfo[] }) {
  const [address, setAddress] = useState(alias.address);
  const [domain, setDomain] = useState(alias.domain);
  const [goto, setGoto] = useState(alias.goto);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave({ address, domain, goto }); onClose(); } catch { /* parent handles */ }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', width: '100%' }}>
        <h3>Edit Alias: {alias.address}</h3>
        <form onSubmit={handleSubmit} className="settings-form-grid" style={{ marginTop: 16 }}>
          <label className="settings-field">
            <span>Domain</span>
            <select className="glass-input" value={domain} onChange={e => setDomain(e.target.value)}>
              {domains.map(d => <option key={d.domain} value={d.domain}>{d.domain}</option>)}
            </select>
          </label>
          <label className="settings-field">
            <span>Alias Address</span>
            <input type="text" className="glass-input" value={address} onChange={e => setAddress(e.target.value)} />
          </label>
          <label className="settings-field">
            <span>Target Addresses (comma-separated)</span>
            <input type="text" className="glass-input" value={goto} onChange={e => setGoto(e.target.value)} />
          </label>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function AliasesPanel() {
  const [aliases, setAliases] = useState<AliasInfo[]>([]);
  const [domains, setDomains] = useState<DomainInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editAlias, setEditAlias] = useState<AliasInfo | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([getAliases(), getDomains()])
      .then(([a, d]) => { setAliases(a); setDomains(d); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (data: any) => {
    try {
      await createAlias({ address: data.address, domain: data.domain, goto: data.goto });
      setShowCreate(false);
      setLoading(true);
      load();
    } catch (e: any) { setError(e.message); }
  };

  const handleEdit = async (data: { address: string; domain: string; goto: string }) => {
    if (!editAlias) return;
    await updateAlias(editAlias.address, data);
    setEditAlias(null);
    setLoading(true);
    load();
  };

  const handleDelete = async (address: string) => {
    if (!confirm(`Delete alias "${address}"?`)) return;
    setDeleting(address);
    try { await deleteAlias(address); load(); } catch (e: any) { setError(e.message); }
    finally { setDeleting(null); }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--text-secondary)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 24, height: 24, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
          <p>Loading aliases...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {error && <div className="status-banner status-error" style={{ marginBottom: 12 }}>{error} <button onClick={() => setError('')} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', marginLeft: 8 }}><X size={14} /></button></div>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: '1.3rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Forward size={20} /> Aliases
        </h2>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={16} /> Create Alias
        </button>
      </div>

      {aliases.length === 0 ? (
        <div className="glass-panel" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
          <Forward size={40} style={{ opacity: 0.3, marginBottom: 8 }} />
          <p>No aliases configured.</p>
        </div>
      ) : (
        <div className="glass-panel" style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left' }}>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Address</th>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Target</th>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Domain</th>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Active</th>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {aliases.map(a => (
                <tr key={a.address} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 500 }}>{a.address}</td>
                  <td style={{ padding: '10px 12px', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.goto}</td>
                  <td style={{ padding: '10px 12px' }}>{a.domain}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ color: a.active ? 'var(--success, #4caf50)' : 'var(--text-muted, #666)' }}>{a.active ? 'Yes' : 'No'}</span>
                  </td>
                  <td style={{ padding: '10px 12px', display: 'flex', gap: 6 }}>
                    <button className="btn btn-secondary" onClick={() => setEditAlias(a)} title="Edit" style={{ padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Edit3 size={14} />
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleDelete(a.address)}
                      disabled={deleting === a.address}
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

      {showCreate && <CreateAliasModal onClose={() => setShowCreate(false)} onSubmit={handleCreate} domains={domains} />}
      {editAlias && <EditAliasModal alias={editAlias} onClose={() => setEditAlias(null)} onSave={handleEdit} domains={domains} />}
    </div>
  );
}
