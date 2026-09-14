import { useContext, useEffect, useRef, useState } from 'react';
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router';
import { ConfirmDialog } from './ConfirmDialog';

interface Props {
  dirty: boolean;
  locked?: boolean;
  onBlockedChange?: (blocked: boolean) => void;
  onSave?: () => Promise<boolean>;
  onDiscard?: () => void;
}

function RouteGuard({ dirty, onSave, onDiscard, onBlockedChange, locked }: Props) {
  const blocker = useBlocker(dirty);
  useEffect(() => { onBlockedChange?.(blocker.state === 'blocked'); }, [blocker.state, onBlockedChange]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const saving = useRef(false);
  const proceeding = useRef(false);
  useEffect(() => { if (blocker.state === 'unblocked') proceeding.current = false; }, [blocker.state]);
  const save = async () => {
    if (!onSave || locked || saving.current || blocker.state !== 'blocked') return;
    saving.current = true;
    setBusy(true);
    let saved = false;
    try { saved = await onSave(); } catch { /* Keep the editor and pending changes. */ }
    saving.current = false;
    setBusy(false);
    setFailed(!saved);
    if (saved && !proceeding.current) { proceeding.current = true; blocker.proceed(); }
  };
  useEffect(() => {
    if (blocker.state === 'blocked' && !onSave && !dirty && !locked && !saving.current && !proceeding.current) { proceeding.current = true; blocker.proceed(); }
  }, [blocker, dirty, locked, onSave]);
  useEffect(() => {
    if (blocker.state === 'blocked' && onSave && !failed && !locked) void save();
    // A blocked navigation starts one save attempt; retries are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.state, locked]);

  return <ConfirmDialog open={blocker.state === 'blocked'}
    title={busy || locked ? 'Saving changes…' : onSave ? 'Changes could not be saved' : 'Discard unsaved changes?'}
    message={busy || locked ? 'Wait for the current save to finish before leaving.' : onSave ? 'Your edits are still here. Keep editing or retry the save before leaving.' : 'Changes in this editor have not been saved.'}
    cancelLabel="Keep editing" confirmLabel={onSave ? 'Retry save' : 'Discard changes'}
    danger={!onSave} busy={busy || locked}
    onCancel={() => { setFailed(false); blocker.reset?.(); }}
    onConfirm={() => { if (onSave) void save(); else if (!proceeding.current) { proceeding.current = true; onDiscard?.(); blocker.proceed?.(); } }} />;
}

export function UnsavedChangesGuard(props: Props) {
  // Isolated previews can render editors without a router. The application
  // uses a data router, which also protects Back/Forward and programmatic moves.
  const router = useContext(UNSAFE_DataRouterContext);
  useEffect(() => {
    if (!props.dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [props.dirty]);
  return router ? <RouteGuard {...props} /> : null;
}
