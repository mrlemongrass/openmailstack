import { useState } from 'react';
import type { MessageAttachment } from '../../shared/types';
import { inlineAttachmentPolicy } from '../attachment-preview';
import { AttachmentCard } from './AttachmentCard';

export function MessageAttachments({ attachments, sourceFolder, messageUid }: {
  attachments: MessageAttachment[]; sourceFolder: string; messageUid: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const policy = inlineAttachmentPolicy(attachments);
  return <section className="message-attachments" aria-label="Attachments">
    <div className="message-attachments-heading">
      <h4>Attachments ({attachments.length})</h4>
      {policy === 'inline' && <button type="button" className="btn btn-ghost"
        aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>
        {collapsed ? 'Show previews' : 'Hide previews'}
      </button>}
    </div>
    {policy === 'too-large' && <p className="inline-preview-note">Pictures and PDFs total more than 25 MB. Open attachments individually to preview them.</p>}
    {policy === 'unknown-size' && <p className="inline-preview-note">Attachment sizes are unavailable. Open attachments individually to preview them.</p>}
    <div className="message-attachments-list">
      {attachments.map(attachment => <AttachmentCard key={attachment.id} attachment={attachment}
        sourceFolder={sourceFolder} messageUid={messageUid} inline={policy === 'inline' && !collapsed} />)}
    </div>
  </section>;
}
