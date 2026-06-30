import { Paperclip, Download } from 'lucide-react';
import type { MessageAttachment } from '../../shared/types';

export function AttachmentCard({ attachment }: { attachment: MessageAttachment }) {
  const sizeStr = attachment.size >= 1048576
    ? `${(attachment.size / 1048576).toFixed(1)} MB`
    : `${Math.round(attachment.size / 1024)} KB`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
      borderRadius: 'var(--radius-md)', background: 'rgba(255,255,255,0.04)',
      border: '1px solid var(--border-glass)' }}>
      <Paperclip size={16} style={{ color: 'var(--text-secondary)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {attachment.filename}
        </div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{sizeStr}</div>
      </div>
      <a href={`/api/attachments/${attachment.id}`} download={attachment.filename}
        className="btn btn-ghost" style={{ padding: '4px 8px' }}><Download size={14} /></a>
    </div>
  );
}
