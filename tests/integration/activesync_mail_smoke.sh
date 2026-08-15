#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${OMS_SMOKE_BASE_URL:-https://mail.housevo.us}
SMOKE_USER=${OMS_SMOKE_USER:-}
SMOKE_PASSWORD=${OMS_SMOKE_PASSWORD:-}
SMTP_HOST=${OMS_SMOKE_SMTP_HOST:-127.0.0.1}
SMTP_PORT=${OMS_SMOKE_SMTP_PORT:-587}
IMAP_HOST=${OMS_SMOKE_IMAP_HOST:-127.0.0.1}
IMAP_PORT=${OMS_SMOKE_IMAP_PORT:-143}
IMAP_SECURE=${OMS_SMOKE_IMAP_SECURE:-false}
IMAP_SERVER_NAME=${OMS_SMOKE_IMAP_SERVER_NAME:-}
IMAP_REJECT_UNAUTHORIZED=${OMS_SMOKE_IMAP_REJECT_UNAUTHORIZED:-false}
SMTP_SERVER_NAME=${OMS_SMOKE_SMTP_SERVER_NAME:-}
SMTP_REJECT_UNAUTHORIZED=${OMS_SMOKE_SMTP_REJECT_UNAUTHORIZED:-false}
DEVICE_ID=${OMS_SMOKE_DEVICE_ID:-OMSEASMailSmoke}
PROTOCOL_PROFILE=${OMS_SMOKE_PROTOCOL_PROFILE:-suite}
NETWORK_TIMEOUT_MS=${OMS_SMOKE_NETWORK_TIMEOUT_MS:-15000}
CLEANUP_ONLY=${OMS_SMOKE_CLEANUP_ONLY:-0}

case "${PROTOCOL_PROFILE}" in
  mail|suite) ;;
  *)
    echo "FAIL: OMS_SMOKE_PROTOCOL_PROFILE must be mail or suite" >&2
    exit 1
    ;;
esac
case "${CLEANUP_ONLY}" in
  0|1) ;;
  *)
    echo "FAIL: OMS_SMOKE_CLEANUP_ONLY must be 0 or 1" >&2
    exit 1
    ;;
esac

if [[ -z "${SMOKE_USER}" || -z "${SMOKE_PASSWORD}" ]]; then
  echo "SKIP: set OMS_SMOKE_USER and OMS_SMOKE_PASSWORD to run authenticated ActiveSync mail smoke checks"
  exit 0
fi

export BASE_URL SMOKE_USER SMOKE_PASSWORD SMTP_HOST SMTP_PORT IMAP_HOST IMAP_PORT
export IMAP_SECURE IMAP_SERVER_NAME IMAP_REJECT_UNAUTHORIZED SMTP_SERVER_NAME SMTP_REJECT_UNAUTHORIZED
export DEVICE_ID PROTOCOL_PROFILE NETWORK_TIMEOUT_MS CLEANUP_ONLY

node <<'NODE'
const nodemailer = require('./webmail-backend/node_modules/nodemailer');
const { ImapFlow } = require('./webmail-backend/node_modules/imapflow');
const { simpleParser } = require('./webmail-backend/node_modules/mailparser');
const { createHash } = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { WbxmlWriter } = require('./webmail-backend/src/wbxml/writer.js');
const { WbxmlParser } = require('./webmail-backend/src/wbxml/parser.js');

