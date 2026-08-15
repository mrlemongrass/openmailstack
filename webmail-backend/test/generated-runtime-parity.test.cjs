const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

function discoverRuntimeJavaScript(backendDir) {
  const sourceDir = path.join(backendDir, 'src');
  const rootResult = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: backendDir,
    encoding: 'utf8',
  });
  assert.equal(rootResult.status, 0, rootResult.stderr || rootResult.stdout);
  const projectDir = rootResult.stdout.trim();
  const sourcePrefix = path.relative(projectDir, sourceDir).split(path.sep).join('/');
  const listed = spawnSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', sourcePrefix],
    { cwd: projectDir, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
  );
  assert.equal(listed.status, 0, listed.stderr || listed.stdout);

  const repositoryFiles = new Set(listed.stdout.split('\0').filter(Boolean));
  const sourceModules = [...repositoryFiles]
    .filter(file => file.startsWith(`${sourcePrefix}/`) && file.endsWith('.ts') && !file.endsWith('.d.ts'))
    .sort();
  assert.ok(sourceModules.length > 0, `no TypeScript source modules found under ${sourcePrefix}`);

  return sourceModules.map(sourceModule => {
    const runtimeModule = `${sourceModule.slice(0, -3)}.js`;
    const relativeSource = sourceModule.slice(sourcePrefix.length + 1);
    assert.ok(
      repositoryFiles.has(runtimeModule),
      `${relativeSource} has no checked-in runtime JavaScript sibling`,
    );
    return runtimeModule.slice(sourcePrefix.length + 1);
  });
}

test('runtime parity discovery is recursive and requires every source module runtime', (t) => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oms-runtime-discovery-'));
  const backendDir = path.join(projectDir, 'webmail-backend');
  const sourceDir = path.join(backendDir, 'src');
  t.after(() => fs.rmSync(projectDir, { recursive: true, force: true }));

  fs.mkdirSync(path.join(sourceDir, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'tracked.ts'), 'export const tracked = true;\n');
  fs.writeFileSync(path.join(sourceDir, 'tracked.js'), '"use strict";\n');
  fs.writeFileSync(path.join(sourceDir, 'nested', 'new-module.ts'), 'export const added = true;\n');
  fs.writeFileSync(path.join(sourceDir, 'nested', 'new-module.js'), '"use strict";\n');
  fs.writeFileSync(path.join(sourceDir, 'types.d.ts'), 'export declare const ignored: boolean;\n');

  const initialized = spawnSync('git', ['init', '--quiet'], { cwd: projectDir, encoding: 'utf8' });
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  const indexed = spawnSync('git', ['add', 'webmail-backend/src/tracked.ts', 'webmail-backend/src/tracked.js'], {
    cwd: projectDir,
    encoding: 'utf8',
  });
  assert.equal(indexed.status, 0, indexed.stderr || indexed.stdout);

  assert.deepEqual(discoverRuntimeJavaScript(backendDir), [
    'nested/new-module.js',
    'tracked.js',
  ]);

  fs.rmSync(path.join(sourceDir, 'nested', 'new-module.js'));
  assert.throws(
    () => discoverRuntimeJavaScript(backendDir),
    /nested\/new-module\.ts has no checked-in runtime JavaScript sibling/,
  );
});

test('checked-in runtime JavaScript matches a clean TypeScript build', (t) => {
  const backendDir = path.join(__dirname, '..');
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oms-runtime-parity-'));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));

  const runtimeFiles = discoverRuntimeJavaScript(backendDir);

  const compiler = path.join(backendDir, 'node_modules', 'typescript', 'bin', 'tsc');
  const result = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.json', '--outDir', outputDir], {
    cwd: backendDir,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  for (const file of runtimeFiles) {
    const checkedIn = fs.readFileSync(path.join(backendDir, 'src', file), 'utf8');
    const rebuilt = fs.readFileSync(path.join(outputDir, file), 'utf8');
    assert.equal(checkedIn, rebuilt, `${file} is stale; run npm run build in webmail-backend`);
  }
});
