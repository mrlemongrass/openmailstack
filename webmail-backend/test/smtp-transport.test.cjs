const test = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');

process.env.OMS_DB_PASSWORD ||= 'unit-test-password';

const { smtpTransportOptions } = require('../src/config.js');

test('core SMTP gives Nodemailer the configured certificate hostname for loopback', () => {
  const options = smtpTransportOptions(
    { user: 'user@example.test', pass: 'test-password' },
    {
      host: '127.0.0.1',
      port: 587,
      secure: false,
      serverName: 'mail.example.test',
      rejectUnauthorized: true,
    },
  );

  assert.equal(options.host, '127.0.0.1');
  assert.equal(options.tls.servername, 'mail.example.test');
  assert.equal(options.tls.rejectUnauthorized, true);
  assert.deepEqual(options.auth, { user: 'user@example.test', pass: 'test-password' });

  const transporter = nodemailer.createTransport(options);
  assert.equal(transporter.options.tls.servername, 'mail.example.test');
  assert.equal(transporter.options.tls.rejectUnauthorized, true);
  transporter.close();
});
