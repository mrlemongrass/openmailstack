"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectStoredCalendarPimCommand = projectStoredCalendarPimCommand;
const eas_calendar_1 = require("./eas-calendar");
const eas_pim_sync_1 = require("./eas-pim-sync");
function projectStoredCalendarPimCommand(command, knownItems, storageUid, ical) {
    try {
        const applicationData = (0, eas_calendar_1.storedIcalEventToActiveSyncApplicationData)(storageUid, ical);
        return {
            node: { tag: command.type, page: 0, children: [
                    { tag: 'ServerId', page: 0, content: command.serverId },
                    { tag: 'ApplicationData', page: 0, children: applicationData },
                ] },
            wireCommand: command,
            stateFingerprint: command.fingerprint,
            quarantined: false,
        };
    }
    catch (error) {
        if (!(error instanceof eas_calendar_1.ActiveSyncCalendarFieldError))
            throw error;
        const quarantine = (0, eas_pim_sync_1.pimQuarantineCommand)(command, knownItems);
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
//# sourceMappingURL=eas-calendar-sync-projection.js.map