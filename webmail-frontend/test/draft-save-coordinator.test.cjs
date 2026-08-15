const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../src/mail/draft-save-coordinator.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
}).outputText;
const loaded = new Module(sourcePath, module);
loaded.paths = module.paths;
loaded._compile(compiled, sourcePath);

const { createDraftSaveCoordinator } = loaded.exports;

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
};

test('overlapping autosaves are serialized and inherit the prior stable draft identity', async () => {
  const coordinator = createDraftSaveCoordinator();
  const firstGate = deferred();
  const secondGate = deferred();
  const identities = [];

  const first = coordinator.enqueue(async identity => {
    identities.push(identity);
    return firstGate.promise;
  });
  const second = coordinator.enqueue(async identity => {
    identities.push(identity);
    return secondGate.promise;
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(identities, [{ draftId: null, draftUid: null }]);

  firstGate.resolve({ draftId: 'stable-draft', draftUid: '41' });
  await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(identities[1], { draftId: 'stable-draft', draftUid: '41' });

  secondGate.resolve({ draftId: 'stable-draft', draftUid: '42' });
  await second;
  assert.deepEqual(await coordinator.flush(), { draftId: 'stable-draft', draftUid: '42' });
});

test('a failed save does not poison the serialized queue', async () => {
  const coordinator = createDraftSaveCoordinator();
  await assert.rejects(
    coordinator.enqueue(async () => { throw new Error('offline'); }),
    /offline/,
  );
  const recovered = await coordinator.enqueue(async identity => ({
    ...identity,
    draftId: 'recovered',
    draftUid: '7',
  }));
  assert.equal(recovered.draftUid, '7');
  assert.deepEqual(await coordinator.flush(), { draftId: 'recovered', draftUid: '7' });
});

test('an existing IMAP draft seeds the first replacement and send identity', async () => {
  const coordinator = createDraftSaveCoordinator();
  coordinator.reset({ draftId: 'existing-draft', draftUid: '901' });

  let receivedIdentity;
  await coordinator.enqueue(async identity => {
    receivedIdentity = identity;
    return { draftId: identity.draftId, draftUid: '902' };
  });

  assert.deepEqual(receivedIdentity, { draftId: 'existing-draft', draftUid: '901' });
  assert.deepEqual(await coordinator.flush(), { draftId: 'existing-draft', draftUid: '902' });
});