const baseUrl = process.env.BASE_URL.replace(/\/$/, '');
const user = process.env.SMOKE_USER;
const pass = process.env.SMOKE_PASSWORD;
const smtpHost = process.env.SMTP_HOST || '127.0.0.1';
const smtpPort = Number(process.env.SMTP_PORT || 587);
const imapHost = process.env.IMAP_HOST || '127.0.0.1';
const imapPort = Number(process.env.IMAP_PORT || 143);
const imapSecure = process.env.IMAP_SECURE === 'true';
const imapServerName = process.env.IMAP_SERVER_NAME || '';
const imapRejectUnauthorized = process.env.IMAP_REJECT_UNAUTHORIZED === 'true';
const smtpServerName = process.env.SMTP_SERVER_NAME || '';
const smtpRejectUnauthorized = process.env.SMTP_REJECT_UNAUTHORIZED === 'true';
const protocolProfile = process.env.PROTOCOL_PROFILE || 'suite';
const cleanupOnly = process.env.CLEANUP_ONLY === '1';
const networkTimeoutMs = Number(process.env.NETWORK_TIMEOUT_MS || 15000);
const MAX_SELECTABLE_MAILBOXES = 512;
const MAX_MAILBOX_PATH_BYTES = 1024;
const MAX_MAILBOX_PATHS_BYTES = 256 * 1024;
const MAIL_CLEANUP_QUIET_MS = Number(process.env.OMS_SMOKE_MAIL_CLEANUP_QUIET_MS || 10000);
const MAIL_CLEANUP_DEADLINE_MS = Number(process.env.OMS_SMOKE_MAIL_CLEANUP_DEADLINE_MS || 90000);
const MAIL_CLEANUP_POLL_MS = Number(process.env.OMS_SMOKE_MAIL_CLEANUP_POLL_MS || 1000);
const POSTQUEUE_BIN = process.env.OMS_SMOKE_POSTQUEUE_BIN || '/usr/sbin/postqueue';
const POSTCAT_BIN = process.env.OMS_SMOKE_POSTCAT_BIN || '/usr/sbin/postcat';
const POSTSUPER_BIN = process.env.OMS_SMOKE_POSTSUPER_BIN || '/usr/sbin/postsuper';
const execFileAsync = promisify(execFile);
if (!Number.isInteger(networkTimeoutMs) || networkTimeoutMs < 1000 || networkTimeoutMs > 60000) {
  throw new Error('OMS_SMOKE_NETWORK_TIMEOUT_MS must be an integer from 1000 through 60000');
}
if (![MAIL_CLEANUP_QUIET_MS, MAIL_CLEANUP_DEADLINE_MS, MAIL_CLEANUP_POLL_MS]
  .every(value => Number.isInteger(value) && value >= 100 && value <= 300000)
  || MAIL_CLEANUP_QUIET_MS >= MAIL_CLEANUP_DEADLINE_MS
  || MAIL_CLEANUP_POLL_MS > MAIL_CLEANUP_QUIET_MS) {
  throw new Error('mail cleanup timing bounds are invalid');
}
const timestamp = Date.now();
const subject = `OMS ActiveSync mail smoke ${timestamp}`;
const bodyPrefix = `ActiveSync mail smoke body ${timestamp}`;
const body = `${bodyPrefix} ${'x'.repeat(700)}`;
const deviceId = process.env.DEVICE_ID || 'OMSEASMailSmoke';

function messageIdForCanary(mailbox, durableDeviceId) {
  const digest = createHash('sha256')
    .update('openmailstack-protocol-mail-canary\0', 'utf8')
    .update(String(mailbox).trim().toLowerCase(), 'utf8')
    .update('\0', 'utf8')
    .update(String(durableDeviceId), 'utf8')
    .digest('hex');
  return `<oms-protocol-${digest}@openmailstack.invalid>`;
}

const messageId = messageIdForCanary(user, deviceId);
let inboxCollectionId = '';
let junkCollectionId = '';
let trashCollectionId = '';
let resolvedImapFolders = null;
let webmailCookie = '';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fetchWithTimeout = (url, options = {}) => fetch(url, {
  ...options,
  signal: AbortSignal.timeout(networkTimeoutMs),
});

function imapClient() {
  const tls = { rejectUnauthorized: imapRejectUnauthorized };
  if (imapServerName) tls.servername = imapServerName;
  return new ImapFlow({
    host: imapHost,
    port: imapPort,
    secure: imapSecure,
    auth: { user, pass },
    tls,
    logger: false,
    connectionTimeout: networkTimeoutMs,
    greetingTimeout: networkTimeoutMs,
    socketTimeout: networkTimeoutMs,
  });
}

function writeWbxml(node) {
  const writer = new WbxmlWriter();
  writer.writeNode(node);
  return writer.getBuffer();
}

function parseWbxml(buffer) {
  return new WbxmlParser(Buffer.from(buffer)).parse();
}

function walk(node, visitor) {
  if (!node) return;
  visitor(node);
  for (const child of node.children || []) walk(child, visitor);
}

function child(node, tag) {
  return (node.children || []).find(item => item.tag === tag);
}

function text(node, tag) {
  const value = child(node, tag)?.content;
  return value === undefined ? '' : value.toString();
}

function descendants(node, tag) {
  const nodes = [];
  walk(node, current => {
    if (current.tag === tag) nodes.push(current);
  });
  return nodes;
}

function validateMailChangeResponse(ast, serverId, syncKey, profile = protocolProfile) {
  const collection = descendants(ast, 'Collection').find(node => child(node, 'SyncKey') && child(node, 'CollectionId'));
  if (text(collection, 'Status') !== '1') throw new Error('Mail Sync Change did not return collection Status 1');
  const responses = child(collection, 'Responses');
  if (profile === 'suite' && responses) {
    throw new Error('Successful Mail Sync Change unexpectedly returned Responses');
  }
  if (profile === 'mail' && responses) {
    const responseChildren = responses.children || [];
    const matching = responseChildren.filter(node => (
      node.tag === 'Change' && text(node, 'ServerId') === serverId && text(node, 'Status') === '1'
    ));
    if (responseChildren.length !== 1 || matching.length !== 1) {
      throw new Error('Legacy Mail Sync Change did not return one successful response');
    }
  }
  const nextKey = descendants(ast, 'SyncKey').find(node => node.page === 0)?.content?.toString();
  if (!nextKey || nextKey === syncKey) throw new Error('Mail Sync Change did not return a new SyncKey');
  return nextKey;
}

