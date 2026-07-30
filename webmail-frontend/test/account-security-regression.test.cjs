const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('sign-in presents a bounded second-factor step without discarding primary credentials', () => {
  const authGate = read('src/shared/layouts/AuthGate.tsx');
  const authHook = read('src/shared/hooks/useAuth.ts');

  assert.match(authHook, /requiresTwoFactor\?: boolean/);
  assert.match(authHook, /JSON\.stringify\(\{ username: email, password, secondFactor \}\)/);
  assert.match(authGate, /requiresTwoFactor \? secondFactor : undefined/);
  assert.match(authGate, /Authentication or recovery code/);
  assert.match(authGate, /autoComplete="one-time-code"/);
  assert.match(authGate, /Use a different account/);
});

test('account security exposes one-time recovery and per-client app-password controls', () => {
  const controls = read('src/settings/AccountSecurityControls.tsx');
  const settings = read('src/settings/SettingsPanel.tsx');
  const sync = read('src/App.tsx');

  assert.match(settings, /<AccountSecurityControls \/>/);
  assert.match(controls, /They will not be shown again/);
  assert.match(controls, /currentPassword: appCurrentPassword/);
  assert.match(controls, /code: appCode/);
  assert.match(controls, /Copy this password now\. It will not be shown again\./);
  assert.match(sync, /create an app password in Settings → Security/);
});
