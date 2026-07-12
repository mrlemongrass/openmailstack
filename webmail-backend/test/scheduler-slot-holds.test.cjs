const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OMS_DB_PASSWORD ||= 'unit-test-password';

const { SlotUnavailableError } = require('../src/scheduler/slot-holds.js');

class FakeConnection {
  constructor({ inventory, existingHold } = {}) {
    this.inventory = inventory || { slot_end_matches: 1, capacity: 1, held_seats: 0, confirmed_seats: 0 };
    this.existingHold = existingHold;
    this.calls = [];
    this.committed = false;
    this.rolledBack = false;
    this.released = false;
  }

  async beginTransaction() { this.calls.push('begin'); }
  async commit() { this.committed = true; }
  async rollback() { this.rolledBack = true; }
  release() { this.released = true; }

  async query(sql, params) {
    this.calls.push({ sql, params });
    if (sql.includes('FROM scheduler_slot_holds') && sql.includes('idempotency_key')) {
      return [this.existingHold ? [this.existingHold] : []];
    }
    if (sql.includes('SELECT slot_end = ?')) return [[this.inventory]];
    if (sql.includes('COALESCE(SUM(seats)')) return [[{ expired_seats: 0 }]];
    return [{ affectedRows: 1 }];
  }
}

const input = {
  tenantKey: 'example.test',
  eventTypeKey: 'thirty-minute-call',
  hostUsername: 'host@example.test',
  slotStart: new Date('2030-01-01T17:00:00.000Z'),
  slotEnd: new Date('2030-01-01T17:30:00.000Z'),
  capacity: 1,
  ttlSeconds: 120,
  idempotencyKey: 'request-1',
  now: new Date('2030-01-01T16:00:00.000Z'),
};

test('SlotUnavailableError has a stable public-safe message', () => {
  const error = new SlotUnavailableError();
  assert.equal(error.name, 'SlotUnavailableError');
  assert.equal(error.message, 'The requested slot no longer has enough capacity');
});

test('acquire commits one hold through the inventory lock', async () => {
  const { SchedulerSlotHoldRepository } = require('../src/scheduler/slot-holds.js');
  const connection = new FakeConnection();
  const repository = new SchedulerSlotHoldRepository({ getConnection: async () => connection });
  const hold = await repository.acquire(input);

  assert.equal(hold.status, 'held');
  assert.equal(hold.expiresAt.toISOString(), '2030-01-01T16:02:00.000Z');
  assert.equal(connection.committed, true);
  assert.equal(connection.rolledBack, false);
  assert.equal(connection.released, true);
  assert.ok(connection.calls.some((call) => typeof call === 'object' && call.sql.includes('FOR UPDATE')));
});

test('acquire rolls back when capacity is exhausted', async () => {
  const { SchedulerSlotHoldRepository } = require('../src/scheduler/slot-holds.js');
  const connection = new FakeConnection({
    inventory: { slot_end_matches: 1, capacity: 1, held_seats: 1, confirmed_seats: 0 },
  });
  const repository = new SchedulerSlotHoldRepository({ getConnection: async () => connection });

  await assert.rejects(repository.acquire(input), SlotUnavailableError);
  assert.equal(connection.committed, false);
  assert.equal(connection.rolledBack, true);
  assert.equal(connection.released, true);
});

test('idempotent replay returns the original hold without adding capacity', async () => {
  const { SchedulerSlotHoldRepository } = require('../src/scheduler/slot-holds.js');
  const connection = new FakeConnection({
    existingHold: {
      hold_token: 'existing-token',
      tenant_key: input.tenantKey,
      event_type_key: input.eventTypeKey,
      host_username: input.hostUsername,
      slot_start_utc: '2030-01-01 17:00:00.000',
      slot_end_utc: '2030-01-01 17:30:00.000',
      seats: 1,
      status: 'held',
      expires_at_utc: '2030-01-01 16:02:00.000',
    },
  });
  const repository = new SchedulerSlotHoldRepository({ getConnection: async () => connection });
  const hold = await repository.acquire(input);

  assert.equal(hold.token, 'existing-token');
  assert.equal(connection.committed, true);
  assert.equal(connection.calls.filter((call) => typeof call === 'object').length, 1);
});

