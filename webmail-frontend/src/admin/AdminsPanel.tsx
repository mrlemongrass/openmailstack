import { useState, useEffect, useCallback } from 'react';
import { Shield, UserPlus, UserMinus, X } from 'lucide-react';
import { PromoteAdminModal } from './AdminModals';
import { getAdminUsers, promoteAdmin, demoteAdmin, type AdminUserInfo } from './adminSettingsApi';

export function AdminsPanel() {
  const [admins, setAdmins] = useState<AdminUserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showPromote, setShowPromote] = useState(false);
  const [demoting, setDemoting] = useState<string | null>(null);

  const load = useCallback(() => {
    getAdminUsers().then(setAdmins).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handlePromote = async (data: { username: string }) => {
    try {
      await promoteAdmin(data.username);
      setShowPromote(false);
      setLoading(true);
      load();
    } catch (e: any) { setError(e.message); }
  };

  const handleDemote = async (username: string) => {
    if (!confirm(`Demote "${username}" from admin? They will lose admin access.`)) return;
    setDemoting(username);
    try { await demoteAdmin(username); load(); } catch (e: any) { setError(e.message); }
    finally { setDemoting(null); }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--text-secondary)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 24, height: 24, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
          <p>Loading admins...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {error && <div className="status-banner status-error" style={{ marginBottom: 12 }}>{error} <button onClick={() => setError('')} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', marginLeft: 8 }}><X size={14} /></button></div>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: '1.3rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Shield size={20} /> Administrators
        </h2>
        <button className="btn btn-primary" onClick={() => setShowPromote(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <UserPlus size={16} /> Promote Admin
        </button>
      </div>

      {admins.length === 0 ? (
        <div className="glass-panel" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
          <Shield size={40} style={{ opacity: 0.3, marginBottom: 8 }} />
          <p>No admin accounts found.</p>
        </div>
      ) : (
        <div className="glass-panel" style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left' }}>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Username</th>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Created</th>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Super Admin</th>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Active</th>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {admins.map(a => (
                <tr key={a.username} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 500 }}>{a.username}</td>
                  <td style={{ padding: '10px 12px' }}>{new Date(a.created).toLocaleDateString()}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ color: a.superadmin ? 'var(--accent-primary)' : 'var(--text-muted, #666)' }}>{a.superadmin ? 'Yes' : 'No'}</span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ color: a.active ? 'var(--success, #4caf50)' : 'var(--text-muted, #666)' }}>{a.active ? 'Yes' : 'No'}</span>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    {!a.superadmin && (
                      <button
                        className="btn btn-secondary"
                        onClick={() => handleDemote(a.username)}
                        disabled={demoting === a.username}
                        title="Demote"
                        style={{ padding: '4px 8px', fontSize: '0.75rem', color: 'var(--destructive, #ef4444)', display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        <UserMinus size={14} /> {demoting === a.username ? '...' : 'Demote'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showPromote && <PromoteAdminModal onClose={() => setShowPromote(false)} onSubmit={handlePromote} />}
    </div>
  );
}
