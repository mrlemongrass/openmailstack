import type { Message } from '../shared/types';
export type MailSort = 'newest' | 'oldest' | 'sender-asc' | 'sender-desc' | 'subject-asc' | 'subject-desc';
export function sortMailMessages(messages: Message[], sort: MailSort): Message[] {
  return [...messages].sort((a, b) => {
    const date = (Date.parse(String(a.date || '')) || 0) - (Date.parse(String(b.date || '')) || 0);
    const order = sort.startsWith('sender') ? String(a.from || '').localeCompare(String(b.from || ''))
      : sort.startsWith('subject') ? String(a.subject || '').localeCompare(String(b.subject || '')) : date;
    return (sort === 'newest' || sort.endsWith('desc') ? -order : order) || b.uid - a.uid || String(a.folder).localeCompare(String(b.folder));
  });
}
export function ignoreMailShortcut(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  return event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey
    || Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"], [role="textbox"], [inert]'))
    || Boolean(document.querySelector('[role="dialog"], [role="menu"]'));
}
