import { useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useNavigate, useParams } from 'react-router';
import { addDays, startOfDay, setHours } from 'date-fns';
import { MessageRow, DENSITY_HEIGHTS } from './MessageRow';
import { MessageListSkeleton } from './components/MessageListSkeleton';
import { MailToolbar } from './MailToolbar';
import { ErrorBanner } from '../shared/components/ErrorBanner';
import type { useMail } from './hooks/useMail';

interface MessageListProps {
  mail: ReturnType<typeof useMail>;
  density: 'compact' | 'cozy' | 'comfortable';
}

export function MessageList({ mail, density }: MessageListProps) {
  const { folder } = useParams<{ folder: string }>();
  const navigate = useNavigate();
  const parentRef = useRef<HTMLDivElement>(null);
  const decodedFolder = folder ? decodeURIComponent(folder) : 'INBOX';

  if (decodedFolder !== mail.activeFolder) {
    mail.setActiveFolder(decodedFolder);
  }

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
    const msg = mail.messages.find((m) => m.uid === uid);
    if (msg) mail.messageAction(msg.isStarred ? 'unstar' : 'star', [uid]);
  };

  if (mail.mailLoading && mail.messages.length === 0) {
    return <MessageListSkeleton density={density} />;
  }

  if (mail.searchError) {
    return <ErrorBanner error={mail.searchError} onRetry={() => mail.doSearch(mail.searchQuery, mail.searchScope)} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <MailToolbar
        selectedCount={mail.selectedMessages.length}
        totalCount={mail.messages.length}
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
    </div>
  );
}
