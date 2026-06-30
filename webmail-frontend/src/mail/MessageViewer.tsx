import { useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Reply, ReplyAll, Forward, Star, Trash2, Archive, Mail, MailOpen, Code, Clock, FolderOpen, BellOff } from 'lucide-react';
import { format } from 'date-fns';
import { AttachmentCard } from './components/AttachmentCard';
import { InlineReply } from './components/InlineReply';
import { RawMessageModal } from './components/RawMessageModal';
import { SnoozePopover } from './components/SnoozePopover';
import { MoveToPopover } from './components/MoveToPopover';
import { Skeleton } from '../shared/components/Skeleton';
import type { useMail } from './hooks/useMail';

export function MessageViewer({ mail }: { mail: ReturnType<typeof useMail> }) {
  const { folder, uid } = useParams<{ folder: string; uid: string }>();
  const navigate = useNavigate();
  const [showRaw, setShowRaw] = useState(false);
  const [showSnooze, setShowSnooze] = useState(false);
  const [showMoveTo, setShowMoveTo] = useState(false);

  if (!uid) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
        Select a message to read
      </div>
    );
  }

  const messageUid = parseInt(uid, 10);
  const message = mail.messages.find((m) => m.uid === messageUid);

  if (!message) {
    return (
      <div style={{ padding: 20 }}>
        <Skeleton width="60%" height={22} />
        <Skeleton width="40%" height={14} style={{ marginTop: 12 }} />
        <div style={{ borderTop: '1px solid var(--border-glass)', margin: '16px 0' }} />
        <Skeleton count={8} height={14} />
      </div>
    );
  }

  const dateObj = typeof message.date === 'string' ? new Date(message.date) : message.date;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 4, padding: '8px 12px', borderBottom: '1px solid var(--border-glass)' }}>
        <button className="btn btn-ghost" onClick={() => navigate(`/mail/${encodeURIComponent(folder || 'INBOX')}`)}>
          <Mail size={16} />
        </button>
        <button className="btn btn-ghost" onClick={() => { mail.setComposeTo(message.from); mail.setComposeSubject(`Re: ${message.subject}`); mail.setIsComposing(true); }} title="Reply">
          <Reply size={16} />
        </button>
        <button className="btn btn-ghost" title="Reply All"><ReplyAll size={16} /></button>
        <button className="btn btn-ghost" title="Forward"><Forward size={16} /></button>
        <button className="btn btn-ghost" onClick={() => setShowRaw(true)} title="Show original"><Code size={16} /></button>
        <div style={{ position: 'relative' }}>
          <button className="btn btn-ghost" onClick={() => setShowSnooze(!showSnooze)} title="Snooze"><Clock size={16} /></button>
          {showSnooze && (
            <SnoozePopover
              onSelect={(until) => { mail.snoozeMessages([message!.uid], until); setShowSnooze(false); }}
              onClose={() => setShowSnooze(false)} />
          )}
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost" onClick={() => mail.messageAction('star', [message.uid])}>
          <Star size={16} fill={message.isStarred ? '#f59e0b' : 'none'} color={message.isStarred ? '#f59e0b' : undefined} />
        </button>
        <button className="btn btn-ghost" onClick={() => { mail.messageAction('unread', [message.uid]); navigate(`/mail/${encodeURIComponent(folder || 'INBOX')}`); }} title="Mark unread">
          <MailOpen size={16} />
        </button>
        <button className="btn btn-ghost" onClick={() => mail.messageAction('archive', [message.uid])}>
          <Archive size={16} />
        </button>
        <div style={{ position: 'relative' }}>
          <button className="btn btn-ghost" onClick={() => setShowMoveTo(!showMoveTo)} title="Move to folder">
            <FolderOpen size={16} />
          </button>
          {showMoveTo && <MoveToPopover folders={mail.folders} onMove={(_f) => { mail.messageAction('move', [message.uid]); setShowMoveTo(false); }} onClose={() => setShowMoveTo(false)} />}
        </div>
        <button className="btn btn-ghost" onClick={() => { if (mail.muteThread) mail.muteThread([message.uid]); }} title="Mute thread">
          <BellOff size={16} />
        </button>
        <button className="btn btn-danger" onClick={() => mail.messageAction('delete', [message.uid])}>
          <Trash2 size={16} />
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 600, margin: '0 0 12px' }}>{message.subject || '(no subject)'}</h2>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
          <div><strong style={{ color: 'var(--text-primary)' }}>From:</strong> {message.from}</div>
          {message.to && <div><strong style={{ color: 'var(--text-primary)' }}>To:</strong> {message.to}</div>}
          <div><strong style={{ color: 'var(--text-primary)' }}>Date:</strong> {dateObj ? format(dateObj, 'EEEE, MMMM d, yyyy h:mm a') : ''}</div>
        </div>
        <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: 16 }}>
          {message.html ? (
            <div className="message-body" dangerouslySetInnerHTML={{ __html: message.html }} style={{ lineHeight: 1.6, fontSize: '0.95rem' }} />
          ) : (
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: 1.6, fontSize: '0.95rem' }}>
              {message.text || '(no content)'}
            </pre>
          )}
        </div>
        {message.attachments && message.attachments.length > 0 && (
          <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border-glass)' }}>
            <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 8 }}>Attachments ({message.attachments.length})</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {message.attachments.map((att) => <AttachmentCard key={att.id} attachment={att} />)}
            </div>
          </div>
        )}
      </div>
      <InlineReply
        replyText={mail.replyText || ''}
        replySending={mail.replySending}
        onReplyTextChange={mail.setReplyText}
        onSend={() => {
          if (message) {
            const to = message.from?.match(/<(.+?)>/)?.at(1) || message.from;
            mail.sendReply(to, message.subject || '', message.messageId || '', (message.references || []).join(' '));
          }
        }}
        onSendAndArchive={async () => {
          if (message) {
            const to = message.from?.match(/<(.+?)>/)?.at(1) || message.from;
            const ok = await mail.sendReply(to, message.subject || '', message.messageId || '', (message.references || []).join(' '));
            if (ok) mail.messageAction('archive', [message.uid]);
          }
        }}
        onOpenFullCompose={() => {
          if (message) {
            mail.setComposeTo(message.from);
            mail.setComposeSubject(`Re: ${message.subject}`);
            mail.setComposeBody(mail.replyText || '');
            mail.setIsComposing(true);
          }
        }}
      />
      {showRaw && message && (
        <RawMessageModal folder={folder || 'INBOX'} uid={message.uid} onClose={() => setShowRaw(false)} />
      )}
    </div>
  );
}
