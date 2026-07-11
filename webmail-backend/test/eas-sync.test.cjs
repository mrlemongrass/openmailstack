const test = require('node:test');
const assert = require('node:assert/strict');

const { shouldSendActiveSyncServerChanges } = require('../src/eas-sync.js');

test('ActiveSync command-only Sync acknowledges without echoing server changes', () => {
  assert.equal(shouldSendActiveSyncServerChanges({
    syncKey: 'cal-42-3',
    nextSyncKey: 'cal-42-4',
    hasClientCommands: true,
    getChangesRequested: false,
  }), false);
});

test('ActiveSync Sync sends server changes when explicitly requested', () => {
  assert.equal(shouldSendActiveSyncServerChanges({
    syncKey: 'cal-42-3',
    nextSyncKey: 'cal-42-4',
    hasClientCommands: true,
    getChangesRequested: true,
  }), true);
});

test('ActiveSync Sync skips server changes for a current key', () => {
  assert.equal(shouldSendActiveSyncServerChanges({
    syncKey: 'cal-42-4',
    nextSyncKey: 'cal-42-4',
    hasClientCommands: false,
    getChangesRequested: true,
  }), false);
});
