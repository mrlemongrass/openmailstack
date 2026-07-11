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
  publicBaseUrl: string;
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

export async function cancelSchedulerBooking(id: string): Promise<void> {
  await request(`/api/scheduler/v1/bookings/${id}/cancel`, { method: 'POST' });
}

export async function getPublicProfile(handle: string): Promise<{ profile: SchedulerEntitlement; events: SchedulerEventType[] }> {
  return request(`/api/public/scheduler/v1/profiles/${encodeURIComponent(handle)}`);
}

export async function getPublicEvent(handle: string, slug: string): Promise<{ profile: SchedulerEntitlement; event: SchedulerEventType }> {
  return request(`/api/public/scheduler/v1/profiles/${encodeURIComponent(handle)}/events/${encodeURIComponent(slug)}`);
}

export async function getPublicSlots(handle: string, slug: string, start: Date, end: Date): Promise<Array<{ start: string; end: string }>> {
  const result = await request<{ slots: Array<{ start: string; end: string }> }>(
    `/api/public/scheduler/v1/profiles/${encodeURIComponent(handle)}/events/${encodeURIComponent(slug)}/slots?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`,
  );
  return result.slots;
}

export async function createPublicBooking(handle: string, slug: string, payload: Record<string, unknown>): Promise<{ id: string; status: string; start: string; end: string }> {
  const idempotencyKey = crypto.randomUUID();
  const result = await request<{ booking: { id: string; status: string; start: string; end: string } }>(
    `/api/public/scheduler/v1/profiles/${encodeURIComponent(handle)}/events/${encodeURIComponent(slug)}/bookings`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ ...payload, idempotencyKey }) },
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