function validateItemOperationsFetchResponse(ast, serverId) {
  if (ast?.tag !== 'ItemOperations' || ast?.page !== 20) {
    throw new Error('ItemOperations Fetch returned an invalid response root');
  }
  if (text(ast, 'Status') !== '1') {
    throw new Error(`ItemOperations returned Status ${text(ast, 'Status') || '(missing)'}`);
  }
  const responseFetch = descendants(ast, 'Fetch').find(node => (
    node.page === 20 && descendants(node, 'ServerId').some(id => (
      id.content?.toString() === serverId && id.page === 0
    ))
  ));
  if (!responseFetch || text(responseFetch, 'Status') !== '1') {
    throw new Error(`ItemOperations Fetch did not return ${serverId}`);
  }
  const properties = descendants(responseFetch, 'Properties').find(node => node.page === 20);
  const bodyNode = descendants(properties, 'Body').find(node => node.page === 17);
  const bodyType = text(bodyNode, 'Type');
  if (!bodyNode || bodyType !== '4') {
    throw new Error('ItemOperations Fetch did not return a Type-4 MIME body');
  }
  if (!text(bodyNode, 'Data').includes(bodyPrefix)) {
    throw new Error('ItemOperations Fetch returned no smoke message content');
  }
  if (child(bodyNode, 'Truncated')) {
    throw new Error('ItemOperations Fetch unexpectedly truncated the smoke message');
  }
}

async function sendSeedMessage() {
  const tls = { rejectUnauthorized: smtpRejectUnauthorized };
  if (smtpServerName) tls.servername = smtpServerName;
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: false,
    requireTLS: smtpPort === 587,
    auth: { user, pass },
    tls,
    connectionTimeout: networkTimeoutMs,
    greetingTimeout: networkTimeoutMs,
    socketTimeout: networkTimeoutMs,
  });

  try {
    await transporter.sendMail({
      from: user,
      to: user,
      messageId,
      subject,
      text: body,
    });
  } finally {
    transporter.close();
  }
}

function mailboxFlags(mailbox) {
  return Array.from(mailbox.flags || []).map(flag => String(flag).toLowerCase());
}

function mailboxLeafName(mailbox) {
  const delimiter = typeof mailbox.delimiter === 'string' && mailbox.delimiter ? mailbox.delimiter : '/';
  return String(mailbox.path).split(delimiter).pop().toUpperCase();
}

function resolveMailboxRole(mailboxes, role, specialUse, fallbackNames) {
  const specialMatches = mailboxes.filter(mailbox => String(mailbox.specialUse || '').toLowerCase() === specialUse);
  const candidates = specialMatches.length > 0
    ? specialMatches
    : mailboxes.filter(mailbox => fallbackNames.includes(mailboxLeafName(mailbox)));
  if (candidates.length !== 1) {
    throw new Error(`IMAP folder discovery could not resolve exactly one ${role} mailbox`);
  }
  return candidates[0];
}

function resolveListedImapFolders(listed, { requireSpecialUse = true } = {}) {
  if (!Array.isArray(listed)) throw new Error('IMAP folder discovery returned no mailbox list');
  const mailboxes = listed.filter(mailbox => {
    if (!mailbox || typeof mailbox.path !== 'string' || !mailbox.path
        || /[\u0000-\u001f\u007f]/.test(mailbox.path)) {
      throw new Error('IMAP folder discovery returned an invalid mailbox path');
    }
    if (Buffer.byteLength(mailbox.path, 'utf8') > MAX_MAILBOX_PATH_BYTES) {
      throw new Error('IMAP mailbox path exceeds the cleanup safety bound');
    }
    return !mailboxFlags(mailbox).includes('\\noselect');
  });
  if (mailboxes.length > MAX_SELECTABLE_MAILBOXES) {
    throw new Error('IMAP folder discovery returned too many selectable mailboxes');
  }
  const selectablePaths = mailboxes.map(mailbox => mailbox.path);
  if (new Set(selectablePaths).size !== selectablePaths.length) {
    throw new Error('IMAP folder discovery returned a duplicate selectable mailbox path');
  }
  const pathBytes = selectablePaths.reduce((total, folderPath) => (
    total + Buffer.byteLength(folderPath, 'utf8')
  ), 0);
  if (pathBytes > MAX_MAILBOX_PATHS_BYTES) {
    throw new Error('IMAP mailbox paths exceed the aggregate cleanup safety bound');
  }
  if (!requireSpecialUse) return { selectablePaths };
  const inbox = resolveMailboxRole(mailboxes, 'Inbox', '\\inbox', ['INBOX']);
  const junk = resolveMailboxRole(mailboxes, 'Junk', '\\junk', ['JUNK', 'JUNK E-MAIL', 'SPAM']);
  const trash = resolveMailboxRole(mailboxes, 'Trash', '\\trash', ['TRASH', 'DELETED ITEMS', 'DELETED MESSAGES']);
  if (new Set([inbox.path, junk.path, trash.path]).size !== 3) {
    throw new Error('IMAP folder discovery resolved duplicate special-use mailboxes');
  }
  return { inbox, junk, trash, selectablePaths };
}

