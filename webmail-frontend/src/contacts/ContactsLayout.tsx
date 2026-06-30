import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { useMediaQuery } from '../shared/hooks/useMediaQuery';
import { useContacts } from './hooks/useContacts';
import { ContactSidebar } from './ContactSidebar';
import { ContactGrid } from './ContactGrid';
import { useAppearance } from '../shared/hooks/useAppearance';

export function ContactsLayout() {
  const contacts = useContacts();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const { appearance } = useAppearance();
  const density = (appearance.density as 'compact' | 'cozy' | 'comfortable') || 'cozy';

  if (isMobile) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <ContactGrid contacts={contacts} density={density} />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <PanelGroup id="oms-contacts-v9" orientation="horizontal" style={{ flex: 1 }}>
        <Panel defaultSize={20} minSize={15} maxSize={30}>
          <ContactSidebar contacts={contacts} />
        </Panel>
        <PanelResizeHandle style={{ width: 4, background: 'transparent' }} />
        <Panel defaultSize={80} minSize={40}>
          <ContactGrid contacts={contacts} density={density} />
        </Panel>
      </PanelGroup>
    </div>
  );
}
