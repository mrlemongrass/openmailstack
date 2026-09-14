import type {
  MessageListResponse, MessageResponse, MessageActionResponse, UndoActionResponse,
  SendMessageResponse, SaveDraftResponse,
  SearchResponse, SearchIndexStatusResponse, SearchIndexRefreshResponse,
  SearchWorkerStatusResponse, SavedSearch,
  SearchField, SearchScope,
  MailFolder, FolderDeleteResult, FolderMutationResponse, FolderMutationWarning, FolderMarkReadResponse, Signature, Rule, RuleAnalysis, RuleRunPageResponse, RuleRunRequest,
  ContactsResponse, Contact, ContactLabel, ContactGroup,
  CalendarsResponse, Calendar, CalendarUpdateResponse, CalendarDeleteResponse,
  CalendarInvitationActionResponse, CalendarInvitationResponse,
  CalendarSubscriptionRefreshResponse,
  CalendarShare,
  Note, NoteAttachment,
  UserIdentities,
} from './types';
import type { NamespaceSettings, SettingsNamespace } from '../settings/settingsApi';

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

export async function createFolder(parent: string | null, name: string): Promise<MailFolder> {
  const res = await fetch('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parent, name }),
  });
  const data = await res.json().catch(() => ({ success: false })) as FolderMutationResponse;
  if (!res.ok || !data.success || !data.folder) {
    throw new Error(data.error || 'The folder could not be created.');
  }
  return data.folder;
}

export async function moveFolder(
  path: string,
  parent: string | null,
  sourceUidValidity: string,
  parentUidValidity?: string,
): Promise<{
  previousPath: string;
  folder: MailFolder;
  warnings?: FolderMutationWarning[];
}> {
  const res = await fetch('/api/folders', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, parent, sourceUidValidity, parentUidValidity }),
  });
  const data = await res.json().catch(() => ({ success: false })) as FolderMutationResponse;
  if (!res.ok || !data.success || !data.folder || !data.previousPath) {
    throw new Error(data.error || 'The folder could not be moved.');
  }
  return {
    previousPath: data.previousPath,
    folder: data.folder,
    ...folderMutationWarnings(data.warnings),
  };
}

export async function renameFolder(path: string, name: string, sourceUidValidity: string): Promise<{
  previousPath: string;
  folder: MailFolder;
  warnings?: FolderMutationWarning[];
}> {
  const res = await fetch('/api/folders', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, name, sourceUidValidity }),
  });
  const data = await res.json().catch(() => ({ success: false })) as FolderMutationResponse;
  if (!res.ok || !data.success || !data.folder || !data.previousPath) {
    throw new Error(data.error || 'The folder could not be renamed.');
  }
  return {
    previousPath: data.previousPath,
    folder: data.folder,
    ...folderMutationWarnings(data.warnings),
  };
}

const KNOWN_FOLDER_MUTATION_WARNINGS = new Set<FolderMutationWarning>([
  'SUBSCRIPTIONS_NOT_RECONCILED',
  'SEARCH_INDEX_RESET_FAILED',
  'FAVORITES_NOT_RECONCILED',
]);

function folderMutationWarnings(value: unknown): { warnings?: FolderMutationWarning[] } {
  if (!Array.isArray(value)) return {};
  const warnings = Array.from(new Set(value.filter(
    (warning): warning is FolderMutationWarning => (
      typeof warning === 'string'
      && KNOWN_FOLDER_MUTATION_WARNINGS.has(warning as FolderMutationWarning)
    ),
  )));
  return warnings.length ? { warnings } : {};
}

export async function deleteFolder(
  path: string,
  permanent: boolean,
  sourceUidValidity: string,
): Promise<FolderDeleteResult> {
  const res = await fetch('/api/folders', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, permanent, sourceUidValidity }),
  });
  const data = await res.json().catch(() => ({ success: false })) as FolderMutationResponse;
  if (res.ok && data.success && data.disposition === 'trashed' && data.folder && data.previousPath) {
    return {
      disposition: 'trashed',
      previousPath: data.previousPath,
      folder: data.folder,
      ...folderMutationWarnings(data.warnings),
    };
  }
  if (res.ok && data.success && data.disposition === 'deleted' && data.deletedPath) {
    return {
      disposition: 'deleted',
      deletedPath: data.deletedPath,
      ...folderMutationWarnings(data.warnings),
    };
  }
  throw new Error(data.error || 'The folder could not be deleted.');
}

