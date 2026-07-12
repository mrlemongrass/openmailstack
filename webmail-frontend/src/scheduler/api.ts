export interface SchedulerWindow {
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export type SchedulerBookingQuestionType = 'short_text' | 'long_text' | 'select';

export interface SchedulerBookingQuestion {
  id: string;
  label: string;
  type: SchedulerBookingQuestionType;
  required: boolean;
  options: string[];
}

export interface SchedulerBookingAnswer {
  questionId: string;
  label: string;
  type: SchedulerBookingQuestionType;
  value: string;
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
  requiresConfirmation: boolean;
  cancellationCutoffMinutes: number | null;
  rescheduleCutoffMinutes: number | null;
  requireCancellationReason: boolean;
  requireRescheduleReason: boolean;
  activeBookingLimit: number | null;
  guestAllowList: string[];
  guestDenyList: string[];
  requireEmailVerification: boolean;
  maxAdditionalGuests: number;
  waitlistEnabled: boolean;
  maxRecurrenceOccurrences: number;
  publicAccentColor: string;
  publicIntro: string;
  privacyUrl: string;
  termsUrl: string;
  locale: string;
  lockedTimeZone: string | null;
  questions: SchedulerBookingQuestion[];
}

export interface SchedulerPrivateLinkState {
  active: boolean;
  expired: boolean;
  consumed: boolean;
  singleUse: boolean;
  remainingUses: number | null;
  oneOff: boolean;
  oneOffTimeZone: string | null;
  oneOffWindows: SchedulerOneOffWindow[];
  tokenHint: string | null;
  expiresAt: string | null;
}

export interface SchedulerOneOffWindow {
  date: string;
  startMinute: number;
  endMinute: number;
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
  exclusions: SchedulerAvailabilityExclusion[];
}

export interface SchedulerAvailabilityExclusion {
  id?: string;
  kind: 'holiday' | 'out_of_office';
  startDate: string;
  endDate: string;
  label: string;
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
  bookingAnswers: SchedulerBookingAnswer[];
  cancellationReason: string;
  rescheduleReason: string;
  seats: number;
  attendees: SchedulerAttendee[];
  bookedByUsername: string | null;
  attribution: Record<string, string>;
  seriesId: string | null;
  seriesIndex: number | null;
  seriesCount: number | null;
  event: SchedulerEventType;
}

export interface SchedulerAttendee {
  name: string;
  email: string;
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
  waitlist: SchedulerWaitlistEntry[];
  polls: SchedulerPoll[];
}

export interface SchedulerWaitlistEntry {
  id: string; status: string; booker_name: string; booker_email: string; seats: number;
  desiredStart: string; title: string; slug: string; promoted_booking_id: string | null;
}

export interface SchedulerPollOption { id: string; start: string; end?: string; votes: number }
export interface SchedulerPoll { id: string; title: string; status: string; eventTypeId: string; eventTitle: string; finalizedOptionId: string | null; options: SchedulerPollOption[] }

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

export async function rotateSchedulerPrivateLink(id: string, options: {
  expiresAt: string | null;
  singleUse: boolean;
  oneOffAvailability: { timeZone: string; windows: SchedulerOneOffWindow[] } | null;
}): Promise<{ privateLink: SchedulerPrivateLinkState; url: string }> {
  return request(`/api/scheduler/v1/event-types/${id}/private-link`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options),
  });
}

export async function revokeSchedulerPrivateLink(id: string): Promise<void> {
  await request(`/api/scheduler/v1/event-types/${id}/private-link`, { method: 'DELETE' });
}

export async function cancelSchedulerBooking(id: string): Promise<void> {
  await request(`/api/scheduler/v1/bookings/${id}/cancel`, { method: 'POST' });
}

export async function decideSchedulerBooking(id: string, decision: 'confirm' | 'reject'): Promise<void> {
  await request(`/api/scheduler/v1/bookings/${id}/${decision}`, { method: 'POST' });
}

export async function getPublicProfile(handle: string): Promise<{ profile: SchedulerEntitlement; events: SchedulerEventType[]; defaultEvent: SchedulerEventType | null }> {
  return request(`/api/public/scheduler/v1/profiles/${encodeURIComponent(handle)}`);
}

const accessHeaders = (accessToken = ''): HeadersInit => accessToken ? { 'X-Scheduler-Access': accessToken } : {};

export async function getPublicEvent(handle: string, slug: string, accessToken = ''): Promise<{ profile: SchedulerEntitlement; event: SchedulerEventType }> {
  return request(`/api/public/scheduler/v1/profiles/${encodeURIComponent(handle)}/events/${encodeURIComponent(slug)}`, { headers: accessHeaders(accessToken) });
}

