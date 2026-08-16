import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Reply, ReplyAll, Forward, Star, Trash2, Archive, Mail, MailOpen, Code, Clock, FolderOpen, ImageOff, ChevronLeft } from 'lucide-react';
import { format } from 'date-fns';
import DOMPurify from 'dompurify';
import { AttachmentCard } from './components/AttachmentCard';
import { InlineReply } from './components/InlineReply';
import { RawMessageModal } from './components/RawMessageModal';
import { SnoozePopover } from './components/SnoozePopover';
import { MoveToPopover } from './components/MoveToPopover';
import { Skeleton } from '../shared/components/Skeleton';
import { Spinner } from '../shared/components/Spinner';
import { CalendarInviteCard } from '../shared/components/CalendarInviteCard';
import { KeyboardHelp } from '../shared/components/KeyboardHelp';
import { ConfirmDialog } from '../shared/components/ConfirmDialog';
import { useToast } from '../shared/components/Toast';
import type { useMail } from './hooks/useMail';
import type { SendMessageResponse } from '../shared/types';
import { messageFolder, messageForRoute, moveDestinationFolders } from './mail-message-identity';
import { filterEmailRemoteContent, shouldLoadExternalContent } from './message-privacy';
import { scheduleDelayedMarkRead } from './message-reading';
import { outboundSendFeedback } from './outbound-send-feedback';
import { isDraftFolder } from './draft-resume';
import { UncertainSendBlockedError } from './immediate-send';

