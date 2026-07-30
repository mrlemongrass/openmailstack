const assert = require('node:assert/strict');
const test = require('node:test');

const queries = [];
const dbPath = require.resolve('../src/db.js');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    pool: {
      async query(sql) {
        const text = String(sql).replace(/\s+/g, ' ').trim();
        queries.push(text);
        if (text.startsWith('SELECT * FROM scheduled_emails')) {
          return [[{
            id: 42,
            username: 'user@example.test',
            mail_options: JSON.stringify({
              from: 'user@example.test',
              to: 'recipient@example.test',
              subject: 'Delegated send',
              text: 'Hello',
            }),
            draft_uid: null,
          }], []];
        }
        return [[], []];
      },
    },
  },
  children: [],
  paths: [],
};

let sent = false;
const nodemailerPath = require.resolve('nodemailer');
require.cache[nodemailerPath] = {
  id: nodemailerPath,
  filename: nodemailerPath,
  loaded: true,
  exports: {
    createTransport() {
      return {
        async sendMail() {
          sent = true;
        },
      };
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
  exports: {
    delegatedAuthEnabled: true,
    smtpTransportOptions: auth => ({ auth }),
  },
  children: [],
  paths: [],
};

const authPath = require.resolve('../src/auth.js');
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: {
    decryptPassword() {
      throw new Error('delegated sending must not decrypt a mailbox password');
    },
  },
  children: [],
  paths: [],
};

const imapPath = require.resolve('../src/imap.js');
require.cache[imapPath] = {
  id: imapPath,
  filename: imapPath,
  loaded: true,
  exports: {
    ImapService: class {
      constructor(user, pass) {
        assert.equal(user, 'user@example.test');
        assert.equal(pass, '');
        this.client = {};
      }
      async connect() {}
      async getFolders() { return [{ path: 'Sent' }]; }
      async appendMessage() {}
      async logout() {}
    },
  },
  children: [],
  paths: [],
};

const { runScheduledSender } = require('../src/scheduled-send.js');

test('scheduled mail uses delegated auth without requiring an active session password', async () => {
  await runScheduledSender();

  assert.equal(sent, true);
  assert.equal(queries.some(text => text.includes('FROM webmail_sessions')), false);
  assert.equal(queries.some(text => text.startsWith('DELETE FROM scheduled_emails')), true);
});
