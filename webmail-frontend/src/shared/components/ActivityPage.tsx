import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import '../../workflow-status.css';

interface Item { id: string; area: string; action: string; state: string; recoveryPath: string; createdAt: string }
interface Health { area: string; path: string; detail: string; state: string; checkedAt: string; latencyMs: number; syncState?: string; syncDetail?: string; lastSyncAt?: string | null }
const stateLabels: Record<string, string> = { pending: 'In progress', accepted: 'Accepted — check progress', completed: 'Request completed', failed: 'Needs attention', uncertain: 'Outcome needs checking' };
async function request(path: string) {
  const response = await fetch(`/api/activity${path}`);
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || 'This view is unavailable. Try again.');
  return data;
}
export function ActivityPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [health, setHealth] = useState<Health[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [healthError, setHealthError] = useState('');
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(true);
  const [filter, setFilter] = useState('all');
  const historyLock = useRef(false);
  const healthLock = useRef(false);
  const refreshHistory = async () => {
    if (historyLock.current) return;
    historyLock.current = true; setLoading(true); setHistoryError('');
    try { setItems((await request('')).items); }
    catch (e) { setHistoryError(e instanceof Error ? e.message : 'Activity unavailable.'); }
    finally { setLoading(false); historyLock.current = false; }
  };
  const refreshHealth = async () => {
    if (healthLock.current) return;
    healthLock.current = true; setChecking(true); setHealthError('');
    try { setHealth((await request('/health')).checks); }
    catch (e) { setHealthError(e instanceof Error ? e.message : 'Health checks unavailable.'); }
    finally { setChecking(false); healthLock.current = false; }
  };
  useEffect(() => {
    let live = true;
    void request('').then(data => { if (live) setItems(data.items); }).catch(e => { if (live) setHistoryError(e.message); }).finally(() => { if (live) setLoading(false); });
    void request('/health').then(data => { if (live) setHealth(data.checks); }).catch(e => { if (live) setHealthError(e.message); }).finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
  }, []);
  const visible = items.filter(item => filter === 'all' || (filter === 'attention' ? ['failed', 'uncertain'].includes(item.state) : item.area === filter));
  return <div className="activity-page">
    <header className="workflow-heading"><div><h1>Activity & health</h1><p>Check what happened and return to the right place to recover.</p></div><Link to="/sync">Set up devices</Link></header>
    <section aria-labelledby="health-heading">
      <div className="workflow-heading"><h2 id="health-heading">App health</h2><button className="btn btn-ghost" disabled={checking} onClick={() => void refreshHealth()}>{checking ? 'Checking…' : 'Check again'}</button></div>
      <p>These are point-in-time server checks, not proof that a phone or other device has synchronized. Open an app to review its sync details or retry a failed workflow.</p>
      {healthError && <p role="alert">{healthError} Previous results may be stale.</p>}
      <div aria-busy={checking} className="health-grid">{health.map(check => <article key={check.area} className="workflow-status"><h3>{check.area}</h3><p>{check.detail}</p><small>Checked {new Date(check.checkedAt).toLocaleString()} · {check.latencyMs} ms</small><p><strong>Sync: {check.syncState || 'unknown'}</strong><br />{check.syncDetail || 'No synchronization observation is available.'}{check.lastSyncAt && <><br />Last observation: {new Date(check.lastSyncAt).toLocaleString()}</>}</p><p><Link to={check.path}>Open {check.area}</Link></p></article>)}</div>
      <p><Link to="/settings/mail_cleanup">Junk & Trash schedules</Link> · <Link to="/settings/mail_import">Import progress</Link> · <Link to="/mail/Scheduled">Delivery recovery</Link></p>
    </section>
    <section aria-labelledby="history-heading">
      <div className="workflow-heading"><h2 id="history-heading">Recent actions</h2><button className="btn btn-ghost" disabled={loading} onClick={() => void refreshHistory()}>{loading ? 'Refreshing…' : 'Refresh activity'}</button></div>
      <p>Your last 100 recorded web actions from 30 days. Request completion does not guarantee delivery or device sync. Message content and error details are not stored here. Device actions and earlier history are not included.</p>
      <label>Show <select className="glass-input" aria-label="Activity filter" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All actions</option><option value="attention">Needs attention</option>{['Mail', 'Calendar', 'Contacts', 'Notes', 'Scheduler', 'Settings'].map(area => <option key={area}>{area}</option>)}</select></label>
      {historyError && <p role="alert">{historyError}</p>}
      {!loading && !historyError && !visible.length && <p role="status">No recorded actions match this view.</p>}
      <ul className="workflow-history" aria-busy={loading}>{visible.map(item => <li key={item.id}><div className="workflow-heading"><strong>{item.area} · {item.action}</strong><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time></div><p>{stateLabels[item.state] || 'Outcome needs checking'}</p>{['failed', 'uncertain', 'accepted', 'pending'].includes(item.state) && <><p>Check the current state before trying again. This view does not repeat the action.</p><Link to={item.recoveryPath}>Review in {item.area}</Link></>}</li>)}</ul>
    </section>
  </div>;
}
