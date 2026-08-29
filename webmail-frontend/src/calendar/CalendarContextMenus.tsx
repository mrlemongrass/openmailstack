import { useState } from 'react';
import {
  CalendarPlus,
  Copy,
  CopyPlus,
  Download,
  ExternalLink,
  Pencil,
  Printer,
  Trash2,
} from 'lucide-react';
import { format } from 'date-fns';
import type { CalendarEvent } from '../shared/types';
import { ContextMenu, type ContextMenuItem } from '../shared/components/ContextMenu';
import { ConfirmDialog } from '../shared/components/ConfirmDialog';
import { useToast } from '../shared/components/Toast';
import type { useCalendar } from './hooks/useCalendar';
import { buildCalendarEventIcal, formatWallTime } from './calendarTime';
import { canEditCalendarEvents, eventIcsFilename, meetingUrlForEvent } from './calendarContextActions';

interface EventDeleteTarget {
  event: CalendarEvent;
  scope: 'event' | 'occurrence' | 'series';
}

function downloadEvent(event: CalendarEvent, displayTimeZone: string) {
  const ical = buildCalendarEventIcal(event, displayTimeZone, event.id);
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
  const [deleteTarget, setDeleteTarget] = useState<EventDeleteTarget | null>(null);
  const context = cal.calendarContextMenu;

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
    const canDuplicate = cal.writableCalendars.length > 0;
    items = [
      {
        id: 'open-event',
        label: canEdit ? 'Edit event' : 'View event',
        icon: Pencil,
        onSelect: () => cal.editExistingEvent(context.event),
      },
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
      ...(canEdit && context.event.recurrence && context.event.occurrenceId ? [
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
      ] satisfies ContextMenuItem[] : canEdit ? [{
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
        open={Boolean(deleteTarget)}
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
          setDeleteTarget(null);
          if (!target) return;
          const exclusion = target.scope === 'occurrence' ? target.event.occurrenceId : undefined;
          void cal.deleteEvent(target.event.id, target.event.calendarId, exclusion).then((deleted) => {
            showToast(deleted
              ? { type: 'success', message: target.scope === 'occurrence' ? 'Occurrence deleted' : target.scope === 'series' ? 'Series deleted' : 'Event deleted' }
              : { type: 'error', message: 'The event could not be deleted.' });
          });
        }}
      />
    </>
  );
}
