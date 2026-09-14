import { useCallback, useEffect, useState } from 'react';

interface Entry { kind: 'sender' | 'domain'; value: string }

export function JunkList() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/rules/junk-list');
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not load the Junk list.');
      setEntries(data.entries);
      setError('');
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not load the Junk list.'); }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const remove = async (entry: Entry) => {
    setBusy(entry.kind + entry.value);
    setError('');
    try {
      const response = await fetch('/api/rules/junk-list', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not remove the block.');
      setEntries(current => current?.filter(item => item.kind !== entry.kind || item.value !== entry.value) || []);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not remove the block.'); }
    finally { setBusy(null); }
  };
  return <section className="settings-section">
    <h3>User-marked Junk</h3>
    <p className="settings-description">An active mail filter sends matching mail to Junk before your other folder rules. Use “Mark as spam” to block a sender or an entire domain. “Not junk” removes matching blocks. This does not bypass the server’s security checks.</p>
    {error && <div role="alert">{error} <button className="btn btn-ghost" onClick={() => void load()}>Reload list</button></div>}
    {!entries && !error && <p role="status">Loading Junk list…</p>}
    {entries?.length === 0 && <p>No senders or domains blocked by this rule.</p>}
    {entries?.map(entry => <div key={entry.kind + entry.value} className="settings-toggle-row" style={{ gap: 12, flexWrap: 'wrap' }}>
      <span style={{ overflowWrap: 'anywhere' }}>{entry.value} <small>({entry.kind === 'domain' ? 'entire domain' : 'sender'})</small></span>
      <button className="btn btn-ghost" aria-label={`Unblock ${entry.value}`} disabled={busy !== null} onClick={() => void remove(entry)}>{busy === entry.kind + entry.value ? 'Removing…' : 'Unblock'}</button>
    </div>)}
  </section>;
}
