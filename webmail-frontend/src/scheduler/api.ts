export interface SchedulerWindow {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface SchedulerEventType {
  id: string;
  slug: string;
  title: string;
  description: string;
  durationMinutes: number;
  intervalMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
  capacity: number;
  locationType: 'in_person' | 'phone' | 'custom' | 'conference';
  locationLabel: string;
  destinationCalendarId: number | null;
  conflictCalendarIds: number[];
  active: boolean;
  windows: SchedulerWindow[];
  availabilityScheduleId: string | null;
  systemManaged: boolean;
  visibility: 'public' | 'unlisted' | 'private';
}

export interface SchedulerPrivateLinkState {
  active: boolean;
  expired: boolean;
  tokenHint: string | null;
  expiresAt: string | null;
}

export interface SchedulerAvailabilityOverride {
  id?: string;
  date: string;
  unavailableAllDay: boolean;
  windows: Array<{ startMinute: number; endMinute: number }>;
  note?: string;
}

export interface SchedulerAvailability {
  id: string;
  name: string;
  timeZone: string;
  isDefault: boolean;
  published: boolean;
  windows: SchedulerWindow[];
  overrides: SchedulerAvailabilityOverride[];
}

export interface SchedulerEntitlement {
  username: string;
  tenantKey: string;
  handle: string;
  enabled: boolean;
  published: boolean;
  displayName: string;
  welcomeMessage: string;
  timeZone: string;
  defaultCalendarId: number | null;
  notificationFrom: string;
}

export interface SchedulerBooking {
  id: string;
  status: string;
  start: string;
  end: string;
  bookerName: string;
  bookerEmail: string;
  bookerNotes: string;
  event: SchedulerEventType;
}

export interface SchedulerCalendar {
  id: number;
  name: string;
  color?: string;
}

export interface SchedulerState {
  entitlement: SchedulerEntitlement;
  events: SchedulerEventType[];
  bookings: SchedulerBooking[];
  calendars: SchedulerCalendar[];
  defaultAvailability: SchedulerAvailability;
  notificationIdentities: Array<{ address: string; name: string }>;
  publicBaseUrl: string;
}

export async function saveDefaultAvailability(availability: Partial<SchedulerAvailability>): Promise<SchedulerAvailability> {
  const result = await request<{ availability: SchedulerAvailability }>('/api/scheduler/v1/availability/default', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(availability),
  });
  return result.availability;
}

export async function previewDefaultAvailability(start: Date, end: Date): Promise<{ slots: Array<{ start: string; end: string }>; busyIntervalCount: number; overrideCount: number }> {
  return request<{ slots: Array<{ start: string; end: string }>; busyIntervalCount: number; overrideCount: number }>(
    `/api/scheduler/v1/availability/preview?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`,
  );
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'include', ...options });
  const body = await response.json() as { success: boolean; error?: string } & T;
  if (!response.ok || !body.success) throw new Error(body.error || 'Scheduler request failed');
  return body;
}

export async function getSchedulerState(filter = 'upcoming'): Promise<SchedulerState> {
  return request<SchedulerState>(`/api/scheduler/v1/me?filter=${encodeURIComponent(filter)}`);
}

export async function saveSchedulerProfile(profile: Partial<SchedulerEntitlement>): Promise<SchedulerEntitlement> {
  const result = await request<{ entitlement: SchedulerEntitlement }>('/api/scheduler/v1/profile', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile),
  });
  return result.entitlement;
}

export async function saveSchedulerEvent(event: Partial<SchedulerEventType>): Promise<SchedulerEventType> {
  const editing = Boolean(event.id);
  const result = await request<{ event: SchedulerEventType }>(editing ? `/api/scheduler/v1/event-types/${event.id}` : '/api/scheduler/v1/event-types', {
    method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event),
  });
  return result.event;
}

export async function deleteSchedulerEvent(id: string): Promise<void> {
  await request(`/api/scheduler/v1/event-types/${id}`, { method: 'DELETE' });
}

export async function getSchedulerPrivateLink(id: string): Promise<SchedulerPrivateLinkState> {
  const result = await request<{ privateLink: SchedulerPrivateLinkState }>(`/api/scheduler/v1/event-types/${id}/private-link`);
  return result.privateLink;
}

export async function rotateSchedulerPrivateLink(id: string, expiresAt: string | null): Promise<{ privateLink: SchedulerPrivateLinkState; url: string }> {
  return request(`/api/scheduler/v1/event-types/${id}/private-link`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresAt }),
  });
}

export async function revokeSchedulerPrivateLink(id: string): Promise<void> {
  await request(`/api/scheduler/v1/event-types/${id}/private-link`, { method: 'DELETE' });
}

export async function cancelSchedulerBooking(id: string): Promise<void> {
  await request(`/api/scheduler/v1/bookings/${id}/cancel`, { method: 'POST' });
}

export async function getPublicProfile(handle: string): Promise<{ profile: SchedulerEntitlement; events: SchedulerEventType[]; defaultEvent: SchedulerEventType | null }> {
  return request(`/api/public/scheduler/v1/profiles/${encodeURIComponent(handle)}`);
}

const accessHeaders = (accessToken = ''): HeadersInit => accessToken ? { 'X-Scheduler-Access': accessToken } : {};

export async function getPublicEvent(handle: string, slug: string, accessToken = ''): Promise<{ profile: SchedulerEntitlement; event: SchedulerEventType }> {
  return request(`/api/public/scheduler/v1/profiles/${encodeURIComponent(handle)}/events/${encodeURIComponent(slug)}`, { headers: accessHeaders(accessToken) });
}

export async function getPublicSlots(handle: string, slug: string, start: Date, end: Date, accessToken = ''): Promise<Array<{ start: string; end: string }>> {
  const result = await request<{ slots: Array<{ start: string; end: string }> }>(
    `/api/public/scheduler/v1/profiles/${encodeURIComponent(handle)}/events/${encodeURIComponent(slug)}/slots?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`,
    { headers: accessHeaders(accessToken) },
  );
  return result.slots;
}

export async function createPublicBooking(handle: string, slug: string, payload: Record<string, unknown>, accessToken = ''): Promise<{ id: string; status: string; start: string; end: string }> {
  const idempotencyKey = crypto.randomUUID();
  const result = await request<{ booking: { id: string; status: string; start: string; end: string } }>(
    `/api/public/scheduler/v1/profiles/${encodeURIComponent(handle)}/events/${encodeURIComponent(slug)}/bookings`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey, ...accessHeaders(accessToken) }, body: JSON.stringify({ ...payload, idempotencyKey }) },
  );
  return result.booking;
}

export async function getBookingAction(scope: 'cancel' | 'reschedule', token: string): Promise<{ booking: SchedulerBooking; scope: string }> {
  return request(`/api/public/scheduler/v1/actions/${scope}/${encodeURIComponent(token)}`);
}

export async function applyBookingAction(scope: 'cancel' | 'reschedule', token: string, start?: string): Promise<void> {
  await request(`/api/public/scheduler/v1/actions/${scope}/${encodeURIComponent(token)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(start ? { start } : {}),
  });
}
