import { ignoreMailShortcut, type MailSort } from './mail-list-controls';
import { KeyboardHelp } from '../shared/components/KeyboardHelp';
import { MailSelectionDialog } from './MailSelectionDialog';
import { selectionRequest, type MailSelection } from './mail-selection-api';
import { useEffect, useRef, useCallback, useState, type ReactNode } from 'react';
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
  ListFilter,
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
  messageComposeActionLabel,
  type MessageComposeAction,
} from './message-compose-actions';

interface MessageListProps {
  mail: ReturnType<typeof useMail>;
  density: 'compact' | 'cozy' | 'comfortable';
}

export function MessageList({ mail, density }: MessageListProps) {
  const { showToast } = useToast();
  const { folder } = useParams<{ folder: string }>();
  const navigate = useNavigate();
  const parentRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const flaggingRef = useRef<Set<string>>(new Set());
  const composeStatusRequestRef = useRef(0);
  const [keyboardHelp, setKeyboardHelp] = useState(false);
  const [folderPicker, setFolderPicker] = useState(false);
  const [focusedKey, setFocusedKey] = useState('');
  const pendingFocus = useRef(false);
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

  const scheduledFolder = decodedFolder.toUpperCase() === 'SCHEDULED';
  const draftFolder = isDraftFolder(decodedFolder);
  const selectionDisabled = scheduledFolder;
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<MailSelection | null>(null);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const selectionRequestRef = useRef<AbortController | null>(null);
  const [bulkDialog, setBulkDialog] = useState<{ selection: MailSelection; action: string; targetFolder?: string } | null>(null);
  const ownedSelectionToken = bulkDialog?.selection.token || snapshot?.token;
  useEffect(() => () => { if (ownedSelectionToken) void selectionRequest(`/${ownedSelectionToken}`, 'DELETE').catch(() => undefined); }, [ownedSelectionToken]);
  const selectedRows = mail.messages.filter(m => selectedKeys.includes(messageIdentityKey(m, decodedFolder)));
  const allSelectedJunk = snapshot?.allJunk ?? (selectedRows.length > 0 && selectedRows.every(m => mail.folders.some(f => f.path === messageFolder(m, decodedFolder) && f.specialUse?.toLowerCase() === '\\junk')));
  const selectionScope = `${decodedFolder}\u0000${mail.searchQuery}\u0000${mail.searchField}\u0000${mail.searchScope}`;
  useEffect(() => {
    setSelectedKeys([]); setSnapshot(null); setSelectionLoading(false);
    selectionRequestRef.current?.abort();
    return () => selectionRequestRef.current?.abort();
  }, [selectionScope]);
  const prepareSelection = async (all: boolean, action?: string, targetFolder?: string) => {
    if (selectionRequestRef.current) return;
    const controller = new AbortController(); selectionRequestRef.current = controller; setSelectionLoading(true);
    try {
      const selection = snapshot || await selectionRequest('', 'POST', all
        ? { query: isSearchActive ? mail.searchQuery : '', field: isSearchActive ? mail.searchField : 'all', scope: isSearchActive ? mail.searchScope : 'folder', folder: decodedFolder }
        : { messages: selectedRows.map(m => ({ folder: messageFolder(m, decodedFolder), uid: m.uid })) }, controller.signal);
      if (controller.signal.aborted) { void selectionRequest(`/${selection.token}`, 'DELETE').catch(() => undefined); return; }
      if (action) setBulkDialog({ selection, action, targetFolder }); else setSnapshot(selection);
    } catch (err) { if (!controller.signal.aborted) showToast({ type: 'error', message: (err as Error).message }); }
    finally { if (selectionRequestRef.current === controller) { selectionRequestRef.current = null; setSelectionLoading(false); } }
  };
  const activeFolderDetails = mail.folders.find(candidate => candidate.path === decodedFolder);


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

  const selectionAnchor = useRef<string | null>(null);
  const handleSelect = (message: Message, shift: boolean) => {
    setSnapshot(null);
    const key = messageIdentityKey(message, decodedFolder);
    const keys = mail.messages.map(m => messageIdentityKey(m, decodedFolder));
    if (shift && selectionAnchor.current && keys.includes(selectionAnchor.current)) {
      const from = keys.indexOf(selectionAnchor.current), to = keys.indexOf(key);
      setSelectedKeys(prev => [...new Set([...prev, ...keys.slice(Math.min(from, to), Math.max(from, to) + 1)])]);
    } else {
      selectionAnchor.current = key;
      setSelectedKeys(prev => prev.includes(key) ? prev.filter(item => item !== key) : [...prev, key]);
    }
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (mail.mailSettings.reading.shortcuts === 'off' || ignoreMailShortcut(event)) return;
      const key = event.key.toLowerCase();
      if (key === '/') { event.preventDefault(); document.querySelector<HTMLInputElement>('[placeholder="Search messages..."]')?.focus(); return; }
      if (key === 'c') { event.preventDefault(); void mail.startCompose(); return; }
      if (key === 'g') { event.preventDefault(); setFolderPicker(true); return; }
      if (key === '?' && !window.location.pathname.match(/\/\d+$/)) { event.preventDefault(); setKeyboardHelp(true); return; }
      const index = mail.messages.findIndex(m => messageIdentityKey(m, decodedFolder) === focusedKey);
      const direction = key === 'arrowdown' || (key === 'j' && mail.mailSettings.reading.shortcuts !== 'standard') ? 1
        : key === 'arrowup' || (key === 'k' && mail.mailSettings.reading.shortcuts !== 'standard') ? -1 : 0;
      if (direction && mail.messages.length) {
        event.preventDefault();
        const next = Math.max(0, Math.min(mail.messages.length - 1, index < 0 ? 0 : index + direction));
        const message = mail.messages[next];
        if (event.shiftKey && !selectionDisabled) { if (!selectionAnchor.current && index >= 0) selectionAnchor.current = focusedKey; handleSelect(message, true); }
        pendingFocus.current = true; setFocusedKey(messageIdentityKey(message, decodedFolder)); rowVirtualizer.scrollToIndex(next);
      } else if (key === 'x' && index >= 0 && !selectionDisabled) { event.preventDefault(); handleSelect(mail.messages[index], event.shiftKey); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });

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
      if (typeof result === 'object') showToast({ type: 'error', ...result });
    } finally {
      if (statusRequestId === composeStatusRequestRef.current) setPreparingComposeAction(null);
    }
  };
  const runMessageAction = (action: string, message: Message) => {
    const folderPath = messageFolder(message, decodedFolder);
    if (action === 'notspam') { void mail.messageAction(action, [message.uid], folderPath); return; }
    void mail.messageAction(action, [message.uid], folderPath).then(success => {
      if (!success) showToast({ type: 'error', message: `The message could not be ${action === 'delete' ? 'deleted' : 'updated'}.` });
    });
  };
  const markMessageAsSpam = (message: Message) => {
    const folderPath = messageFolder(message, decodedFolder);
    void mail.messageAction('spam', [message.uid], folderPath);
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
        ...(['create', 'add'] as const).map(mode => ({
          id: `${mode}-rule`, label: mode === 'create' ? 'Create rule…' : 'Add to existing rule…', icon: ListFilter,
          separatorBefore: mode === 'create',
          onSelect: () => navigate('/message-rule', { state: { mode, from: message.from, returnTo: `/mail/${encodeURIComponent(decodedFolder)}` } }),
        })),
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
        }] : [{ id: 'notspam', label: 'Not junk…', icon: ShieldAlert, onSelect: () => runMessageAction('notspam', message) }]),
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

  let listStatus: ReactNode = null;
  if (mail.mailLoading && mail.messages.length === 0) listStatus = <MessageListSkeleton density={density} />;
  else if (mail.searchError || mail.mailError) listStatus = <ErrorBanner error={mail.searchError || mail.mailError} onRetry={() => {
    mail.setMailError(''); void fetchFolders();
    if (isSearchActive) void mail.doSearch(mail.searchQuery, mail.searchScope, mail.searchField);
    else void fetchMessages();
  }} />;
  else if (!mail.mailLoading && mail.messages.length === 0) {
    const isInbox = decodedFolder.toUpperCase() === 'INBOX';
    listStatus = isSearchActive
      ? <EmptyState icon={SearchX} title={mail.searchInfo ? 'Search incomplete' : 'No results found'} description={mail.searchInfo || `Your search for "${mail.searchQuery}" returned no matches.`} action={{ label: 'Clear search', onClick: mail.clearSearch }} />
      : <EmptyState icon={Inbox} title={isInbox ? 'Inbox is empty' : 'Folder is empty'} description={isInbox ? 'Messages you receive will appear here.' : `No messages in ${decodedFolder}.`} />;
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
          Preparing {messageComposeActionLabel(preparingComposeAction)}…
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
        selectedCount={snapshot?.count ?? selectedRows.length}
        allSelectedFlagged={selectedRows.length > 0 && selectedRows.every(m => m.isStarred)}
        junkMode={allSelectedJunk} busy={selectionLoading || mail.bulkBusy}
        totalCount={snapshot?.count ?? mail.messages.length}
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
          setSnapshot(null);
          setSelectedKeys(selectedRows.length === mail.messages.length ? [] : mail.messages.map(m => messageIdentityKey(m, decodedFolder)));
        }}
        onBulkAction={action => { void prepareSelection(false, action); }}
        onMoveSelected={targetFolder => { void prepareSelection(false, 'move', targetFolder); }}
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
      {!scheduledFolder && <div style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid var(--border-glass)' }}>
        <label>Sort loaded messages <select className="glass-input glass-select" value={mail.mailSort} onChange={e => mail.setMailSort(e.target.value as MailSort)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="sender-asc">Sender A–Z</option><option value="sender-desc">Sender Z–A</option><option value="subject-asc">Subject A–Z</option><option value="subject-desc">Subject Z–A</option></select></label>
        <button className="btn btn-ghost" onClick={() => mail.changeSearchField('unread')}>Unread</button>
        <button className="btn btn-ghost" onClick={() => mail.changeSearchField('starred')}>Flagged</button>
        <button className="btn btn-ghost" onClick={() => { mail.changeSearchField('all'); mail.updateSearchQuery('has:attachment'); }}>Attachments</button>
        {isSearchActive && <button className="btn btn-ghost" onClick={mail.clearSearch}>Clear filters</button>}
        <button className="btn btn-ghost" onClick={() => setKeyboardHelp(true)}>Keyboard help</button>
        <button className="btn btn-ghost" onClick={() => navigate('/settings/mail_reading')}>Reading settings</button>
      </div>}
      {!scheduledFolder && (selectedRows.length > 0 || snapshot || selectionLoading) && <div role="status" style={{ padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span>{snapshot ? `${snapshot.count.toLocaleString()} matching messages selected` : `${selectedRows.length} of ${mail.messages.length} loaded messages selected`}</span>
        {!snapshot && !selectionLoading && <button className="btn btn-ghost" onClick={() => void prepareSelection(true)}>Select all matching messages…</button>}
        {selectionLoading && <button className="btn btn-ghost" onClick={() => selectionRequestRef.current?.abort()}>Cancel selection</button>}
        <button className="btn btn-ghost" onClick={() => { if (snapshot) void selectionRequest(`/${snapshot.token}`, 'DELETE').catch(() => undefined); setSnapshot(null); setSelectedKeys([]); }}>Clear selection</button>
      </div>}
      <div ref={parentRef} style={{ flex: 1, overflow: 'auto' }}>
        {listStatus}
        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const msg = mail.messages[virtualRow.index];
            return (
              <MessageRow key={messageIdentityKey(msg, decodedFolder)} message={msg}
                isSelected={!selectionDisabled && (Boolean(snapshot) || selectedKeys.includes(messageIdentityKey(msg, decodedFolder)))}
                isThreaded={mail.mailSettings.reading.threaded} showSnippets={mail.mailSettings.reading.snippets} density={density}
                isDraft={isDraftFolder(messageFolder(msg, decodedFolder))}
                selectionDisabled={selectionDisabled}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}
                forwardedRef={node => { if (node && pendingFocus.current && focusedKey === messageIdentityKey(msg, decodedFolder)) { pendingFocus.current = false; node.querySelector<HTMLButtonElement>('.message-row-open')?.focus(); } }}
                onSelect={(_uid, shift) => handleSelect(msg, shift)}
                onClick={() => { setFocusedKey(messageIdentityKey(msg, decodedFolder)); navigate(`/mail/${encodeURIComponent(messageFolder(msg, decodedFolder))}/${msg.uid}`); }}
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
      <KeyboardHelp open={keyboardHelp} onClose={() => setKeyboardHelp(false)} />
      {folderPicker && <FolderDestinationDialog title="Go to folder" description="Choose a folder to open." folders={mail.folders.filter(f => !f.disabled)} onSelect={async path => { if (path) navigate(`/mail/${encodeURIComponent(path)}`); }} onClose={() => setFolderPicker(false)} />}
      {bulkDialog && <MailSelectionDialog initial={bulkDialog.selection} action={bulkDialog.action} targetFolder={bulkDialog.targetFolder} folders={mail.folders}
        onBusy={mail.setBulkBusy} navigationBlocked={mail.bulkRouteBlocked}
        onBatch={batch => mail.applyConfirmedBatch(bulkDialog.action, batch)}
        onChanged={() => { if (isSearchActive) void mail.doSearch(mail.searchQuery, mail.searchScope, mail.searchField); else void mail.fetchMessages(); void mail.fetchFolders(); window.dispatchEvent(new Event('oms:sender-policy')); }}
        onClose={() => { void selectionRequest(`/${bulkDialog.selection.token}`, 'DELETE').catch(() => undefined); setBulkDialog(null); setSnapshot(null); setSelectedKeys([]); }} />}

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
