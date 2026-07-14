export type RspamdFunctionalHealth = {
    ok: boolean;
    status: null;
    latencyMs: number | null;
    lastError: string | null;
    checkedAt: string;
    endpoint: string;
};

const unavailableHealth = (nowMs: number): RspamdFunctionalHealth => ({
    ok: false,
    status: null,
    latencyMs: null,
    lastError: 'Rspamd functional health result is unavailable',
    checkedAt: new Date(nowMs).toISOString(),
    endpoint: 'unknown',
});

export const parseRspamdHealthStatus = (
    raw: string,
    nowMs = Date.now(),
    maxAgeMs = 120_000,
): RspamdFunctionalHealth => {
    try {
        const parsed = JSON.parse(raw);
        const checkedAtMs = Date.parse(parsed?.checkedAt);
        if (typeof parsed?.ok !== 'boolean' || !Number.isFinite(checkedAtMs)) {
            return unavailableHealth(nowMs);
        }

        const checkedAt = new Date(checkedAtMs).toISOString();
        const endpoint = typeof parsed.endpoint === 'string' && parsed.endpoint.length > 0
            ? parsed.endpoint.slice(0, 200)
            : 'unknown';
        const latencyMs = Number.isFinite(parsed.latencyMs) && parsed.latencyMs >= 0
            ? Math.round(parsed.latencyMs)
            : null;

        if (checkedAtMs > nowMs + 30_000 || nowMs - checkedAtMs > maxAgeMs) {
            return {
                ok: false,
                status: null,
                latencyMs,
                lastError: 'Rspamd functional health result is stale',
                checkedAt,
                endpoint,
            };
        }

        return {
            ok: parsed.ok,
            status: null,
            latencyMs,
            lastError: parsed.ok
                ? null
                : typeof parsed.lastError === 'string' && parsed.lastError.length > 0
                    ? parsed.lastError.slice(0, 200)
                    : 'Rspamd functional scan failed',
            checkedAt,
            endpoint,
        };
    } catch {
        return unavailableHealth(nowMs);
    }
};
