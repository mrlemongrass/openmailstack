import type { MailFolder, Message } from '../shared/types';

function mailboxPathsMatch(left: string, right: string) {
  return left === right
    || (left.toUpperCase() === 'INBOX' && right.toUpperCase() === 'INBOX');
}

export function messageFolder(message: Pick<Message, 'folder'>, fallbackFolder: string) {
  return message.folder || fallbackFolder;
}

export function messageIdentityKey(
  message: Pick<Message, 'folder' | 'uid'>,
  fallbackFolder: string,
) {
  return `${messageFolder(message, fallbackFolder)}\u0000${message.uid}`;
}

export function messageForRoute(messages: Message[], routeFolder: string, uid: number) {
  return messages.find((message) => (
    message.uid === uid && messageFolder(message, routeFolder) === routeFolder
  ));
}

export function moveDestinationFolders(folders: MailFolder[], sourceFolder: string) {
  return folders.filter((folder) => (
    !mailboxPathsMatch(folder.path, sourceFolder)
    && folder.path.toUpperCase() !== 'SCHEDULED'
    && !folder.disabled
  ));
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

export interface MessageRemoval {
  folder: string;
  uids: number[];
  before: Message[];
}

// Work from the list before mutation, preserving its visible order and folder identity.
export function routeAfterMessageRemoval(
  removal: MessageRemoval,
  routeFolder: string,
  uid: number,
  preference: 'list' | 'previous' | 'next' = 'list',
  listFolder = routeFolder,
): string | null {
  if (!mailboxPathsMatch(removal.folder, routeFolder) || !removal.uids.includes(uid)) return null;
  const listRoute = `/mail/${encodeURIComponent(listFolder)}`;
  if (preference === 'list') return listRoute;
  const index = removal.before.findIndex(item => item.uid === uid && mailboxPathsMatch(messageFolder(item, routeFolder), routeFolder));
  if (index < 0) return listRoute;
  const step = preference === 'previous' ? -1 : 1;
  for (let i = index + step; i >= 0 && i < removal.before.length; i += step) {
    const item = removal.before[i];
    const folder = messageFolder(item, listFolder);
    if (mailboxPathsMatch(folder, removal.folder) && removal.uids.includes(item.uid)) continue;
    return `/mail/${encodeURIComponent(folder)}/${item.uid}`;
  }
  return listRoute;
}
