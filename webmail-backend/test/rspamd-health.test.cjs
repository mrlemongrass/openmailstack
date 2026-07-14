const test = require('node:test');
const assert = require('node:assert/strict');

const { parseRspamdHealthStatus } = require('../src/rspamd-health.js');

test('fresh functional Rspamd status is reported healthy', () => {
  const health = parseRspamdHealthStatus(
    JSON.stringify({
      ok: true,
      latencyMs: 42,
      lastError: null,
      checkedAt: '2026-07-14T12:00:00.000Z',
      endpoint: '127.0.0.1:11333 scan; 127.0.0.1:11332 milter',
    }),
    Date.parse('2026-07-14T12:01:00.000Z'),
  );

  assert.equal(health.ok, true);
  assert.equal(health.latencyMs, 42);
  assert.equal(health.lastError, null);
  assert.equal(health.endpoint, '127.0.0.1:11333 scan; 127.0.0.1:11332 milter');
});

test('stale functional Rspamd status is degraded even when the last scan passed', () => {
  const health = parseRspamdHealthStatus(
    JSON.stringify({
      ok: true,
      latencyMs: 42,
      lastError: null,
      checkedAt: '2026-07-14T12:00:00.000Z',
    }),
    Date.parse('2026-07-14T12:03:01.000Z'),
  );

  assert.equal(health.ok, false);
  assert.equal(health.lastError, 'Rspamd functional health result is stale');
});

test('invalid functional Rspamd status is degraded without exposing its contents', () => {
  const health = parseRspamdHealthStatus('not-json', Date.parse('2026-07-14T12:01:00.000Z'));

  assert.equal(health.ok, false);
  assert.equal(health.lastError, 'Rspamd functional health result is unavailable');
});
