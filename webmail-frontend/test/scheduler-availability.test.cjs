const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const panelSource = fs.readFileSync(
  path.join(__dirname, '../src/scheduler/AvailabilityPanel.tsx'),
  'utf8',
);
const schedulerCss = fs.readFileSync(
  path.join(__dirname, '../src/scheduler/scheduler.css'),
  'utf8',
);

test('availability prevents invalid schedules and reports save state accessibly', () => {
  assert.match(panelSource, /validateAvailabilityDraft/);
  assert.match(panelSource, /Availability windows cannot overlap/);
  assert.match(panelSource, /role="alert"/);
  assert.match(panelSource, /aria-live="polite"/);
  assert.match(panelSource, /disabled=\{!isDirty \|\| isSaving \|\| validationMessages\.length > 0\}/);
});

test('date override time controls have descriptive labels', () => {
  assert.match(panelSource, /aria-label=\{`Selected date start \$\{index \+ 1\}`\}/);
  assert.match(panelSource, /aria-label=\{`Selected date end \$\{index \+ 1\}`\}/);
});

test('mobile availability publish prompt gives copy and action full width', () => {
  assert.match(
    schedulerCss,
    /@media \(max-width: 767px\)[\s\S]*\.availability-callout\s*\{[\s\S]*grid-template-columns:\s*20px minmax\(0, 1fr\)[\s\S]*\.availability-callout \.btn\s*\{[\s\S]*grid-column:\s*1 \/ -1/,
  );
});
