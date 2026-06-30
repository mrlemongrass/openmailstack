import { Outlet, useParams } from 'react-router';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { useMediaQuery } from '../shared/hooks/useMediaQuery';
import { FolderSidebar } from './FolderSidebar';
import { MessageViewer } from './MessageViewer';
import type { useMail } from './hooks/useMail';

interface MailLayoutProps {
  mail: ReturnType<typeof useMail>;
}

function ResizeHandle() {
  return (
    <PanelResizeHandle style={{ width: 16, cursor: 'col-resize', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 6, right: 6,
        background: 'rgba(255,255,255,0.08)', borderRadius: 4 }} />
    </PanelResizeHandle>
  );
}

export function MailLayout({ mail }: MailLayoutProps) {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const { uid } = useParams<{ uid: string }>();
  const showViewer = !!uid;

  if (isMobile) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {showViewer ? (
          <div style={{ flex: 1 }}>
            <MessageViewer mail={mail} />
          </div>
        ) : (
          <Outlet />
        )}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <PanelGroup id="oms-mail-v10" orientation="horizontal" style={{ flex: 1 }}>
        {/* Panel 1: Folder sidebar */}
        <Panel id="folders" defaultSize={20} minSize={14} maxSize={28}>
          <FolderSidebar folders={mail.folders} activeFolder={mail.activeFolder}
            expandedFolders={mail.expandedFolders}
            onToggleExpand={(path) => mail.setExpandedFolders((prev) => ({ ...prev, [path]: !prev[path] }))}
            onCompose={() => mail.setIsComposing(true)} quota={mail.userQuota} />
        </Panel>

        <ResizeHandle />

        {/* Panel 2: Message list */}
        <Panel id="list" defaultSize={35} minSize={18}>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Outlet />
          </div>
        </Panel>

        {showViewer && (
          <>
            <ResizeHandle />
            {/* Panel 3: Message viewer */}
            <Panel id="viewer" defaultSize={45} minSize={22}>
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <MessageViewer mail={mail} />
              </div>
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  );
}
