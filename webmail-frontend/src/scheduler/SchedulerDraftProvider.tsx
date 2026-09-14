import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { UnsavedChangesGuard } from '../shared/components/UnsavedChangesGuard';
import { SchedulerDraftContext, type SchedulerDraftState } from './draft-context';

export function SchedulerDraftProvider({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState<Record<string, SchedulerDraftState>>({});
  const [routeBlocked, setRouteBlocked] = useState(false);
  const register = useCallback((id: string, state: SchedulerDraftState | null) => {
    setDrafts(previous => {
      if (!state) { const next = { ...previous }; delete next[id]; return next; }
      if (previous[id]?.dirty === state.dirty && previous[id]?.locked === state.locked) return previous;
      return { ...previous, [id]: state };
    });
  }, []);
  const context = useMemo(() => ({ register, routeBlocked }), [register, routeBlocked]);
  const states = Object.values(drafts);
  return <SchedulerDraftContext.Provider value={context}>
    <UnsavedChangesGuard dirty={states.some(state => state.dirty || state.locked)} locked={states.some(state => state.locked)} onBlockedChange={setRouteBlocked} />
    {children}
  </SchedulerDraftContext.Provider>;
}
