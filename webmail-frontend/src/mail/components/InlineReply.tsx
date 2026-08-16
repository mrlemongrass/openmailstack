import { Send, Maximize2, Archive } from 'lucide-react';
import { useState } from 'react';
import { Spinner } from '../../shared/components/Spinner';

interface InlineReplyProps {
  replyTo: string;
  replyText: string;
  replySending: boolean;
  onReplyTextChange: (text: string) => void;
  onSend: () => void;
  onSendAndArchive: () => void;
  onOpenFullCompose: () => void;
  showSendAndArchive?: boolean;
  sendPhase?: 'idle' | 'pending' | 'retryable' | 'uncertain' | 'blocked';
  sendNotice?: { tone: 'info' | 'warning'; message: string } | null;
  checkingEarlierSend?: boolean;
  onCheckEarlierSend?: () => void;
  onVerifiedNonDelivery?: () => void;
}

export function InlineReply({
  replyTo, replyText, replySending, onReplyTextChange, onSend, onSendAndArchive,
  onOpenFullCompose, showSendAndArchive = true, sendPhase = 'idle', sendNotice = null,
  checkingEarlierSend = false, onCheckEarlierSend, onVerifiedNonDelivery,
}: InlineReplyProps) {
  const [expanded, setExpanded] = useState(false);
  const sendBlocked = sendPhase === 'uncertain' || sendPhase === 'blocked';
  const replyBusy = replySending || checkingEarlierSend;

  return (
    <div className="inline-reply-box" style={{
      borderTop: '2px solid var(--border-glass)', padding: 12,
      background: 'rgba(0,0,0,0.1)',
    }}>
      <div style={{ fontSize: '0.8rem', marginBottom: 8 }}>
        <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>Reply to </span>
        <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{replyTo}</span>
      </div>
      {sendNotice && (
        <div
          className={`inline-reply-send-notice ${sendNotice.tone}`}
          role={sendNotice.tone === 'warning' ? 'alert' : 'status'}
          aria-live={sendNotice.tone === 'warning' ? 'assertive' : 'polite'}
        >
          <span>{sendNotice.message}</span>
          {sendBlocked && onCheckEarlierSend && (
            <div className="inline-reply-send-resolution-actions">
              <button
                type="button"
                className="btn btn-ghost"
                disabled={checkingEarlierSend}
                onClick={onCheckEarlierSend}
              >
                {checkingEarlierSend ? <><Spinner size={12} /> Checking...</> : 'Check earlier send'}
              </button>
              {sendPhase === 'uncertain' && onVerifiedNonDelivery && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={checkingEarlierSend}
                  onClick={onVerifiedNonDelivery}
                >
                  I verified it was not delivered
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <textarea
        className="glass-input"
        placeholder="Type your reply..."
        value={replyText}
        disabled={replyBusy}
        onChange={(e) => onReplyTextChange(e.target.value)}
        onFocus={() => setExpanded(true)}
        rows={expanded ? 6 : 3}
        style={{
          width: '100%', resize: 'vertical', minHeight: expanded ? 120 : 60,
          fontFamily: 'inherit', fontSize: '0.9rem',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <div className="inline-reply-actions">
          <button className="btn btn-primary" disabled={!replyText.trim() || replyBusy || sendBlocked}
            onClick={onSend} style={{ fontSize: '0.85rem', padding: '6px 14px' }}>
            <Send size={14} /> {replySending
              ? <><Spinner size={12} /> Sending...</>
              : sendBlocked ? 'Do not resend' : 'Send'}
          </button>
          {showSendAndArchive && (
            <button className="btn btn-ghost" disabled={!replyText.trim() || replyBusy || sendBlocked}
              onClick={onSendAndArchive} style={{ fontSize: '0.8rem' }} title="Send & Archive">
              <Archive size={14} /> Send & Archive
            </button>
          )}
          <button className="btn btn-ghost" disabled={replyBusy || sendBlocked}
            onClick={onOpenFullCompose} style={{ fontSize: '0.8rem' }}>
            <Maximize2 size={14} /> Rich editor
          </button>
        </div>
      </div>
    </div>
  );
}
