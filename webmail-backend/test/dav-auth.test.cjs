const assert = require('node:assert/strict');
const test = require('node:test');

let constructorArgs;
const imapPath = require.resolve('../src/imap.js');
require.cache[imapPath] = {
  id: imapPath,
  filename: imapPath,
  loaded: true,
  exports: {
    ImapService: class {
      constructor(...args) {
        constructorArgs = args;
      }
      async connect() {}
      async logout() {}
    },
  },
  children: [],
  paths: [],
};

const configPath = require.resolve('../src/config.js');
require.cache[configPath] = {
  id: configPath,
  filename: configPath,
  loaded: true,
  exports: { normalizeMailboxUsername: value => value },
  children: [],
  paths: [],
};

const { davBasicAuth } = require('../src/dav-auth.js');

test('DAV validates the supplied mailbox password without delegated credentials', async () => {
  const request = {
    headers: {
      authorization: `Basic ${Buffer.from('user@example.test:mailbox-password').toString('base64')}`,
    },
  };
  const response = {
    set() { return this; },
    status() { return this; },
    send() { return this; },
  };
  let continued = false;

  await davBasicAuth('OpenMailStack')(request, response, () => {
    continued = true;
  });

  assert.equal(continued, true);
  assert.deepEqual(constructorArgs, ['user@example.test', 'mailbox-password', false]);
});
