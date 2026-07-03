import { useEffect, useRef, useCallback } from 'react';
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
import { Inbox, SearchX, Loader } from 'lucide-react';
import type { useMail } from './hooks/useMail';

interface MessageListProps {
  mail: ReturnType<typeof useMail>;
  density: 'compact' | 'cozy' | 'comfortable';
}

export function MessageList({ mail, density }: MessageListProps) {
  const { showToast } = useToast();
  const { folder } = useParams<{ folder: string }>();
  const navigate = useNavigate();
  const parentRef = useRef<HTMLDivElement>(null);
  const starringRef = useRef<Set<number>>(new Set());
  const decodedFolder = folder ? decodeURIComponent(folder) : 'INBOX';
  const { activeFolder, setActiveFolder, setIsSearchActive, setSelectedMessages } = mail;

  useEffect(() => {
    if (decodedFolder !== activeFolder) {
      setActiveFolder(decodedFolder);
      setSelectedMessages([]);
      setIsSearchActive(false);
    }
  }, [activeFolder, decodedFolder, setActiveFolder, setIsSearchActive, setSelectedMessages]);

  // Pre-fetch message bodies for the first batch of visible messages
  useEffect(() => {
    if (mail.messages.length > 0 && folder) {
      const uidsToPreFetch = mail.messages
        .filter((m) => !m.html && !m.text)
        .slice(0, 8)
        .map((m) => m.uid);
      if (uidsToPreFetch.length > 0) {
        mail.prefetchBodies(uidsToPreFetch, decodeURIComponent(folder));
      }
    }
  }, [mail.messages, folder, mail.prefetchBodies]);

  const rowVirtualizer = useVirtualizer({
    count: mail.messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => DENSITY_HEIGHTS[density], [density]),
    overscan: 10,
  });

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

  const handleClick = (uid: number) => {
    navigate(`/mail/${encodeURIComponent(decodedFolder)}/${uid}`);
  };

  const handleStar = (uid: number) => {
    if (starringRef.current.has(uid)) return; // guard against rapid double-clicks
    const msg = mail.messages.find((m) => m.uid === uid);
    if (!msg) return;
    const action = msg.isStarred ? 'unstar' : 'star';
    // Optimistic update: immediately toggle local state
    starringRef.current.add(uid);
    mail.setMessages((prev: any[]) => prev.map((m) => m.uid === uid ? { ...m, isStarred: !msg.isStarred } : m));
    mail.messageAction(action, [uid]).finally(() => {
      starringRef.current.delete(uid);
    });
  };

  if (mail.mailLoading && mail.messages.length === 0) {
    return <MessageListSkeleton density={density} />;
  }

  if (mail.searchError && !mail.mailError) {
    return <ErrorBanner error={mail.searchError} onRetry={() => mail.doSearch(mail.searchQuery, mail.searchScope)} />;
  }

  if (mail.mailError) {
    return <ErrorBanner error={mail.mailError} onRetry={() => { mail.setMailError(''); mail.fetchFolders(); mail.fetchMessages(); }} />;
  }

  if (!mail.mailLoading && mail.messages.length === 0) {
    if (mail.isSearchActive) {
      return (
        <EmptyState
          icon={SearchX}
          title="No results found"
          description={`Your search for "${mail.searchQuery}" returned no matches.`}
          action={{ label: 'Clear search', onClick: () => { mail.setSearchQuery(''); mail.setIsSearchActive(false); } }}
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
      <MailToolbar
        selectedCount={mail.selectedMessages.length}
        totalCount={mail.messages.length}
        activeFolder={mail.activeFolder}
        searchQuery={mail.searchQuery}
        onSearchChange={mail.setSearchQuery}
        onSelectAll={() => {
          if (mail.selectedMessages.length === mail.messages.length) {
            mail.setSelectedMessages([]);
          } else {
            mail.setSelectedMessages(mail.messages.map((m) => m.uid));
          }
        }}
        onBulkAction={(action) => mail.messageAction(action)}
        onMarkAllRead={() => {
          const allUids = mail.messages.map((m) => m.uid);
          if (allUids.length > 0) {
            mail.messageAction('read', allUids);
            showToast({ type: 'success', message: `${allUids.length} messages marked as read` });
          }
        }}
      />
      <div ref={parentRef} style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const msg = mail.messages[virtualRow.index];
            return (
              <MessageRow key={msg.uid} message={msg}
                isSelected={mail.selectedMessages.includes(msg.uid)}
                isThreaded={false} density={density}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}
                onSelect={handleSelect} onClick={handleClick} onStar={handleStar}
                onArchive={(uid) => mail.messageAction('archive', [uid])}
                onDelete={(uid) => mail.messageAction('delete', [uid])}
                onMarkRead={(uid) => {
                  const m = mail.messages.find((msg) => msg.uid === uid);
                  if (m) mail.messageAction(m.isRead ? 'unread' : 'read', [uid]);
                }}
                onSnooze={(uid) => {
                  mail.snoozeMessages([uid], setHours(startOfDay(addDays(new Date(), 1)), 8));
                }} />
            );
          })}
        </div>
        {mail.mailMoreAvailable && (
          <div style={{ textAlign: 'center', padding: 12 }}>
            <button className="btn btn-ghost" onClick={mail.loadOlderMessages} disabled={mail.loadingOlderMessages}>
              {mail.loadingOlderMessages ? 'Loading...' : 'Load older messages'}
            </button>
          </div>
        )}
      </div>
      <ScrollToTop scrollRef={parentRef} />
    </div>
  );
}