export async function markFolderRead(path: string): Promise<{ path: string; marked: number; maxUid: number }> {
  const res = await fetch('/api/folders/mark-read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  const data = await res.json().catch(() => ({ success: false })) as FolderMarkReadResponse;
  if (
    !res.ok
    || !data.success
    || typeof data.path !== 'string'
    || typeof data.marked !== 'number'
    || !Number.isInteger(data.maxUid)
    || (data.maxUid ?? -1) < 0
  ) {
    throw new Error(data.error || 'The folder could not be marked as read.');
  }
  return { path: data.path, marked: data.marked, maxUid: data.maxUid as number };
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

export class OutboundSendRequestError extends Error {
  readonly definitive: boolean;
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, definitive: boolean, status?: number, code?: string) {
    super(message);
    this.name = 'OutboundSendRequestError';
    this.definitive = definitive;
    this.status = status;
    this.code = code;
  }
}

export function isDefinitiveSendError(error: unknown): boolean {
  return error instanceof OutboundSendRequestError && error.definitive;
}

function retryAfterMilliseconds(res: Response): number | undefined {
  const value = res.headers?.get('Retry-After');
  if (!value) return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.round(seconds * 1000);
}

function withRetryAfter(res: Response, data: SendMessageResponse): SendMessageResponse {
  if (data.retryAfterMs !== undefined) return data;
  const retryAfterMs = retryAfterMilliseconds(res);
  return retryAfterMs === undefined ? data : { ...data, retryAfterMs };
}

function assertSuccessfulSendResponse(res: Response, data: SendMessageResponse): SendMessageResponse {
  if (!res.ok || !data.success) {
    const definitive = res.status >= 400 && res.status < 500 && res.status !== 429;
    throw new OutboundSendRequestError(data.error || 'Failed to send message', definitive, res.status);
  }
  return withRetryAfter(res, data);
}

export async function sendMessage(
  formData: FormData,
  options: { idempotencyKey: string },
): Promise<SendMessageResponse> {
  if (!options?.idempotencyKey) {
    throw new OutboundSendRequestError('An idempotency key is required before sending a message', true);
  }
  const request: RequestInit = { method: 'POST', body: formData };
  request.headers = { 'Idempotency-Key': options.idempotencyKey };
  const res = await fetch('/api/messages/send', request);
  const data: SendMessageResponse = await res.json().catch(() => ({ success: false }));
  return assertSuccessfulSendResponse(res, data);
}

export async function fetchOutboundMessageStatus(statusUrl: string): Promise<SendMessageResponse> {
  if (!/^\/api\/messages\/outbound\/\d+$/.test(statusUrl)) {
    throw new OutboundSendRequestError('Invalid outbound status URL', true);
  }
  const res = await fetch(statusUrl);
  const data: SendMessageResponse = await res.json().catch(() => ({ success: false }));
  return assertSuccessfulSendResponse(res, data);
}

export async function fetchOutboundMessageStatusByKey(
  idempotencyKey: string,
): Promise<SendMessageResponse> {
  const res = await fetch('/api/messages/outbound/status', {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  const data: SendMessageResponse = await res.json().catch(() => ({ success: false }));
  return assertSuccessfulSendResponse(res, data);
}

export async function saveDraft(formData: FormData): Promise<SaveDraftResponse> {
  const res = await fetch('/api/messages/draft', { method: 'POST', body: formData });
  const data: SaveDraftResponse = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.error || 'Failed to save draft');
  return data;
}

export async function messageAction(action: string, folder: string, uids: number[], targetFolder?: string, junkScope?: 'sender' | 'domain'): Promise<MessageActionResponse> {
  const res = await fetch('/api/messages/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, folder, uids, ...(targetFolder ? { targetFolder } : {}), ...(junkScope ? { junkScope } : {}) }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Action failed');
  return data;
}

export async function undoAction(undo: {
  scheduledId?: number;
  uids?: number[];
  targetFolder?: string;
  sourceFolder?: string;
}): Promise<UndoActionResponse> {
  const res = await fetch('/api/messages/undo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(undo),
  });
  const data = await res.json().catch(() => ({ success: false })) as UndoActionResponse;
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Undo failed');
  }
  return data;
}

export async function removeScheduledMessage(scheduledId: number): Promise<void> {
  const res = await fetch(`/api/messages/scheduled/${scheduledId}`, { method: 'DELETE' });
  const data = await res.json().catch(() => ({})) as { success?: boolean; error?: string };
  if (!res.ok || data.success === false) {
    throw new Error(data.error || 'The scheduled message could not be removed');
  }
}

