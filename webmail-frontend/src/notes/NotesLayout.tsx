import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, useDefaultLayout } from 'react-resizable-panels';
import { useMediaQuery } from '../shared/hooks/useMediaQuery';
import { useNotes } from './hooks/useNotes';
import { NotesSidebar } from './NotesSidebar';
import { NotesGrid } from './NotesGrid';

function ResizeHandle() {
  return (
    <PanelResizeHandle style={{ width: 16, cursor: 'col-resize', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 6, right: 6,
        background: 'rgba(255,255,255,0.08)', borderRadius: 4 }} />
    </PanelResizeHandle>
  );
}

export function NotesLayout() {
  const notesCtx = useNotes();
  const isMobile = useMediaQuery('(max-width: 767px)');

  const notesPanelLayout = useDefaultLayout({
    id: 'oms-notes-v10',
    panelIds: ['notes-sidebar', 'notes-view'],
  });

  if (isMobile) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <NotesGrid notesCtx={notesCtx} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
      <PanelGroup
        id="oms-notes-v10"
        orientation="horizontal"
        defaultLayout={notesPanelLayout.defaultLayout}
        onLayoutChange={notesPanelLayout.onLayoutChange}
        style={{ width: '100%', height: '100%', minHeight: 0, minWidth: 0 }}
      >
        <Panel id="notes-sidebar" defaultSize={20} minSize={15} maxSize={30}>
          <NotesSidebar notesCtx={notesCtx} />
        </Panel>
        <ResizeHandle />
        <Panel id="notes-view" defaultSize={80} minSize={40}>
          <NotesGrid notesCtx={notesCtx} />
        </Panel>
      </PanelGroup>
    </div>
  );
}
