import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { X, Send, Paperclip, Archive, Clock, Image, FileText } from 'lucide-react';
import { Spinner } from '../shared/components/Spinner';
import { ConfirmDialog } from '../shared/components/ConfirmDialog';
import { useToast } from '../shared/components/Toast';
import type { useMail } from './hooks/useMail';
import * as api from '../shared/api';
import type { Contact, Signature, MailIdentity } from '../shared/types';
import { getUserSettings, saveUserSettings, type MessageTemplate } from '../settings/settingsApi';

const MAX_SIZE = 25 * 1024 * 1024; // 25MB warning
const BLOCK_SIZE = 50 * 1024 * 1024; // 50MB block

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
}

function totalSize(files: File[]): number {
  return files.reduce((sum, f) => sum + f.size, 0);
}

interface ContactSuggestion {
  name: string;
  email: string;
}

export function uniqueContactSuggestions(
  contacts: Array<Pick<Contact, 'name' | 'email'>>,
): ContactSuggestion[] {
  const byEmail = new Map<string, ContactSuggestion>();
  contacts.forEach((contact) => {
    const email = contact.email?.trim();
    if (!email) return;
    const key = email.toLowerCase();
    const existing = byEmail.get(key);
    if (!existing) {
      byEmail.set(key, { name: contact.name?.trim() || '', email });
    } else if (!existing.name && contact.name?.trim()) {
      existing.name = contact.name.trim();
    }
  });
  return Array.from(byEmail.values());
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
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

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
    else if (e.key === 'Escape') { setSuggestions([]); setAutocompleteField(null); }
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
  useEffect(() => {
    getUserSettings('templates')
      .then((settings) => setTemplates(settings.templates))
      .catch(() => {});
  }, []);

  // Toast for send confirmation
  const { showToast } = useToast();
  const [didSend, setDidSend] = useState(false);
  useEffect(() => {
    if (didSend && !mail.sending && !mail.composeError && !mail.isComposing) {
      const timer = window.setTimeout(() => {
        const isUndoable = !!mail.undoSendId;
        showToast({ type: 'success', message: isUndoable ? 'Message will be sent in 8s' : 'Message sent' });
        setDidSend(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (didSend && !mail.sending && mail.composeError) {
      const timer = window.setTimeout(() => setDidSend(false), 0);
      return () => window.clearTimeout(timer);
    }
  }, [didSend, mail.sending, mail.composeError, mail.isComposing, showToast, mail.undoSendId]);

  // Auto-select default signature when compose opens
  const {
    isComposing,
    signatures,
    composeSignature,
    composeBody,
    setComposeSignature,
    setComposeBody,
  } = mail;
  useEffect(() => {
    if (isComposing && signatures && signatures.length > 0) {
      const timer = window.setTimeout(() => {
        const def = signatures.find((s: Signature) => s.isDefault) || signatures[0];
        if (composeSignature === 'none' || !signatures.find((s: Signature) => s.id === composeSignature)) {
          setComposeSignature(def.id);
          if (def.content && !composeBody) {
            setComposeBody(stripHtml(def.content) + '\n\n');
          }
        }
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [isComposing, signatures, composeSignature, composeBody, setComposeSignature, setComposeBody]);

  if (!mail.isComposing) return null;

  const size = totalSize(mail.composeAttachments);
  const sizeExceedsWarning = size > MAX_SIZE;
  const sizeExceedsBlock = size > BLOCK_SIZE;

  const hasContent = mail.composeTo || mail.composeCc || mail.composeBcc || mail.composeSubject || mail.composeBody || mail.composeAttachments.length > 0;

  const handleClose = () => {
    if (hasContent) {
      setShowCloseConfirm(true);
      return;
    }
    mail.setIsComposing(false);
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent) => {
    if (showCloseConfirm) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      handleClose();
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) return;

    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!dialogRef.current.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (e.currentTarget === e.target) setIsDragOver(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      mail.setComposeAttachments((prev) => [...prev, ...Array.from(e.dataTransfer.files)]);
    }
  };

  // Aliases
  const identities = mail.composeIdentities || [];
  const fromOptions = identities.length > 0 ? identities : [{ address: mail.composeFrom, name: '' }];

  return (
    <div className="compose-modal-overlay"
      onDragOver={handleDragOver} onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave} onDrop={handleDrop}
      onKeyDown={handleDialogKeyDown}>
      <div
        ref={dialogRef}
        className="glass-panel compose-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-dialog-title"
      >
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
          <span id="compose-dialog-title" style={{ fontWeight: 600 }}>New Message</span>
          <button className="btn btn-ghost" aria-label="Close message composer" onClick={handleClose} style={{ padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        {/* Recipient fields — outside scroll area so autocomplete dropdowns aren't clipped */}
        <div className="compose-recipient-fields">
          {/* From selector (#12) */}
          {fromOptions.length > 1 && (
            <select className="glass-select glass-input" value={mail.composeFrom}
              aria-label="From"
              onChange={(e) => mail.setComposeFrom(e.target.value)}
              style={{ fontSize: '0.85rem', padding: '8px 12px' }}>
              {fromOptions.map((a: MailIdentity) => (
                <option key={a.address} value={a.address}>
                  {a.name ? `${a.name} <${a.address}>` : a.address}
                </option>
              ))}
            </select>
          )}
          <div style={{ position: 'relative' }}>
            <input className="glass-input" placeholder="To" value={mail.composeTo}
              autoFocus
              onChange={(e) => handleFieldChange(e.target.value, 'to')}
              onKeyDown={(e) => handleFieldKeyDown(e, 'to')}
              onFocus={() => { clearBlurTimer(); const { fragment } = getFragmentInfo(mail.composeTo); if (fragment.length >= 2) handleFieldChange(mail.composeTo, 'to'); }}
              onBlur={handleFieldBlur}
              autoComplete="off" style={{ width: '100%' }} />
            {autocompleteField === 'to' && suggestions.length > 0 && (
              <div className="glass-panel compose-popover" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                marginTop: 2, maxHeight: 200, overflow: 'auto', padding: 4 }}>
                {suggestions.map((s, i) => (
                  <div key={s.email}
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
              <input className="glass-input" placeholder="Cc" value={mail.composeCc}
                onChange={(e) => handleFieldChange(e.target.value, 'cc')}
                onKeyDown={(e) => handleFieldKeyDown(e, 'cc')}
                onFocus={() => { const { fragment } = getFragmentInfo(mail.composeCc); if (fragment.length >= 2) handleFieldChange(mail.composeCc, 'cc'); }}
                onBlur={handleFieldBlur}
                autoComplete="off" style={{ width: '100%' }} />
              {autocompleteField === 'cc' && suggestions.length > 0 && (
                <div className="glass-panel compose-popover" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                  marginTop: 2, maxHeight: 200, overflow: 'auto', padding: 4 }}>
                  {suggestions.map((s, i) => (
                    <div key={s.email}
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
              <input className="glass-input" placeholder="Bcc" value={mail.composeBcc}
                onChange={(e) => handleFieldChange(e.target.value, 'bcc')}
                onKeyDown={(e) => handleFieldKeyDown(e, 'bcc')}
                onFocus={() => { const { fragment } = getFragmentInfo(mail.composeBcc); if (fragment.length >= 2) handleFieldChange(mail.composeBcc, 'bcc'); }}
                onBlur={handleFieldBlur}
                autoComplete="off" style={{ width: '100%' }} />
              {autocompleteField === 'bcc' && suggestions.length > 0 && (
                <div className="glass-panel compose-popover" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                  marginTop: 2, maxHeight: 200, overflow: 'auto', padding: 4 }}>
                  {suggestions.map((s, i) => (
                    <div key={s.email}
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
            {!mail.showCc && <button className="btn btn-ghost" onClick={() => mail.setShowCc(true)} style={{ fontSize: '0.8rem' }}>Cc</button>}
            {!mail.showBcc && <button className="btn btn-ghost" onClick={() => mail.setShowBcc(true)} style={{ fontSize: '0.8rem' }}>Bcc</button>}
          </div>
          <input className="glass-input" placeholder="Subject" value={mail.composeSubject}
            onChange={(e) => mail.setComposeSubject(e.target.value)} />
          {mail.signatures && mail.signatures.length > 0 && (
            <select className="glass-select glass-input" value={mail.composeSignature}
              aria-label="Signature"
              onChange={(e) => {
                const sig = mail.signatures.find((s: Signature) => s.id === e.target.value);
                mail.setComposeSignature(e.target.value);
                if (sig?.content) mail.setComposeBody((prev: string) => stripHtml(sig.content) + '\n\n' + prev);
              }}
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
          <textarea className="glass-input" placeholder="Write your message..."
            value={mail.composeBody} onChange={(e) => mail.setComposeBody(e.target.value)}
            style={{ flex: 1, minHeight: 180, resize: 'vertical' }} />
          {mail.composeBody && (
            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', textAlign: 'right', marginTop: 2 }}>
              {mail.composeBody.replace(/<[^>]*>/g, '').trim().split(/\s+/).filter(Boolean).length} words
              {' · '}
              {mail.composeBody.replace(/<[^>]*>/g, '').length} chars
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
                  <X size={12} style={{ cursor: 'pointer' }}
                    onClick={() => mail.setComposeAttachments((prev) => prev.filter((_, j) => j !== i))} />
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
        {/* Footer */}
        <div className="compose-footer" style={{ borderTop: mail.composeError ? 'none' : undefined }}>
          <div className="compose-footer-tools">
            <label className="btn btn-ghost" aria-label="Attach files" style={{ cursor: 'pointer' }}>
              <Paperclip size={16} />
              <input type="file" multiple hidden onChange={(e) => {
                if (e.target.files) mail.setComposeAttachments((prev) => [...prev, ...Array.from(e.target.files!)]);
              }} />
            </label>
            {/* Templates (#13) */}
            <div style={{ position: 'relative' }}>
              <button className="btn btn-ghost" onClick={() => setShowTemplates(!showTemplates)}
                style={{ fontSize: '0.8rem' }} title="Templates">
                <FileText size={16} /> Templates
              </button>
              {showTemplates && (
                <div style={{ position: 'absolute', bottom: '100%', left: 0, zIndex: 50, marginBottom: 4, minWidth: 220 }}
                  onClick={(e) => e.stopPropagation()}>
                  <div className="glass-panel compose-popover" style={{ padding: 8, maxHeight: 200, overflow: 'auto' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)',
                      padding: '4px 8px', marginBottom: 4 }}>Insert Template</div>
                    {templates.map((t) => (
                      <div key={t.name} className="nav-item" style={{ padding: '6px 10px', cursor: 'pointer',
                        borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }}
                        onClick={() => { mail.setComposeBody((prev) => prev + '\n\n' + t.content); setShowTemplates(false); }}>
                        {t.name}
                      </div>
                    ))}
                    {templates.length === 0 && (
                      <div style={{ padding: 8, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                        No templates saved yet.
                      </div>
                    )}
                    <div style={{ borderTop: '1px solid var(--border-glass)', margin: '4px 0' }} />
                    <div className="nav-item" style={{ padding: '6px 10px', cursor: 'pointer',
                      borderRadius: 'var(--radius-sm)', fontSize: '0.85rem', color: 'var(--accent-primary)' }}
                      onClick={() => {
                        const name = prompt('Template name:');
                        if (name) {
                          const updated = [...templates.filter((t) => t.name !== name), { name, content: mail.composeBody }];
                          setTemplates(updated);
                          saveUserSettings('templates', { templates: updated })
                            .then((settings) => setTemplates(settings.templates))
                            .catch(() => {});
                          setShowTemplates(false);
                        }
                      }}>
                      + Save current as template
                    </div>
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
            {mail.draftSaveStatus && (
              <span style={{ color: mail.draftSaveStatus === 'error'
                ? 'var(--danger)' : 'var(--text-secondary)' }}>
                {mail.draftSaveStatus === 'saving' ? 'Saving...' : mail.draftSaveStatus === 'saved' ? 'Saved' : 'Error'}
              </span>
            )}
          </div>
          <div className="compose-footer-actions">
            {/* Schedule send (#3) */}
            <div style={{ position: 'relative' }}>
              <button className="btn btn-ghost" onClick={() => setShowSchedule(!showSchedule)}
                style={{ fontSize: '0.8rem' }} title="Schedule send">
                <Clock size={16} />
              </button>
              {showSchedule && (
                <div style={{ position: 'absolute', bottom: '100%', right: 0, zIndex: 50, marginBottom: 4, minWidth: 260 }}
                  onClick={(e) => e.stopPropagation()}>
                  <div className="glass-panel compose-popover" style={{ padding: 12 }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8 }}>Schedule Send</div>
                    <input type="date" className="glass-input" value={scheduleDate}
                      onChange={(e) => setScheduleDate(e.target.value)}
                      style={{ width: '100%', marginBottom: 8, fontSize: '0.85rem' }} />
                    <input type="time" className="glass-input" value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                      style={{ width: '100%', marginBottom: 8, fontSize: '0.85rem' }} />
                    <button className="btn btn-primary" style={{ width: '100%', fontSize: '0.85rem' }}
                      disabled={!scheduleDate || !scheduleTime || mail.sending}
                      onClick={() => {
                        const [h, m] = scheduleTime.split(':').map(Number);
                        const sendAt = new Date(scheduleDate);
                        sendAt.setHours(h || 0, m || 0, 0, 0);
                        setShowSchedule(false);
                        setScheduleDate('');
                        setScheduleTime('');
                        mail.handleSend(sendAt);
                      }}>
                      Schedule
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button className="btn btn-primary" disabled={mail.sending || sizeExceedsBlock}
              onClick={() => { setDidSend(true); mail.handleSend(); }}>
              <Send size={16} /> {mail.sending ? <><Spinner size={14} /> Sending...</> : 'Send'}
            </button>
            <button className="btn btn-ghost" disabled={mail.sending || sizeExceedsBlock}
              onClick={() => { setDidSend(true); mail.handleSendAndArchive(); }}
              style={{ fontSize: '0.8rem' }} title="Send & Archive">
              <Archive size={14} />
            </button>
          </div>
        </div>
      </div>
      {showCloseConfirm && (
        <ConfirmDialog
          open={showCloseConfirm}
          title="Discard message?"
          message="You have unsaved changes in this message. Your draft will be saved automatically."
          confirmLabel="Close"
          onConfirm={() => { setShowCloseConfirm(false); mail.setIsComposing(false); }}
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
