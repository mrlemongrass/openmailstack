const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('checked-in Notes runtime JavaScript matches a clean TypeScript build', (t) => {
  const backendDir = path.join(__dirname, '..');
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oms-notes-runtime-'));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));

  const compiler = path.join(backendDir, 'node_modules', 'typescript', 'bin', 'tsc');
  const result = spawnSync(process.execPath, [compiler, '-p', 'tsconfig.json', '--outDir', outputDir], {
    cwd: backendDir,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  for (const file of ['imap.js', 'notes-imap-sync.js', 'notes-utils.js']) {
    const checkedIn = fs.readFileSync(path.join(backendDir, 'src', file), 'utf8');
    const rebuilt = fs.readFileSync(path.join(outputDir, file), 'utf8');
    assert.equal(checkedIn, rebuilt, `${file} is stale; run npm run build in webmail-backend`);
  }
});
