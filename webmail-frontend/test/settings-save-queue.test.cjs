const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');
const filename = require('node:path').resolve(__dirname, '../src/settings/settings-save-queue.ts');
const loaded = new Module(filename, module);
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { createSettingsSaveQueue } = loaded.exports;

test('navigation flush saves edits before the debounce and coalesces each namespace', async () => {
  const q = createSettingsSaveQueue(); const calls = [];
  q.schedule('mail', async () => calls.push('old'));
  q.schedule('calendar', async () => calls.push('calendar'));
  q.schedule('mail', async () => calls.push('latest'));
  assert.equal(q.pending, true);
  await q.flush();
  assert.deepEqual(calls, ['latest', 'calendar']);
  assert.equal(q.pending, false);
});
test('edits arriving during a write are serialized and remain in the flush', async () => {
  const q = createSettingsSaveQueue(); const calls = []; let release;
  q.schedule('mail', async () => { calls.push('first'); await new Promise(r => { release = r; }); });
  const saving = q.flush();
  q.schedule('mail', async () => calls.push('second'));
  assert.equal(q.flush(), saving);
  assert.deepEqual(calls, ['first']);
  release(); await saving;
  assert.deepEqual(calls, ['first', 'second']);
  assert.equal(q.pending, false);
});
test('a failed save retains the exact edit for retry, and newer edits supersede it', async () => {
  const q = createSettingsSaveQueue(); let fail = true; let saved = '';
  q.schedule('mail', async () => { if (fail) throw new Error('offline'); saved = 'original'; });
  await assert.rejects(q.flush(), /offline/); assert.equal(q.pending, true);
  fail = false; await q.flush(); assert.equal(saved, 'original');
  q.schedule('mail', async () => { throw new Error('offline'); });
  await assert.rejects(q.flush());
  q.schedule('mail', async () => { saved = 'latest'; });
  await q.flush(); assert.equal(saved, 'latest'); assert.equal(q.pending, false);
});
