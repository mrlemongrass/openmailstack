import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { useMediaQuery } from '../shared/hooks/useMediaQuery';
import { useContacts } from './hooks/useContacts';
import { ContactSidebar } from './ContactSidebar';
import { ContactGrid } from './ContactGrid';
import { useAppearance } from '../shared/hooks/useAppearance';

function ResizeHandle() {
  return (
    <PanelResizeHandle style={{ width: 16, cursor: 'col-resize', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 6, right: 6,
        background: 'rgba(255,255,255,0.08)', borderRadius: 4 }} />
    </PanelResizeHandle>
  );
}

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
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <PanelGroup id="oms-contacts-v10" orientation="horizontal" style={{ flex: 1 }}>
        <Panel id="contact-sidebar" defaultSize={20} minSize={15} maxSize={30}>
          <ContactSidebar contacts={contacts} />
        </Panel>
        <ResizeHandle />
        <Panel id="contact-content" defaultSize={80} minSize={40}>
          <ContactGrid contacts={contacts} density={density} />
        </Panel>
      </PanelGroup>
    </div>
  );
}
