import { createContext, useContext, useEffect, useId } from 'react';

export interface SchedulerDraftState { dirty: boolean; locked: boolean }
export const SchedulerDraftContext = createContext({
  routeBlocked: false,
  register: (_id: string, _state: SchedulerDraftState | null) => {},
});

export function useSchedulerDraft(dirty: boolean, locked = false) {
  const { register, routeBlocked } = useContext(SchedulerDraftContext);
  const id = useId();
  useEffect(() => { register(id, { dirty, locked }); }, [register, id, dirty, locked]);
  useEffect(() => () => register(id, null), [register, id]);
  return routeBlocked;
}
