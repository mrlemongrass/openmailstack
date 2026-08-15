const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const componentPath = path.resolve(__dirname, '../src/calendar/EventModal.tsx');

function renderEventModal() {
  const source = fs.readFileSync(componentPath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: componentPath,
  }).outputText;
  const componentModule = new Module(componentPath, module);
  componentModule.paths = module.paths;
  componentModule.require = id => {
    if (id === 'lucide-react') {
      return new Proxy({}, {
        get: () => props => React.createElement('svg', props),
      });
    }
    if (id === '../shared/components/Toast') {
      return { useToast: () => ({ showToast: () => undefined }) };
    }
    if (id === '../shared/api') {
      return { fetchContacts: async () => ({ contacts: [] }) };
    }
    if (id === '../shared/contactSuggestions') {
      const helperPath = path.resolve(__dirname, '../src/shared/contactSuggestions.ts');
      const helperSource = fs.readFileSync(helperPath, 'utf8');
      const helperCompiled = ts.transpileModule(helperSource, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        fileName: helperPath,
      }).outputText;
      const helperModule = new Module(helperPath, module);
      helperModule.paths = module.paths;
      helperModule._compile(helperCompiled, helperPath);
      return helperModule.exports;
    }
    if (id === './calendarTime') {
      return {
        addWallDays: (date, days) => new Date(date.getTime() + days * 86400000),
        convertWallDateTimeZone: date => date,
        recurrenceChoice: () => 'none',
        recurrenceSummary: () => null,
        supportedTimeZones: () => [],
        wallDateToInstant: date => date,
      };
    }
    if (id === './freeBusy') {
      return { freeBusyStatusForUser: () => 'unavailable' };
    }
    if (id === '../shared/hooks/useModalFocus') {
      return { useModalFocus: () => undefined };
    }
    return Module.prototype.require.call(componentModule, id);
  };
  componentModule._compile(compiled, componentPath);

  const noop = () => undefined;
  const start = new Date(2026, 6, 29);
  return renderToStaticMarkup(React.createElement(componentModule.exports.EventModal, {
    cal: {
      isEventModalOpen: true,
      editingEvent: null,
      newEvent: {
        title: '',
        start,
        end: new Date(2026, 6, 30),
        isAllDay: true,
        timeKind: 'all-day',
        calendarId: 1,
      },
      calendars: [{ id: 1, name: 'Personal' }],
      displayNow: start,
      displayTimeZone: 'America/Phoenix',
      calendarSettings: { defaultEventDurationMinutes: 30 },
      isAdvancedEventMode: false,
      eventSaving: false,
      eventError: null,
      freeBusy: {},
      freeBusyUnavailable: [],
      freeBusyLoading: false,
      setNewEvent: noop,
      setIsEventModalOpen: noop,
      setIsAdvancedEventMode: noop,
      lookupFreeBusy: noop,
      draftWallDateToInstant: date => date,
      saveEvent: async () => true,
      deleteEvent: async () => undefined,
    },
  }));
}

test('event creation is an explicit, labelled modal workflow', () => {
  const markup = renderEventModal();
  const source = fs.readFileSync(componentPath, 'utf8');

  assert.match(markup, /class="glass-panel event-dialog"[^>]*role="dialog"/);
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /aria-labelledby="event-dialog-title"/);
  assert.match(markup, /id="event-dialog-title"[^>]*>New Event/);
  assert.match(markup, /aria-label="Close event editor"/);
  assert.match(markup, /aria-label="Event date"/);
  assert.match(markup, /aria-label="Calendar"/);
  assert.match(markup, /aria-label="Add guest"/);
  assert.match(markup, /class="event-dialog-footer"/);
  assert.match(source, /aria-label=\{`Remove guest \$\{g\}`\}/);
  assert.match(source, /aria-label=\{`Remove attachment \$\{f\.name\}`\}/);
});

test('mobile event creation uses an opaque full-screen sheet', () => {
  const css = fs.readFileSync(
    path.resolve(__dirname, '../src/index.css'),
    'utf8',
  );

  assert.match(css, /\.event-dialog\s*\{[\s\S]*background:\s*var\(--surface-color\)/);
  assert.match(
    css,
    /@media \(max-width: 767px\)[\s\S]*\.event-modal-overlay\s*\{[\s\S]*padding:\s*0[\s\S]*\.event-dialog\s*\{[\s\S]*width:\s*100%[\s\S]*height:\s*100dvh[\s\S]*max-height:\s*none[\s\S]*border-radius:\s*0/,
  );
});

test('removing the final guest persists an empty attendee list', () => {
  const source = fs.readFileSync(componentPath, 'utf8');

  assert.match(
    source,
    /const handleRemoveGuest[\s\S]*setNewEvent\(\(previous\) => \(\{ \.\.\.previous, guests: nextGuests \}\)\)[\s\S]*lookupFreeBusy\(nextGuests/,
  );
  assert.match(source, /onClick=\{\(\) => handleRemoveGuest\(g\)\}/);
});
