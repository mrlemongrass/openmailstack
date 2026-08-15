const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '../src/calendar/freeBusy.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUnderTest = { exports: {} };
new Function('module', 'exports', 'require', compiled)(moduleUnderTest, moduleUnderTest.exports, require);

const {
  buildFreeBusyRequestUrl,
  createUnavailableFreeBusyLookup,
  freeBusyStatusForUser,
  normalizeFreeBusyResponse,
} = moduleUnderTest.exports;

test('free/busy requests use URLSearchParams with canonical recipient keys', () => {
  const url = buildFreeBusyRequestUrl(
    [' Alice@Example.Test ', 'bob+calendar@example.test', 'ALICE@example.test'],
    new Date('2026-08-20T09:00:00.000Z'),
    new Date('2026-08-20T10:00:00.000Z'),
  );
  const parsed = new URL(url, 'https://mail.example.test');

  assert.equal(parsed.pathname, '/api/apps/calendars/freebusy');
  assert.equal(parsed.searchParams.get('users'), 'alice@example.test,bob+calendar@example.test');
  assert.equal(parsed.searchParams.get('start'), '2026-08-20T09:00:00.000Z');
  assert.equal(parsed.searchParams.get('end'), '2026-08-20T10:00:00.000Z');
  assert.match(url, /users=alice%40example\.test%2Cbob%2Bcalendar%40example\.test/);
});

test('denied and missing recipients are unavailable and can never be projected as Free', () => {
  const lookup = normalizeFreeBusyResponse(
    ['alice@example.test', 'bob@example.test', 'missing@example.test'],
    {
      busy: {
        'alice@example.test': [],
        'bob@example.test': [{ start: '2026-08-20T09:00:00.000Z', end: '2026-08-20T10:00:00.000Z' }],
      },
      unavailable: ['bob@example.test'],
    },
  );
  const start = new Date('2026-08-20T09:00:00.000Z');
  const end = new Date('2026-08-20T10:00:00.000Z');

  assert.equal(freeBusyStatusForUser(lookup, 'alice@example.test', start, end), 'free');
  assert.equal(freeBusyStatusForUser(lookup, 'bob@example.test', start, end), 'unavailable');
  assert.equal(freeBusyStatusForUser(lookup, 'missing@example.test', start, end), 'unavailable');
  assert.deepEqual(lookup.unavailable, ['bob@example.test', 'missing@example.test']);
});

test('busy projection is overlap-aware and ignores unrequested response keys', () => {
  const lookup = normalizeFreeBusyResponse(['alice@example.test'], {
    busy: {
      'alice@example.test': [{ start: '2026-08-20T09:30:00.000Z', end: '2026-08-20T10:30:00.000Z' }],
      'mallory@example.test': [],
    },
    unavailable: [],
  });

  assert.equal(
    freeBusyStatusForUser(
      lookup,
      'alice@example.test',
      new Date('2026-08-20T09:00:00.000Z'),
      new Date('2026-08-20T10:00:00.000Z'),
    ),
    'busy',
  );
  assert.equal(Object.hasOwn(lookup.busy, 'mallory@example.test'), false);
});

test('lookup start and error replacement clear stale busy state and mark every request unavailable', () => {
  const replacement = createUnavailableFreeBusyLookup([' ALICE@example.test ', 'bob@example.test']);
  assert.deepEqual(replacement, {
    busy: {},
    unavailable: ['alice@example.test', 'bob@example.test'],
  });
});

test('the event editor has an explicit unavailable label before Busy and Free', () => {
  const modalSource = fs.readFileSync(path.join(__dirname, '../src/calendar/EventModal.tsx'), 'utf8');
  assert.match(modalSource, /Availability unavailable/);
  assert.match(modalSource, /freeBusyStatusForUser/);
});
