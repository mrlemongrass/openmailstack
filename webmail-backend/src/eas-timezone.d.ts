interface SystemTimeRule {
    year: number;
    month: number;
    dayOfWeek: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    milliseconds: number;
}
export interface ActiveSyncTimeZone {
    bias: number;
    standardName: string;
    standardDate: SystemTimeRule;
    standardBias: number;
    daylightName: string;
    daylightDate: SystemTimeRule;
    daylightBias: number;
}
export declare function encodeActiveSyncTimeZone(timeZone: string, reference: Date): string | null;
export declare function decodeActiveSyncTimeZone(value: string): ActiveSyncTimeZone | null;
export declare function resolveActiveSyncTimeZone(value: string, reference: Date): string | null;
export declare function formatIcalWallTime(instant: Date, timeZone: string): string;
export {};
//# sourceMappingURL=eas-timezone.d.ts.map