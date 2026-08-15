import { type PimKnownItems, type PimSyncCommand } from './eas-pim-sync';
export interface CalendarPimProjection {
    node: any | null;
    wireCommand: PimSyncCommand | null;
    stateFingerprint: string;
    quarantined: boolean;
}
export declare function projectStoredCalendarPimCommand(command: PimSyncCommand, knownItems: PimKnownItems, storageUid: string, ical: string): CalendarPimProjection;
//# sourceMappingURL=eas-calendar-sync-projection.d.ts.map