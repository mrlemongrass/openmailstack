import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalFocus } from '../shared/hooks/useModalFocus';
import type { MailFolder } from '../shared/types';

import { selectionRequest, type MailSelection } from './mail-selection-api';
export function MailSelectionDialog({ initial, action, targetFolder = '', folders, onClose, onChanged, onBatch, onBusy, navigationBlocked = false }: {
  initial: MailSelection; action: string; targetFolder?: string; folders: MailFolder[]; onClose: () => void; onChanged: () => void; onBatch: (batch: { folder: string; uids: number[] }) => void; onBusy: (busy: boolean) => void; navigationBlocked?: boolean;
}) {
  const [result, setResult] = useState(initial);
  const [scope, setScope] = useState('sender');
  const [destination, setDestination] = useState(targetFolder);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const cancelled = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus({ dialogRef, open: true, active: !navigationBlocked, onClose: () => { if (!lock.current) onClose(); } });
  useEffect(() => () => { cancelled.current = true; }, []);
  const cancel = async () => {
    cancelled.current = true;
    try { const response = await selectionRequest(`/${initial.token}`, 'DELETE'); if (!lock.current) setResult(response); }
    catch (err) { setError((err as Error).message); }
  };
  const run = async () => {
    if (lock.current) return;
    lock.current = true; cancelled.current = false; setBusy(true); onBusy(true); setError('');
    let current = result;
    try {
      do {
        current = await selectionRequest(`/${initial.token}/apply`, 'POST', { cursor: current.completed, action, targetFolder: action === 'move' ? destination : undefined, junkScope: action === 'spam' ? scope : undefined });
        setResult(current);
        if (current.confirmedBatch) onBatch(current.confirmedBatch);
      } while (!cancelled.current && current.state === 'ready');
      if (cancelled.current && current.state === 'ready') setResult(await selectionRequest(`/${initial.token}`, 'DELETE'));
    } catch (err) { setError(`${(err as Error).message} Check progress before retrying; the last batch may have completed.`); }
    finally { lock.current = false; setBusy(false); onBusy(false); onChanged(); }
  };
  const labels: Record<string, string> = { read: 'Mark as read', unread: 'Mark as unread', star: 'Flag', unstar: 'Unflag', delete: 'Delete', archive: 'Archive', move: 'Move', spam: 'Mark as spam', notspam: 'Not junk' };
  return createPortal(<div style={{ position: 'fixed', inset: 0, zIndex: 1900, background: 'rgba(0,0,0,.6)', display: 'grid', placeItems: 'center', padding: 16 }}>
    <div ref={dialogRef} className="glass-panel" role="dialog" aria-modal="true" aria-labelledby="selection-title" style={{ width: '100%', maxWidth: 520, maxHeight: '90dvh', overflow: 'auto', padding: 24 }}>
      <h2 id="selection-title">{labels[action]} · {initial.count.toLocaleString()} messages</h2>
      <p>Only the messages in this selection will be changed. Later arrivals are excluded. Completed batches stay changed if you stop.</p>
      {action === 'delete' && initial.includesTrash && <p role="note">Messages already in Trash will be permanently deleted. Other selected messages move to Trash.</p>}
      {action === 'spam' && <label>Future mail <select className="glass-input" value={scope} disabled={busy || result.completed > 0} onChange={e => setScope(e.target.value)}><option value="sender">Block these senders</option><option value="domain">Block their entire domains</option></select><p>Domain blocks include other senders at shared providers. Explicit safe senders remain exceptions.</p></label>}
      {action === 'notspam' && <p>Move these messages to Inbox and remove matching sender/domain blocks. Other filter rules still apply.</p>}
      {action === 'move' && <label>Destination <select className="glass-input" value={destination} disabled={busy || result.completed > 0} onChange={e => setDestination(e.target.value)}><option value="">Choose folder…</option>{folders.filter(f => f.path !== 'SCHEDULED').map(f => <option key={f.path} value={f.path}>{f.path}</option>)}</select></label>}
      <p role="status">{result.completed.toLocaleString()} of {result.count.toLocaleString()} confirmed{result.state === 'complete' ? ' · Complete' : result.state === 'cancelled' ? ' · Stopped' : busy ? ' · Working…' : ''}</p>
      {(error || result.error) && <p role="alert">{error || result.error}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {busy ? <button className="btn btn-secondary" onClick={() => void cancel()}>Stop after current batch</button> : <button className="btn btn-ghost" onClick={onClose}>Close</button>}
        {!busy && result.state === 'ready' && <button className={action === 'delete' ? 'btn btn-danger' : 'btn btn-primary'} disabled={!result.count || (action === 'move' && !destination) || (action === 'notspam' && !result.allJunk)} onClick={() => void run()}>{error ? 'Check progress and continue' : `${labels[action]} selected messages`}</button>}
      </div>
    </div>
  </div>, document.body);
}
