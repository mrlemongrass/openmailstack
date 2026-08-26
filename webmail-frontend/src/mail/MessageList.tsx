import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useNavigate, useParams } from 'react-router';
import { addDays, startOfDay, setHours } from 'date-fns';
import { MessageRow, DENSITY_HEIGHTS } from './MessageRow';
import { MessageListSkeleton } from './components/MessageListSkeleton';
import { MailToolbar } from './MailToolbar';
import { ErrorBanner } from '../shared/components/ErrorBanner';
import { EmptyState } from '../shared/components/EmptyState';
import { useToast } from '../shared/components/Toast';
import { ScrollToTop } from '../shared/components/ScrollToTop';
import {
  Archive,
  Clock,
  ExternalLink,
  FolderInput,
  Inbox,
  Loader,
  Mail,
  MailOpen,
  Flag,
  Forward,
  Reply,
  ReplyAll,
  SearchX,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import type { useMail } from './hooks/useMail';
import type { Message } from '../shared/types';
import { ContextMenu, type ContextMenuItem } from '../shared/components/ContextMenu';
import type { ContextMenuPoint } from '../shared/context-menu-navigation';
import {
  groupMessagesByFolder,
  messageFolder,
  messageIdentityKey,
  moveDestinationFolders,
} from './mail-message-identity';
import { isDraftFolder } from './draft-resume';
import { FolderDestinationDialog } from './components/FolderDialogs';
import {
  type MessageComposeAction,
} from './message-compose-actions';

interface MessageListProps {
  mail: ReturnType<typeof useMail>;
  density: 'compact' | 'cozy' | 'comfortable';
}

function composeActionLabel(action: MessageComposeAction): string {
  if (action === 'reply-all') return 'Reply all';
  return action === 'forward' ? 'Forward' : 'Reply';
}

export function MessageList({ mail, density }: MessageListProps) {
  const { showToast } = useToast();
  const { folder } = useParams<{ folder: string }>();
  const navigate = useNavigate();
  const parentRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const flaggingRef = useRef<Set<string>>(new Set());
  const composeStatusRequestRef = useRef(0);
  const [messageMenu, setMessageMenu] = useState<{
    message: Message;
    point: ContextMenuPoint;
  } | null>(null);
  const [movingMessage, setMovingMessage] = useState<Message | null>(null);
  const [preparingComposeAction, setPreparingComposeAction] = useState<MessageComposeAction | null>(null);
  const decodedFolder = folder ? decodeURIComponent(folder) : 'INBOX';
  const {
    activeFolder,
    fetchFolders,
    fetchMessages,
    isSearchActive,
    loadOlderMessages,
    loadingOlderMessages,
    mailMoreAvailable,
    mailPaginationError,
    messages,
    prefetchBodies,
    resetSearchState,
    setActiveFolder,
    setSelectedMessages,
  } = mail;
  const crossFolderSearch = isSearchActive && mail.searchScope === 'all';
  const scheduledFolder = decodedFolder.toUpperCase() === 'SCHEDULED';
  const draftFolder = isDraftFolder(decodedFolder);
  const selectionDisabled = crossFolderSearch || scheduledFolder;
  const activeFolderDetails = mail.folders.find(candidate => candidate.path === decodedFolder);
  const flaggedMessageUids = useMemo(() => new Set(
    mail.messages.filter(message => message.isStarred).map(message => message.uid),
  ), [mail.messages]);

  useEffect(() => {
    if (decodedFolder !== activeFolder) {
      resetSearchState();
      setActiveFolder(decodedFolder);
      setSelectedMessages([]);
    }
  }, [activeFolder, decodedFolder, resetSearchState, setActiveFolder, setSelectedMessages]);

  useEffect(() => {
    composeStatusRequestRef.current += 1;
    parentRef.current?.scrollTo({ top: 0 });
    setMessageMenu(null);
    setMovingMessage(null);
    setPreparingComposeAction(null);
  }, [decodedFolder]);

  useEffect(() => {
    if (!scheduledFolder || isSearchActive) return;
    const timer = window.setInterval(() => {
      void Promise.all([fetchMessages(), fetchFolders()]);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [fetchFolders, fetchMessages, isSearchActive, scheduledFolder]);

  // Pre-fetch message bodies for the first batch of visible messages
  useEffect(() => {
    if (messages.length > 0) {
      const messagesToPrefetch = messages
        .filter((m) => !m.html && !m.text)
        .slice(0, 8);
      for (const [messageFolderPath, uids] of groupMessagesByFolder(messagesToPrefetch, decodedFolder)) {
        prefetchBodies(uids, messageFolderPath);
      }
    }
  }, [decodedFolder, messages, prefetchBodies]);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack virtualizer is intentional for large mailboxes.
  const rowVirtualizer = useVirtualizer({
    count: mail.messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => DENSITY_HEIGHTS[density], [density]),
    overscan: 10,
  });

  useEffect(() => {
    const root = parentRef.current;
    const target = loadMoreRef.current;
    if (
      typeof IntersectionObserver === 'undefined'
      || !root || !target || isSearchActive || !mailMoreAvailable
      || loadingOlderMessages || mailPaginationError
    ) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadOlderMessages();
    }, {
      root: root.scrollHeight > root.clientHeight ? root : null,
      rootMargin: '0px 0px 600px 0px',
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [
    isSearchActive,
    loadOlderMessages,
    loadingOlderMessages,
    mailMoreAvailable,
    mailPaginationError,
    messages.length,
  ]);

  const handleSelect = (uid: number, shift: boolean) => {
    if (shift) {
      const idx = mail.messages.findIndex((m) => m.uid === uid);
      const lastIdx = mail.selectedMessages.length > 0
        ? mail.messages.findIndex((m) => m.uid === mail.selectedMessages[mail.selectedMessages.length - 1])
        : idx;
      const range = mail.messages.slice(Math.min(idx, lastIdx), Math.max(idx, lastIdx) + 1).map((m) => m.uid);
      mail.setSelectedMessages((prev) => [...new Set([...prev, ...range])]);
    } else {
      mail.setSelectedMessages((prev) =>
        prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]);
    }
  };

  const handleFlag = async (msg: Message) => {
    const folderPath = messageFolder(msg, decodedFolder);
    const identity = messageIdentityKey(msg, decodedFolder);
    if (flaggingRef.current.has(identity)) return;
    const wasFlagged = Boolean(msg.isStarred);
    const action = msg.isStarred ? 'unstar' : 'star';
    flaggingRef.current.add(identity);
    mail.setMessages((prev: Message[]) => prev.map((message) => (
      messageIdentityKey(message, decodedFolder) === identity ? { ...message, isStarred: !wasFlagged } : message
    )));
    const success = await mail.messageAction(action, [msg.uid], folderPath);
    if (!success) {
      mail.setMessages((prev: Message[]) => prev.map((message) => (
        messageIdentityKey(message, decodedFolder) === identity
          ? { ...message, isStarred: wasFlagged }
          : message
      )));
      showToast({ type: 'error', message: `The message could not be ${wasFlagged ? 'unflagged' : 'flagged'}.` });
    }
    flaggingRef.current.delete(identity);
  };

  const closeMessageMenu = () => setMessageMenu(null);
  const openMessage = (message: Message) => {
    navigate(`/mail/${encodeURIComponent(messageFolder(message, decodedFolder))}/${message.uid}`);
  };
  const startMessageCompose = async (action: MessageComposeAction, message: Message) => {
    const statusRequestId = ++composeStatusRequestRef.current;
    setPreparingComposeAction(action);
    const folderPath = messageFolder(message, decodedFolder);
    try {
      const result = await mail.prepareMessageCompose(action, message, folderPath);
      if (result === 'unavailable') {
        showToast({
          type: 'error',
          message: `${action === 'forward' ? 'Forward' : 'Reply'} could not be prepared. Try again.`,
        });
      }
      if (result === 'missing-reply-address') {
        showToast({ type: 'error', message: 'This message does not have a reply address.' });
      }
    } finally {
      if (statusRequestId === composeStatusRequestRef.current) setPreparingComposeAction(null);
    }
  };
  const runMessageAction = (action: string, message: Message) => {
    const folderPath = messageFolder(message, decodedFolder);
    void mail.messageAction(action, [message.uid], folderPath).then(success => {
      if (!success) showToast({ type: 'error', message: `The message could not be ${action === 'delete' ? 'deleted' : 'updated'}.` });
    });
  };
  const markMessageAsSpam = (message: Message) => {
    const folderPath = messageFolder(message, decodedFolder);
    void mail.messageAction('spam', [message.uid], folderPath).then(success => {
      showToast({
        type: success ? 'success' : 'error',
        message: success ? 'Message marked as spam' : 'The message could not be marked as spam.',
      });
    });
  };
  const moveSelectedMessage = async (targetFolder: string | null) => {
    if (!movingMessage || !targetFolder) return;
    const sourceFolder = messageFolder(movingMessage, decodedFolder);
    const moved = await mail.messageAction('move', [movingMessage.uid], sourceFolder, targetFolder);
    if (!moved) throw new Error('The message could not be moved.');
    showToast({ type: 'success', message: `Message moved to ${targetFolder}` });
  };
  const messageMenuItems: ContextMenuItem[] = [];
  if (messageMenu) {
    const message = messageMenu.message;
    const isScheduled = Boolean(message.is_scheduled);
    const sourceFolder = messageFolder(message, decodedFolder);
    const isDraft = isDraftFolder(sourceFolder);
    const sourceFolderDetails = mail.folders.find(candidate => candidate.path === sourceFolder);
    const isJunk = sourceFolderDetails?.specialUse?.toLowerCase() === '\\junk'
      || /(^|[/.])(junk|spam)$/i.test(sourceFolder);
    if (isDraft) {
      messageMenuItems.push(
        {
          id: 'open',
          label: 'Open draft',
          icon: ExternalLink,
          onSelect: () => openMessage(message),
        },
        {
          id: 'delete',
          label: 'Delete draft',
          icon: Trash2,
          danger: true,
          separatorBefore: true,
          onSelect: () => runMessageAction('delete', message),
        },
      );
    } else if (isScheduled) {
      messageMenuItems.push({
        id: 'open',
        label: 'Open scheduled message',
        icon: ExternalLink,
        onSelect: () => openMessage(message),
      });
    } else {
      messageMenuItems.push(
        {
          id: 'reply',
          label: 'Reply',
          icon: Reply,
          onSelect: () => { void startMessageCompose('reply', message); },
        },
        {
          id: 'reply-all',
          label: 'Reply all',
          icon: ReplyAll,
          onSelect: () => { void startMessageCompose('reply-all', message); },
        },
        {
          id: 'forward',
          label: 'Forward',
          icon: Forward,
          onSelect: () => { void startMessageCompose('forward', message); },
        },
        {
          id: 'read',
          label: message.isRead ? 'Mark unread' : 'Mark read',
          icon: message.isRead ? MailOpen : Mail,
          separatorBefore: true,
          onSelect: () => runMessageAction(message.isRead ? 'unread' : 'read', message),
        },
        {
          id: 'flag',
          label: message.isStarred ? 'Unflag' : 'Flag',
          icon: Flag,
          onSelect: () => { void handleFlag(message); },
        },
        {
          id: 'archive',
          label: 'Archive',
          icon: Archive,
          onSelect: () => runMessageAction('archive', message),
        },
        {
          id: 'move',
          label: 'Move to…',
          icon: FolderInput,
          onSelect: () => setMovingMessage(message),
        },
        ...(!isJunk ? [{
          id: 'spam',
          label: 'Mark as spam',
          icon: ShieldAlert,
          onSelect: () => markMessageAsSpam(message),
        }] : []),
        {
          id: 'snooze',
          label: 'Snooze until tomorrow',
          icon: Clock,
          onSelect: () => {
            void mail.snoozeMessages(
              [message.uid],
              setHours(startOfDay(addDays(new Date(), 1)), 8),
              messageFolder(message, decodedFolder),
            );
          },
        },
        {
          id: 'delete',
          label: 'Delete',
          icon: Trash2,
          danger: true,
          separatorBefore: true,
          onSelect: () => runMessageAction('delete', message),
        },
        {
          id: 'open',
          label: 'Open message',
          icon: ExternalLink,
          separatorBefore: true,
          onSelect: () => openMessage(message),
        },
      );
    }
  }

  if (mail.mailLoading && mail.messages.length === 0) {
    return <MessageListSkeleton density={density} />;
  }

  if (mail.searchError && !mail.mailError) {
    return <ErrorBanner error={mail.searchError} onRetry={() => mail.doSearch(mail.searchQuery, mail.searchScope)} />;
  }

  if (mail.mailError) {
    return <ErrorBanner error={mail.mailError} onRetry={() => {
      mail.setMailError('');
      void fetchFolders();
      if (isSearchActive) {
        void mail.doSearch(mail.searchQuery, mail.searchScope, mail.searchField);
      } else {
        void fetchMessages();
      }
    }} />;
  }

  if (!mail.mailLoading && mail.messages.length === 0) {
    if (mail.isSearchActive) {
      return (
        <EmptyState
          icon={SearchX}
          title={mail.searchInfo ? 'Search incomplete' : 'No results found'}
          description={mail.searchInfo || `Your search for "${mail.searchQuery}" returned no matches.`}
          action={{ label: 'Clear search', onClick: mail.clearSearch }}
        />
      );
    }
    const isInbox = decodedFolder.toUpperCase() === 'INBOX';
    return (
      <EmptyState
        icon={Inbox}
        title={isInbox ? 'Inbox is empty' : 'Folder is empty'}
        description={isInbox ? 'Messages you receive will appear here.' : `No messages in ${decodedFolder}.`}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {mail.isSearchActive && mail.searchLoading && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 16px', fontSize: '0.8rem',
          color: 'var(--accent-primary)', background: 'rgba(59,130,246,0.08)',
          borderBottom: '1px solid rgba(59,130,246,0.15)',
        }}>
          <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
          Searching...
        </div>
      )}
      {mail.isSearchActive && mail.searchInfo && !mail.searchLoading && (
        <div role="status" style={{
          padding: '6px 16px', fontSize: '0.8rem',
          color: 'var(--warning, #f59e0b)', background: 'rgba(245,158,11,0.08)',
          borderBottom: '1px solid rgba(245,158,11,0.18)',
        }}>
          {mail.searchInfo}
        </div>
      )}
      {preparingComposeAction && (
        <div role="status" aria-live="polite" style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 16px', fontSize: '0.8rem',
          color: 'var(--accent-primary)', background: 'rgba(59,130,246,0.08)',
          borderBottom: '1px solid rgba(59,130,246,0.15)',
        }}>
          <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
          Preparing {composeActionLabel(preparingComposeAction)}…
        </div>
      )}
      {scheduledFolder ? (
        <div role="status" aria-live="polite" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '10px 14px', borderBottom: '1px solid var(--border-glass)',
          color: 'var(--text-secondary)', fontSize: '0.8rem',
        }}>
          <span>Scheduled and delivery-recovery messages</span>
          <span>{mail.messages.length} {mail.messages.length === 1 ? 'message' : 'messages'}</span>
        </div>
      ) : <MailToolbar
        selectedCount={mail.selectedMessages.length}
        allSelectedFlagged={mail.selectedMessages.length > 0
          && mail.selectedMessages.every(uid => flaggedMessageUids.has(uid))}
        totalCount={mail.messages.length}
        activeFolder={mail.activeFolder}
        searchQuery={mail.searchQuery}
        searchField={mail.searchField}
        searchScope={mail.searchScope}
        isSearchActive={mail.isSearchActive}
        selectionDisabled={selectionDisabled}
        draftMode={draftFolder}
        folders={mail.folders}
        onSearchChange={mail.updateSearchQuery}
        onSearchSubmit={mail.submitSearchQuery}
        onSearchFieldChange={mail.changeSearchField}
        onSearchScopeChange={mail.changeSearchScope}
        onClearSearch={mail.clearSearch}
        onSelectAll={() => {
          if (selectionDisabled) return;
          if (mail.selectedMessages.length === mail.messages.length) {
            mail.setSelectedMessages([]);
          } else {
            mail.setSelectedMessages(mail.messages.map((m) => m.uid));
          }
        }}
        onBulkAction={(action) => {
          if (selectionDisabled) return;
          void mail.messageAction(action).then(success => {
            if (!success) {
              showToast({ type: 'error', message: 'The selected messages could not be updated.' });
            }
          });
        }}
        onMoveSelected={(targetFolder) => {
          if (!selectionDisabled) {
            void mail.messageAction('move', undefined, undefined, targetFolder).then((moved) => {
              if (!moved) {
                showToast({ type: 'error', message: 'Could not move the selected messages. Try again.' });
              }
            });
          }
        }}
        onMarkAllRead={selectionDisabled || draftFolder || mail.isSearchActive
          || !activeFolderDetails || activeFolderDetails.unseen === 0
          ? undefined
          : () => {
            void mail.markFolderRead(decodedFolder).then(marked => {
              showToast({
                type: 'success',
                message: marked === 1 ? '1 message marked as read' : `${marked} messages marked as read`,
              });
            }).catch(caught => {
              showToast({
                type: 'error',
                message: caught instanceof Error ? caught.message : 'The folder could not be marked as read.',
              });
            });
          }}
        markAllReadPending={mail.markingReadFolder === decodedFolder}
        markAllReadDisabled={Boolean(mail.markingReadFolder)}
      />}
      <div ref={parentRef} style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const msg = mail.messages[virtualRow.index];
            return (
              <MessageRow key={messageIdentityKey(msg, decodedFolder)} message={msg}
                isSelected={!selectionDisabled && mail.selectedMessages.includes(msg.uid)}
                isThreaded={false} density={density}
                isDraft={isDraftFolder(messageFolder(msg, decodedFolder))}
                selectionDisabled={selectionDisabled}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}
                onSelect={handleSelect}
                onClick={() => navigate(`/mail/${encodeURIComponent(messageFolder(msg, decodedFolder))}/${msg.uid}`)}
                onStar={() => { void handleFlag(msg); }}
                onArchive={() => mail.messageAction('archive', [msg.uid], messageFolder(msg, decodedFolder))}
                onDelete={() => mail.messageAction('delete', [msg.uid], messageFolder(msg, decodedFolder))}
                onMarkRead={() => {
                  mail.messageAction(msg.isRead ? 'unread' : 'read', [msg.uid], messageFolder(msg, decodedFolder));
                }}
                onSnooze={() => {
                  mail.snoozeMessages([msg.uid], setHours(startOfDay(addDays(new Date(), 1)), 8), messageFolder(msg, decodedFolder));
                }}
                onOpenContextMenu={(point) => setMessageMenu({ message: msg, point })} />
            );
          })}
        </div>
        {!isSearchActive && mailMoreAvailable && (
          <div ref={loadMoreRef} role="status" aria-live="polite" aria-busy={loadingOlderMessages} style={{ textAlign: 'center', padding: 12 }}>
            <button className="btn btn-ghost" onClick={loadOlderMessages} disabled={loadingOlderMessages}>
              {mailPaginationError
                ? 'Retry loading older messages'
                : loadingOlderMessages ? 'Loading older messages...' : 'Load older messages'}
            </button>
            {mailPaginationError && (
              <div style={{ marginTop: 6, color: 'var(--danger)', fontSize: '0.75rem' }}>
                {mailPaginationError}
              </div>
            )}
          </div>
        )}
      </div>
      <ScrollToTop scrollRef={parentRef} />
      {messageMenu && (
        <ContextMenu
          label={`Actions for ${messageMenu.message.subject || 'message'}`}
          point={messageMenu.point}
          items={messageMenuItems}
          onClose={closeMessageMenu}
        />
      )}
      {movingMessage && (
        <FolderDestinationDialog
          title="Move message"
          description="Choose where this message should go."
          folders={moveDestinationFolders(
            mail.folders,
            messageFolder(movingMessage, decodedFolder),
          )}
          onSelect={moveSelectedMessage}
          onClose={() => setMovingMessage(null)}
        />
      )}
    </div>
  );
}
