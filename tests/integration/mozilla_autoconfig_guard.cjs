const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const indexSource = read('webmail-backend/src/index.ts');
assert.match(indexSource, /createMozillaAutoconfigRouter/);
assert.match(indexSource, /domain:\s*serverConfig\.defaultDomain/);

const installer = read('functions/10_webmail.sh');
assert.match(installer, /location = \/mail\/config-v1\.1\.xml/);
assert.match(installer, /location = \/\.well-known\/autoconfig\/mail\/config-v1\.1\.xml/);

const provisionedHosts = execFileSync('bash', ['-c', [
  'source functions/lib_scheduler.sh',
  'FIRST_DOMAIN=example.test',
  'MAIL_HOSTNAME=mail.example.test',
  'ENABLE_OMS_SCHEDULER=false',
  'openmailstack_scheduler_hosts',
].join('; ')], { cwd: root, encoding: 'utf8' }).trim().split('\n');
assert.deepEqual(provisionedHosts, ['mail.example.test', 'autoconfig.example.test']);

const schedulerHosts = execFileSync('bash', ['-c', [
  'source functions/lib_scheduler.sh',
  'FIRST_DOMAIN=example.test',
  'MAIL_HOSTNAME=mail.example.test',
  'ENABLE_OMS_SCHEDULER=true',
  'OMS_SCHEDULER_HOST_ALIASES=mail.example.test,webmail.example.test',
  'openmailstack_scheduler_hosts',
].join('; ')], { cwd: root, encoding: 'utf8' }).trim().split('\n');
assert.deepEqual(schedulerHosts, [
  'mail.example.test',
  'autoconfig.example.test',
  'webmail.example.test',
]);

const stagingSmoke = read('tests/integration/staging_smoke.sh');
assert.match(stagingSmoke, /Mozilla autoconfiguration advertises secure mail settings/);
assert.match(stagingSmoke, /<username>%EMAILADDRESS%<\/username>/);

console.log('[pass] Mozilla autoconfiguration application, installer, TLS host, and smoke guards');
