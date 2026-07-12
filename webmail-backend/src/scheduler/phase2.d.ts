export type SchedulerExclusionKind = 'holiday' | 'out_of_office';
export interface SchedulerAvailabilityExclusion {
    id?: string;
    kind: SchedulerExclusionKind;
    startDate: string;
    endDate: string;
    label: string;
}
export declare function normalizeSchedulerExclusions(value: unknown): SchedulerAvailabilityExclusion[];
export declare function exclusionDateKeys(exclusions: SchedulerAvailabilityExclusion[], rangeStart: Date, rangeEnd: Date): Set<string>;
export declare function normalizeSchedulerPublicSettings(input: Record<string, unknown>): {
    publicAccentColor: string;
    publicIntro: string;
    privacyUrl: string;
    termsUrl: string;
    locale: string;
    lockedTimeZone: string | null;
};
export declare function normalizeSchedulerAttribution(value: unknown): Record<string, string>;
export declare function normalizeRecurrenceCount(value: unknown, maximum: number): number;
export declare function normalizeImportSource(value: unknown): 'openmailstack' | 'calendly' | 'calcom';
//# sourceMappingURL=phase2.d.ts.map