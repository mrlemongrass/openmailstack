const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../src/mail/draft-resume.ts');

function attachmentBatchResponse(parts, status = 200, metadataParts = parts) {
  const boundary = 'oms-attachment-test-boundary';
  const metadata = {
    subject: 'Authoritative quarterly plan',
    from: 'Authoritative Sender <authoritative@example.test>',
    to: 'Owner <owner@example.test>',
    cc: 'Project Team <team@example.test>',
    date: '2026-08-25T18:30:00.000Z',
    text: 'Prepared original body',
    html: '',
    attachments: metadataParts.map(part => ({
      filename: part.filename,
      contentType: part.contentType,
      size: Buffer.byteLength(part.content),
    })),
  };
  const fields = [[
    `--${boundary}`,
    'Content-Disposition: form-data; name="message"',
    'Content-Type: application/json',
    '',
    JSON.stringify(metadata),
  ].join('\r\n'), ...parts.map(part => [
    `--${boundary}`,
    `Content-Disposition: form-data; name="attachments"; filename="${part.filename}"`,
    `Content-Type: ${part.contentType}`,
    '',
    part.content,
  ].join('\r\n'))];
  const body = fields.join('\r\n') + `\r\n--${boundary}--\r\n`;
  return new Response(body, {
    status,
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
  });
}

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

const draft = {
  uid: 901,
  subject: 'Quarterly draft',
  from: 'Sales <sales@example.test>',
  to: 'buyer@example.net',
  cc: 'manager@example.test',
  bcc: 'audit@example.test',
  replyTo: 'support@example.test',
  inReplyTo: '<parent@example.test>',
  references: ['<root@example.test>', '<parent@example.test>'],
  date: '2026-08-15T12:00:00Z',
  html: '<p>Preserve this body</p>',
  text: 'Preserve this body',
  draftId: 'draft-resume-fixture',
  attachments: [{
    id: 3,
    filename: 'terms.txt',
    contentType: 'text/plain',
    size: 11,
  }],
};

test('draft resume restores all composer fields and stable identity', () => {
  const { draftComposeState, isDraftFolder } = loadModule();
  const attachmentFile = new File(['hello terms'], 'terms.txt', { type: 'text/plain' });

  assert.equal(isDraftFolder('Drafts'), true);
  assert.equal(isDraftFolder('[Gmail]/Drafts'), true);
  assert.equal(isDraftFolder('INBOX'), false);
  assert.deepEqual(draftComposeState(draft, [attachmentFile]), {
    from: 'sales@example.test',
    to: 'buyer@example.net',
    cc: 'manager@example.test',
    bcc: 'audit@example.test',
    replyTo: 'support@example.test',
    inReplyTo: '<parent@example.test>',
    references: '<root@example.test> <parent@example.test>',
    subject: 'Quarterly draft',
    body: 'Preserve this body',
    mode: 'plain',
    attachments: [attachmentFile],
    draftId: 'draft-resume-fixture',
    draftUid: '901',
  });
});

test('HTML-only Drafts retain their body format when resumed', () => {
  const { draftComposeState } = loadModule();

  const state = draftComposeState({
    ...draft,
    text: 'Preserve this HTML',
    html: '<p>Preserve <strong>this HTML</strong></p>',
    bodyMode: 'rich',
  }, []);

  assert.equal(state.mode, 'rich');
  assert.equal(state.body, '<p>Preserve <strong>this HTML</strong></p>');
});

test('draft attachments retain their per-file restore path outside Forward bundle limits', async () => {
  const { hydrateDraftAttachments } = loadModule();
  const requests = [];
  const controller = new AbortController();
  const files = await hydrateDraftAttachments(draft, 'Team/Drafts', async (url, options) => {
    requests.push([url, options?.signal]);
    return new Response('hello terms', {
      headers: { 'Content-Type': 'text/plain' },
    });
  }, controller.signal);

  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], '/api/folders/Team%2FDrafts/messages/901/attachments/3?download=1');
  assert.equal(requests[0][1] instanceof AbortSignal, true);
  assert.equal(files[0].name, 'terms.txt');
  assert.equal(files[0].type, 'text/plain');
  assert.equal(await files[0].text(), 'hello terms');

  await assert.rejects(
    hydrateDraftAttachments(draft, 'Drafts', async () => new Response('', { status: 404 })),
    /terms\.txt could not be restored/,
  );
});

