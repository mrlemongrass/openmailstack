const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OMS_DB_PASSWORD ||= 'unit-test-password';
if (process.env.OMS_TEST_TYPESCRIPT_SOURCE === '1') {
  process.env.TS_NODE_COMPILER_OPTIONS ||= JSON.stringify({
    module: 'CommonJS',
    moduleResolution: 'node',
    ignoreDeprecations: '6.0',
  });
  require('ts-node/register/transpile-only');
}

const sourceExtension = process.env.OMS_TEST_TYPESCRIPT_SOURCE === '1' ? '.ts' : '.js';
const { SchedulerStore } = require(`../src/scheduler/store${sourceExtension}`);

const start = new Date('2050-01-01T10:00:00.000Z');
const bookingInput = {
  eventTypeId: 'event-1',
  start,
  bookerTimeZone: 'UTC',
  bookerName: 'Ada',
  bookerEmail: 'ada@example.test',
  idempotencyKey: 'recurring-lock-safety',
  recurrenceCount: 2,
};

function recurringStore(lockBehavior, queryBehavior = async () => [[], []]) {
  const events = [];
  const lockConnection = {
    query: async sql => {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      events.push(compact);
      if (compact.startsWith('SELECT GET_LOCK')) return lockBehavior.acquire();
      if (compact.startsWith('SELECT RELEASE_LOCK')) return lockBehavior.release();
      throw new Error(`Unexpected lock query: ${compact}`);
    },
    release: () => events.push('pool:release'),
    destroy: () => events.push('pool:destroy'),
  };
  const fakePool = {
    getConnection: async () => lockConnection,
    query: queryBehavior,
  };
  const store = Object.create(SchedulerStore.prototype);
  store.pool = fakePool;
  store.getPublicEvent = async () => ({
    entitlement: { tenantKey: 'example.test', timeZone: 'UTC' },
    event: { id: 'event-1', visibility: 'public', maxRecurrenceOccurrences: 10 },
  });
  return { store, events };
}

test('definitively unavailable recurring lock is not released as owned', async () => {
  const { store, events } = recurringStore({
    acquire: async () => [[{ acquired: 0 }], []],
    release: async () => [[{ released: 1 }], []],
  });

  await assert.rejects(
    store.createRecurringBooking('ada', 'consultation', bookingInput),
    /still being processed/,
  );
  assert.ok(!events.some(event => String(event).startsWith('SELECT RELEASE_LOCK')));
  assert.ok(events.includes('pool:release'));
  assert.ok(!events.includes('pool:destroy'));
});

test('indeterminate recurring lock acquisition destroys the pooled session', async t => {
  await t.test('NULL result', async () => {
    const { store, events } = recurringStore({
      acquire: async () => [[{ acquired: null }], []],
      release: async () => [[{ released: 1 }], []],
    });
    await assert.rejects(
      store.createRecurringBooking('ada', 'consultation', bookingInput),
      /lock acquisition was indeterminate/,
    );
    assert.ok(events.includes('pool:destroy'));
    assert.ok(!events.includes('pool:release'));
    assert.ok(!events.some(event => String(event).startsWith('SELECT RELEASE_LOCK')));
  });

  await t.test('transport failure', async () => {
    const { store, events } = recurringStore({
      acquire: async () => { throw new Error('recurring GET_LOCK response lost'); },
      release: async () => [[{ released: 1 }], []],
    });
    await assert.rejects(
      store.createRecurringBooking('ada', 'consultation', bookingInput),
      /GET_LOCK response lost/,
    );
    assert.ok(events.includes('pool:destroy'));
    assert.ok(!events.includes('pool:release'));
    assert.ok(!events.some(event => String(event).startsWith('SELECT RELEASE_LOCK')));
  });
});

test('recurring idempotent replay survives lock-release failure and evicts the session', async () => {
  let selectCount = 0;
  const { store, events } = recurringStore({
    acquire: async () => [[{ acquired: 1 }], []],
    release: async () => { throw new Error('recurring RELEASE_LOCK response lost'); },
  }, async () => {
    selectCount += 1;
    if (selectCount === 1) {
      return [[{
        event_type_id: 'event-1',
        booker_email: 'ada@example.test',
        slot_start_utc: '2050-01-01 10:00:00.000',
        series_id: 'series-1',
        series_count: 2,
      }], []];
    }
    return [[
      { id: 'booking-1', status: 'confirmed', slot_start_utc: '2050-01-01 10:00:00.000', slot_end_utc: '2050-01-01 10:30:00.000', series_index: 1 },
      { id: 'booking-2', status: 'confirmed', slot_start_utc: '2050-01-08 10:00:00.000', slot_end_utc: '2050-01-08 10:30:00.000', series_index: 2 },
    ], []];
  });
  const originalConsoleError = console.error;
  const errors = [];
  console.error = message => errors.push(String(message));
  let replay;
  try {
    replay = await store.createRecurringBooking('ada', 'consultation', bookingInput);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.bookings.length, 2);
  assert.ok(events.includes('pool:destroy'));
  assert.ok(!events.includes('pool:release'));
  assert.ok(errors.some(message => message.includes('lock release failed after booking completion')));
});
