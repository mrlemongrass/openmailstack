#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { WbxmlParser } = require('../../webmail-backend/src/wbxml/parser.js');
const { WbxmlWriter } = require('../../webmail-backend/src/wbxml/writer.js');

const projectRoot = path.resolve(__dirname, '../..');
const smokePath = path.join(__dirname, 'activesync_ping_smoke.sh');
const fixtureUser = 'ping-fixture@example.test';
const fixturePassword = 'fixture-password-must-not-be-logged';
const deviceId = 'OMSPG0123456789abcdef01234567';
const inboxId = `m-${'a'.repeat(62)}`;
const contactsId = 'contacts';
const calendarId = 'cal-302';
const canaryDigest = createHash('sha256')
  .update('openmailstack-protocol-mail-canary\0', 'utf8')
  .update(fixtureUser, 'utf8')
  .update('\0', 'utf8')
  .update(deviceId, 'utf8')
  .digest('hex');
const canarySuffix = canaryDigest.slice(0, 24);
const encodedUser = encodeURIComponent(fixtureUser);
const contactUid = `oms-ping-contact-${canarySuffix}`;
const contactEmail = `oms-ping-${canarySuffix}@example.invalid`;
const calendarSlug = `oms-ping-${canarySuffix}`;
const calendarName = `OMS Ping Calendar ${canarySuffix}`;
const calendarEventUid = `oms-ping-event-${canarySuffix}`;
const calendarSubject = `OMS Ping Event ${canarySuffix}`;
const contactPath = `/carddav/addressbooks/${encodedUser}/personal/${contactUid}.vcf`;
const calendarPath = `/caldav/calendars/${encodedUser}/${calendarSlug}/`;
const calendarEventPath = `${calendarPath}${calendarEventUid}.ics`;

function writeWbxml(node) {
  const writer = new WbxmlWriter();
  writer.writeNode(node);
  return writer.getBuffer();
}

function parseWbxml(body) {
  return new WbxmlParser(body).parse();
}

function child(node, tag) {
  return (node?.children || []).find(item => item.tag === tag);
}

function text(node, tag) {
  const content = child(node, tag)?.content;
  return content === undefined ? '' : content.toString();
}

function pingResponse(status, heartbeat = '', changedFolder = '') {
  return {
    tag: 'Ping',
    page: 13,
    children: [
      { tag: 'Status', page: 13, content: status },
      ...(changedFolder ? [{
        tag: 'Folders',
        page: 13,
        children: [{ tag: 'Folder', page: 13, content: changedFolder }],
      }] : []),
      ...(heartbeat ? [{ tag: 'HeartbeatInterval', page: 13, content: heartbeat }] : []),
    ],
  };
}

