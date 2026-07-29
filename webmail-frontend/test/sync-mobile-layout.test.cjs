const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appSource = fs.readFileSync(
  path.join(__dirname, '../src/App.tsx'),
  'utf8',
);
const indexCss = fs.readFileSync(
  path.join(__dirname, '../src/index.css'),
  'utf8',
);

test('mobile Sync keeps endpoint text clear of distinct copy actions', () => {
  assert.match(appSource, /className="sync-view"/);
  assert.match(appSource, /className="glass-panel sync-panel"/);
  assert.match(appSource, /className="sync-header"/);
  assert.match(appSource, /className="sync-row"/);
  assert.match(appSource, /className="sync-row-host"/);
  assert.match(appSource, /className="btn btn-ghost sync-row-copy"/);
  assert.match(appSource, /aria-label=\{`Copy \$\{label\}`\}/);
  assert.match(indexCss, /\.sync-row-host\s*\{[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(
    indexCss,
    /@media \(max-width: 767px\)[\s\S]*\.sync-view\s*\{[\s\S]*padding:\s*12px[\s\S]*\.sync-panel\s*\{[\s\S]*padding:\s*20px 16px/,
  );
  assert.match(
    indexCss,
    /@media \(max-width: 767px\)[\s\S]*\.sync-header\s*\{[\s\S]*flex-wrap:\s*wrap/,
  );
});
