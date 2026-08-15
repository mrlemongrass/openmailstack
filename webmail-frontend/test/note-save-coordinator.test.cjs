const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../src/notes/note-save-coordinator.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
}).outputText;
const loaded = new Module(sourcePath, module);
loaded.paths = module.paths;
loaded._compile(compiled, sourcePath);

const { createNoteSaveCoordinator } = loaded.exports;

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

test('overlapping new-note saves serialize and inherit the first created identity', async () => {
  const coordinator = createNoteSaveCoordinator();
  const firstGate = deferred();
  const secondGate = deferred();
  const identities = [];

  const autosave = coordinator.enqueue(async identity => {
    identities.push(identity);
    return firstGate.promise;
  });
  const closeSave = coordinator.enqueue(async identity => {
    identities.push(identity);
    return secondGate.promise;
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(identities, [{ id: null, syncToken: null }]);

  firstGate.resolve({ id: 'stable-note-id', syncToken: 1 });
  await autosave;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(identities[1], { id: 'stable-note-id', syncToken: 1 });

  secondGate.resolve({ id: 'stable-note-id', syncToken: 2 });
  await closeSave;
  assert.deepEqual(await coordinator.flush(), { id: 'stable-note-id', syncToken: 2 });
});

test('an existing note seeds the first save and a failed save does not poison later work', async () => {
  const coordinator = createNoteSaveCoordinator({ id: 'existing-note', syncToken: 7 });

  await assert.rejects(
    coordinator.enqueue(async identity => {
      assert.deepEqual(identity, { id: 'existing-note', syncToken: 7 });
      throw new Error('offline');
    }),
    /offline/,
  );

  await coordinator.enqueue(async identity => ({ id: identity.id, syncToken: 8 }));
  assert.deepEqual(await coordinator.flush(), { id: 'existing-note', syncToken: 8 });
});
