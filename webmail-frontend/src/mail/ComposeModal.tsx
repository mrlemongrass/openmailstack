import { useState } from 'react';
import { X, Send, Paperclip } from 'lucide-react';
import type { useMail } from './hooks/useMail';

export function ComposeModal({ mail }: { mail: ReturnType<typeof useMail> }) {
  const [isDragOver, setIsDragOver] = useState(false);

  if (!mail.isComposing) return null;

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); if (e.currentTarget === e.target) setIsDragOver(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      mail.setComposeAttachments((prev) => [...prev, ...Array.from(e.dataTransfer.files)]);
    }
  };

  return (
    <div className="compose-modal-overlay" style={{ position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 20 }}
      onDragOver={handleDragOver} onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave} onDrop={handleDrop}>
      <div className="glass-panel" style={{ width: 600, maxHeight: '80vh', display: 'flex',
        flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
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
          <input className="glass-input" placeholder="To" value={mail.composeTo}
            onChange={(e) => mail.setComposeTo(e.target.value)} />
          <input className="glass-input" placeholder="Subject" value={mail.composeSubject}
            onChange={(e) => mail.setComposeSubject(e.target.value)} />
          <textarea className="glass-input" placeholder="Write your message..."
            value={mail.composeBody} onChange={(e) => mail.setComposeBody(e.target.value)}
            style={{ flex: 1, minHeight: 200, resize: 'vertical' }} />
          {/* Attachments list */}
          {mail.composeAttachments.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {mail.composeAttachments.map((file, i) => (
                <span key={i} style={{ fontSize: '0.75rem', padding: '2px 8px',
                  borderRadius: 999, background: 'rgba(59,130,246,0.15)',
                  color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {file.name}
                  <X size={12} style={{ cursor: 'pointer' }}
                    onClick={() => mail.setComposeAttachments((prev) => prev.filter((_, j) => j !== i))} />
                </span>
              ))}
            </div>
          )}
        </div>
        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderTop: '1px solid var(--border-glass)' }}>
          <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
            <Paperclip size={16} />
            <input type="file" multiple hidden onChange={(e) => {
              if (e.target.files) mail.setComposeAttachments((prev) => [...prev, ...Array.from(e.target.files!)]);
            }} />
          </label>
          {mail.composeAttachments.length > 0 && (
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              {mail.composeAttachments.length} file{mail.composeAttachments.length !== 1 ? 's' : ''} attached
            </span>
          )}
          <button className="btn btn-primary" disabled={mail.sending}>
            <Send size={16} /> {mail.sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