export async function searchMessages({
  query,
  field,
  scope,
  folder,
  limit,
  signal,
}: {
  query: string;
  field: SearchField;
  scope: SearchScope;
  folder?: string;
  limit?: number;
  signal?: AbortSignal;
}): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query, field, scope });
  if (scope === 'folder' && folder) params.set('folder', folder);
  if (limit !== undefined) params.set('limit', String(limit));
  const res = await fetch(`/api/messages/search?${params}`, { signal });
  const data: SearchResponse = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Search failed');
  return data;
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

export async function purgeSearchIndex(): Promise<void> {
  const res = await fetch('/api/messages/search/index', { method: 'DELETE' });
  const data = await res.json().catch(() => ({ success: false })) as { success?: boolean; error?: string };
  if (!res.ok || !data.success) {
    throw new Error('Search cleanup could not be completed.');
  }
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
  try {
    const res = await fetch('/api/settings/mail');
    if (!res.ok) return [];
    const data = await res.json();
    return data.settings?.signatures || [];
  } catch {
    return [];
  }
}

export async function fetchRules(): Promise<Rule[]> {
  const res = await fetch('/api/rules');
  const data = await res.json().catch(() => ({})) as { rules?: unknown; error?: string };
  if (!res.ok) throw new Error(data.error || 'Failed to load saved rules.');
  if (!Array.isArray(data.rules)) throw new Error('The server did not return a valid saved rule set.');
  return data.rules as Rule[];
}

export async function analyzeRules(rules: Rule[], signal?: AbortSignal): Promise<RuleAnalysis> {
  const res = await fetch('/api/rules/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules }),
    signal,
  });
  const data = await res.json();
  if (!res.ok || !data.success || !data.analysis) {
    throw new Error(data.error || 'Failed to review rule duplicates.');
  }
  return data.analysis;
}

export async function runRulesPage(
  request: RuleRunRequest,
  signal?: AbortSignal,
): Promise<RuleRunPageResponse> {
  const res = await fetch('/api/rules/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    const error = new Error(data.error || 'Failed to run mail rules.') as Error & {
      retrySafe?: boolean;
      pendingCopies?: Array<{ actionKey: string; uid: number; destination: string }>;
    };
    if (typeof data.retrySafe === 'boolean') error.retrySafe = data.retrySafe;
    if (Array.isArray(data.pendingCopies)) error.pendingCopies = data.pendingCopies;
    throw error;
  }
  return data;
}

// ---- Contacts ----
export async function fetchContacts(limit = 200, offset = 0, sortBy = 'firstName', query = ''): Promise<ContactsResponse> {
  const params = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    sortBy,
  });
  const trimmedQuery = query.trim();
  if (trimmedQuery) params.set('q', trimmedQuery);
  const res = await fetch(`/api/apps/contacts?${params.toString()}`);
  return res.json();
}

export async function fetchDirectoryContacts(query?: string): Promise<{ success: boolean; contacts?: Contact[] }> {
  const url = query ? `/api/directory?q=${encodeURIComponent(query)}` : '/api/directory';
  const res = await fetch(url);
  return res.json();
}

export async function fetchContactDuplicates(): Promise<{ success: boolean; groups?: Contact[][] }> {
  const res = await fetch('/api/apps/contacts-duplicates');
  const data = await res.json();
  return { ...data, groups: data.groups || data.duplicates || [] };
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
async function calendarApiResponse<T extends { success?: boolean; error?: string; code?: string }>(
  response: Response,
  fallback: string,
): Promise<T> {
  const body = await response.json().catch(() => ({ success: false })) as T;
  if (!response.ok || !body.success) {
    const message = response.status < 500 && body.error ? body.error : fallback;
    const definitive = response.status >= 400 && response.status < 500 && response.status !== 429;
    throw new OutboundSendRequestError(message, definitive, response.status, body.code);
  }
  return body;
}

export async function fetchCalendars(): Promise<CalendarsResponse> {
  const response = await fetch('/api/apps/calendars');
  return calendarApiResponse<CalendarsResponse>(response, 'Calendars could not be loaded.');
}

export async function createCalendar(
  calendar: Pick<Calendar, 'name' | 'color'> & { subscribed_url?: string },
): Promise<number> {
  const response = await fetch('/api/apps/calendars', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(calendar),
  });
  const body = await calendarApiResponse<{ success: boolean; id?: number; error?: string }>(
    response,
    'The calendar could not be created.',
  );
  if (!Number.isInteger(body.id) || Number(body.id) <= 0) {
    throw new Error('The server did not return the new calendar.');
  }
  return Number(body.id);
}