test('released idempotency records can reacquire capacity after a failed workflow', async () => {
  const { SchedulerSlotHoldRepository } = require('../src/scheduler/slot-holds.js');
  const connection = new FakeConnection({
    existingHold: {
      hold_token: 'released-token', tenant_key: input.tenantKey, event_type_key: input.eventTypeKey,
      host_username: input.hostUsername, slot_start_utc: '2030-01-01 17:00:00.000',
      slot_end_utc: '2030-01-01 17:30:00.000', seats: 1, status: 'released',
      expires_at_utc: '2030-01-01 16:02:00.000',
    },
  });
  const repository = new SchedulerSlotHoldRepository({ getConnection: async () => connection });
  const hold = await repository.acquire(input);

  assert.equal(hold.status, 'held');
  assert.notEqual(hold.token, 'released-token');
  assert.ok(connection.calls.some(call => typeof call === 'object' && call.sql.includes('DELETE FROM scheduler_slot_holds')));
});

test('acquire retries a deadlocked transaction from a fresh connection', async () => {
  const { SchedulerSlotHoldRepository } = require('../src/scheduler/slot-holds.js');
  const deadlocked = new FakeConnection();
  deadlocked.query = async () => {
    const error = new Error('deadlock');
    error.code = 'ER_LOCK_DEADLOCK';
    error.errno = 1213;
    throw error;
  };
  const retry = new FakeConnection();
  const connections = [deadlocked, retry];
  const repository = new SchedulerSlotHoldRepository({ getConnection: async () => connections.shift() });

  const hold = await repository.acquire(input);
  assert.equal(hold.status, 'held');
  assert.equal(deadlocked.rolledBack, true);
  assert.equal(deadlocked.released, true);
  assert.equal(retry.committed, true);
  assert.equal(retry.released, true);
});

test('optional MariaDB concurrency proof', { skip: process.env.OMS_SCHEDULER_TEST_DB !== '1' }, async () => {
  const mysql = require('mysql2/promise');
  const { SchedulerSlotHoldRepository } = require('../src/scheduler/slot-holds.js');
  const pool = mysql.createPool({
    socketPath: process.env.OMS_DB_SOCKET || undefined,
    host: process.env.OMS_DB_HOST || '127.0.0.1',
    port: Number(process.env.OMS_DB_PORT || 3306),
    user: process.env.OMS_DB_USER,
    password: process.env.OMS_DB_PASSWORD,
    database: process.env.OMS_DB_NAME,
    connectionLimit: 4,
  });
  const repository = new SchedulerSlotHoldRepository(pool);
  const unique = `phase0-${Date.now()}`;
  const input = {
    tenantKey: unique,
    eventTypeKey: 'thirty-minute-call',
    hostUsername: 'phase0@example.test',
    slotStart: new Date('2030-01-01T17:00:00.000Z'),
    slotEnd: new Date('2030-01-01T17:30:00.000Z'),
    capacity: 1,
    ttlSeconds: 120,
    now: new Date('2030-01-01T16:00:00.000Z'),
  };

  try {
    const results = await Promise.allSettled([
      repository.acquire({ ...input, idempotencyKey: `${unique}-a` }),
      repository.acquire({ ...input, idempotencyKey: `${unique}-b` }),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejection = results.find((result) => result.status === 'rejected');
    assert.ok(rejection);
    assert.equal(
      rejection.reason?.name,
      'SlotUnavailableError',
      rejection.reason?.stack || String(rejection.reason)
    );
  } finally {
    await pool.query('DELETE FROM scheduler_slot_holds WHERE tenant_key = ?', [unique]);
    await pool.query('DELETE FROM scheduler_slot_inventory WHERE tenant_key = ?', [unique]);
    await pool.end();
  }
});
