export interface FreeBusyInterval {
  start: string;
  end: string;
}

export interface FreeBusyLookup {
  busy: Record<string, FreeBusyInterval[]>;
  unavailable: string[];
}

export type FreeBusyStatus = 'unavailable' | 'busy' | 'free';

function canonicalAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const address = value.trim().toLowerCase();
  return address || null;
}

function canonicalRecipients(recipients: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const recipient of recipients) {
    const address = canonicalAddress(recipient);
    if (address) unique.add(address);
  }
  return [...unique];
}

function validIntervals(value: unknown): FreeBusyInterval[] | null {
  if (!Array.isArray(value)) return null;

  const intervals: FreeBusyInterval[] = [];
  for (const interval of value) {
    if (!interval || typeof interval !== 'object') return null;
    const start = (interval as { start?: unknown }).start;
    const end = (interval as { end?: unknown }).end;
    if (typeof start !== 'string' || typeof end !== 'string') return null;
    const startTime = Date.parse(start);
    const endTime = Date.parse(end);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) return null;
    intervals.push({ start, end });
  }
  return intervals;
}

export function buildFreeBusyRequestUrl(recipients: readonly string[], start: Date, end: Date): string {
  const params = new URLSearchParams({
    users: canonicalRecipients(recipients).join(','),
    start: start.toISOString(),
    end: end.toISOString(),
  });
  return `/api/apps/calendars/freebusy?${params.toString()}`;
}

export function createUnavailableFreeBusyLookup(recipients: readonly string[]): FreeBusyLookup {
  return {
    busy: {},
    unavailable: canonicalRecipients(recipients),
  };
}

export function normalizeFreeBusyResponse(recipients: readonly string[], value: unknown): FreeBusyLookup {
  const requested = canonicalRecipients(recipients);
  const requestedSet = new Set(requested);
  const response = value && typeof value === 'object'
    ? value as { busy?: unknown; unavailable?: unknown }
    : {};
  const explicitlyUnavailable = new Set(
    Array.isArray(response.unavailable)
      ? response.unavailable
        .map(canonicalAddress)
        .filter((address): address is string => !!address && requestedSet.has(address))
      : [],
  );
  const responseBusy = new Map<string, FreeBusyInterval[] | null>();

  if (response.busy && typeof response.busy === 'object' && !Array.isArray(response.busy)) {
    for (const [rawAddress, rawIntervals] of Object.entries(response.busy)) {
      const address = canonicalAddress(rawAddress);
      if (address && requestedSet.has(address)) responseBusy.set(address, validIntervals(rawIntervals));
    }
  }

  const busy: Record<string, FreeBusyInterval[]> = {};
  const unavailable: string[] = [];
  for (const address of requested) {
    const intervals = responseBusy.get(address);
    if (explicitlyUnavailable.has(address) || intervals === undefined || intervals === null) {
      unavailable.push(address);
    } else {
      busy[address] = intervals;
    }
  }

  return { busy, unavailable };
}

export function freeBusyStatusForUser(
  lookup: FreeBusyLookup,
  recipient: string,
  eventStart: Date,
  eventEnd: Date,
): FreeBusyStatus {
  const address = canonicalAddress(recipient);
  const startTime = eventStart.getTime();
  const endTime = eventEnd.getTime();
  if (
    !address
    || !Number.isFinite(startTime)
    || !Number.isFinite(endTime)
    || endTime <= startTime
    || lookup.unavailable.includes(address)
    || !Object.hasOwn(lookup.busy, address)
  ) {
    return 'unavailable';
  }

  return lookup.busy[address].some((interval) => (
    Date.parse(interval.start) < endTime && Date.parse(interval.end) > startTime
  )) ? 'busy' : 'free';
}
