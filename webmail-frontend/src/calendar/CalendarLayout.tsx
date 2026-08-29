import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, useDefaultLayout } from 'react-resizable-panels';
import { AlertTriangle, CalendarRange, RefreshCw, RotateCcw, X } from 'lucide-react';
import { useMediaQuery } from '../shared/hooks/useMediaQuery';
import { useModalFocus } from '../shared/hooks/useModalFocus';
import { useCalendar } from './hooks/useCalendar';
import { CalendarSidebar } from './CalendarSidebar';
import { MonthView } from './views/MonthView';
import { WeekView } from './views/WeekView';
import { DayView } from './views/DayView';
import { CalendarToolbar } from './CalendarToolbar';
import { EventModal } from './EventModal';
import { CalendarContextMenus } from './CalendarContextMenus';
import { Skeleton } from '../shared/components/Skeleton';
import { ErrorBanner } from '../shared/components/ErrorBanner';

function ResizeHandle() {
  return (
    <PanelResizeHandle style={{ width: 16, cursor: 'col-resize', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 6, right: 6,
        background: 'rgba(255,255,255,0.08)', borderRadius: 4 }} />
    </PanelResizeHandle>
  );
}

export function CalendarInvitationRecoveryBanner({ cal }: { cal: ReturnType<typeof useCalendar> }) {
  if (cal.invitationRecoveryNotices.length === 0) return null;
  return (
    <div className="calendar-invitation-recovery" role="status" aria-live="polite">
      {cal.invitationRecoveryNotices.map(notice => {
        const recovery = notice.attempt.recovery || {};
        const rejectedCount = notice.result?.rejectedRecipients?.length || 0;
        const message = notice.error || (notice.state === 'partial'
          ? `${rejectedCount || 'Some'} attendee${rejectedCount === 1 ? '' : 's'} still need the notification.`
          : notice.state === 'failed'
            ? 'The calendar change was saved, but its notification was not delivered.'
            : notice.state === 'uncertain'
              ? 'Delivery is uncertain. Check before sending anything again.'
              : notice.state === 'terminal'
                ? 'This protected notification can no longer be retried.'
              : notice.state === 'prepared'
                ? 'Submitting this calendar action. Its delivery key is protected.'
              : notice.state === 'pending'
                ? 'The calendar change was saved and its notification is still being delivered.'
                : 'Delivery status could not be checked. The original attempt is still protected.');
        const canRetry = notice.state === 'failed' || notice.state === 'partial'
          || notice.state === 'uncertain'
          || (notice.state === 'unavailable' && typeof recovery.retryOf === 'string');
        const canCheck = notice.state !== 'terminal';
        const canDismiss = notice.state === 'failed' || notice.state === 'partial'
          || notice.state === 'terminal';
        const isBusy = Boolean(cal.invitationActionPending);
        return (
          <div className="calendar-invitation-recovery-item" key={`${notice.attempt.recordId}:${notice.attempt.key}`}>
            <AlertTriangle size={18} aria-hidden="true" />
            <div className="calendar-invitation-recovery-copy">
              <strong>Calendar notification</strong>
              <span>{message}</span>
            </div>
            <div className="calendar-invitation-recovery-actions">
              {canRetry ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={isBusy}
                  onClick={() => { void cal.retryInvitationDelivery(notice); }}
                >
                  <RotateCcw size={15} aria-hidden="true" />
                  {notice.state === 'uncertain'
                    ? "I verified it wasn't delivered — retry"
                    : notice.state === 'unavailable' ? 'Resume retry' : 'Retry notification'}
                </button>
              ) : canCheck ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={isBusy}
                  onClick={() => { void cal.checkInvitationDelivery(notice); }}
                >
                  <RefreshCw size={15} aria-hidden="true" /> Check delivery
                </button>
              ) : null}
              {canDismiss && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-label="Dismiss calendar delivery notice"
                  onClick={() => { void cal.dismissInvitationRecovery(notice); }}
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function renderCalendarContent(cal: ReturnType<typeof useCalendar>) {
  if (cal.isLoading) return <Skeleton count={12} height={60} />;

  if (cal.calendarError) {
    return (
      <ErrorBanner
        error={cal.calendarError}
        onRetry={() => { void cal.retryCalendar(); }}
      />
    );
  }

  switch (cal.calendarView) {
    case 'month':
      return <MonthView cal={cal} />;
    case 'week':
      return <WeekView cal={cal} />;
    case 'day':
      return <DayView cal={cal} />;
    default:
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)', fontSize: '1.1rem' }}>
          {cal.calendarView.charAt(0).toUpperCase() + cal.calendarView.slice(1)} view coming soon
        </div>
      );
  }
}

function MobileCalendarDrawer({
  cal,
  open,
  onClose,
}: {
  cal: ReturnType<typeof useCalendar>;
  open: boolean;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const [nestedDialogOpen, setNestedDialogOpen] = useState(false);
  const closeDrawer = useCallback(() => {
    setNestedDialogOpen(false);
    onClose();
  }, [onClose]);
  useModalFocus({
    dialogRef,
    open,
    active: open && !nestedDialogOpen,
    onClose: closeDrawer,
  });
  if (!open) return null;

  return createPortal(
    <div
      className="mobile-calendar-overlay"
      hidden={nestedDialogOpen}
      onMouseDown={event => {
        if (event.target === event.currentTarget) closeDrawer();
      }}
    >
      <aside
        ref={dialogRef}
        className="mobile-calendar-drawer glass-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Calendars"
        tabIndex={-1}
      >
        <header className="mobile-calendar-heading">
          <span><CalendarRange size={18} aria-hidden="true" /> Calendars</span>
          <button type="button" className="btn btn-ghost" aria-label="Close calendars" onClick={closeDrawer}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="mobile-calendar-content">
          <CalendarSidebar
            cal={cal}
            onNestedDialogChange={setNestedDialogOpen}
            onRequestClose={closeDrawer}
          />
        </div>
      </aside>
    </div>,
    document.body,
  );
}

export function CalendarLayout() {
  const cal = useCalendar();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const [mobileCalendarsOpen, setMobileCalendarsOpen] = useState(false);
  const closeMobileCalendars = useCallback(() => setMobileCalendarsOpen(false), []);

  const calendarPanelLayout = useDefaultLayout({
    id: 'oms-cal-v11',
    panelIds: ['calendar-sidebar', 'calendar-view'],
  });

  if (isMobile) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <CalendarToolbar cal={cal} onOpenCalendars={() => setMobileCalendarsOpen(true)} />
        <CalendarInvitationRecoveryBanner cal={cal} />
        {renderCalendarContent(cal)}
        <MobileCalendarDrawer cal={cal} open={mobileCalendarsOpen} onClose={closeMobileCalendars} />
        <CalendarContextMenus cal={cal} />
        <EventModal cal={cal} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <PanelGroup
        id="oms-cal-v11"
        orientation="horizontal"
        defaultLayout={calendarPanelLayout.defaultLayout}
        onLayoutChange={calendarPanelLayout.onLayoutChange}
        style={{ width: '100%', height: '100%', minHeight: 0, minWidth: 0 }}
      >
        <Panel id="calendar-sidebar" defaultSize="20%" minSize="8%" maxSize="35%">
          <CalendarSidebar cal={cal} />
        </Panel>
        <ResizeHandle />
        <Panel id="calendar-view" defaultSize="80%" minSize="25%">
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <CalendarToolbar cal={cal} />
            <CalendarInvitationRecoveryBanner cal={cal} />
            {renderCalendarContent(cal)}
          </div>
        </Panel>
      </PanelGroup>
      <CalendarContextMenus cal={cal} />
      <EventModal cal={cal} />
    </div>
  );
}
