import { X, Send, Paperclip } from 'lucide-react';
import type { useMail } from './hooks/useMail';

export function ComposeModal({ mail }: { mail: ReturnType<typeof useMail> }) {
  if (!mail.isComposing) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 20 }}>
      <div className="glass-panel" style={{ width: 600, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid var(--border-glass)' }}>
          <span style={{ fontWeight: 600 }}>New Message</span>
          <button className="btn btn-ghost" onClick={() => mail.setIsComposing(false)} style={{ padding: 4 }}><X size={18} /></button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input className="glass-input" placeholder="To" value={mail.composeTo}
            onChange={(e) => mail.setComposeTo(e.target.value)} />
          <input className="glass-input" placeholder="Subject" value={mail.composeSubject}
            onChange={(e) => mail.setComposeSubject(e.target.value)} />
          <textarea className="glass-input" placeholder="Write your message..."
            value={mail.composeBody} onChange={(e) => mail.setComposeBody(e.target.value)}
            style={{ flex: 1, minHeight: 200, resize: 'vertical' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderTop: '1px solid var(--border-glass)' }}>
          <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
            <Paperclip size={16} />
            <input type="file" multiple hidden onChange={(e) => {
              if (e.target.files) mail.setComposeAttachments((prev) => [...prev, ...Array.from(e.target.files!)]);
            }} />
          </label>
          <button className="btn btn-primary" disabled={mail.sending}>
            <Send size={16} /> {mail.sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
