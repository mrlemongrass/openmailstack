import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  Archive,
  Clock,
  Edit2,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Inbox,
  LoaderCircle,
  MailCheck,
  MoreHorizontal,
  RefreshCw,
  Send,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react';
import type {
  FolderDeleteResult,
  FolderMutationWarning,
  FolderPathMutationResult,
  MailFolder,
} from '../shared/types';
import { ContextMenu, type ContextMenuItem } from '../shared/components/ContextMenu';
import { ConfirmDialog } from '../shared/components/ConfirmDialog';
import { useToast } from '../shared/components/Toast';
import type { ContextMenuPoint } from '../shared/context-menu-navigation';
import { FolderDestinationDialog, NewFolderDialog, RenameFolderDialog } from './components/FolderDialogs';
import { buildFolderTree, type FolderTreeNode } from './mail-folder-tree';
import {
  remapFolderSubtreePath,
  type FavoriteFolderRenameCandidate,
} from './folder-mutation-state';

type FolderIcon = React.ComponentType<{ size?: number }>;

interface FolderSidebarProps {
  folders: MailFolder[];
  activeFolder: string;
  expandedFolders: Record<string, boolean>;
  favoriteFolders: string[];
  favoriteRenameCandidates?: FavoriteFolderRenameCandidate[];
  unavailableFavoritePaths?: string[];
  favoriteSettingsReady?: boolean;
  favoriteSettingsError?: string;
  favoritePersistencePending?: boolean;
  favoritePersistenceError?: string;
  folderMutationPending?: boolean;
  markingReadFolder?: string | null;
  onToggleExpand: (path: string) => void;
  onToggleFavorite: (path: string) => Promise<void>;
  onMarkFolderRead: (path: string) => Promise<number>;
  onRetryFavoriteSettings?: () => void;
  onRetryFavoritePersistence: () => Promise<void>;
  onConfirmFavoriteRename: (candidate: FavoriteFolderRenameCandidate) => Promise<void>;
  onDismissFavoriteRename: (candidate: FavoriteFolderRenameCandidate) => void;
  onRemoveUnavailableFavorite: (path: string) => Promise<void>;
  onDismissUnavailableFavorite: (path: string) => void;
  onFolderNavigate?: () => void;
  onFolderDialogChange?: (open: boolean) => void;
  onCompose: () => void;
  onCreateFolder: (parent: string | null, name: string) => Promise<string>;
  onMoveFolder: (path: string, parent: string | null) => Promise<FolderPathMutationResult>;
  onRenameFolder: (path: string, name: string) => Promise<FolderPathMutationResult>;
  onDeleteFolder: (path: string, permanent: boolean) => Promise<FolderDeleteResult>;
  onRetrySearchCleanup?: () => Promise<void>;
  quota: { usage: number; limit: number } | null;
}

interface FolderMenuState {
  node: FolderTreeNode;
  point: ContextMenuPoint;
}

interface FolderDeleteConfirmation {
  node: FolderTreeNode;
  permanent: boolean;
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

function trashFolderFor(folders: MailFolder[]) {
  return folders.find(folder => folder.specialUse?.toLowerCase() === '\\trash');
}

function folderIsInTrash(node: FolderTreeNode, folders: MailFolder[]) {
  const trash = trashFolderFor(folders);
  const delimiter = trash?.delimiter;
  return Boolean(
    trash
    && delimiter
    && node.delimiter === delimiter
    && node.fullPath.startsWith(`${trash.path}${delimiter}`),
  );
}

function folderPathBelongsToTree(path: string, root: FolderTreeNode) {
  return path === root.fullPath
    || Boolean(root.delimiter && path.startsWith(`${root.fullPath}${root.delimiter}`));
}

function folderTreeContainsSpecialUseDescendant(node: FolderTreeNode): boolean {
  return Object.values(node.children).some(child => (
    Boolean(child.specialUse) || folderTreeContainsSpecialUseDescendant(child)
  ));
}

function indexFolderTree(nodes: FolderTreeNode[]) {
  const byPath = new Map<string, FolderTreeNode>();
  const visit = (node: FolderTreeNode) => {
    byPath.set(node.fullPath, node);
    Object.values(node.children).forEach(visit);
  };
  nodes.forEach(visit);
  return byPath;
}

function findFolderFocusTarget(path: string, delimiter: string) {
  const targets = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[data-mail-folder-path]'),
  );
  const exact = targets.find(button => button.dataset.mailFolderPath === path);
  if (exact) return exact;
  const ancestor = targets
    .filter(button => {
      const candidate = button.dataset.mailFolderPath;
      return Boolean(candidate && delimiter && path.startsWith(`${candidate}${delimiter}`));
    })
    .sort((left, right) => (
      (right.dataset.mailFolderPath?.length || 0) - (left.dataset.mailFolderPath?.length || 0)
    ))[0];
  return ancestor || document.querySelector<HTMLButtonElement>('[data-mail-folder-focus-fallback]');
}

