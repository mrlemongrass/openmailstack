import type {
  MessageListResponse, MessageResponse, MessageActionResponse,
  SearchResponse, SearchIndexStatusResponse, SearchIndexRefreshResponse,
  SearchWorkerStatusResponse, SavedSearch,
  MailFolder, Signature, Rule,
  ContactsResponse, Contact, ContactLabel, ContactGroup,
  CalendarsResponse, Calendar, CalendarUpdateResponse, CalendarDeleteResponse,
  Note,
  UserIdentities,
} from './types';

// ---- Auth ----
export async function fetchMe(): Promise<{ email?: string; name?: string }> {
  const res = await fetch('/api/auth/me');
  if (!res.ok) throw new Error('Not authenticated');
  return res.json();
}

export async function fetchIdentities(): Promise<UserIdentities> {
  const res = await fetch('/api/user/identities');
  if (!res.ok) throw new Error('Failed to fetch identities');
  return res.json();
}

// ---- Mail ----
export async function fetchFolders(): Promise<MailFolder[]> {
  const res = await fetch('/api/folders');
  if (!res.ok) throw new Error('Failed to fetch folders');
  const data = await res.json();
  return data.folders || [];
}

export async function fetchMessages(folder: string, olderThan?: number): Promise<MessageListResponse> {
  const params = olderThan ? `?olderThan=${olderThan}` : '';
  const res = await fetch(`/api/folders/${encodeURIComponent(folder)}/messages${params}`);
  if (!res.ok) throw new Error('Failed to fetch messages');
  return res.json();
}

export async function fetchMessage(folder: string, uid: number): Promise<MessageResponse> {
  const res = await fetch(`/api/folders/${encodeURIComponent(folder)}/messages/${uid}`);
  if (!res.ok) throw new Error('Failed to fetch message');
  return res.json();
}

export async function sendMessage(formData: FormData): Promise<MessageActionResponse> {
  const res = await fetch('/api/messages/send', { method: 'POST', body: formData });
  if (!res.ok) throw new Error('Failed to send message');
  return res.json();
}

export async function saveDraft(formData: FormData): Promise<{ draftId?: string; error?: string }> {
  const res = await fetch('/api/messages/draft', { method: 'POST', body: formData });
  return res.json();
}

export async function messageAction(action: string, folder: string, uids: number[]): Promise<MessageActionResponse> {
  const res = await fetch('/api/messages/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, folder, uids }),
  });
  if (!res.ok) throw new Error('Action failed');
  return res.json();
}

export async function undoAction(undo: { uids: number[]; targetFolder?: string }): Promise<void> {
  await fetch('/api/messages/undo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(undo),
  });
}

export async function searchMessages(query: string, folder?: string): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query });
  if (folder) params.set('folder', folder);
  const res = await fetch(`/api/messages/search?${params}`);
  return res.json();
}

export async function fetchSearchIndexStatus(): Promise<SearchIndexStatusResponse> {
  const res = await fetch('/api/messages/search/index/status');
  return res.json();
}

export async function fetchSearchWorkerStatus(): Promise<SearchWorkerStatusResponse> {
  const res = await fetch('/api/messages/search/index/status?worker=true');
  return res.json();
}

export async function refreshSearchIndex(): Promise<SearchIndexRefreshResponse> {
  const res = await fetch('/api/messages/search/index', { method: 'POST' });
  return res.json();
}

export async function fetchSavedSearches(): Promise<SavedSearch[]> {
  const res = await fetch('/api/messages/search/saved');
  const data = await res.json();
  return data.searches || [];
}

export async function saveSearch(name: string, query: string): Promise<void> {
  await fetch('/api/messages/search/saved', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, query }),
  });
}

export async function deleteSearch(id: string): Promise<void> {
  await fetch(`/api/messages/search/saved/${id}`, { method: 'DELETE' });
}

export async function fetchSignatures(): Promise<Signature[]> {
  const res = await fetch('/api/settings/signatures');
  const data = await res.json();
  return data.signatures || [];
}

export async function fetchRules(): Promise<Rule[]> {
  const res = await fetch('/api/rules');
  const data = await res.json();
  return data.rules || [];
}

// ---- Contacts ----
export async function fetchContacts(limit = 200, offset = 0): Promise<ContactsResponse> {
  const res = await fetch(`/api/apps/contacts?limit=${limit}&offset=${offset}`);
  return res.json();
}

export async function fetchDirectoryContacts(query?: string): Promise<{ success: boolean; contacts?: Contact[] }> {
  const url = query ? `/api/directory?q=${encodeURIComponent(query)}` : '/api/directory';
  const res = await fetch(url);
  return res.json();
}

export async function fetchContactDuplicates(): Promise<{ success: boolean; groups?: Contact[][] }> {
  const res = await fetch('/api/apps/contacts-duplicates');
  return res.json();
}

export async function saveContact(contact: Partial<Contact>): Promise<{ success: boolean; contact?: Contact; error?: string }> {
  const method = contact.id ? 'PUT' : 'POST';
  const url = contact.id ? `/api/apps/contacts/${contact.id}` : '/api/apps/contacts';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(contact),
  });
  return res.json();
}

export async function deleteContact(id: number | string): Promise<void> {
  await fetch(`/api/apps/contacts/${id}`, { method: 'DELETE' });
}

