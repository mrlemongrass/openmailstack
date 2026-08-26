import type { Message } from '../shared/types';

export interface DraftComposeState {
  from: string;
  to: string;
  cc: string;
  bcc: string;
  replyTo: string;
  inReplyTo: string;
  references: string;
  subject: string;
  body: string;
  mode: 'rich' | 'plain';
  attachments: File[];
  draftId: string | null;
  draftUid: string;
}

function mailboxAddress(value: string): string {
  const angleAddress = /<([^<>]+)>/.exec(value);
  return (angleAddress?.[1] || value).trim();
}

export function isDraftFolder(folder: string): boolean {
  return folder.toLowerCase().includes('draft');
}

export function messageAttachmentUrl(
  folder: string,
  messageUid: number,
  attachmentId: number,
): string {
  return `/api/folders/${encodeURIComponent(folder)}/messages/${messageUid}`
    + `/attachments/${attachmentId}?download=1`;
}

export async function hydrateDraftAttachments(
  message: Message,
  folder: string,
  fetcher: typeof fetch = fetch,
): Promise<File[]> {
  return Promise.all((message.attachments || []).map(async attachment => {
    const response = await fetcher(messageAttachmentUrl(folder, message.uid, attachment.id));
    if (!response.ok) throw new Error(`${attachment.filename} could not be restored`);
    const content = await response.blob();
    return new File([content], attachment.filename, {
      type: attachment.contentType || content.type || 'application/octet-stream',
    });
  }));
}

export function draftComposeState(message: Message, attachments: File[]): DraftComposeState {
  const mode = message.bodyMode
    || (message.html && typeof message.text !== 'string' ? 'rich' : 'plain');
  return {
    from: mailboxAddress(message.from || ''),
    to: message.to || '',
    cc: message.cc || '',
    bcc: message.bcc || '',
    replyTo: message.replyTo || '',
    inReplyTo: message.inReplyTo || '',
    references: (message.references || []).join(' '),
    subject: /^\(no subject\)$/i.test(message.subject || '') ? '' : message.subject || '',
    body: mode === 'rich' ? message.html || message.text || '' : message.text || '',
    mode,
    attachments,
    draftId: message.draftId || null,
    draftUid: String(message.uid),
  };
}
