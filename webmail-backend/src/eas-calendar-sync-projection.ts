import {
    ActiveSyncCalendarFieldError,
    storedIcalEventToActiveSyncApplicationData,
} from './eas-calendar';
import {
    pimQuarantineCommand,
    type PimKnownItems,
    type PimSyncCommand,
} from './eas-pim-sync';

export interface CalendarPimProjection {
    node: any | null;
    wireCommand: PimSyncCommand | null;
    stateFingerprint: string;
    quarantined: boolean;
}

export function projectStoredCalendarPimCommand(
    command: PimSyncCommand,
    knownItems: PimKnownItems,
    storageUid: string,
    ical: string,
): CalendarPimProjection {
    try {
        const applicationData = storedIcalEventToActiveSyncApplicationData(storageUid, ical);
        return {
            node: { tag: command.type, page: 0, children: [
                { tag: 'ServerId', page: 0, content: command.serverId },
                { tag: 'ApplicationData', page: 0, children: applicationData },
            ] },
            wireCommand: command,
            stateFingerprint: command.fingerprint,
            quarantined: false,
        };
    } catch (error) {
        if (!(error instanceof ActiveSyncCalendarFieldError)) throw error;
        const quarantine = pimQuarantineCommand(command, knownItems);
        return {
            node: quarantine.wireCommand
                ? { tag: 'Delete', page: 0, children: [
                    { tag: 'ServerId', page: 0, content: command.serverId },
                ] }
                : null,
            wireCommand: quarantine.wireCommand,
            stateFingerprint: quarantine.fingerprint,
            quarantined: true,
        };
    }
}
