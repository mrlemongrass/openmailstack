import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { MailFolder } from '../shared/types';
import { useActionConfirmation } from '../shared/components/ActionConfirmation';
import { UnsavedChangesGuard } from '../shared/components/UnsavedChangesGuard';
interface ImportJob { id: string; sourceName: string; folder: string; total: number; cursor: number; imported: number; skipped: number; state: string; staged?: boolean; error?: string; samples: string[] }
async function request(path = '', init?: RequestInit) {
  const response = await fetch(`/api/mail-import${path}`, init);
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || 'Import service unavailable. Check progress before retrying.');
  return data;
}
const json = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export function MailImportPane({ folders }: { folders: MailFolder[] }) {
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const lock = useRef(false);
  const stopped = useRef(false);
  const confirmation = useActionConfirmation();
  const refresh = async () => { const data = await request(); setJobs(data.jobs); };
  useEffect(() => {
    stopped.current = false;
    void request().then(data => setJobs(data.jobs)).catch(err => setError(String(err.message))).finally(() => setLoading(false));
    return () => { stopped.current = true; };
  }, []);
  const update = (job: ImportJob) => setJobs(current => [job, ...current.filter(item => item.id !== job.id)]);
  const prepare = async () => {
    if (lock.current || !file || !folder) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const body = new FormData(); body.append('file', file); body.append('folder', folder);
      update((await request('', { method: 'POST', body })).job);
      setFile(null);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not prepare import.'); }
    finally { lock.current = false; setBusy(false); }
  };
  const run = async (initial: ImportJob, confirmMissing = false) => {
    if (lock.current) return;
    lock.current = true; stopped.current = false; setBusy(true); setError('');
    let job = initial;
    try {
      while (!stopped.current && !['complete', 'cancelled'].includes(job.state)) {
        job = (await request(`/${job.id}/run`, json({ confirm: true, cursor: job.cursor, confirmMissing }))).job;
        confirmMissing = false; update(job);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import paused. Check progress before retrying.');
      await refresh().catch(() => undefined);
    } finally { lock.current = false; setBusy(false); }
  };
  return <section className="settings-page">
    <UnsavedChangesGuard dirty={busy} locked={busy} />
    <h2>Import mail</h2>
    <p>Bring an EML message or standard MBOX export into one existing folder. Review the destination before importing. Repeat for other folders.</p>
    <p>Message bodies, attachments, headers and valid message dates transfer. Imported messages are marked read. Provider labels, folder structure, stars, rules, contacts, calendars and account settings do not transfer in this mail import.</p>
    <p>Each file: up to 50 MiB and 1,000 messages; each message: up to 20 MiB. Up to 25 staged imports and 100 MiB per account. Identical message bytes are skipped within the same destination mailbox across imports made here.</p>
    <p><Link style={{ color: 'var(--accent-primary)' }} to="/contacts">Import contacts in Contacts</Link> · <Link style={{ color: 'var(--accent-primary)' }} to="/calendar">Import calendars in Calendar</Link> · <Link style={{ color: 'var(--accent-primary)' }} to="/settings/sync_devices">Set up devices</Link></p>
    <fieldset disabled={busy || confirmation.busy} style={{ border: 0, padding: 0, display: 'grid', gap: 12 }}>
      <label>Mail export <input aria-label="Mail export" type="file" accept=".eml,.mbox" onChange={event => setFile(event.target.files?.[0] || null)} /></label>
      <label>Destination folder <select className="glass-input" aria-label="Import destination folder" value={folder} onChange={event => setFolder(event.target.value)}>
        <option value="">Choose a folder</option>{folders.map(item => <option key={item.path} value={item.path}>{item.path}</option>)}
      </select></label>
      <button className="btn btn-primary" disabled={!file || !folder} onClick={() => void prepare()}>Prepare and review import</button>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    {busy && <div role="status"><p>Working in batches of up to 10 messages…</p><button className="btn btn-secondary" onClick={() => { stopped.current = true; }}>Pause after this batch</button></div>}
    <h3>Import history</h3>
    <button className="btn btn-ghost" disabled={busy} onClick={() => { setError(''); void refresh().catch(err => setError(err.message)); }}>Refresh progress</button>
    {loading ? <p role="status">Loading import history…</p> : jobs.length === 0 && <p>No imports yet.</p>}
    {jobs.map(job => <article key={job.id} style={{ border: '1px solid var(--border-color)', padding: 16, marginTop: 12, borderRadius: 12 }}>
      <h4>{job.sourceName} → {job.folder}</h4>
      <p role="status">{job.cursor} of {job.total} checked · {job.imported} imported · {job.skipped} duplicates skipped · {job.state}</p>
      {job.cursor === 0 && <><p>First messages in this export:</p><ul>{job.samples.map((subject, index) => <li key={index}>{subject}</li>)}</ul></>}
      {job.error && <p role="alert">{job.error}</p>}
      {job.state === 'complete' && job.staged && <p role="status">Messages are imported; source cleanup is still pending.</p>}
      {(!['complete', 'cancelled'].includes(job.state) || job.staged) && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {! ['complete', 'cancelled'].includes(job.state) && <button className="btn btn-primary" disabled={busy} onClick={() => confirmation.ask({ title: 'Import into this folder?', message: `Import ${job.total - job.cursor} remaining messages into ${job.folder}. You can pause between batches and resume from this history.`, label: job.cursor ? 'Resume import' : 'Start import', danger: false, run: async () => { void run(job); } })}>{job.state === 'uncertain' ? 'Reconcile and resume' : job.cursor ? 'Resume import' : 'Start import'}</button>}
        {job.state === 'uncertain' && <button className="btn btn-secondary" disabled={busy} onClick={() => confirmation.ask({ title: 'Retry the uncertain message?', message: `First check ${job.folder}. If the previous append succeeded but its marker cannot be found, retrying can create a duplicate. Continue only after verifying the message is missing.`, label: 'I checked; retry missing message', run: async () => { void run(job, true); } })}>I checked the destination</button>}
        <button className="btn btn-ghost" disabled={busy} onClick={() => confirmation.ask({ title: 'Remove staged import?', message: `Remove the staged source for ${job.sourceName}. Messages already imported stay in ${job.folder}.`, label: 'Remove staged source', run: async () => { await request(`/${job.id}`, json({ confirm: true }, 'DELETE')); await refresh(); } })}>Remove staged source</button>
      </div>}
    </article>)}
    {confirmation.dialog}
  </section>;
}
