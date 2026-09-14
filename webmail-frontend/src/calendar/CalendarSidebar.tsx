import { useCallback, useEffect, useState, useRef } from 'react';
import {
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, isSameMonth, isSameDay } from 'date-fns';
import type { Calendar } from '../shared/types';
import type { ContextMenuPoint } from '../shared/context-menu-navigation';
import { ContextMenu, type ContextMenuItem } from '../shared/components/ContextMenu';
import { ConfirmDialog } from '../shared/components/ConfirmDialog';
import { useToast } from '../shared/components/Toast';
import { useSchedulerStatus } from '../shared/hooks/useSchedulerStatus';
import type { useCalendar } from './hooks/useCalendar';
import { CalendarEditorDialog, CalendarSharingDialog } from './CalendarManagementDialogs';
import { calendarRemovalKind, canManageCalendar, canShareCalendar, isManagedCalendar } from './calendarContextActions';

type SidebarMenuState =
  | { kind: 'group'; point: ContextMenuPoint }
  | { kind: 'calendar'; point: ContextMenuPoint; calendar: Calendar };

interface CalendarSidebarProps {
  cal: ReturnType<typeof useCalendar>;
  onNestedDialogChange?: (open: boolean) => void;
  onRequestClose?: () => void;
}

function pointForButton(button: HTMLElement): ContextMenuPoint {
  const bounds = button.getBoundingClientRect();
  return { x: Math.min(bounds.right, window.innerWidth - 8), y: bounds.bottom + 4 };
}

