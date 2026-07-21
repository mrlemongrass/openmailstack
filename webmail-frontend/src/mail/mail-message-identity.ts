import type { Message } from '../shared/types';

export function messageFolder(message: Pick<Message, 'folder'>, fallbackFolder: string) {
  return message.folder || fallbackFolder;
}

export function messageIdentityKey(
  message: Pick<Message, 'folder' | 'uid'>,
  fallbackFolder: string,
) {
  return `${messageFolder(message, fallbackFolder)}\u0000${message.uid}`;
}

export function groupMessagesByFolder(
  messages: Array<Pick<Message, 'folder' | 'uid'>>,
  fallbackFolder: string,
) {
  const grouped = new Map<string, number[]>();
  for (const message of messages) {
    const folder = messageFolder(message, fallbackFolder);
    const uids = grouped.get(folder) || [];
    uids.push(message.uid);
    grouped.set(folder, uids);
  }
  return grouped;
}
