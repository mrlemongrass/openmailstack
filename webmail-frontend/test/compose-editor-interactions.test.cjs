const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
function installTypeScriptLoader() {
  const previous = {
    ts: Module._extensions['.ts'],
    tsx: Module._extensions['.tsx'],
  };
  const compile = (loadedModule, filename) => {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
      fileName: filename,
    }).outputText;
    loadedModule._compile(output, filename);
  };
  Module._extensions['.ts'] = compile;
  Module._extensions['.tsx'] = compile;
  return () => {
    if (previous.ts) Module._extensions['.ts'] = previous.ts;
    else delete Module._extensions['.ts'];
    if (previous.tsx) Module._extensions['.tsx'] = previous.tsx;
    else delete Module._extensions['.tsx'];
  };
}

function click(element, window) {
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

function button(label) {
  return Array.from(document.querySelectorAll('button'))
    .find(element => element.textContent.trim() === label);
}


async function mountComposer(t, overrides = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const previous = {};
  const globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, Event: dom.window.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async () => new Response(JSON.stringify({ success: true, contacts: [], settings: { templates: [] } })),
  };
  for (const [key, value] of Object.entries(globals)) { previous[key] = global[key]; global[key] = value; }
  const restore = installTypeScriptLoader();
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const { ComposeModal } = require('../src/mail/ComposeModal.tsx');
  const { ToastProvider } = require('../src/shared/components/Toast.tsx');
  const root = createRoot(document.getElementById('root'));
  let current;
  function Harness() {
    const [composeBody, setComposeBody] = React.useState('');
    const [composeSignature, setComposeSignature] = React.useState('none');
    const noop = () => {};
    current = { isComposing: true, composeAttachments: [], composeTo: '', composeCc: '', composeBcc: '',
      composeSubject: '', composeFrom: 'owner@example.test', composeIdentities: [], composeIdentityReady: true,
      userIdentitiesReady: true, immediateSendPhase: 'idle', sending: false, composeError: null,
      composeMode: 'plain', signatures: [{ id: 'default', name: 'Default', isDefault: true,
        content: '<p>Regards,</p><p>Alex Example</p><p>Phone: 123<br>Email: alex@example.test</p>' },
        { id: 'short', name: 'Short', content: '<p>Alex</p><p>Example team</p>' }],
      setComposeTo: noop, setComposeCc: noop, setComposeBcc: noop, setComposeSubject: noop,
      closeComposer: async () => true, discardComposer: async () => true,
      composeBody, setComposeBody, composeSignature, setComposeSignature, ...overrides };
    return React.createElement(ToastProvider, null, React.createElement(ComposeModal, { mail: current }));
  }
  t.after(async () => { await React.act(async () => root.unmount()); await new Promise(resolve => setTimeout(resolve, 200)); restore(); dom.window.close(); Object.assign(global, previous); });
  await React.act(async () => { root.render(React.createElement(Harness)); });
  await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  return { act: React.act, dom, mail: () => current };
}

test('default signature retains paragraph and break boundaries in the actual composer', async t => {
  await mountComposer(t);
  assert.equal(document.querySelector('textarea').value.trim(), 'Regards,\nAlex Example\nPhone: 123\nEmail: alex@example.test');
});

