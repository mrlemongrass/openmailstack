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
