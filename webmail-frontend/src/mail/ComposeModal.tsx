import { useState, useEffect } from 'react';
import { X, Send, Paperclip, Archive, Clock, Image, FileText } from 'lucide-react';
import type { useMail } from './hooks/useMail';

const MAX_SIZE = 25 * 1024 * 1024; // 25MB warning
const BLOCK_SIZE = 50 * 1024 * 1024; // 50MB block

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];

function totalSize(files: File[]): number {
  return files.reduce((sum, f) => sum + f.size, 0);
}

export function ComposeModal({ mail }: { mail: ReturnType<typeof useMail> }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');

  // Image previews
  const [imagePreviews, setImagePreviews] = useState<{ file: File; url: string }[]>([]);
  useEffect(() => {
    const urls = mail.composeAttachments
      .filter((f) => IMAGE_TYPES.includes(f.type))
      .map((f) => ({ file: f, url: URL.createObjectURL(f) }));
    setImagePreviews(urls);
    return () => urls.forEach((p) => URL.revokeObjectURL(p.url));
  }, [mail.composeAttachments]);

  if (!mail.isComposing) return null;

  const size = totalSize(mail.composeAttachments);
  const sizeExceedsWarning = size > MAX_SIZE;
  const sizeExceedsBlock = size > BLOCK_SIZE;

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (e.currentTarget === e.target) setIsDragOver(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      mail.setComposeAttachments((prev) => [...prev, ...Array.from(e.dataTransfer.files)]);
    }
  };

  // Aliases
  const identities = (mail as any).composeIdentities || [];
  const fromOptions = identities.length > 0 ? identities : [{ address: mail.composeFrom, name: '' }];

  // Templates
  const [templates, setTemplates] = useState<{ name: string; content: string }[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  useEffect(() => {
    fetch('/api/settings/templates').then((r) => r.json()).then((d) => {
      if (d.templates) setTemplates(d.templates);
    }).catch(() => {});
  }, []);

  return (
    <div className="compose-modal-overlay" style={{ position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 20 }}
      onDragOver={handleDragOver} onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave} onDrop={handleDrop}>
      <div className="glass-panel" style={{ width: 650, maxHeight: '85vh', display: 'flex',
        flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid var(--border-glass)' }}>
          <span style={{ fontWeight: 600 }}>New Message</span>
          <button className="btn btn-ghost" onClick={() => mail.setIsComposing(false)} style={{ padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        {/* Form fields */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* From selector (#12) */}
          {fromOptions.length > 1 && (
            <select className="glass-select glass-input" value={mail.composeFrom}
              onChange={(e) => mail.setComposeFrom(e.target.value)}
              style={{ fontSize: '0.85rem', padding: '8px 12px' }}>
              {fromOptions.map((a: any) => (
                <option key={a.address} value={a.address}>
                  {a.name ? `${a.name} <${a.address}>` : a.address}
                </option>
              ))}
            </select>
          )}
          <input className="glass-input" placeholder="To" value={mail.composeTo}
            onChange={(e) => mail.setComposeTo(e.target.value)} />
          {mail.showCc && <input className="glass-input" placeholder="Cc" value={mail.composeCc}
            onChange={(e) => mail.setComposeCc(e.target.value)} />}
          {mail.showBcc && <input className="glass-input" placeholder="Bcc" value={mail.composeBcc}
            onChange={(e) => mail.setComposeBcc(e.target.value)} />}
          <div style={{ display: 'flex', gap: 8 }}>
            {!mail.showCc && <button className="btn btn-ghost" onClick={() => mail.setShowCc(true)} style={{ fontSize: '0.8rem' }}>Cc</button>}
            {!mail.showBcc && <button className="btn btn-ghost" onClick={() => mail.setShowBcc(true)} style={{ fontSize: '0.8rem' }}>Bcc</button>}
          </div>
          <input className="glass-input" placeholder="Subject" value={mail.composeSubject}
            onChange={(e) => mail.setComposeSubject(e.target.value)} />
          <textarea className="glass-input" placeholder="Write your message..."
            value={mail.composeBody} onChange={(e) => mail.setComposeBody(e.target.value)}
            style={{ flex: 1, minHeight: 180, resize: 'vertical' }} />

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
        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8,
          padding: '12px 16px', borderTop: '1px solid var(--border-glass)', flexWrap: 'wrap' }}>
          <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
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
                <div className="glass-panel" style={{ padding: 8, maxHeight: 200, overflow: 'auto' }}>
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
                        fetch('/api/settings/templates', {
                          method: 'PUT', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ templates: updated }),
                        }).catch(() => {});
                        setShowTemplates(false);
                      }
                    }}>
                    + Save current as template
                  </div>
                </div>
              </div>
            )}
          </div>
          <div style={{ flex: 1 }} />
          {mail.composeAttachments.length > 0 && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {mail.composeAttachments.length} file{mail.composeAttachments.length !== 1 ? 's' : ''}
            </span>
          )}
          {/* Schedule send (#3) */}
          <div style={{ position: 'relative' }}>
            <button className="btn btn-ghost" onClick={() => setShowSchedule(!showSchedule)}
              style={{ fontSize: '0.8rem' }} title="Schedule send">
              <Clock size={16} />
            </button>
            {showSchedule && (
              <div style={{ position: 'absolute', bottom: '100%', right: 0, zIndex: 50, marginBottom: 4, minWidth: 260 }}
                onClick={(e) => e.stopPropagation()}>
                <div className="glass-panel" style={{ padding: 12 }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8 }}>Schedule Send</div>
                  <input type="date" className="glass-input" value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    style={{ width: '100%', marginBottom: 8, fontSize: '0.85rem' }} />
                  <input type="time" className="glass-input" value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    style={{ width: '100%', marginBottom: 8, fontSize: '0.85rem' }} />
                  <button className="btn btn-primary" style={{ width: '100%', fontSize: '0.85rem' }}
                    disabled={!scheduleDate || !scheduleTime}
                    onClick={() => {
                      mail.setComposeSubject(mail.composeSubject || '(no subject)');
                      setShowSchedule(false);
                    }}>
                    Schedule
                  </button>
                </div>
              </div>
            )}
          </div>
          <button className="btn btn-primary" disabled={mail.sending || sizeExceedsBlock}
            onClick={() => { /* Send handled by parent via mail action */ }}>
            <Send size={16} /> {mail.sending ? 'Sending...' : 'Send'}
          </button>
          <button className="btn btn-ghost" disabled={mail.sending || sizeExceedsBlock}
            onClick={() => { /* Send+Archive #4 */ }}
            style={{ fontSize: '0.8rem' }} title="Send & Archive">
            <Archive size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}
