const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
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

test('inline reply locks every send path while message preparation is pending', async t => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://openmailstack.test/mail/INBOX/42',
  });
  const previousGlobals = {
    window: global.window,
    document: global.document,
    navigator: global.navigator,
    HTMLElement: global.HTMLElement,
    Node: global.Node,
    Event: global.Event,
    MouseEvent: global.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT,
  };
  Object.assign(global, {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    MouseEvent: dom.window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const restoreTypeScriptLoader = installTypeScriptLoader();
  const React = require('react');
  const { act } = React;
  const { createRoot } = require('react-dom/client');
  const { InlineReply } = require('../src/mail/components/InlineReply.tsx');
  const root = createRoot(document.getElementById('root'));
  let finishSend;
  let sendCalls = 0;
  let openFullEditorCalls = 0;
  const deferredSend = () => {
    sendCalls += 1;
    return new Promise(resolve => { finishSend = resolve; });
  };

  t.after(async () => {
    await act(async () => root.unmount());
    restoreTypeScriptLoader();
    dom.window.close();
    Object.assign(global, previousGlobals);
  });

  await act(async () => {
    root.render(React.createElement(InlineReply, {
      replyTo: 'sender@example.com',
      replyText: 'A prepared reply',
      replySending: false,
      onReplyTextChange: () => undefined,
      onSend: deferredSend,
      onSendAndArchive: deferredSend,
      onOpenFullCompose: () => { openFullEditorCalls += 1; },
    }));
  });

  const send = button('Send');
  const sendAndArchive = button('Send & Archive');
  const openFullEditor = button('Open full editor');
  await act(async () => {
    click(send, dom.window);
    click(send, dom.window);
    click(sendAndArchive, dom.window);
    click(openFullEditor, dom.window);
  });

  assert.equal(sendCalls, 1, 'only the first synchronous action starts');
  assert.equal(openFullEditorCalls, 0, 'full-editor handoff cannot race a pending send');
  assert.equal(button('Preparing...'), send);
  assert.equal(send.disabled, true);
  assert.equal(sendAndArchive.disabled, true);
  assert.equal(openFullEditor.disabled, true);

  await act(async () => finishSend());
  assert.equal(button('Send'), send);
  assert.equal(send.disabled, false);
  assert.equal(sendAndArchive.disabled, false);
  assert.equal(openFullEditor.disabled, false);
});
