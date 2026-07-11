export interface AvailabilityWindow {
    weekday: number;
    startMinute: number;
    endMinute: number;
}
export interface AvailabilityOverride {
    date: string;
    windows: Array<Pick<AvailabilityWindow, 'startMinute' | 'endMinute'>>;
}
export interface BusyInterval {
    start: Date;
    end: Date;
}
export interface AvailabilityRequest {
    timeZone: string;
    rangeStart: Date;
    rangeEnd: Date;
    durationMinutes: number;
    intervalMinutes: number;
    windows: AvailabilityWindow[];
    overrides?: AvailabilityOverride[];
    busy?: BusyInterval[];
    bufferBeforeMinutes?: number;
    bufferAfterMinutes?: number;
    minimumNoticeMinutes?: number;
    now?: Date;
}
export interface AvailabilitySlot {
    start: Date;
    end: Date;
}
export interface LocalAvailabilitySlot {
    timeZone: string;
    startDate: string;
    startMinute: number;
    endDate: string;
    endMinute: number;
}
export declare function calculateAvailability(request: AvailabilityRequest): AvailabilitySlot[];
export declare function projectAvailabilitySlot(slot: AvailabilitySlot, timeZone: string): LocalAvailabilitySlot;
//# sourceMappingURL=availability.d.ts.map