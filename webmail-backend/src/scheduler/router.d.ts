export declare const schedulerRouter: import("express-serve-static-core").Router;
type SchedulerSlotFailureContext = {
    host: string;
    handle: string;
    slug: string;
    start: Date;
    end: Date;
    includeFull: boolean;
    privateAccess: boolean;
    durationMs: number;
};
export declare const schedulerSlotFailureRecord: (error: unknown, context: SchedulerSlotFailureContext) => {
    timestamp: string;
    level: string;
    event: string;
    host: string;
    handle: string;
    slug: string;
    start: string;
    end: string;
    includeFull: boolean;
    privateAccess: boolean;
    durationMs: number;
    errorName: string;
    errorCode: string;
    sqlState: string;
    message: string;
};
export declare const schedulerHostAllowed: (host: string, allowedHosts?: string[]) => boolean;
export {};
//# sourceMappingURL=router.d.ts.map