function wbxmlResponse(response, node, contentType = 'application/vnd.ms-sync.wbxml') {
  response.writeHead(200, {
    'Content-Type': contentType,
    Connection: 'close',
  });
  response.end(writeWbxml(node));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    request.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 64 * 1024) {
        reject(new Error('fixture received an oversized request'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

async function startFixture(mode, expectLong) {
  const observations = [];
  const davOperations = [];
  let pingIndex = 0;
  let syncIndex = 0;
  let optionsCount = 0;
  const syncCounts = new Map([[inboxId, 0], [contactsId, 0], [calendarId, 0]]);
  let calendarCreated = false;
  let contactCreated = false;
  let eventCreated = false;

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://fixture.invalid');
      if (request.method === 'OPTIONS') {
        optionsCount += 1;
        observations.push('OPTIONS');
        response.writeHead(200, {
          'MS-ASProtocolVersions': '14.0,14.1',
          'MS-ASProtocolCommands': mode === 'unadvertised'
            ? 'Sync,FolderSync'
            : 'Sync,FolderSync,Ping',
          Connection: 'close',
        });
        response.end();
        return;
      }

      if (url.pathname.startsWith('/carddav/') || url.pathname.startsWith('/caldav/')) {
        assert.equal(
          request.headers.authorization,
          `Basic ${Buffer.from(`${fixtureUser}:${fixturePassword}`).toString('base64')}`,
        );
        const body = await readBody(request);
        if (request.method === 'DELETE') {
          assert.ok(
            [contactPath, calendarEventPath, calendarPath].includes(url.pathname),
            `unexpected DAV DELETE ${url.pathname}`,
          );
          if (url.pathname === contactPath) contactCreated = false;
          if (url.pathname === calendarEventPath) eventCreated = false;
          if (url.pathname === calendarPath) {
            calendarCreated = false;
            eventCreated = false;
          }
          davOperations.push(`DELETE ${url.pathname}`);
          response.writeHead(204, { Connection: 'close' });
          response.end();
          return;
        }
        if (request.method === 'MKCALENDAR') {
          assert.equal(url.pathname, calendarPath);
          assert.match(request.headers['content-type'] || '', /^application\/xml/);
          assert.match(body.toString('utf8'), new RegExp(calendarName));
          calendarCreated = true;
          davOperations.push(`MKCALENDAR ${url.pathname}`);
          response.writeHead(201, { Connection: 'close' });
          response.end();
          return;
        }
        if (request.method === 'PUT' && url.pathname === contactPath) {
          assert.match(request.headers['content-type'] || '', /^text\/vcard/);
          assert.equal(request.headers['if-none-match'], '*');
          assert.match(body.toString('utf8'), new RegExp(contactEmail));
          contactCreated = true;
          davOperations.push(`PUT ${url.pathname}`);
          response.writeHead(201, { Connection: 'close' });
          response.end();
          return;
        }
        if (request.method === 'PUT' && url.pathname === calendarEventPath) {
          assert.equal(calendarCreated, true, 'event was created outside the disposable calendar');
          assert.match(request.headers['content-type'] || '', /^text\/calendar/);
          assert.equal(request.headers['if-none-match'], '*');
          assert.match(body.toString('utf8'), new RegExp(calendarSubject));
          eventCreated = true;
          davOperations.push(`PUT ${url.pathname}`);
          response.writeHead(201, { Connection: 'close' });
          response.end();
          return;
        }
        throw new Error(`unexpected DAV request ${request.method} ${url.pathname}`);
      }

      assert.equal(request.method, 'POST');
      assert.equal(url.pathname, '/Microsoft-Server-ActiveSync');
      assert.equal(url.searchParams.get('User'), fixtureUser);
      assert.equal(url.searchParams.get('DeviceId'), deviceId);
      assert.equal(url.searchParams.get('DeviceType'), 'CodexSmoke');
      assert.equal(
        request.headers.authorization,
        `Basic ${Buffer.from(`${fixtureUser}:${fixturePassword}`).toString('base64')}`,
      );
      assert.equal(request.headers['ms-asprotocolversion'], '14.1');
      const command = url.searchParams.get('Cmd');
      const body = await readBody(request);
      observations.push(command);

      if (command === 'FolderSync') {
        assert.equal(calendarCreated, true, 'FolderSync ran before the disposable calendar existed');
        assert.equal(request.headers['content-type'], 'application/vnd.ms-sync.wbxml');
        const ast = parseWbxml(body);
        assert.equal(ast.tag, 'FolderSync');
        assert.equal(ast.page, 7);
        assert.equal(text(ast, 'SyncKey'), '0');
        wbxmlResponse(response, {
          tag: 'FolderSync',
          page: 7,
          children: [
            { tag: 'Status', page: 7, content: '1' },
            { tag: 'SyncKey', page: 7, content: 'folder-key-1' },
            { tag: 'Changes', page: 7, children: [
              { tag: 'Count', page: 7, content: '3' },
              { tag: 'Add', page: 7, children: [
                { tag: 'ServerId', page: 7, content: inboxId },
                { tag: 'ParentId', page: 7, content: '0' },
                { tag: 'DisplayName', page: 7, content: 'INBOX' },
                { tag: 'Type', page: 7, content: '2' },
              ] },
              { tag: 'Add', page: 7, children: [
                { tag: 'ServerId', page: 7, content: contactsId },
                { tag: 'ParentId', page: 7, content: '0' },
                { tag: 'DisplayName', page: 7, content: 'Contacts' },
                { tag: 'Type', page: 7, content: '9' },
              ] },
              { tag: 'Add', page: 7, children: [
                { tag: 'ServerId', page: 7, content: calendarId },
                { tag: 'ParentId', page: 7, content: '0' },
                { tag: 'DisplayName', page: 7, content: calendarName },
                { tag: 'Type', page: 7, content: '13' },
              ] },
            ] },
          ],
        });
        return;
      }

      if (command === 'Sync') {
        assert.equal(request.headers['content-type'], 'application/vnd.ms-sync.wbxml');
        const ast = parseWbxml(body);
        assert.equal(ast.tag, 'Sync');
        assert.equal(ast.page, 0);
        const collection = child(child(ast, 'Collections'), 'Collection');
        const collectionId = text(collection, 'CollectionId');
        assert.equal(syncCounts.has(collectionId), true, `unexpected Sync collection ${collectionId}`);
        const collectionIndex = syncCounts.get(collectionId);
        const keyPrefix = collectionId === inboxId
          ? 'mail'
          : collectionId === contactsId ? 'contacts' : 'calendar';
        assert.equal(text(collection, 'SyncKey'), collectionIndex === 0 ? '0' : `${keyPrefix}-key-${collectionIndex}`);
        assert.equal(text(collection, 'GetChanges'), collectionIndex === 0 ? '' : '1');
        syncCounts.set(collectionId, collectionIndex + 1);
        syncIndex += 1;
        const responseIndex = collectionIndex + 1;
        let canaryCommand = null;
        if (responseIndex === 4) {
          if (collectionId === contactsId) {
            assert.equal(contactCreated, true, 'Contacts Sync returned the canary before its DAV PUT');
          }
          if (collectionId === calendarId) {
            assert.equal(eventCreated, true, 'Calendar Sync returned the canary before its DAV PUT');
          }
          const expectedValue = collectionId === inboxId
            ? `OMS ActiveSync Ping smoke ${deviceId}`
            : collectionId === contactsId ? contactEmail : calendarSubject;
          const expectedTag = collectionId === contactsId ? 'Email1Address' : 'Subject';
          const expectedPage = collectionId === inboxId ? 2 : collectionId === contactsId ? 1 : 4;
          canaryCommand = {
            tag: 'Add',
            page: 0,
            children: [
              { tag: 'ServerId', page: 0, content: `${keyPrefix}-canary-server-id` },
              {
                tag: 'ApplicationData',
                page: 0,
                children: [{ tag: expectedTag, page: expectedPage, content: expectedValue }],
              },
            ],
          };
        }
        wbxmlResponse(response, {
          tag: 'Sync',
          page: 0,
          children: [{ tag: 'Collections', page: 0, children: [{
            tag: 'Collection',
            page: 0,
            children: [
              { tag: 'SyncKey', page: 0, content: `${keyPrefix}-key-${responseIndex}` },
              { tag: 'CollectionId', page: 0, content: collectionId },
              { tag: 'Status', page: 0, content: '1' },
              ...(responseIndex === 2 ? [{ tag: 'MoreAvailable', page: 0, children: [] }] : []),
              ...(canaryCommand ? [{
                tag: 'Commands',
                page: 0,
                children: [canaryCommand],
              }] : []),
            ],
          }] }],
        });
        return;
      }

      assert.equal(command, 'Ping');
      if (mode === 'http501') {
        response.writeHead(501, { Connection: 'close' });
        response.end();
        return;
      }

      if ([0, 1, 3, 4, 5, 6, 8].includes(pingIndex)) {
        assert.equal(request.headers['content-type'], 'application/vnd.ms-sync.wbxml');
        const ast = parseWbxml(body);
        assert.equal(ast.tag, 'Ping');
        assert.equal(ast.page, 13);
        const requestedHeartbeat = ['901', '59', null, '60', '60', '60', '60', null, '900'][pingIndex];
        assert.equal(text(ast, 'HeartbeatInterval'), requestedHeartbeat);
        const allFolders = [
          { id: inboxId, className: 'Email' },
          { id: contactsId, className: 'Contacts' },
          { id: calendarId, className: 'Calendar' },
        ];
        const expectedFolders = pingIndex === 3
          ? [allFolders[0]]
          : pingIndex === 4 ? [allFolders[1]] : pingIndex === 5 ? [allFolders[2]] : allFolders;
        const actualFolders = (child(ast, 'Folders')?.children || []).map(folder => ({
          id: text(folder, 'Id'),
          className: text(folder, 'Class'),
        }));
        assert.deepEqual(actualFolders, expectedFolders);
      } else {
        assert.equal(body.length, 0);
        if (pingIndex === 2) {
          assert.equal(request.headers['content-type'], 'application/vnd.ms-sync.wbxml');
        } else {
          assert.equal(request.headers['content-type'], undefined);
        }
      }

      const currentPing = pingIndex;
      pingIndex += 1;
      if (currentPing === 0) {
        wbxmlResponse(
          response,
          pingResponse('5', '900'),
          mode === 'wrong-content-type' ? 'text/plain' : undefined,
        );
      } else if (currentPing === 1) {
        wbxmlResponse(response, pingResponse('5', '60'));
      } else if (currentPing === 2) {
        wbxmlResponse(response, pingResponse(mode === 'seeded-invalid-cache' ? '1' : '3'));
      } else if (currentPing >= 3 && currentPing <= 5) {
        const changedFolder = [inboxId, contactsId, calendarId][currentPing - 3];
        setTimeout(() => {
          const canaryReady = currentPing === 3
            || (currentPing === 4 ? contactCreated : eventCreated);
          if (!canaryReady) {
            response.writeHead(500, { 'Content-Type': 'text/plain', Connection: 'close' });
            response.end('fixture canary was not created before Ping wake');
            return;
          }
          wbxmlResponse(
            response,
            mode === 'missing-status2' && currentPing === 3
              ? pingResponse('1')
              : pingResponse('2', '', changedFolder),
          );
        }, 20);
      } else if (currentPing === 6 || currentPing === 7) {
        setTimeout(
          () => wbxmlResponse(response, pingResponse('1')),
          mode === 'early-status1' ? 0 : 120,
        );
      } else if (currentPing === 8 && expectLong) {
        setTimeout(() => wbxmlResponse(response, pingResponse('1')), 1800);
      } else {
        throw new Error(`fixture received unexpected Ping ${currentPing}`);
      }
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain', Connection: 'close' });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    observations,
    close: async () => {
      server.closeIdleConnections?.();
      await new Promise(resolve => server.close(resolve));
    },
    inspect: () => ({ pingIndex, syncIndex, optionsCount, davOperations: [...davOperations] }),
  };
}

function runSmoke(baseUrl, longMode, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const childProcess = spawn('bash', [smokePath], {
      cwd: projectRoot,
      env: {
        ...process.env,
        OMS_SMOKE_BASE_URL: baseUrl,
        OMS_SMOKE_USER: fixtureUser,
        OMS_SMOKE_PASSWORD: fixturePassword,
        OMS_SMOKE_DEVICE_ID: deviceId,
        OMS_SMOKE_NETWORK_TIMEOUT_MS: '3000',
        OMS_PROTOCOL_GATE_FIXTURE_MODE: '1',
        OMS_SMOKE_PING_FIXTURE_SECOND_MS: '2',
        OMS_SMOKE_PING_LONG_MODE: longMode ? '1' : '0',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks = [];
    let bytes = 0;
    const collect = chunk => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) {
        childProcess.kill('SIGKILL');
        reject(new Error('Ping smoke fixture output exceeded its safety bound'));
        return;
      }
      chunks.push(chunk);
    };
    childProcess.stdout.on('data', collect);
    childProcess.stderr.on('data', collect);
    const timer = setTimeout(() => {
      childProcess.kill('SIGKILL');
      reject(new Error('Ping smoke fixture timed out'));
    }, 15_000);
    childProcess.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    childProcess.once('exit', (status, signal) => {
      clearTimeout(timer);
      resolve({
        status: signal ? null : status,
        signal,
        output: Buffer.concat(chunks).toString('utf8'),
      });
    });
  });
}

async function exercise(mode, {
  longMode = false,
  expectSuccess = false,
  expectedError = '',
  extraEnv = {},
} = {}) {
  const fixture = await startFixture(mode, longMode);
  try {
    const result = await runSmoke(fixture.baseUrl, longMode, extraEnv);
    assert.equal(result.output.includes(fixturePassword), false, 'smoke output leaked the password');
    if (expectSuccess) {
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /PASS: ActiveSync Ping smoke completed/);
    } else {
      assert.notEqual(result.status, 0, result.output);
      assert.match(result.output, new RegExp(expectedError));
    }
    return { ...fixture.inspect(), observations: fixture.observations };
  } finally {
    await fixture.close();
  }
}