export function MessageViewer({ mail }: { mail: ReturnType<typeof useMail> }) {
  const { showToast } = useToast();
  const { folder, uid } = useParams<{ folder: string; uid: string }>();
  const navigate = useNavigate();
  const [showRaw, setShowRaw] = useState(false);
  const [showSnooze, setShowSnooze] = useState(false);
  const [showMoveTo, setShowMoveTo] = useState(false);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [showBackFab, setShowBackFab] = useState(false);
  const [cancellingScheduled, setCancellingScheduled] = useState(false);
  const [removingScheduled, setRemovingScheduled] = useState(false);
  const [showRemoveScheduledConfirm, setShowRemoveScheduledConfirm] = useState(false);
  const [resumingDraft, setResumingDraft] = useState(false);
  const [deletingDraft, setDeletingDraft] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const moveButtonRef = useRef<HTMLButtonElement>(null);
  const markingReadRef = useRef<Set<string>>(new Set());
  const scheduledMessageWasVisibleRef = useRef(false);
  const editingDraftFolderRef = useRef<string | null>(null);
  const { messages, fetchMessageBody, fetchMessages, isComposing, messageAction } = mail;

  const messageUid = uid ? parseInt(uid, 10) : 0;
  const decodedRouteFolder = folder ? decodeURIComponent(folder) : mail.activeFolder;
  const message = messageForRoute(messages, decodedRouteFolder, messageUid);
  const sourceFolder = message ? messageFolder(message, decodedRouteFolder) : decodedRouteFolder;
  const messageIsDraft = isDraftFolder(sourceFolder);
  const moveFolders = moveDestinationFolders(mail.folders, sourceFolder);
  const closeMoveTo = () => {
    setShowMoveTo(false);
    window.requestAnimationFrame(() => moveButtonRef.current?.focus());
  };

  const hasMessage = Boolean(message);
  const hasLoadedMessageBody = Boolean(
    message?.bodyLoaded || (!messageIsDraft && (message?.html || message?.text)),
  );
  const messageIsRead = message?.isRead ?? true;
  const messageIsScheduled = Boolean(message?.is_scheduled);

  useEffect(() => {
    if (message) {
      scheduledMessageWasVisibleRef.current = Boolean(message.is_scheduled);
      return;
    }
    if (decodedRouteFolder.toUpperCase() !== 'SCHEDULED') {
      scheduledMessageWasVisibleRef.current = false;
      return;
    }
    if (!scheduledMessageWasVisibleRef.current) return;
    scheduledMessageWasVisibleRef.current = false;
    showToast({
      type: 'info',
      message: 'This message has left Scheduled. Check Sent to confirm its final delivery status.',
    });
    navigate('/mail/SCHEDULED');
  }, [decodedRouteFolder, message, navigate, showToast]);

  // Fetch the full message body when a message is selected.
  useEffect(() => {
    if (!hasMessage || !uid || !folder || hasLoadedMessageBody) return;
    void fetchMessageBody(messageUid, decodedRouteFolder);
  }, [hasMessage, hasLoadedMessageBody, uid, folder, messageUid, decodedRouteFolder, fetchMessageBody]);

  useEffect(() => {
    if (isComposing || !editingDraftFolderRef.current) return;
    const draftFolder = editingDraftFolderRef.current;
    editingDraftFolderRef.current = null;
    void fetchMessages('reset');
    navigate(`/mail/${encodeURIComponent(draftFolder)}`);
  }, [fetchMessages, isComposing, navigate]);

  // Respect the user's delay and cancel pending work when navigation changes.
  useEffect(() => {
    if (!hasMessage || !uid || !folder || messageIsRead || messageIsScheduled || messageIsDraft) return;
    const readKey = `${sourceFolder}\u0000${messageUid}`;
    return scheduleDelayedMarkRead(mail.mailSettings.reading.markReadDelaySeconds, () => {
      if (markingReadRef.current.has(readKey)) return;
      markingReadRef.current.add(readKey);
      void messageAction('read', [messageUid], sourceFolder).finally(() => {
        markingReadRef.current.delete(readKey);
      });
    });
  }, [hasMessage, messageIsRead, messageIsScheduled, messageIsDraft, uid, folder, messageUid,
    sourceFolder, messageAction, mail.mailSettings.reading.markReadDelaySeconds]);

  const bodyLoading = Boolean(message && !hasLoadedMessageBody);

  // Show back button when scrolled past message header
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const handler = () => setShowBackFab(el.scrollTop > 60);
    el.addEventListener('scroll', handler, { passive: true });
    return () => el.removeEventListener('scroll', handler);
  }, [message?.uid]);

  // Keyboard shortcuts — must be before early returns for stable hook count
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      if (!message) return;

      const key = e.key.toLowerCase();
      if ((message.is_scheduled || messageIsDraft) && key !== 'escape' && key !== '?') return;
      const d = typeof message.date === 'string' ? new Date(message.date) : message.date;
      if (key === 'r' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        mail.startCompose({ to: message.from, subject: `Re: ${message.subject}` });
      } else if (key === 'a' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const ownAddresses = new Set((mail.composeIdentities || []).map((i: { address: string }) => i.address.toLowerCase()));
        const allRecipients = [message.from, message.to, message.cc].filter(Boolean).join(', ');
        const parsed = allRecipients.split(',').map((addr: string) => {
          const match = addr.trim().match(/<(.+?)>/);
          return match ? match[1] : addr.trim();
        }).filter(Boolean);
        const unique = [...new Set(parsed)].filter((addr: string) => !ownAddresses.has(addr.toLowerCase()));
        mail.startCompose({ to: unique.join(', '), subject: `Re: ${message.subject}` });
      } else if (key === 'f' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const dateStr = d ? format(d, 'EEE, MMM d, yyyy h:mm a') : '';
        const forwardHeader = [
          `\n\n---------- Forwarded message ---------`,
          `From: ${message.from}`,
          `Date: ${dateStr}`,
          `Subject: ${message.subject}`,
          message.to ? `To: ${message.to}` : null,
          message.cc ? `Cc: ${message.cc}` : null,
        ].filter(Boolean).join('\n');
        const quoteBody = message.text ? `\n> ${message.text.replace(/\n/g, '\n> ')}` : message.html ? `\n\n[HTML content forwarded — open original to view formatting]` : '';
        mail.startCompose({
          subject: `Fwd: ${message.subject}`,
          body: forwardHeader + quoteBody,
        });
      } else if (key === 's' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        mail.messageAction(message.isStarred ? 'unstar' : 'star', [message.uid]);
      } else if (key === 'e' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        mail.messageAction('archive', [message.uid]);
      } else if ((key === 'delete' || key === 'backspace' || key === '#') && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        mail.messageAction('delete', [message.uid]);
      } else if (key === 'escape') {
        e.preventDefault();
        navigate(`/mail/${encodeURIComponent(folder || 'INBOX')}`);
      } else if (key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShowKeyboardHelp(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [message, messageIsDraft, mail, folder, navigate]);

  if (!uid) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
        Select a message to read
      </div>
    );
  }

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
  const isScheduled = Boolean(message.is_scheduled);
  const isDraft = messageIsDraft;
  const scheduledState = message.delivery_state || 'scheduled';
  const scheduledId = message.scheduled_id;
  const scheduledCancellable = Boolean(
    scheduledId && (scheduledState === 'scheduled' || scheduledState === 'retry_wait'),
  );
  const scheduledRemovable = Boolean(
    scheduledId && (scheduledState === 'failed' || scheduledState === 'delivery_uncertain' || scheduledState === 'partial_delivery'),
  );
  const scheduledStatuses: Record<string, { label: string; detail: string }> = {
    scheduled: { label: 'Scheduled', detail: 'This message is waiting for its delivery time.' },
    retry_wait: { label: 'Retrying safely', detail: 'Delivery has not been accepted. OpenMailStack will retry automatically.' },
    claimed: { label: 'Preparing to send', detail: 'Delivery has started and can no longer be cancelled safely.' },
    smtp_inflight: { label: 'Sending', detail: 'The mail server is processing this message. Its final status is not yet known.' },
    sent_copy_pending: { label: 'Delivered; saving Sent copy', detail: 'SMTP accepted the message. OpenMailStack will not send it again.' },
    failed: { label: 'Delivery failed', detail: 'The message was not accepted. Review the error or remove it from Scheduled.' },
    delivery_uncertain: { label: 'Delivery status uncertain', detail: 'Do not resend until you verify whether the recipient received it. Removing this retained copy will not cancel delivery.' },
    partial_delivery: { label: 'Partially delivered', detail: 'Some recipients accepted this message, but others rejected it. Removing this retained copy will not undo delivery.' },
    completed: { label: 'Delivered', detail: 'The message and Sent copy were completed.' },
    cancelled: { label: 'Cancelled', detail: 'This scheduled message will not be sent.' },
  };
  const scheduledStatus = scheduledStatuses[scheduledState] || {
    label: 'Delivery status pending',
    detail: 'This message has a delivery state this version does not recognize. Refresh before taking action.',
  };

  const showReplyFailure = (error: unknown) => {
    if (error instanceof UncertainSendBlockedError && error.reason === 'delivery_uncertain') {
      showToast({
        type: 'error',
        message: `Reply could not be confirmed: ${error.message}`,
        duration: 12_000,
        actionLabel: 'I verified it was not delivered',
        onAction: async () => {
          await mail.allowReplyRetryAfterVerifiedNonDelivery();
          showToast({
            type: 'info',
            message: 'A new reply attempt is ready because you confirmed the earlier reply was not delivered.',
          });
        },
      });
      return;
    }
    showToast({
      type: 'error',
      message: error instanceof Error ? `Reply could not be sent: ${error.message}` : 'Reply could not be sent',
    });
  };
  const showReplyFeedback = (result: SendMessageResponse) => {
    const undoDelaySeconds = Math.max(0, Math.trunc(mail.mailSettings.compose.undoSendSeconds));
    const feedback = outboundSendFeedback(
      result,
      result.scheduledId && undoDelaySeconds > 0 ? 'undo' : null,
      undoDelaySeconds,
    );
    const scheduledId = result.scheduledId;
    showToast({
      ...feedback,
      onAction: feedback.actionLabel === 'Undo' && scheduledId ? async () => {
        try {
          const restoration = await mail.cancelSendUndo(scheduledId);
          showToast({
            type: 'info',
            message: restoration.reopened ? 'Send undone; Draft reopened' : 'Send undone; restored to Drafts',
          });
        } catch (error) {
          showToast({
            type: 'error',
            message: error instanceof Error ? error.message : 'The reply could not be cancelled',
          });
          throw error;
        }
      } : undefined,
    });
  };
  const sendInlineReply = () => {
    const to = message.from?.match(/<(.+?)>/)?.at(1) || message.from;
    return mail.sendReply(
      to,
      message.subject || '',
      message.messageId || '',
      (message.references || []).join(' '),
    );
  };
  const inlineReplyScope = message.messageId || (message.references || []).join(' ');
  const inlineReplyHasRecovery = Boolean(
    inlineReplyScope && mail.replySendScope === inlineReplyScope,
  );

  const remoteContentKey = `${sourceFolder}\u0000${message.uid}`;
  const explicitlyLoadedRemoteContent = mail.loadedImagesForMsg.has(remoteContentKey);
  const allowRemoteContent = shouldLoadExternalContent(
    mail.mailSettings.reading.externalImages,
    message.from || '',
    mail.mailSettings.spam.safeSenders,
    explicitlyLoadedRemoteContent,
  );

  // Sanitize active content first, then strip network fetch targets according
  // to the user's external-image policy.
  const filteredMessageHtml = (() => {
    if (!message.html) return '';
    const sanitized = DOMPurify.sanitize(message.html, {
      ALLOWED_TAGS: ['a', 'b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'img', 'div', 'span', 'font', 'u', 's', 'sub', 'sup', 'dl', 'dt', 'dd', 'cite', 'small'],
      ALLOWED_ATTR: ['href', 'src', 'srcset', 'alt', 'title', 'width', 'height', 'style', 'class', 'id', 'color', 'bgcolor', 'align', 'border', 'cellpadding', 'cellspacing', 'colspan', 'rowspan'],
    });
    return filterEmailRemoteContent(sanitized, allowRemoteContent);
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', gap: 4, padding: '8px 12px', borderBottom: '1px solid var(--border-glass)' }}>
        <button className="btn btn-ghost" aria-label="Back to message list"
          onClick={() => navigate(`/mail/${encodeURIComponent(folder || 'INBOX')}`)}>
          <Mail size={16} />
        </button>
        {isScheduled ? (
          <>
            <div style={{ flex: 1 }} />
            <span style={{ alignSelf: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
              {scheduledStatus.label}
            </span>
            {scheduledCancellable && scheduledId && (
              <button
                type="button"
                className="btn btn-danger"
                disabled={cancellingScheduled}
                onClick={async () => {
                  setCancellingScheduled(true);
                  scheduledMessageWasVisibleRef.current = false;
                  try {
                    const restoration = await mail.cancelScheduledSend(scheduledId);
                    showToast({
                      type: 'info',
                      message: restoration.reopened
                        ? 'Scheduled message cancelled; Draft reopened'
                        : 'Scheduled message cancelled; restored to Drafts',
                    });
                    navigate('/mail/SCHEDULED');
                  } catch (error) {
                    scheduledMessageWasVisibleRef.current = true;
                    await Promise.allSettled([mail.fetchMessages(), mail.fetchFolders()]);
                    showToast({
                      type: 'error',
                      message: error instanceof Error ? error.message : 'The message could not be cancelled',
                    });
                  } finally {
                    setCancellingScheduled(false);
                  }
                }}
              >
                {cancellingScheduled ? 'Cancelling...' : 'Cancel send'}
              </button>
            )}
            {scheduledRemovable && scheduledId && (
              <button
                type="button"
                className="btn btn-danger"
                disabled={removingScheduled}
                onClick={() => setShowRemoveScheduledConfirm(true)}
              >
                {removingScheduled ? 'Removing...' : 'Remove from Scheduled'}
              </button>
            )}
          </>
        ) : isDraft ? (
          <>
            <div style={{ flex: 1 }} />
            <span style={{ alignSelf: 'center', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
              Draft
            </span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={bodyLoading || resumingDraft || deletingDraft}
              onClick={async () => {
                setResumingDraft(true);
                try {
                  const { senderChanged } = await mail.resumeDraft(message, sourceFolder);
                  editingDraftFolderRef.current = sourceFolder;
                  if (senderChanged) {
                    showToast({
                      type: 'info',
                      message: 'The original sender is no longer available. Your default sender was selected.',
                    });
                  }
                } catch (error) {
                  showToast({
                    type: 'error',
                    message: error instanceof Error
                      ? `Draft could not be opened: ${error.message}`
                      : 'Draft could not be opened',
                  });
                } finally {
                  setResumingDraft(false);
                }
              }}
            >
              {resumingDraft ? 'Opening...' : 'Edit draft'}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              aria-label="Delete draft"
              disabled={resumingDraft || deletingDraft}
              onClick={async () => {
                setDeletingDraft(true);
                const deleted = await mail.messageAction('delete', [message.uid], sourceFolder);
                setDeletingDraft(false);
                if (!deleted) {
                  showToast({ type: 'error', message: 'Draft could not be deleted' });
                  return;
                }
                showToast({ type: 'info', message: 'Draft moved to Trash' });
                navigate(`/mail/${encodeURIComponent(sourceFolder)}`);
              }}
            >
              <Trash2 size={16} />
            </button>
          </>
        ) : (
          <>
        <button className="btn btn-ghost" aria-label="Reply" onClick={() => {
          mail.startCompose({ to: message.from, subject: `Re: ${message.subject}` });
        }} title="Reply">
          <Reply size={16} />
        </button>
        <button className="btn btn-ghost" onClick={() => {
          // Reply All: collect all unique recipients, exclude own address
          const ownAddresses = new Set((mail.composeIdentities || []).map((i: { address: string }) => i.address.toLowerCase()));
          const allRecipients = [message.from, message.to, message.cc].filter(Boolean).join(', ');
          const parsed = allRecipients.split(',').map((a: string) => {
            const match = a.trim().match(/<(.+?)>/);
            return match ? match[1] : a.trim();
          }).filter(Boolean);
          const unique = [...new Set(parsed)].filter((a: string) => !ownAddresses.has(a.toLowerCase()));
          mail.startCompose({ to: unique.join(', '), subject: `Re: ${message.subject}` });
        }} aria-label="Reply all" title="Reply All"><ReplyAll size={16} /></button>
        <button className="btn btn-ghost" onClick={() => {
          // Forward: set Fwd: subject, quote original message
          const dateStr = dateObj ? format(dateObj, 'EEE, MMM d, yyyy h:mm a') : '';
          const forwardHeader = [
            `\n\n---------- Forwarded message ---------`,
            `From: ${message.from}`,
            `Date: ${dateStr}`,
            `Subject: ${message.subject}`,
            message.to ? `To: ${message.to}` : null,
            message.cc ? `Cc: ${message.cc}` : null,
          ].filter(Boolean).join('\n');
          const quoteBody = message.text
            ? `\n> ${message.text.replace(/\n/g, '\n> ')}`
            : message.html
            ? `\n\n[HTML content forwarded — open original to view formatting]`
            : '';
          mail.startCompose({
            subject: `Fwd: ${message.subject}`,
            body: forwardHeader + quoteBody,
          });
        }} aria-label="Forward" title="Forward"><Forward size={16} /></button>
        <button className="btn btn-ghost" aria-label="Show original" onClick={() => setShowRaw(true)} title="Show original"><Code size={16} /></button>
        <div style={{ position: 'relative' }}>
          <button className="btn btn-ghost" aria-label="Snooze message" onClick={() => setShowSnooze(!showSnooze)} title="Snooze"><Clock size={16} /></button>
          {showSnooze && (
            <SnoozePopover
              onSelect={(until) => { mail.snoozeMessages([message!.uid], until); setShowSnooze(false); }}
              onClose={() => setShowSnooze(false)} />
          )}
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost" aria-label={message.isStarred ? 'Remove star' : 'Star message'} onClick={() => { mail.messageAction(message.isStarred ? 'unstar' : 'star', [message.uid]); showToast({ type: 'info', message: message.isStarred ? 'Star removed' : 'Starred' }); }}>
          <Star size={16} fill={message.isStarred ? '#f59e0b' : 'none'} color={message.isStarred ? '#f59e0b' : undefined} />
        </button>
        <button className="btn btn-ghost" aria-label="Mark unread" onClick={() => { mail.messageAction('unread', [message.uid]); navigate(`/mail/${encodeURIComponent(folder || 'INBOX')}`); }} title="Mark unread">
          <MailOpen size={16} />
        </button>
        <button className="btn btn-ghost" aria-label="Archive message" onClick={() => { mail.messageAction('archive', [message.uid]); showToast({ type: 'info', message: 'Archived' }); }}>
          <Archive size={16} />
        </button>
        <div style={{ position: 'relative' }}>
          <button ref={moveButtonRef} className="btn btn-ghost" onClick={() => setShowMoveTo(!showMoveTo)}
            title="Move to folder" aria-label="Move to folder" aria-haspopup="dialog" aria-expanded={showMoveTo} disabled={moveFolders.length === 0}>
            <FolderOpen size={16} />
          </button>
          {showMoveTo && <MoveToPopover folders={moveFolders}
            onMove={(targetFolder) => {
              void mail.messageAction('move', [message.uid], sourceFolder, targetFolder).then((moved) => {
                if (!moved) {
                  showToast({ type: 'error', message: 'Could not move this message. Try again.' });
                }
              });
            }} onClose={closeMoveTo} />}
        </div>
        <button className="btn btn-danger" aria-label="Delete message" onClick={() => { mail.messageAction('delete', [message.uid]); showToast({ type: 'info', message: 'Deleted' }); }}>
          <Trash2 size={16} />
        </button>
          </>
        )}
      </div>
      <div ref={bodyRef} style={{ flex: 1, overflow: 'auto', padding: 20, position: 'relative' }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 600, margin: '0 0 12px' }}>{message.subject || '(no subject)'}</h2>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
          <div><strong style={{ color: 'var(--text-primary)' }}>From:</strong> {message.from}</div>
          {message.to && <div><strong style={{ color: 'var(--text-primary)' }}>To:</strong> {message.to}</div>}
          <div><strong style={{ color: 'var(--text-primary)' }}>
            {isScheduled ? 'Scheduled for:' : isDraft ? 'Last saved:' : 'Date:'}
          </strong> {dateObj ? format(dateObj, 'EEEE, MMMM d, yyyy h:mm a') : ''}</div>
        </div>
        {isScheduled && (
          <div
            role={scheduledState === 'delivery_uncertain' || scheduledState === 'failed' || scheduledState === 'partial_delivery' ? 'alert' : 'status'}
            aria-live={scheduledState === 'delivery_uncertain' || scheduledState === 'failed' || scheduledState === 'partial_delivery' ? 'assertive' : 'polite'}
            style={{
              display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 16,
              padding: '11px 12px', borderRadius: 'var(--radius-md)',
              color: scheduledState === 'delivery_uncertain' || scheduledState === 'failed' || scheduledState === 'partial_delivery'
                ? 'var(--danger)' : 'var(--text-secondary)',
              background: 'color-mix(in srgb, currentColor 8%, transparent)',
              border: '1px solid color-mix(in srgb, currentColor 22%, var(--border-glass))',
            }}
          >
            <Clock size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <strong style={{ display: 'block', color: 'var(--text-primary)', marginBottom: 2 }}>
                {scheduledStatus.label}
              </strong>
              <span style={{ fontSize: '0.82rem' }}>{scheduledStatus.detail}</span>
              {message.delivery_error && (
                <code style={{ display: 'block', marginTop: 5, fontSize: '0.72rem' }}>{message.delivery_error}</code>
              )}
            </div>
          </div>
        )}
        {!isScheduled && !isDraft && <CalendarInviteCard calendarData={message.calendarData} />}
        <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: 16 }}>
          {filteredMessageHtml && filteredMessageHtml.blockedRemoteContent && (
            <div
              role="note"
              style={{
                display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
                padding: '10px 12px', borderRadius: 'var(--radius-md)',
                background: 'color-mix(in srgb, var(--accent-primary) 8%, transparent)',
                border: '1px solid color-mix(in srgb, var(--accent-primary) 24%, var(--border-glass))',
                color: 'var(--text-secondary)', fontSize: '0.82rem',
              }}
            >
              <ImageOff size={17} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--accent-primary)' }} />
              <span style={{ flex: 1 }}>Remote images are hidden to protect your privacy.</span>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}
                onClick={() => mail.setLoadedImagesForMsg(current => {
                  const next = new Set(current);
                  next.add(remoteContentKey);
                  return next;
                })}
              >
                Load remote images
              </button>
            </div>
          )}
          {bodyLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', padding: '20px 0' }}>
              <Spinner size={16} /> Loading message...
            </div>
          ) : message.html ? (
            <div className="message-body" dangerouslySetInnerHTML={{ __html: filteredMessageHtml ? filteredMessageHtml.html : '' }} style={{ lineHeight: 1.6, fontSize: '0.95rem' }} />
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
              {message.attachments.map((att) => (
                <AttachmentCard key={att.id} attachment={att}
                  sourceFolder={sourceFolder} messageUid={message.uid} />
              ))}
            </div>
          </div>
        )}
      </div>
      {!isScheduled && !isDraft && <InlineReply
        replyTo={message.from?.replace(/<.+?>/, '').trim() || message.from || ''}
        replyText={mail.replyText || ''}
        replySending={mail.replySending}
        sendPhase={inlineReplyHasRecovery ? mail.replySendPhase : 'idle'}
        sendNotice={inlineReplyHasRecovery ? mail.replySendNotice : null}
        checkingEarlierSend={inlineReplyHasRecovery && mail.checkingEarlierReplySend}
        onReplyTextChange={mail.setReplyText}
        onSend={() => {
          void sendInlineReply().then(showReplyFeedback).catch(showReplyFailure);
        }}
        onSendAndArchive={async () => {
          try {
            const result = await sendInlineReply();
            showReplyFeedback(result);
            if (result.deliveryStatus === 'accepted') {
              const archived = await mail.messageAction('archive', [message.uid], sourceFolder);
              if (!archived) {
                showToast({ type: 'error', message: 'Reply sent, but the original message could not be archived' });
              } else {
                navigate(`/mail/${encodeURIComponent(sourceFolder)}`);
              }
            }
          } catch (error) {
            showReplyFailure(error);
          }
        }}
        showSendAndArchive={mail.mailSettings.compose.undoSendSeconds === 0}
        onCheckEarlierSend={() => {
          void mail.checkEarlierReplySend().catch((error: unknown) => {
            showToast({
              type: 'error',
              message: error instanceof Error ? error.message : 'The earlier reply could not be checked.',
            });
          });
        }}
        onVerifiedNonDelivery={() => {
          void mail.allowReplyRetryAfterVerifiedNonDelivery().then(() => {
            showToast({
              type: 'info',
              message: 'A new reply attempt is ready because you confirmed the earlier reply was not delivered.',
            });
          }).catch((error: unknown) => {
            showToast({
              type: 'error',
              message: error instanceof Error
                ? error.message
                : 'The protected reply attempt could not be cleared.',
            });
          });
        }}
        onOpenFullCompose={() => {
          if (message) {
            mail.startCompose({
              to: message.from,
              subject: `Re: ${message.subject}`,
              body: mail.replyText || '',
            });
          }
        }}
      />}
      {scheduledRemovable && scheduledId && (
        <ConfirmDialog
          open={showRemoveScheduledConfirm}
          title="Remove this message from Scheduled?"
          message={scheduledState === 'partial_delivery'
            ? 'Some recipients already received this message, while others rejected it. Removing this retained copy cannot undo those deliveries.'
            : scheduledState === 'delivery_uncertain'
              ? 'This permanently deletes the retained message from OpenMailStack. It does not cancel delivery and the recipient may already have received the message.'
              : 'This permanently deletes the retained failed message from OpenMailStack. The message was not accepted for delivery.'}
          confirmLabel="Remove"
          danger
          onConfirm={() => {
            setShowRemoveScheduledConfirm(false);
            setRemovingScheduled(true);
            scheduledMessageWasVisibleRef.current = false;
            void mail.removeScheduledMessage(scheduledId).then(() => {
              showToast({ type: 'info', message: 'Message removed from Scheduled' });
              navigate('/mail/SCHEDULED');
            }).catch(async (error: unknown) => {
              scheduledMessageWasVisibleRef.current = true;
              await Promise.allSettled([mail.fetchMessages(), mail.fetchFolders()]);
              showToast({
                type: 'error',
                message: error instanceof Error ? error.message : 'The message could not be removed',
              });
            }).finally(() => setRemovingScheduled(false));
          }}
          onCancel={() => setShowRemoveScheduledConfirm(false)}
        />
      )}
      {showRaw && message && !isScheduled && !isDraft && (
        <RawMessageModal folder={folder || 'INBOX'} uid={message.uid} onClose={() => setShowRaw(false)} />
      )}
      <KeyboardHelp open={showKeyboardHelp} onClose={() => setShowKeyboardHelp(false)} />
      {showBackFab && (
        <button
          aria-label="Back to message list"
          onClick={() => navigate(`/mail/${encodeURIComponent(folder || 'INBOX')}`)}
          style={{
            position: 'fixed', bottom: 72, left: 12, zIndex: 40,
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '8px 14px', borderRadius: 'var(--radius-md)',
            background: 'var(--bg-glass)', backdropFilter: 'blur(8px)',
            border: '1px solid var(--border-glass)',
            color: 'var(--text-primary)', cursor: 'pointer',
            fontSize: '0.85rem', boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
          }}
        >
          <ChevronLeft size={16} /> Back
        </button>
      )}
    </div>
  );
}
