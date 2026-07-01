import { useState, useEffect, useCallback } from 'react';
import { Mail, Trash2, Plus, Key, X, Edit3 } from 'lucide-react';
import { CreateMailboxModal, ChangePasswordModal } from './AdminModals';
import { getMailboxes, createMailbox, updateMailbox, deleteMailbox, changeMailboxPassword, getDomains, type MailboxInfo, type DomainInfo } from './adminSettingsApi';

interface EditFormData {
  name: string;
  quota: string;
  active: boolean;
}

function EditMailboxModal({ mailbox, onClose, onSave }: { mailbox: MailboxInfo; onClose: () => void; onSave: (data: EditFormData) => Promise<void> }) {
  const [name, setName] = useState(mailbox.name || '');
  const [quota, setQuota] = useState(String(mailbox.quota));
  const [active, setActive] = useState(mailbox.active);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave({ name, quota, active }); onClose(); } catch { /* parent handles error */ }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', width: '100%' }}>
        <h3>Edit Mailbox: {mailbox.username}</h3>
        <form onSubmit={handleSubmit} className="settings-form-grid" style={{ marginTop: 16 }}>
          <label className="settings-field">
            <span>Display Name</span>
            <input type="text" className="glass-input" value={name} onChange={e => setName(e.target.value)} />
          </label>
          <label className="settings-field">
            <span>Quota (MB, 0=unlimited)</span>
            <input type="number" className="glass-input" value={quota} onChange={e => setQuota(e.target.value)} />
          </label>
          <label className="settings-field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
            <span>Active</span>
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

export function MailboxesPanel() {
  const [mailboxes, setMailboxes] = useState<MailboxInfo[]>([]);
  const [domains, setDomains] = useState<DomainInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [passwordUser, setPasswordUser] = useState<string | null>(null);
  const [editMailbox, setEditMailbox] = useState<MailboxInfo | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([getMailboxes(), getDomains()])
      .then(([m, d]) => { setMailboxes(m); setDomains(d); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (data: any) => {
    try {
      const payload: Record<string, string> = {
        username: data.username,
        domain: data.domain,
        name: data.name,
        password: data.password,
        quota: data.quota,
      };
      await createMailbox(payload);
      setShowCreate(false);
      setLoading(true);
      load();
    } catch (e: any) { setError(e.message); }
  };

  const handleEdit = async (data: EditFormData) => {
    if (!editMailbox) return;
    const payload: Record<string, any> = { ...data, username: editMailbox.username };
    await updateMailbox(editMailbox.username, payload);
    setEditMailbox(null);
    setLoading(true);
    load();
  };

  const handlePassword = async (data: { password: string }) => {
    if (!passwordUser) return;
    await changeMailboxPassword(passwordUser, data.password);
    setPasswordUser(null);
  };

  const handleDelete = async (username: string) => {
    if (!confirm(`Delete mailbox "${username}"?`)) return;
    setDeleting(username);
    try { await deleteMailbox(username); load(); } catch (e: any) { setError(e.message); }
    finally { setDeleting(null); }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--text-secondary)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 24, height: 24, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
          <p>Loading mailboxes...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {error && <div className="status-banner status-error" style={{ marginBottom: 12 }}>{error} <button onClick={() => setError('')} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', marginLeft: 8 }}><X size={14} /></button></div>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: '1.3rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Mail size={20} /> Mailboxes
        </h2>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={16} /> Create Mailbox
        </button>
      </div>

      {mailboxes.length === 0 ? (
        <div className="glass-panel" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
          <Mail size={40} style={{ opacity: 0.3, marginBottom: 8 }} />
          <p>No mailboxes found.</p>
        </div>
      ) : (
        <div className="glass-panel" style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left' }}>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Username</th>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Name</th>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Quota</th>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Active</th>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {mailboxes.map(m => (
                <tr key={m.username} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 500 }}>{m.username}</td>
                  <td style={{ padding: '10px 12px' }}>{m.name || '-'}</td>
                  <td style={{ padding: '10px 12px' }}>{m.quota > 0 ? `${m.quota} MB` : m.quota === 0 ? 'Unlimited' : 'Domain default'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ color: m.active ? 'var(--success, #4caf50)' : 'var(--text-muted, #666)' }}>{m.active ? 'Yes' : 'No'}</span>
                  </td>
                  <td style={{ padding: '10px 12px', display: 'flex', gap: 6 }}>
                    <button className="btn btn-secondary" onClick={() => setEditMailbox(m)} title="Edit" style={{ padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Edit3 size={14} />
                    </button>
                    <button className="btn btn-secondary" onClick={() => setPasswordUser(m.username)} title="Change password" style={{ padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Key size={14} />
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleDelete(m.username)}
                      disabled={deleting === m.username}
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

      {showCreate && <CreateMailboxModal onClose={() => setShowCreate(false)} onSubmit={handleCreate} domains={domains} />}
      {passwordUser && <ChangePasswordModal onClose={() => setPasswordUser(null)} onSubmit={handlePassword} username={passwordUser} />}
      {editMailbox && <EditMailboxModal mailbox={editMailbox} onClose={() => setEditMailbox(null)} onSave={handleEdit} />}
    </div>
  );
}
