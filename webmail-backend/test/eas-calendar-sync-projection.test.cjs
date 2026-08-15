const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OMS_DB_PASSWORD ||= 'calendar-sync-projection-test';

const { projectStoredCalendarPimCommand } = require('../src/eas-calendar-sync-projection.js');
const {
  computePimSyncDelta,
  normalizePimQuarantineState,
  pimItemFingerprint,
} = require('../src/eas-pim-sync.js');

const validIcal = uid => [
  'BEGIN:VCALENDAR', 'BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${uid}`,
  'DTSTART:20260703T170000Z', 'DTEND:20260703T180000Z',
  'END:VEVENT', 'END:VCALENDAR', '',
].join('\r\n');

const unsupportedIcal = uid => [
  'BEGIN:VCALENDAR', 'BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${uid}`,
  'DTSTART:20260703T170000Z', 'DTEND:20260703T180000Z',
  'RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9',
  'END:VEVENT', 'END:VCALENDAR', '',
].join('\r\n');

test('mixed calendar projection quarantines one bad item, advances state, and later adds its correction', () => {
  const badId = '1'.repeat(64);
  const goodId = '2'.repeat(64);
  const snapshot = [
    { serverId: badId, sourceId: 'bad-storage', fingerprint: pimItemFingerprint(badId, '1') },
    { serverId: goodId, sourceId: 'good-storage', fingerprint: pimItemFingerprint(goodId, '1') },
  ];
  const delta = computePimSyncDelta({ knownItems: {}, snapshot, windowSize: 10 });
  const known = {};
  const emitted = [];
  for (const command of delta.commands) {
    const projection = projectStoredCalendarPimCommand(
      command,
      known,
      command.serverId === badId ? 'bad-storage' : 'good-storage',
      command.serverId === badId ? unsupportedIcal('bad-client') : validIcal('good-client'),
    );
    known[command.serverId] = projection.stateFingerprint;
    if (projection.node) emitted.push(projection.node);
  }
  assert.deepEqual(emitted.map(node => [node.tag, node.children[0].content]), [['Add', goodId]]);

  const quiet = normalizePimQuarantineState(known, snapshot);
  assert.deepEqual(computePimSyncDelta({
    knownItems: quiet.knownItems, snapshot: quiet.snapshot, windowSize: 10,
  }).commands, []);

  const correctedSnapshot = [
    { ...snapshot[0], fingerprint: pimItemFingerprint(badId, '2') },
    snapshot[1],
  ];
  const corrected = normalizePimQuarantineState(known, correctedSnapshot);
  const correctionDelta = computePimSyncDelta({
    knownItems: corrected.knownItems, snapshot: corrected.snapshot, windowSize: 10,
  });
  assert.deepEqual(correctionDelta.commands.map(command => [command.type, command.serverId]), [['Add', badId]]);
  const projection = projectStoredCalendarPimCommand(
    correctionDelta.commands[0], corrected.knownItems, 'bad-storage', validIcal('bad-client'),
  );
  assert.equal(projection.quarantined, false);
  assert.equal(projection.node.tag, 'Add');
});

test('a delivered calendar item that becomes unrepresentable emits Delete and stores quarantine state', () => {
  const serverId = '3'.repeat(64);
  const oldFingerprint = pimItemFingerprint(serverId, '1');
  const command = { type: 'Change', serverId, fingerprint: pimItemFingerprint(serverId, '2') };
  const projection = projectStoredCalendarPimCommand(
    command, { [serverId]: oldFingerprint }, 'storage', unsupportedIcal('client'),
  );
  assert.equal(projection.quarantined, true);
  assert.equal(projection.node.tag, 'Delete');
  assert.equal(projection.wireCommand.type, 'Delete');
  assert.match(projection.stateFingerprint, /^q:[0-9a-f]{64}$/);
});
