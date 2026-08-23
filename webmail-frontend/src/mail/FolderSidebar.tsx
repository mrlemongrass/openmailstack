import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Archive,
  Clock,
  Edit2,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Inbox,
  MoreHorizontal,
  Send,
  Star,
  Trash2,
} from 'lucide-react';
import type { MailFolder } from '../shared/types';
import { ContextMenu, type ContextMenuItem } from '../shared/components/ContextMenu';
import { ConfirmDialog } from '../shared/components/ConfirmDialog';
import { useToast } from '../shared/components/Toast';
import type { ContextMenuPoint } from '../shared/context-menu-navigation';
import { FolderDestinationDialog, NewFolderDialog } from './components/FolderDialogs';
import { buildFolderTree, type FolderTreeNode } from './mail-folder-tree';

type FolderIcon = React.ComponentType<{ size?: number }>;

interface FolderSidebarProps {
  folders: MailFolder[];
  activeFolder: string;
  expandedFolders: Record<string, boolean>;
  onToggleExpand: (path: string) => void;
  onCompose: () => void;
  onCreateFolder: (parent: string | null, name: string) => Promise<string>;
  onMoveFolder: (path: string, parent: string | null) => Promise<string>;
  onDeleteFolder: (path: string) => Promise<void>;
  quota: { usage: number; limit: number } | null;
}

interface FolderMenuState {
  node: FolderTreeNode;
  point: ContextMenuPoint;
}

const ICON_MAP: Record<string, FolderIcon> = {
  INBOX: Inbox, Sent: Send, Starred: Star, Trash: Trash2, Archive: Archive, SCHEDULED: Clock,
};

function isProtectedFolder(node: FolderTreeNode) {
  const upperPath = node.fullPath.toUpperCase();
  return !node.exists || node.disabled || upperPath === 'INBOX' || upperPath === 'SCHEDULED' || Boolean(node.specialUse);
}

function parentFolderPath(node: FolderTreeNode) {
  const delimiter = node.delimiter;
  if (!delimiter || !node.fullPath.includes(delimiter)) return null;
  return node.fullPath.slice(0, node.fullPath.lastIndexOf(delimiter));
}

