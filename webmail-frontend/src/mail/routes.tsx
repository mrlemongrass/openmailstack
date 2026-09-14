import { useCallback, useEffect, useRef, useState } from 'react';
import { Routes, Route } from 'react-router';
import { MailLayout } from './MailLayout';
import { MessageList } from './MessageList';
import { ComposeModal } from './ComposeModal';
import { useMail } from './hooks/useMail';
import {
  defaultMailSettings,
  getUserSettings,
  saveMailFavoriteSettings,
  type MailUserSettings,
} from '../settings/settingsApi';
import { fetchIdentities } from '../shared/api';
import type { UserIdentities } from '../shared/types';
import {
  EMPTY_USER_IDENTITIES,
  loadMailIdentitiesRuntimeState,
  loadMailSettingsRuntimeState,
} from './mail-runtime-settings';
import {
  crossSuiteComposeFiles,
  takeCrossSuiteComposeDraft,
  type CrossSuiteComposeDraft,
} from '../shared/crossSuiteCompose';

export function MailRoutes({ detached = false }: { detached?: boolean }) {
  const [minimizedError, setMinimizedError] = useState('');
  const [mailSettings, setMailSettings] = useState<MailUserSettings>(defaultMailSettings);
  const [mailSettingsReady, setMailSettingsReady] = useState(false);
  const [mailSettingsError, setMailSettingsError] = useState('');
  const [userIdentities, setUserIdentities] = useState<UserIdentities>(EMPTY_USER_IDENTITIES);
  const [userIdentitiesReady, setUserIdentitiesReady] = useState(false);
  const [userIdentitiesError, setUserIdentitiesError] = useState('');
  const mailSettingsRequestIdRef = useRef(0);
  const userIdentitiesRequestIdRef = useRef(0);
  const persistFavoriteSettings = useCallback(async (folders: MailUserSettings['folders']) => {
    const savedSettings = await saveMailFavoriteSettings(folders);
    setMailSettings(current => ({ ...current, folders: savedSettings.folders }));
  }, []);
  const retryMailSettings = useCallback(() => {
    const requestId = ++mailSettingsRequestIdRef.current;
    setMailSettingsReady(false);
    setMailSettingsError('');
    void loadMailSettingsRuntimeState(() => getUserSettings('mail')).then(result => {
      if (requestId !== mailSettingsRequestIdRef.current) return;
      setMailSettings(result.settings);
      setMailSettingsReady(result.ready);
      setMailSettingsError(result.ready ? '' : 'Favorites could not be loaded.');
    });
  }, []);
  const retryUserIdentities = useCallback(async () => {
    const requestId = ++userIdentitiesRequestIdRef.current;
    setUserIdentitiesReady(false);
    setUserIdentitiesError('');
    const result = await loadMailIdentitiesRuntimeState(fetchIdentities);
    if (requestId !== userIdentitiesRequestIdRef.current) return;
    setUserIdentities(result.identities);
    setUserIdentitiesReady(result.ready);
    setUserIdentitiesError(result.ready ? '' : 'Sending identities could not be loaded.');
    if (!result.ready) throw new Error('Sending identities could not be loaded.');
  }, []);
  const mail = useMail({
    mailSettings,
    mailSettingsReady,
    mailSettingsError,
    onRetryMailSettings: retryMailSettings,
    onFavoriteSettingsChange: persistFavoriteSettings,
    isThreaded: mailSettings.reading.threaded,
    userIdentities,
    userIdentitiesReady,
    userIdentitiesError,
    onRetryUserIdentities: retryUserIdentities,
  });
  const { startCompose } = mail;

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      retryMailSettings();
      void retryUserIdentities().catch(() => undefined);
    });
    return () => {
      cancelled = true;
      mailSettingsRequestIdRef.current += 1;
      userIdentitiesRequestIdRef.current += 1;
    };
  }, [retryMailSettings, retryUserIdentities]);

  // Listen for cross-suite compose events + check for pending compose on mount
  useEffect(() => {
    const openDraft = (draft: CrossSuiteComposeDraft) => startCompose({
      from: draft.from,
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      body: draft.body,
      attachments: crossSuiteComposeFiles(draft),
    });
    const pendingDraft = takeCrossSuiteComposeDraft(sessionStorage);
    if (pendingDraft) openDraft(pendingDraft);
    // Backward compatibility for one-field handoffs from older loaded clients.
    const legacyPendingTo = sessionStorage.getItem('oms_compose_to');
    if (legacyPendingTo) {
      sessionStorage.removeItem('oms_compose_to');
      startCompose({ to: legacyPendingTo });
    }
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<CrossSuiteComposeDraft>).detail;
      if (detail && typeof detail === 'object') openDraft(detail);
    };
    window.addEventListener('oms:compose', handler);
    return () => window.removeEventListener('oms:compose', handler);
  }, [startCompose]);

  const openedDetached = useRef(false);
  const openSavedDraft = mail.openSavedDraft;
  const attemptedDetached = useRef(false);
  const [detachedError, setDetachedError] = useState('');
  useEffect(() => {
    if (!detached || !mailSettingsReady || !userIdentitiesReady || attemptedDetached.current) return;
    attemptedDetached.current = true;
    const id = new URLSearchParams(window.location.search).get('draft');
    if (!id) { queueMicrotask(() => setDetachedError('Choose a saved draft to open this composer.')); return; }
    void openSavedDraft(id).then(opened => { if (!opened) setDetachedError('This draft could not be opened.'); }).catch(err => setDetachedError(err.message));
  }, [detached, mailSettingsReady, userIdentitiesReady, openSavedDraft]);
  useEffect(() => {
    if (!detached) return;
    if (mail.isComposing) openedDetached.current = true;
    else if (openedDetached.current) window.close();
  }, [detached, mail.isComposing]);

  return (
    <>
      {detached ? <main style={{ padding: 24 }}><p role="status">{detachedError || 'Opening your saved draft…'}</p>{detachedError && <button className="btn btn-primary" onClick={() => window.location.reload()}>Retry</button>}<a href="/mail/Drafts">Open Drafts</a></main> : <Routes>
        <Route element={<MailLayout mail={mail} />}>
          <Route path=":folder" element={<MessageList mail={mail} density={mailSettings.reading.density} />} />
          <Route path=":folder/:uid" element={<MessageList mail={mail} density={mailSettings.reading.density} />} />
        </Route>
      </Routes>}
      {!detached && mail.minimizedDrafts.length > 0 && <div aria-label="Minimized drafts" style={{ position: 'fixed', bottom: 12, right: 12, zIndex: 900, display: 'flex', flexWrap: 'wrap', gap: 8, maxWidth: '90vw' }}>
        {minimizedError && <p role="alert">{minimizedError}</p>}
        {mail.minimizedDrafts.map(draft => <div key={draft.id} className="glass-panel" style={{ display: 'flex', maxWidth: 240 }}><button className="btn btn-secondary" disabled={mail.isComposing} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={() => void mail.openSavedDraft(draft.id).then(opened => setMinimizedError(opened ? '' : 'This draft is open in another window or cannot be opened.')).catch(err => setMinimizedError(err.message))}>{draft.subject}</button><button className="btn btn-ghost" aria-label={`Dismiss minimized ${draft.subject}; keep in Drafts`} onClick={() => mail.dismissMinimizedDraft(draft.id)}>×</button></div>)}
      </div>}
      <ComposeModal mail={mail} detached={detached} />
    </>
  );
}
