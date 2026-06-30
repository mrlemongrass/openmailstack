import { Send, Maximize2 } from 'lucide-react';
import { useState } from 'react';

interface InlineReplyProps {
  replyText: string;
  replySending: boolean;
  onReplyTextChange: (text: string) => void;
  onSend: () => void;
  onOpenFullCompose: () => void;
}

export function InlineReply({
  replyText, replySending, onReplyTextChange, onSend, onOpenFullCompose,
}: InlineReplyProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="inline-reply-box" style={{
      borderTop: '2px solid var(--border-glass)', padding: 12,
      background: 'rgba(0,0,0,0.1)',
    }}>
      <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>
        Quick Reply
      </div>
      <textarea
        className="glass-input"
        placeholder="Type your reply..."
        value={replyText}
        onChange={(e) => onReplyTextChange(e.target.value)}
        onFocus={() => setExpanded(true)}
        rows={expanded ? 6 : 3}
        style={{
          width: '100%', resize: 'vertical', minHeight: expanded ? 120 : 60,
          fontFamily: 'inherit', fontSize: '0.9rem',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" disabled={!replyText.trim() || replySending}
            onClick={onSend} style={{ fontSize: '0.85rem', padding: '6px 14px' }}>
            <Send size={14} /> {replySending ? 'Sending...' : 'Send'}
          </button>
          <button className="btn btn-ghost" onClick={onOpenFullCompose} style={{ fontSize: '0.8rem' }}>
            <Maximize2 size={14} /> Rich editor
          </button>
        </div>
      </div>
    </div>
  );
}
