import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
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

  if (isMobile) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <NotesGrid notesCtx={notesCtx} />
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <PanelGroup id="oms-notes-v10" orientation="horizontal" style={{ flex: 1 }}>
        <Panel id="notes-sidebar" defaultSize={20} minSize={15} maxSize={30}>
          <NotesSidebar notesCtx={notesCtx} />
        </Panel>
        <ResizeHandle />
        <Panel id="notes-content" defaultSize={80} minSize={40}>
          <NotesGrid notesCtx={notesCtx} />
        </Panel>
      </PanelGroup>
    </div>
  );
}
