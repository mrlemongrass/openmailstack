const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

const frontendPackage = readJson('webmail-frontend/package.json');
const frontendLock = readJson('webmail-frontend/package-lock.json');
const backendLock = readJson('webmail-backend/package-lock.json');

const versionAt = (lock, name) => {
  const entry = lock.packages[`node_modules/${name}`];
  assert.ok(entry?.version, `${name} is missing from the package lock`);
  return entry.version;
};

const versionParts = version => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  assert.ok(match, `expected a stable semantic version, received ${version}`);
  return match.slice(1).map(Number);
};
const versionAtLeast = (actual, minimum) => {
  const actualParts = versionParts(actual);
  const minimumParts = versionParts(minimum);
  for (let index = 0; index < Math.max(actualParts.length, minimumParts.length); index += 1) {
    const left = actualParts[index] || 0;
    const right = minimumParts[index] || 0;
    if (left !== right) return left > right;
  }
  return true;
};

const requireMinimum = (lock, name, minimum, advisory) => {
  const actual = versionAt(lock, name);
  assert.ok(
    versionAtLeast(actual, minimum),
    `${name}@${actual} is below ${minimum}, the patched floor for ${advisory}`,
  );
};

requireMinimum(frontendLock, 'dompurify', '3.4.12', 'GHSA-c2j3-45gr-mqc4');
requireMinimum(frontendLock, 'socket.io-parser', '4.2.7', 'GHSA-2m8v-j782-fhvr');
requireMinimum(frontendLock, 'brace-expansion', '5.0.9', 'GHSA-rgw5-rvv9-x895');
requireMinimum(frontendLock, 'postcss', '8.5.23', 'GHSA-fxqj-rqcc-2cmp');
requireMinimum(backendLock, 'ip-address', '10.3.1', 'GHSA-mwp4-54f8-5fhr');
requireMinimum(backendLock, 'linkify-it', '5.0.2', 'GHSA-v245-v573-v5vm');
requireMinimum(backendLock, 'mailparser', '3.9.13', 'GHSA-v245-v573-v5vm');
requireMinimum(backendLock, 'socket.io-parser', '4.2.7', 'GHSA-2m8v-j782-fhvr');

const routerVersion = versionAt(frontendLock, 'react-router');
assert.equal(
  frontendPackage.dependencies['react-router'],
  routerVersion,
  'React Router must remain exactly pinned so Node compatibility does not drift during installs',
);

if (!versionAtLeast(routerVersion, '8.3.0')) {
  const sourceRoot = path.join(root, 'webmail-frontend/src');
  const sourceFiles = [];
  const collectSource = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) collectSource(absolute);
      else if (/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) sourceFiles.push(absolute);
    }
  };
  collectSource(sourceRoot);
  const buildFiles = [
    'webmail-frontend/index.html',
    'webmail-frontend/package.json',
    'webmail-frontend/eslint.config.js',
    'webmail-frontend/vite.config.ts',
    'webmail-frontend/tsconfig.app.json',
    'webmail-frontend/tsconfig.json',
    'webmail-frontend/tsconfig.node.json',
  ].map(file => path.join(root, file));
  const applicationDefinition = [...sourceFiles, ...buildFiles]
    .map(file => fs.readFileSync(file, 'utf8'))
    .join('\n');

  const rscPackages = Object.keys(frontendLock.packages).filter(packagePath => (
    /node_modules\/(?:react-server-dom-[^/]+|@react-router\/(?:dev|node))$/.test(packagePath)
  ));
  assert.deepEqual(rscPackages, [], 'RSC server/runtime packages make the React Router advisory reachable');

  assert.doesNotMatch(applicationDefinition, /unstable_(?:match|route)RSCServerRequest/);
  assert.doesNotMatch(applicationDefinition, /unstable_RSC[A-Za-z]+/);
  assert.doesNotMatch(applicationDefinition, /react-router\/internal\/react-server-client/);
  assert.doesNotMatch(applicationDefinition, /react-server-dom-/);
  assert.doesNotMatch(applicationDefinition, /@react-router\/(?:dev|node)/);
  assert.doesNotMatch(applicationDefinition, /rsc-action-id/i);
}

console.log('[pass] Production dependency patched floors and React Router RSC reachability guard');
