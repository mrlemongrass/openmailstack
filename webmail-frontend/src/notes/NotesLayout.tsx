import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { useMediaQuery } from '../shared/hooks/useMediaQuery';
import { useNotes } from './hooks/useNotes';
import { NotesSidebar } from './NotesSidebar';
import { NotesGrid } from './NotesGrid';

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
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <PanelGroup id="oms-notes-v9" orientation="horizontal" style={{ flex: 1 }}>
        <Panel defaultSize={20} minSize={15} maxSize={30}>
          <NotesSidebar notesCtx={notesCtx} />
        </Panel>
        <PanelResizeHandle style={{ width: 4, background: 'transparent' }} />
        <Panel defaultSize={80} minSize={40}>
          <NotesGrid notesCtx={notesCtx} />
        </Panel>
      </PanelGroup>
    </div>
  );
}
