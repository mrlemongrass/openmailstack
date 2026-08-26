const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadModule() {
  const sourcePath = path.resolve(__dirname, '../src/mail/compose-preparation-coordinator.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText;
  const loaded = new Module(sourcePath, module);
  loaded.paths = module.paths;
  loaded._compile(compiled, sourcePath);
  return loaded.exports;
}

test('a newer compose intent wins even when an older preparation resolves first', async () => {
  const { createComposePreparationCoordinator } = loadModule();
  const coordinator = createComposePreparationCoordinator();
  const committed = [];
  let releaseReply;
  let releaseForward;

  const prepare = async (name, wait) => {
    const intent = coordinator.begin();
    await wait;
    if (coordinator.claim(intent)) committed.push(name);
  };
  const reply = prepare('reply', new Promise(resolve => { releaseReply = resolve; }));
  const forward = prepare('forward', new Promise(resolve => { releaseForward = resolve; }));

  releaseReply();
  await reply;
  releaseForward();
  await forward;

  assert.deepEqual(committed, ['forward']);
});

test('invalidating a pending intent prevents it from claiming the composer', () => {
  const { createComposePreparationCoordinator } = loadModule();
  const coordinator = createComposePreparationCoordinator();
  const intent = coordinator.begin();

  coordinator.invalidate();

  assert.equal(coordinator.claim(intent), false);
});

test('a new-message intent supersedes delayed draft hydration', () => {
  const { createComposePreparationCoordinator } = loadModule();
  const coordinator = createComposePreparationCoordinator();
  const delayedDraftIntent = coordinator.begin();
  const newMessageIntent = coordinator.begin();

  assert.equal(coordinator.claim(newMessageIntent), true);
  assert.equal(coordinator.claim(delayedDraftIntent), false);
});