export function FolderSidebar({
  folders,
  activeFolder,
  expandedFolders,
  onToggleExpand,
  onCompose,
  onCreateFolder,
  onMoveFolder,
  onDeleteFolder,
  quota,
}: FolderSidebarProps) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [folderMenu, setFolderMenu] = useState<FolderMenuState | null>(null);
  const [newFolderParent, setNewFolderParent] = useState<string | null | undefined>(undefined);
  const [movingFolder, setMovingFolder] = useState<FolderTreeNode | null>(null);
  const [deleteFolderConfirm, setDeleteFolderConfirm] = useState<FolderTreeNode | null>(null);
  const tree = buildFolderTree(folders);
  const closeFolderMenu = useCallback(() => setFolderMenu(null), []);
  const closeNewFolderDialog = useCallback(() => setNewFolderParent(undefined), []);
  const openFolderMenu = useCallback((node: FolderTreeNode, point: ContextMenuPoint) => {
    setFolderMenu({ node, point });
  }, []);

  const folderMenuItems: ContextMenuItem[] = folderMenu ? [{
    id: 'open',
    label: 'Open',
    icon: FolderOpen,
    onSelect: () => navigate(`/mail/${encodeURIComponent(folderMenu.node.fullPath)}`),
  }] : [];
  if (
    folderMenu
    && folderMenu.node.exists
    && !folderMenu.node.disabled
    && Boolean(folderMenu.node.delimiter)
    && folderMenu.node.fullPath.toUpperCase() !== 'SCHEDULED'
  ) {
    folderMenuItems.push({
      id: 'new-subfolder',
      label: 'New subfolder',
      icon: FolderPlus,
      separatorBefore: true,
      onSelect: () => setNewFolderParent(folderMenu.node.fullPath),
    });
  }
  if (folderMenu && !isProtectedFolder(folderMenu.node)) {
    folderMenuItems.push(
      {
        id: 'move',
        label: 'Move…',
        icon: FolderInput,
        separatorBefore: true,
        onSelect: () => setMovingFolder(folderMenu.node),
      },
      {
        id: 'delete',
        label: 'Delete',
        icon: Trash2,
        danger: true,
        onSelect: () => setDeleteFolderConfirm(folderMenu.node),
      },
    );
  }

  const moveDestinations = movingFolder ? folders.filter(folder => {
    const delimiter = movingFolder.delimiter;
    const currentParent = parentFolderPath(movingFolder);
    return !folder.disabled
      && folder.path.toUpperCase() !== 'SCHEDULED'
      && folder.path !== movingFolder.fullPath
      && folder.path !== currentParent
      && !(delimiter && folder.path.startsWith(`${movingFolder.fullPath}${delimiter}`));
  }) : [];

  const moveSelectedFolder = async (parent: string | null) => {
    if (!movingFolder) return;
    const sourcePath = movingFolder.fullPath;
    const nextPath = await onMoveFolder(sourcePath, parent);
    if (
      activeFolder === sourcePath
      || (movingFolder.delimiter && activeFolder.startsWith(`${sourcePath}${movingFolder.delimiter}`))
    ) {
      navigate(`/mail/${encodeURIComponent(`${nextPath}${activeFolder.slice(sourcePath.length)}`)}`);
    }
    showToast({ type: 'success', message: `Moved ${movingFolder.name}` });
  };

  const deleteSelectedFolder = () => {
    if (!deleteFolderConfirm) return;
    const folder = deleteFolderConfirm;
    setDeleteFolderConfirm(null);
    void onDeleteFolder(folder.fullPath).then(() => {
      if (activeFolder === folder.fullPath) navigate('/mail/INBOX');
      showToast({ type: 'success', message: `Deleted ${folder.name}` });
    }).catch(caught => {
      showToast({
        type: 'error',
        message: caught instanceof Error ? caught.message : 'The folder could not be deleted.',
      });
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 12 }}>
      <button className="btn btn-primary" onClick={onCompose} style={{ width: '100%', marginBottom: 16 }}>
        <Edit2 size={16} /> Compose
      </button>
      <div className="mail-folder-list-heading">
        <span>Folders</span>
        <button
          type="button"
          className="mail-folder-add-button"
          aria-label="New folder"
          title="New folder"
          onClick={() => setNewFolderParent(null)}
        >
          <FolderPlus size={16} aria-hidden="true" />
        </button>
      </div>
      <nav aria-label="Mail folders" style={{ flex: 1, overflowY: 'auto' }}>
        {tree.map(node => (
          <FolderItem
            key={node.fullPath}
            node={node}
            activeFolder={activeFolder}
            expandedFolders={expandedFolders}
            onToggleExpand={onToggleExpand}
            onOpenContextMenu={openFolderMenu}
            contextMenuPath={folderMenu?.node.fullPath || null}
            depth={0}
          />
        ))}
      </nav>
      {quota && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border-glass)',
          fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span>{formatBytes(quota.usage)}</span><span>{formatBytes(quota.limit)}</span>
          </div>
          <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)' }}>
            <div style={{ height: '100%', borderRadius: 2,
              width: `${Math.min(100, (quota.usage / quota.limit) * 100)}%`,
              background: quota.usage / quota.limit > 0.9 ? 'var(--danger)' : 'var(--accent-primary)' }} />
          </div>
        </div>
      )}
      {folderMenu && (
        <ContextMenu
          label={`Actions for ${folderMenu.node.name}`}
          point={folderMenu.point}
          items={folderMenuItems}
          onClose={closeFolderMenu}
        />
      )}
      {newFolderParent !== undefined && (
        <NewFolderDialog
          key={newFolderParent || 'top-level'}
          parent={newFolderParent}
          onCreate={onCreateFolder}
          onClose={closeNewFolderDialog}
        />
      )}
      {movingFolder && (
        <FolderDestinationDialog
          title={`Move ${movingFolder.name}`}
          description="Choose the folder that should contain it. The folder name will stay the same."
          folders={moveDestinations}
          includeTopLevel={parentFolderPath(movingFolder) !== null}
          onSelect={moveSelectedFolder}
          onClose={() => setMovingFolder(null)}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleteFolderConfirm)}
        title={`Delete ${deleteFolderConfirm?.name || 'folder'}?`}
        message="Messages in this folder will be permanently deleted. This cannot be undone. Subfolders must be moved or deleted first."
        confirmLabel="Delete folder"
        danger
        onConfirm={deleteSelectedFolder}
        onCancel={() => setDeleteFolderConfirm(null)}
      />
    </div>
  );
}