test('draft attachment hydration bounds concurrent per-part downloads', async () => {
  const { hydrateDraftAttachments } = loadModule();
  const manyAttachments = Array.from({ length: 11 }, (_, id) => ({
    id,
    filename: `attachment-${id}.txt`,
    contentType: 'text/plain',
    size: 1,
  }));
  let active = 0;
  let maximumActive = 0;
  const files = await hydrateDraftAttachments(
    { ...draft, attachments: manyAttachments },
    'Drafts',
    async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setImmediate(resolve));
      active -= 1;
      return new Response('x', { headers: { 'Content-Type': 'text/plain' } });
    },
  );

  assert.equal(files.length, manyAttachments.length);
  assert.equal(maximumActive, 4);
});

test('draft attachment hydration cancels sibling downloads after a definitive failure', async () => {
  const { hydrateDraftAttachments } = loadModule();
  const attachments = Array.from({ length: 8 }, (_, id) => ({
    id,
    filename: `attachment-${id}.txt`,
    contentType: 'text/plain',
    size: 1,
  }));
  let requests = 0;
  let aborted = 0;

  await assert.rejects(
    hydrateDraftAttachments(
      { ...draft, attachments },
      'Drafts',
      async (_url, options) => {
        const request = requests;
        requests += 1;
        if (request === 0) return new Response('', { status: 500 });
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            aborted += 1;
            reject(new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        });
      },
    ),
    /attachment-0\.txt could not be restored/,
  );

  assert.equal(requests, 4);
  assert.equal(aborted, 3);
});

test('forward preparation hydrates the bounded body and every original file or fails closed', async () => {
  const { hydrateForwardContent } = loadModule();
  const sourceMessage = {
    ...draft,
    uid: 42,
    attachments: [
      {
        id: 1,
        filename: 'quarterly plan.pdf',
        contentType: 'application/pdf',
        size: 12,
      },
      {
        id: 4,
        filename: 'forecast.csv',
        contentType: 'text/csv',
        size: 7,
      },
    ],
  };
  const requests = [];
  const controller = new AbortController();
  const hydration = await hydrateForwardContent(sourceMessage, 'Projects/2026', async (url, options) => {
    requests.push([url, options?.signal]);
    return attachmentBatchResponse([
      {
        filename: 'quarterly plan.pdf',
        contentType: 'application/pdf',
        content: 'pdf contents',
      },
      {
        filename: 'forecast.csv',
        contentType: 'text/csv',
        content: 'a,b\n1,2',
      },
    ]);
  }, controller.signal);

  assert.deepEqual(requests, [
    ['/api/folders/Projects%2F2026/messages/42/attachments', controller.signal],
  ]);
  assert.equal(hydration.message.text, 'Prepared original body');
  assert.equal(hydration.message.subject, 'Authoritative quarterly plan');
  assert.equal(hydration.message.from, 'Authoritative Sender <authoritative@example.test>');
  assert.equal(hydration.message.to, 'Owner <owner@example.test>');
  assert.equal(hydration.message.cc, 'Project Team <team@example.test>');
  assert.equal(hydration.message.date, '2026-08-25T18:30:00.000Z');
  assert.equal(hydration.message.bodyLoaded, true);
  assert.deepEqual(hydration.attachments.map(file => [file.name, file.type]), [
    ['quarterly plan.pdf', 'application/pdf'],
    ['forecast.csv', 'text/csv'],
  ]);
  assert.equal(await hydration.attachments[0].text(), 'pdf contents');
  assert.equal(await hydration.attachments[1].text(), 'a,b\n1,2');

  await assert.rejects(
    hydrateForwardContent(sourceMessage, 'INBOX', async () => attachmentBatchResponse(
      [{ filename: 'quarterly plan.pdf', contentType: 'application/pdf', content: 'pdf contents' }],
      200,
      [
        { filename: 'quarterly plan.pdf', contentType: 'application/pdf', content: 'pdf contents' },
        { filename: 'forecast.csv', contentType: 'text/csv', content: 'a,b\n1,2' },
      ],
    )),
    /Original attachments could not be added to the Forward/,
  );

  await assert.rejects(
    hydrateForwardContent(sourceMessage, 'INBOX', async () => new Response(JSON.stringify({
      success: false,
      code: 'ATTACHMENT_COUNT_LIMIT',
      error: 'Too many attachments to forward',
    }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    })),
    error => error?.code === 'ATTACHMENT_COUNT_LIMIT',
  );

  await assert.rejects(
    hydrateForwardContent(sourceMessage, 'INBOX', async () => new Response(JSON.stringify({
      success: false,
      code: 'ATTACHMENT_TOTAL_SIZE_LIMIT',
      error: 'Attachment data is too large to forward',
    }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    })),
    error => error?.code === 'ATTACHMENT_TOTAL_SIZE_LIMIT',
  );
});

