import { useState, useEffect, useCallback } from 'react';
import { Globe, Trash2, Plus, Server, X, Copy, Check } from 'lucide-react';
import { CreateDomainModal } from './AdminModals';
import { getDomains, createDomain, deleteDomain, getDomainDns, type DomainInfo, type DnsRecord } from './adminSettingsApi';

function DnsModal({ domain, onClose }: { domain: string; onClose: () => void }) {
  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDomainDns(domain).then(r => { if (!cancelled) setRecords(r); })
      .catch(e => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [domain]);

  const copyValue = async (value: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 2000);
    } catch { /* ignore */ }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '700px', width: '100%', maxHeight: '80vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>DNS Records for {domain}</h3>
          <button className="btn btn-secondary" onClick={onClose} style={{ padding: '4px 8px' }}><X size={16} /></button>
        </div>
        {loading && <p style={{ color: 'var(--text-secondary)' }}>Loading DNS records...</p>}
        {error && <div className="status-banner status-error">{error}</div>}
        {!loading && !error && records.length === 0 && (
          <p style={{ color: 'var(--text-secondary)' }}>No DNS records available.</p>
        )}
        {!loading && !error && records.map((rec, i) => (
          <div key={i} style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8, padding: '10px 14px', marginBottom: 8,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{
                background: 'var(--accent-primary)', color: '#fff', fontSize: '0.7rem',
                padding: '2px 8px', borderRadius: 4, fontWeight: 600, textTransform: 'uppercase',
              }}>{rec.type}</span>
              <code style={{ color: 'var(--text-primary)', fontSize: '0.85rem' }}>{rec.host}</code>
              {rec.priority != null && <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>priority {rec.priority}</span>}
              <span style={{ color: 'var(--text-muted, #666)', fontSize: '0.75rem', marginLeft: 'auto' }}>TTL {rec.ttl}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <code style={{
                flex: 1, background: 'rgba(0,0,0,0.2)', padding: '6px 10px', borderRadius: 4,
                fontSize: '0.8rem', color: 'var(--text-primary)', wordBreak: 'break-all',
              }}>{rec.value}</code>
              <button
                onClick={() => copyValue(rec.value, i)}
                title="Copy to clipboard"
                style={{
                  background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 4, padding: '4px 8px', cursor: 'pointer', color: 'var(--text-secondary)',
                  display: 'flex', alignItems: 'center',
                }}
              >
                {copiedIdx === i ? <Check size={14} color="var(--success, #4caf50)" /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DomainsPanel() {
  const [domains, setDomains] = useState<DomainInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [dnsDomain, setDnsDomain] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(() => {
    getDomains().then(setDomains).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (data: { domain: string; maxquota: string; quota: string }) => {
    try {
      await createDomain(data);
      setShowCreate(false);
      setLoading(true);
      load();
    } catch (e: any) { setError(e.message); }
  };

  const handleDelete = async (domain: string) => {
    if (!confirm(`Permanently delete domain "${domain}" and ALL its mailboxes, aliases, and data?`)) return;
    setDeleting(domain);
    try {
      await deleteDomain(domain);
      load();
    } catch (e: any) { setError(e.message); }
    finally { setDeleting(null); }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--text-secondary)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: 24, height: 24, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
          <p>Loading domains...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {error && <div className="status-banner status-error" style={{ marginBottom: 12 }}>{error} <button onClick={() => setError('')} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', marginLeft: 8 }}><X size={14} /></button></div>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: '1.3rem', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Globe size={20} /> Domains
        </h2>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={16} /> Add Domain
        </button>
      </div>

      {domains.length === 0 ? (
        <div className="glass-panel" style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)' }}>
          <Globe size={40} style={{ opacity: 0.3, marginBottom: 8 }} />
          <p>No domains configured.</p>
        </div>
      ) : (
        <div className="glass-panel" style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left' }}>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Domain</th>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Mailboxes</th>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Aliases</th>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Quota</th>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Active</th>
                <th style={{ padding: '10px 12px', color: 'var(--text-secondary)', fontWeight: 500 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {domains.map(d => (
                <tr key={d.domain} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 500 }}>{d.domain}</td>
                  <td style={{ padding: '10px 12px' }}>{d.mailboxes}</td>
                  <td style={{ padding: '10px 12px' }}>{d.aliases}</td>
                  <td style={{ padding: '10px 12px' }}>{d.maxquota > 0 ? `${d.maxquota} MB` : 'Unlimited'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ color: d.active ? 'var(--success, #4caf50)' : 'var(--text-muted, #666)' }}>{d.active ? 'Yes' : 'No'}</span>
                  </td>
                  <td style={{ padding: '10px 12px', display: 'flex', gap: 6 }}>
                    <button className="btn btn-secondary" onClick={() => setDnsDomain(d.domain)} title="DNS Records" style={{ padding: '4px 8px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Server size={14} /> DNS
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleDelete(d.domain)}
                      disabled={deleting === d.domain}
                      title="Delete domain"
                      style={{ padding: '4px 8px', fontSize: '0.75rem', color: 'var(--destructive, #ef4444)', display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <Trash2 size={14} /> {deleting === d.domain ? '...' : ''}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <CreateDomainModal onClose={() => setShowCreate(false)} onSubmit={handleCreate} />}
      {dnsDomain && <DnsModal domain={dnsDomain} onClose={() => setDnsDomain(null)} />}
    </div>
  );
}
