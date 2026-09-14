import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { X, Send, Paperclip, Clock, Image, FileText, Maximize2, Minimize2, Grip } from 'lucide-react';
import { Spinner } from '../shared/components/Spinner';
import { ConfirmDialog } from '../shared/components/ConfirmDialog';
import { useToast } from '../shared/components/Toast';
import type { useMail } from './hooks/useMail';
import * as api from '../shared/api';
import type { Contact, Signature, MailIdentity } from '../shared/types';
import { getUserSettings, saveUserSettings, type MessageTemplate } from '../settings/settingsApi';
import { uniqueContactSuggestions, type ContactSuggestion } from '../shared/contactSuggestions';
import { useModalFocus } from '../shared/hooks/useModalFocus';
import { outboundSendFeedback, scheduledDateFromLocalInputs } from './outbound-send-feedback';

import { htmlToPlainText as stripHtml, plainToHtml, safeComposeHtml, mentionsAttachment } from './compose-content';
const RichComposeEditor = lazy(() => import('./RichComposeEditor'));

const MAX_SIZE = 25 * 1024 * 1024; // 25MB warning
const BLOCK_SIZE = 50 * 1024 * 1024; // 50MB block

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];

function totalSize(files: File[]): number {
  return files.reduce((sum, f) => sum + f.size, 0);
}

/** Extract the fragment the user is currently typing (after the last comma). */
function getFragmentInfo(value: string): { prefix: string; fragment: string } {
  const lastComma = value.lastIndexOf(',');
  if (lastComma === -1) return { prefix: '', fragment: value.trim() };
  return {
    prefix: value.substring(0, lastComma + 1),
    fragment: value.substring(lastComma + 1).trim(),
  };
}

