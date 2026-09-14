import { PolicyDraftContext } from './policy-draft-context';
import { useContext, useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '../shared/components/ConfirmDialog';

interface Entry { kind: 'sender' | 'domain'; value: string; disposition: 'block' | 'safe' }
interface Legacy { original: string; entry: Entry | null }
const keyOf = (entry: Entry) => `${entry.disposition}:${entry.kind}:${entry.value}`;

export function JunkList() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [legacy, setLegacy] = useState<Legacy[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const mutation = useRef(false);
  const request = useRef(0);
  const [value, setValue] = useState('');
  const [kind, setKind] = useState<Entry['kind']>('sender');
  const [disposition, setDisposition] = useState<Entry['disposition']>('block');
  const [review, setReview] = useState<{ method: string; body: unknown; message: string; clearInput?: boolean } | null>(null);
  const { setState, routeBlocked } = useContext(PolicyDraftContext);
  useEffect(() => { setState({ dirty: Boolean(value.trim() || selected.length), busy }); }, [setState, value, selected.length, busy]);
  useEffect(() => () => setState({ dirty: false, busy: false }), [setState]);
  const load = useCallback(async () => {
    const id = ++request.current;
    try {
      const response = await fetch('/api/rules/sender-policy', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.entries) || !Array.isArray(data.legacy)) throw new Error(data.error || 'Could not load sender policy.');
      if (request.current !== id) return;
      setEntries(data.entries); setLegacy(data.legacy); setError('');
    } catch (error) { if (request.current === id) setError(error instanceof Error ? error.message : 'Could not load sender policy.'); }
  }, []);
  useEffect(() => {
    const sequence = request;
    const timer = window.setTimeout(() => void load(), 0);
    return () => { window.clearTimeout(timer); sequence.current++; };
  }, [load]);
  const apply = async () => {
    if (!review || mutation.current) return;
    mutation.current = true; setBusy(true); setError(''); setNotice(''); request.current++;
    try {
      const response = await fetch('/api/rules/sender-policy', { method: review.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(review.body) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not save sender policy.');
      setEntries(data.entries); setSelected([]); if (review.clearInput) setValue('');
      setReview(null); setNotice('Sender policy saved and active.');
      window.dispatchEvent(new Event('oms:sender-policy'));
    } catch (error) {
      setReview(null);
      setError((error instanceof Error ? error.message : 'Could not save sender policy.') + ' Your choices are retained. Reload the list to check the saved state before retrying.');
    } finally { mutation.current = false; setBusy(false); }
  };
  const pending = legacy.filter((item, index) => !item.entry || (
    !entries?.some(entry => keyOf(entry) === keyOf(item.entry!))
    && legacy.findIndex(other => other.entry && keyOf(other.entry) === keyOf(item.entry!)) === index
  ));
  const selectedEntries = pending.flatMap(item => item.entry && selected.includes(keyOf(item.entry)) ? [item.entry] : []);
  return <section className="settings-section">
    <h3>Sender policy · User-marked Junk</h3>
    <p className="settings-description">Blocked mail goes to Junk. Safe entries exempt mail from this list; other folder rules and server security checks still apply. An exact sender choice overrides a domain choice. Changing the same entry replaces its previous Block or Safe choice.</p>
    <p className="settings-description">Domain choices cover every sender at that exact domain, including shared providers. Subdomains are separate. With the Trusted image setting, only active safe sender addresses may load remote images automatically; safe domains do not grant that permission.</p>
    {error && <div role="alert">{error} <button className="btn btn-ghost" disabled={busy} onClick={() => void load()}>Reload sender policy</button></div>}
    {notice && <p role="status">{notice}</p>}
    {!entries && !error && <p role="status">Loading sender policy…</p>}
    {entries && <>
      <form onSubmit={event => { event.preventDefault(); if (!value.trim() || busy) return; setReview({ method: 'PUT', body: { kind, value: value.trim(), disposition }, clearInput: true,
        message: `${disposition === 'block' ? 'Block' : 'Make safe'} ${value.trim()} (${kind === 'domain' ? 'every sender at this domain' : 'this sender only'}) for future mail. Exact sender choices take precedence over domain choices. Existing messages are not moved.` }); }}>
        <div className="settings-grid">
          <label className="settings-field"><span>Choice</span><select className="glass-input glass-select" value={disposition} disabled={busy} onChange={event => setDisposition(event.target.value as Entry['disposition'])}><option value="block">Block</option><option value="safe">Safe</option></select></label>
          <label className="settings-field"><span>Scope</span><select className="glass-input glass-select" value={kind} disabled={busy} onChange={event => setKind(event.target.value as Entry['kind'])}><option value="sender">One sender</option><option value="domain">Entire domain</option></select></label>
          <label className="settings-field"><span>{kind === 'sender' ? 'Email address' : 'Domain'}</span><input className="glass-input" value={value} disabled={busy} required placeholder={kind === 'sender' ? 'sender@example.com' : 'example.com'} onChange={event => setValue(event.target.value)} /></label>
        </div>
        <button className="btn btn-primary" disabled={busy || !value.trim()}>Review choice</button>
      </form>
      {entries.length === 0 && <p>No active sender or domain entries.</p>}
      {entries.map(entry => <div key={keyOf(entry)} className="settings-toggle-row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <span style={{ overflowWrap: 'anywhere' }}><strong>{entry.disposition === 'block' ? 'Blocked' : 'Safe'}</strong> · {entry.value} <small>({entry.kind === 'domain' ? 'entire domain' : 'sender'})</small></span>
        <button className="btn btn-ghost" disabled={busy} onClick={() => setReview({ method: 'DELETE', body: entry, message: `Remove the ${entry.disposition === 'block' ? 'block' : 'safe exception'} for ${entry.value}? Remaining sender/domain choices and other rules will apply to future mail.` })}>{entry.disposition === 'block' ? 'Unblock' : 'Remove safe exception'}</button>
      </div>)}
      {pending.length > 0 && <section style={{ marginTop: 24 }}>
        <h3>Review previously saved lists</h3>
        <p className="settings-description">These old entries are not active incoming-mail policy. Select the entries you want to activate. Nothing changes until you confirm.</p>
        {pending.map((item, index) => <label key={item.entry ? keyOf(item.entry) : `invalid-${index}`} className="settings-toggle-row" style={{ overflowWrap: 'anywhere' }}>
          <span>{item.original} · {item.entry ? `${item.entry.disposition === 'safe' ? 'Safe' : 'Block'} ${item.entry.kind}` : 'Needs correction; add a valid address or exact domain above'}</span>
          {item.entry && <input type="checkbox" disabled={busy} checked={selected.includes(keyOf(item.entry))} onChange={event => { const key = keyOf(item.entry!); setSelected(current => event.target.checked ? [...current, key] : current.filter(value => value !== key)); }} />}
        </label>)}
        <button className="btn btn-primary" disabled={busy || selectedEntries.length === 0} onClick={() => setReview({ method: 'POST', body: { entries: selectedEntries, confirm: true }, message: `Activate ${selectedEntries.length} selected entries for future incoming mail? Domain entries apply to every sender at that exact domain. Existing messages will stay where they are.` })}>Review activation ({selectedEntries.length})</button>
      </section>}
    </>}
    <ConfirmDialog open={Boolean(review) && !routeBlocked} title="Confirm sender policy" message={review?.message || ''} confirmLabel="Apply choice" busy={busy} onConfirm={() => void apply()} onCancel={() => setReview(null)} />
  </section>;
}
