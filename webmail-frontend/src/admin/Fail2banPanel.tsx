import { useEffect, useState, useCallback } from 'react';
import { Shield, ShieldOff, RefreshCw, Unlock, AlertTriangle } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface JailInfo {
  name: string;
  enabled: boolean;
  currentlyFailed: number;
  totalFailed: number;
  currentlyBanned: number;
  bannedIPs: string[];
}

interface Fail2banStatus {
  success: boolean;
  installed: boolean;
  jails: JailInfo[];
}

const JAIL_COLORS: Record<string, string> = {
  sshd: '#3b82f6',
  postfix: '#f59e0b',
  dovecot: '#10b981',
  'openmailstack-webmail': '#f43f5e',
};

export function Fail2banPanel() {
  const [status, setStatus] = useState<Fail2banStatus | null>(null);
  const [error, setError] = useState('');
  const [banHistory, setBanHistory] = useState<any[]>([]);
  const [unbanning, setUnbanning] = useState<string | null>(null);
  const [confirmUnban, setConfirmUnban] = useState<{ jail: string; ip: string } | null>(null);

  // Fetch jail status from REST endpoint
  const fetchStatus = useCallback(() => {
    fetch('/api/admin/telemetry/fail2ban/status')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setStatus(data);
          setError('');
        } else {
          setError(data.error || 'Failed to load fail2ban status');
        }
      })
      .catch(err => setError(err.message || 'Connection error'));
  }, []);

  // Poll Prometheus metrics for ban history
  useEffect(() => {
    const fetchMetrics = () => {
      fetch('/api/admin/telemetry/metrics')
        .then(res => res.text())
        .then(text => {
          const lines = text.split('\n');
          const point: any = {
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          };
          lines.forEach(line => {
            if (line.startsWith('#') || !line.trim()) return;
            // Match: openmailstack_fail2ban_banned_total{jail="sshd"} 5
            const match = line.match(/^openmailstack_fail2ban_banned_total\{jail="([^"]+)"\}\s+([\d.]+)/);
            if (match) {
              point[match[1]] = parseFloat(match[2]);
            }
          });
          setBanHistory(prev => [...prev.slice(-30), point]);
        })
        .catch(() => {});
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, 2000);
    return () => clearInterval(interval);
  }, []);

  // Fetch jail status on mount and every 10s
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleUnban = async (jail: string, ip: string) => {
    setUnbanning(ip);
    setConfirmUnban(null);
    try {
      const res = await fetch('/api/admin/telemetry/fail2ban/unban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jail, ip }),
      });
      const data = await res.json();
      if (data.success) {
        fetchStatus(); // Refresh the jail data
      } else {
        setError(data.error || 'Failed to unban IP');
      }
    } catch (err: any) {
      setError(err.message || 'Connection error');
    } finally {
      setUnbanning(null);
    }
  };

  // Not installed state
  if (status && !status.installed) {
    return (
      <div className="glass-panel" style={{ padding: '30px' }}>
        <div className="content-header" style={{ marginBottom: '20px' }}>
          <h2>Intrusion Detection (Fail2ban)</h2>
        </div>
        <div className="empty-state" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <ShieldOff size={48} style={{ color: 'var(--text-secondary)', marginBottom: '16px' }} />
          <h3 style={{ marginBottom: '8px', color: 'var(--text-primary)' }}>Fail2ban Not Installed</h3>
          <p style={{ color: 'var(--text-secondary)', maxWidth: '500px', margin: '0 auto' }}>
            Fail2ban is not detected on this server. Install it to enable automatic intrusion prevention
            for SSH, Postfix, and Dovecot services. Run <code style={{ background: 'var(--bg-glass)', padding: '2px 6px', borderRadius: '4px' }}>apt install fail2ban</code> or <code style={{ background: 'var(--bg-glass)', padding: '2px 6px', borderRadius: '4px' }}>dnf install fail2ban</code>.
          </p>
        </div>
      </div>
    );
  }

  const jailNames = status ? status.jails.map(j => j.name) : [];

  return (
    <div className="glass-panel" style={{ padding: '30px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="content-header" style={{ marginBottom: '20px' }}>
        <div>
          <h2>Intrusion Detection (Fail2ban)</h2>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {error && (
            <span style={{ fontSize: '0.8rem', color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <AlertTriangle size={14} /> {error}
            </span>
          )}
          <button className="btn btn-ghost" onClick={fetchStatus} title="Refresh">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto', paddingRight: '8px' }}>
        {/* Ban History Chart */}
        <div className="settings-section">
          <h3 style={{ marginBottom: '16px' }}>Banned IPs Over Time</h3>
          <div style={{ height: '200px', width: '100%' }}>
            {jailNames.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={banHistory}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="time" stroke="#888" tick={{ fontSize: 12 }} />
                  <YAxis stroke="#888" tick={{ fontSize: 12 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }} />
                  {jailNames.map(jail => (
                    <Line
                      key={jail}
                      type="monotone"
                      dataKey={jail}
                      name={jail}
                      stroke={JAIL_COLORS[jail] || '#888'}
                      strokeWidth={2}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                {status ? 'No jails configured' : 'Loading...'}
              </div>
            )}
          </div>
        </div>

        {/* Jail Cards */}
        {status && status.jails.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: '16px' }}>
            {status.jails.map(jail => (
              <div key={jail.name} className="glass-panel" style={{ padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h4 style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Shield size={16} style={{ color: jail.enabled ? 'var(--success)' : 'var(--text-secondary)' }} />
                    {jail.name}
                  </h4>
                  <span style={{
                    fontSize: '0.7rem', fontWeight: 600, padding: '2px 8px', borderRadius: '10px',
                    background: jail.enabled ? 'rgba(16, 185, 129, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                    color: jail.enabled ? 'var(--success)' : 'var(--text-secondary)',
                  }}>
                    {jail.enabled ? 'ENABLED' : 'DISABLED'}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' }}>
                  <div className="glass-panel" style={{ padding: '12px', textAlign: 'center', background: 'var(--bg-dark)' }}>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, fontFamily: 'monospace', color: '#f59e0b' }}>
                      {jail.currentlyFailed}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '2px' }}>Current Failed</div>
                  </div>
                  <div className="glass-panel" style={{ padding: '12px', textAlign: 'center', background: 'var(--bg-dark)' }}>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, fontFamily: 'monospace', color: 'var(--danger)' }}>
                      {jail.totalFailed}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '2px' }}>Total Failed</div>
                  </div>
                  <div className="glass-panel" style={{ padding: '12px', textAlign: 'center', background: 'var(--bg-dark)' }}>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, fontFamily: 'monospace', color: 'var(--danger)' }}>
                      {jail.currentlyBanned}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '2px' }}>Banned Now</div>
                  </div>
                </div>

                {/* Banned IPs */}
                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    Banned IPs {jail.bannedIPs.length > 0 ? `(${jail.bannedIPs.length})` : ''}
                  </div>
                  {jail.bannedIPs.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {jail.bannedIPs.map(ip => (
                        <div key={ip} style={{
                          display: 'flex', alignItems: 'center', gap: '6px',
                          background: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.25)',
                          padding: '4px 8px 4px 12px', borderRadius: '6px',
                          fontSize: '0.8rem', fontFamily: 'monospace',
                        }}>
                          {ip}
                          {confirmUnban?.jail === jail.name && confirmUnban?.ip === ip ? (
                            <>
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Confirm?</span>
                              <button
                                className="btn btn-danger"
                                style={{ fontSize: '0.65rem', padding: '2px 6px' }}
                                onClick={() => handleUnban(jail.name, ip)}
                                disabled={unbanning === ip}
                              >
                                {unbanning === ip ? '...' : 'Yes'}
                              </button>
                              <button
                                className="btn btn-ghost"
                                style={{ fontSize: '0.65rem', padding: '2px 6px' }}
                                onClick={() => setConfirmUnban(null)}
                              >
                                No
                              </button>
                            </>
                          ) : (
                            <button
                              className="btn btn-ghost"
                              style={{ fontSize: '0.65rem', padding: '2px 4px', color: 'var(--text-secondary)' }}
                              onClick={() => setConfirmUnban({ jail: jail.name, ip })}
                              disabled={unbanning === ip}
                              title="Unban this IP"
                            >
                              <Unlock size={12} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                      No IPs currently banned
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {status && status.jails.length === 0 && !error && (
          <div className="empty-state" style={{ textAlign: 'center', padding: '40px 20px' }}>
            <Shield size={36} style={{ color: 'var(--success)', marginBottom: '12px' }} />
            <h3 style={{ marginBottom: '4px', color: 'var(--text-primary)' }}>No Banned IPs</h3>
            <p style={{ color: 'var(--text-secondary)' }}>All services are operating normally with no active bans.</p>
          </div>
        )}

        {!status && !error && (
          <div className="empty-state" style={{ textAlign: 'center', padding: '40px 20px' }}>
            <p style={{ color: 'var(--text-secondary)' }}>Loading fail2ban status...</p>
          </div>
        )}
      </div>
    </div>
  );
}