test('forward preparation fetches its bounded body even when summary attachment metadata is empty', async () => {
  const { hydrateForwardContent } = loadModule();
  let requests = 0;
  const hydration = await hydrateForwardContent(
    { ...draft, uid: 77, text: undefined, html: undefined, attachments: [], bodyLoaded: false },
    'INBOX',
    async () => {
      requests += 1;
      return attachmentBatchResponse([]);
    },
  );

  assert.equal(requests, 1);
  assert.equal(hydration.message.text, 'Prepared original body');
  assert.equal(hydration.message.bodyLoaded, true);
  assert.deepEqual(hydration.attachments, []);
});

test('Drafts viewer opens the real composer without reply controls and sends stable draft identity', () => {
  const hook = fs.readFileSync(path.resolve(__dirname, '../src/mail/hooks/useMail.ts'), 'utf8');
  const viewer = fs.readFileSync(path.resolve(__dirname, '../src/mail/MessageViewer.tsx'), 'utf8');
  const cache = fs.readFileSync(path.resolve(__dirname, '../src/mail/message-cache.ts'), 'utf8');
  const row = fs.readFileSync(path.resolve(__dirname, '../src/mail/MessageRow.tsx'), 'utf8');
  const toolbar = fs.readFileSync(path.resolve(__dirname, '../src/mail/MailToolbar.tsx'), 'utf8');

  assert.match(hook, /const resumeDraft = useCallback[\s\S]*hydrateDraftAttachments[\s\S]*draftSaveCoordinatorRef\.current\.reset\([\s\S]*setDraftUid/);
  assert.match(hook, /formData\.append\('draftId',\s*currentDraft\.draftId\)/);
  assert.match(hook, /formData\.append\('draftUid',\s*currentDraft\.draftUid\)/);
  assert.match(hook, /formData\.append\('inReplyTo',\s*composeInReplyTo\)/);
  assert.match(hook, /formData\.append\('references',\s*composeReferences\)/);
  assert.match(hook, /const composeBodyField = composeMode === 'rich' \? 'html' : 'text'/);
  assert.match(hook, /formData\.append\(composeBodyField,\s*composeBody\)/);
  assert.match(hook, /setComposeMode\(state\.mode\)/);
  assert.match(hook, /composePreparationCoordinatorRef/);
  assert.match(hook, /const requestId = composePreparationCoordinatorRef\.current\.begin\(\)[\s\S]*hydrateDraftAttachments[\s\S]*claimComposeIntent\(requestId\)/);
  assert.match(hook, /formData\.append\('subject',\s*subject\)/);
  assert.match(viewer, /Edit draft/);
  assert.match(viewer, /!isScheduled && !isDraft && <InlineReply/);
  assert.match(viewer, /const sendInlineReply = async \(\) => \{[\s\S]*buildMessageComposeDraft\([\s\S]*'reply',[\s\S]*mail\.sendReply\(/);
  assert.match(viewer, /onOpenFullCompose=\{async \(\) => \{[\s\S]*startMessageCompose\('reply', mail\.replyText \|\| ''\)/);
  assert.doesNotMatch(viewer, /onOpenFullCompose=\{async \(\) => \{[\s\S]{0,250}mail\.startCompose/);
  assert.match(row, /isDraft \? \([\s\S]*Delete draft[\s\S]*: !isScheduled &&/);
  assert.match(toolbar, /draftMode \? \([\s\S]*onBulkAction\('delete'\)[\s\S]*Delete/);
  assert.match(cache, /cc:\s*detail\.cc[\s\S]*bcc:\s*detail\.bcc[\s\S]*replyTo:\s*detail\.replyTo[\s\S]*draftId:\s*detail\.draftId/);
});
