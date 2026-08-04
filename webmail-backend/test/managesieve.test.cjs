const assert = require('node:assert/strict');
const net = require('node:net');
const test = require('node:test');
const { once } = require('node:events');

const { ManageSieveClient } = require('../src/managesieve.js');

const pause = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

async function withManageSieveServer(handleSocket, run) {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setNoDelay(true);
    handleSocket(socket);
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, 'object');

  const client = new ManageSieveClient('127.0.0.1', address.port);
  try {
    await run(client);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('getScript preserves chunked UTF-8 literals and waits for the terminal status', async () => {
  const script = [
    'require ["fileinto"];',
    '# café status words below are script text',
    'NO this is script text',
    'BYE this is script text',
    'OK this is script text',
  ].join('\r\n') + '\r\n';
  const scriptBytes = Buffer.from(script, 'utf8');
  const literalHeader = Buffer.from(`{${scriptBytes.length}}\r\n`, 'ascii');
  const unicodeByte = scriptBytes.indexOf(Buffer.from('é', 'utf8'));
  let markLiteralDelivered;
  const literalDelivered = new Promise((resolve) => {
    markLiteralDelivered = resolve;
  });
  let releaseTerminalStatus;
  const terminalStatusReleased = new Promise((resolve) => {
    releaseTerminalStatus = resolve;
  });
  let markStatusWithoutLfDelivered;
  const statusWithoutLfDelivered = new Promise((resolve) => {
    markStatusWithoutLfDelivered = resolve;
  });
  let releaseFinalLf;
  const finalLfReleased = new Promise((resolve) => {
    releaseFinalLf = resolve;
  });
  await withManageSieveServer((socket) => {
    socket.write('OK "ready"\r\n');

    let commands = '';
    let scriptSent = false;
    socket.on('data', (data) => {
      commands += data.toString('utf8');

      if (!scriptSent && commands.includes('GETSCRIPT "webmail"\r\n')) {
        scriptSent = true;
        void (async () => {
          socket.write(literalHeader.subarray(0, 2));
          await pause(2);
          socket.write(literalHeader.subarray(2));
          await pause(2);
          socket.write(scriptBytes.subarray(0, unicodeByte + 1));
          await pause(2);
          socket.write(scriptBytes.subarray(unicodeByte + 1));
          await pause(2);
          socket.write('\r\n');
          markLiteralDelivered();
          await terminalStatusReleased;
          socket.write('O');
          await pause(2);
          socket.write('K "script follows"\r');
          markStatusWithoutLfDelivered();
          await finalLfReleased;
          socket.write('\n');
        })();
      }

    });
  }, async (client) => {
    await client.connect();
    let settled = false;
    const scriptPromise = client.getScript('webmail');
    scriptPromise.then(
      () => { settled = true; },
      () => { settled = true; },
    );

    await literalDelivered;
    await pause(10);
    const settledBeforeStatus = settled;
    releaseTerminalStatus();
    await statusWithoutLfDelivered;
    await pause(10);
    const settledBeforeFinalLf = settled;
    releaseFinalLf();

    assert.equal(settledBeforeStatus, false);
    assert.equal(settledBeforeFinalLf, false);
    assert.equal(await scriptPromise, script);
  }).finally(() => {
    releaseTerminalStatus();
    releaseFinalLf();
  });
});

test('login, setActive, and logout accept complete single-line OK responses', async () => {
  await withManageSieveServer((socket) => {
    socket.write('OK "ready"\r\n');

    let commands = '';
    let state = 'login';
    socket.on('data', (data) => {
      commands += data.toString('utf8');

      if (state === 'login' && commands.includes('AUTHENTICATE "PLAIN"')) {
        state = 'active';
        socket.write('OK "authenticated"\r\n');
      } else if (state === 'active' && commands.includes('SETACTIVE "webmail"\r\n')) {
        state = 'logout';
        socket.write('O');
        setTimeout(() => socket.write('K "active"\r\n'), 2);
      } else if (state === 'logout' && commands.includes('LOGOUT\r\n')) {
        state = 'done';
        socket.write('OK "bye"\r\n');
      }
    });
  }, async (client) => {
    await client.connect();
    await client.login('person@example.test', 'test-only');
    await client.setActive('webmail');
    await client.logout();
  });
});

test('rejects an incomplete response when the peer ends the connection', async () => {
  await withManageSieveServer((socket) => {
    socket.write('OK "ready"\r\n');

    socket.once('data', () => {
      socket.end('{20}\r\nshort');
    });
  }, async (client) => {
    await client.connect();
    await assert.rejects(
      Promise.race([
        client.getScript('webmail'),
        pause(150).then(() => {
          throw new Error('ManageSieve request remained pending after peer ended connection');
        }),
      ]),
      /ManageSieve connection ended before response completed/,
    );
  });
});

test('rejects a literal larger than the response safety limit', async () => {
  await withManageSieveServer((socket) => {
    socket.write('OK "ready"\r\n');

    socket.once('data', () => {
      socket.write('{10485761}\r\n');
    });
  }, async (client) => {
    await client.connect();
    await assert.rejects(
      Promise.race([
        client.getScript('webmail'),
        pause(150).then(() => {
          throw new Error('ManageSieve oversized literal remained pending');
        }),
      ]),
      /ManageSieve literal exceeds 10485760 bytes/,
    );
  });
});
