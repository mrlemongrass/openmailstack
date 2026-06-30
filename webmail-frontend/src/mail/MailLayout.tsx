import { Outlet } from 'react-router';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { useMediaQuery } from '../shared/hooks/useMediaQuery';
import { FolderSidebar } from './FolderSidebar';
import type { useMail } from './hooks/useMail';

interface MailLayoutProps {
  mail: ReturnType<typeof useMail>;
}

export function MailLayout({ mail }: MailLayoutProps) {
  const isMobile = useMediaQuery('(max-width: 767px)');

  if (isMobile) {
    return <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}><Outlet /></div>;
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <PanelGroup id="oms-mail-v9" orientation="horizontal" style={{ flex: 1 }}>
        <Panel defaultSize={20} minSize={15} maxSize={30}>
          <FolderSidebar folders={mail.folders} activeFolder={mail.activeFolder}
            expandedFolders={mail.expandedFolders}
            onToggleExpand={(path) => mail.setExpandedFolders((prev) => ({ ...prev, [path]: !prev[path] }))}
            onCompose={() => mail.setIsComposing(true)} quota={mail.userQuota} />
        </Panel>
        <PanelResizeHandle style={{ width: 4, background: 'transparent' }} />
        <Panel defaultSize={80} minSize={40}>
          <Outlet />
        </Panel>
      </PanelGroup>
    </div>
  );
}
