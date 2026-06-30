import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, useDefaultLayout } from 'react-resizable-panels';
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

  const contactsPanelLayout = useDefaultLayout({
    id: 'oms-contacts-v10',
    panelIds: ['contacts-sidebar', 'contacts-view'],
  });

  if (isMobile) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <ContactGrid contacts={contacts} density={density} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
      <PanelGroup
        id="oms-contacts-v10"
        orientation="horizontal"
        defaultLayout={contactsPanelLayout.defaultLayout}
        onLayoutChange={contactsPanelLayout.onLayoutChange}
        style={{ width: '100%', height: '100%', minHeight: 0, minWidth: 0 }}
      >
        <Panel id="contacts-sidebar" defaultSize={20} minSize={15} maxSize={30}>
          <ContactSidebar contacts={contacts} />
        </Panel>
        <ResizeHandle />
        <Panel id="contacts-view" defaultSize={80} minSize={40}>
          <ContactGrid contacts={contacts} density={density} />
        </Panel>
      </PanelGroup>
    </div>
  );
}
