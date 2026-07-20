import type { Message } from '../shared/types';

export function appendOlderMessagePage(current: Message[], older: Message[]): Message[] {
  const loadedUids = new Set(current.map((message) => message.uid));
  return [...current, ...older.filter((message) => {
    if (loadedUids.has(message.uid)) return false;
    loadedUids.add(message.uid);
    return true;
  })];
}

export function reconcileNewestMessagePage(
  current: Message[],
  refreshed: Message[],
): { messages: Message[]; preservedTail: boolean } {
  if (current.length === 0 || refreshed.length === 0) {
    return { messages: refreshed, preservedTail: false };
  }

  const currentUids = new Set(current.map((message) => message.uid));
  const preservedTail = refreshed.some((message) => currentUids.has(message.uid));
  if (!preservedTail) {
    return { messages: refreshed, preservedTail: false };
  }

  const refreshedUids = new Set(refreshed.map((message) => message.uid));
  const lowestRefreshedUid = Math.min(...refreshedUids);
  const olderTail = current.filter((message) => (
    message.uid < lowestRefreshedUid && !refreshedUids.has(message.uid)
  ));

  return { messages: [...refreshed, ...olderTail], preservedTail: true };
}

export function applyLoadedMessageAction(
  current: Message[],
  action: string,
  targetUids: number[],
): Message[] {
  const targets = new Set(targetUids);
  if (['archive', 'delete', 'move', 'snooze', 'spam'].includes(action)) {
    return current.filter((message) => !targets.has(message.uid));
  }

  return current.map((message) => {
    if (!targets.has(message.uid)) return message;
    if (action === 'read') return { ...message, isRead: true };
    if (action === 'unread') return { ...message, isRead: false };
    if (action === 'star') return { ...message, isStarred: true };
    if (action === 'unstar') return { ...message, isStarred: false };
    return message;
  });
}
