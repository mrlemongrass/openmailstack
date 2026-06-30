import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { useMediaQuery } from '../shared/hooks/useMediaQuery';
import { useCalendar } from './hooks/useCalendar';
import { CalendarSidebar } from './CalendarSidebar';
import { MonthView } from './views/MonthView';
import { CalendarToolbar } from './CalendarToolbar';
import { Skeleton } from '../shared/components/Skeleton';

export function CalendarLayout() {
  const cal = useCalendar();
  const isMobile = useMediaQuery('(max-width: 767px)');

  if (isMobile) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <CalendarToolbar cal={cal} />
        {cal.isLoading ? <Skeleton count={12} height={60} /> : <MonthView cal={cal} />}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <PanelGroup id="oms-cal-v9" orientation="horizontal" style={{ flex: 1 }}>
        <Panel defaultSize={20} minSize={15} maxSize={30}>
          <CalendarSidebar cal={cal} />
        </Panel>
        <PanelResizeHandle style={{ width: 4, background: 'transparent' }} />
        <Panel defaultSize={80} minSize={40}>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <CalendarToolbar cal={cal} />
            {cal.isLoading ? <Skeleton count={12} height={60} /> : <MonthView cal={cal} />}
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}
