const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { installedVersionCandidates } = require('../src/version-info.js');

test('default VERSION candidates distinguish packaged runtime from repository development', () => {
  assert.deepEqual(
    installedVersionCandidates('/opt/openmailstack-backend/src', ''),
    ['/opt/openmailstack-backend/VERSION'],
  );
  assert.deepEqual(
    installedVersionCandidates('/srv/openmailstack/webmail-backend/src', ''),
    [
      '/srv/openmailstack/webmail-backend/VERSION',
      '/srv/openmailstack/VERSION',
    ],
  );
  assert.deepEqual(
    installedVersionCandidates('/opt/openmailstack-backend/src', './release/VERSION'),
    [path.resolve('./release/VERSION')],
  );
});