function exportCalendar(calendar: Calendar) {
  const link = document.createElement('a');
  link.href = `/api/apps/calendars/${calendar.id}/export`;
  link.download = `${calendar.name || 'calendar'}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function subscriptionStatusLabel(calendar: Calendar, syncing: boolean): string | null {
  if (!calendar.subscribed_url) return null;
  if (syncing) return 'Syncing…';
  if (calendar.last_fetch_error) return `Sync failed: ${calendar.last_fetch_error}`;
  if (!calendar.last_fetched_at) return 'Waiting for first sync';
  const fetchedAt = new Date(calendar.last_fetched_at);
  return Number.isNaN(fetchedAt.getTime()) ? 'Updated' : `Updated ${format(fetchedAt, 'MMM d, h:mm a')}`;
}

export function CalendarSidebar({ cal, onNestedDialogChange, onRequestClose }: CalendarSidebarProps) {
  const { showToast } = useToast();
  const [menu, setMenu] = useState<SidebarMenuState | null>(null);
  const [editorCalendar, setEditorCalendar] = useState<Calendar | null | undefined>(undefined);
  const [sharingCalendar, setSharingCalendar] = useState<Calendar | null>(null);
  const deleteLock = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteCalendar, setDeleteCalendar] = useState<Calendar | null>(null);
  const [refreshingSubscriptionId, setRefreshingSubscriptionId] = useState<number | null>(null);
  const [calendarsExpanded, setCalendarsExpanded] = useState(true);
  const schedulerStatus = useSchedulerStatus();

  const nestedDialogOpen = editorCalendar !== undefined || Boolean(sharingCalendar) || Boolean(deleteCalendar);
  useEffect(() => {
    onNestedDialogChange?.(nestedDialogOpen);
  }, [nestedDialogOpen, onNestedDialogChange]);

  const bookingPageUrl = schedulerStatus?.enabled && schedulerStatus.published
    && schedulerStatus.entitlement?.handle && schedulerStatus.publicBaseUrl
    ? `${schedulerStatus.publicBaseUrl.replace(/\/$/, '')}/scheduler/${encodeURIComponent(schedulerStatus.entitlement.handle)}`
    : schedulerStatus?.enabled ? '/scheduler-app?section=profile' : null;

  const today = cal.displayNow;
  const miniStart = startOfWeek(startOfMonth(cal.currentDate));
  const miniEnd = endOfWeek(endOfMonth(cal.currentDate));
  const miniDays: Date[] = [];
  let d = miniStart;
  while (d <= miniEnd) { miniDays.push(d); d = addDays(d, 1); }

  const openGroupMenu = useCallback((point: ContextMenuPoint) => {
    setMenu({ kind: 'group', point });
  }, []);
  const openCalendarMenu = useCallback((calendar: Calendar, point: ContextMenuPoint) => {
    setMenu({ kind: 'calendar', calendar, point });
  }, []);

  const handleMenuKeyboard = (
    event: React.KeyboardEvent<HTMLElement>,
    open: (point: ContextMenuPoint) => void,
  ) => {
    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
      event.preventDefault();
      event.stopPropagation();
      open(pointForButton(event.currentTarget));
    }
  };

  const selectedCalendar = menu?.kind === 'calendar' ? menu.calendar : null;
  const selectedManageable = selectedCalendar ? canManageCalendar(selectedCalendar) : false;
  const selectedShareable = selectedCalendar ? canShareCalendar(selectedCalendar) : false;
  const selectedRemovalKind = selectedCalendar ? calendarRemovalKind(selectedCalendar, cal.calendars) : null;

  const refreshSubscription = useCallback(async (calendar: Calendar) => {
    setRefreshingSubscriptionId(calendar.id);
    try {
      const result = await cal.refreshCalendarSubscription(calendar.id);
      if (result.status === 'synced') {
        showToast({ type: 'success', message: `${calendar.name} is up to date` });
      } else if (result.status === 'error') {
        showToast({ type: 'error', message: result.last_fetch_error || `${calendar.name} could not be synced.` });
      } else {
        showToast({ type: 'info', message: `${calendar.name} sync is pending` });
      }
    } catch (error) {
      showToast({ type: 'error', message: error instanceof Error ? error.message : 'The calendar subscription could not be refreshed.' });
    } finally {
      setRefreshingSubscriptionId(null);
    }
  }, [cal, showToast]);

  const groupItems: ContextMenuItem[] = [
    { id: 'add-calendar', label: 'Add calendar', icon: CalendarPlus, onSelect: () => setEditorCalendar(null) },
    {
      id: 'show-all', label: 'Show all', icon: Eye,
      disabled: cal.showAllCalendarsOverride,
      onSelect: cal.showAllCalendars,
    },
    {
      id: 'show-selected', label: 'Show selected', icon: Check,
      disabled: !cal.hasCalendarVisibilityOverride,
      onSelect: cal.showSelectedCalendars,
    },
    {
      id: 'hide-all', label: 'Hide all', icon: EyeOff,
      separatorBefore: true,
      onSelect: cal.hideAllCalendars,
    },
  ];

  const calendarItems: ContextMenuItem[] = selectedCalendar ? [
    {
      id: 'show-only', label: 'Show this only', icon: Eye,
      onSelect: () => cal.showOnlyCalendar(selectedCalendar.id),
    },
    {
      id: 'rename-calendar',
      label: isManagedCalendar(selectedCalendar) ? 'Managed calendar' : 'Rename and color',
      icon: Pencil,
      disabled: !selectedManageable,
      separatorBefore: true,
      onSelect: () => setEditorCalendar(selectedCalendar),
    },
    {
      id: 'share-calendar', label: 'Sharing and permissions', icon: Share2,
      disabled: !selectedShareable,
      onSelect: () => setSharingCalendar(selectedCalendar),
    },
    ...(selectedCalendar.subscribed_url && selectedCalendar.access_role === 'owner' ? [{
      id: 'refresh-subscription',
      label: selectedCalendar.last_fetch_error ? 'Retry subscription sync' : 'Sync subscription now',
      icon: RefreshCw,
      disabled: refreshingSubscriptionId === selectedCalendar.id,
      onSelect: () => { void refreshSubscription(selectedCalendar); },
    }] : []),
    {
      id: 'export-calendar', label: 'Download calendar', icon: Download,
      disabled: selectedCalendar.access_role !== 'owner',
      onSelect: () => exportCalendar(selectedCalendar),
    },
    {
      id: 'delete-calendar',
      label: selectedRemovalKind === 'remove'
        ? 'Remove from my calendars'
        : selectedManageable && !selectedRemovalKind ? 'Delete (primary calendar)' : 'Delete calendar',
      icon: Trash2,
      danger: true,
      disabled: !selectedRemovalKind,
      separatorBefore: true,
      onSelect: () => setDeleteCalendar(selectedCalendar),
    },
  ] : [];

  const closeEditor = () => setEditorCalendar(undefined);

  return (
    <div className="calendar-sidebar">
      <button className="btn btn-primary calendar-new-event" onClick={() => { cal.openNewEvent(); onRequestClose?.(); }}>
        <Plus size={16} aria-hidden="true" /> New event
      </button>

      <section className="calendar-mini" aria-label="Mini calendar">
        <header>
          <strong>{format(cal.currentDate, 'MMMM yyyy')}</strong>
          <button type="button" className="btn btn-ghost" onClick={() => cal.setCurrentDate(cal.displayNow)}>Today</button>
        </header>
        <div className="calendar-mini-weekdays" aria-hidden="true">
          {['S','M','T','W','T','F','S'].map((name, index) => <span key={`${name}-${index}`}>{name}</span>)}
        </div>
        <div className="calendar-mini-days">
          {miniDays.map(day => {
            const hasEvents = cal.events.some(event => isSameDay(event.start, day) && cal.isCalendarVisible(event.calendarId));
            const isCurrent = isSameMonth(day, cal.currentDate);
            const isToday = isSameDay(day, today);
            const selected = isSameDay(day, cal.currentDate);
            return (
              <button
                key={day.toISOString()}
                type="button"
                className={`${isToday ? 'is-today ' : ''}${selected ? 'is-selected ' : ''}${!isCurrent ? 'is-outside' : ''}`.trim()}
                aria-label={format(day, 'EEEE, MMMM d, yyyy')}
                aria-current={isToday ? 'date' : undefined}
                onClick={() => cal.setCurrentDate(day)}
              >
                {format(day, 'd')}
                {hasEvents && <span className="calendar-mini-event-dot" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </section>

      <nav className="calendar-sidebar-actions" aria-label="Calendar actions">
        <button type="button" onClick={() => setEditorCalendar(null)}>
          <CalendarPlus size={18} aria-hidden="true" /> Add calendar
        </button>
        {bookingPageUrl && <div className="calendar-booking-action">
          <a
            href={bookingPageUrl}
            {...(schedulerStatus?.published ? { target: '_blank', rel: 'noreferrer' } : {})}
            title={schedulerStatus?.published ? 'Open your public OpenMailStack Scheduler page' : 'Finish publishing your OpenMailStack Scheduler page'}
          >
            <ExternalLink size={18} aria-hidden="true" />
            {schedulerStatus?.published ? 'Go to my booking page' : 'Set up my booking page'}
          </a>
          {schedulerStatus?.published && (
            <button
              type="button"
              className="btn btn-ghost"
              aria-label="Copy booking page link"
              title="Copy booking page link"
              onClick={() => {
                void navigator.clipboard.writeText(bookingPageUrl).then(
                  () => showToast({ type: 'success', message: 'Booking page link copied' }),
                  () => showToast({ type: 'error', message: 'The booking page link could not be copied.' }),
                );
              }}
            >
              <Copy size={16} aria-hidden="true" />
            </button>
          )}
        </div>}
      </nav>

      <section className="calendar-list-section">
        <div
          className="calendar-group-heading"
          tabIndex={0}
          onContextMenu={event => {
            event.preventDefault();
            event.currentTarget.focus();
            openGroupMenu({ x: event.clientX, y: event.clientY });
          }}
          onKeyDown={event => handleMenuKeyboard(event, openGroupMenu)}
        >
          <button
            type="button"
            className="calendar-group-toggle"
            aria-expanded={calendarsExpanded}
            onClick={() => setCalendarsExpanded(value => !value)}
          >
            {calendarsExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            <span>My calendars</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost calendar-more-button"
            aria-label="My calendars actions"
            aria-haspopup="menu"
            onClick={event => openGroupMenu(pointForButton(event.currentTarget))}
          >
            <MoreHorizontal size={18} aria-hidden="true" />
          </button>
        </div>

        {calendarsExpanded && (
          <div className="calendar-list">
            {cal.calendars.map(calendar => {
              const visible = cal.isCalendarVisible(calendar.id);
              const subscriptionSyncing = refreshingSubscriptionId === calendar.id;
              const subscriptionStatus = subscriptionStatusLabel(calendar, subscriptionSyncing);
              return (
                <div
                  key={calendar.id}
                  className="calendar-list-row"
                  tabIndex={0}
                  onContextMenu={event => {
                    event.preventDefault();
                    event.currentTarget.focus();
                    openCalendarMenu(calendar, { x: event.clientX, y: event.clientY });
                  }}
                  onKeyDown={event => handleMenuKeyboard(event, point => openCalendarMenu(calendar, point))}
                >
                  <button
                    type="button"
                    className="calendar-visibility-toggle"
                    aria-label={`${visible ? 'Hide' : 'Show'} ${calendar.name}`}
                    aria-pressed={visible}
                    style={{ '--calendar-color': calendar.color } as React.CSSProperties}
                    onClick={() => cal.toggleCalendarVisibility(calendar.id)}
                  >
                    {visible && <Check size={13} strokeWidth={3} aria-hidden="true" />}
                  </button>
                  <span className="calendar-list-label">
                    <span className="calendar-list-name" title={calendar.name}>{calendar.name}</span>
                    {subscriptionStatus && (
                      <small
                        className={`calendar-subscription-status${calendar.last_fetch_error && !subscriptionSyncing ? ' is-error' : ''}${subscriptionSyncing ? ' is-syncing' : ''}`}
                        title={subscriptionStatus}
                        aria-live={subscriptionSyncing ? 'polite' : undefined}
                        {...(calendar.last_fetch_error && !subscriptionSyncing ? { role: 'alert' } : {})}
                      >
                        {subscriptionStatus}
                      </small>
                    )}
                  </span>
                  {calendar.access_role && calendar.access_role !== 'owner' && <Share2 className="calendar-shared-icon" size={13} aria-label="Shared calendar" />}
                  {calendar.subscribed_url && calendar.last_fetch_error && calendar.access_role === 'owner' && (
                    <button
                      type="button"
                      className="btn btn-ghost calendar-subscription-retry"
                      disabled={refreshingSubscriptionId === calendar.id}
                      onClick={() => { void refreshSubscription(calendar); }}
                    >
                      <RefreshCw size={13} aria-hidden="true" />
                      {refreshingSubscriptionId === calendar.id ? 'Retrying…' : 'Retry'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost calendar-more-button"
                    aria-label={`${calendar.name} actions`}
                    aria-haspopup="menu"
                    onClick={event => openCalendarMenu(calendar, pointForButton(event.currentTarget))}
                  >
                    <MoreHorizontal size={17} aria-hidden="true" />
                  </button>
                </div>
              );
            })}
            {cal.calendars.length === 0 && <p className="calendar-list-empty">No calendars available.</p>}
          </div>
        )}

        <button
          type="button"
          className="calendar-show-toggle"
          onClick={cal.hasCalendarVisibilityOverride ? cal.showSelectedCalendars : cal.showAllCalendars}
        >
          {cal.hasCalendarVisibilityOverride ? 'Show selected' : 'Show all'}
        </button>
      </section>

      {menu && (
        <ContextMenu
          label={menu.kind === 'group' ? 'My calendars actions' : `${menu.calendar.name} actions`}
          point={menu.point}
          items={menu.kind === 'group' ? groupItems : calendarItems}
          onClose={() => setMenu(null)}
        />
      )}

      {editorCalendar !== undefined && (
        <CalendarEditorDialog
          calendar={editorCalendar || undefined}
          onClose={closeEditor}
          onSave={async draft => {
            if (editorCalendar) {
              await cal.updateCalendar(editorCalendar.id, draft);
              showToast({ type: 'success', message: 'Calendar updated' });
            } else {
              const result = await cal.createCalendar(draft);
              if (draft.subscribed_url && result.subscription?.status === 'error') {
                showToast({
                  type: 'error',
                  message: `Subscription added, but its first sync failed: ${result.subscription.last_fetch_error || 'Unknown sync error'}`,
                });
              } else if (draft.subscribed_url && result.subscription?.status === 'pending') {
                showToast({ type: 'info', message: 'Subscription added; first sync is pending' });
              } else {
                showToast({
                  type: 'success',
                  message: draft.subscribed_url
                    ? 'Calendar subscription added and synced'
                    : draft.ics_data !== undefined ? 'Calendar imported' : 'Calendar created',
                });
              }
            }
          }}
        />
      )}
      {sharingCalendar && <CalendarSharingDialog calendar={sharingCalendar} onClose={() => setSharingCalendar(null)} />}
      <ConfirmDialog
        open={Boolean(deleteCalendar)} busy={deleting}
        title={deleteCalendar && calendarRemovalKind(deleteCalendar, cal.calendars) === 'remove'
          ? 'Remove calendar?' : 'Delete calendar?'}
        message={deleteCalendar && calendarRemovalKind(deleteCalendar, cal.calendars) === 'remove'
          ? deleteCalendar.access_role !== 'owner'
            ? `This removes “${deleteCalendar.name}” from your calendar list. The owner’s calendar and events are unchanged.`
            : `This removes the “${deleteCalendar.name}” subscription and its local cached events. The published source is unchanged.`
          : `This permanently deletes “${deleteCalendar?.name || 'this calendar'}” and its ${deleteCalendar?.event_count ?? deleteCalendar?.events.length ?? 0} events.`}
        confirmLabel={deleteCalendar && calendarRemovalKind(deleteCalendar, cal.calendars) === 'remove'
          ? 'Remove calendar' : 'Delete calendar'}
        danger
        onCancel={() => setDeleteCalendar(null)}
        onConfirm={() => {
          const target = deleteCalendar;
          if (!target || deleteLock.current) return;
          deleteLock.current = true; setDeleting(true);
          void cal.removeCalendar(target.id).then(() => {
            setDeleteCalendar(null);
            showToast({ type: 'success', message: calendarRemovalKind(target, cal.calendars) === 'remove' ? `${target.name} removed` : `${target.name} deleted` });
          }).catch(error => showToast({ type: 'error', message: error instanceof Error ? error.message : 'The calendar could not be removed.' }))
            .finally(() => { deleteLock.current = false; setDeleting(false); });
        }}
      />
    </div>
  );
}
