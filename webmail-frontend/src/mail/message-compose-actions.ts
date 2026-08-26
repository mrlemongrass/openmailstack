import { format } from 'date-fns';
import type { Message } from '../shared/types';

export type MessageComposeAction = 'reply' | 'reply-all' | 'forward';

export type MessageComposePreparationStatus =
  | 'started'
  | 'superseded'
  | 'unavailable'
  | 'identities-unavailable'
  | 'missing-reply-address'
  | 'attachments-unavailable'
  | 'attachments-count-exceeded'
  | 'attachments-size-exceeded'
  | 'message-size-exceeded';

export interface MessageComposeDraft {
  to?: string;
  cc?: string;
  subject: string;
  body?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: File[];
}

interface MessageComposePreparationInput {
  action: MessageComposeAction;
  message: Message;
  folderPath: string;
  body: string;
  identitiesReady: boolean;
  ownAddresses: string[];
  isCurrent: () => boolean;
  loadMessage: (uid: number, folderPath: string) => Promise<Message | undefined>;
  loadForwardContent: (
    message: Message,
    folderPath: string,
  ) => Promise<{ message: Message; attachments: File[] }>;
  openCompose: (initial: MessageComposeDraft) => boolean;
}

interface ParsedAddress {
  mailbox: string;
  value: string;
}

function splitAddressList(value?: string): string[] {
  if (!value) return [];
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let escaped = false;
  let angleDepth = 0;

  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (quoted && character === '\\') {
      current += character;
      escaped = true;
      continue;
    }
    if (character === '"') quoted = !quoted;
    if (!quoted && character === '<') angleDepth += 1;
    if (!quoted && character === '>' && angleDepth > 0) angleDepth -= 1;
    if (!quoted && angleDepth === 0 && character === ',') {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseAddresses(value?: string): ParsedAddress[] {
  return splitAddressList(value).map(address => {
    const bracketed = address.match(/<\s*([^<>]+?)\s*>\s*$/);
    const mailbox = (bracketed?.[1] || address).trim().toLowerCase();
    return { mailbox, value: address };
  }).filter(address => address.mailbox.length > 0);
}

function prefixedSubject(prefix: 'Re' | 'Fwd', subject: string): string {
  const value = subject || '(no subject)';
  const alreadyPrefixed = prefix === 'Re' ? /^\s*re\s*:/i : /^\s*(?:fwd?|fw)\s*:/i;
  return alreadyPrefixed.test(value) ? value : `${prefix}: ${value}`;
}

export function messageComposeActionLabel(action: MessageComposeAction): string {
  if (action === 'reply-all') return 'Reply all';
  return action === 'forward' ? 'Forward' : 'Reply';
}

function replyRecipients(message: Message, ownAddresses: string[]) {
  const own = new Set(ownAddresses.map(address => address.trim().toLowerCase()).filter(Boolean));
  const replyTarget = parseAddresses(message.replyTo || message.from);
  const senderAddresses = parseAddresses(message.from);
  let to = replyTarget.filter(address => !own.has(address.mailbox));
  if (to.length === 0) {
    to = parseAddresses(message.to).filter(address => !own.has(address.mailbox)).slice(0, 1);
  }

  const seen = new Set([...own, ...to.map(address => address.mailbox), ...senderAddresses.map(address => address.mailbox)]);
  const cc: ParsedAddress[] = [];
  for (const address of [...parseAddresses(message.to), ...parseAddresses(message.cc)]) {
    if (seen.has(address.mailbox)) continue;
    seen.add(address.mailbox);
    cc.push(address);
  }
  return { to, cc };
}

export function buildMessageComposeDraft(
  action: MessageComposeAction,
  message: Message,
  ownAddresses: string[],
): MessageComposeDraft {
  if (action === 'forward') {
    const date = typeof message.date === 'string' ? new Date(message.date) : message.date;
    const dateLabel = date && !Number.isNaN(date.getTime()) ? format(date, 'EEE, MMM d, yyyy h:mm a') : '';
    const header = [
      '\n\n---------- Forwarded message ---------',
      `From: ${message.from}`,
      `Date: ${dateLabel}`,
      `Subject: ${message.subject}`,
      message.to ? `To: ${message.to}` : null,
      message.cc ? `Cc: ${message.cc}` : null,
    ].filter(Boolean).join('\n');
    const quotedBody = message.text
      ? `\n> ${message.text.replace(/\n/g, '\n> ')}`
      : message.html
        ? '\n\n[HTML content forwarded — open original to view formatting]'
        : '';
    return {
      subject: prefixedSubject('Fwd', message.subject),
      body: header + quotedBody,
    };
  }

  const recipients = replyRecipients(message, ownAddresses);
  const inReplyTo = message.messageId?.trim() || '';
  const inheritedReferences = (message.references || [])
    .map(reference => reference.trim())
    .filter(Boolean);
  if (inheritedReferences.length === 0 && message.inReplyTo?.trim()) {
    inheritedReferences.push(message.inReplyTo.trim());
  }
  const references = [...new Set([
    ...inheritedReferences,
    inReplyTo,
  ].filter(Boolean))].join(' ');
  return {
    to: recipients.to.map(address => address.value).join(', '),
    ...(action === 'reply-all' && recipients.cc.length > 0
      ? { cc: recipients.cc.map(address => address.value).join(', ') }
      : {}),
    subject: prefixedSubject('Re', message.subject),
    ...(inReplyTo ? { inReplyTo } : {}),
    ...(references ? { references } : {}),
  };
}

export async function prepareMessageComposeAction({
  action,
  message,
  folderPath,
  body,
  identitiesReady,
  ownAddresses,
  isCurrent,
  loadMessage,
  loadForwardContent,
  openCompose,
}: MessageComposePreparationInput): Promise<MessageComposePreparationStatus> {
  if (action !== 'forward' && (!identitiesReady || ownAddresses.length === 0)) {
    return 'identities-unavailable';
  }

  let fullMessage: Message | undefined = message;
  let attachments: File[] | undefined;
  if (action === 'forward') {
    try {
      const hydration = await loadForwardContent(message, folderPath);
      fullMessage = hydration.message;
      attachments = hydration.attachments;
    } catch (error) {
      if (isCurrent() && error instanceof Error && 'code' in error) {
        const code = (error as Error & { code?: unknown }).code;
        if (code === 'ATTACHMENT_COUNT_LIMIT') return 'attachments-count-exceeded';
        if (code === 'ATTACHMENT_FILE_SIZE_LIMIT' || code === 'ATTACHMENT_TOTAL_SIZE_LIMIT') {
          return 'attachments-size-exceeded';
        }
        if (code === 'MESSAGE_SOURCE_LIMIT') return 'message-size-exceeded';
      }
      return isCurrent() ? 'attachments-unavailable' : 'superseded';
    }
    if (!isCurrent()) return 'superseded';
  } else if (!message.bodyLoaded) {
    fullMessage = await loadMessage(message.uid, folderPath);
    if (!isCurrent()) return 'superseded';
  }
  if (!fullMessage) return 'unavailable';

  const draft = buildMessageComposeDraft(action, fullMessage, ownAddresses);
  if (action !== 'forward' && !draft.to) return 'missing-reply-address';
  const initial = {
    ...draft,
    ...(body ? { body } : {}),
    ...(action === 'forward' ? { attachments: attachments || [] } : {}),
  };
  return openCompose(initial) ? 'started' : 'superseded';
}