export async function updateCalendar(
  id: number,
  changes: Pick<Calendar, 'name' | 'color'>,
): Promise<void> {
  const response = await fetch(`/api/apps/calendars/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changes),
  });
  await calendarApiResponse(response, 'The calendar could not be updated.');
}

export async function importCalendar(id: number, icsData: string): Promise<number> {
  const response = await fetch(`/api/apps/calendars/${id}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ics_data: icsData }),
  });
  const body = await calendarApiResponse<{ success: boolean; count?: number; error?: string }>(
    response,
    'The calendar file could not be imported.',
  );
  return Number(body.count || 0);
}

export async function refreshCalendarSubscription(id: number): Promise<CalendarSubscriptionRefreshResponse> {
  const response = await fetch(`/api/apps/calendars/${id}/subscription/refresh`, { method: 'POST' });
  return calendarApiResponse<CalendarSubscriptionRefreshResponse>(
    response,
    'The calendar subscription could not be refreshed.',
  );
}

export async function deleteCalendarApi(id: number): Promise<CalendarDeleteResponse> {
  const response = await fetch(`/api/apps/calendars/${id}`, { method: 'DELETE' });
  return calendarApiResponse<CalendarDeleteResponse>(response, 'The calendar could not be deleted.');
}

export async function saveEvent(icsData: string, calendarId?: number): Promise<CalendarUpdateResponse> {
  const response = await fetch('/api/apps/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: icsData, calendar_id: calendarId }),
  });
  return calendarApiResponse<CalendarUpdateResponse>(response, 'The event could not be saved.');
}

export async function deleteEvent(calendarId: number, uid: string, excludeDate?: string): Promise<void> {
  const url = excludeDate
    ? `/api/apps/events/${calendarId}/${uid}?exclude=${encodeURIComponent(excludeDate)}`
    : `/api/apps/events/${calendarId}/${uid}`;
  const response = await fetch(url, { method: 'DELETE' });
  await calendarApiResponse(response, 'The event could not be deleted.');
}

async function calendarInvitationAction(
  calendarId: number,
  uid: string,
  action: 'respond' | 'cancel' | 'propose-time',
  body: Record<string, unknown>,
  idempotencyKey: string,
  fallback: string,
): Promise<CalendarInvitationActionResponse> {
  const response = await fetch(
    `/api/apps/events/${calendarId}/${encodeURIComponent(uid)}/${action}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(body),
    },
  );
  return calendarApiResponse<CalendarInvitationActionResponse>(response, fallback);
}

export async function respondToCalendarInvitation(
  calendarId: number,
  uid: string,
  response: Exclude<CalendarInvitationResponse, 'needs-action'>,
  idempotencyKey: string,
  retryOf?: string,
): Promise<CalendarInvitationActionResponse> {
  return calendarInvitationAction(
    calendarId, uid, 'respond', { response, ...(retryOf ? { retryOf } : {}) }, idempotencyKey,
    'Your meeting response could not be sent.',
  );
}

export async function cancelCalendarInvitation(
  calendarId: number,
  uid: string,
  scope: 'occurrence' | 'series',
  occurrenceId: string | undefined,
  idempotencyKey: string,
  retryOf?: string,
): Promise<CalendarInvitationActionResponse> {
  return calendarInvitationAction(
    calendarId, uid, 'cancel', {
      scope,
      ...(occurrenceId ? { occurrenceId } : {}),
      ...(retryOf ? { retryOf } : {}),
    }, idempotencyKey,
    'The meeting could not be canceled.',
  );
}

export async function retryCalendarInvitationNotification(
  retryOf: string,
  idempotencyKey: string,
  verifiedAbsent = false,
): Promise<CalendarInvitationActionResponse> {
  const response = await fetch('/api/apps/calendar-invitations/retry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ retryOf, ...(verifiedAbsent ? { verifiedAbsent: true } : {}) }),
  });
  return calendarApiResponse<CalendarInvitationActionResponse>(
    response,
    'The meeting notification could not be retried.',
  );
}

export async function proposeCalendarInvitationTime(
  calendarId: number,
  uid: string,
  proposal: { start: Date; end: Date; comment?: string },
  idempotencyKey: string,
): Promise<CalendarInvitationActionResponse> {
  return calendarInvitationAction(
    calendarId,
    uid,
    'propose-time',
    { start: proposal.start.toISOString(), end: proposal.end.toISOString(), comment: proposal.comment || '' },
    idempotencyKey,
    'The new-time proposal could not be sent.',
  );
}

export async function fetchCalendarShares(calendarId: number): Promise<CalendarShare[]> {
  const response = await fetch(`/api/apps/calendars/${calendarId}/shares`);
  const data = await calendarApiResponse<{
    success: boolean;
    error?: string;
    shares?: Array<CalendarShare & { shared_with_user_id?: string }>;
  }>(response, 'Calendar sharing permissions could not be loaded.');
  return (data.shares || []).flatMap(share => {
    const email = share.email || share.shared_with_user_id;
    return email ? [{ email, permission: share.permission, calendarId }] : [];
  });
}

export async function shareCalendar(calendarId: number, email: string, permission: string): Promise<void> {
  const response = await fetch(`/api/apps/calendars/${calendarId}/shares`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, permission }),
  });
  await calendarApiResponse(response, 'The calendar could not be shared.');
}

export async function unshareCalendar(calendarId: number, email: string): Promise<void> {
  const response = await fetch(`/api/apps/calendars/${calendarId}/shares/${encodeURIComponent(email)}`, { method: 'DELETE' });
  await calendarApiResponse(response, 'The sharing permission could not be removed.');
}

// ---- Notes ----
export class NoteSaveConflictError extends Error {}

export async function fetchNotesApi(): Promise<Note[]> {
  const res = await fetch(`/api/notes?t=${Date.now()}`);
  if (!res.ok) throw new Error('Failed to fetch notes');
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
  if (res.status === 409) {
    throw new NoteSaveConflictError('This note changed elsewhere. Your draft is still open; review the latest version before saving.');
  }
  if (!res.ok) throw new Error('Failed to save note');
  const data = await res.json();
  return data.note;
}

export async function deleteNoteApi(id: string): Promise<void> {
  const res = await fetch(`/api/notes/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete note');
}

// ---- Notes: Image upload ----
export async function uploadNoteImage(file: File, signal?: AbortSignal): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/notes/upload', { method: 'POST', body: formData, signal });
  if (!res.ok) throw new Error('Image upload failed');
  return res.json();
}

