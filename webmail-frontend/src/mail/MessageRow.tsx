import { Star, Paperclip, Archive, Trash2, Mail, MailOpen, Clock, FilePenLine } from 'lucide-react';
import type { Message } from '../shared/types';
import type { ContextMenuPoint } from '../shared/context-menu-navigation';
import { format, isToday, isYesterday } from 'date-fns';
import { useRef } from 'react';

type RowIcon = React.ComponentType<{ size?: number; fill?: string; color?: string }>;

interface MessageRowProps {
  message: Message;
  isSelected: boolean;
  isThreaded: boolean;
  density: 'compact' | 'cozy' | 'comfortable';
  style?: React.CSSProperties;
  onSelect: (uid: number, shift: boolean) => void;
  onClick: (uid: number) => void;
  onStar: (uid: number) => void;
  onArchive: (uid: number) => void;
  onDelete: (uid: number) => void;
  onMarkRead: (uid: number) => void;
  onSnooze: (uid: number) => void;
  onOpenContextMenu: (point: ContextMenuPoint) => void;
  isDraft?: boolean;
  selectionDisabled?: boolean;
  forwardedRef?: React.RefCallback<HTMLDivElement>;
}

export const DENSITY_HEIGHTS = { compact: 48, cozy: 64, comfortable: 80 };

