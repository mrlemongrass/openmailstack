export interface ContactSuggestion {
  name: string;
  email: string;
}

export function uniqueContactSuggestions(
  contacts: Array<{ name?: string | null; email?: string | null }>,
): ContactSuggestion[] {
  const byEmail = new Map<string, ContactSuggestion>();
  contacts.forEach((contact) => {
    const email = contact.email?.trim();
    if (!email) return;
    const key = email.toLowerCase();
    const existing = byEmail.get(key);
    if (!existing) {
      byEmail.set(key, { name: contact.name?.trim() || '', email });
    } else if (!existing.name && contact.name?.trim()) {
      existing.name = contact.name.trim();
    }
  });
  return Array.from(byEmail.values());
}
