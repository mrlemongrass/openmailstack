import { useCallback, useEffect, useState } from 'react';
import { Server, Shield, HardDrive, Activity, Database, Globe, Clock, RefreshCw, AlertTriangle, Smartphone } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface ProtocolHealth {
  ok: boolean;
  status: number | null;
  latencyMs: number | null;
  lastError: string | null;
  checkedAt: string;
  endpoint: string;
  greeting?: string | null;
  protocolVersions?: string | null;
  recentErrors?: number | null;
  recentErrorWindowMinutes?: number;
}

interface SystemHealth {
  success: boolean;
  cpu: { load1: number; load5: number; load15: number };
  memory: { total: number; free: number; used: number; usedPercent: number };
  disk: { total: number; used: number; usedPercent: number };
  services: Record<string, boolean>;
  protocols?: {
    activeSync?: ProtocolHealth;
    imap?: ProtocolHealth;
    smtp?: ProtocolHealth;
    caldav?: ProtocolHealth;
    carddav?: ProtocolHealth;
  };
  mailQueue: number;
  connections: { imap: number; smtp: number; http: number };
}

type ProtocolKey = 'activeSync' | 'imap' | 'smtp' | 'caldav' | 'carddav';

function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function formatLoad(n: number): string {
  return n.toFixed(2);
}

const SERVICE_META: Record<string, { label: string; icon: LucideIcon | React.ComponentType<{ size?: number }> }> = {
  postfix: { label: 'Postfix (SMTP)', icon: MailIcon as any },
  dovecot: { label: 'Dovecot (IMAP)', icon: Server },
  rspamd: { label: 'Rspamd', icon: Shield },
  fail2ban: { label: 'Fail2ban', icon: Shield },
  openmailstack: { label: 'OpenMailStack Backend', icon: Activity },
  nginx: { label: 'Nginx (HTTPS Proxy)', icon: Globe },
};

function MailIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 7l-10 7L2 7" />
    </svg>
  );
}

