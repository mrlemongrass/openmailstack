const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const componentPath = path.resolve(__dirname, '../src/scheduler/WorkflowsPanel.tsx');

const loadTypeScriptModule = (relativePath) => {
  const sourcePath = path.resolve(__dirname, relativePath);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText;
  const testModule = new Module(sourcePath, module);
  testModule.paths = module.paths;
  testModule._compile(compiled, sourcePath);
  return testModule.exports;
};

test('workflow builder presents the complete Phase 3 automation surface', () => {
  const source = fs.readFileSync(componentPath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: componentPath,
  }).outputText;
  const workflowModule = new Module(componentPath, module);
  workflowModule.paths = module.paths;
  workflowModule.require = id => {
    if (id === 'lucide-react') return new Proxy({}, { get: () => props => React.createElement('svg', props) });
    if (id === '../shared/components/ErrorBanner') return { ErrorBanner: ({ error }) => React.createElement('p', null, error) };
    if (id === '../shared/components/EmptyState') return { EmptyState: () => React.createElement('p', null, 'Empty') };
    if (id === '../shared/components/Toast') return { useToast: () => ({ showToast: () => undefined }) };
    if (id === './api') return {};
    return Module.prototype.require.call(workflowModule, id);
  };
  workflowModule._compile(compiled, componentPath);

  const markup = renderToStaticMarkup(React.createElement(workflowModule.exports.WorkflowsPanel, {
    events: [{ id: 'event-1', title: 'Consultation' }],
  }));
  assert.match(markup, /Workflow automation/);
  assert.match(markup, /Create workflow/);
  assert.match(markup, /Delivery operations/);
  assert.match(markup, /Test send/);
  assert.match(source, /Clone/);
  assert.match(source, /Run only when/);
  assert.match(source, /Generate translations/);
  assert.match(source, /Choose provider/);
  assert.match(source, /In-app notifications/);
  assert.match(source, /Mark read/);
  assert.match(source, /Dismiss/);
  assert.match(source, /dismissSchedulerNotification/);
  assert.match(source, /disabled=\{busy \|\| selected\.currentVersion === null\}/);
  assert.match(source, /Publish a version before enabling this workflow\./);
  assert.match(source, /const toggleWorkflow = async[\s\S]*catch \(toggleError\)/);
  assert.match(source, /const archiveWorkflow = async[\s\S]*catch \(archiveError\)/);
  const adminSource = fs.readFileSync(path.resolve(__dirname, '../src/admin/SchedulerDeliveryPanel.tsx'), 'utf8');
  assert.match(adminSource, /Scheduler delivery metrics/);
  assert.match(adminSource, /Before you enable this provider/);
  assert.match(adminSource, /Last tested/);
});

test('public booking transitions mobile guests from a selected slot to the details step', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/scheduler/PublicScheduler.tsx'), 'utf8');
  const { transitionMobileBookingForm } = loadTypeScriptModule('../src/scheduler/public-booking-transition.ts');
  const calls = [];
  const bookingForm = {
    scrollIntoView: options => calls.push(['scroll', options]),
    focus: options => calls.push(['focus', options]),
  };

  assert.match(source, /const bookingFormRef = useRef<HTMLFormElement>\(null\)/);
  assert.match(source, /if \(!selectedStart\) return;[\s\S]*requestAnimationFrame[\s\S]*transitionMobileBookingForm\(bookingFormRef\.current/);
  assert.match(source, /ref=\{bookingFormRef\}[\s\S]*tabIndex=\{-1\}[\s\S]*aria-labelledby="public-booking-details-title"/);

  assert.equal(transitionMobileBookingForm(bookingForm, () => ({ matches: false })), false);
  assert.deepEqual(calls, []);

  assert.equal(transitionMobileBookingForm(bookingForm, query => ({
    matches: query === '(max-width: 680px)',
  })), true);
  assert.deepEqual(calls, [
    ['scroll', { behavior: 'smooth', block: 'start' }],
    ['focus', { preventScroll: true }],
  ]);

  calls.length = 0;
  assert.equal(transitionMobileBookingForm(bookingForm, () => ({ matches: true })), true);
  assert.deepEqual(calls, [
    ['scroll', { behavior: 'auto', block: 'start' }],
    ['focus', { preventScroll: true }],
  ]);
});
