const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const { JSDOM } = require('jsdom');

function installTypeScriptLoader() {
  const previous = { ts: Module._extensions['.ts'], tsx: Module._extensions['.tsx'] };
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

test('day calendar uses roving focus while keeping mouse and keyboard context actions', async t => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://openmailstack.test/calendar/day',
  });
  const previousGlobals = {
    window: global.window,
    document: global.document,
    navigator: global.navigator,
    HTMLElement: global.HTMLElement,
    Node: global.Node,
    Event: global.Event,
    KeyboardEvent: global.KeyboardEvent,
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
    KeyboardEvent: dom.window.KeyboardEvent,
    MouseEvent: dom.window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const restoreTypeScriptLoader = installTypeScriptLoader();
  const React = require('react');
  const { act } = React;
  const { createRoot } = require('react-dom/client');
  const { DayView } = require('../src/calendar/views/DayView.tsx');
  const root = createRoot(document.getElementById('root'));
  const openedSlots = [];
  const createdSlots = [];
  const currentDate = new Date(2026, 7, 29, 0, 0, 0);

  const cal = {
    currentDate,
    displayNow: new Date(2026, 7, 29, 10, 15, 0),
    events: [],
    calendars: [],
    calendarSettings: { clockFormat: '12h' },
    isCalendarVisible: () => true,
    openNewEvent: start => createdSlots.push(start),
    editExistingEvent: () => undefined,
    openEventContextMenu: () => undefined,
    openSlotContextMenu: (point, start, isAllDay = false) => openedSlots.push({ point, start, isAllDay }),
  };

  t.after(async () => {
    await act(async () => root.unmount());
    restoreTypeScriptLoader();
    dom.window.close();
    Object.assign(global, previousGlobals);
  });

  await act(async () => root.render(React.createElement(DayView, { cal })));
  const hourSlots = Array.from(document.querySelectorAll('[aria-label^="Create an event at"]'));
  assert.equal(hourSlots.length, 24);
  assert.equal(hourSlots.filter(slot => slot.tabIndex === 0).length, 1);
  assert.equal(hourSlots[10].tabIndex, 0);

  hourSlots[10].focus();
  await act(async () => hourSlots[10].dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: 'ArrowDown',
    bubbles: true,
  })));
  assert.equal(document.activeElement, hourSlots[11]);
  assert.equal(hourSlots[10].tabIndex, -1);
  assert.equal(hourSlots[11].tabIndex, 0);

  hourSlots[11].getBoundingClientRect = () => ({
    x: 0,
    y: 100,
    top: 100,
    right: 200,
    bottom: 156,
    left: 0,
    width: 200,
    height: 56,
    toJSON: () => ({}),
  });

  await act(async () => hourSlots[11].dispatchEvent(new dom.window.MouseEvent('click', {
    bubbles: true,
    clientX: 24,
    clientY: 142,
  })));
  assert.equal(createdSlots.length, 1);
  assert.equal(createdSlots[0].getHours(), 11);
  assert.equal(createdSlots[0].getMinutes(), 45);

  await act(async () => hourSlots[11].dispatchEvent(new dom.window.MouseEvent('contextmenu', {
    bubbles: true,
    clientX: 24,
    clientY: 142,
  })));
  assert.equal(openedSlots.length, 1);
  assert.deepEqual(openedSlots[0].point, { x: 24, y: 142 });
  assert.equal(openedSlots[0].start.getHours(), 11);
  assert.equal(openedSlots[0].start.getMinutes(), 45);
  assert.equal(openedSlots[0].isAllDay, false);
});
