import type { Message } from '../shared/types';

// Group only loaded messages using actual reply identifiers. Every member stays
// visible and individually actionable; matching subjects alone prove nothing.
export function groupRelatedMessages(messages: Message[], folder: string, enabled: boolean): Message[] {
  if (!enabled) return messages;
  const parents = new Map<string, string>();
  const root = (key: string): string => {
    let current = key;
    while (parents.has(current) && parents.get(current) !== current) current = parents.get(current)!;
    let next = key;
    while (parents.has(next) && parents.get(next) !== current) {
      const previous = parents.get(next)!;
      parents.set(next, current);
      next = previous;
    }
    return current;
  };
  const keys = messages.map(message => {
    const path = message.folder || folder;
    const scope = path.toUpperCase() === 'INBOX' ? 'INBOX' : path;
    const raw = [message.messageId, message.inReplyTo, ...(Array.isArray(message.references) ? message.references : [message.references])];
    const identifiers = raw.flatMap(value => typeof value === 'string' ? value.match(/<[^<>\s]+>/g) || [] : []);
    const own = `${scope}\0uid:${message.uid}`;
    for (const id of identifiers) {
      const key = `${scope}\0id:${id}`;
      parents.set(root(key), root(own));
    }
    return own;
  });
  const groups = new Map<string, Message[]>();
  messages.forEach((message, index) => {
    const key = root(keys[index]);
    const group = groups.get(key) || [];
    group.push(message);
    groups.set(key, group);
  });
  return [...groups.values()].flatMap(group => group.length === 1 ? group : group.map((message, index) => ({
    ...message, threadCount: group.length, conversationPosition: index,
  })));
}
