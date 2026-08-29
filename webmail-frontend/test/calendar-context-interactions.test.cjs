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

function loadManagementDialogs(api) {
  const sourcePath = path.resolve(__dirname, '../src/calendar/CalendarManagementDialogs.tsx');
  const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: sourcePath,
  }).outputText;
  const loaded = new Module(sourcePath, module);
  loaded.paths = module.paths;
  loaded.require = id => {
    if (id === '../shared/api') return api;
    if (id === '../shared/hooks/useModalFocus') return { useModalFocus: () => undefined };
    return Module.prototype.require.call(loaded, id);
  };
  loaded._compile(compiled, sourcePath);
  return loaded.exports;
}

function loadCalendarSidebar({ showToast }) {
  const sourcePath = path.resolve(__dirname, '../src/calendar/CalendarSidebar.tsx');
  const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: sourcePath,
  }).outputText;
  const loaded = new Module(sourcePath, module);
  loaded.paths = module.paths;
  loaded.require = id => {
    if (id === '../shared/components/Toast') return { useToast: () => ({ showToast }) };
    if (id === '../shared/hooks/useSchedulerStatus') return { useSchedulerStatus: () => null };
    if (id === './CalendarManagementDialogs') {
      return { CalendarEditorDialog: () => null, CalendarSharingDialog: () => null };
    }
    return Module.prototype.require.call(loaded, id);
  };
  loaded._compile(compiled, sourcePath);
  return loaded.exports;
}

function button(label, within = document) {
  return Array.from(within.querySelectorAll('button')).find(candidate => candidate.textContent.trim() === label);
}

