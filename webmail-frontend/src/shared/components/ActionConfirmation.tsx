import { useRef, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
interface Action { title: string; message: string; label: string; run: () => Promise<void>; danger?: boolean }
export function useActionConfirmation() {
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const ask = (next: Action) => { if (!lock.current) { setError(''); setAction(next); } };
  const confirm = async () => {
    if (lock.current || !action) return;
    lock.current = true; setBusy(true); setError('');
    try { await action.run(); setAction(null); }
    catch (err) { setError(err instanceof Error ? err.message : 'The change could not be confirmed. Refresh and check before retrying.'); }
    finally { lock.current = false; setBusy(false); }
  };
  const dialog = <ConfirmDialog open={Boolean(action)} title={action?.title || ''} message={`${action?.message || ''}${error ? ` ${error}` : ''}`} confirmLabel={action?.label} danger={action?.danger ?? true} busy={busy} onConfirm={() => void confirm()} onCancel={() => setAction(null)} />;
  return { ask, dialog, busy };
}
