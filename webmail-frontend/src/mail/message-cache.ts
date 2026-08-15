import type { Message } from '../shared/types';

export interface MessageDetailLoader {
  cached(folder: string, uid: number): Message | undefined;
  load(folder: string, uid: number): Promise<Message | undefined>;
}

export function mailboxPathsEqual(left: string, right: string): boolean {
  if (left === right) return true;
  return left.toUpperCase() === 'INBOX' && right.toUpperCase() === 'INBOX';
}

export function createMessageDetailLoader(
  fetchDetail: (folder: string, uid: number) => Promise<Message | undefined>,
): MessageDetailLoader {
  const cache = new Map<string, Message>();
  const inFlight = new Map<string, Promise<Message | undefined>>();

  return {
    cached(folder: string, uid: number) {
      return cache.get(messageCacheKey(folder, uid));
    },

    load(folder: string, uid: number) {
      const key = messageCacheKey(folder, uid);
      const cached = cache.get(key);
      if (cached) return Promise.resolve(cached);

      const pending = inFlight.get(key);
      if (pending) return pending;

      const request = fetchDetail(folder, uid).then(detail => {
        if (detail) cache.set(key, detail);
        return detail;
      });
      inFlight.set(key, request);
      const release = () => {
        if (inFlight.get(key) === request) inFlight.delete(key);
      };
      void request.then(release, release);
      return request;
    },
  };
}

export function messageCacheKey(folder: string, uid: number): string {
  const mailbox = folder.toUpperCase() === 'INBOX' ? 'INBOX' : folder;
  return `${mailbox}\u0000${uid}`;
}

export function markMessageBodyLoaded(message: Message): Message {
  return { ...message, bodyLoaded: true };
}

export function mergeMessageDetails(summary: Message, detail?: Message): Message {
  if (!detail) return summary;

  return {
    ...summary,
    from: detail.from || summary.from,
    to: detail.to ?? summary.to,
    cc: detail.cc ?? summary.cc,
    bcc: detail.bcc ?? summary.bcc,
    replyTo: detail.replyTo ?? summary.replyTo,
    html: detail.html,
    text: detail.text,
    attachments: detail.attachments,
    messageId: detail.messageId,
    inReplyTo: detail.inReplyTo,
    references: detail.references,
    draftId: detail.draftId ?? summary.draftId,
    calendarData: detail.calendarData,
    bodyLoaded: detail.bodyLoaded,
  };
}