export async function bulkDeleteContacts(ids: (number | string)[]): Promise<void> {
  await fetch('/api/apps/contacts/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
}

export async function toggleFavorite(id: number | string): Promise<void> {
  await fetch(`/api/apps/contacts/${id}/favorite`, { method: 'PUT' });
}

export async function fetchContactLabels(): Promise<ContactLabel[]> {
  const res = await fetch('/api/apps/contact-labels');
  const data = await res.json();
  return data.labels || [];
}

export async function saveContactLabel(label: Partial<ContactLabel>): Promise<ContactLabel> {
  const method = label.id ? 'PUT' : 'POST';
  const url = label.id ? `/api/apps/contact-labels/${label.id}` : '/api/apps/contact-labels';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(label),
  });
  const data = await res.json();
  return data.label;
}

export async function deleteContactLabel(id: number): Promise<void> {
  await fetch(`/api/apps/contact-labels/${id}`, { method: 'DELETE' });
}

export async function fetchContactGroups(): Promise<ContactGroup[]> {
  const res = await fetch('/api/apps/contact-groups');
  const data = await res.json();
  return data.groups || [];
}

export async function saveContactGroup(group: Partial<ContactGroup>): Promise<ContactGroup> {
  const method = group.id ? 'PUT' : 'POST';
  const url = group.id ? `/api/apps/contact-groups/${group.id}` : '/api/apps/contact-groups';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(group),
  });
  const data = await res.json();
  return data.group;
}

export async function deleteContactGroup(id: number): Promise<void> {
  await fetch(`/api/apps/contact-groups/${id}`, { method: 'DELETE' });
}

export async function mergeContacts(primaryId: number, duplicateIds: number[]): Promise<void> {
  await fetch('/api/apps/contacts-merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ primaryId, duplicateIds }),
  });
}

export async function restoreContact(id: number | string): Promise<void> {
    await fetch(`/api/apps/contacts/${id}/restore`, { method: 'POST' });
}

export async function permanentDeleteContact(id: number | string): Promise<void> {
    await fetch(`/api/apps/contacts/${id}/permanent`, { method: 'DELETE' });
}

export async function fetchTrashContacts(): Promise<ContactsResponse> {
    const res = await fetch('/api/apps/contacts/trash');
    return res.json();
}

export async function fetchContactActivity(id: number | string): Promise<{
    success: boolean;
    emails?: Array<{ subject: string; received_at: string; snippet: string; id: number }>;
    meetings?: Array<{ title: string; start: string; id: string }>;
}> {
    const res = await fetch(`/api/apps/contacts/${id}/activity`);
    return res.json();
}

export async function shareContact(id: number | string, recipientEmail: string, message?: string): Promise<{
    success: boolean;
    vcard?: string;
    mailtoSubject?: string;
    mailtoBody?: string;
}> {
    const res = await fetch(`/api/apps/contacts/${id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientEmail, message }),
    });
    return res.json();
}

// ---- Calendar ----
export async function fetchCalendars(): Promise<CalendarsResponse> {
  const res = await fetch('/api/apps/calendars');
  return res.json();
}

export async function saveCalendar(calendar: Partial<Calendar>): Promise<Calendar> {
  const method = calendar.id ? 'PUT' : 'POST';
  const url = calendar.id ? `/api/apps/calendars/${calendar.id}` : '/api/apps/calendars';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(calendar),
  });
  const data = await res.json();
  return data.calendar;
}

export async function deleteCalendarApi(id: number): Promise<CalendarDeleteResponse> {
  const res = await fetch(`/api/apps/calendars/${id}`, { method: 'DELETE' });
  return res.json();
}

export async function saveEvent(icsData: string): Promise<CalendarUpdateResponse> {
  const res = await fetch('/api/apps/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: icsData }),
  });
  return res.json();
}

export async function deleteEvent(calendarId: number, uid: string, excludeDate?: string): Promise<void> {
  const url = excludeDate
    ? `/api/apps/events/${calendarId}/${uid}?exclude=${encodeURIComponent(excludeDate)}`
    : `/api/apps/events/${calendarId}/${uid}`;
  await fetch(url, { method: 'DELETE' });
}

export async function fetchCalendarShares(calendarId: number): Promise<any[]> {
  const res = await fetch(`/api/apps/calendars/${calendarId}/shares`);
  const data = await res.json();
  return data.shares || [];
}

export async function shareCalendar(calendarId: number, email: string, permission: string): Promise<void> {
  await fetch(`/api/apps/calendars/${calendarId}/shares`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, permission }),
  });
}

export async function unshareCalendar(calendarId: number, email: string): Promise<void> {
  await fetch(`/api/apps/calendars/${calendarId}/shares/${encodeURIComponent(email)}`, { method: 'DELETE' });
}

// ---- Notes ----
export async function fetchNotesApi(): Promise<Note[]> {
  const res = await fetch(`/api/notes?t=${Date.now()}`);
  const data = await res.json();
  return data.notes || [];
}

export async function saveNote(note: Partial<Note>): Promise<Note> {
  const method = note.id ? 'PUT' : 'POST';
  const url = note.id ? `/api/notes/${note.id}` : '/api/notes';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(note),
  });
  const data = await res.json();
  return data.note;
}

export async function deleteNoteApi(id: string): Promise<void> {
  await fetch(`/api/notes/${id}`, { method: 'DELETE' });
}

// ---- Settings ----
export async function fetchUserSettings(namespace: string): Promise<any> {
  const res = await fetch(`/api/settings/${namespace}`);
  if (!res.ok) throw new Error(`Failed to fetch settings for ${namespace}`);
  return res.json();
}

export async function saveUserSettings(namespace: string, settings: any): Promise<void> {
  await fetch(`/api/settings/${namespace}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}
