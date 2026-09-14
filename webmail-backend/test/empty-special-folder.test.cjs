const test = require('node:test');
const assert = require('node:assert/strict');
process.env.OMS_DB_PASSWORD ||= 'fixture-only';
const { ImapService } = require('../src/imap.js');
function fixture(path = 'Junk') {
  const service = Object.create(ImapService.prototype);
  const calls = [];
  let released = 0;
  service.client = {
    capabilities: new Set(['UIDPLUS']), mailbox: { uidValidity: 9n, uidNext: 1202 },
    list: async () => [{ path: 'Junk', specialUse: '\\Junk' }, { path: 'Bin', specialUse: '\\Trash' }, { path: 'INBOX' }, { path: 'Junk/Child' }],
    getMailboxLock: async selected => { assert.equal(selected, path); return { release() { released++; } }; },
    search: async (query, options) => { calls.push(['search', query, options]); return Array.from({ length: 1201 }, (_, i) => i + 1); },
    messageMove: async (...args) => { calls.push(['move', ...args]); return {}; },
    messageDelete: async (...args) => { calls.push(['delete', ...args]); return true; },
  };
  return { service, calls, released: () => released };
}
test('preview covers all pages without mutations; confirmation excludes later arrivals and batches exact UIDs', async () => {
  const { service, calls, released } = fixture();
  const snapshot = await service.emptySpecialFolder('Junk');
  assert.equal(snapshot.count, 1201);
  assert.equal(calls.length, 1);
  service.client.mailbox.uidNext = 1300;
  service.client.search = async () => Array.from({ length: 1299 }, (_, i) => i + 1);
  const result = await service.emptySpecialFolder('Junk', snapshot);
  assert.equal(result.count, 1201);
  const moves = calls.filter(call => call[0] === 'move');
  assert.deepEqual(moves.map(call => call[1].split(',').length), [500, 500, 201]);
  assert.ok(moves.every(call => call[2] === 'Bin' && call[3].uid));
  assert.equal(moves.at(-1)[1].split(',').at(-1), '1201');
  assert.equal(released(), 2);
});
test('Trash deletion requires UIDPLUS and exact folder identity; ordinary folders and children cannot be emptied', async () => {
  const { service, calls, released } = fixture('Bin');
  await assert.rejects(service.emptySpecialFolder('INBOX'), /Only Junk and Trash/);
  await assert.rejects(service.emptySpecialFolder('Junk/Child'), /Only Junk and Trash/);
  const snapshot = await service.emptySpecialFolder('Bin');
  await assert.rejects(service.emptySpecialFolder('Bin', { ...snapshot, uidValidity: '10' }), /folder changed/);
  service.client.capabilities.clear();
  await assert.rejects(service.emptySpecialFolder('Bin', snapshot), /safely empty/);
  assert.equal(calls.filter(call => call[0] === 'delete').length, 0);
  service.client.capabilities.add('UIDPLUS');
  await service.emptySpecialFolder('Bin', snapshot);
  assert.equal(calls.filter(call => call[0] === 'delete').length, 3);
  assert.equal(released(), 3);
});
test('empty mailbox never issues a wildcard; failures release the lock', async () => {
  const { service, calls, released } = fixture();
  service.client.mailbox.uidNext = 1;
  assert.equal((await service.emptySpecialFolder('Junk')).count, 0);
  assert.equal(calls.length, 0);
  service.client.mailbox.uidNext = 1202;
  service.client.messageMove = async () => { throw new Error('interrupted'); };
  await assert.rejects(service.emptySpecialFolder('Junk', { uidValidity: '9', maxUid: 1201 }), /interrupted/);
  assert.equal(released(), 2);
});