async function resolveImapFolders(requireSpecialUse = !cleanupOnly) {
  const client = imapClient();
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const listed = await client.list();
    resolvedImapFolders = resolveListedImapFolders(listed, { requireSpecialUse });
    return resolvedImapFolders;
  } finally {
    if (connected) await client.logout();
  }
}

async function withMailbox(client, folderPath, action) {
  await client.mailboxOpen(folderPath);
  try {
    return await action();
  } finally {
    await client.mailboxClose();
  }
}

async function findExactSeedMessages(client) {
  const candidateUids = await client.search({ header: { 'message-id': messageId } }, { uid: true });
  if (!Array.isArray(candidateUids)) {
    throw new Error('IMAP Message-ID search returned no verifiable result');
  }
  if (candidateUids.length === 0) return [];

  const matches = [];
  const fetchedUids = new Set();
  for await (const msg of client.fetch(
    candidateUids,
    { uid: true, flags: true, source: true },
    { uid: true },
  )) {
    if (!Number.isSafeInteger(msg.uid) || !msg.source) {
      throw new Error('IMAP Message-ID verification returned an invalid message');
    }
    fetchedUids.add(msg.uid);
    const parsed = await simpleParser(msg.source);
    if (parsed.messageId === messageId) {
      matches.push({
        uid: msg.uid,
        flags: Array.from(msg.flags || []),
        text: parsed.text || '',
      });
    }
  }
  if (fetchedUids.size !== new Set(candidateUids).size) {
    throw new Error('IMAP Message-ID verification did not fetch every search result');
  }
  matches.sort((a, b) => b.uid - a.uid);
  return matches;
}

async function findSeedMessage(folderPath) {
  const client = imapClient();
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const matches = await withMailbox(client, folderPath, () => findExactSeedMessages(client));
    if (matches.length > 1) throw new Error('IMAP Message-ID search found duplicate canary messages');
    return matches[0] || null;
  } finally {
    if (connected) await client.logout();
  }
}

async function waitForSeedMessage(folderPath, role) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const found = await findSeedMessage(folderPath);
    if (found) return found;
    await sleep(3000);
  }
  throw new Error(`Timed out waiting for ActiveSync smoke message in ${role}`);
}

async function assertNoSeedMessages(client, cleanupFolders) {
  for (const folderPath of cleanupFolders) {
    const matches = await withMailbox(client, folderPath, () => findExactSeedMessages(client));
    if (matches.length !== 0) {
      throw new Error('IMAP cleanup verification found remaining canary artifacts');
    }
  }
}

async function deleteSeedMessages(client, cleanupFolders) {
  let deletedCount = 0;
  for (const folderPath of cleanupFolders) {
    await withMailbox(client, folderPath, async () => {
      const matches = await findExactSeedMessages(client);
      if (matches.length === 0) return;
      const deleted = await client.messageDelete(matches.map(match => match.uid), { uid: true });
      if (!deleted) throw new Error('IMAP cleanup could not delete exact canary artifacts');
      deletedCount += matches.length;
    });
  }
  await assertNoSeedMessages(client, cleanupFolders);
  return deletedCount;
}

async function cleanupSeedMailboxesOnce() {
  const cleanupImapFolders = await resolveImapFolders();
  const cleanupFolders = cleanupImapFolders.selectablePaths;
  const client = imapClient();
  let connected = false;
  try {
    await client.connect();
    connected = true;
    return await deleteSeedMessages(client, cleanupFolders);
  } finally {
    if (connected) await client.logout();
  }
}

function queueEntryTargetsCanary(entry) {
  return entry && String(entry.sender || '').toLowerCase() === user.toLowerCase()
    && Array.isArray(entry.recipients)
    && entry.recipients.some(recipient => String(recipient?.address || '').toLowerCase() === user.toLowerCase());
}

function headersContainExactSeedMessageId(headers) {
  const unfolded = String(headers || '').replace(/\r?\n[ \t]+/g, ' ');
  const values = unfolded.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^message-id\s*:\s*(.*?)\s*$/i);
    return match ? [match[1]] : [];
  });
  return values.length === 1 && values[0] === messageId;
}

