const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../src/mail/attachment-preview.ts');
const loaded = new Module(sourcePath, module);
loaded.paths = module.paths;
loaded._compile(ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, sourcePath);
const { loadAttachmentPreview, MAX_PREVIEW_BYTES, inlineAttachmentPolicy } = loaded.exports;
const signal = () => new AbortController().signal;

const attachment = (size, contentType = 'application/pdf') => ({ id: 1, filename: 'file', contentType, size });

test('inline policy uses the combined supported attachment size, including the exact boundary', () => {
  assert.equal(inlineAttachmentPolicy([attachment(MAX_PREVIEW_BYTES)]), 'inline');
  assert.equal(inlineAttachmentPolicy([attachment(MAX_PREVIEW_BYTES - 1), attachment(1, 'image/png')]), 'inline');
  assert.equal(inlineAttachmentPolicy([attachment(MAX_PREVIEW_BYTES), attachment(1)]), 'too-large');
  assert.equal(inlineAttachmentPolicy(Array(3).fill(attachment(10 * 1024 * 1024))), 'too-large');
  assert.equal(inlineAttachmentPolicy([attachment(100), attachment(MAX_PREVIEW_BYTES * 2, 'application/zip')]), 'inline');
  assert.equal(inlineAttachmentPolicy([attachment(100, 'application/zip')]), 'none');
  assert.equal(inlineAttachmentPolicy([]), 'none');
});

test('unreliable sizes never automatically fetch supported attachments', () => {
  for (const size of [undefined, null, 0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(inlineAttachmentPolicy([attachment(100), attachment(size)]), 'unknown-size');
  }
});

test('inline loads enforce their declared share of the per-message budget', async () => {
  for (const withHeader of [true, false]) {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(101)); },
      cancel() { cancelled = true; },
    });
    await assert.rejects(loadAttachmentPreview('/attachment', 'pdf', signal(), async () =>
      new Response(body, { headers: withHeader ? { 'Content-Length': '101' } : {} }), 100), /larger than expected/);
    assert.equal(cancelled, true);
  }
  const blob = await loadAttachmentPreview('/attachment', 'pdf', signal(), async () => new Response('%PDF-1.7'), 8);
  assert.equal(blob.size, 8);
});

test('preview fetches the exact authenticated attachment and keeps PDF bytes local', async () => {
  let request;
  const blob = await loadAttachmentPreview('/api/folders/School%2FNews/messages/5/attachments/2?download=1', 'pdf', signal(), async (...args) => {
    request = args;
    return new Response('%PDF-1.7\nfixture', { headers: { 'Content-Type': 'application/octet-stream' } });
  });
  assert.equal(request[0], '/api/folders/School%2FNews/messages/5/attachments/2?download=1');
  assert.equal(request[1].cache, 'no-store');
  assert.equal(request[1].credentials, 'same-origin');
  assert.equal(blob.type, 'application/pdf');
  assert.equal(await blob.text(), '%PDF-1.7\nfixture');
});

test('preview rejects HTML disguised by filename or MIME type and cross-kind content', async () => {
  for (const [kind, content] of [['pdf', '<html>not a PDF</html>'], ['image', '<svg onload="alert(1)"></svg>'], ['image', '%PDF-1.7']]) {
    await assert.rejects(loadAttachmentPreview('/attachment', kind, signal(), async () => new Response(content)), /cannot be previewed/);
  }
});

test('preview recognizes image bytes rather than trusting response type', async () => {
  const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  const blob = await loadAttachmentPreview('/attachment', 'image', signal(), async () => new Response(bytes));
  assert.equal(blob.type, 'image/png');
});

test('oversized Content-Length is rejected before reading and cancels the body', async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  await assert.rejects(loadAttachmentPreview('/attachment', 'pdf', signal(), async () =>
    new Response(body, { headers: { 'Content-Length': String(MAX_PREVIEW_BYTES + 1) } })), /too large/);
  assert.equal(cancelled, true);
});

test('streaming size limit also rejects responses without Content-Length', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(MAX_PREVIEW_BYTES + 1)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(loadAttachmentPreview('/attachment', 'pdf', signal(), async () => new Response(body)), /too large/);
  assert.equal(cancelled, true);
});

test('failed and cancelled loads do not produce a preview', async () => {
  await assert.rejects(loadAttachmentPreview('/attachment', 'pdf', signal(), async () => new Response('', { status: 404 })), /could not be loaded/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(loadAttachmentPreview('/attachment', 'pdf', controller.signal, async (_url, options) => {
    options.signal.throwIfAborted(); return new Response('%PDF-1.7');
  }), { name: 'AbortError' });
});
