import { Star, Paperclip } from 'lucide-react';
import type { Message } from '../shared/types';
import { format, isToday, isYesterday } from 'date-fns';

interface MessageRowProps {
  message: Message;
  isSelected: boolean;
  isThreaded: boolean;
  density: 'compact' | 'cozy' | 'comfortable';
  style?: React.CSSProperties;
  onSelect: (uid: number, shift: boolean) => void;
  onClick: (uid: number) => void;
  onStar: (uid: number) => void;
  forwardedRef?: React.RefCallback<HTMLDivElement>;
}

export const DENSITY_HEIGHTS = { compact: 48, cozy: 64, comfortable: 80 };

export function MessageRow({
  message, isSelected, density, style, onSelect, onClick, onStar, forwardedRef,
}: MessageRowProps) {
  const padding = density === 'compact' ? '4px 8px' : density === 'cozy' ? '8px 12px' : '12px 16px';
  const dateObj = typeof message.date === 'string' ? new Date(message.date) : message.date;
  let dateStr = '';
  if (dateObj) {
    if (isToday(dateObj)) dateStr = format(dateObj, 'h:mm a');
    else if (isYesterday(dateObj)) dateStr = 'Yesterday';
    else dateStr = format(dateObj, 'MMM d');
  }

  return (
    <div ref={forwardedRef}
      className="message-row"
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding,
        height: DENSITY_HEIGHTS[density], cursor: 'pointer',
        background: isSelected ? 'rgba(59,130,246,0.12)' : message.isRead ? 'transparent' : 'rgba(59,130,246,0.04)',
        borderBottom: '1px solid var(--border-glass)',
        ...style,
      }}
      onClick={(e) => { if (e.shiftKey) onSelect(message.uid, true); else onClick(message.uid); }}>
      <input type="checkbox" checked={isSelected}
        onChange={(e) => { e.stopPropagation(); onSelect(message.uid, false); }}
        style={{ flexShrink: 0 }} />
      <button onClick={(e) => { e.stopPropagation(); onStar(message.uid); }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          color: message.isStarred ? '#f59e0b' : 'var(--text-secondary)', flexShrink: 0 }}>
        <Star size={16} fill={message.isStarred ? '#f59e0b' : 'none'} />
      </button>
      <div style={{ width: 28, height: 28, borderRadius: '50%',
        background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-purple))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.7rem', fontWeight: 600, flexShrink: 0, color: 'white' }}>
        {(message.from || '?')[0].toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between',
          fontWeight: message.isRead ? 400 : 600,
          fontSize: density === 'compact' ? '0.8rem' : '0.9rem' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: message.isRead ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
            {message.from?.split('<')[0]?.trim() || message.from}
          </span>
          <span style={{ flexShrink: 0, marginLeft: 8, fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            {dateStr}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2,
          fontSize: density === 'compact' ? '0.75rem' : '0.82rem', color: 'var(--text-secondary)' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontWeight: message.isRead ? 400 : 500 }}>
            {message.subject || '(no subject)'}
          </span>
          <span style={{ flexShrink: 0, marginLeft: 8, display: 'flex', gap: 4, alignItems: 'center' }}>
            {message.hasAttachments && <Paperclip size={12} />}
          </span>
        </div>
      </div>
    </div>
  );
}
