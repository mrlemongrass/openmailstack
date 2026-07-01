import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, useDefaultLayout } from 'react-resizable-panels';
import { useMediaQuery } from '../shared/hooks/useMediaQuery';
import { useCalendar } from './hooks/useCalendar';
import { CalendarSidebar } from './CalendarSidebar';
import { MonthView } from './views/MonthView';
import { CalendarToolbar } from './CalendarToolbar';
import { EventModal } from './EventModal';
import { Skeleton } from '../shared/components/Skeleton';

function ResizeHandle() {
  return (
    <PanelResizeHandle style={{ width: 16, cursor: 'col-resize', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 6, right: 6,
        background: 'rgba(255,255,255,0.08)', borderRadius: 4 }} />
    </PanelResizeHandle>
  );
}

function renderCalendarView(cal: ReturnType<typeof useCalendar>) {
  switch (cal.calendarView) {
    case 'month':
      return <MonthView cal={cal} />;
    default:
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)', fontSize: '1.1rem' }}>
          {cal.calendarView.charAt(0).toUpperCase() + cal.calendarView.slice(1)} view coming soon
        </div>
      );
  }
}

export function CalendarLayout() {
  const cal = useCalendar();
  const isMobile = useMediaQuery('(max-width: 767px)');

  const calendarPanelLayout = useDefaultLayout({
    id: 'oms-cal-v11',
    panelIds: ['calendar-sidebar', 'calendar-view'],
  });

  if (isMobile) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <CalendarToolbar cal={cal} />
        {cal.isLoading ? <Skeleton count={12} height={60} /> : renderCalendarView(cal)}
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
            {cal.isLoading ? <Skeleton count={12} height={60} /> : renderCalendarView(cal)}
          </div>
        </Panel>
      </PanelGroup>
      <EventModal cal={cal} />
    </div>
  );
}
