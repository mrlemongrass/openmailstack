const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const routesSource = fs.readFileSync(
  path.join(__dirname, '../src/scheduler/routes.tsx'),
  'utf8',
);
const schedulerCss = fs.readFileSync(
  path.join(__dirname, '../src/scheduler/scheduler.css'),
  'utf8',
);

test('mobile event editor exposes every settings section without horizontal discovery', () => {
  assert.match(routesSource, /className="scheduler-editor-tabs"/);
  assert.match(routesSource, /className="scheduler-editor-mobile-navigation mobile-section-navigation"/);
  assert.match(routesSource, /select aria-label="Event type settings"/);
  assert.match(routesSource, /SCHEDULER_EDITOR_SECTIONS\.map\(item => <option key=\{item\.id\} value=\{item\.id\}>\{item\.label\}<\/option>\)/);
  assert.match(schedulerCss, /\.scheduler-editor-mobile-navigation\s*\{\s*display:\s*none/);
  assert.match(
    schedulerCss,
    /@media \(max-width: 767px\)[\s\S]*\.scheduler-editor-tabs\s*\{\s*display:\s*none[\s\S]*\.scheduler-editor-mobile-navigation\s*\{[\s\S]*display:\s*grid/,
  );
});

test('event editor drafts require an intentional dismissal action', () => {
  assert.match(routesSource, /aria-label="Close event type editor"/);
  assert.doesNotMatch(routesSource, /className="scheduler-modal-backdrop" onMouseDown=\{onClose\}/);
  assert.doesNotMatch(routesSource, /onMouseDown=\{eventMouse => eventMouse\.stopPropagation\(\)\}/);
});

test('deleted event types disappear from owner booking-link surfaces', () => {
  assert.match(routesSource, /const activeEvents = state\.events\.filter\(event => event\.active\);/);
  assert.match(routesSource, /activeEvents\.length.*booking/);
  assert.match(routesSource, /activeEvents\.map\(event => <article/);
  assert.match(routesSource, /<WorkflowsPanel events=\{activeEvents\}/);
});
