const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OMS_DB_PASSWORD ||= 'calendar-subscription-schema-test';

function column(TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT = null) {
  return { TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT };
}

test('calendar subscription schema migration adds and verifies every required ownership/status column', async (t) => {
  const db = require('../src/db.js');
  const originalQuery = db.pool.query;
  t.after(() => { db.pool.query = originalQuery; });
  const columns = new Map();
  const alterations = [];
  db.pool.query = async (sql) => {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    if (compact.startsWith('SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT')) {
      return [[...columns.values()], []];
    }
    if (compact.startsWith('ALTER TABLE calendars ADD COLUMN last_fetched_at')) {
      alterations.push('calendars.last_fetched_at');
      columns.set('calendars.last_fetched_at', column(
        'calendars', 'last_fetched_at', 'datetime', 'YES', null,
      ));
      return [[], []];
    }
    if (compact.startsWith('ALTER TABLE calendars ADD COLUMN last_fetch_error')) {
      alterations.push('calendars.last_fetch_error');
      columns.set('calendars.last_fetch_error', column(
        'calendars', 'last_fetch_error', 'text', 'YES', null,
      ));
      return [[], []];
    }
    if (compact.startsWith('ALTER TABLE events ADD COLUMN subscription_managed')) {
      alterations.push('events.subscription_managed');
      columns.set('events.subscription_managed', column(
        'events', 'subscription_managed', 'tinyint', 'NO', '0',
      ));
      return [[], []];
    }
    throw new Error(`Unexpected subscription schema query: ${compact}`);
  };

  const modulePath = require.resolve('../src/calendar-subscription.js');
  delete require.cache[modulePath];
  const { ensureCalendarSubscriptionSchema } = require(modulePath);
  await Promise.all([ensureCalendarSubscriptionSchema(), ensureCalendarSubscriptionSchema()]);

  assert.deepEqual(alterations, [
    'calendars.last_fetched_at',
    'calendars.last_fetch_error',
    'events.subscription_managed',
  ]);
});

test('calendar subscription schema migration fails closed if ownership is still unverifiable', async (t) => {
  const db = require('../src/db.js');
  const originalQuery = db.pool.query;
  t.after(() => { db.pool.query = originalQuery; });
  db.pool.query = async (sql) => {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    if (compact.startsWith('SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT')) {
      return [[
        column('calendars', 'last_fetched_at', 'datetime', 'YES'),
        column('calendars', 'last_fetch_error', 'text', 'YES'),
      ], []];
    }
    if (compact.startsWith('ALTER TABLE events ADD COLUMN subscription_managed')) return [[], []];
    throw new Error(`Unexpected subscription schema query: ${compact}`);
  };

  const modulePath = require.resolve('../src/calendar-subscription.js');
  delete require.cache[modulePath];
  const { ensureCalendarSubscriptionSchema } = require(modulePath);

  await assert.rejects(
    ensureCalendarSubscriptionSchema(),
    /missing required columns: events\.subscription_managed/i,
  );
});

test('calendar subscription schema rejects a DATE fetch marker that loses time-of-day precision', async (t) => {
  const db = require('../src/db.js');
  const originalQuery = db.pool.query;
  t.after(() => { db.pool.query = originalQuery; });
  db.pool.query = async (sql) => {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    if (compact.startsWith('SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT')) {
      return [[
        column('calendars', 'last_fetched_at', 'date', 'YES'),
        column('calendars', 'last_fetch_error', 'text', 'YES'),
        column('events', 'subscription_managed', 'tinyint', 'NO', '0'),
      ], []];
    }
    throw new Error(`Unexpected subscription schema query: ${compact}`);
  };

  const modulePath = require.resolve('../src/calendar-subscription.js');
  delete require.cache[modulePath];
  const { ensureCalendarSubscriptionSchema } = require(modulePath);

  await assert.rejects(ensureCalendarSubscriptionSchema(), /last_fetched_at is incompatible/i);
});