test('signature selection replaces the inserted signature and No signature stays selected', async t => {
  const { act, dom, mail } = await mountComposer(t);
  const select = document.querySelector('[aria-label="Signature"]');
  await act(async () => { select.value = 'short'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  assert.equal(document.querySelector('textarea').value.trim(), 'Alex\nExample team');
  await act(async () => { select.value = 'none'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  assert.equal(mail().composeSignature, 'none');
  assert.equal(document.querySelector('textarea').value.trim(), '');
});

test('expand and restore retain the same editable body', async t => {
  const { act, dom } = await mountComposer(t);
  const editor = document.querySelector('textarea');
  const expand = document.querySelector('[aria-label="Expand composer"]');
  assert.ok(expand, 'visible expand control exists');
  await act(async () => click(expand, dom.window));
  assert.equal(document.querySelector('textarea'), editor);
  assert.ok(document.querySelector('[aria-label="Restore composer size"]'));
});

test('close offers keep editing, discard, and save without discarding on cancel', async t => {
  let discarded = 0;
  const { act, dom } = await mountComposer(t, { discardComposer: async () => { discarded++; return true; } });
  await act(async () => click(document.querySelector('[aria-label="Close message composer"]'), dom.window));
  assert.ok(button('Keep editing'));
  assert.ok(button('Discard draft'));
  assert.ok(button('Save & Close'));
  await act(async () => click(button('Keep editing'), dom.window));
  assert.equal(discarded, 0);
});


test('a reopened draft keeps its body and is not given another default signature', async t => {
  await mountComposer(t, { draftUid: '42', composeBody: 'Existing\nmultiline\ndraft' });
  assert.equal(document.querySelector('textarea').value, 'Existing\nmultiline\ndraft');
  assert.equal(document.querySelector('[aria-label="Signature"]').value, 'none');
});

test('discard failure retains editable text and double clicks only start one discard', async t => {
  let rejectDiscard;
  let calls = 0;
  const { act, dom } = await mountComposer(t, {
    discardComposer: () => { calls++; return new Promise((resolve, reject) => { rejectDiscard = reject; }); },
  });
  const body = document.querySelector('textarea').value;
  await act(async () => click(document.querySelector('[aria-label="Close message composer"]'), dom.window));
  const discard = button('Discard draft');
  await act(async () => { click(discard, dom.window); click(discard, dom.window); });
  assert.equal(calls, 1);
  assert.match(document.querySelector('.compose-footer-status').textContent, /Discarding/);
  assert.equal(document.querySelector('textarea').disabled, true);
  await act(async () => rejectDiscard(new Error('Offline. Try again.')));
  assert.equal(document.querySelector('textarea').value, body);
  assert.equal(document.querySelector('textarea').disabled, false);
  assert.match(document.body.textContent, /Offline. Try again./);
});


test('signature conversion preserves blank lines, attributed breaks, and entities without script text', async t => {
  await mountComposer(t, { signatures: [{ id: 'default', name: 'Default', isDefault: true,
    content: '<p>Alex &amp; Team</p><p><br></p><div>Phone<br class="line">Email &#39;test&#39;</div><script>unsafe()</script>' }] });
  assert.equal(document.querySelector('textarea').value.trim(), "Alex & Team\n\nPhone\nEmail 'test'");
});


test('clearing every field of a saved draft still offers discard', async t => {
  const { act, dom } = await mountComposer(t, { draftUid: '42', composeBody: '', signatures: [] });
  await act(async () => click(document.querySelector('[aria-label="Close message composer"]'), dom.window));
  assert.ok(button('Discard draft'));
});

test('attachment reminder stops sending until explicitly confirmed', async t => {
  let sends = 0;
  const { act, dom } = await mountComposer(t, { composeBody: 'Please see the attached document.', signatures: [], handleSend: async () => { sends++; return false; } });
  await act(async () => click(button('Send'), dom.window));
  assert.equal(sends, 0);
  assert.ok(button('Send anyway'));
  await act(async () => click(button('Keep editing'), dom.window));
  assert.equal(sends, 0);
  await act(async () => click(button('Send'), dom.window));
  await act(async () => click(button('Send anyway'), dom.window));
  assert.equal(sends, 1);
});

test('disabled reminders and attached files allow sending without a prompt', async t => {
  let sends = 0;
  const { act, dom } = await mountComposer(t, { composeBody: 'The attachment is enclosed.', signatures: [], mailSettings: { compose: { attachmentReminder: false } }, handleSend: async () => { sends++; return false; } });
  await act(async () => click(button('Send'), dom.window));
  assert.equal(sends, 1);
  assert.equal(button('Send anyway'), undefined);
});

test('rich content conversion escapes plain text and strips active or remote content', async t => {
  await mountComposer(t);
  delete require.cache[require.resolve('dompurify')];
  delete require.cache[require.resolve('../src/mail/compose-content.ts')];
  const { plainToHtml, htmlToPlainText, safeComposeHtml, mentionsAttachment } = require('../src/mail/compose-content.ts');
  const text = 'Hello <team> & friends\n\nSecond paragraph';
  assert.equal(htmlToPlainText(plainToHtml(text)), text);
  const safe = safeComposeHtml('<p><strong>Bold</strong><em>Italic</em><a href="https://example.test">Link</a></p><img src="https://tracker.test/pixel"><script>alert(1)</script><iframe src="https://evil.test"></iframe><a href="javascript:alert(1)">Bad</a>');
  assert.match(safe, /<strong>Bold<\/strong>/);
  assert.match(safe, /href="https:\/\/example.test"/);
  assert.doesNotMatch(safe, /img|script|iframe|tracker|javascript:/);
  assert.equal(mentionsAttachment('Reply', 'Thanks\n> I attached a file'), false);
  assert.equal(mentionsAttachment('Attached report', 'See the report'), true);
});

test('complex HTML drafts keep their original content until simplification is confirmed', async t => {
  const original = '<p>Original layout</p><table><tr><td>Cell</td></tr></table><img src="https://example.test/picture">';
  let writes = 0;
  const { act, dom } = await mountComposer(t, { draftUid: '42', composeMode: 'rich', composeBody: original, signatures: [], setComposeBody: () => { writes++; } });
  assert.equal(writes, 0);
  assert.match(document.body.textContent, /original content is kept/);
  await act(async () => click(button('Simplify and edit'), dom.window));
  assert.equal(writes, 0);
  await act(async () => click(button('Keep original'), dom.window));
  assert.equal(writes, 0);
});