(async () => {
  const routine = await exercise('happy', { expectSuccess: true });
  assert.equal(routine.pingIndex, 8, 'routine gate unexpectedly ran the 900-second hold');
  assert.equal(routine.syncIndex, 12);
  assert.equal(routine.optionsCount, 2);
  assert.deepEqual(routine.observations, [
    'OPTIONS', 'FolderSync', 'Ping', 'Ping', 'Ping',
    'Sync', 'Sync', 'Sync', 'Sync', 'Sync', 'Sync', 'Sync', 'Sync', 'Sync',
    'Ping', 'Sync', 'Ping', 'Sync', 'Ping', 'Sync', 'Ping', 'Ping', 'OPTIONS',
  ]);
  assert.deepEqual(routine.davOperations, [
    `MKCALENDAR ${calendarPath}`,
    `PUT ${contactPath}`,
    `PUT ${calendarEventPath}`,
    `DELETE ${contactPath}`,
    `DELETE ${calendarEventPath}`,
    `DELETE ${calendarPath}`,
  ]);

  const long = await exercise('happy', { longMode: true, expectSuccess: true });
  assert.equal(long.pingIndex, 9);
  assert.equal(long.syncIndex, 12);
  assert.equal(long.optionsCount, 2);

  await exercise('unadvertised', { expectedError: 'does not advertise Ping' });
  await exercise('http501', { expectedError: 'ActiveSync Ping returned HTTP 501' });
  await exercise('wrong-content-type', { expectedError: 'invalid Content-Type' });
  await exercise('seeded-invalid-cache', { expectedError: 'expected Status 3' });
  await exercise('missing-status2', { expectedError: 'Status 2 returned an invalid WBXML shape' });
  await exercise('early-status1', { expectedError: 'returned too early' });
  await exercise('happy', {
    expectedError: 'cleanup identity mismatch for OMS_SMOKE_PING_CONTACT_UID',
    extraEnv: {
      OMS_SMOKE_PING_CONTACT_UID: 'oms-ping-contact-wrong-identity',
      OMS_SMOKE_PING_CONTACT_EMAIL: contactEmail,
      OMS_SMOKE_PING_CALENDAR_SLUG: calendarSlug,
      OMS_SMOKE_PING_CALENDAR_NAME: calendarName,
      OMS_SMOKE_PING_CALENDAR_EVENT_UID: calendarEventUid,
      OMS_SMOKE_PING_CALENDAR_SUBJECT: calendarSubject,
    },
  });

  console.log('PASS: ActiveSync Ping smoke fixture covers negotiation, exact mail/contact/calendar Status 2 wakes, deletion non-wake, renewal, timing, long opt-in, and fail-closed transport behavior');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