export function FolderSidebar({
  folders,
  activeFolder,
  expandedFolders,
  favoriteFolders,
  favoriteRenameCandidates = [],
  unavailableFavoritePaths = [],
  favoriteSettingsReady = true,
  favoriteSettingsError = '',
  favoritePersistencePending = false,
  favoritePersistenceError = '',
  folderMutationPending = false,
  markingReadFolder = null,
  onToggleExpand,
  onToggleFavorite,
  onMarkFolderRead,
  onRetryFavoriteSettings,
  onRetryFavoritePersistence,
  onConfirmFavoriteRename,
  onDismissFavoriteRename,
  onRemoveUnavailableFavorite,
  onDismissUnavailableFavorite,
  onFolderNavigate,
  onFolderDialogChange,
  onCompose,
  onCreateFolder,
  onMoveFolder,
  onRenameFolder,
  onDeleteFolder,
  onRetrySearchCleanup,
  quota,
}: FolderSidebarProps) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [folderMenu, setFolderMenu] = useState<FolderMenuState | null>(null);
  const [newFolderParent, setNewFolderParent] = useState<string | null | undefined>(undefined);
  const [movingFolder, setMovingFolder] = useState<FolderTreeNode | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<FolderTreeNode | null>(null);
  const [deleteFolderConfirm, setDeleteFolderConfirm] = useState<FolderDeleteConfirmation | null>(null);
  const [focusAfterFolderMutation, setFocusAfterFolderMutation] = useState<{
    path: string;
    delimiter: string;
  } | null>(null);
  const tree = buildFolderTree(folders);
  const foldersByPath = indexFolderTree(tree);
  const favoriteNodes = favoriteFolders.flatMap(path => {
    const node = foldersByPath.get(path);
    return node?.exists && !node.disabled && node.fullPath.toUpperCase() !== 'SCHEDULED' ? [node] : [];
  });
  const favoriteActionsDisabled = !favoriteSettingsReady
    || folderMutationPending
    || favoritePersistencePending;
  const closeFolderMenu = useCallback(() => setFolderMenu(null), []);
  const closeNewFolderDialog = useCallback(() => {
    setNewFolderParent(undefined);
    onFolderDialogChange?.(false);
  }, [onFolderDialogChange]);
  const openFolderMenu = useCallback((node: FolderTreeNode, point: ContextMenuPoint) => {
    setFolderMenu({ node, point });
  }, []);
  const navigateToFolder = useCallback((path: string) => {
    navigate(`/mail/${encodeURIComponent(path)}`);
    onFolderNavigate?.();
  }, [navigate, onFolderNavigate]);
  useEffect(() => {
    if (!focusAfterFolderMutation) return;
    const target = findFolderFocusTarget(
      focusAfterFolderMutation.path,
      focusAfterFolderMutation.delimiter,
    );
    if (!target) return;
    target.focus();
    const completedFocus = focusAfterFolderMutation;
    const clearTimer = window.setTimeout(() => {
      setFocusAfterFolderMutation(current => (
        current === completedFocus ? null : current
      ));
    }, 0);
    return () => window.clearTimeout(clearTimer);
  }, [focusAfterFolderMutation, folders]);

  const showFolderMutationOutcome = (
    successMessage: string,
    warnings: FolderMutationWarning[] | undefined,
    messagesPreserved = true,
  ) => {
    const subscriptionWarning = warnings?.includes('SUBSCRIPTIONS_NOT_RECONCILED') || false;
    const searchWarning = warnings?.includes('SEARCH_INDEX_RESET_FAILED') || false;
    const favoriteWarning = warnings?.includes('FAVORITES_NOT_RECONCILED') || false;
    if (!subscriptionWarning && !searchWarning && !favoriteWarning) {
      showToast({ type: 'success', message: successMessage });
      return;
    }

    const committedMutationGuidance = messagesPreserved
      ? 'Messages are intact. Refresh Mail and check folder subscriptions in other mail clients'
      : 'The folder deletion completed. Refresh Mail and check folder subscriptions in other mail clients';
    let message = subscriptionWarning && searchWarning
      ? `${successMessage}, but subscriptions and search cleanup need attention. ${committedMutationGuidance}, then retry search cleanup.`
      : subscriptionWarning
        ? `${successMessage}, but subscriptions could not be updated. ${committedMutationGuidance}.`
        : searchWarning
          ? `${successMessage}, but search cleanup did not finish. Retry search cleanup.`
          : successMessage;
    if (favoriteWarning) {
      message += ' Favorites still need to be updated; use Retry in Favorites.';
    }
    const retryAction = searchWarning && onRetrySearchCleanup ? {
      actionLabel: 'Retry search cleanup',
      onAction: async () => {
        try {
          await onRetrySearchCleanup();
          showToast({ type: 'success', message: 'Search cleanup completed.' });
        } catch (caught) {
          showToast({ type: 'error', message: 'Search cleanup could not be completed.' });
          throw caught;
        }
      },
    } : favoriteWarning && onRetryFavoritePersistence ? {
      actionLabel: 'Retry Favorites',
      onAction: async () => {
        try {
          await onRetryFavoritePersistence();
          showToast({ type: 'success', message: 'Favorites updated.' });
        } catch (caught) {
          showToast({ type: 'error', message: 'Favorites could not be updated.' });
          throw caught;
        }
      },
    } : {};
    showToast({
      type: 'info',
      message,
      duration: 9000,
      ...retryAction,
    });
  };

  const folderMenuItems: ContextMenuItem[] = folderMenu ? [{
    id: 'open',
    label: 'Open',
    icon: FolderOpen,
    onSelect: () => navigateToFolder(folderMenu.node.fullPath),
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
      onSelect: () => {
        onFolderDialogChange?.(true);
        setNewFolderParent(folderMenu.node.fullPath);
      },
    });
  }
  if (folderMenu && !isProtectedFolder(folderMenu.node)) {
    const deletePermanently = folderIsInTrash(folderMenu.node, folders);
    const hasSubfolders = Object.keys(folderMenu.node.children).length > 0;
    const hasProtectedDescendant = folderTreeContainsSpecialUseDescendant(folderMenu.node);
    folderMenuItems.push(
      {
        id: 'rename',
        label: 'Rename…',
        icon: Edit2,
        separatorBefore: true,
        disabled: favoriteActionsDisabled,
        onSelect: () => {
          onFolderDialogChange?.(true);
          setRenamingFolder(folderMenu.node);
        },
      },
      {
        id: 'move',
        label: 'Move…',
        icon: FolderInput,
        disabled: favoriteActionsDisabled,
        onSelect: () => {
          onFolderDialogChange?.(true);
          setMovingFolder(folderMenu.node);
        },
      },
      {
        id: 'delete',
        label: hasProtectedDescendant
          ? 'Contains system folder'
          : deletePermanently
          ? hasSubfolders ? 'Delete subfolders first' : 'Delete permanently'
          : 'Delete',
        icon: Trash2,
        danger: true,
        disabled: favoriteActionsDisabled
          || hasProtectedDescendant
          || (deletePermanently && hasSubfolders),
        onSelect: () => {
          onFolderDialogChange?.(true);
          setDeleteFolderConfirm({ node: folderMenu.node, permanent: deletePermanently });
        },
      },
    );
  }
  if (
    folderMenu
    && folderMenu.node.exists
    && !folderMenu.node.disabled
    && folderMenu.node.fullPath.toUpperCase() !== 'SCHEDULED'
  ) {
    const selectedNode = folderMenu.node;
    const isFavorite = favoriteFolders.includes(selectedNode.fullPath);
    folderMenuItems.push(
      {
        id: 'mark-all-read',
        label: markingReadFolder === selectedNode.fullPath ? 'Marking as read…' : 'Mark all as read',
        icon: MailCheck,
        separatorBefore: true,
        disabled: selectedNode.unseen === 0 || Boolean(markingReadFolder),
        onSelect: () => {
          void onMarkFolderRead(selectedNode.fullPath).then(marked => {
            showToast({
              type: 'success',
              message: marked === 1
                ? `1 message marked as read in ${selectedNode.name}`
                : `${marked} messages marked as read in ${selectedNode.name}`,
            });
          }).catch(caught => {
            showToast({
              type: 'error',
              message: caught instanceof Error ? caught.message : 'The folder could not be marked as read.',
            });
          });
        },
      },
      {
        id: 'favorite',
        label: !favoriteSettingsReady
          ? 'Favorites unavailable'
          : favoritePersistencePending
            ? 'Retry Favorites update first…'
          : folderMutationPending
            ? 'Folder change in progress…'
          : isFavorite ? 'Remove from Favorites' : 'Add to Favorites',
        icon: isFavorite ? StarOff : Star,
        disabled: favoriteActionsDisabled,
        focusAfterSelect: isFavorite
          ? () => findFolderFocusTarget(selectedNode.fullPath, selectedNode.delimiter)
          : undefined,
        onSelect: () => {
          void onToggleFavorite(selectedNode.fullPath).then(() => {
            showToast({
              type: 'success',
              message: isFavorite
                ? `${selectedNode.name} removed from Favorites`
                : `${selectedNode.name} added to Favorites`,
            });
          }).catch(caught => {
            showToast({
              type: 'error',
              message: caught instanceof Error ? caught.message : 'Favorites could not be updated.',
            });
          });
        },
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
    const result = await onMoveFolder(sourcePath, parent);
    const nextPath = result.path;
    const destinationDelimiter = typeof result.delimiter === 'string'
      ? result.delimiter
      : movingFolder.delimiter;
    const nextActiveFolder = remapFolderSubtreePath(
      activeFolder,
      sourcePath,
      nextPath,
      movingFolder.delimiter,
      destinationDelimiter,
    );
    if (nextActiveFolder !== activeFolder) navigate(`/mail/${encodeURIComponent(nextActiveFolder)}`);
    showFolderMutationOutcome(`Moved ${movingFolder.name}`, result.warnings);
  };

  const renameSelectedFolder = async (name: string) => {
    if (!renamingFolder) return;
    const sourcePath = renamingFolder.fullPath;
    const result = await onRenameFolder(sourcePath, name);
    const nextPath = result.path;
    const nextActiveFolder = remapFolderSubtreePath(
      activeFolder,
      sourcePath,
      nextPath,
      renamingFolder.delimiter,
      result.delimiter,
    );
    if (nextActiveFolder !== activeFolder) navigate(`/mail/${encodeURIComponent(nextActiveFolder)}`);
    showFolderMutationOutcome(`Renamed ${renamingFolder.name} to ${name}`, result.warnings);
  };

  const deleteSelectedFolder = () => {
    if (!deleteFolderConfirm) return;
    const { node: folder, permanent } = deleteFolderConfirm;
    setDeleteFolderConfirm(null);
    onFolderDialogChange?.(false);
    void onDeleteFolder(folder.fullPath, permanent).then(result => {
      if (folderPathBelongsToTree(activeFolder, folder)) navigate('/mail/INBOX');
      showFolderMutationOutcome(
        result.disposition === 'trashed'
          ? `${folder.name} moved to Trash`
          : `${folder.name} permanently deleted`,
        result.warnings,
        result.disposition === 'trashed',
      );
      setFocusAfterFolderMutation({
        path: result.disposition === 'trashed' ? result.folder.path : folder.fullPath,
        delimiter: result.disposition === 'trashed'
          ? result.folder.delimiter || folder.delimiter
          : folder.delimiter,
      });
    }).catch(caught => {
      showToast({
        type: 'error',
        message: caught instanceof Error ? caught.message : 'The folder could not be deleted.',
      });
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 12 }}>
      <button className="btn btn-primary" onClick={() => {
        onFolderNavigate?.();
        onCompose();
      }} style={{ width: '100%', marginBottom: 16 }}>
        <Edit2 size={16} /> Compose
      </button>
      <nav aria-label="Mail folders" style={{ flex: 1, overflowY: 'auto' }}>
        {markingReadFolder && (
          <span className="visually-hidden" role="status" aria-live="polite">
            {`Marking ${foldersByPath.get(markingReadFolder)?.name || markingReadFolder} as read`}
          </span>
        )}
        <section className="mail-folder-section" aria-label="Favorite folders">
          <div className="mail-folder-list-heading">
            <span className="mail-folder-list-heading-label">
              <Star size={13} aria-hidden="true" /> Favorites
            </span>
          </div>
          {!favoriteSettingsReady && favoriteSettingsError && (
            <div className="mail-folder-settings-state mail-folder-settings-state--error" role="alert">
              <span>{favoriteSettingsError}</span>
              <button type="button" className="btn btn-ghost" onClick={onRetryFavoriteSettings}>
                <RefreshCw size={13} aria-hidden="true" /> Retry
              </button>
            </div>
          )}
          {!favoriteSettingsReady && !favoriteSettingsError && (
            <div className="mail-folder-settings-state" role="status">Loading Favorites…</div>
          )}
          {favoriteSettingsReady && favoritePersistenceError && (
            <div className="mail-folder-settings-state mail-folder-settings-state--error" role="alert">
              <span>{favoritePersistenceError}</span>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={folderMutationPending}
                onClick={() => {
                  void onRetryFavoritePersistence().then(() => {
                    showToast({ type: 'success', message: 'Favorites updated.' });
                  }).catch(caught => {
                    showToast({
                      type: 'error',
                      message: caught instanceof Error ? caught.message : 'Favorites could not be updated.',
                    });
                  });
                }}
              >
                <RefreshCw size={13} aria-hidden="true" /> Retry
              </button>
            </div>
          )}
          {favoriteSettingsReady
            && !favoritePersistencePending
            && favoriteRenameCandidates.slice(0, 1).map(candidate => (
            <div
              className="mail-folder-settings-state mail-folder-settings-state--repair"
              role="status"
              key={`${candidate.fromPath}\u0000${candidate.toPath}\u0000${candidate.uidValidity}`}
            >
              <span>
                <strong>{candidate.fromPath}</strong> may have been renamed to{' '}
                <strong>{candidate.toPath}</strong> in another mail app.
                {favoriteRenameCandidates.length > 1
                  ? ` ${favoriteRenameCandidates.length - 1} more ${favoriteRenameCandidates.length === 2 ? 'Favorite needs' : 'Favorites need'} review.`
                  : ''}
              </span>
              <span className="mail-folder-repair-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={favoriteActionsDisabled}
                  onClick={() => onDismissFavoriteRename(candidate)}
                >
                  Not now
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={favoriteActionsDisabled}
                  onClick={() => {
                    void onConfirmFavoriteRename(candidate).then(() => {
                      showToast({ type: 'success', message: `Favorite updated to ${candidate.toPath}.` });
                    }).catch(caught => {
                      showToast({
                        type: 'error',
                        message: caught instanceof Error ? caught.message : 'The Favorite could not be updated.',
                      });
                    });
                  }}
                >
                  Update Favorite
                </button>
              </span>
            </div>
          ))}
          {favoriteSettingsReady
            && !favoritePersistencePending
            && favoriteRenameCandidates.length === 0
            && unavailableFavoritePaths.slice(0, 1).map(path => (
            <div
              className="mail-folder-settings-state mail-folder-settings-state--repair"
              role="status"
              key={path}
            >
              <span>
                Favorite folder <strong>{path}</strong> is unavailable. It may have been deleted
                or may no longer be listed by the mail server.
                {unavailableFavoritePaths.length > 1
                  ? ` ${unavailableFavoritePaths.length - 1} more ${unavailableFavoritePaths.length === 2 ? 'Favorite needs' : 'Favorites need'} review.`
                  : ''}
              </span>
              <span className="mail-folder-repair-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={favoriteActionsDisabled}
                  onClick={() => onDismissUnavailableFavorite(path)}
                >
                  Not now
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={favoriteActionsDisabled}
                  onClick={() => {
                    void onRemoveUnavailableFavorite(path).then(() => {
                      showToast({ type: 'success', message: `Removed unavailable Favorite ${path}.` });
                    }).catch(caught => {
                      showToast({
                        type: 'error',
                        message: caught instanceof Error ? caught.message : 'The Favorite could not be removed.',
                      });
                    });
                  }}
                >
                  Remove Favorite
                </button>
              </span>
            </div>
          ))}
          {favoriteSettingsReady && folderMutationPending && (
            <div className="mail-folder-settings-state" role="status">Folder change in progress…</div>
          )}
          {favoriteSettingsReady
            && favoriteNodes.length === 0
            && favoriteRenameCandidates.length === 0
            && unavailableFavoritePaths.length === 0
            && !favoritePersistenceError && (
            <div className="mail-folder-settings-state">Add folders from their actions menu.</div>
          )}
          {favoriteSettingsReady && favoriteNodes.map(node => (
            <FolderItem
              key={node.fullPath}
              node={node}
              activeFolder={activeFolder}
              expandedFolders={expandedFolders}
              onToggleExpand={onToggleExpand}
              onOpenContextMenu={openFolderMenu}
              contextMenuPath={folderMenu?.node.fullPath || null}
              onNavigate={onFolderNavigate}
              markingReadFolder={markingReadFolder}
              depth={0}
              flat
            />
          ))}
        </section>
        <section className="mail-folder-section" aria-label="All folders">
          <div className="mail-folder-list-heading">
            <span>Folders</span>
            <button
              type="button"
              className="mail-folder-add-button"
              aria-label="New folder"
              title="New folder"
              data-mail-folder-focus-fallback
              onClick={() => {
                onFolderDialogChange?.(true);
                setNewFolderParent(null);
              }}
            >
              <FolderPlus size={16} aria-hidden="true" />
            </button>
          </div>
          {tree.map(node => (
            <FolderItem
              key={node.fullPath}
              node={node}
              activeFolder={activeFolder}
              expandedFolders={expandedFolders}
              onToggleExpand={onToggleExpand}
              onOpenContextMenu={openFolderMenu}
              contextMenuPath={folderMenu?.node.fullPath || null}
              onNavigate={onFolderNavigate}
              markingReadFolder={markingReadFolder}
              depth={0}
            />
          ))}
        </section>
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
          onClose={() => {
            setMovingFolder(null);
            onFolderDialogChange?.(false);
          }}
        />
      )}
      {renamingFolder && (
        <RenameFolderDialog
          key={renamingFolder.fullPath}
          path={renamingFolder.fullPath}
          currentName={renamingFolder.name}
          parent={parentFolderPath(renamingFolder)}
          onRename={renameSelectedFolder}
          onClose={() => {
            setRenamingFolder(null);
            onFolderDialogChange?.(false);
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleteFolderConfirm)}
        title={deleteFolderConfirm?.permanent
          ? `Permanently delete ${deleteFolderConfirm.node.name}?`
          : `Move ${deleteFolderConfirm?.node.name || 'folder'} to Trash?`}
        message={deleteFolderConfirm?.permanent
          ? 'This folder and all its messages will be permanently deleted. This cannot be undone.'
          : 'This folder, its subfolders and messages will move to Trash. You can restore it with Move.'}
        confirmLabel={deleteFolderConfirm?.permanent ? 'Delete permanently' : 'Move to Trash'}
        danger={Boolean(deleteFolderConfirm?.permanent)}
        onConfirm={deleteSelectedFolder}
        onCancel={() => {
          setDeleteFolderConfirm(null);
          onFolderDialogChange?.(false);
        }}
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
  onNavigate,
  markingReadFolder,
  depth,
  flat = false,
}: {
  node: FolderTreeNode;
  activeFolder: string;
  expandedFolders: Record<string, boolean>;
  onToggleExpand: (path: string) => void;
  onOpenContextMenu: (node: FolderTreeNode, point: ContextMenuPoint) => void;
  contextMenuPath: string | null;
  onNavigate?: () => void;
  markingReadFolder?: string | null;
  depth: number;
  flat?: boolean;
}) {
  const navigate = useNavigate();
  const folderButtonRef = useRef<HTMLButtonElement>(null);
  const isExpanded = expandedFolders[node.fullPath];
  const hasChildren = !flat && Object.keys(node.children).length > 0;
  const IconComp = ICON_MAP[node.name] || FolderOpen;
  const isActive = activeFolder === node.fullPath;
  const displayName = node.name === 'SCHEDULED' ? 'Scheduled' : node.name;
  const markingRead = markingReadFolder === node.fullPath;

  const handleNavigate = () => {
    navigate(`/mail/${encodeURIComponent(node.fullPath)}`);
    onNavigate?.();
  };
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
          data-mail-folder-path={flat ? undefined : node.fullPath}
          aria-label={`${displayName}${node.unseen > 0 ? `, ${node.unseen} unread` : ''}${markingRead ? ', marking as read' : ''}`}
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
        {markingRead && (
          <span className="folder-row-pending" aria-hidden="true">
            <LoaderCircle size={14} aria-hidden="true" />
          </span>
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
          onNavigate={onNavigate}
          markingReadFolder={markingReadFolder}
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
