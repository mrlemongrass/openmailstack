import type { PoolConnection } from 'mysql2/promise';
export type ActiveSyncCalendarSaveResult = 'changed' | 'unchanged' | 'conflict' | 'invalid';
export interface ActiveSyncCalendarLockLease {
    name: string;
}
export declare function acquireActiveSyncCalendarLock(connection: PoolConnection, calendarId: number): Promise<ActiveSyncCalendarLockLease>;
export declare function releaseActiveSyncCalendarLock(connection: PoolConnection, lease: ActiveSyncCalendarLockLease): Promise<void>;
export declare function saveActiveSyncCalendarEventInTransaction(connection: PoolConnection, calendarId: number, resourceName: string, ical: string, expectedIcal?: string | null): Promise<ActiveSyncCalendarSaveResult>;
export declare function saveActiveSyncCalendarEvent(calendarId: number, resourceName: string, ical: string, expectedIcal?: string | null): Promise<ActiveSyncCalendarSaveResult>;
export declare function deleteActiveSyncCalendarEventInTransaction(connection: PoolConnection, calendarId: number, resourceName: string, expectedIcal: string): Promise<'changed' | 'conflict'>;
export declare function deleteActiveSyncCalendarEvent(calendarId: number, resourceName: string, expectedIcal: string): Promise<'changed' | 'conflict'>;
//# sourceMappingURL=eas-calendar-persistence.d.ts.map