import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ConfirmDialog } from '../shared/components/ConfirmDialog';
import { UnsavedChangesGuard } from '../shared/components/UnsavedChangesGuard';
import '../workflow-status.css';

type Options = { junk: number; trash: number };
type Preview = { token: string; options: Options; folders: { kind: string; path: string; total: number; eligible: number }[] };
type History = { id: string; state: string; moved: number; deleted: number; junk_days: number | null; trash_days: number | null; created_at: string };
type Policy = { enabled: boolean; options: Options; status: string; nextRun?: string; lastRun?: string; history: History[] };
async function request(path = '', body?: unknown) {
  const response = await fetch(`/api/retention${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(result.error || 'Cleanup is unavailable. Refresh before retrying.');
  return result;
}
const formatTime = (value?: string) => value ? new Date(value).toLocaleString() : 'Not yet';
export function MailCleanupPane() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [options, setOptions] = useState<Options>({ junk: 0, trash: 0 });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const refresh = async () => {
    const next: Policy = await request();
    setPolicy(next);
    setOptions({ junk: next.options.junk || 0, trash: next.options.trash || 0 });
  };
  useEffect(() => {
    let live = true;
    void request().then((next: Policy) => { if (live) { setPolicy(next); setOptions({ junk: next.options.junk || 0, trash: next.options.trash || 0 }); } }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);
  const perform = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message : 'The request did not finish. Refresh its status before retrying.'); }
    finally { lock.current = false; setBusy(false); }
  };
  const dirty = Boolean(policy && (options.junk !== (policy.options.junk || 0) || options.trash !== (policy.options.trash || 0)));
  return <section className="settings-page cleanup-page">
    <UnsavedChangesGuard dirty={dirty || busy} locked={busy} />
    <h2>Junk & Trash cleanup</h2>
    <p>Choose how long messages stay before cleanup. Automatic cleanup is off until you review and enable a schedule.</p>
    <p>Age starts when cleanup first observes a message in its folder. Existing mail gets a full grace period. Junk moves to Trash; Trash deletion is permanent. Moving Junk starts a fresh Trash grace period.</p>
    <p>Runs hourly while the server can access your mailbox, up to 10,000 messages per folder. Turning cleanup off stops after the current batch. Enabling it again starts a new grace period.</p>
    <div role="status" className="workflow-status">
      <strong>{policy?.enabled ? 'Automatic cleanup is on' : policy ? 'Automatic cleanup is off' : 'Loading cleanup settings…'}</strong>
      {policy && <p>{policy.status === 'needs_review' ? 'Cleanup stopped after an interrupted or uncertain operation. Review your folders before enabling again.' : policy.status === 'waiting' ? 'Waiting for mailbox access. Sign in again if needed; checks retry hourly.' : `Last check: ${formatTime(policy.lastRun)}. Next check: ${formatTime(policy.nextRun)}.`}</p>}
    </div>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <fieldset disabled={busy || !policy} className="cleanup-options">
      <legend>Retention periods</legend>
      {(['junk', 'trash'] as const).map(kind => <label key={kind}>
        <span>{kind === 'junk' ? 'Move Junk to Trash after' : 'Permanently delete Trash after'}</span>
        <select className="glass-input" aria-label={`${kind === 'junk' ? 'Junk' : 'Trash'} retention`} value={options[kind]} onChange={event => { setOptions(current => ({ ...current, [kind]: Number(event.target.value) })); setPreview(null); }}>
          <option value={0}>Off</option>{[1, 7, 14, 30, 60, 90, 180, 365].map(days => <option key={days} value={days}>{days} days</option>)}
        </select>
      </label>)}
    </fieldset>
    <div className="workflow-actions">
      <button className="btn btn-primary" disabled={busy || !policy || (!options.junk && !options.trash)} onClick={() => void perform(async () => setPreview(await request('/preview', { options })))}>Preview schedule</button>
      {policy?.enabled && <button className="btn btn-ghost" disabled={busy} onClick={() => void perform(async () => { await request('/disable', {}); setPreview(null); await refresh(); setNotice('Cleanup is off. A batch already in progress may finish.'); })}>Turn cleanup off</button>}
      <button className="btn btn-ghost" disabled={busy || dirty} onClick={() => void perform(refresh)}>Refresh status</button>
      <Link to="/activity">View activity & health</Link>
    </div>
    {preview && <div className="workflow-status">
      <h3>Review this schedule</h3>
      <ul>{preview.folders.map(folder => <li key={folder.kind}><strong>{folder.path}</strong>: {folder.total.toLocaleString()} messages now; {policy?.enabled ? folder.eligible.toLocaleString() : '0'} eligible under the {preview.options[folder.kind as keyof Options]}-day period. {folder.kind === 'trash' ? 'Eligible messages will be permanently deleted.' : 'Eligible messages will move to Trash.'}</li>)}</ul>
      <p>New arrivals are evaluated in later runs. The first check starts in about one hour. Counts can change before it runs.</p>
      <button className="btn btn-primary" disabled={busy} onClick={() => setConfirming(true)}>Enable this schedule…</button>
    </div>}
    <h3>Cleanup history</h3>
    <p>Last 50 entries, retained for 90 days. Counts show confirmed operations; an uncertain batch may have processed additional messages.</p>
    {policy?.history.length === 0 && <p>No cleanup runs yet.</p>}
    <ul className="workflow-history">{policy?.history.map(run => <li key={run.id}><strong>{run.state.replaceAll('_', ' ')}</strong> · {formatTime(run.created_at)}<br />{run.moved} moved to Trash · {run.deleted} permanently deleted{run.junk_days != null && <p>Junk: {run.junk_days ? `${run.junk_days} days` : 'off'} · Trash: {run.trash_days ? `${run.trash_days} days` : 'off'}</p>}</li>)}</ul>
    <ConfirmDialog open={confirming} busy={busy} danger={Boolean(preview?.options.trash)} title="Enable automatic cleanup?" message={`Junk: ${preview?.options.junk ? `move to Trash after ${preview.options.junk} days` : 'off'}. Trash: ${preview?.options.trash ? `permanently delete after ${preview.options.trash} days` : 'off'}. You can stop future batches in these settings. Permanent deletion cannot be undone. ${error}`} confirmLabel="Enable schedule" onCancel={() => setConfirming(false)} onConfirm={() => void perform(async () => { await request('/enable', { token: preview?.token, confirm: true }); setConfirming(false); setPreview(null); await refresh(); setNotice('Cleanup schedule enabled.'); })} />
  </section>;
}
