const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('modern Updates panel presents installed version and manual policy only', () => {
  const api = read('src/admin/adminSettingsApi.ts');
  const panel = read('src/admin/UpdatesPanel.tsx');

  assert.match(api, /update_policy:\s*\{\s*mode: 'manual';\s*message: string;\s*\}/);
  assert.doesNotMatch(api, /latest_version|has_update/);
  assert.match(panel, /Installed OpenMailStack version/);
  assert.match(panel, /Manual update policy/);
  assert.match(panel, /does not check for or install releases/);
  assert.doesNotMatch(panel, /Update available|latest version|Check Again|Checking for updates/i);
});
