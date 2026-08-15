const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const express = require('express');

const sourcePath = path.resolve(__dirname, '../src/private-uploads.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourcePath,
}).outputText;
const loaded = new Module(sourcePath, module);
loaded.filename = sourcePath;
loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
loaded._compile(compiled, sourcePath);

const { createPrivateUploadsRouter } = loaded.exports;

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

function uploadRequest(port, filePath, username, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: filePath,
      headers: {
        Host: 'mail.example.test',
        'X-Forwarded-Proto': 'https',
        'X-Test-User': username,
        ...headers,
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        response: { status: response.statusCode, headers: response.headers },
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

async function withUploadServer(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oms-private-uploads-'));
  const ownerDirectory = path.join(root, 'notes', 'alice@example.test');
  fs.mkdirSync(ownerDirectory, { recursive: true });
  fs.writeFileSync(path.join(ownerDirectory, 'private-note.txt'), 'alice private note');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const authenticate = (req, res, next) => {
    const username = req.get('x-test-user');
    if (!username) return res.status(401).json({ success: false, error: 'Unauthorized' });
    req.user = { username };
    next();
  };
  const app = express();
  app.use('/uploads', createPrivateUploadsRouter({ rootDirectory: root, authenticate }));
  app.use((_req, res) => res.status(200).send('application fallback'));
  const server = http.createServer(app);
  const port = await listen(server);
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { port, root };
}

test('the authenticated owner can retrieve a private Notes upload', async t => {
  const { port } = await withUploadServer(t);
  const { response, body } = await uploadRequest(
    port,
    '/uploads/notes/alice%40example.test/private-note.txt',
    'alice@example.test',
  );

  assert.equal(response.status, 200);
  assert.equal(body, 'alice private note');
  assert.equal(response.headers['cross-origin-resource-policy'], 'same-origin');
  assert.equal(response.headers['cache-control'], 'private, no-store');
});

test('a different authenticated user cannot retrieve the owner private Notes upload', async t => {
  const { port } = await withUploadServer(t);
  const { response, body } = await uploadRequest(
    port,
    '/uploads/notes/alice%40example.test/private-note.txt',
    'bob@example.test',
  );

  assert.equal(response.status, 404);
  assert.doesNotMatch(body, /alice private note/);
});

test('browser requests for private uploads require the exact application origin', async t => {
  const { port } = await withUploadServer(t);
  const uploadPath = '/uploads/notes/alice%40example.test/private-note.txt';

  const sameOrigin = await uploadRequest(port, uploadPath, 'alice@example.test', {
    Origin: 'https://mail.example.test',
  });
  assert.equal(sameOrigin.response.status, 200);

  const crossOrigin = await uploadRequest(port, uploadPath, 'alice@example.test', {
    Origin: 'https://evil.example.test',
  });
  assert.equal(crossOrigin.response.status, 403);
  assert.doesNotMatch(crossOrigin.body, /alice private note/);

  const siblingOrigin = await uploadRequest(port, uploadPath, 'alice@example.test', {
    'Sec-Fetch-Site': 'same-site',
  });
  assert.equal(siblingOrigin.response.status, 403);
  assert.doesNotMatch(siblingOrigin.body, /alice private note/);
});

test('a deleted private upload terminates as not found instead of falling through', async t => {
  const { port, root } = await withUploadServer(t);
  fs.rmSync(path.join(root, 'notes', 'alice@example.test', 'private-note.txt'));

  const { response, body } = await uploadRequest(
    port,
    '/uploads/notes/alice%40example.test/private-note.txt',
    'alice@example.test',
  );

  assert.equal(response.status, 404);
  assert.doesNotMatch(body, /application fallback|alice private note|ENOENT|oms-private-uploads/);
});