// ---- Notes: Reminders ----
export async function fetchNoteReminder(noteId: string): Promise<{ remind_at: string } | null> {
  const res = await fetch(`/api/notes/${noteId}/reminder`);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error('Failed to fetch reminder');
  }
  const data = await res.json();
  return data.reminder || null;
}

export async function saveNoteReminder(noteId: string, remindAt: string): Promise<void> {
  const res = await fetch(`/api/notes/${noteId}/reminder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remind_at: remindAt }),
  });
  if (!res.ok) throw new Error('Failed to save reminder');
}

export async function deleteNoteReminder(noteId: string): Promise<void> {
  const res = await fetch(`/api/notes/${noteId}/reminder`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete reminder');
}

// ---- Notes: Attachments ----
export async function fetchNoteAttachments(noteId: string): Promise<NoteAttachment[]> {
  const res = await fetch(`/api/notes/${noteId}/attachments`);
  if (!res.ok) throw new Error('Failed to fetch attachments');
  const data = await res.json();
  return data.attachments || [];
}

export async function uploadNoteAttachment(noteId: string, file: File): Promise<NoteAttachment> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`/api/notes/${noteId}/attachments`, { method: 'POST', body: formData });
  if (!res.ok) throw new Error('Attachment upload failed');
  const data = await res.json();
  return data.attachment;
}

export async function deleteNoteAttachment(noteId: string, attachmentId: string): Promise<void> {
  const res = await fetch(`/api/notes/${noteId}/attachments/${attachmentId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete attachment');
}

// ---- Settings ----
export interface UserSettingsResponse<T extends SettingsNamespace> {
  success: boolean;
  namespace: T;
  settings: NamespaceSettings[T];
  error?: string;
}

export async function fetchUserSettings<T extends SettingsNamespace>(namespace: T): Promise<UserSettingsResponse<T>> {
  const res = await fetch(`/api/settings/${namespace}`);
  if (!res.ok) throw new Error(`Failed to fetch settings for ${namespace}`);
  return res.json();
}

export async function saveUserSettings<T extends SettingsNamespace>(namespace: T, settings: NamespaceSettings[T]): Promise<void> {
  const res = await fetch(`/api/settings/${namespace}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  });
  if (!res.ok) throw new Error(`Failed to save settings for ${namespace}`);
}

export interface EmptyFolderSnapshot {
  path: string;
  uidValidity: string;
  maxUid: number;
  count: number;
  permanent: boolean;
}

export async function emptyFolder(path: string, snapshot?: EmptyFolderSnapshot): Promise<EmptyFolderSnapshot & { searchIndexReset?: boolean }> {
  const res = await fetch(`/api/folders/${snapshot ? 'empty' : 'empty-preview'}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, ...(snapshot ? { snapshot, confirm: true } : {}) }),
  });
  const data = await res.json();
  if (!res.ok || !data.success) throw new Error(data.error || 'Folder cleanup could not be completed.');
  return data;
}
