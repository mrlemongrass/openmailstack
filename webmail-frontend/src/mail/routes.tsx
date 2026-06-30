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
