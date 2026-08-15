const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../src/mail/outbound-send-feedback.ts');

function loadModule() {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText;
  const loaded = new Module(sourcePath, module);
  loaded.paths = module.paths;
  loaded._compile(compiled, sourcePath);
  return loaded.exports;
}

test('scheduled date inputs remain on the selected local calendar day', () => {
  const previousTimezone = process.env.TZ;
  process.env.TZ = 'America/Phoenix';
  try {
    const { scheduledDateFromLocalInputs } = loadModule();
    const scheduled = scheduledDateFromLocalInputs('2026-08-16', '09:45');
    assert.ok(scheduled instanceof Date);
    assert.equal(scheduled.getFullYear(), 2026);
    assert.equal(scheduled.getMonth(), 7);
    assert.equal(scheduled.getDate(), 16);
    assert.equal(scheduled.getHours(), 9);
    assert.equal(scheduled.getMinutes(), 45);
    assert.equal(scheduledDateFromLocalInputs('2026-02-30', '09:45'), null);
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('send feedback distinguishes undo, user scheduling, and Sent-copy outcomes', () => {
  const { outboundSendFeedback } = loadModule();

  assert.deepEqual(outboundSendFeedback({ scheduledId: 41 }, 'undo', 12), {
    type: 'success',
    message: 'Message will be sent in 12s',
    duration: 13000,
    actionLabel: 'Undo',
  });
  assert.deepEqual(outboundSendFeedback({ scheduledId: 44, draftCleanupStatus: 'failed' }, 'undo', 12), {
    type: 'error',
    message: 'Message queued, but its old Draft could not be removed',
    duration: 13000,
    actionLabel: 'Undo',
  });
  assert.deepEqual(outboundSendFeedback({ scheduledId: 42 }, 'scheduled', 3600), {
    type: 'success',
    message: 'Message scheduled',
    duration: 6000,
    actionLabel: 'Cancel',
  });
  assert.deepEqual(outboundSendFeedback({ scheduledId: 43, draftCleanupStatus: 'failed' }, 'scheduled', 3600), {
    type: 'error',
    message: 'Message scheduled, but its old Draft could not be removed',
    duration: 6000,
    actionLabel: 'Cancel',
  });
  assert.deepEqual(outboundSendFeedback({ deliveryStatus: 'accepted', sentCopyStatus: 'pending' }, null, 0), {
    type: 'info',
    message: 'Message sent; saving your Sent copy',
  });
  assert.deepEqual(outboundSendFeedback({ deliveryStatus: 'accepted', sentCopyStatus: 'unavailable' }, null, 0), {
    type: 'error',
    message: 'Message sent, but no Sent copy could be saved',
  });
  assert.deepEqual(outboundSendFeedback({
    deliveryStatus: 'partial',
    rejectedRecipients: ['rejected@example.net', 'Second <second@example.net>'],
    sentCopyStatus: 'saved',
  }, null, 0), {
    type: 'error',
    message: 'Message sent to some recipients; not accepted by rejected@example.net, second@example.net',
  });
  assert.deepEqual(outboundSendFeedback({
    deliveryStatus: 'partial',
    rejectedRecipients: ['<img src=x onerror=alert(1)>'],
    sentCopyStatus: 'pending',
  }, null, 0), {
    type: 'error',
    message: 'Message sent to some recipients; at least one recipient was rejected; saving your Sent copy',
  });
});
