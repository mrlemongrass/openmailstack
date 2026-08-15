const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../src/mail/outbound-identity.ts');

function loadModule() {
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

test('outbound identity fields preserve From and Reply-To and add self to Bcc once', () => {
  const { outboundIdentityFields } = loadModule();

  assert.deepEqual(outboundIdentityFields({
    from: 'sales@example.test',
    replyTo: 'support@example.test',
    bcc: 'auditor@example.net',
    alwaysBccSelf: true,
    selfAddress: 'owner@example.test',
  }), {
    from: 'sales@example.test',
    replyTo: 'support@example.test',
    bcc: 'auditor@example.net, owner@example.test',
  });

  assert.equal(outboundIdentityFields({
    bcc: 'Owner <OWNER@example.test>',
    alwaysBccSelf: true,
    selfAddress: 'owner@example.test',
  }).bcc, 'Owner <OWNER@example.test>');
});

test('self-Bcc matching is exact and disabled settings do not add headers', () => {
  const { outboundIdentityFields } = loadModule();

  assert.equal(outboundIdentityFields({
    bcc: 'owner@example.test.evil.invalid',
    alwaysBccSelf: true,
    selfAddress: 'owner@example.test',
  }).bcc, 'owner@example.test.evil.invalid, owner@example.test');
  assert.deepEqual(outboundIdentityFields({
    from: '  ', replyTo: '', bcc: '', alwaysBccSelf: false, selfAddress: 'owner@example.test',
  }), {});
});

test('full compose and inline reply both apply the shared outbound identity contract', () => {
  const hook = fs.readFileSync(path.resolve(__dirname, '../src/mail/hooks/useMail.ts'), 'utf8');

  assert.match(hook, /handleSend[\s\S]*outboundIdentityFields\([\s\S]*alwaysBccSelf[\s\S]*api\.sendMessage/);
  assert.match(hook, /sendReply[\s\S]*outboundIdentityFields\([\s\S]*alwaysBccSelf[\s\S]*api\.sendMessage/);
  assert.match(hook, /sendReply[\s\S]*const replyFrom = selectComposeFrom\([\s\S]*from: replyFrom/);
});
