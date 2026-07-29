const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const routesSource = fs.readFileSync(
  path.join(__dirname, '../src/settings/routes.tsx'),
  'utf8',
);
const panelSource = fs.readFileSync(
  path.join(__dirname, '../src/settings/SettingsPanel.tsx'),
  'utf8',
);
const navigationSource = fs.readFileSync(
  path.join(__dirname, '../src/settings/settingsNavigation.ts'),
  'utf8',
);
const indexCss = fs.readFileSync(
  path.join(__dirname, '../src/index.css'),
  'utf8',
);

test('mobile Settings replaces the fixed sidebar with a complete section picker', () => {
  assert.match(navigationSource, /export const settingsNavGroups/);
  assert.match(panelSource, /import \{ settingsNavGroups \} from '\.\/settingsNavigation'/);
  assert.match(routesSource, /className="settings-desktop-navigation"/);
  assert.match(routesSource, /className="settings-mobile-navigation"/);
  assert.match(routesSource, /aria-label="Settings section"/);
  assert.match(routesSource, /<optgroup key=\{group\.title\} label=\{group\.title\}>/);
  assert.match(
    indexCss,
    /@media \(max-width: 767px\)[\s\S]*\.settings-desktop-navigation\s*\{[\s\S]*display:\s*none[\s\S]*\.settings-mobile-navigation\s*\{[\s\S]*display:\s*grid/,
  );
  assert.match(indexCss, /\.settings-layout-content\s*\{[\s\S]*min-width:\s*0/);
});
