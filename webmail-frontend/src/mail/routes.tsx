import { useEffect } from 'react';
import { Routes, Route } from 'react-router';
import { MailLayout } from './MailLayout';
import { MessageList } from './MessageList';
import { ComposeModal } from './ComposeModal';
import { useMail } from './hooks/useMail';
import { useAppearance } from '../shared/hooks/useAppearance';

export function MailRoutes() {
  const { appearance } = useAppearance();
  const density = (appearance.density as 'compact' | 'cozy' | 'comfortable') || 'cozy';
  const mail = useMail({ mailSettings: {} as any, isThreaded: false, userIdentities: {} as any });

  // Listen for cross-suite compose events + check for pending compose on mount
  useEffect(() => {
    // Check for pending compose from cross-route navigation (sessionStorage fallback)
    const pendingTo = sessionStorage.getItem('oms_compose_to');
    if (pendingTo) {
      sessionStorage.removeItem('oms_compose_to');
      mail.setComposeTo(pendingTo);
      mail.setIsComposing(true);
    }
    // Live event listener for same-route compose triggers
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.to) {
        sessionStorage.removeItem('oms_compose_to');
        mail.setComposeTo(detail.to);
        mail.setIsComposing(true);
      }
    };
    window.addEventListener('oms:compose', handler);
    return () => window.removeEventListener('oms:compose', handler);
  }, [mail]);

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
