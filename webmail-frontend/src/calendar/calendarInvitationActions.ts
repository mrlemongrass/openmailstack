import type { CalendarEvent } from '../shared/types';
import type { CrossSuiteComposeDraft } from '../shared/crossSuiteCompose';

export type CalendarInvitationComposeAction = 'reply' | 'reply-all' | 'forward';

function prefixedSubject(prefix: 'Re' | 'Fwd', subject: string): string {
  const value = subject.trim() || 'Untitled meeting';
  const existing = prefix === 'Re' ? /^(?:re\s*:)/i : /^(?:fwd?\s*:)/i;
  return existing.test(value) ? value : `${prefix}: ${value}`;
}

function eventFileName(title: string): string {
  const stem = title.trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'meeting';
  return `${stem}.ics`;
}

function meetingBody(event: CalendarEvent): string {
  const start = event.sourceStart || event.start;
  const end = event.sourceEnd || event.end;
  return [
    '',
    '',
    `Meeting: ${event.title || 'Untitled meeting'}`,
    `When: ${start.toISOString()} – ${end.toISOString()}`,
    ...(event.location ? [`Where: ${event.location}`] : []),
    ...(event.description ? ['', event.description] : []),
  ].join('\n');
}

function uniqueAddresses(addresses: Array<string | undefined>, excluded: Set<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of addresses) {
    const address = value?.trim();
    const normalized = address?.toLowerCase();
    if (!address || !normalized || excluded.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(address);
  }
  return result;
}

export function calendarInvitationComposeDraft(
  action: CalendarInvitationComposeAction,
  event: CalendarEvent,
): CrossSuiteComposeDraft {
  const invitation = event.invitation;
  if (!invitation) throw new Error('This event is not a meeting invitation.');
  const ownAddress = invitation.role === 'organizer'
    ? invitation.organizerEmail
    : invitation.attendeeEmail;
  const from = ownAddress ? { from: ownAddress } : {};
  const excluded = new Set([ownAddress?.toLowerCase()].filter(Boolean) as string[]);
  const participantAddresses = uniqueAddresses(
    invitation.attendees.map(attendee => attendee.email),
    excluded,
  );
  const body = meetingBody(event);

  if (action === 'forward') {
    if (!invitation.canForward) throw new Error('The organizer does not allow forwarding this meeting.');
    if (!event.rawIcal) throw new Error('The meeting file is unavailable for forwarding.');
    return {
      ...from,
      subject: prefixedSubject('Fwd', event.title),
      body,
      attachments: [{
        name: eventFileName(event.title),
        type: 'text/calendar;charset=utf-8',
        content: event.rawIcal,
      }],
    };
  }

  if (action === 'reply-all' && invitation.attendeesTruncated) {
    throw new Error('Reply all is unavailable because this meeting has more attendees than can be reviewed safely.');
  }

  if (invitation.role === 'organizer') {
    return {
      ...from,
      ...(participantAddresses.length ? { to: participantAddresses.join(', ') } : {}),
      subject: prefixedSubject('Re', event.title),
      body,
    };
  }

  const organizer = invitation.organizerEmail;
  const copied = action === 'reply-all'
    ? participantAddresses.filter(address => address.toLowerCase() !== organizer.toLowerCase())
    : [];
  return {
    ...from,
    to: organizer,
    ...(copied.length ? { cc: copied.join(', ') } : {}),
    subject: prefixedSubject('Re', event.title),
    body,
  };
}