test('calendar actions enforce access, recurrence confirmation, overflow access, and share errors', async t => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://openmailstack.test/calendar/week',
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
    fetch: global.fetch,
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
    fetch: async () => ({ ok: true, json: async () => ({ contacts: [] }) }),
  });
  const restoreTypeScriptLoader = installTypeScriptLoader();
  const React = require('react');
  const { act } = React;
  const { createRoot } = require('react-dom/client');
  const { CalendarContextMenus } = require('../src/calendar/CalendarContextMenus.tsx');
  const { EventModal } = require('../src/calendar/EventModal.tsx');
  const root = createRoot(document.getElementById('root'));

  t.after(async () => {
    await act(async () => root.unmount());
    restoreTypeScriptLoader();
    dom.window.close();
    Object.assign(global, previousGlobals);
  });

  const ownerCalendar = { id: 1, name: 'Personal', access_role: 'owner', events: [] };
  const writableCalendar = { id: 2, name: 'Projects', access_role: 'owner', events: [] };
  const baseEvent = {
    id: 'event-1',
    calendarId: 1,
    title: 'Project review',
    start: new Date(2026, 7, 29, 11, 0),
    end: new Date(2026, 7, 29, 11, 30),
    isAllDay: false,
  };
  const deleted = [];
  const opened = [];
  const baseCalendarContext = {
    calendarContextMenu: { kind: 'event', point: { x: 20, y: 20 }, event: baseEvent },
    calendars: [ownerCalendar, writableCalendar],
    writableCalendars: [ownerCalendar, writableCalendar],
    calendarSettings: { clockFormat: '12h' },
    displayTimeZone: 'America/Phoenix',
    closeCalendarContextMenu: () => undefined,
    editExistingEvent: event => opened.push(event),
    duplicateEvent: () => undefined,
    deleteEvent: async (...args) => { deleted.push(args); return true; },
  };

  await act(async () => root.render(React.createElement(CalendarContextMenus, { cal: baseCalendarContext })));
  assert.ok(button('Edit event'));
  assert.equal(button('View event'), undefined);
  assert.ok(button('Delete event'));

  await act(async () => button('Delete event').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  assert.equal(deleted.length, 0, 'delete must wait for confirmation');
  const deleteDialog = document.querySelector('[role="dialog"]');
  assert.match(deleteDialog.textContent, /Delete event\?/);
  await act(async () => button('Delete event', deleteDialog).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  assert.deepEqual(deleted, [['event-1', 1, undefined]]);

  const recurringEvent = {
    ...baseEvent,
    id: 'series-1',
    recurrence: 'FREQ=WEEKLY',
    occurrenceId: '20260829T180000Z',
  };
  await act(async () => root.render(React.createElement(CalendarContextMenus, {
    cal: {
      ...baseCalendarContext,
      calendarContextMenu: { kind: 'event', point: { x: 30, y: 30 }, event: recurringEvent },
    },
  })));
  assert.ok(button('Delete this occurrence'));
  assert.ok(button('Delete entire series'));
  await act(async () => button('Delete this occurrence').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  const occurrenceDialog = document.querySelector('[role="dialog"]');
  assert.match(occurrenceDialog.textContent, /Only this occurrence/);
  await act(async () => button('Delete occurrence', occurrenceDialog).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  assert.deepEqual(deleted[1], ['series-1', 1, '20260829T180000Z']);

  const readOnlyEvent = { ...baseEvent, id: 'read-only', calendarId: 3 };
  await act(async () => root.render(React.createElement(CalendarContextMenus, {
    cal: {
      ...baseCalendarContext,
      calendars: [{ id: 3, name: 'Shared', access_role: 'read', events: [] }, writableCalendar],
      writableCalendars: [writableCalendar],
      calendarContextMenu: { kind: 'event', point: { x: 40, y: 40 }, event: readOnlyEvent },
    },
  })));
  assert.ok(button('View event'));
  assert.equal(button('Edit event'), undefined);
  assert.equal(button('Delete event'), undefined);
  await act(async () => button('View event').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  assert.equal(opened.at(-1).id, 'read-only');

  const modalClosed = [];
  const overflowOpened = [];
  const noop = () => undefined;
  await act(async () => root.render(React.createElement(EventModal, {
    cal: {
      isEventModalOpen: true,
      editingEvent: baseEvent,
      newEvent: { ...baseEvent, timeKind: 'zoned', timeZone: 'America/Phoenix' },
      calendars: [ownerCalendar],
      writableCalendars: [ownerCalendar],
      canModifyEditingEvent: true,
      displayNow: baseEvent.start,
      displayTimeZone: 'America/Phoenix',
      calendarSettings: { clockFormat: '12h', defaultEventDurationMinutes: 30 },
      isAdvancedEventMode: false,
      eventSaving: false,
      eventError: null,
      freeBusy: {},
      freeBusyUnavailable: [],
      freeBusyLoading: false,
      setNewEvent: noop,
      setIsEventModalOpen: open => modalClosed.push(open),
      setIsAdvancedEventMode: noop,
      lookupFreeBusy: noop,
      draftWallDateToInstant: date => date,
      saveEvent: async () => true,
      openEventContextMenu: (...args) => overflowOpened.push(args),
    },
  })));
  const moreActions = button('More actions');
  assert.ok(moreActions, 'visible More actions control must render for an existing event');
  moreActions.getBoundingClientRect = () => ({
    x: 10, y: 20, top: 20, right: 110, bottom: 52, left: 10, width: 100, height: 32,
    toJSON: () => ({}),
  });
  await act(async () => {
    moreActions.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise(resolve => dom.window.setTimeout(resolve, 5));
  });
  assert.deepEqual(modalClosed, [false]);
  assert.deepEqual(overflowOpened[0][0], { x: 110, y: 56 });
  assert.equal(overflowOpened[0][1].id, 'event-1');

  let shareLoads = 0;
  const { CalendarSharingDialog } = loadManagementDialogs({
    fetchCalendarShares: async () => {
      shareLoads += 1;
      throw new Error('Permission service offline');
    },
    shareCalendar: async () => undefined,
    unshareCalendar: async () => undefined,
  });
  await act(async () => root.render(React.createElement(CalendarSharingDialog, { calendar: ownerCalendar, onClose: noop })));
  await act(async () => new Promise(resolve => dom.window.setTimeout(resolve, 5)));
  assert.equal(document.querySelector('[role="alert"]').textContent, 'Permission service offline');
  assert.ok(button('Retry'));
  await act(async () => {
    button('Retry').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise(resolve => dom.window.setTimeout(resolve, 5));
  });
  assert.equal(shareLoads, 2);

  const saves = [];
  const { CalendarEditorDialog } = loadManagementDialogs({});
  await act(async () => root.render(React.createElement(CalendarEditorDialog, {
    onSave: async draft => { saves.push(draft); },
    onClose: noop,
  })));
  const nameInput = document.querySelector('input[autocomplete="off"]');
  const valueSetter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    valueSetter.call(nameInput, 'Empty import');
    nameInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  const fileInput = document.querySelector('input[type="file"]');
  Object.defineProperty(fileInput, 'files', {
    configurable: true,
    value: [{ size: 3, text: async () => ' \n ' }],
  });
  await act(async () => fileInput.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
  await act(async () => {
    button('Add calendar').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise(resolve => dom.window.setTimeout(resolve, 5));
  });
  assert.equal(saves.length, 0);
  assert.equal(document.querySelector('[role="alert"]').textContent, 'The selected .ics file is empty.');

  const retryCalls = [];
  const toasts = [];
  const { CalendarSidebar } = loadCalendarSidebar({ showToast: toast => toasts.push(toast) });
  const subscriptionCalendar = {
    id: 9,
    name: 'Team feed',
    color: '#3B82F6',
    access_role: 'owner',
    subscribed_url: 'https://calendar.example.test/feed.ics',
    last_fetched_at: '2026-08-29T20:00:00.000Z',
    last_fetch_error: 'Remote calendar returned HTTP 503',
    events: [],
  };
  const sidebarCalendarContext = {
    calendars: [subscriptionCalendar],
    events: [],
    currentDate: new Date(2026, 7, 29),
    displayNow: new Date(2026, 7, 29),
    isCalendarVisible: () => true,
    toggleCalendarVisibility: noop,
    setCurrentDate: noop,
    openNewEvent: noop,
    showAllCalendarsOverride: false,
    hasCalendarVisibilityOverride: false,
    showAllCalendars: noop,
    showSelectedCalendars: noop,
    showOnlyCalendar: noop,
    hideAllCalendars: noop,
    createCalendar: async () => ({ calendarId: 10 }),
    updateCalendar: async () => undefined,
    removeCalendar: async () => undefined,
    refreshCalendarSubscription: async id => {
      retryCalls.push(id);
      return { success: true, status: 'synced', last_fetched_at: '2026-08-29T21:00:00.000Z' };
    },
  };
  await act(async () => root.render(React.createElement(CalendarSidebar, { cal: sidebarCalendarContext })));
  assert.match(document.querySelector('.calendar-subscription-status').textContent, /Sync failed:.*HTTP 503/);
  assert.ok(button('Retry'), 'failed subscriptions must expose a visible Retry button');
  await act(async () => {
    button('Retry').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await new Promise(resolve => dom.window.setTimeout(resolve, 5));
  });
  assert.deepEqual(retryCalls, [9]);
  assert.deepEqual(toasts.at(-1), { type: 'success', message: 'Team feed is up to date' });

  let finishHealthySync;
  const healthyCalendar = { ...subscriptionCalendar, last_fetch_error: null };
  const healthyCalendarContext = {
    ...sidebarCalendarContext,
    calendars: [healthyCalendar],
    refreshCalendarSubscription: id => {
      retryCalls.push(id);
      return new Promise(resolve => { finishHealthySync = resolve; });
    },
  };
  await act(async () => root.render(React.createElement(CalendarSidebar, { cal: healthyCalendarContext })));
  const healthyRow = document.querySelector('.calendar-list-row');
  await act(async () => healthyRow.dispatchEvent(new dom.window.MouseEvent('contextmenu', {
    bubbles: true,
    clientX: 40,
    clientY: 40,
  })));
  assert.ok(button('Sync subscription now'));
  await act(async () => button('Sync subscription now').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
  assert.equal(document.querySelector('.calendar-subscription-status').textContent, 'Syncing…');
  assert.equal(document.querySelector('.calendar-subscription-status').getAttribute('aria-live'), 'polite');
  await act(async () => {
    finishHealthySync({ success: true, status: 'synced', last_fetched_at: '2026-08-29T21:00:00.000Z' });
    await new Promise(resolve => dom.window.setTimeout(resolve, 5));
  });
  assert.deepEqual(retryCalls, [9, 9]);
  assert.deepEqual(toasts.at(-1), { type: 'success', message: 'Team feed is up to date' });
});
