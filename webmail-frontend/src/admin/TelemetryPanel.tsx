import { useEffect, useRef, useState } from 'react';
import { Activity, Download, TerminalSquare } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

export function TelemetryPanel() {
  const [logs, setLogs] = useState<string[]>([]);
  const [activeView, setActiveView] = useState<'logs' | 'metrics'>('logs');
  const [history, setHistory] = useState<any[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeView === 'metrics') {
      const fetchMetrics = () => {
        fetch('/api/admin/telemetry/metrics')
          .then(res => res.text())
          .then(text => {
             const lines = text.split('\n');
             const point: any = { time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) };
             lines.forEach(line => {
               if (line.startsWith('#') || !line.trim()) return;
               const [key, val] = line.split(' ');
               if (key.includes('process_cpu_user_seconds_total')) point.cpu = parseFloat(val);
               if (key.includes('nodejs_heap_space_size_used_bytes{space="new"}')) point.memory = parseFloat(val) / (1024 * 1024);
               else if (key.includes('nodejs_heap_size_used_bytes') && !point.memory) point.memory = parseFloat(val) / (1024 * 1024);
               if (key.includes('nodejs_eventloop_lag_seconds')) point.lag = parseFloat(val) * 1000;
               if (key.startsWith('openmailstack_api_requests_total')) {
                 point.requests = (point.requests || 0) + parseFloat(val);
               }
               if (key.startsWith('openmailstack_mail_queue_size')) point.mailQueue = parseFloat(val);
               if (key.startsWith('openmailstack_network_connections_imap')) point.imap = parseFloat(val);
               if (key.startsWith('openmailstack_network_connections_smtp')) point.smtp = parseFloat(val);
               if (key.startsWith('openmailstack_network_connections_http')) point.http = parseFloat(val);
               if (key.startsWith('openmailstack_rspamd_scanned_total')) point.rspamdScanned = parseFloat(val);
               if (key.startsWith('openmailstack_rspamd_spam_total')) point.rspamdSpam = parseFloat(val);
               if (key.startsWith('openmailstack_rspamd_rejected_total')) point.rspamdRejected = parseFloat(val);
             });
             setHistory(prev => [...prev.slice(-30), point]);
          })
          .catch(console.error);
      };
      
      fetchMetrics();
      const interval = setInterval(fetchMetrics, 2000);
      return () => clearInterval(interval);
    }

    // SSE connection for live logs
    const eventSource = new EventSource('/api/admin/telemetry/logs/live');
    
    eventSource.onmessage = (event) => {
      setLogs(prev => {
        const newLogs = [...prev, event.data];
        return newLogs.slice(-1000);
      });
    };

    eventSource.onerror = (err) => {
      console.error('SSE Error:', err);
      // Wait for it to reconnect automatically
    };

    return () => {
      eventSource.close();
    };
  }, [activeView]);

  useEffect(() => {
    if (activeView === 'logs' && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, activeView]);

  return (
    <div className="glass-panel" style={{ padding: '30px', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="content-header" style={{ marginBottom: '20px' }}>
        <div>
          <h2>Telemetry & Logs</h2>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            className={`btn ${activeView === 'logs' ? 'btn-primary' : 'btn-secondary'}`} 
            onClick={() => setActiveView('logs')}
          >
            <TerminalSquare size={16} /> Live Logs
          </button>
          <button 
            className={`btn ${activeView === 'metrics' ? 'btn-primary' : 'btn-secondary'}`} 
            onClick={() => setActiveView('metrics')}
          >
            <Activity size={16} /> Prometheus Metrics
          </button>
        </div>
      </div>

      {activeView === 'logs' ? (
        <div style={{
          background: '#0d1117',
          color: '#00ff00',
          padding: '16px',
          borderRadius: '8px',
          fontFamily: 'monospace',
          fontSize: '0.9rem',
          flex: 1,
          overflowY: 'auto',
          boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.5)',
          border: '1px solid rgba(255,255,255,0.1)'
        }}>
          {logs.length === 0 && <div style={{ color: '#888' }}>Waiting for log data...</div>}
          {logs.map((log, i) => (
            <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', marginBottom: '2px' }}>
              {log}
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px', overflowY: 'auto', paddingRight: '8px' }}>
          
          <div className="settings-section">
            <h3 style={{ marginBottom: '16px' }}>System Memory (Heap Used MB)</h3>
            <div style={{ height: '200px', width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history}>
                  <defs>
                    <linearGradient id="colorMem" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="time" stroke="#888" tick={{fontSize: 12}} />
                  <YAxis stroke="#888" tick={{fontSize: 12}} />
                  <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }} />
                  <Area type="monotone" dataKey="memory" stroke="#3b82f6" fillOpacity={1} fill="url(#colorMem)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="settings-section">
            <h3 style={{ marginBottom: '16px' }}>Event Loop Lag (ms)</h3>
            <div style={{ height: '200px', width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history}>
                  <defs>
                    <linearGradient id="colorLag" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="time" stroke="#888" tick={{fontSize: 12}} />
                  <YAxis stroke="#888" tick={{fontSize: 12}} />
                  <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }} />
                  <Area type="monotone" dataKey="lag" stroke="#ef4444" fillOpacity={1} fill="url(#colorLag)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="settings-section">
            <h3 style={{ marginBottom: '16px' }}>Total API Requests (Counter)</h3>
            <div style={{ height: '200px', width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="time" stroke="#888" tick={{fontSize: 12}} />
                  <YAxis stroke="#888" tick={{fontSize: 12}} />
                  <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }} />
                  <Line type="stepAfter" dataKey="requests" stroke="#10b981" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="settings-section">
            <h3 style={{ marginBottom: '16px' }}>Network Connections</h3>
            <div style={{ height: '200px', width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="time" stroke="#888" tick={{fontSize: 12}} />
                  <YAxis stroke="#888" tick={{fontSize: 12}} />
                  <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }} />
                  <Line type="monotone" dataKey="imap" name="IMAP" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="smtp" name="SMTP" stroke="#ef4444" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="http" name="HTTP" stroke="#10b981" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="settings-section">
            <h3 style={{ marginBottom: '16px' }}>Mail Delivery Queue (Postfix)</h3>
            <div style={{ height: '200px', width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history}>
                  <defs>
                    <linearGradient id="colorQueue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="time" stroke="#888" tick={{fontSize: 12}} />
                  <YAxis stroke="#888" tick={{fontSize: 12}} />
                  <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }} />
                  <Area type="step" dataKey="mailQueue" name="Messages" stroke="#f59e0b" fillOpacity={1} fill="url(#colorQueue)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="settings-section">
            <h3 style={{ marginBottom: '16px' }}>Anti-Spam Scans (Rspamd)</h3>
            <div style={{ height: '200px', width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis dataKey="time" stroke="#888" tick={{fontSize: 12}} />
                  <YAxis stroke="#888" tick={{fontSize: 12}} />
                  <Tooltip contentStyle={{ backgroundColor: '#1f2937', border: 'none', borderRadius: '8px' }} />
                  <Line type="monotone" dataKey="rspamdScanned" name="Total Scanned" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="rspamdSpam" name="Spam Detected" stroke="#ef4444" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="rspamdRejected" name="Rejected" stroke="#f43f5e" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'auto' }}>
            <a 
              href="/api/admin/telemetry/metrics" 
              target="_blank" 
              rel="noreferrer" 
              className="btn btn-secondary"
            >
              <Download size={16} /> View Raw Prometheus Endpoint
            </a>
          </div>

        </div>
      )}
    </div>
  );
}
