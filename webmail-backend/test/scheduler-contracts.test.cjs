const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  SCHEDULER_BOOKING_STATUSES,
  canTransitionBooking,
} = require('../src/scheduler/contracts.js');
const {
  SCHEDULER_OUTBOX_EVENT_TYPES,
} = require('../src/scheduler/outbox.js');

test('booking lifecycle allows only explicit forward transitions', () => {
  assert.ok(SCHEDULER_BOOKING_STATUSES.includes('confirmed'));
  assert.equal(canTransitionBooking({ from: 'requested', to: 'confirmed' }), true);
  assert.equal(canTransitionBooking({ from: 'confirmed', to: 'cancelled' }), true);
  assert.equal(canTransitionBooking({ from: 'cancelled', to: 'confirmed' }), false);
  assert.equal(canTransitionBooking({ from: 'completed', to: 'cancelled' }), false);
});

test('outbox event types are unique and include projection boundaries', () => {
  assert.equal(new Set(SCHEDULER_OUTBOX_EVENT_TYPES).size, SCHEDULER_OUTBOX_EVENT_TYPES.length);
  assert.ok(SCHEDULER_OUTBOX_EVENT_TYPES.includes('calendar.project'));
  assert.ok(SCHEDULER_OUTBOX_EVENT_TYPES.includes('message.send'));
  assert.ok(SCHEDULER_OUTBOX_EVENT_TYPES.includes('webhook.deliver'));
});

test('owner event lists retain inactive types but exclude deletion tombstones', () => {
  const storeSource = fs.readFileSync(
    path.join(__dirname, '../src/scheduler/store.ts'),
    'utf8',
  );
  assert.match(storeSource, /includeInactive = true/);
  assert.match(storeSource, /audit\.action = 'event_type\.delete'/);
  assert.match(storeSource, /NOT EXISTS/);
});
