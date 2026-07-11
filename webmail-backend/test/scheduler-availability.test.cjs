const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateAvailability, projectAvailabilitySlot } = require('../src/scheduler/availability.js');

const base = {
  timeZone: 'America/Phoenix',
  rangeStart: new Date('2026-07-13T00:00:00.000Z'),
  rangeEnd: new Date('2026-07-14T00:00:00.000Z'),
  durationMinutes: 30,
  intervalMinutes: 30,
  windows: [{ weekday: 1, startMinute: 9 * 60, endMinute: 11 * 60 }],
  now: new Date('2026-07-01T00:00:00.000Z'),
};

test('calculates slots in the host timezone', () => {
  const slots = calculateAvailability(base);
  assert.deepEqual(slots.map((slot) => slot.start.toISOString()), [
    '2026-07-13T16:00:00.000Z',
    '2026-07-13T16:30:00.000Z',
    '2026-07-13T17:00:00.000Z',
    '2026-07-13T17:30:00.000Z',
  ]);
});

test('projects the same instant into a different booker timezone', () => {
  const slot = calculateAvailability(base)[0];
  assert.deepEqual(projectAvailabilitySlot(slot, 'Asia/Baghdad'), {
    timeZone: 'Asia/Baghdad',
    startDate: '2026-07-13',
    startMinute: 19 * 60,
    endDate: '2026-07-13',
    endMinute: 19 * 60 + 30,
  });
  assert.deepEqual(projectAvailabilitySlot(slot, 'Asia/Tokyo'), {
    timeZone: 'Asia/Tokyo',
    startDate: '2026-07-14',
    startMinute: 60,
    endDate: '2026-07-14',
    endMinute: 90,
  });
});

test('applies busy intervals and buffers using half-open ranges', () => {
  const slots = calculateAvailability({
    ...base,
    bufferBeforeMinutes: 15,
    bufferAfterMinutes: 15,
    busy: [{ start: new Date('2026-07-13T16:45:00.000Z'), end: new Date('2026-07-13T17:15:00.000Z') }],
  });
  assert.deepEqual(slots.map((slot) => slot.start.toISOString()), [
    '2026-07-13T16:00:00.000Z',
    '2026-07-13T17:30:00.000Z',
  ]);
});

test('date overrides replace the weekly schedule', () => {
  const slots = calculateAvailability({
    ...base,
    overrides: [{ date: '2026-07-13', windows: [{ startMinute: 13 * 60, endMinute: 14 * 60 }] }],
  });
  assert.deepEqual(slots.map((slot) => slot.start.toISOString()), [
    '2026-07-13T20:00:00.000Z',
    '2026-07-13T20:30:00.000Z',
  ]);
});

test('empty date override blocks the day', () => {
  assert.deepEqual(calculateAvailability({ ...base, overrides: [{ date: '2026-07-13', windows: [] }] }), []);
});

test('minimum notice removes slots that start too soon', () => {
  const slots = calculateAvailability({
    ...base,
    now: new Date('2026-07-13T16:10:00.000Z'),
    minimumNoticeMinutes: 50,
  });
  assert.deepEqual(slots.map((slot) => slot.start.toISOString()), [
    '2026-07-13T17:00:00.000Z',
    '2026-07-13T17:30:00.000Z',
  ]);
});

test('skips nonexistent local times during the spring DST transition', () => {
  const slots = calculateAvailability({
    timeZone: 'America/New_York',
    rangeStart: new Date('2026-03-08T00:00:00.000Z'),
    rangeEnd: new Date('2026-03-09T00:00:00.000Z'),
    durationMinutes: 30,
    intervalMinutes: 30,
    windows: [{ weekday: 0, startMinute: 90, endMinute: 210 }],
    now: new Date('2026-03-01T00:00:00.000Z'),
  });
  assert.deepEqual(slots.map((slot) => slot.start.toISOString()), [
    '2026-03-08T06:30:00.000Z',
    '2026-03-08T07:00:00.000Z',
  ]);
});

test('returns both real instants for an ambiguous fall DST time', () => {
  const slots = calculateAvailability({
    timeZone: 'America/New_York',
    rangeStart: new Date('2026-11-01T00:00:00.000Z'),
    rangeEnd: new Date('2026-11-02T00:00:00.000Z'),
    durationMinutes: 30,
    intervalMinutes: 30,
    windows: [{ weekday: 0, startMinute: 90, endMinute: 150 }],
    now: new Date('2026-10-01T00:00:00.000Z'),
  });
  assert.deepEqual(slots.map((slot) => slot.start.toISOString()), [
    '2026-11-01T05:30:00.000Z',
    '2026-11-01T06:30:00.000Z',
    '2026-11-01T07:00:00.000Z',
  ]);
});

test('allows a slot that ends exactly at local midnight', () => {
  const slots = calculateAvailability({
    timeZone: 'America/Phoenix',
    rangeStart: new Date('2026-07-14T00:00:00.000Z'),
    rangeEnd: new Date('2026-07-15T08:00:00.000Z'),
    durationMinutes: 30,
    intervalMinutes: 30,
    windows: [{ weekday: 2, startMinute: 23 * 60 + 30, endMinute: 1440 }],
    now: new Date('2026-07-01T00:00:00.000Z'),
  });
  assert.deepEqual(slots.map((slot) => slot.start.toISOString()), ['2026-07-15T06:30:00.000Z']);
});

test('rejects malformed windows and busy intervals', () => {
  assert.throws(() => calculateAvailability({
    ...base,
    windows: [{ weekday: 1, startMinute: 600, endMinute: 500 }],
  }), /must not cross midnight/);
  assert.throws(() => calculateAvailability({
    ...base,
    busy: [{ start: new Date('2026-07-13T17:00:00Z'), end: new Date('2026-07-13T16:00:00Z') }],
  }), /busy interval start/);
  assert.throws(() => calculateAvailability({ ...base, bufferBeforeMinutes: -1 }), /non-negative integer/);
  assert.throws(() => calculateAvailability({ ...base, rangeStart: new Date('invalid') }), /valid dates/);
});