function FolderItem({
  node,
  activeFolder,
  expandedFolders,
  onToggleExpand,
  onOpenContextMenu,
  contextMenuPath,
  depth,
}: {
  node: FolderTreeNode;
  activeFolder: string;
  expandedFolders: Record<string, boolean>;
  onToggleExpand: (path: string) => void;
  onOpenContextMenu: (node: FolderTreeNode, point: ContextMenuPoint) => void;
  contextMenuPath: string | null;
  depth: number;
}) {
  const navigate = useNavigate();
  const folderButtonRef = useRef<HTMLButtonElement>(null);
  const isExpanded = expandedFolders[node.fullPath];
  const hasChildren = Object.keys(node.children).length > 0;
  const IconComp = ICON_MAP[node.name] || FolderOpen;
  const isActive = activeFolder === node.fullPath;
  const displayName = node.name === 'SCHEDULED' ? 'Scheduled' : node.name;

  const handleNavigate = () => navigate(`/mail/${encodeURIComponent(node.fullPath)}`);
  const openKeyboardMenu = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu')) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    onOpenContextMenu(node, { x: bounds.left + 24, y: bounds.bottom + 4 });
  };

  return (
    <div>
      <div
        className={`nav-item folder-nav-row${isActive ? ' nav-item--active' : ''}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 6px 6px 10px',
          paddingLeft: 12 + depth * 16,
          borderRadius: 'var(--radius-md)',
          cursor: 'pointer',
          fontWeight: isActive ? 600 : 400,
          background: isActive ? 'rgba(59,130,246,0.15)' : 'transparent',
          color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontSize: '0.9rem',
        }}
        onContextMenu={event => {
          event.preventDefault();
          folderButtonRef.current?.focus();
          onOpenContextMenu(node, { x: event.clientX, y: event.clientY });
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${displayName}`}
            aria-expanded={Boolean(isExpanded)}
            style={{
              fontSize: '0.7rem',
              width: 12,
              cursor: 'pointer',
              padding: 0,
              color: 'inherit',
              background: 'none',
              border: 0,
            }}
            onClick={() => onToggleExpand(node.fullPath)}
          >
            {isExpanded ? '▼' : '▶'}
          </button>
        ) : <span aria-hidden="true" style={{ fontSize: '0.7rem', width: 12 }} />}
        <button
          ref={folderButtonRef}
          type="button"
          aria-label={`${displayName}${node.unseen > 0 ? `, ${node.unseen} unread` : ''}`}
          aria-current={isActive ? 'page' : undefined}
          aria-haspopup="menu"
          aria-expanded={contextMenuPath === node.fullPath}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flex: 1,
            minWidth: 0,
            padding: 0,
            color: 'inherit',
            background: 'none',
            border: 0,
            cursor: 'pointer',
            font: 'inherit',
            textAlign: 'left',
          }}
          onClick={handleNavigate}
          onKeyDown={openKeyboardMenu}
        >
          <IconComp size={16} aria-hidden="true" />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</span>
        </button>
        {node.unseen > 0 && (
          <span style={{
            background: 'var(--accent-primary)',
            color: 'white',
            borderRadius: 999,
            padding: '1px 6px',
            fontSize: '0.7rem',
            fontWeight: 600,
          }}>{node.unseen}</span>
        )}
        <button
          type="button"
          className="folder-row-actions"
          aria-label={`Actions for ${displayName}`}
          aria-haspopup="menu"
          aria-expanded={contextMenuPath === node.fullPath}
          title="Folder actions (right-click)"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 24,
            height: 24,
            flexShrink: 0,
            padding: 0,
            color: 'inherit',
            background: 'transparent',
            border: 0,
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
          }}
          onClick={event => {
            event.stopPropagation();
            const bounds = event.currentTarget.getBoundingClientRect();
            onOpenContextMenu(node, { x: bounds.right - 4, y: bounds.bottom + 4 });
          }}
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>
      </div>
      {isExpanded && hasChildren && Object.values(node.children).map(child => (
        <FolderItem
          key={child.fullPath}
          node={child}
          activeFolder={activeFolder}
          expandedFolders={expandedFolders}
          onToggleExpand={onToggleExpand}
          onOpenContextMenu={onOpenContextMenu}
          contextMenuPath={contextMenuPath}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}
