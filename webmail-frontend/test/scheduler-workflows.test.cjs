const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const componentPath = path.resolve(__dirname, '../src/scheduler/WorkflowsPanel.tsx');

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
  assert.match(source, /const toggleWorkflow = async[\s\S]*catch \(toggleError\)/);
  assert.match(source, /const archiveWorkflow = async[\s\S]*catch \(archiveError\)/);
  const adminSource = fs.readFileSync(path.resolve(__dirname, '../src/admin/SchedulerDeliveryPanel.tsx'), 'utf8');
  assert.match(adminSource, /Scheduler delivery metrics/);
  assert.match(adminSource, /Before you enable this provider/);
  assert.match(adminSource, /Last tested/);
});
