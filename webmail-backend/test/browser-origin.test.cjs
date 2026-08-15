const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const express = require('express');
const { Server: SocketIOServer } = require('socket.io');
const WebSocket = require('ws');

process.env.OMS_DB_PASSWORD ||= 'browser-origin-test';

const {
  allowSameOriginSocketRequest,
  browserRequestHasSameOrigin,
  requireSameOriginBrowserRequest,
} = require('../src/browser-origin.js');

function requestHeaders(origin, {
  host = 'mail.example.test',
  forwardedProto = 'https',
  forwardedHost,
} = {}) {
  return {
    headers: {
      ...(origin === undefined ? {} : { origin }),
      ...(host === undefined ? {} : { host }),
      ...(forwardedProto === undefined ? {} : { 'x-forwarded-proto': forwardedProto }),
      ...(forwardedHost === undefined ? {} : { 'x-forwarded-host': forwardedHost }),
    },
    socket: { encrypted: false },
  };
}

test('browser origin comparison uses exact normalized scheme, host, and effective port', () => {
  assert.equal(browserRequestHasSameOrigin(requestHeaders(undefined)), true, 'native/server requests have no Origin');
  assert.equal(browserRequestHasSameOrigin(requestHeaders('https://mail.example.test')), true);
  assert.equal(browserRequestHasSameOrigin(requestHeaders('HTTPS://MAIL.EXAMPLE.TEST:443')), true);
  assert.equal(browserRequestHasSameOrigin(requestHeaders('https://mail.example.test:443', {
    host: 'mail.example.test:443',
  })), true);
  assert.equal(browserRequestHasSameOrigin(requestHeaders('https://mail.example.test:8443', {
    host: 'mail.example.test:8443',
  })), true);

  assert.equal(browserRequestHasSameOrigin(requestHeaders('http://mail.example.test')), false);
  assert.equal(browserRequestHasSameOrigin(requestHeaders('https://other.example.test')), false);
  assert.equal(browserRequestHasSameOrigin(requestHeaders('https://mail.example.test:8443')), false);
  assert.equal(browserRequestHasSameOrigin(requestHeaders('https://forwarded.example.test', {
    forwardedHost: 'forwarded.example.test',
  })), false, 'X-Forwarded-Host is not an origin authority');
  assert.equal(browserRequestHasSameOrigin(requestHeaders('https://mail.example.test', {
    forwardedHost: 'forwarded.example.test',
  })), true, 'an overwritten forwarded host cannot replace the preserved Host');
});

test('null, malformed, credentialed, and path-bearing browser origins fail closed', () => {
  for (const origin of [
    'null',
    '',
    'not an origin',
    'ftp://mail.example.test',
    'https://user@mail.example.test',
    'https://mail.example.test/',
    'https://mail.example.test/path',
    'https://mail.example.test?query=1',
    ' https://mail.example.test',
  ]) {
    assert.equal(browserRequestHasSameOrigin(requestHeaders(origin)), false, origin);
  }
  assert.equal(browserRequestHasSameOrigin({
    headers: { origin: 'https://mail.example.test', 'x-forwarded-proto': 'https' },
    socket: { encrypted: false },
  }), false);
  assert.equal(browserRequestHasSameOrigin(requestHeaders('https://mail.example.test', { forwardedProto: 'javascript' })), false);
});

test('Fetch Metadata rejects browser cross-origin requests even when Origin is missing', () => {
  const request = site => ({
    headers: { host: 'mail.example.test', 'x-forwarded-proto': 'https', 'sec-fetch-site': site },
    socket: { encrypted: false },
  });

  assert.equal(browserRequestHasSameOrigin(request('cross-site')), false);
  assert.equal(browserRequestHasSameOrigin(request('same-site')), false);
  assert.equal(browserRequestHasSameOrigin(request('same-origin')), true);
  assert.equal(browserRequestHasSameOrigin(request('none')), true);
  assert.equal(browserRequestHasSameOrigin(requestHeaders(undefined)), true, 'non-browser protocol clients remain supported');
});

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

function httpStatus(port, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path: '/api/probe', headers }, response => {
      response.resume();
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers }));
    });
    request.on('error', reject);
    request.end();
  });
}

test('Express rejects a mismatched browser Origin with no reflected CORS header', async t => {
  const app = express();
  app.use('/api', requireSameOriginBrowserRequest);
  app.get('/api/probe', (_req, res) => res.json({ success: true }));
  const server = http.createServer(app);
  const port = await listen(server);
  t.after(() => new Promise(resolve => server.close(resolve)));

  const rejected = await httpStatus(port, {
    Host: 'mail.example.test', Origin: 'https://evil.example.test', 'X-Forwarded-Proto': 'https',
  });
  assert.equal(rejected.status, 403);
  assert.equal('access-control-allow-origin' in rejected.headers, false);

  const sameOrigin = await httpStatus(port, {
    Host: 'mail.example.test', Origin: 'https://mail.example.test', 'X-Forwarded-Proto': 'https',
  });
  assert.equal(sameOrigin.status, 200);
  assert.equal('access-control-allow-origin' in sameOrigin.headers, false);

  const nativeRequest = await httpStatus(port);
  assert.equal(nativeRequest.status, 200);
});

test('the API origin gate runs before body parsing, rate limiting, and routers', () => {
  const entrypoint = fs.readFileSync(path.join(__dirname, '../src/index.ts'), 'utf8');
  const originGate = entrypoint.indexOf("app.use('/api', requireSameOriginBrowserRequest)");
  assert.ok(originGate >= 0);
  for (const laterMiddleware of [
    'app.use(express.json',
    "app.use('/api/auth/login', rateLimit",
    "app.use('/api', apiRouter)",
    "app.use('/api/apps', appsApiRouter)",
    "app.use('/api', schedulerRouter)",
  ]) {
    assert.ok(originGate < entrypoint.indexOf(laterMiddleware), laterMiddleware);
  }
});

test('Socket.IO rejects evil polling and WebSocket Origins even when a cookie is present', async t => {
  const server = http.createServer();
  const io = new SocketIOServer(server, { allowRequest: allowSameOriginSocketRequest });
  const port = await listen(server);
  t.after(async () => {
    await io.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  });

  const polling = await fetch(`http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling`, {
    headers: {
      Host: 'mail.example.test',
      Origin: 'https://evil.example.test',
      Cookie: 'oms_session=test-only',
      'X-Forwarded-Proto': 'https',
    },
  });
  assert.equal(polling.status, 403);
  assert.equal(polling.headers.has('access-control-allow-origin'), false);

  const nativePolling = await fetch(`http://127.0.0.1:${port}/socket.io/?EIO=4&transport=polling`);
  assert.equal(nativePolling.status, 200, 'non-browser clients without Origin remain supported');

  const websocketStatus = await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`, {
      headers: {
        Host: 'mail.example.test',
        Origin: 'https://evil.example.test',
        Cookie: 'oms_session=test-only',
        'X-Forwarded-Proto': 'https',
      },
    });
    socket.once('unexpected-response', (_request, response) => {
      response.resume();
      resolve(response.statusCode);
    });
    socket.once('open', () => reject(new Error('evil WebSocket Origin was accepted')));
    socket.once('error', error => {
      if (!String(error.message).includes('Unexpected server response')) reject(error);
    });
  });
  assert.ok(websocketStatus === 400 || websocketStatus === 403);
});
