import { Outlet, useParams } from 'react-router';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, useDefaultLayout } from 'react-resizable-panels';
import { useMediaQuery } from '../shared/hooks/useMediaQuery';
import { FolderSidebar } from './FolderSidebar';
import { MessageViewer } from './MessageViewer';
import { UndoBar } from './components/UndoBar';
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

function OutboundRecoveryNotice({ mail }: MailLayoutProps) {
  if (!mail.outboundRecoveryNotice) return null;
  return (
    <div
      className={`mail-send-recovery-notice ${mail.outboundRecoveryNotice.tone}`}
      role="status"
      aria-live="polite"
    >
      <span>{mail.outboundRecoveryNotice.message}</span>
      <button
        type="button"
        className="btn btn-ghost"
        aria-label="Dismiss send recovery notice"
        onClick={() => mail.setOutboundRecoveryNotice(null)}
      >
        ×
      </button>
    </div>
  );
}

export function MailLayout({ mail }: MailLayoutProps) {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const { uid } = useParams<{ uid: string }>();
  const showViewer = !!uid;

  // Persist layout sizes — matches original app pattern
  const webmailPanelLayout = useDefaultLayout({
    id: 'oms-webmail-v11',
    panelIds: showViewer ? ['webmail-sidebar', 'message-list', 'message-view'] : ['webmail-sidebar', 'message-list'],
  });

  if (isMobile) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <OutboundRecoveryNotice mail={mail} />
        {showViewer ? <MessageViewer mail={mail} /> : <Outlet />}
        {!showViewer && (
          <button
            onClick={() => mail.startCompose()}
            style={{
              position: 'fixed', bottom: 72, right: 16, zIndex: 50,
              width: 48, height: 48, borderRadius: '50%',
              background: 'var(--accent-primary)', color: 'white',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(59,130,246,0.4)',
            }}
            title="Compose"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        )}
        <UndoBar mailUndo={mail.mailUndo} onUndo={mail.undoAction} onDismiss={() => mail.setMailUndo(null)} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <OutboundRecoveryNotice mail={mail} />
      <PanelGroup
        id="oms-webmail-v11"
        orientation="horizontal"
        defaultLayout={webmailPanelLayout.defaultLayout}
        onLayoutChange={webmailPanelLayout.onLayoutChange}
        style={{ width: '100%', height: '100%', minHeight: 0, minWidth: 0 }}
      >
        <Panel id="webmail-sidebar" defaultSize="20%" minSize="10%" maxSize="35%">
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, overflow: 'hidden' }}>
            <FolderSidebar folders={mail.folders} activeFolder={mail.activeFolder}
              expandedFolders={mail.expandedFolders}
              onToggleExpand={(path) => mail.setExpandedFolders((prev) => ({ ...prev, [path]: !prev[path] }))}
              onCompose={() => mail.startCompose()}
              onCreateFolder={mail.createFolder}
              onMoveFolder={mail.moveFolder}
              onRenameFolder={mail.renameFolder}
              onDeleteFolder={mail.deleteFolder}
              quota={mail.userQuota} />
          </div>
        </Panel>

        <ResizeHandle />

        <Panel id="message-list" defaultSize={showViewer ? '35%' : '80%'} minSize="15%">
          <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, overflow: 'hidden' }}>
            <Outlet />
          </div>
        </Panel>

        {showViewer && (
          <>
            <ResizeHandle />
            <Panel id="message-view" defaultSize="45%" minSize="18%">
              <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, overflow: 'hidden' }}>
                <MessageViewer mail={mail} />
              </div>
            </Panel>
          </>
        )}
      </PanelGroup>
      <UndoBar mailUndo={mail.mailUndo} onUndo={mail.undoAction} onDismiss={() => mail.setMailUndo(null)} />
    </div>
  );
}
