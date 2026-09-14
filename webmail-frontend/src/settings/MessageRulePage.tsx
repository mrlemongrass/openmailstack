import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { fetchFolders, fetchRules } from '../shared/api';
import type { MailFolder, Rule } from '../shared/types';
import { UnsavedChangesGuard } from '../shared/components/UnsavedChangesGuard';
import { ConfirmDialog } from '../shared/components/ConfirmDialog';
import { RuleEditor } from './SettingsPanel';
import { RuleRunDialog } from './RuleRunDialog';
import { appendRuleSender, messageRuleSender } from './message-rule';

export function MessageRulePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const seed = location.state as { mode?: string; from?: string; returnTo?: string } | null;
  const [sender, setSender] = useState(() => messageRuleSender(seed?.from || ''));
  const [rules, setRules] = useState<Rule[]>([]);
  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [rule, setRule] = useState<Rule | null>(null);
  const [previous, setPrevious] = useState<Rule | undefined>();
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [saved, setSaved] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [run, setRun] = useState(false);
  const [routeBlocked, setRouteBlocked] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setReady(false); setError('');
    try { const [items, destinations] = await Promise.all([fetchRules(), fetchFolders()]); setRules(items); setFolders(destinations); setReady(true); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load saved rules.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const start = (existing?: Rule) => {
    setError('');
    try {
      const base: Rule = existing || { id: crypto.randomUUID(), name: `Mail from ${sender}`, enabled: true, stopProcessing: true, condition: 'any', criteria: [], actions: [{ id: crypto.randomUUID(), type: 'move', folder: 'INBOX' }] };
      const next = appendRuleSender(base, sender);
      // Older saved documents may omit editor-only row identifiers.
      next.criteria = next.criteria.map(item => ({ ...item, id: item.id || crypto.randomUUID() }));
      next.actions = next.actions.map(item => ({ ...item, id: item.id || crypto.randomUUID() }));
      setPrevious(existing); setRule(next); setSaved(false);
    } catch (err) { setError((err as Error).message); }
  };
  const save = async () => {
    if (lock.current || !rule) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/rules/one', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rule, previous }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not confirm the save. Retry the same change.');
      setRules(data.rules); setSaved(true); setConfirm(false);
    } catch (err) { setError((err as Error).message); setConfirm(false); }
    finally { lock.current = false; setBusy(false); }
  };
  return <main className="settings-content" style={{ overflow: 'auto', padding: 24, width: '100%' }}>
    <UnsavedChangesGuard dirty={Boolean(rule && !saved) || busy} locked={busy} onBlockedChange={setRouteBlocked} />
    <h1>{seed?.mode === 'add' ? 'Add sender to a rule' : 'Create rule from email'}</h1>
    <p>Review the conditions and actions before activating them for future mail. You can preview existing messages after saving.</p>
    {error && <p role="alert">{error}</p>}
    {loading ? <p role="status">Loading saved rules and folders…</p> : !ready ? <button className="btn btn-primary" onClick={() => void load()}>Retry loading rules and folders</button> : !rule ? <>
      <label>Sender address <input className="glass-input" type="email" value={sender} onChange={event => setSender(event.target.value.trim().toLowerCase())} /></label>
      {seed?.mode === 'add' ? <div><p>Choose a saved rule. Exact sender lists retain the rule’s other conditions and actions.</p>
        {rules.filter(item => item.id !== 'oms-user-marked-junk').map(item => <button className="btn btn-secondary" key={item.id} onClick={() => start(item)}>{item.name}{item.enabled === false ? ' (disabled)' : ''}</button>)}
        {!rules.some(item => item.id !== 'oms-user-marked-junk') && <p>No ordinary rules are saved yet.</p>}
        <button className="btn btn-secondary" onClick={() => start()}>Create a separate rule</button>
      </div> : <button className="btn btn-primary" onClick={() => start()}>Review new rule</button>}
      <button className="btn btn-ghost" onClick={() => void load()}>Reload saved rules</button>
    </> : saved ? <div role="status"><p>Rule saved{rule.enabled ? ' and activated for future mail' : ' as disabled'}. Existing messages have not been changed.</p>
      {rule.enabled && <button className="btn btn-primary" onClick={() => setRun(true)}>Preview existing messages…</button>}
    </div> : <>
      <fieldset disabled={busy} style={{ border: 0, padding: 0 }}><RuleEditor rule={rule} folders={folders} onUpdate={updates => setRule({ ...rule, ...updates })} /></fieldset>
      <button className="btn btn-primary" disabled={busy} onClick={() => setConfirm(true)}>Review and save</button>
      {error && <button className="btn btn-secondary" disabled={busy} onClick={async () => { await load(); setRule(null); }}>Reload saved rules and restart review</button>}
    </>}
    <button className="btn btn-ghost" disabled={busy} onClick={() => navigate(seed?.returnTo?.startsWith('/mail/') ? seed.returnTo : '/mail/INBOX')}>Back to mail</button>
    <ConfirmDialog open={confirm && !routeBlocked} title={`Save “${rule?.name || 'rule'}”?`} message="The reviewed conditions and actions will govern future deliveries. Earlier rules may match first. Existing mail will only change if you separately preview and apply the rule." confirmLabel="Save rule" busy={busy} onCancel={() => setConfirm(false)} onConfirm={() => void save()} />
    {run && rule && <RuleRunDialog folders={folders} rules={rules} initialRuleIds={[rule.id]} onClose={() => setRun(false)} />}
  </main>;
}
