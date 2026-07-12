import type { Pool } from 'mysql2/promise';
import { SchedulerStore } from './store';
export declare class SchedulerPhase2Store {
    private readonly pool;
    private readonly scheduler;
    constructor(pool: Pool, scheduler: SchedulerStore);
    createPoll(username: string, input: any): Promise<any>;
    listPolls(username: string): Promise<any[]>;
    getPublicPoll(token: string): Promise<any | null>;
    votePoll(token: string, input: any): Promise<void>;
    requestPollVerification(token: string, email: unknown): Promise<any>;
    finalizePoll(username: string, pollId: string, optionId: string): Promise<any>;
    exportOwnerData(username: string): Promise<any>;
    exportBookingsCsv(username: string): Promise<string>;
    importOwnerData(username: string, sourceValue: unknown, payload: any): Promise<any>;
}
//# sourceMappingURL=phase2-store.d.ts.map