export function MessageRow({
  message, isSelected, density, style, onSelect, onClick, onStar,
  onArchive, onDelete, onMarkRead, onSnooze, isDraft = false,
  onOpenContextMenu, selectionDisabled = false, forwardedRef,
}: MessageRowProps) {
  const padding = density === 'compact' ? '4px 8px' : density === 'cozy' ? '8px 12px' : '12px 16px';
  const isScheduled = Boolean(message.is_scheduled);
  const isRead = isScheduled || isDraft || Boolean(message.isRead);
  const senderValue = isDraft ? message.to || '(no recipients)' : message.from;
  const sender = typeof senderValue === 'string' ? senderValue : String(senderValue || '');
  const deliveryLabel = isScheduled ? ({
    scheduled: 'Scheduled',
    retry_wait: 'Retrying',
    claimed: 'Preparing',
    smtp_inflight: 'Sending',
    sent_copy_pending: 'Sent copy pending',
    failed: 'Failed',
    delivery_uncertain: 'Delivery uncertain',
    partial_delivery: 'Partially delivered',
  } as Record<string, string>)[message.delivery_state || 'scheduled'] || 'Scheduled' : '';
  const dateObj = typeof message.date === 'string' ? new Date(message.date) : message.date;
  let dateStr = '';
  if (dateObj) {
    if (isToday(dateObj)) dateStr = format(dateObj, 'h:mm a');
    else if (isYesterday(dateObj)) dateStr = 'Yesterday';
    else dateStr = format(dateObj, 'MMM d');
  }
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const subject = message.subject || '(no subject)';
  const openLabel = isScheduled
    ? `Open scheduled message ${subject}`
    : isDraft
      ? `Open draft ${subject}`
      : `Open message ${subject}`;

  return (
    <div ref={forwardedRef}
      className="message-row"
      role="group"
      aria-label={`${isScheduled ? 'Scheduled message' : isDraft ? 'Draft' : 'Message'} ${subject}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding,
        height: DENSITY_HEIGHTS[density],
        background: isSelected ? 'rgba(59,130,246,0.12)' : isRead ? 'transparent' : 'rgba(59,130,246,0.04)',
        borderBottom: '1px solid var(--border-glass)',
        ...style,
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        openButtonRef.current?.focus();
        onOpenContextMenu({ x: event.clientX, y: event.clientY });
      }}>
      <input type="checkbox" checked={isSelected} disabled={selectionDisabled}
        aria-label={`Select ${message.subject || 'message'}`}
        title={isScheduled
          ? 'Open the message to view its delivery status or cancel it'
          : isDraft ? 'Select this draft for deletion'
          : selectionDisabled ? 'Open a result to act on its folder' : undefined}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => { e.stopPropagation(); onSelect(message.uid, false); }}
        style={{ flexShrink: 0 }} />
      {isScheduled ? (
        <Clock size={16} aria-hidden="true" style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
      ) : isDraft ? (
        <FilePenLine size={16} aria-hidden="true" style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
      ) : (
        <button onClick={(e) => { e.stopPropagation(); onStar(message.uid); }}
          aria-label={message.isStarred ? 'Unstar message' : 'Star message'}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0,
            color: message.isStarred ? '#f59e0b' : 'var(--text-secondary)', flexShrink: 0 }}>
          <Star size={16} fill={message.isStarred ? '#f59e0b' : 'none'} />
        </button>
      )}
      <button ref={openButtonRef} type="button" className="message-row-open"
        aria-label={openLabel}
        aria-haspopup="menu"
        aria-keyshortcuts="Shift+F10"
        onClick={(event) => {
          if (event.shiftKey && !selectionDisabled) onSelect(message.uid, true);
          else onClick(message.uid);
        }}
        onKeyDown={(event) => {
          if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
            event.preventDefault();
            const bounds = event.currentTarget.getBoundingClientRect();
            onOpenContextMenu({ x: bounds.left + 32, y: bounds.top + 32 });
          }
        }}
        style={{
          alignItems: 'center', alignSelf: 'stretch', background: 'none', border: 0,
          color: 'inherit', cursor: 'pointer', display: 'flex', flex: 1, font: 'inherit',
          gap: 8, minWidth: 0, padding: 0, textAlign: 'left',
        }}>
        <span style={{ width: 28, height: 28, borderRadius: '50%',
          background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-purple))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.7rem', fontWeight: 600, flexShrink: 0, color: 'white' }}>
          {(sender || '?')[0].toUpperCase()}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', justifyContent: 'space-between',
            fontWeight: isRead ? 400 : 600,
            fontSize: density === 'compact' ? '0.8rem' : '0.9rem' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              color: isRead ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
              {sender.split('<')[0]?.trim() || sender}
            </span>
            <span style={{ flexShrink: 0, marginLeft: 8, display: 'flex', gap: 4, alignItems: 'center' }}>
              <span className="message-row-date">{dateStr}</span>
              {message.hasAttachments && <Paperclip size={12} />}
            </span>
          </span>
          <span style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2,
            fontSize: density === 'compact' ? '0.75rem' : '0.82rem', color: 'var(--text-secondary)' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              fontWeight: isRead ? 400 : 500 }}>
              {subject}
            </span>
            {deliveryLabel && (
              <span style={{
                flexShrink: 0, marginLeft: 8, padding: '1px 6px', borderRadius: 999,
                color: message.delivery_state === 'failed' || message.delivery_state === 'delivery_uncertain'
                  || message.delivery_state === 'partial_delivery'
                  ? 'var(--danger)' : 'var(--accent-primary)',
                background: 'color-mix(in srgb, currentColor 10%, transparent)',
                fontSize: '0.68rem', fontWeight: 600,
              }}>
                {deliveryLabel}
              </span>
            )}
          </span>
          {density === 'comfortable' && message.preview && (
            <span style={{
              display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              marginTop: 1, opacity: 0.7,
            }}>
              {message.preview}
            </span>
          )}
        </span>
      </button>
      {isDraft ? (
        <span className="message-row-actions" style={{ display: 'flex', gap: 2, opacity: 0, transition: 'opacity 0.15s ease' }}>
          <ActionButton icon={Trash2} title="Delete draft" onClick={() => onDelete(message.uid)} />
        </span>
      ) : !isScheduled && <span className="message-row-actions" style={{ display: 'flex', gap: 2, opacity: 0, transition: 'opacity 0.15s ease' }}>
        <ActionButton icon={Archive} title="Archive" onClick={() => onArchive(message.uid)} />
        <ActionButton icon={Trash2} title="Delete" onClick={() => onDelete(message.uid)} />
        <ActionButton icon={message.isRead ? Mail : MailOpen} title={message.isRead ? 'Mark unread' : 'Mark read'}
          onClick={() => onMarkRead(message.uid)} />
        <ActionButton icon={Star} title="Star" onClick={() => onStar(message.uid)} />
        <ActionButton icon={Clock} title="Snooze" onClick={() => onSnooze(message.uid)} />
      </span>}
    </div>
  );
}

function ActionButton({ icon: Icon, title, onClick }: {
  icon: RowIcon; title: string; onClick: () => void;
}) {
  return (
    <button className="btn btn-ghost" title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{ padding: '2px 4px', borderRadius: 4 }}>
      <Icon size={14} />
    </button>
  );
}
