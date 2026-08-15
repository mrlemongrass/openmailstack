const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadTypeScriptModule(relativePath) {
  const sourcePath = path.resolve(__dirname, relativePath);
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

const restoredMessage = {
  uid: 902,
  from: 'Owner <owner@example.test>',
  to: 'recipient@example.net',
  subject: 'Restored message',
  date: '2026-08-15T12:00:00Z',
  text: 'Still editable',
};

test('Undo reopens a restored new-message Draft from the server-returned identity', async () => {
  const { reopenRestoredScheduledDraft } = loadTypeScriptModule('../src/mail/scheduled-undo-draft.ts');
  const calls = [];

  const result = await reopenRestoredScheduledDraft(
    { success: true, draftFolder: 'Team/Drafts', draftUid: 902 },
    {
      isComposerOpen: () => false,
      fetchDraft: async (folder, uid) => {
        calls.push(['fetch', folder, uid]);
        return restoredMessage;
      },
      resumeDraft: async (message, folder) => {
        calls.push(['resume', message.uid, folder]);
      },
    },
  );

  assert.deepEqual(result, {
    draftFolder: 'Team/Drafts',
    draftUid: 902,
    reopened: true,
  });
  assert.deepEqual(calls, [
    ['fetch', 'Team/Drafts', 902],
    ['resume', 902, 'Team/Drafts'],
  ]);
});

test('Undo preserves a newer composer instead of overwriting it with a stale scheduled Draft', async () => {
  const { reopenRestoredScheduledDraft } = loadTypeScriptModule('../src/mail/scheduled-undo-draft.ts');
  let touchedDraft = false;

  const result = await reopenRestoredScheduledDraft(
    { success: true, draftFolder: 'Drafts', draftUid: 902 },
    {
      isComposerOpen: () => true,
      fetchDraft: async () => {
        touchedDraft = true;
        return restoredMessage;
      },
      resumeDraft: async () => { touchedDraft = true; },
    },
  );

  assert.deepEqual(result, { draftFolder: 'Drafts', draftUid: 902, reopened: false });
  assert.equal(touchedDraft, false);
});

test('inline-reply Undo resumes the returned reply Draft through the full composer path', async () => {
  const { reopenRestoredScheduledDraft } = loadTypeScriptModule('../src/mail/scheduled-undo-draft.ts');
  const replyDraft = {
    ...restoredMessage,
    subject: 'Re: Existing thread',
    inReplyTo: '<original@example.test>',
    references: ['<earlier@example.test>', '<original@example.test>'],
  };
  let resumed;

  const result = await reopenRestoredScheduledDraft(
    { success: true, draftFolder: 'Drafts', draftUid: 902 },
    {
      isComposerOpen: () => false,
      fetchDraft: async () => replyDraft,
      resumeDraft: async (message, folder) => { resumed = { message, folder }; },
    },
  );

  assert.equal(result.reopened, true);
  assert.deepEqual(resumed, { message: replyDraft, folder: 'Drafts' });
});

test('Undo API returns the restored Draft reference and rejects application failures', async () => {
  const { undoAction } = loadTypeScriptModule('../src/shared/api.ts');
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => new Response(JSON.stringify({
      success: true,
      draftFolder: 'Drafts',
      draftUid: 902,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    assert.deepEqual(await undoAction({ scheduledId: 73 }), {
      success: true,
      draftFolder: 'Drafts',
      draftUid: 902,
    });

    global.fetch = async () => new Response(JSON.stringify({
      success: false,
      error: 'Draft restoration failed',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    await assert.rejects(undoAction({ scheduledId: 73 }), /Draft restoration failed/);
  } finally {
    global.fetch = originalFetch;
  }
});