async function boundedExecFile(binary, args, maxBuffer) {
  const result = await execFileAsync(binary, args, {
    encoding: 'utf8',
    timeout: networkTimeoutMs,
    maxBuffer,
    windowsHide: true,
  });
  return String(result.stdout || '');
}

async function exactQueuedSeedMessageIds() {
  const output = await boundedExecFile(POSTQUEUE_BIN, ['-j'], 8 * 1024 * 1024);
  const lines = output.split(/\r?\n/).filter(Boolean);
  if (lines.length > 10000) throw new Error('Postfix queue exceeds the canary cleanup safety bound');
  const candidates = [];
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      throw new Error('Postfix queue returned malformed JSON');
    }
    if (!queueEntryTargetsCanary(entry)) continue;
    const queueId = String(entry.queue_id || '');
    if (!/^[A-Za-z0-9]{5,64}$/.test(queueId)) throw new Error('Postfix queue returned an invalid queue id');
    const headers = await boundedExecFile(POSTCAT_BIN, ['-qh', queueId], 512 * 1024);
    if (headersContainExactSeedMessageId(headers)) candidates.push(queueId);
  }
  return candidates;
}

async function removeExactQueuedSeedMessages() {
  const queueIds = await exactQueuedSeedMessageIds();
  for (const queueId of queueIds) {
    await boundedExecFile(POSTSUPER_BIN, ['-d', queueId], 64 * 1024);
  }
  return queueIds.length;
}

async function reconcileSeedCleanup({
  cleanupMailboxes = cleanupSeedMailboxesOnce,
  cleanupQueue = removeExactQueuedSeedMessages,
  quietWindowMs = MAIL_CLEANUP_QUIET_MS,
  deadlineMs = MAIL_CLEANUP_DEADLINE_MS,
  pollMs = MAIL_CLEANUP_POLL_MS,
  now = Date.now,
  wait = sleep,
} = {}) {
  const startedAt = now();
  let quietSince = null;
  while (true) {
    const mailboxArtifacts = await cleanupMailboxes();
    const queuedArtifacts = await cleanupQueue();
    const checkedAt = now();
    if (mailboxArtifacts > 0 || queuedArtifacts > 0) {
      quietSince = null;
    } else if (quietSince === null) {
      quietSince = checkedAt;
    } else if (checkedAt - quietSince >= quietWindowMs) {
      return;
    }
    if (checkedAt - startedAt >= deadlineMs) {
      throw new Error('Mail canary cleanup deadline expired before a quiet window');
    }
    await wait(Math.min(pollMs, deadlineMs - (checkedAt - startedAt)));
  }
}

async function cleanupSeedMessage() {
  await reconcileSeedCleanup();
}

function cookieFrom(setCookie) {
  if (!setCookie) throw new Error('Webmail login did not return a session cookie');
  return setCookie.split(',').map(part => part.trim()).find(part => part.startsWith('oms_session='))?.split(';')[0]
    || setCookie.split(';')[0];
}

async function loginWebmail() {
  const response = await fetchWithTimeout(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) throw new Error(`Webmail login failed with HTTP ${response.status}`);
  webmailCookie = cookieFrom(response.headers.get('set-cookie'));
}

async function logoutWebmail() {
  if (!webmailCookie) return;
  const response = await fetchWithTimeout(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Cookie: webmailCookie },
  });
  if (!response.ok) throw new Error(`Webmail logout failed with HTTP ${response.status}`);
  webmailCookie = '';
}

async function webmailMessageAction(folder, uid, action) {
  const response = await fetchWithTimeout(`${baseUrl}/api/messages/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: webmailCookie },
    body: JSON.stringify({ folder, uids: [uid], action }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.success) {
    throw new Error(`Webmail ${action} action failed with HTTP ${response.status}`);
  }
}

async function easRequest(cmd, bodyBuffer) {
  const url = `${baseUrl}/Microsoft-Server-ActiveSync?Cmd=${encodeURIComponent(cmd)}&User=${encodeURIComponent(user)}&DeviceId=${deviceId}&DeviceType=CodexSmoke`;
  const headers = {
    Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`,
    'Content-Type': 'application/vnd.ms-sync.wbxml',
  };
  const response = await fetchWithTimeout(url, { method: 'POST', headers, body: bodyBuffer });
  const body = Buffer.from(await response.arrayBuffer());
  if (!response.ok) {
    throw new Error(`ActiveSync ${cmd} returned HTTP ${response.status}`);
  }
  return parseWbxml(body);
}