export function SystemHealthDashboard() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(15);
  const [refreshing, setRefreshing] = useState(false);
  const [remediating, setRemediating] = useState<string | null>(null);

  const fetchHealth = useCallback(() => {
    setRefreshing(true);
    fetch('/api/admin/telemetry/system-health')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setHealth(data);
          setLastUpdated(new Date());
          setError('');
        } else {
          setError(data.error || 'Failed to load system health');
        }
      })
      .catch(err => {
        setError(err.message || 'Connection error');
      })
      .finally(() => setRefreshing(false));
    setCountdown(15);
  }, []);

  useEffect(() => {
    fetchHealth();
    const tick = setInterval(() => setCountdown(c => (c > 1 ? c - 1 : 15)), 1000);
    const interval = setInterval(fetchHealth, 15000);
    return () => { clearInterval(tick); clearInterval(interval); };
  }, [fetchHealth]);

  const handleRemediate = async (action: string) => {
    const confirmed = window.confirm('Restart the OpenMailStack backend? Active webmail and ActiveSync requests may reconnect.');
    if (!confirmed) return;

    setRemediating(action);
    setStatus('');
    setError('');
    try {
      const res = await fetch('/api/admin/telemetry/remediate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus(data.message || 'Remediation scheduled.');
        setTimeout(fetchHealth, 6000);
      } else {
        setError(data.error || 'Remediation failed');
      }
    } catch (err: any) {
      setError(err.message || 'Connection error');
    } finally {
      setRemediating(null);
    }
  };

  if (error && !health) {
    return (
      <div className="glass-panel" style={{ padding: '30px' }}>
        <div className="content-header" style={{ marginBottom: '20px' }}>
          <h2>System Health Dashboard</h2>
        </div>
        <div className="empty-state">
          <p style={{ color: 'var(--danger)' }}>Failed to load system health: {error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-panel" style={{ padding: '30px' }}>
      <div className="content-header" style={{ marginBottom: '20px' }}>
        <div>
          <h2>System Health Dashboard</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {lastUpdated && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Clock size={12} className={refreshing ? 'spin' : ''} /> Updated {lastUpdated.toLocaleTimeString()} · refresh in {countdown}s
            </span>
          )}
          <span style={{ background: 'var(--accent-primary)', padding: '4px 12px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 'bold' }}>ADMIN</span>
        </div>
      </div>

      {error && health && <div className="status-banner status-error" style={{ marginBottom: 12 }}>{error}</div>}
      {status && <div className="status-banner status-success" style={{ marginBottom: 12 }}>{status}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', marginBottom: '20px' }}>
        {/* System Services Card */}
        <div className="glass-panel" style={{ padding: '20px' }}>
          <h3 style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Server size={18} /> System Services
          </h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {health && Object.entries(SERVICE_META).map(([key, meta]) => {
              const running = health.services[key];
              return (
                <li key={key} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 0', borderBottom: '1px solid var(--border-glass)',
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem' }}>
                    <meta.icon size={16} style={{ color: running ? 'var(--success)' : 'var(--danger)' }} />
                    {meta.label}
                  </span>
                  <span style={{
                    fontSize: '0.75rem', fontWeight: 600, padding: '2px 10px', borderRadius: '12px',
                    background: running ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                    color: running ? 'var(--success)' : 'var(--danger)',
                  }}>
                    {running ? 'Active' : 'Down'}
                  </span>
                </li>
              );
            })}
            {!health && <li style={{ padding: '8px 0', color: 'var(--text-secondary)' }}>Loading services...</li>}
          </ul>
        </div>

        {/* Server Resources Card */}
        <div className="glass-panel" style={{ padding: '20px', minWidth: 0 }}>
          <h3 style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity size={18} /> Server Resources
          </h3>

          {/* CPU Load */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>CPU Load</span>
              <span style={{ fontSize: '0.85rem', fontFamily: 'monospace' }}>
                {health ? `${formatLoad(health.cpu.load1)} / ${formatLoad(health.cpu.load5)} / ${formatLoad(health.cpu.load15)}` : '...'}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '4px' }}>
              {(['load1', 'load5', 'load15'] as const).map((key) => {
                const val = health ? Math.min(health.cpu[key] * 100, 100) : 0;
                const colors = { load1: 'var(--accent-purple)', load5: 'var(--accent-primary)', load15: '#06b6d4' };
                return (
                  <div key={key} style={{ flex: 1 }}>
                    <div style={{ width: '100%', height: '6px', background: 'var(--border-glass)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div style={{
                        width: `${val}%`, height: '100%', background: colors[key],
                        borderRadius: '3px', transition: 'width 0.5s ease',
                      }} />
                    </div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginTop: '2px', textAlign: 'center' }}>
                      {key === 'load1' ? '1m' : key === 'load5' ? '5m' : '15m'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Memory */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Memory Usage</span>
              <span style={{ fontSize: '0.85rem', fontFamily: 'monospace' }}>
                {health ? `${formatBytes(health.memory.used)} / ${formatBytes(health.memory.total)} (${health.memory.usedPercent}%)` : '...'}
              </span>
            </div>
            <div style={{ width: '100%', height: '8px', background: 'var(--border-glass)', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{
                width: `${health ? health.memory.usedPercent : 0}%`, height: '100%',
                background: health && health.memory.usedPercent > 90 ? 'var(--danger)'
                  : health && health.memory.usedPercent > 70 ? '#f59e0b'
                  : 'var(--accent-primary)',
                borderRadius: '4px', transition: 'width 0.5s ease',
              }} />
            </div>
          </div>

          {/* Disk */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Disk Usage (/)</span>
              <span style={{ fontSize: '0.85rem', fontFamily: 'monospace' }}>
                {health ? `${formatBytes(health.disk.used)} / ${formatBytes(health.disk.total)} (${health.disk.usedPercent}%)` : '...'}
              </span>
            </div>
            <div style={{ width: '100%', height: '8px', background: 'var(--border-glass)', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{
                width: `${health ? health.disk.usedPercent : 0}%`, height: '100%',
                background: health && health.disk.usedPercent > 90 ? 'var(--danger)'
                  : health && health.disk.usedPercent > 70 ? '#f59e0b'
                  : 'var(--success)',
                borderRadius: '4px', transition: 'width 0.5s ease',
              }} />
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', marginBottom: '20px' }}>
        <div className="glass-panel" style={{ padding: '20px' }}>
          <h3 style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Smartphone size={18} /> Client Protocols
          </h3>
          {(() => {
            const rows: Array<{ key: ProtocolKey; label: string; icon: LucideIcon | React.ComponentType<{ size?: number; style?: React.CSSProperties }> }> = [
              { key: 'activeSync', label: 'ActiveSync / Exchange', icon: Smartphone },
              { key: 'imap', label: 'IMAP Retrieval', icon: Server },
              { key: 'smtp', label: 'SMTP Submission', icon: MailIcon as any },
              { key: 'caldav', label: 'CalDAV Calendars', icon: Globe },
              { key: 'carddav', label: 'CardDAV Contacts', icon: Globe },
            ];
            const protocolDetail = (protocol: ProtocolHealth | undefined, key: ProtocolKey) => {
              if (!protocol) return 'Loading...';
              if (!protocol.ok) return protocol.lastError || (protocol.status ? `HTTP ${protocol.status}` : 'Probe failed');
              const base = protocol.status
                ? `HTTP ${protocol.status}`
                : protocol.greeting
                  ? 'Greeting OK'
                  : 'Ready';
              const version = key === 'activeSync' && protocol.protocolVersions ? ` · ${protocol.protocolVersions}` : '';
              return `${base} · ${protocol.latencyMs ?? '-'}ms${version}`;
            };
            const isHealthy = (protocol: ProtocolHealth | undefined) => Boolean(protocol?.ok && (protocol.recentErrors ?? 0) === 0);
            const anyDegraded = health ? rows.some(row => !isHealthy(health.protocols?.[row.key])) : false;
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {rows.map(row => {
                  const protocol = health?.protocols?.[row.key];
                  const healthy = isHealthy(protocol);
                  const Icon = row.icon;
                  return (
                    <div key={row.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
                          <Icon size={16} style={{ color: healthy ? 'var(--success)' : 'var(--danger)' }} />
                          {row.label}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                          {protocolDetail(protocol, row.key)}
                        </div>
                        {protocol && protocol.recentErrors !== undefined && (
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '3px' }}>
                            {protocol.recentErrors ?? '-'} server errors in {protocol.recentErrorWindowMinutes || 15}m
                          </div>
                        )}
                      </div>
                      <span style={{
                        fontSize: '0.75rem', fontWeight: 600, padding: '2px 10px', borderRadius: '12px',
                        background: healthy ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        color: healthy ? 'var(--success)' : 'var(--danger)',
                        whiteSpace: 'nowrap',
                      }}>
                        {healthy ? 'Ready' : 'Degraded'}
                      </span>
                    </div>
                  );
                })}
                {anyDegraded && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'var(--danger)' }}>
                    <AlertTriangle size={14} />
                    One or more client protocols are degraded; mail apps or sync clients may fail until this recovers.
                  </div>
                )}
                <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                  <button className="btn btn-secondary" onClick={fetchHealth} disabled={refreshing}>
                    <RefreshCw size={16} className={refreshing ? 'spin' : ''} /> Refresh
                  </button>
                  <button
                    className={anyDegraded ? 'btn btn-primary' : 'btn btn-secondary'}
                    onClick={() => handleRemediate('restart-openmailstack')}
                    disabled={remediating === 'restart-openmailstack'}
                  >
                    <RefreshCw size={16} className={remediating === 'restart-openmailstack' ? 'spin' : ''} />
                    {remediating === 'restart-openmailstack' ? 'Scheduling...' : 'Restart Backend'}
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Quick Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px' }}>
        <div className="glass-panel" style={{ padding: '16px', textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
            <Database size={16} style={{ color: 'var(--accent-primary)' }} />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Mail Queue</span>
          </div>
          <span style={{ fontSize: '1.5rem', fontWeight: 700, fontFamily: 'monospace' }}>
            {health ? health.mailQueue : '-'}
          </span>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>Messages</div>
        </div>
        <div className="glass-panel" style={{ padding: '16px', textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
            <Globe size={16} style={{ color: '#3b82f6' }} />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>IMAP</span>
          </div>
          <span style={{ fontSize: '1.5rem', fontWeight: 700, fontFamily: 'monospace' }}>
            {health ? health.connections.imap : '-'}
          </span>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>Connections</div>
        </div>
        <div className="glass-panel" style={{ padding: '16px', textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
            <Globe size={16} style={{ color: '#ef4444' }} />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>SMTP</span>
          </div>
          <span style={{ fontSize: '1.5rem', fontWeight: 700, fontFamily: 'monospace' }}>
            {health ? health.connections.smtp : '-'}
          </span>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>Connections</div>
        </div>
        <div className="glass-panel" style={{ padding: '16px', textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
            <HardDrive size={16} style={{ color: 'var(--success)' }} />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>HTTP</span>
          </div>
          <span style={{ fontSize: '1.5rem', fontWeight: 700, fontFamily: 'monospace' }}>
            {health ? health.connections.http : '-'}
          </span>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>Connections</div>
        </div>
      </div>
    </div>
  );
}
