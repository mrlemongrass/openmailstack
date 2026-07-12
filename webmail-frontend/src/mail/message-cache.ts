import type { Message } from '../shared/types';

export function messageCacheKey(folder: string, uid: number): string {
  return `${folder}\u0000${uid}`;
}

export function markMessageBodyLoaded(message: Message): Message {
  return { ...message, bodyLoaded: true };
}

export function mergeMessageDetails(summary: Message, detail?: Message): Message {
  if (!detail) return summary;

  return {
    ...summary,
    html: detail.html,
    text: detail.text,
    attachments: detail.attachments,
    messageId: detail.messageId,
    inReplyTo: detail.inReplyTo,
    references: detail.references,
    calendarData: detail.calendarData,
    bodyLoaded: detail.bodyLoaded,
  };
}