async function folderSync() {
  const request = writeWbxml({
    tag: 'FolderSync',
    page: 7,
    children: [{ tag: 'SyncKey', page: 7, content: '0' }],
  });
  const ast = await easRequest('FolderSync', request);
  const status = descendants(ast, 'Status').find(node => node.page === 7)?.content?.toString();
  if (status !== '1') throw new Error(`FolderSync returned Status ${status || '(missing)'}`);
  const folders = descendants(ast, 'Add').filter(node => node.page === 7);
  const inbox = folders.find(node => text(node, 'DisplayName').toUpperCase() === 'INBOX' && text(node, 'Type') === '2');
  if (!inbox) throw new Error('FolderSync did not advertise INBOX as an Email folder');
  const junk = folders.find(node => ['JUNK', 'JUNK E-MAIL', 'SPAM'].includes(text(node, 'DisplayName').toUpperCase()));
  const trash = folders.find(node => text(node, 'Type') === '4'
    || ['TRASH', 'DELETED ITEMS', 'DELETED MESSAGES'].includes(text(node, 'DisplayName').toUpperCase()));
  if (!junk) throw new Error('FolderSync did not advertise a Junk folder');
  if (!trash) throw new Error('FolderSync did not advertise a Trash folder');
  const validCollectionId = value => typeof value === 'string' && value.length > 0 && value.length <= 64
    && !/[\u0000-\u001f\u007f]/.test(value);
  inboxCollectionId = text(inbox, 'ServerId');
  junkCollectionId = text(junk, 'ServerId');
  trashCollectionId = text(trash, 'ServerId');
  if (![inboxCollectionId, junkCollectionId, trashCollectionId].every(validCollectionId)) {
    throw new Error('FolderSync returned an invalid mail collection id');
  }
  if (new Set([inboxCollectionId, junkCollectionId, trashCollectionId]).size !== 3) {
    throw new Error('FolderSync returned duplicate mail collection ids');
  }
}

async function syncMail(syncKey, collectionId = inboxCollectionId) {
  const request = writeWbxml({
    tag: 'Sync',
    page: 0,
    children: [{
      tag: 'Collections',
      page: 0,
      children: [{
        tag: 'Collection',
        page: 0,
        children: [
          { tag: 'SyncKey', page: 0, content: syncKey },
          { tag: 'CollectionId', page: 0, content: collectionId },
          ...(syncKey === '0' ? [] : [{ tag: 'GetChanges', page: 0, content: '1' }]),
          { tag: 'WindowSize', page: 0, content: '50' },
          { tag: 'Options', page: 0, children: [
            { tag: 'MIMESupport', page: 0, content: '0' },
            { tag: 'BodyPreference', page: 17, children: [
              { tag: 'Type', page: 17, content: '1' },
              { tag: 'TruncationSize', page: 17, content: '500' },
            ]},
          ]},
        ],
      }],
    }],
  });
  const ast = await easRequest('Sync', request);
  const status = descendants(ast, 'Status').find(node => node.page === 0)?.content?.toString();
  if (status !== '1') throw new Error(`Mail Sync returned Status ${status || '(missing)'}`);
  const nextKey = descendants(ast, 'SyncKey').find(node => node.page === 0)?.content?.toString();
  if (!nextKey || nextKey === syncKey) throw new Error(`Mail Sync returned invalid SyncKey ${nextKey || '(missing)'}`);
  if (syncKey === '0' && protocolProfile === 'suite') {
    const collection = descendants(ast, 'Collection').find(node => child(node, 'SyncKey') && child(node, 'CollectionId'));
    if (child(collection, 'Commands') || child(collection, 'Responses')) {
      throw new Error('Mail key-zero prime returned Commands or Responses');
    }
  }
  return { ast, nextKey };
}

async function initialMailSync(collectionId) {
  const prime = await syncMail('0', collectionId);
  if (protocolProfile === 'mail' && findSmokeAdd(prime.ast)) return prime;
  return syncMail(prime.nextKey, collectionId);
}

async function fetchMailBody(syncKey, serverId) {
  const request = writeWbxml({
    tag: 'Sync',
    page: 0,
    children: [{
      tag: 'Collections',
      page: 0,
      children: [{
        tag: 'Collection',
        page: 0,
        children: [
          { tag: 'SyncKey', page: 0, content: syncKey },
          { tag: 'CollectionId', page: 0, content: inboxCollectionId },
          { tag: 'GetChanges', page: 0, content: '0' },
          { tag: 'Options', page: 0, children: [
            { tag: 'MIMESupport', page: 0, content: '2' },
            { tag: 'BodyPreference', page: 17, children: [
              { tag: 'Type', page: 17, content: '4' },
            ]},
          ]},
          { tag: 'Commands', page: 0, children: [{
            tag: 'Fetch',
            page: 0,
            children: [{ tag: 'ServerId', page: 0, content: serverId }],
          }]},
        ],
      }],
    }],
  });
  const ast = await easRequest('Sync', request);
  const status = descendants(ast, 'Status').find(node => node.page === 0)?.content?.toString();
  if (status !== '1') throw new Error(`Mail body Fetch returned Status ${status || '(missing)'}`);
  const responseFetch = descendants(ast, 'Fetch').find(node => text(node, 'ServerId') === serverId);
  if (!responseFetch || text(responseFetch, 'Status') !== '1') {
    throw new Error(`Mail body Fetch did not return ${serverId}`);
  }
  const appData = child(responseFetch, 'ApplicationData');
  const bodyNode = descendants(appData, 'Body').find(node => node.page === 17);
  if (!bodyNode || text(bodyNode, 'Type') !== '4') throw new Error('Mail body Fetch did not return MIME');
  if (!text(bodyNode, 'Data').includes(bodyPrefix)) throw new Error('Mail body Fetch returned MIME headers without message content');
  if (child(bodyNode, 'Truncated')) throw new Error('Mail body Fetch without TruncationSize was unexpectedly truncated');
  const nextKey = descendants(ast, 'SyncKey').find(node => node.page === 0)?.content?.toString();
  if (!nextKey || nextKey === syncKey) throw new Error(`Mail body Fetch returned invalid SyncKey ${nextKey || '(missing)'}`);
  return nextKey;
}

