export const SCHEDULER_ENTITLEMENT_CHANGED = 'oms:scheduler-entitlement-changed';

export function notifySchedulerEntitlementChanged(username: string): void {
  window.dispatchEvent(new CustomEvent(SCHEDULER_ENTITLEMENT_CHANGED, {
    detail: { username },
  }));
}
