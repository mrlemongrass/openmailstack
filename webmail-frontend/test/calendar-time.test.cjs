const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '../src/calendar/calendarTime.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUnderTest = { exports: {} };
new Function('module', 'exports', 'require', compiled)(moduleUnderTest, moduleUnderTest.exports, require);

const {
  addWallDays,
  convertWallDateTimeZone,
  formatIcalDateProperty,
  projectInstantToWallDate,
  resolveDisplayTimeZone,
  wallDateToInstant,
} = moduleUnderTest.exports;

test('resolveDisplayTimeZone chooses the browser system zone or saved home zone', () => {
  assert.equal(resolveDisplayTimeZone({ timeZoneMode: 'system', timeZone: 'Asia/Baghdad' }, 'America/Phoenix'), 'America/Phoenix');
  assert.equal(resolveDisplayTimeZone({ timeZoneMode: 'home', timeZone: 'Asia/Baghdad' }, 'America/Phoenix'), 'Asia/Baghdad');
});

test('projectInstantToWallDate renders one instant in the selected display zone', () => {
  const instant = new Date('2026-07-24T17:00:00.000Z');
  const baghdad = projectInstantToWallDate(instant, 'zoned', 'Asia/Baghdad');
  const phoenix = projectInstantToWallDate(instant, 'zoned', 'America/Phoenix');

  assert.deepEqual(
    [baghdad.getFullYear(), baghdad.getMonth() + 1, baghdad.getDate(), baghdad.getHours(), baghdad.getMinutes()],
    [2026, 7, 24, 20, 0]
  );
  assert.deepEqual(
    [phoenix.getFullYear(), phoenix.getMonth() + 1, phoenix.getDate(), phoenix.getHours(), phoenix.getMinutes()],
    [2026, 7, 24, 10, 0]
  );
});

test('floating values keep their wall time when the display zone changes', () => {
  const floating = new Date('2026-07-24T16:00:00.000Z');
  const projected = projectInstantToWallDate(floating, 'floating', 'Asia/Baghdad');
  assert.deepEqual(
    [projected.getFullYear(), projected.getMonth() + 1, projected.getDate(), projected.getHours()],
    [2026, 7, 24, 16]
  );
});

test('wallDateToInstant and iCalendar serialization preserve explicit event semantics', () => {
  const wallDate = new Date(2026, 6, 24, 20, 0, 0);
  assert.equal(wallDateToInstant(wallDate, 'zoned', 'Asia/Baghdad').toISOString(), '2026-07-24T17:00:00.000Z');
  assert.equal(formatIcalDateProperty('DTSTART', wallDate, 'zoned', 'Asia/Baghdad'), 'DTSTART;TZID=Asia/Baghdad:20260724T200000');
  assert.equal(formatIcalDateProperty('DTSTART', wallDate, 'floating', null), 'DTSTART:20260724T200000');
  assert.equal(formatIcalDateProperty('DTSTART', wallDate, 'utc', 'UTC'), 'DTSTART:20260724T200000Z');
  assert.equal(formatIcalDateProperty('DTSTART', wallDate, 'all-day', null), 'DTSTART;VALUE=DATE:20260724');
});

test('wallDateToInstant follows iCalendar DST gap and overlap rules', () => {
  const gap = new Date(2026, 2, 8, 2, 30, 0);
  const overlap = new Date(2026, 10, 1, 1, 30, 0);

  assert.equal(wallDateToInstant(gap, 'zoned', 'America/New_York').toISOString(), '2026-03-08T07:30:00.000Z');
  assert.equal(wallDateToInstant(overlap, 'zoned', 'America/New_York').toISOString(), '2026-11-01T05:30:00.000Z');
});

test('addWallDays keeps all-day ranges exclusive with calendar-date arithmetic', () => {
  const start = new Date(2026, 2, 7, 0, 0, 0);
  const end = addWallDays(start, 2);
  assert.deepEqual([end.getFullYear(), end.getMonth() + 1, end.getDate()], [2026, 3, 9]);
});

test('event timezone conversion preserves instants, while floating assignment preserves wall time', () => {
  const baghdadWall = new Date(2026, 6, 24, 20, 0, 0);
  const phoenixWall = convertWallDateTimeZone(baghdadWall, 'zoned', 'Asia/Baghdad', 'zoned', 'America/Phoenix');
  assert.deepEqual(
    [phoenixWall.getFullYear(), phoenixWall.getMonth() + 1, phoenixWall.getDate(), phoenixWall.getHours()],
    [2026, 7, 24, 10]
  );

  const floatingToBaghdad = convertWallDateTimeZone(baghdadWall, 'floating', null, 'zoned', 'Asia/Baghdad');
  assert.deepEqual(
    [floatingToBaghdad.getFullYear(), floatingToBaghdad.getMonth() + 1, floatingToBaghdad.getDate(), floatingToBaghdad.getHours()],
    [2026, 7, 24, 20]
  );
});