export async function getPublicSlots(handle: string, slug: string, start: Date, end: Date, accessToken = '', includeFull = false): Promise<Array<{ start: string; end: string; remainingSeats: number }>> {
  const result = await request<{ slots: Array<{ start: string; end: string; remainingSeats: number }> }>(
    `/api/public/scheduler/v1/profiles/${encodeURIComponent(handle)}/events/${encodeURIComponent(slug)}/slots?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}${includeFull ? '&includeFull=true' : ''}`,
    { headers: accessHeaders(accessToken) },
  );
  return result.slots;
}

export async function joinPublicWaitlist(handle: string, slug: string, payload: Record<string, unknown>, accessToken = '', idempotencyKey = crypto.randomUUID()): Promise<void> {
  await request(`/api/public/scheduler/v1/profiles/${encodeURIComponent(handle)}/events/${encodeURIComponent(slug)}/waitlist`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey, ...accessHeaders(accessToken) },
    body: JSON.stringify({ ...payload, idempotencyKey }),
  });
}

export async function bookSchedulerOnBehalf(payload: Record<string, unknown>): Promise<void> {
  await request('/api/scheduler/v1/bookings/on-behalf', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(payload) });
}

export async function markSchedulerBookingOutcome(id: string, outcome: 'completed' | 'no_show'): Promise<void> {
  await request(`/api/scheduler/v1/bookings/${id}/outcome`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ outcome }) });
}

export async function createSchedulerPoll(payload: Record<string, unknown>): Promise<{ poll: SchedulerPoll & { token: string }; url: string }> {
  return request('/api/scheduler/v1/polls', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}

export async function finalizeSchedulerPoll(id: string, optionId: string): Promise<void> {
  await request(`/api/scheduler/v1/polls/${id}/finalize`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ optionId }) });
}

export async function getPublicPoll(token: string): Promise<{ poll: SchedulerPoll & { eventTitle: string; hostName: string; requireEmailVerification: boolean } }> {
  return request(`/api/public/scheduler/v1/polls/${encodeURIComponent(token)}`);
}

export async function requestPublicPollVerification(token: string, voterEmail: string): Promise<{ challengeId: string; expiresAt: string }> {
  const result = await request<{ verification: { challengeId: string; expiresAt: string } }>(`/api/public/scheduler/v1/polls/${encodeURIComponent(token)}/verification`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voterEmail }),
  });
  return result.verification;
}

export async function votePublicPoll(token: string, payload: Record<string, unknown>): Promise<void> {
  await request(`/api/public/scheduler/v1/polls/${encodeURIComponent(token)}/votes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}

export async function importSchedulerData(source: 'openmailstack' | 'calendly' | 'calcom', payload: unknown): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const result = await request<{ result: { imported: number; skipped: number; errors: string[] } }>('/api/scheduler/v1/import', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, payload }),
  });
  return result.result;
}

export async function requestPublicVerification(handle: string, slug: string, bookerEmail: string, accessToken = ''): Promise<{ challengeId: string; expiresAt: string }> {
  const result = await request<{ verification: { challengeId: string; expiresAt: string } }>(
    `/api/public/scheduler/v1/profiles/${encodeURIComponent(handle)}/events/${encodeURIComponent(slug)}/verification`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', ...accessHeaders(accessToken) }, body: JSON.stringify({ bookerEmail }) },
  );
  return result.verification;
}

export async function createPublicBooking(handle: string, slug: string, payload: Record<string, unknown>, accessToken = '', idempotencyKey = crypto.randomUUID()): Promise<{ id: string; status: string; start: string; end: string }> {
  const result = await request<{ booking: { id: string; status: string; start: string; end: string } }>(
    `/api/public/scheduler/v1/profiles/${encodeURIComponent(handle)}/events/${encodeURIComponent(slug)}/bookings`,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey, ...accessHeaders(accessToken) }, body: JSON.stringify({ ...payload, idempotencyKey }) },
  );
  return result.booking;
}

export interface SchedulerBookingActionPolicy {
  allowed: boolean;
  cutoffMinutes: number | null;
  reasonRequired: boolean;
  closesAt: string | null;
}

export async function getBookingAction(scope: 'cancel' | 'reschedule', token: string): Promise<{ booking: SchedulerBooking; scope: string; policy: SchedulerBookingActionPolicy }> {
  return request(`/api/public/scheduler/v1/actions/${scope}/${encodeURIComponent(token)}`);
}

export async function applyBookingAction(scope: 'cancel' | 'reschedule', token: string, start?: string, reason = ''): Promise<void> {
  await request(`/api/public/scheduler/v1/actions/${scope}/${encodeURIComponent(token)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(start ? { start } : {}), reason }),
  });
}
