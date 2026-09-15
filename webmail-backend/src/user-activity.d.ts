import { type Request, type Response, type NextFunction } from 'express';
export declare function ensureUserActivitySchema(): Promise<void>;
export declare function activityOutcome(body: any, status: number, action: string, closed?: boolean): "completed" | "uncertain" | "failed" | "accepted";
export declare function activityDescriptor(method: string, path: string): {
    area: string;
    action: string;
    recoveryPath: string;
};
export declare function observeUserActivity(req: Request, res: Response, next: NextFunction): void;
export declare function listUserActivity(owner: string): Promise<any>;
export declare function userSyncObservation(owner: string, area: string): Promise<{
    syncState: string;
    syncDetail: string;
    lastSyncAt: any;
}>;
export declare function getUserHealth(owner: string, password: string): Promise<({
    checkedAt: string;
    latencyMs: number;
    syncState: string;
    syncDetail: string;
    lastSyncAt: any;
    area: string;
    path: string;
    detail: string;
    state: string;
} | {
    area: string;
    path: string;
    detail: string;
    state: string;
    checkedAt: string;
    latencyMs: number;
})[]>;
export declare function createActivityRouter(): import("express-serve-static-core").Router;
export declare function startActivityMaintenance(): void;
//# sourceMappingURL=user-activity.d.ts.map