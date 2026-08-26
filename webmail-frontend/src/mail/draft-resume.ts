import type { Message, MessageAttachment } from '../shared/types';

const DRAFT_ATTACHMENT_FETCH_CONCURRENCY = 4;

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

export function messageAttachmentsUrl(folder: string, messageUid: number): string {
  return `/api/folders/${encodeURIComponent(folder)}/messages/${messageUid}/attachments`;
}

export async function hydrateDraftAttachments(
  message: Message,
  folder: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<File[]> {
  const attachments = message.attachments || [];
  const files = new Array<File>(attachments.length);
  const requestController = new AbortController();
  const abortRequests = () => requestController.abort();
  if (signal?.aborted) abortRequests();
  else signal?.addEventListener('abort', abortRequests, { once: true });
  let nextIndex = 0;
  let failed = false;
  let firstError: unknown;
  const worker = async () => {
    while (!failed) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= attachments.length) return;
      const attachment = attachments[index];
      try {
        const response = await fetcher(
          messageAttachmentUrl(folder, message.uid, attachment.id),
          { signal: requestController.signal },
        );
        if (!response.ok) throw new Error(`${attachment.filename} could not be restored`);
        const content = await response.blob();
        files[index] = new File([content], attachment.filename, {
          type: attachment.contentType || content.type || 'application/octet-stream',
        });
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
          abortRequests();
        }
        return;
      }
    }
  };
  try {
    await Promise.all(Array.from(
      { length: Math.min(DRAFT_ATTACHMENT_FETCH_CONCURRENCY, attachments.length) },
      () => worker(),
    ));
    if (firstError !== undefined) throw firstError;
    return files;
  } finally {
    signal?.removeEventListener('abort', abortRequests);
  }
}

export type ForwardAttachmentLimitCode =
  | 'ATTACHMENT_COUNT_LIMIT'
  | 'ATTACHMENT_FILE_SIZE_LIMIT'
  | 'ATTACHMENT_TOTAL_SIZE_LIMIT'
  | 'MESSAGE_SOURCE_LIMIT';

const isForwardAttachmentLimitCode = (value: unknown): value is ForwardAttachmentLimitCode => (
  value === 'ATTACHMENT_COUNT_LIMIT'
  || value === 'ATTACHMENT_FILE_SIZE_LIMIT'
  || value === 'ATTACHMENT_TOTAL_SIZE_LIMIT'
  || value === 'MESSAGE_SOURCE_LIMIT'
);

const forwardAttachmentLimitError = async (response: Response, fallback: string) => {
  let payload: { code?: unknown; error?: unknown } | null = null;
  try {
    payload = await response.json();
  } catch {
    // A 413 remains a permanent size failure even when an intermediary strips its JSON body.
  }
  const code = isForwardAttachmentLimitCode(payload?.code)
    ? payload.code
    : 'ATTACHMENT_TOTAL_SIZE_LIMIT';
  return Object.assign(
    new Error(typeof payload?.error === 'string' ? payload.error : fallback),
    { code },
  );
};

interface ForwardMessageMetadata {
  subject: string;
  from: string;
  to: string;
  cc: string;
  date: string;
  text: string;
  html: string;
  attachments: MessageAttachment[];
}

export interface ForwardComposeHydration {
  message: Message;
  attachments: File[];
}

function parseForwardMessageMetadata(value: FormDataEntryValue | null): ForwardMessageMetadata | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as {
      subject?: unknown;
      from?: unknown;
      to?: unknown;
      cc?: unknown;
      date?: unknown;
      text?: unknown;
      html?: unknown;
      attachments?: unknown;
    };
    if (
      typeof parsed.subject !== 'string'
      || typeof parsed.from !== 'string'
      || typeof parsed.to !== 'string'
      || typeof parsed.cc !== 'string'
      || typeof parsed.date !== 'string'
      || typeof parsed.text !== 'string'
      || typeof parsed.html !== 'string'
      || !Array.isArray(parsed.attachments)
    ) {
      return null;
    }
    const attachments: MessageAttachment[] = [];
    for (const [index, candidate] of parsed.attachments.entries()) {
      if (!candidate || typeof candidate !== 'object') return null;
      const item = candidate as { filename?: unknown; contentType?: unknown; size?: unknown };
      if (
        typeof item.filename !== 'string'
        || !item.filename
        || typeof item.contentType !== 'string'
        || !Number.isSafeInteger(item.size)
        || Number(item.size) < 0
      ) {
        return null;
      }
      attachments.push({
        id: index,
        filename: item.filename,
        contentType: item.contentType,
        size: Number(item.size),
      });
    }
    return {
      subject: parsed.subject,
      from: parsed.from,
      to: parsed.to,
      cc: parsed.cc,
      date: parsed.date,
      text: parsed.text,
      html: parsed.html,
      attachments,
    };
  } catch {
    return null;
  }
}

export async function hydrateForwardContent(
  message: Message,
  folder: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ForwardComposeHydration> {
  const failureMessage = 'Original attachments could not be added to the Forward';

  try {
    const response = await fetcher(messageAttachmentsUrl(folder, message.uid), { signal });
    if (response.status === 413) throw await forwardAttachmentLimitError(response, failureMessage);
    if (!response.ok) throw new Error(failureMessage);
    const formData = await response.formData();
    const metadata = parseForwardMessageMetadata(formData.get('message'));
    const parts = formData.getAll('attachments');
    if (!metadata || parts.length !== metadata.attachments.length || parts.some(part => typeof part === 'string')) {
      throw new Error(failureMessage);
    }
    const attachments = parts.map((part, index) => new File(
      [part as File],
      metadata.attachments[index].filename,
      { type: metadata.attachments[index].contentType || (part as File).type || 'application/octet-stream' },
    ));
    return {
      message: {
        ...message,
        subject: metadata.subject,
        from: metadata.from,
        to: metadata.to,
        cc: metadata.cc,
        date: metadata.date,
        text: metadata.text,
        html: metadata.html,
        attachments: metadata.attachments,
        hasAttachments: metadata.attachments.length > 0,
        bodyLoaded: true,
      },
      attachments,
    };
  } catch (error) {
    if (
      error instanceof Error
      && isForwardAttachmentLimitCode((error as Error & { code?: unknown }).code)
    ) {
      throw error;
    }
    throw new Error(failureMessage, { cause: error });
  }
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