export function ComposeModal({ mail }: { mail: ReturnType<typeof useMail> }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [scheduleError, setScheduleError] = useState('');
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [closingComposer, setClosingComposer] = useState<'saving' | 'discarding' | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [editorSize, setEditorSize] = useState<{ width: number; height: number } | null>(null);
  const resizeStart = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const signatureInitialized = useRef(false);
  const insertedSignature = useRef('');
  const closeActionRef = useRef(false);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const [plainConfirm, setPlainConfirm] = useState(false);
  const [simplifyConfirm, setSimplifyConfirm] = useState(false);
  const [attachmentConfirm, setAttachmentConfirm] = useState<{ sendAt?: Date } | null>(null);
  const rich = mail.composeMode !== 'plain';
  const sourceMode = mail.composeMode === 'html';
  const complexLayout = rich && !sourceMode && /<(?:img|table|video|audio|iframe|object|svg)\b/i.test(mail.composeBody);

  const resizeComposer = (width: number, height: number) => {
    setEditorSize({
      width: Math.max(420, Math.min(window.innerWidth - 40, width)),
      height: Math.max(420, Math.min(window.innerHeight - 40, height)),
    });
  };

  // Image previews
  const imagePreviews = useMemo(() => (
    mail.composeAttachments
      .filter((f) => IMAGE_TYPES.includes(f.type))
      .map((f) => ({ file: f, url: URL.createObjectURL(f) }))
  ), [mail.composeAttachments]);
  useEffect(() => {
    return () => imagePreviews.forEach((p) => URL.revokeObjectURL(p.url));
  }, [imagePreviews]);

  // Contact autocomplete hooks (must be before early return)
  const [allContacts, setAllContacts] = useState<ContactSuggestion[]>([]);
  const [autocompleteField, setAutocompleteField] = useState<'to' | 'cc' | 'bcc' | null>(null);
  const [suggestions, setSuggestions] = useState<ContactSuggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    api.fetchContacts(500, 0).then((data) => {
      if (data.contacts) {
        setAllContacts(uniqueContactSuggestions(data.contacts as Contact[]));
      }
    }).catch(() => {});
  }, []);

  const getFieldValue = useCallback((field: 'to' | 'cc' | 'bcc'): string => {
    if (field === 'cc') return mail.composeCc;
    if (field === 'bcc') return mail.composeBcc;
    return mail.composeTo;
  }, [mail.composeTo, mail.composeCc, mail.composeBcc]);

  const setFieldValue = useCallback((field: 'to' | 'cc' | 'bcc', value: string) => {
    if (field === 'to') mail.setComposeTo(value);
    else if (field === 'cc') mail.setComposeCc(value);
    else mail.setComposeBcc(value);
  }, [mail]);

  const handleFieldChange = useCallback((value: string, field: 'to' | 'cc' | 'bcc') => {
    setFieldValue(field, value);
    const { fragment } = getFragmentInfo(value);
    if (fragment.length >= 2) {
      const lower = fragment.toLowerCase();
      const filtered = allContacts.filter((c) =>
        c.name.toLowerCase().includes(lower) || c.email.toLowerCase().includes(lower)
      ).slice(0, 8);
      setSuggestions(filtered);
      setSelectedIndex(0);
      setAutocompleteField(filtered.length > 0 ? field : null);
    } else {
      setSuggestions([]);
      setAutocompleteField(null);
    }
  }, [allContacts, setFieldValue]);

  const selectSuggestion = useCallback((suggestion: ContactSuggestion) => {
    const field = autocompleteField;
    if (!field) return;
    const value = getFieldValue(field);
    const { prefix } = getFragmentInfo(value);
    const display = suggestion.name ? `${suggestion.name} <${suggestion.email}>` : suggestion.email;
    const newValue = prefix ? `${prefix} ${display}, ` : `${display}, `;
    setFieldValue(field, newValue);
    setSuggestions([]);
    setAutocompleteField(null);
  }, [autocompleteField, getFieldValue, setFieldValue]);

  const handleFieldKeyDown = useCallback((e: React.KeyboardEvent, field: 'to' | 'cc' | 'bcc') => {
    if (autocompleteField !== field || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((p) => (p + 1) % suggestions.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((p) => (p - 1 + suggestions.length) % suggestions.length); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); selectSuggestion(suggestions[selectedIndex]); }
    else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setSuggestions([]);
      setAutocompleteField(null);
    }
  }, [autocompleteField, suggestions, selectedIndex, selectSuggestion]);

  const handleFieldBlur = useCallback(() => {
    blurTimerRef.current = setTimeout(() => { setSuggestions([]); setAutocompleteField(null); }, 150);
  }, []);

  const clearBlurTimer = useCallback(() => {
    if (blurTimerRef.current) { clearTimeout(blurTimerRef.current); blurTimerRef.current = null; }
  }, []);

  // Templates
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateError, setTemplateError] = useState('');
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const templateSaveLock = useRef(false);
  const loadTemplates = () => getUserSettings('templates').then(settings => { setTemplates(settings.templates); setTemplatesLoaded(true); setTemplateError(''); }).catch(() => setTemplateError('Templates could not be loaded. Try again.'));
  useEffect(() => {
    void loadTemplates();
  }, []);

  // Toast for send confirmation
  const { showToast } = useToast();
  const [didSend, setDidSend] = useState(false);
  const {
    cancelSendUndo,
    closeComposer,
    composeBody,
    composeError,
    composeSignature,
    isComposing,
    immediateSendNotice,
    immediateSendPhase,
    allowRetryAfterVerifiedNonDelivery,
    checkEarlierComposeSend,
    checkingEarlierComposeSend,
    lastSendResult,
    sending,
    setComposeBody,
    setComposeSignature,
    signatures,
    undoSendDelaySeconds,
    undoSendId,
    undoSendMode,
  } = mail;
  const composeBusy = Boolean(sending || closingComposer || checkingEarlierComposeSend);
  const unchangedSendBlocked = immediateSendPhase === 'uncertain' || immediateSendPhase === 'blocked';
  useEffect(() => {
    if (didSend && !sending && !composeError && !isComposing) {
      const timer = window.setTimeout(() => {
        const scheduledId = undoSendId;
        const feedback = outboundSendFeedback(
          lastSendResult || { scheduledId: scheduledId || undefined },
          undoSendMode,
          undoSendDelaySeconds,
        );
        const isUndoable = Boolean(scheduledId && feedback.actionLabel);
        const isUserScheduled = undoSendMode === 'scheduled';
        showToast({
          ...feedback,
          onAction: isUndoable && scheduledId ? async () => {
            try {
              const restoration = await cancelSendUndo(scheduledId);
              const message = restoration.reopened
                ? (isUserScheduled ? 'Scheduled message cancelled; Draft reopened' : 'Send undone; Draft reopened')
                : (isUserScheduled ? 'Scheduled message cancelled; restored to Drafts' : 'Send undone; restored to Drafts');
              showToast({ type: 'info', message });
            } catch (error) {
              showToast({
                type: 'error',
                message: error instanceof Error ? error.message : 'The message could not be cancelled',
              });
              throw error;
            }
          } : undefined,
        });
        setDidSend(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (didSend && !sending && composeError) {
      const timer = window.setTimeout(() => setDidSend(false), 0);
      return () => window.clearTimeout(timer);
    }
  }, [cancelSendUndo, composeError, didSend, isComposing, sending, showToast,
    lastSendResult, undoSendDelaySeconds, undoSendId, undoSendMode]);

  // Apply a default once per new composer, never to a reopened draft or after
  // an explicit No signature choice. Only remove text we actually inserted.
  useEffect(() => {
    if (!isComposing) {
      signatureInitialized.current = false;
      insertedSignature.current = '';
      return;
    }
    if (signatureInitialized.current || !signatures?.length) return;
    const timer = window.setTimeout(() => {
      signatureInitialized.current = true;
      if (mail.draftUid || composeSignature !== 'none') return;
      const def = signatures.find((s: Signature) => s.isDefault);
      if (!def || !def.content || composeBody) return;
      const text = mail.composeMode === 'rich' ? safeComposeHtml(def.content) : stripHtml(def.content);
      insertedSignature.current = text;
      setComposeSignature(def.id);
      setComposeBody(text + (mail.composeMode === 'rich' ? '<p><br></p>' : '\n\n'));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isComposing, signatures, composeSignature, composeBody, mail.draftUid, mail.composeMode,
    setComposeSignature, setComposeBody]);

  const changeSignature = (id: string) => {
    signatureInitialized.current = true;
    const previous = insertedSignature.current;
    const signature = signatures.find((item: Signature) => item.id === id);
    const next = signature?.content ? (rich ? safeComposeHtml(signature.content) : stripHtml(signature.content)) : '';
    const separator = rich ? '<p><br></p>' : '\n\n';
    setComposeSignature(id);
    setComposeBody(body => {
      const prefix = rich ? previous : previous + separator;
      let remainder = previous && body.startsWith(prefix) ? body.slice(prefix.length) : body;
      if (rich && previous && body.startsWith(prefix) && remainder.startsWith(separator)) {
        remainder = remainder.slice(separator.length);
      }
      return next ? next + separator + remainder : remainder;
    });
    insertedSignature.current = next;
  };

  const sendMessage = (sendAt?: Date, skipReminder = false) => {
    if (!skipReminder && mail.mailSettings?.compose.attachmentReminder !== false && !mail.composeAttachments.length
      && mentionsAttachment(mail.composeSubject, rich ? stripHtml(mail.composeBody) : mail.composeBody)) {
      setAttachmentConfirm({ sendAt });
      return;
    }
    setDidSend(true);
    setShowSchedule(false);
    void mail.handleSend(sendAt).then(sent => {
      if (sent) { setScheduleDate(''); setScheduleTime(''); }
      else setDidSend(false);
    });
  };
  const switchToPlain = () => {
    mail.setComposeBody(stripHtml(mail.composeBody));
    mail.setComposeMode('plain');
    insertedSignature.current = insertedSignature.current ? stripHtml(insertedSignature.current) : '';
    setPlainConfirm(false);
  };

  const size = totalSize(mail.composeAttachments);
  const sizeExceedsWarning = size > MAX_SIZE;
  const sizeExceedsBlock = size > BLOCK_SIZE;

  const hasContent = mail.draftUid || mail.draftId || mail.composeTo || mail.composeCc || mail.composeBcc || mail.composeSubject || mail.composeBody || mail.composeAttachments.length > 0;

  const saveAndClose = () => {
    if (closeActionRef.current) return;
    closeActionRef.current = true;
    setClosingComposer('saving');
    void closeComposer().then((closed) => {
      if (!closed) {
        showToast({ type: 'error', message: 'Draft could not be saved. The composer is still open.' });
      }
    }).catch((error: unknown) => {
      showToast({
        type: 'error',
        message: error instanceof Error
          ? `Draft could not be saved: ${error.message}`
          : 'Draft could not be saved. The composer is still open.',
      });
    }).finally(() => { closeActionRef.current = false; setClosingComposer(null); });
  };

  const discardAndClose = () => {
    if (closeActionRef.current) return;
    closeActionRef.current = true;
    setClosingComposer('discarding');
    setShowCloseConfirm(false);
    void mail.discardComposer().then(discarded => {
      if (discarded) showToast({ type: 'info', message: 'Draft discarded' });
    }).catch((error: unknown) => {
      showToast({ type: 'error', message: error instanceof Error ? `Draft could not be discarded: ${error.message}` : 'Draft could not be discarded. Try again.' });
    }).finally(() => { closeActionRef.current = false; setClosingComposer(null); });
  };

  const handleClose = () => {
    if (composeBusy) return;
    if (hasContent) {
      setShowCloseConfirm(true);
      return;
    }
    saveAndClose();
  };
  useModalFocus({
    dialogRef,
    open: mail.isComposing,
    active: mail.isComposing && !showCloseConfirm && !plainConfirm && !simplifyConfirm && !attachmentConfirm,
    onClose: handleClose,
  });

  if (!mail.isComposing) return null;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!composeBusy) setIsDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (e.currentTarget === e.target) setIsDragOver(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
    if (!composeBusy && e.dataTransfer.files.length > 0) {
      mail.setComposeAttachments((prev) => [...prev, ...Array.from(e.dataTransfer.files)]);
    }
  };

  // Aliases
  const identities = mail.composeIdentities || [];
  const pendingRequestedFrom = Boolean(
    mail.composeRequestedFrom
    && !identities.some(identity => identity.address.toLowerCase() === mail.composeRequestedFrom.toLowerCase()),
  );
  const fromOptions: Array<MailIdentity & { unavailable?: boolean }> = [
    ...(pendingRequestedFrom ? [{
      address: mail.composeRequestedFrom,
      name: mail.composeIdentityState === 'loading' ? 'Verifying' : 'Unavailable',
      unavailable: true,
    }] : []),
    ...identities,
  ];

  return (
    <div className="compose-modal-overlay"
      onDragOver={handleDragOver} onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave} onDrop={handleDrop}>
      <div
        ref={dialogRef}
        className="glass-panel compose-dialog"
        data-expanded={expanded}
        style={editorSize ? { width: editorSize.width, height: editorSize.height } : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-dialog-title"
      >
        {!expanded && (
          <button type="button" className="compose-resize-handle" aria-label="Resize composer"
            title="Drag to resize, or use arrow keys" onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
              event.preventDefault();
              const bounds = dialogRef.current!.getBoundingClientRect();
              resizeComposer(bounds.width + (event.key === 'ArrowLeft' ? 32 : event.key === 'ArrowRight' ? -32 : 0),
                bounds.height + (event.key === 'ArrowUp' ? 32 : event.key === 'ArrowDown' ? -32 : 0));
            }} onPointerDown={event => {
              if (event.button !== 0) return;
              event.preventDefault();
              const bounds = dialogRef.current!.getBoundingClientRect();
              resizeStart.current = { x: event.clientX, y: event.clientY, width: bounds.width, height: bounds.height };
              event.currentTarget.setPointerCapture(event.pointerId);
            }} onPointerMove={event => {
              const start = resizeStart.current;
              if (start) resizeComposer(start.width + start.x - event.clientX, start.height + start.y - event.clientY);
            }} onPointerUp={() => { resizeStart.current = null; }}
            onPointerCancel={() => { resizeStart.current = null; }}>
            <Grip size={14} />
          </button>
        )}
        {/* Drop overlay */}
        {isDragOver && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 10,
            background: 'rgba(59,130,246,0.15)', border: '3px dashed var(--accent-primary)',
            borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', pointerEvents: 'none' }}>
            <span style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--accent-primary)' }}>
              Drop files to attach
            </span>
          </div>
        )}
        {/* Header */}
        <div className="compose-header">
          <span id="compose-dialog-title" style={{ fontWeight: 600 }}>
            {mail.draftUid ? 'Edit Draft' : 'New Message'}
          </span>
          <div className="compose-window-actions">
          <button type="button" className="btn btn-ghost compose-expand"
            aria-label={expanded ? 'Restore composer size' : 'Expand composer'}
            title={expanded ? 'Restore composer size' : 'Expand composer'}
            onClick={() => setExpanded(value => !value)}>
            {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
          <button className="btn btn-ghost" aria-label="Close message composer" disabled={composeBusy}
            onClick={handleClose} style={{ padding: 4 }}>
            <X size={18} />
          </button>
          </div>
        </div>
        {/* Recipient fields — outside scroll area so autocomplete dropdowns aren't clipped */}
        <div className="compose-recipient-fields">
          {/* From selector (#12) */}
          {(fromOptions.length > 1 || pendingRequestedFrom) && (
            <select className="glass-select glass-input" value={mail.composeFrom}
              aria-label="From"
              disabled={composeBusy || !mail.userIdentitiesReady}
              onChange={(e) => mail.setComposeFrom(e.target.value)}
              style={{ fontSize: '0.85rem', padding: '8px 12px' }}>
              {fromOptions.map((a) => (
                <option key={a.address} value={a.address} disabled={a.unavailable}>
                  {a.name ? `${a.name} <${a.address}>` : a.address}
                </option>
              ))}
            </select>
          )}
          {!mail.composeIdentityReady && (
            <div
              className={`compose-identity-notice ${mail.composeIdentityState === 'loading' ? '' : 'warning'}`}
              role={mail.composeIdentityState === 'loading' ? 'status' : 'alert'}
              aria-live={mail.composeIdentityState === 'loading' ? 'polite' : 'assertive'}
            >
              <span>{mail.composeIdentityMessage}</span>
              {mail.composeIdentityState !== 'loading' && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={composeBusy}
                  onClick={() => { void mail.retryUserIdentities().catch(() => undefined); }}
                >
                  Retry identities
                </button>
              )}
            </div>
          )}
          <div style={{ position: 'relative' }}>
            <input className="glass-input" placeholder="To" aria-label="To" role="combobox" aria-autocomplete="list"
                aria-expanded={autocompleteField === 'to' && suggestions.length > 0}
                aria-controls="compose-recipient-suggestions" aria-activedescendant={autocompleteField === 'to' && suggestions.length ? `compose-suggestion-${selectedIndex}` : undefined} value={mail.composeTo}
              autoFocus
              disabled={composeBusy}
              onChange={(e) => handleFieldChange(e.target.value, 'to')}
              onKeyDown={(e) => handleFieldKeyDown(e, 'to')}
              onFocus={() => { clearBlurTimer(); const { fragment } = getFragmentInfo(mail.composeTo); if (fragment.length >= 2) handleFieldChange(mail.composeTo, 'to'); }}
              onBlur={handleFieldBlur}
              autoComplete="off" style={{ width: '100%' }} />
            {autocompleteField === 'to' && suggestions.length > 0 && (
              <div id="compose-recipient-suggestions" role="listbox" className="glass-panel compose-popover" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                marginTop: 2, maxHeight: 200, overflow: 'auto', padding: 4 }}>
                {suggestions.map((s, i) => (
                  <div key={s.email} id={`compose-suggestion-${i}`} role="option" aria-selected={i === selectedIndex}
                    onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s); }}
                    style={{
                      padding: '8px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                      background: i === selectedIndex ? 'var(--accent-primary)' : 'transparent',
                      color: i === selectedIndex ? '#fff' : 'var(--text-primary)',
                      fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: 1,
                    }}>
                    <span style={{ fontWeight: 600 }}>{s.name || s.email}</span>
                    {s.name && <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>{s.email}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          {mail.showCc && (
            <div style={{ position: 'relative' }}>
              <input className="glass-input" placeholder="Cc" aria-label="Cc" role="combobox" aria-autocomplete="list"
                aria-expanded={autocompleteField === 'cc' && suggestions.length > 0}
                aria-controls="compose-recipient-suggestions" aria-activedescendant={autocompleteField === 'cc' && suggestions.length ? `compose-suggestion-${selectedIndex}` : undefined} value={mail.composeCc}
                disabled={composeBusy}
                onChange={(e) => handleFieldChange(e.target.value, 'cc')}
                onKeyDown={(e) => handleFieldKeyDown(e, 'cc')}
                onFocus={() => { const { fragment } = getFragmentInfo(mail.composeCc); if (fragment.length >= 2) handleFieldChange(mail.composeCc, 'cc'); }}
                onBlur={handleFieldBlur}
                autoComplete="off" style={{ width: '100%' }} />
              {autocompleteField === 'cc' && suggestions.length > 0 && (
                <div id="compose-recipient-suggestions" role="listbox" className="glass-panel compose-popover" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                  marginTop: 2, maxHeight: 200, overflow: 'auto', padding: 4 }}>
                  {suggestions.map((s, i) => (
                    <div key={s.email} id={`compose-suggestion-${i}`} role="option" aria-selected={i === selectedIndex}
                      onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s); }}
                      style={{
                        padding: '8px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                        background: i === selectedIndex ? 'var(--accent-primary)' : 'transparent',
                        color: i === selectedIndex ? '#fff' : 'var(--text-primary)',
                        fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: 1,
                      }}>
                      <span style={{ fontWeight: 600 }}>{s.name || s.email}</span>
                      {s.name && <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>{s.email}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {mail.showBcc && (
            <div style={{ position: 'relative' }}>
              <input className="glass-input" placeholder="Bcc" aria-label="Bcc" role="combobox" aria-autocomplete="list"
                aria-expanded={autocompleteField === 'bcc' && suggestions.length > 0}
                aria-controls="compose-recipient-suggestions" aria-activedescendant={autocompleteField === 'bcc' && suggestions.length ? `compose-suggestion-${selectedIndex}` : undefined} value={mail.composeBcc}
                disabled={composeBusy}
                onChange={(e) => handleFieldChange(e.target.value, 'bcc')}
                onKeyDown={(e) => handleFieldKeyDown(e, 'bcc')}
                onFocus={() => { const { fragment } = getFragmentInfo(mail.composeBcc); if (fragment.length >= 2) handleFieldChange(mail.composeBcc, 'bcc'); }}
                onBlur={handleFieldBlur}
                autoComplete="off" style={{ width: '100%' }} />
              {autocompleteField === 'bcc' && suggestions.length > 0 && (
                <div id="compose-recipient-suggestions" role="listbox" className="glass-panel compose-popover" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                  marginTop: 2, maxHeight: 200, overflow: 'auto', padding: 4 }}>
                  {suggestions.map((s, i) => (
                    <div key={s.email} id={`compose-suggestion-${i}`} role="option" aria-selected={i === selectedIndex}
                      onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s); }}
                      style={{
                        padding: '8px 10px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                        background: i === selectedIndex ? 'var(--accent-primary)' : 'transparent',
                        color: i === selectedIndex ? '#fff' : 'var(--text-primary)',
                        fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: 1,
                      }}>
                      <span style={{ fontWeight: 600 }}>{s.name || s.email}</span>
                      {s.name && <span style={{ fontSize: '0.75rem', opacity: 0.7 }}>{s.email}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            {!mail.showCc && <button className="btn btn-ghost" disabled={composeBusy}
              onClick={() => mail.setShowCc(true)} style={{ fontSize: '0.8rem' }}>Cc</button>}
            {!mail.showBcc && <button className="btn btn-ghost" disabled={composeBusy}
              onClick={() => mail.setShowBcc(true)} style={{ fontSize: '0.8rem' }}>Bcc</button>}
          </div>
          <input className="glass-input" placeholder="Subject" aria-label="Subject" value={mail.composeSubject}
            disabled={composeBusy}
            onChange={(e) => mail.setComposeSubject(e.target.value)} />
          {mail.signatures && mail.signatures.length > 0 && (
            <select className="glass-select glass-input" value={mail.composeSignature}
              aria-label="Signature"
              disabled={composeBusy}
              onChange={(e) => changeSignature(e.target.value)}
              style={{ fontSize: '0.8rem', padding: '6px 10px' }}>
              <option value="none">No signature</option>
              {mail.signatures.map((s: Signature) => (
                <option key={s.id} value={s.id}>{s.name}{s.isDefault ? ' (default)' : ''}</option>
              ))}
            </select>
          )}
        </div>
        {/* Scrollable body area — textarea + attachments + previews */}
        <div className="compose-body">
          <label className="compose-format-select">Message format
            <select aria-label="Message format" className="glass-input glass-select" value={mail.composeMode} disabled={composeBusy}
              onChange={event => {
                if (event.target.value === 'plain') setPlainConfirm(true);
                else {
                  if (!rich) {
                    mail.setComposeBody(plainToHtml(mail.composeBody));
                    insertedSignature.current = insertedSignature.current ? plainToHtml(insertedSignature.current) : '';
                  }
                  mail.setComposeMode(event.target.value as 'rich' | 'html');
                }
              }}>
              <option value="plain">Plain text</option><option value="rich">Rich text</option><option value="html">HTML source</option>
            </select>
          </label>
          {sourceMode && <p className="settings-description">Edit HTML markup below. Switch to Rich text to use formatting tools; complex layouts require simplification.</p>}
          {complexLayout ? <div className="compose-layout-notice">
            <p>This draft contains images or a layout that this text editor cannot preserve. Its original content is kept until you choose to simplify it.</p>
            <button className="btn btn-ghost" disabled={composeBusy} onClick={() => setSimplifyConfirm(true)}>Simplify and edit</button>
            <div className="compose-layout-preview" dangerouslySetInnerHTML={{ __html: safeComposeHtml(mail.composeBody) }} />
          </div> : rich && !sourceMode ? <Suspense fallback={<div role="status">Loading message editor…</div>}>
            <RichComposeEditor value={mail.composeBody} onChange={mail.setComposeBody} disabled={composeBusy}
              onNormalize={(html, normalizeFragment) => {
                if (insertedSignature.current) insertedSignature.current = normalizeFragment(insertedSignature.current);
                mail.setComposeBody(html);
              }} />
          </Suspense> : <textarea className="glass-input" placeholder="Write your message..." aria-label={sourceMode ? "HTML source" : "Message body"}
            spellCheck={!sourceMode}
            disabled={composeBusy}
            value={mail.composeBody} onChange={(e) => mail.setComposeBody(e.target.value)}
            style={{ flex: 1, minHeight: 180, resize: 'vertical' }} />}
          {mail.composeBody && (
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textAlign: 'right', marginTop: 2 }}>
              {(rich ? stripHtml(mail.composeBody) : mail.composeBody).trim().split(/\s+/).filter(Boolean).length} words
              {' · '}
              {(rich ? stripHtml(mail.composeBody) : mail.composeBody).length} chars
            </div>
          )}

          {/* Image previews (#6) */}
          {imagePreviews.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {imagePreviews.map((p, i) => (
                <div key={i} style={{ position: 'relative', width: 80, height: 80, borderRadius: 6, overflow: 'hidden',
                  border: '1px solid var(--border-glass)' }}>
                  <img src={p.url} alt={p.file.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ))}
            </div>
          )}

          {/* Attachment size warning (#19) */}
          {sizeExceedsWarning && (
            <div style={{
              background: sizeExceedsBlock ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
              border: `1px solid ${sizeExceedsBlock ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
              borderRadius: 'var(--radius-md)', padding: '8px 12px',
              color: sizeExceedsBlock ? 'var(--danger)' : '#f59e0b', fontSize: '0.8rem',
            }}>
              {sizeExceedsBlock
                ? `Attachments total ${formatBytes(size)} — exceeds the 50MB limit. Remove some files to send.`
                : `Attachments total ${formatBytes(size)} — may exceed recipient limits.`}
            </div>
          )}

          {/* Attachment list */}
          {mail.composeAttachments.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {mail.composeAttachments.map((f, i) => (
                <span key={i} style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: 999,
                  background: 'rgba(59,130,246,0.15)', color: 'var(--accent-primary)',
                  display: 'flex', alignItems: 'center', gap: 4 }}>
                  {IMAGE_TYPES.includes(f.type) ? <Image size={12} /> : <FileText size={12} />}
                  {f.name} ({formatBytes(f.size)})
                  <button type="button" className="btn btn-ghost"
                    aria-label={`Remove ${f.name}`} disabled={composeBusy}
                    style={{ padding: 0, minWidth: 0 }}
                    onClick={() => mail.setComposeAttachments((prev) => prev.filter((_, j) => j !== i))}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        {/* Compose error */}
        {mail.composeError && (
          <div style={{
            padding: '8px 16px', background: 'rgba(239,68,68,0.1)',
            borderTop: '1px solid rgba(239,68,68,0.3)', borderBottom: '1px solid rgba(239,68,68,0.3)',
            color: 'var(--danger)', fontSize: '0.85rem',
          }}>
            {mail.composeError}
          </div>
        )}
        {immediateSendNotice && (
          <div
            className={`compose-send-notice ${immediateSendNotice.tone}`}
            role={immediateSendNotice.tone === 'warning' ? 'alert' : 'status'}
            aria-live={immediateSendNotice.tone === 'warning' ? 'assertive' : 'polite'}
          >
            <span>{immediateSendNotice.message}</span>
            {unchangedSendBlocked && (
              <div className="compose-send-resolution-actions">
                <button
                  type="button"
                  className="btn btn-ghost compose-send-resolution"
                  disabled={checkingEarlierComposeSend}
                  onClick={() => {
                    void checkEarlierComposeSend().catch((error: unknown) => {
                      showToast({
                        type: 'error',
                        message: error instanceof Error
                          ? error.message
                          : 'The earlier send could not be checked.',
                      });
                    });
                  }}
                >
                  {checkingEarlierComposeSend ? <><Spinner size={12} /> Checking...</> : 'Check earlier send'}
                </button>
                {immediateSendPhase === 'uncertain' && (
                  <button
                    type="button"
                    className="btn btn-ghost compose-send-resolution"
                    disabled={checkingEarlierComposeSend}
                    onClick={() => {
                      void allowRetryAfterVerifiedNonDelivery().catch((error: unknown) => {
                        showToast({
                          type: 'error',
                          message: error instanceof Error
                            ? error.message
                            : 'The protected send attempt could not be cleared.',
                        });
                      });
                    }}
                  >
                    I verified it was not delivered
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {/* Footer */}
        <div className="compose-footer" style={{ borderTop: mail.composeError || immediateSendNotice ? 'none' : undefined }}>
          <div className="compose-footer-tools">
            <button type="button" className="btn btn-ghost" aria-label="Attach files" disabled={composeBusy} onClick={() => attachmentInput.current?.click()}>
              <Paperclip size={16} />
            </button>
              <input ref={attachmentInput} type="file" multiple hidden onChange={(e) => {
                if (e.target.files) mail.setComposeAttachments((prev) => [...prev, ...Array.from(e.target.files!)]);
                e.target.value = '';
              }} disabled={composeBusy} />
            {/* Templates (#13) */}
            <div style={{ position: 'relative' }}>
              <button className="btn btn-ghost" disabled={composeBusy}
                onClick={() => setShowTemplates(!showTemplates)}
                style={{ fontSize: '0.8rem' }} title="Templates">
                <FileText size={16} /> Templates
              </button>
              {showTemplates && !composeBusy && (
                <div style={{ position: 'absolute', bottom: '100%', left: 0, zIndex: 50, marginBottom: 4, minWidth: 220 }}
                  onClick={(e) => e.stopPropagation()}>
                  <div className="glass-panel compose-popover" style={{ padding: 8, maxHeight: 200, overflow: 'auto' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)',
                      padding: '4px 8px', marginBottom: 4 }}>Insert Template</div>
                    {templates.map((t) => (
                      <button type="button" key={t.name} className="btn btn-ghost" style={{ padding: '6px 10px', cursor: 'pointer',
                        borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }}
                        onClick={() => { mail.setComposeBody((prev) => prev + (rich ? '<p><br></p>' + (t.mode === 'rich' ? safeComposeHtml(t.content) : plainToHtml(t.content)) : '\n\n' + (t.mode === 'rich' ? stripHtml(t.content) : t.content))); setShowTemplates(false); }}>
                        {t.name}
                      </button>
                    ))}
                    {templates.length === 0 && (
                      <div style={{ padding: 8, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                        No templates saved yet.
                      </div>
                    )}
                    <div style={{ borderTop: '1px solid var(--border-glass)', margin: '4px 0' }} />
                    {templateError && <div role="alert" className="settings-error-banner">{templateError}</div>}
                    {!templatesLoaded ? <button className="btn btn-ghost" onClick={() => { void loadTemplates(); }}>Retry loading templates</button> : <form onSubmit={async event => {
                      event.preventDefault();
                      const name = templateName.trim();
                      if (!name || templateSaveLock.current) return;
                      templateSaveLock.current = true;
                      setSavingTemplate(true);
                      setTemplateError('');
                      try {
                        const updated = [...templates.filter(t => t.name !== name), { name, content: rich ? safeComposeHtml(mail.composeBody) : mail.composeBody, mode: rich ? 'rich' as const : 'plain' as const }];
                        const settings = await saveUserSettings('templates', { templates: updated });
                        setTemplates(settings.templates);
                        setTemplateName('');
                        showToast({ type: 'success', message: 'Template saved' });
                      } catch (error) {
                        setTemplateError(error instanceof Error ? error.message : 'Template could not be saved. Try again.');
                      } finally { templateSaveLock.current = false; setSavingTemplate(false); }
                    }}>
                      <label>Template name<input className="glass-input" aria-label="Template name" value={templateName} disabled={savingTemplate} onChange={event => setTemplateName(event.target.value)} /></label>
                      <button type="submit" className="btn btn-ghost" disabled={savingTemplate || !templateName.trim()}>{savingTemplate ? 'Saving…' : 'Save current as template'}</button>
                    </form>}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="compose-footer-status" aria-live="polite">
            {mail.composeAttachments.length > 0 && (
              <span>
                {mail.composeAttachments.length} file{mail.composeAttachments.length !== 1 ? 's' : ''}
              </span>
            )}
            {(mail.draftSaveStatus || closingComposer) && (
              <span style={{ color: mail.draftSaveStatus === 'error'
                ? 'var(--danger)' : 'var(--text-secondary)' }}>
                {closingComposer === 'discarding' ? 'Discarding...' : closingComposer === 'saving' || mail.draftSaveStatus === 'saving' ? 'Saving...' : mail.draftSaveStatus === 'saved' ? 'Saved' : 'Error'}
              </span>
            )}
          </div>
          <div className="compose-footer-actions">
            {/* Schedule send (#3) */}
            <div style={{ position: 'relative' }}>
              <button className="btn btn-ghost" disabled={composeBusy || immediateSendPhase !== 'idle' || !mail.composeIdentityReady}
                onClick={() => { setScheduleError(''); setShowSchedule(!showSchedule); }}
                style={{ fontSize: '0.8rem' }} title="Schedule send" aria-label="Schedule send">
                <Clock size={16} />
              </button>
              {showSchedule && !composeBusy && immediateSendPhase === 'idle' && mail.composeIdentityReady && (
                <div style={{ position: 'absolute', bottom: '100%', right: 0, zIndex: 50, marginBottom: 4, minWidth: 260 }}
                  onClick={(e) => e.stopPropagation()}>
                  <div className="glass-panel compose-popover" style={{ padding: 12 }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8 }}>Schedule Send</div>
                    <input type="date" className="glass-input" value={scheduleDate}
                      aria-label="Scheduled send date"
                      disabled={composeBusy}
                      onChange={(e) => { setScheduleDate(e.target.value); setScheduleError(''); }}
                      style={{ width: '100%', marginBottom: 8, fontSize: '0.85rem' }} />
                    <input type="time" className="glass-input" value={scheduleTime}
                      aria-label="Scheduled send time"
                      disabled={composeBusy}
                      onChange={(e) => { setScheduleTime(e.target.value); setScheduleError(''); }}
                      style={{ width: '100%', marginBottom: 8, fontSize: '0.85rem' }} />
                    {scheduleError && (
                      <div role="alert" style={{ color: 'var(--danger)', fontSize: '0.78rem', marginBottom: 8 }}>
                        {scheduleError}
                      </div>
                    )}
                    <button className="btn btn-primary" style={{ width: '100%', fontSize: '0.85rem' }}
                      disabled={!scheduleDate || !scheduleTime || composeBusy || !mail.composeIdentityReady}
                      onClick={() => {
                        const sendAt = scheduledDateFromLocalInputs(scheduleDate, scheduleTime);
                        if (!sendAt || sendAt.getTime() <= Date.now()) {
                          setScheduleError('Choose a future date and time.');
                          return;
                        }
                        sendMessage(sendAt);
                      }}>
                      Schedule
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button className="btn btn-primary" disabled={composeBusy || sizeExceedsBlock || unchangedSendBlocked || !mail.composeIdentityReady}
              onClick={() => sendMessage()}>
              <Send size={16} /> {sending
                ? <><Spinner size={14} /> {immediateSendPhase === 'pending' ? 'Confirming delivery...' : 'Sending...'}</>
                : immediateSendPhase === 'retryable'
                  ? 'Check delivery'
                  : unchangedSendBlocked ? 'Do not resend' : 'Send'}
            </button>
          </div>
        </div>
      </div>
      <ConfirmDialog open={plainConfirm} title="Switch to plain text?" message="Text will be kept. Formatting and links will be removed." confirmLabel="Use plain text" cancelLabel="Keep formatting" onConfirm={switchToPlain} onCancel={() => setPlainConfirm(false)} />
      <ConfirmDialog open={simplifyConfirm} title="Simplify this draft?" message="Text and supported formatting will be kept. Images and complex layout will be removed." confirmLabel="Simplify and edit" cancelLabel="Keep original" onConfirm={() => { mail.setComposeBody(safeComposeHtml(mail.composeBody)); setSimplifyConfirm(false); }} onCancel={() => setSimplifyConfirm(false)} />
      <ConfirmDialog open={!!attachmentConfirm} title="Send without an attachment?" message="Your message mentions an attachment, but no files are attached."
        confirmLabel={attachmentConfirm?.sendAt ? 'Schedule anyway' : 'Send anyway'} cancelLabel="Keep editing"
        extraAction={{ label: 'Add attachment', onClick: () => { setAttachmentConfirm(null); attachmentInput.current?.click(); } }}
        onCancel={() => setAttachmentConfirm(null)} onConfirm={() => { const sendAt = attachmentConfirm?.sendAt; setAttachmentConfirm(null); sendMessage(sendAt, true); }} />
      {showCloseConfirm && (
        <ConfirmDialog
          open={showCloseConfirm}
          title="Close this draft?"
          message="Save your latest changes, discard this draft, or keep editing. Saved drafts you discard move to Trash."
          cancelLabel="Keep editing"
          extraAction={{ label: 'Discard draft', onClick: discardAndClose, danger: true }}
          confirmLabel="Save & Close"
          onConfirm={() => {
            setShowCloseConfirm(false);
            saveAndClose();
          }}
          onCancel={() => setShowCloseConfirm(false)}
        />
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
