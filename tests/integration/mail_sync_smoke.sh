#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${OMS_SMOKE_BASE_URL:-https://mail.housevo.us}
SMOKE_USER=${OMS_SMOKE_USER:-}
SMOKE_PASSWORD=${OMS_SMOKE_PASSWORD:-}
SMTP_HOST=${OMS_SMOKE_SMTP_HOST:-127.0.0.1}
SMTP_PORT=${OMS_SMOKE_SMTP_PORT:-587}
IMAP_HOST=${OMS_SMOKE_IMAP_HOST:-127.0.0.1}
IMAP_PORT=${OMS_SMOKE_IMAP_PORT:-143}

if [[ -z "${SMOKE_USER}" || -z "${SMOKE_PASSWORD}" ]]; then
  echo "SKIP: set OMS_SMOKE_USER and OMS_SMOKE_PASSWORD to run authenticated mail sync smoke checks"
  exit 0
fi

export BASE_URL SMOKE_USER SMOKE_PASSWORD SMTP_HOST SMTP_PORT IMAP_HOST IMAP_PORT

node <<'NODE'
const nodemailer = require('./webmail-backend/node_modules/nodemailer');
const { ImapFlow } = require('./webmail-backend/node_modules/imapflow');
const { simpleParser } = require('./webmail-backend/node_modules/mailparser');

const baseUrl = process.env.BASE_URL.replace(/\/$/, '');
const user = process.env.SMOKE_USER;
const pass = process.env.SMOKE_PASSWORD;
const smtpHost = process.env.SMTP_HOST || '127.0.0.1';
const smtpPort = Number(process.env.SMTP_PORT || 587);
const imapHost = process.env.IMAP_HOST || '127.0.0.1';
const imapPort = Number(process.env.IMAP_PORT || 143);

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const timestamp = Date.now();
const directSubject = `OMS direct SMTP smoke ${timestamp}`;
const webmailSubject = `OMS webmail smoke ${timestamp}`;
const directAttachmentName = `oms-direct-${timestamp}.txt`;
const webmailAttachmentName = `oms-webmail-${timestamp}.txt`;
const directAttachmentText = `direct smtp attachment ${timestamp}`;
const webmailAttachmentText = `webmail api attachment ${timestamp}`;

function imapClient() {
  return new ImapFlow({
    host: imapHost,
    port: imapPort,
    secure: false,
    auth: { user, pass },
    tls: {
      rejectUnauthorized: false,
      checkServerIdentity: () => undefined
    },
    logger: false
  });
}

async function findInboxMessage(subject) {
  const client = imapClient();
  await client.connect();
  try {
    const mailbox = await client.mailboxOpen('INBOX');
    if (!mailbox.exists) return null;
    const start = Math.max(1, mailbox.exists - 49);
    const found = [];
    for await (const msg of client.fetch(`${start}:*`, { uid: true, flags: true, source: true })) {
      const parsed = await simpleParser(msg.source);
      if (parsed.subject === subject) {
        found.push({ uid: msg.uid, flags: Array.from(msg.flags || []), parsed });
      }
    }
    found.sort((a, b) => b.uid - a.uid);
    return found[0] || null;
  } finally {
    try { await client.mailboxClose(); } catch (e) {}
    await client.logout();
  }
}

async function waitForInboxMessage(subject, attachmentName, attachmentText) {
  const deadline = Date.now() + 60000;
  let last = null;
  while (Date.now() < deadline) {
    last = await findInboxMessage(subject);
    if (last) {
      const attachments = last.parsed.attachments || [];
      const attachment = attachments.find(item => item.filename === attachmentName);
      if (!attachment) throw new Error(`Delivered message ${subject} is missing attachment ${attachmentName}`);
      if (!attachment.content || attachment.content.toString('utf8') !== attachmentText) {
        throw new Error(`Delivered attachment ${attachmentName} content mismatch`);
      }
      return last;
    }
    await sleep(3000);
  }
  throw new Error(`Timed out waiting for ${subject} in INBOX`);
}

async function sendDirectSmtp() {
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: false,
    requireTLS: smtpPort === 587,
    auth: { user, pass },
    tls: { rejectUnauthorized: false }
  });

  await transporter.sendMail({
    from: user,
    to: user,
    subject: directSubject,
    text: `Direct SMTP smoke body ${timestamp}`,
    attachments: [{
      filename: directAttachmentName,
      content: directAttachmentText
    }]
  });
}

function cookieFrom(setCookie) {
  if (!setCookie) throw new Error('Login did not return a session cookie');
  return setCookie.split(',').map(part => part.trim()).find(part => part.startsWith('oms_session='))?.split(';')[0]
    || setCookie.split(';')[0];
}

async function apiFetch(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }
  return { response, body };
}

async function sendViaWebmailApi() {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass })
  });
  const loginBody = await login.json().catch(() => ({}));
  if (!login.ok || !loginBody.success) {
    throw new Error(`webmail login failed: HTTP ${login.status} ${JSON.stringify(loginBody)}`);
  }
  const cookie = cookieFrom(login.headers.get('set-cookie'));

  const form = new FormData();
  form.set('to', user);
  form.set('subject', webmailSubject);
  form.set('text', `Webmail API smoke body ${timestamp}`);
  form.set('html', `<p>Webmail API smoke body ${timestamp}</p>`);
  form.append('attachments', new Blob([webmailAttachmentText], { type: 'text/plain' }), webmailAttachmentName);

  const send = await fetch(`${baseUrl}/api/messages/send`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form
  });
  const sendBody = await send.json().catch(() => ({}));
  if (!send.ok || !sendBody.success) {
    throw new Error(`webmail send failed: HTTP ${send.status} ${JSON.stringify(sendBody)}`);
  }

  const delivered = await waitForInboxMessage(webmailSubject, webmailAttachmentName, webmailAttachmentText);
  const list = await apiFetch('/api/folders/INBOX/messages', { headers: { Cookie: cookie } });
  const listed = (list.body.messages || []).find(message => message.subject === webmailSubject);
  if (!listed) throw new Error('webmail API message list did not include the smoke message');

  const detail = await apiFetch(`/api/folders/INBOX/messages/${delivered.uid}`, { headers: { Cookie: cookie } });
  const attachments = detail.body.message?.attachments || [];
  const attachment = attachments.find(item => item.filename === webmailAttachmentName);
  if (!attachment) throw new Error('webmail API detail did not expose the smoke attachment');

  const download = await fetch(`${baseUrl}/api/folders/INBOX/messages/${delivered.uid}/attachments/${attachment.id}`, {
    headers: { Cookie: cookie }
  });
  if (!download.ok) throw new Error(`webmail attachment download returned HTTP ${download.status}`);
  const downloadedText = await download.text();
  if (downloadedText !== webmailAttachmentText) {
    throw new Error('webmail attachment download content mismatch');
  }

  await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: { Cookie: cookie } }).catch(() => {});
}

(async () => {
  await sendDirectSmtp();
  await waitForInboxMessage(directSubject, directAttachmentName, directAttachmentText);
  await sendViaWebmailApi();
  console.log('PASS: mail sync smoke completed');
})().catch(err => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});
NODE
