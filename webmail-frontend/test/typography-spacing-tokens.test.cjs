const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const indexCss = fs.readFileSync(
  path.join(__dirname, '../src/index.css'),
  'utf8',
);
const schedulerCss = fs.readFileSync(
  path.join(__dirname, '../src/scheduler/scheduler.css'),
  'utf8',
);

test('shared typography and spacing scales cover controls and page hierarchy', () => {
  assert.match(indexCss, /--font-size-2xs:\s*0\.68rem/);
  assert.match(indexCss, /--font-size-page-title:\s*1\.45rem/);
  assert.match(indexCss, /--control-padding-y:\s*10px/);
  assert.match(indexCss, /--control-padding-x:\s*14px/);
  assert.match(indexCss, /--section-gap:\s*18px/);
});

test('shared chrome consumes typography and spacing tokens', () => {
  assert.match(indexCss, /body\s*\{[\s\S]*font-family:\s*var\(--font-family\)/);
  assert.match(
    indexCss,
    /\.glass-input\s*\{[\s\S]*padding:\s*var\(--control-padding-y\) var\(--control-padding-x\)[\s\S]*font-size:\s*var\(--font-size-base\)/,
  );
  assert.match(
    indexCss,
    /\.btn\s*\{[\s\S]*gap:\s*var\(--space-2\)[\s\S]*font-size:\s*var\(--font-size-base\)/,
  );
  assert.match(
    indexCss,
    /\.settings-page\s*\{[\s\S]*gap:\s*var\(--section-gap\)/,
  );
  assert.match(
    indexCss,
    /\.settings-page-header h2\s*\{[\s\S]*font-size:\s*var\(--font-size-page-title\)/,
  );
});

test('Scheduler consumes the shared scale for its primary hierarchy', () => {
  assert.match(
    schedulerCss,
    /\.scheduler-main\s*\{[\s\S]*padding:\s*var\(--space-6\)/,
  );
  assert.match(
    schedulerCss,
    /\.scheduler-section-title\s*\{[\s\S]*gap:\s*var\(--section-gap\)/,
  );
  assert.match(
    schedulerCss,
    /\.scheduler-section-title h1,[\s\S]*font-size:\s*var\(--font-size-page-title\)/,
  );
  assert.match(
    schedulerCss,
    /\.scheduler-eyebrow\s*\{[\s\S]*font-size:\s*var\(--font-size-xs\)/,
  );
  assert.match(
    schedulerCss,
    /\.scheduler-event-list,[\s\S]*gap:\s*var\(--space-2\)/,
  );
});