async function itemOperationsFetchMailBody(serverId) {
  const request = writeWbxml({
    tag: 'ItemOperations',
    page: 20,
    children: [{
      tag: 'Fetch',
      page: 20,
      children: [
        { tag: 'Store', page: 20, content: 'Mailbox' },
        { tag: 'CollectionId', page: 0, content: inboxCollectionId },
        { tag: 'ServerId', page: 0, content: serverId },
        { tag: 'Options', page: 20, children: [{
          tag: 'BodyPreference',
          page: 17,
          children: [
            { tag: 'Type', page: 17, content: '4' },
            { tag: 'TruncationSize', page: 17, content: '4096' },
          ],
        }]},
      ],
    }],
  });
  const ast = await easRequest('ItemOperations', request);
  validateItemOperationsFetchResponse(ast, serverId);
}

async function fetchRequiredMailBodies(profile, syncKey, serverId, {
  itemOperationsFetch = itemOperationsFetchMailBody,
  syncFetch = fetchMailBody,
} = {}) {
  if (profile === 'suite') {
    await itemOperationsFetch(serverId);
  } else if (profile !== 'mail') {
    throw new Error(`Unsupported mail smoke profile: ${profile}`);
  }
  return syncFetch(syncKey, serverId);
}

function profilePassMessage(profile) {
  if (profile === 'suite') {
    return 'PASS: ActiveSync mail smoke completed (suite profile): ItemOperations Type-4 no-truncation, Sync Type-4 full MIME Fetch, read/unread, efficient no-change Sync, and Junk/Trash delete propagation';
  }
  if (profile === 'mail') {
    return 'PASS: ActiveSync mail smoke completed (legacy mail profile): public IMAPS body retrieval, Sync Type-4 full MIME Fetch, read/unread, efficient no-change Sync, and Junk/Trash delete propagation; ItemOperations deferred to suite profile';
  }
  throw new Error(`Unsupported mail smoke profile: ${profile}`);
}

function findSmokeAdd(ast) {
  return descendants(ast, 'Add').find(node => {
    const appData = child(node, 'ApplicationData');
    return appData && text(appData, 'Subject') === subject;
  });
}

function findServerCommand(ast, commandTag, serverId) {
  return descendants(ast, commandTag).find(node => text(node, 'ServerId') === serverId && !child(node, 'Status'));
}

function assertNoServerCommands(ast) {
  const collection = descendants(ast, 'Collection').find(node => child(node, 'SyncKey') && child(node, 'CollectionId'));
  const commands = collection && child(collection, 'Commands');
  if (commands && (commands.children || []).length) {
    throw new Error(`Expected no-change Sync to return no server commands, got ${(commands.children || []).map(node => node.tag).join(', ')}`);
  }
}

async function changeReadFlag(serverId, syncKey, readValue) {
  const request = writeWbxml({
    tag: 'Sync',
    page: 0,
    children: [{
      tag: 'Collections',
      page: 0,
      children: [{
        tag: 'Collection',
        page: 0,
        children: [
          { tag: 'SyncKey', page: 0, content: syncKey },
          { tag: 'CollectionId', page: 0, content: inboxCollectionId },
          { tag: 'Commands', page: 0, children: [{
            tag: 'Change',
            page: 0,
            children: [
              { tag: 'ServerId', page: 0, content: serverId },
              { tag: 'ApplicationData', page: 0, children: [
                { tag: 'Read', page: 2, content: readValue },
              ]},
            ],
          }]},
        ],
      }],
    }],
  });
  const ast = await easRequest('Sync', request);
  return validateMailChangeResponse(ast, serverId, syncKey);
}

async function assertSeenState(expectedSeen) {
  const found = await findSeedMessage(resolvedImapFolders.inbox.path);
  if (!found) throw new Error('Seed message disappeared before cleanup');
  const seen = found.flags.includes('\\Seen');
  if (seen !== expectedSeen) {
    throw new Error(`Expected IMAP \\Seen=${expectedSeen}, got ${seen}`);
  }
}

