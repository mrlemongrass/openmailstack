import { useState, useRef } from 'react';
import {
  CalendarClock,
  CalendarPlus,
  Check,
  CircleHelp,
  Copy,
  CopyPlus,
  Download,
  ExternalLink,
  Forward,
  Pencil,
  Printer,
  Reply,
  ReplyAll,
  Trash2,
  XCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import type { CalendarEvent, CalendarInvitationResponse } from '../shared/types';
import { ContextMenu, type ContextMenuItem } from '../shared/components/ContextMenu';
import { ConfirmDialog } from '../shared/components/ConfirmDialog';
import { useToast } from '../shared/components/Toast';
import { openCrossSuiteCompose } from '../shared/crossSuiteCompose';
import type { useCalendar } from './hooks/useCalendar';
import { formatWallTime, wallDateToInstant } from './calendarTime';
import {
  canEditCalendarEvents,
  downloadableCalendarEventIcal,
  eventIcsFilename,
  meetingUrlForEvent,
} from './calendarContextActions';
import { calendarInvitationComposeDraft } from './calendarInvitationActions';
import { CalendarNewTimeProposalDialog } from './CalendarInvitationDialogs';

interface EventDeleteTarget {
  event: CalendarEvent;
  scope: 'event' | 'occurrence' | 'series';
}

type MeetingResponse = Exclude<CalendarInvitationResponse, 'needs-action'>;

interface InvitationResponseTarget {
  event: CalendarEvent;
  response: MeetingResponse;
}

interface InvitationCancellationTarget {
  event: CalendarEvent;
  scope: 'occurrence' | 'series';
}

const MEETING_RESPONSES: Array<{
  response: MeetingResponse;
  label: string;
  currentLabel: string;
  icon: typeof Check;
}> = [
  { response: 'accepted', label: 'Accept', currentLabel: 'Accepted', icon: Check },
  { response: 'tentative', label: 'Tentative', currentLabel: 'Tentative', icon: CircleHelp },
  { response: 'declined', label: 'Decline', currentLabel: 'Declined', icon: XCircle },
];

function invitationError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function downloadEvent(event: CalendarEvent, displayTimeZone: string) {
  const ical = downloadableCalendarEventIcal(event, displayTimeZone);
  const url = URL.createObjectURL(new Blob([ical], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = eventIcsFilename(event);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[character] || character);
}

function printEvent(event: CalendarEvent, clockFormat: '12h' | '24h') {
  const printWindow = window.open('', '_blank');
  if (!printWindow) throw new Error('Allow pop-ups to print this event.');
  printWindow.opener = null;
  const date = format(event.start, 'EEEE, MMMM d, yyyy');
  const time = event.isAllDay
    ? 'All day'
    : `${formatWallTime(event.start, clockFormat)} – ${formatWallTime(event.end, clockFormat)}`;
  printWindow.document.write(`<!doctype html><html><head><title>${escapeHtml(event.title || 'Event')}</title>
    <style>body{font-family:system-ui,sans-serif;max-width:720px;margin:48px;color:#111}h1{margin-bottom:8px}dl{display:grid;grid-template-columns:100px 1fr;gap:10px 16px}dt{font-weight:700}dd{margin:0;white-space:pre-wrap}</style>
    </head><body><h1>${escapeHtml(event.title || 'Untitled event')}</h1><dl>
    <dt>When</dt><dd>${escapeHtml(`${date}\n${time}`)}</dd>
    ${event.location ? `<dt>Where</dt><dd>${escapeHtml(event.location)}</dd>` : ''}
    ${event.description ? `<dt>Details</dt><dd>${escapeHtml(event.description)}</dd>` : ''}
    </dl></body></html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

async function copyMeetingLink(url: string) {
  await navigator.clipboard.writeText(url);
}

export function CalendarContextMenus({ cal }: { cal: ReturnType<typeof useCalendar> }) {
  const { showToast } = useToast();
  const deleteLock = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EventDeleteTarget | null>(null);
  const [responseTarget, setResponseTarget] = useState<InvitationResponseTarget | null>(null);
  const [cancellationTarget, setCancellationTarget] = useState<InvitationCancellationTarget | null>(null);
  const [proposalEvent, setProposalEvent] = useState<CalendarEvent | null>(null);
  const context = cal.calendarContextMenu;

  const queueResponse = (event: CalendarEvent, response: MeetingResponse) => {
    void cal.respondToInvitation(event, response).then(
      () => showToast({ type: 'success', message: 'Meeting response sent' }),
      (error: unknown) => showToast({
        type: 'error',
        message: invitationError(error, 'Your meeting response could not be sent.'),
      }),
    );
  };

  const queueCancellation = (event: CalendarEvent, scope: 'occurrence' | 'series') => {
    void cal.cancelInvitation(event, scope).then(
      () => showToast({ type: 'success', message: scope === 'occurrence' ? 'Occurrence cancellation sent' : 'Meeting cancellation sent' }),
      (error: unknown) => showToast({
        type: 'error',
        message: invitationError(error, 'The meeting could not be canceled.'),
      }),
    );
  };

  const openInvitationCompose = (
    action: 'reply' | 'reply-all' | 'forward',
    event: CalendarEvent,
  ) => {
    try {
      openCrossSuiteCompose(calendarInvitationComposeDraft(action, event));
    } catch (error) {
      showToast({
        type: 'error',
        message: invitationError(error, 'Compose could not be opened for this meeting.'),
      });
    }
  };

  let items: ContextMenuItem[] = [];
  let label = 'Calendar actions';

  if (context?.kind === 'slot') {
    label = 'Calendar time actions';
    items = [
      {
        id: 'new-event',
        label: 'New event',
        icon: CalendarPlus,
        onSelect: () => cal.openNewEvent(context.start, context.isAllDay),
      },
      {
        id: 'go-today',
        label: 'Go to today',
        icon: ExternalLink,
        onSelect: () => cal.setCurrentDate(cal.displayNow),
      },
    ];
  } else if (context?.kind === 'event') {
    label = `${context.event.title || 'Event'} actions`;
    const meetingUrl = meetingUrlForEvent(context.event);
    const sourceCalendar = cal.calendars.find(calendar => calendar.id === context.event.calendarId);
    const canEdit = Boolean(sourceCalendar && canEditCalendarEvents(sourceCalendar));
    const invitation = context.event.invitation;
    const isAttendee = invitation?.role === 'attendee';
    const isOrganizer = invitation?.role === 'organizer';
    const currentResponse = invitation?.recurring ? invitation.seriesResponse : invitation?.response;
    const canEditDetails = canEdit && !invitation;
    const canDuplicate = cal.writableCalendars.length > 0;
    const invitationPending = Boolean(
      cal.invitationActionPending?.startsWith(`${context.event.calendarId}:${context.event.id}:`),
    );
    const invitationItems: ContextMenuItem[] = [];

    if (invitation && isAttendee && invitation.canRespond !== false && canEdit) {
      invitationItems.push(...MEETING_RESPONSES.map(({ response, label: responseLabel, currentLabel, icon }, index) => ({
        id: `respond-${response}`,
        label: currentResponse === response
          ? `${currentLabel} (current)`
          : invitation.recurring ? `${responseLabel} entire series` : responseLabel,
        icon,
        separatorBefore: index === 0,
        disabled: invitationPending || currentResponse === response,
        onSelect: () => {
          if (invitation.recurring) setResponseTarget({ event: context.event, response });
          else queueResponse(context.event, response);
        },
      })));
      if (invitation.canProposeNewTime) {
        invitationItems.push({
          id: 'propose-new-time',
          label: 'Propose new time',
          icon: CalendarClock,
          disabled: invitationPending,
          onSelect: () => setProposalEvent(context.event),
        });
      }
    }

    if (invitation && (isAttendee || isOrganizer)) {
      if (isAttendee) {
        invitationItems.push({
          id: 'reply',
          label: 'Reply',
          icon: Reply,
          separatorBefore: true,
          onSelect: () => openInvitationCompose('reply', context.event),
        });
      }
      invitationItems.push({
        id: 'reply-all',
        label: invitation.attendeesTruncated ? 'Reply all unavailable (large meeting)' : 'Reply all',
        icon: ReplyAll,
        separatorBefore: !isAttendee,
        disabled: invitation.attendeesTruncated,
        onSelect: () => openInvitationCompose('reply-all', context.event),
      });
      invitationItems.push({
        id: 'forward',
        label: 'Forward',
        icon: Forward,
        disabled: !invitation.canForward,
        onSelect: () => openInvitationCompose('forward', context.event),
      });
    }

    items = [
      {
        id: 'open-event',
        label: canEditDetails ? 'Edit event' : 'View event',
        icon: Pencil,
        onSelect: () => cal.editExistingEvent(context.event),
      },
      ...(invitation?.actionUnavailableReason ? [{
        id: 'meeting-actions-unavailable',
        label: invitation.actionUnavailableReason,
        icon: CircleHelp,
        disabled: true,
        onSelect: () => undefined,
      }] satisfies ContextMenuItem[] : []),
      ...invitationItems,
      ...(meetingUrl ? [
        {
          id: 'join-meeting',
          label: 'Join meeting',
          icon: ExternalLink,
          separatorBefore: true,
          onSelect: () => window.open(meetingUrl, '_blank', 'noopener,noreferrer'),
        },
        {
          id: 'copy-meeting-link',
          label: 'Copy meeting link',
          icon: Copy,
          onSelect: () => {
            void copyMeetingLink(meetingUrl).then(
              () => showToast({ type: 'success', message: 'Meeting link copied' }),
              () => showToast({ type: 'error', message: 'The meeting link could not be copied.' }),
            );
          },
        },
      ] satisfies ContextMenuItem[] : []),
      {
        id: 'print-event',
        label: 'Print',
        icon: Printer,
        separatorBefore: true,
        onSelect: () => {
          try {
            printEvent(context.event, cal.calendarSettings.clockFormat);
          } catch (error) {
            showToast({ type: 'error', message: error instanceof Error ? error.message : 'The event could not be printed.' });
          }
        },
      },
      {
        id: 'duplicate-event',
        label: 'Duplicate event',
        icon: CopyPlus,
        disabled: !canDuplicate,
        onSelect: () => cal.duplicateEvent(context.event),
      },
      {
        id: 'download-event',
        label: 'Download .ics',
        icon: Download,
        onSelect: () => downloadEvent(context.event, cal.displayTimeZone),
      },
      ...(canEdit && isOrganizer && invitation.canCancel && context.event.recurrence && context.event.occurrenceId ? [
        ...(invitation.canCancelOccurrence ? [{
          id: 'cancel-occurrence',
          label: 'Cancel this occurrence',
          icon: XCircle,
          danger: true,
          separatorBefore: true,
          onSelect: () => setCancellationTarget({ event: context.event, scope: 'occurrence' }),
        }] satisfies ContextMenuItem[] : []),
        {
          id: 'cancel-series',
          label: 'Cancel entire series',
          icon: XCircle,
          danger: true,
          separatorBefore: !invitation.canCancelOccurrence,
          onSelect: () => setCancellationTarget({ event: context.event, scope: 'series' }),
        },
      ] satisfies ContextMenuItem[] : canEdit && isOrganizer && invitation.canCancel ? [{
        id: 'cancel-meeting',
        label: context.event.recurrence ? 'Cancel entire series' : 'Cancel meeting',
        icon: XCircle,
        danger: true,
        separatorBefore: true,
        onSelect: () => setCancellationTarget({ event: context.event, scope: 'series' }),
      }] satisfies ContextMenuItem[] : !invitation && canEdit && context.event.recurrence && context.event.occurrenceId ? [
        {
          id: 'delete-occurrence',
          label: 'Delete this occurrence',
          icon: Trash2,
          danger: true,
          separatorBefore: true,
          onSelect: () => setDeleteTarget({ event: context.event, scope: 'occurrence' }),
        },
        {
          id: 'delete-series',
          label: 'Delete entire series',
          icon: Trash2,
          danger: true,
          onSelect: () => setDeleteTarget({ event: context.event, scope: 'series' }),
        },
      ] satisfies ContextMenuItem[] : !invitation && canEdit ? [{
        id: 'delete-event',
        label: context.event.recurrence ? 'Delete entire series' : 'Delete event',
        icon: Trash2,
        danger: true,
        separatorBefore: true,
        onSelect: () => setDeleteTarget({
          event: context.event,
          scope: context.event.recurrence ? 'series' : 'event',
        }),
      }] satisfies ContextMenuItem[] : []),
    ];
  }

  return (
    <>
      {context && (
        <ContextMenu
          label={label}
          point={context.point}
          items={items}
          onClose={cal.closeCalendarContextMenu}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleteTarget)} busy={deleting}
        title={deleteTarget?.scope === 'occurrence'
          ? 'Delete this occurrence?'
          : deleteTarget?.scope === 'series' ? 'Delete entire series?' : 'Delete event?'}
        message={deleteTarget?.scope === 'occurrence'
          ? `Only this occurrence of “${deleteTarget.event.title || 'Untitled event'}” will be removed. The rest of the series stays on your calendar.`
          : deleteTarget?.scope === 'series'
            ? `Every occurrence in the “${deleteTarget.event.title || 'Untitled event'}” series will be permanently removed.`
            : `This permanently removes “${deleteTarget?.event.title || 'Untitled event'}”.`}
        confirmLabel={deleteTarget?.scope === 'occurrence' ? 'Delete occurrence' : deleteTarget?.scope === 'series' ? 'Delete series' : 'Delete event'}
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget;
          if (!target || deleteLock.current) return;
          deleteLock.current = true; setDeleting(true);
          const exclusion = target.scope === 'occurrence' ? target.event.occurrenceId : undefined;
          void cal.deleteEvent(target.event.id, target.event.calendarId, exclusion).then(deleted => {
            if (!deleted) throw new Error('The event could not be deleted.');
            setDeleteTarget(null);
            showToast({ type: 'success', message: target.scope === 'occurrence' ? 'Occurrence deleted' : target.scope === 'series' ? 'Series deleted' : 'Event deleted' });
          }).catch(error => showToast({ type: 'error', message: error.message })).finally(() => { deleteLock.current = false; setDeleting(false); });
        }}
      />
      <ConfirmDialog
        open={Boolean(responseTarget)} busy={Boolean(cal.invitationActionPending)}
        title={`${MEETING_RESPONSES.find(option => option.response === responseTarget?.response)?.label || 'Respond to'} entire series?`}
        message={`Your response will apply to every occurrence of “${responseTarget?.event.title || 'Untitled meeting'}”, and a reply will be sent to the organizer.`}
        confirmLabel={`${MEETING_RESPONSES.find(option => option.response === responseTarget?.response)?.label || 'Respond to'} series`}
        danger={responseTarget?.response === 'declined'}
        onCancel={() => setResponseTarget(null)}
        onConfirm={() => {
          const target = responseTarget;
          setResponseTarget(null);
          if (target) queueResponse(target.event, target.response);
        }}
      />
      <ConfirmDialog
        open={Boolean(cancellationTarget)} busy={Boolean(cal.invitationActionPending)}
        title={cancellationTarget?.scope === 'occurrence' ? 'Cancel this occurrence?' : 'Cancel meeting?'}
        message={cancellationTarget?.scope === 'occurrence'
          ? `This occurrence of “${cancellationTarget.event.title || 'Untitled meeting'}” will be removed and a cancellation will be sent to attendees.`
          : `“${cancellationTarget?.event.title || 'Untitled meeting'}” will be canceled and attendees will be notified. This cannot be undone.`}
        confirmLabel={cancellationTarget?.scope === 'occurrence' ? 'Cancel occurrence' : 'Cancel meeting'}
        danger
        onCancel={() => setCancellationTarget(null)}
        onConfirm={() => {
          const target = cancellationTarget;
          setCancellationTarget(null);
          if (target) queueCancellation(target.event, target.scope);
        }}
      />
      {proposalEvent && (
        <CalendarNewTimeProposalDialog
          event={proposalEvent}
          displayTimeZone={cal.displayTimeZone}
          pending={Boolean(cal.invitationActionPending?.endsWith(':propose'))}
          onClose={() => setProposalEvent(null)}
          onSubmit={async proposal => {
            const timeKind = proposalEvent.isAllDay ? 'all-day' : 'zoned';
            const start = wallDateToInstant(proposal.start, timeKind, proposalEvent.isAllDay ? null : cal.displayTimeZone);
            const end = wallDateToInstant(proposal.end, timeKind, proposalEvent.isAllDay ? null : cal.displayTimeZone);
            await cal.proposeInvitationTime(proposalEvent, { ...proposal, start, end });
            setProposalEvent(null);
            showToast({ type: 'success', message: 'New-time proposal sent' });
          }}
        />
      )}
    </>
  );
}
