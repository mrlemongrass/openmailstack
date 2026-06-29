import { useState } from 'react';

interface ModalProps {
  onClose: () => void;
}

export function CreateDomainModal({ onClose, onSubmit }: ModalProps & { onSubmit: (data: { domain: string; maxquota: string; quota: string }) => void }) {
  const [domain, setDomain] = useState('');
  const [maxquota, setMaxquota] = useState('0');
  const [quota, setQuota] = useState('0');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', width: '100%' }}>
        <h3>Add Domain</h3>
        <form onSubmit={e => { e.preventDefault(); onSubmit({ domain, maxquota, quota }); }} className="settings-form-grid" style={{ marginTop: '16px' }}>
          <label className="settings-field">
            <span>Domain Name</span>
            <input required type="text" className="glass-input" value={domain} onChange={e => setDomain(e.target.value)} placeholder="example.com" />
          </label>
          <label className="settings-field">
            <span>Max Domain Quota (MB)</span>
            <input required type="number" className="glass-input" value={maxquota} onChange={e => setMaxquota(e.target.value)} />
            <small>0 for unlimited</small>
          </label>
          <label className="settings-field">
            <span>Default Mailbox Quota (MB)</span>
            <input required type="number" className="glass-input" value={quota} onChange={e => setQuota(e.target.value)} />
            <small>0 for unlimited</small>
          </label>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Add Domain</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function CreateMailboxModal({ onClose, onSubmit, domains }: ModalProps & { onSubmit: (data: any) => void, domains: { domain: string }[] }) {
  const [domain, setDomain] = useState(domains[0]?.domain || '');
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [quota, setQuota] = useState('-1');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', width: '100%' }}>
        <h3>Create Mailbox</h3>
        <form onSubmit={e => { e.preventDefault(); onSubmit({ domain, username, name, password, quota }); }} className="settings-form-grid" style={{ marginTop: '16px' }}>
          <label className="settings-field">
            <span>Domain</span>
            <select required className="glass-input" value={domain} onChange={e => setDomain(e.target.value)}>
              {domains.map(d => <option key={d.domain} value={d.domain}>{d.domain}</option>)}
            </select>
          </label>
          <label className="settings-field">
            <span>Username (before @)</span>
            <input required type="text" className="glass-input" value={username} onChange={e => setUsername(e.target.value)} placeholder="user" />
          </label>
          <label className="settings-field">
            <span>Display Name</span>
            <input type="text" className="glass-input" value={name} onChange={e => setName(e.target.value)} placeholder={username} />
          </label>
          <label className="settings-field">
            <span>Temporary Password</span>
            <input required type="password" className="glass-input" value={password} onChange={e => setPassword(e.target.value)} />
          </label>
          <label className="settings-field">
            <span>Quota (MB)</span>
            <input required type="number" className="glass-input" value={quota} onChange={e => setQuota(e.target.value)} />
            <small>-1 uses domain default, 0 is unlimited</small>
          </label>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create Mailbox</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function CreateAliasModal({ onClose, onSubmit, domains }: ModalProps & { onSubmit: (data: any) => void, domains: { domain: string }[] }) {
  const [domain, setDomain] = useState(domains[0]?.domain || '');
  const [address, setAddress] = useState('');
  const [goto, setGoto] = useState('');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', width: '100%' }}>
        <h3>Create Alias</h3>
        <form onSubmit={e => { e.preventDefault(); onSubmit({ domain, address, goto }); }} className="settings-form-grid" style={{ marginTop: '16px' }}>
          <label className="settings-field">
            <span>Domain</span>
            <select required className="glass-input" value={domain} onChange={e => setDomain(e.target.value)}>
              {domains.map(d => <option key={d.domain} value={d.domain}>{d.domain}</option>)}
            </select>
          </label>
          <label className="settings-field">
            <span>Alias Address</span>
            <input required type="text" className="glass-input" value={address} onChange={e => setAddress(e.target.value)} placeholder="sales, sales@example.com, or @example.com" />
          </label>
          <label className="settings-field">
            <span>Target Addresses (comma-separated)</span>
            <input required type="text" className="glass-input" value={goto} onChange={e => setGoto(e.target.value)} placeholder="user@example.com" />
          </label>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Create Alias</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function CreateApiKeyModal({ onClose, onSubmit }: ModalProps & { onSubmit: (data: { description: string }) => void }) {
  const [description, setDescription] = useState('');
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', width: '100%' }}>
        <h3>Generate API Key</h3>
        <form onSubmit={e => { e.preventDefault(); onSubmit({ description }); }} className="settings-form-grid" style={{ marginTop: '16px' }}>
          <label className="settings-field">
            <span>Description</span>
            <input required type="text" className="glass-input" value={description} onChange={e => setDescription(e.target.value)} placeholder="For sync service..." />
          </label>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Generate</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ChangePasswordModal({ onClose, onSubmit, username }: ModalProps & { onSubmit: (data: { password: string }) => void, username: string }) {
  const [password, setPassword] = useState('');
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', width: '100%' }}>
        <h3>Change Password</h3>
        <p style={{ opacity: 0.8, fontSize: '0.9rem', marginBottom: '16px' }}>For mailbox: <strong>{username}</strong></p>
        <form onSubmit={e => { e.preventDefault(); onSubmit({ password }); }} className="settings-form-grid">
          <label className="settings-field">
            <span>New Password</span>
            <input required type="password" className="glass-input" value={password} onChange={e => setPassword(e.target.value)} />
          </label>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save Password</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function CreateRoutingModal({ onClose, onSubmit }: ModalProps & { onSubmit: (data: { aliasDomain: string }) => void }) {
  const [aliasDomain, setAliasDomain] = useState('');
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', width: '100%' }}>
        <h3>Create Routing Alias</h3>
        <form onSubmit={e => { e.preventDefault(); onSubmit({ aliasDomain }); }} className="settings-form-grid" style={{ marginTop: '16px' }}>
          <label className="settings-field">
            <span>Alias Domain</span>
            <input required type="text" className="glass-input" value={aliasDomain} onChange={e => setAliasDomain(e.target.value)} placeholder="alias.example.com" />
          </label>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Add Routing</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function PromoteAdminModal({ onClose, onSubmit }: ModalProps & { onSubmit: (data: { username: string }) => void }) {
  const [username, setUsername] = useState('');
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', width: '100%' }}>
        <h3>Promote Admin</h3>
        <form onSubmit={e => { e.preventDefault(); onSubmit({ username }); }} className="settings-form-grid" style={{ marginTop: '16px' }}>
          <label className="settings-field">
            <span>Full Mailbox Address</span>
            <input required type="email" className="glass-input" value={username} onChange={e => setUsername(e.target.value)} placeholder="user@example.com" />
          </label>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Promote</button>
          </div>
        </form>
      </div>
    </div>
  );
}