(async () => {
  try {
    await resolveImapFolders();
    await cleanupSeedMessage();
    if (cleanupOnly) {
      console.log('PASS: ActiveSync mail smoke removed and proved zero exact mailbox and Postfix canary residue');
      return;
    }
    await sendSeedMessage();
    const seededMessage = await waitForSeedMessage(resolvedImapFolders.inbox.path, 'Inbox');
    if (!seededMessage.text.includes(bodyPrefix)) {
      throw new Error('Public IMAP retrieved the smoke message without its expected body content');
    }
    await folderSync();
    await loginWebmail();
    const initial = await initialMailSync(inboxCollectionId);
    const smokeAdd = findSmokeAdd(initial.ast);
    if (!smokeAdd) throw new Error('Initial mail Sync did not include the seeded smoke message');

    const serverId = text(smokeAdd, 'ServerId');
    const appData = child(smokeAdd, 'ApplicationData');
    if (!serverId) throw new Error('Seeded smoke message had no ServerId in mail Sync response');
    if (text(appData, 'Read') !== '0') throw new Error('Seeded smoke message should start unread in ActiveSync response');
    if (text(appData, 'MessageClass') !== 'IPM.Note') throw new Error('Seeded smoke message did not return IPM.Note');
    const bodyData = descendants(appData, 'Data').map(node => node.content?.toString() || '').join('\n');
    if (!bodyData.includes(bodyPrefix)) throw new Error('Seeded smoke message body prefix was not returned in ActiveSync response');
    const bodyNode = descendants(appData, 'Body').find(node => node.page === 17);
    if (!bodyNode || text(bodyNode, 'Truncated') !== '1') throw new Error('Mail Sync did not honor body truncation');
    if (Buffer.byteLength(text(bodyNode, 'Data')) > 500) throw new Error('Mail Sync body exceeded requested TruncationSize');

    const fetchKey = await fetchRequiredMailBodies(
      protocolProfile,
      initial.nextKey,
      serverId,
    );
    const readKey = await changeReadFlag(serverId, fetchKey, '1');
    await assertSeenState(true);
    const unreadKey = await changeReadFlag(serverId, readKey, '0');
    await assertSeenState(false);

    const noChange = await syncMail(unreadKey);
    assertNoServerCommands(noChange.ast);

    const inboxMessage = await findSeedMessage(resolvedImapFolders.inbox.path);
    if (!inboxMessage) throw new Error('Seed message missing from Inbox before web spam action');
    await webmailMessageAction(resolvedImapFolders.inbox.path, inboxMessage.uid, 'spam');
    await waitForSeedMessage(resolvedImapFolders.junk.path, 'Junk');
    const inboxAfterJunk = await syncMail(noChange.nextKey);
    if (!findServerCommand(inboxAfterJunk.ast, 'Delete', serverId)) {
      throw new Error('Inbox Sync did not emit Delete after web-style move to Junk');
    }

    const junkInitial = await initialMailSync(junkCollectionId);
    const junkAdd = findSmokeAdd(junkInitial.ast);
    if (!junkAdd) throw new Error('Junk Sync did not emit Add for the moved message');
    const junkServerId = text(junkAdd, 'ServerId');

    const junkMessage = await findSeedMessage(resolvedImapFolders.junk.path);
    if (!junkMessage) throw new Error('Seed message missing from Junk before web delete action');
    await webmailMessageAction(resolvedImapFolders.junk.path, junkMessage.uid, 'delete');
    await waitForSeedMessage(resolvedImapFolders.trash.path, 'Trash');
    const junkAfterTrash = await syncMail(junkInitial.nextKey, junkCollectionId);
    if (!findServerCommand(junkAfterTrash.ast, 'Delete', junkServerId)) {
      throw new Error('Junk Sync did not emit Delete after web-style move to Trash');
    }

    const trashInitial = await initialMailSync(trashCollectionId);
    if (!findSmokeAdd(trashInitial.ast)) throw new Error('Trash Sync did not emit Add for the moved message');

    console.log(profilePassMessage(protocolProfile));
  } finally {
    let cleanupFailed = false;
    if (!cleanupOnly) {
      await cleanupSeedMessage().catch(() => {
        console.error('WARN: cleanup failed: could not prove exact mail canary removal');
        cleanupFailed = true;
      });
    }
    await logoutWebmail().catch(() => {
      console.error('WARN: session cleanup failed: could not close the webmail session');
      cleanupFailed = true;
    });
    if (cleanupFailed) throw new Error('Protocol smoke cleanup did not complete');
  }
})().catch(err => {
  console.error(`FAIL: ${err.message}`);
  process.exit(1);
});
NODE
