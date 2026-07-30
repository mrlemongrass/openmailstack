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
const indexCss = fs.readFileSync(
  path.join(__dirname, '../src/index.css'),
  'utf8',
);

test('mobile Scheduler exposes every owner section without horizontal discovery', () => {
  assert.match(routesSource, /className="scheduler-desktop-navigation"/);
  assert.match(routesSource, /className="scheduler-mobile-navigation mobile-section-navigation"/);
  assert.match(routesSource, /aria-label="Scheduler section"/);
  assert.match(routesSource, /<option key=\{item\.id\} value=\{item\.id\}>\{item\.label\}<\/option>/);
  assert.match(schedulerCss, /\.scheduler-mobile-navigation\s*\{[\s\S]*display:\s*none/);
  assert.match(
    schedulerCss,
    /@media \(max-width: 767px\)[\s\S]*\.scheduler-sidebar \.scheduler-desktop-navigation\s*\{[\s\S]*display:\s*none[\s\S]*\.scheduler-mobile-navigation\s*\{[\s\S]*display:\s*grid/,
  );
  assert.match(indexCss, /\.mobile-section-navigation select\s*\{[\s\S]*background:\s*var\(--surface-color\)/);
});

test('mobile Scheduler public actions stack without cramped wrapping', () => {
  assert.match(
    schedulerCss,
    /\.scheduler-public-actions\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*1fr;\s*\}/,
  );
});

test('Scheduler keeps owner-form drafts mounted while switching sections', () => {
  assert.match(routesSource, /const \[visitedTabs, setVisitedTabs\]/);
  assert.match(routesSource, /const selectTab = \(nextTab: SchedulerTab\)/);
  assert.match(routesSource, /visitedTabs\.has\('availability'\)[\s\S]*hidden=\{tab !== 'availability'\}/);
  assert.match(routesSource, /visitedTabs\.has\('workflows'\)[\s\S]*hidden=\{tab !== 'workflows'\}/);
  assert.match(routesSource, /visitedTabs\.has\('tools'\)[\s\S]*hidden=\{tab !== 'tools'\}/);
});
