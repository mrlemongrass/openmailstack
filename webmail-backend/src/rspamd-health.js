"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseRspamdHealthStatus = void 0;
const unavailableHealth = (nowMs) => ({
    ok: false,
    status: null,
    latencyMs: null,
    lastError: 'Rspamd functional health result is unavailable',
    checkedAt: new Date(nowMs).toISOString(),
    endpoint: 'unknown',
});
const parseRspamdHealthStatus = (raw, nowMs = Date.now(), maxAgeMs = 120_000) => {
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
    }
    catch {
        return unavailableHealth(nowMs);
    }
};
exports.parseRspamdHealthStatus = parseRspamdHealthStatus;
//# sourceMappingURL=rspamd-health.js.map