import { useCallback, useEffect, useRef, useState } from 'react';
import { Routes, Route } from 'react-router';
import { MailLayout } from './MailLayout';
import { MessageList } from './MessageList';
import { ComposeModal } from './ComposeModal';
import { useMail } from './hooks/useMail';
import { useAppearance } from '../shared/hooks/useAppearance';
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

export function MailRoutes() {
  const { appearance } = useAppearance();
  const density = (appearance.density as 'compact' | 'cozy' | 'comfortable') || 'cozy';
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
    isThreaded: false,
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
    // Check for pending compose from cross-route navigation (sessionStorage fallback)
    const pendingTo = sessionStorage.getItem('oms_compose_to');
    if (pendingTo) {
      sessionStorage.removeItem('oms_compose_to');
      startCompose({ to: pendingTo });
    }
    // Live event listener for same-route compose triggers
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.to) {
        sessionStorage.removeItem('oms_compose_to');
        startCompose({ to: detail.to });
      }
    };
    window.addEventListener('oms:compose', handler);
    return () => window.removeEventListener('oms:compose', handler);
  }, [startCompose]);

  return (
    <>
      <Routes>
        <Route element={<MailLayout mail={mail} />}>
          <Route path=":folder" element={<MessageList mail={mail} density={density} />} />
          <Route path=":folder/:uid" element={<MessageList mail={mail} density={density} />} />
        </Route>
      </Routes>
      <ComposeModal mail={mail} />
    </>
  );
}
