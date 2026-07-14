export type RspamdFunctionalHealth = {
    ok: boolean;
    status: null;
    latencyMs: number | null;
    lastError: string | null;
    checkedAt: string;
    endpoint: string;
};
export declare const parseRspamdHealthStatus: (raw: string, nowMs?: number, maxAgeMs?: number) => RspamdFunctionalHealth;
//# sourceMappingURL=rspamd-health.d.ts.map