import { useCallback, useEffect, useState } from 'react';
import { SCHEDULER_ENTITLEMENT_CHANGED } from '../../scheduler/entitlement';

export interface SchedulerStatus {
  enabled?: boolean;
  published?: boolean;
  publicBaseUrl?: string;
  entitlement?: { handle?: string } | null;
}

export function useSchedulerStatus(refreshKey?: string): SchedulerStatus | null {
  const [status, setStatus] = useState<SchedulerStatus | null>(null);
  const refresh = useCallback(() => {
    void refreshKey;
    let active = true;
    fetch('/api/scheduler/v1/status', { credentials: 'include' })
      .then(async response => response.ok ? response.json() as Promise<SchedulerStatus> : null)
      .then(result => { if (active) setStatus(result); })
      .catch(() => { if (active) setStatus(null); });
    return () => { active = false; };
  }, [refreshKey]);

  useEffect(() => {
    let cancelRequest = refresh();
    const refreshStatus = () => {
      cancelRequest();
      cancelRequest = refresh();
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshStatus();
    };
    window.addEventListener(SCHEDULER_ENTITLEMENT_CHANGED, refreshStatus);
    window.addEventListener('focus', refreshStatus);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      cancelRequest();
      window.removeEventListener(SCHEDULER_ENTITLEMENT_CHANGED, refreshStatus);
      window.removeEventListener('focus', refreshStatus);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refresh]);

  return status;
}
