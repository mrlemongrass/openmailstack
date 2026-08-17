#!/usr/bin/env bash
set -euo pipefail

# The guarded post-deploy gate runs the two 60-second holds by default. Run
# protocol_release_gate.sh with --require-ping --ping-long for one explicit
# 900-second end-to-end hold under the same exact canary cleanup boundary.

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
BASE_URL=${OMS_SMOKE_BASE_URL:-https://mail.housevo.us}
SMOKE_USER=${OMS_SMOKE_USER:-}
SMOKE_PASSWORD=${OMS_SMOKE_PASSWORD:-}
DEVICE_ID=${OMS_SMOKE_DEVICE_ID:-}
NETWORK_TIMEOUT_MS=${OMS_SMOKE_NETWORK_TIMEOUT_MS:-15000}
SMTP_HOST=${OMS_SMOKE_SMTP_HOST:-127.0.0.1}
SMTP_PORT=${OMS_SMOKE_SMTP_PORT:-587}
SMTP_SERVER_NAME=${OMS_SMOKE_SMTP_SERVER_NAME:-}
SMTP_REJECT_UNAUTHORIZED=${OMS_SMOKE_SMTP_REJECT_UNAUTHORIZED:-false}
IMAP_HOST=${OMS_SMOKE_IMAP_HOST:-127.0.0.1}
IMAP_PORT=${OMS_SMOKE_IMAP_PORT:-143}
IMAP_SECURE=${OMS_SMOKE_IMAP_SECURE:-false}
IMAP_SERVER_NAME=${OMS_SMOKE_IMAP_SERVER_NAME:-}
IMAP_REJECT_UNAUTHORIZED=${OMS_SMOKE_IMAP_REJECT_UNAUTHORIZED:-false}
PING_LONG_MODE=${OMS_SMOKE_PING_LONG_MODE:-0}
FIXTURE_MODE=${OMS_PROTOCOL_GATE_FIXTURE_MODE:-0}
PING_SECOND_MS=${OMS_SMOKE_PING_FIXTURE_SECOND_MS:-1000}

case "${PING_LONG_MODE}" in
  0|1) ;;
  *)
    echo "FAIL: OMS_SMOKE_PING_LONG_MODE must be 0 or 1" >&2
    exit 1
    ;;
esac
case "${FIXTURE_MODE}" in
  0|1) ;;
  *)
    echo "FAIL: OMS_PROTOCOL_GATE_FIXTURE_MODE must be 0 or 1" >&2
    exit 1
    ;;
esac
if [[ -z "${SMOKE_USER}" || -z "${SMOKE_PASSWORD}" ]]; then
  echo "SKIP: set OMS_SMOKE_USER and OMS_SMOKE_PASSWORD to run authenticated ActiveSync Ping smoke checks"
  exit 0
fi
if [[ ! "${DEVICE_ID}" =~ ^[A-Za-z0-9]{1,32}$ ]]; then
  echo "FAIL: OMS_SMOKE_DEVICE_ID must contain 1-32 ASCII letters or digits" >&2
  exit 1
fi
if [[ "${PING_SECOND_MS}" != "1000" && "${FIXTURE_MODE}" != "1" ]]; then
  echo "FAIL: accelerated Ping timing is fixture-only" >&2
  exit 1
fi
fail() {
  echo "FAIL: $1" >&2
  exit 1
}

capture_service_state() {
  local unit
  local state
  if [[ "${FIXTURE_MODE}" == "1" ]]; then
    printf '%s\n' 'fixture-service-state'
    return 0
  fi
  command -v systemctl >/dev/null 2>&1 \
    || fail "systemctl is required for ActiveSync Ping service-state proof"
  for unit in openmailstack.service nginx.service; do
    state=$(systemctl show "${unit}" \
      --property=ActiveState \
      --property=SubState \
      --property=InvocationID \
      --property=NRestarts 2>/dev/null | LC_ALL=C sort) \
      || fail "could not read ${unit} service state"
    grep -Fxq 'ActiveState=active' <<< "${state}" \
      || fail "${unit} is not active"
    grep -Fxq 'SubState=running' <<< "${state}" \
      || fail "${unit} is not running"
    grep -Eq '^InvocationID=[0-9a-f]{32}$' <<< "${state}" \
      || fail "${unit} has no stable invocation identity"
    grep -Eq '^NRestarts=[0-9]+$' <<< "${state}" \
      || fail "${unit} has no restart counter"
    printf 'UNIT=%s\n%s\n' "${unit}" "${state}"
  done
}

service_state_before=$(capture_service_state)

export PROJECT_ROOT BASE_URL SMOKE_USER SMOKE_PASSWORD DEVICE_ID NETWORK_TIMEOUT_MS
export PING_LONG_MODE FIXTURE_MODE PING_SECOND_MS
export SMTP_HOST SMTP_PORT SMTP_SERVER_NAME SMTP_REJECT_UNAUTHORIZED
export IMAP_HOST IMAP_PORT IMAP_SECURE IMAP_SERVER_NAME IMAP_REJECT_UNAUTHORIZED

node <<'NODE'
const path = require('node:path');
const { createHash } = require('node:crypto');
const nodemailer = require(path.join(process.env.PROJECT_ROOT, 'webmail-backend/node_modules/nodemailer'));
const { ImapFlow } = require(path.join(process.env.PROJECT_ROOT, 'webmail-backend/node_modules/imapflow'));
const { Agent, fetch } = require(path.join(process.env.PROJECT_ROOT, 'webmail-backend/node_modules/undici'));

const projectRoot = process.env.PROJECT_ROOT;
const { WbxmlParser } = require(path.join(projectRoot, 'webmail-backend/src/wbxml/parser.js'));
const { WbxmlWriter } = require(path.join(projectRoot, 'webmail-backend/src/wbxml/writer.js'));

const baseUrl = String(process.env.BASE_URL || '').replace(/\/$/, '');
const user = process.env.SMOKE_USER || '';
const pass = process.env.SMOKE_PASSWORD || '';
const deviceId = process.env.DEVICE_ID || '';
const networkTimeoutMs = Number(process.env.NETWORK_TIMEOUT_MS || 15000);
const longMode = process.env.PING_LONG_MODE === '1';
const fixtureMode = process.env.FIXTURE_MODE === '1';
const secondMs = Number(process.env.PING_SECOND_MS || 1000);
const WBXML_CONTENT_TYPE = 'application/vnd.ms-sync.wbxml';
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_SYNC_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_SELECTABLE_MAILBOXES = 512;
const MAX_MAILBOX_PATH_BYTES = 1024;
const MAX_MAILBOX_PATHS_BYTES = 256 * 1024;
const TRANSPORT_TIMEOUT_MS = 1020 * 1000;
const smtpHost = process.env.SMTP_HOST || '127.0.0.1';
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpServerName = process.env.SMTP_SERVER_NAME || '';
const smtpRejectUnauthorized = process.env.SMTP_REJECT_UNAUTHORIZED === 'true';
const imapHost = process.env.IMAP_HOST || '127.0.0.1';
const imapPort = Number(process.env.IMAP_PORT || 143);
const imapSecure = process.env.IMAP_SECURE === 'true';
const imapServerName = process.env.IMAP_SERVER_NAME || '';
const imapRejectUnauthorized = process.env.IMAP_REJECT_UNAUTHORIZED === 'true';
const canaryDigest = createHash('sha256')
  .update('openmailstack-protocol-mail-canary\0', 'utf8')
  .update(user.trim().toLowerCase(), 'utf8')
  .update('\0', 'utf8')
  .update(deviceId, 'utf8')
  .digest('hex');
const canarySuffix = canaryDigest.slice(0, 24);
const canarySubject = `OMS ActiveSync Ping smoke ${deviceId}`;
const canaryMessageId = `<oms-protocol-${canaryDigest}@openmailstack.invalid>`;
const encodedUser = encodeURIComponent(user);
const contactCollectionId = 'contacts';
const expectedPingIdentities = {
  OMS_SMOKE_PING_CONTACT_UID: `oms-ping-contact-${canarySuffix}`,
  OMS_SMOKE_PING_CONTACT_EMAIL: `oms-ping-${canarySuffix}@example.invalid`,
  OMS_SMOKE_PING_CALENDAR_SLUG: `oms-ping-${canarySuffix}`,
  OMS_SMOKE_PING_CALENDAR_NAME: `OMS Ping Calendar ${canarySuffix}`,
  OMS_SMOKE_PING_CALENDAR_EVENT_UID: `oms-ping-event-${canarySuffix}`,
  OMS_SMOKE_PING_CALENDAR_SUBJECT: `OMS Ping Event ${canarySuffix}`,
};
const configuredPingIdentities = Object.keys(expectedPingIdentities)
  .filter(name => process.env[name] !== undefined);
if (configuredPingIdentities.length !== 0
    && configuredPingIdentities.length !== Object.keys(expectedPingIdentities).length) {
  throw new Error('ActiveSync Ping cleanup identities must be supplied as one complete set');
}
for (const [name, expected] of Object.entries(expectedPingIdentities)) {
  if (process.env[name] !== undefined && process.env[name] !== expected) {
    throw new Error(`ActiveSync Ping cleanup identity mismatch for ${name}`);
  }
}
const contactUid = process.env.OMS_SMOKE_PING_CONTACT_UID || expectedPingIdentities.OMS_SMOKE_PING_CONTACT_UID;
const contactName = `OMS Ping Contact ${canarySuffix}`;
const contactEmail = process.env.OMS_SMOKE_PING_CONTACT_EMAIL || expectedPingIdentities.OMS_SMOKE_PING_CONTACT_EMAIL;
const addressBookUrl = `${baseUrl}/carddav/addressbooks/${encodedUser}/personal/`;
const contactUrl = `${addressBookUrl}${contactUid}.vcf`;
const calendarSlug = process.env.OMS_SMOKE_PING_CALENDAR_SLUG || expectedPingIdentities.OMS_SMOKE_PING_CALENDAR_SLUG;
const calendarName = process.env.OMS_SMOKE_PING_CALENDAR_NAME || expectedPingIdentities.OMS_SMOKE_PING_CALENDAR_NAME;
const calendarUid = process.env.OMS_SMOKE_PING_CALENDAR_EVENT_UID || expectedPingIdentities.OMS_SMOKE_PING_CALENDAR_EVENT_UID;
const calendarSubject = process.env.OMS_SMOKE_PING_CALENDAR_SUBJECT || expectedPingIdentities.OMS_SMOKE_PING_CALENDAR_SUBJECT;
const calendarUrl = `${baseUrl}/caldav/calendars/${encodedUser}/${calendarSlug}/`;
const calendarEventUrl = `${calendarUrl}${calendarUid}.ics`;

if (!/^https?:\/\/[^\s]+$/i.test(baseUrl)) {
  throw new Error('OMS_SMOKE_BASE_URL must be an HTTP or HTTPS URL');
}
if (!Number.isInteger(networkTimeoutMs) || networkTimeoutMs < 1000 || networkTimeoutMs > 60000) {
  throw new Error('OMS_SMOKE_NETWORK_TIMEOUT_MS must be an integer from 1000 through 60000');
}
if (!Number.isInteger(secondMs) || secondMs < 1 || secondMs > 1000
    || (!fixtureMode && secondMs !== 1000)) {
  throw new Error('ActiveSync Ping timing scale is invalid');
}
if (![smtpPort, imapPort].every(port => Number.isInteger(port) && port > 0 && port <= 65535)) {
  throw new Error('ActiveSync Ping mail transport port is invalid');
}

const authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
let inboxCollectionId = '';
let calendarCollectionId = '';
let contactCreated = false;
let calendarCreated = false;
let calendarEventCreated = false;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function writeWbxml(node) {
  const writer = new WbxmlWriter();
  writer.writeNode(node);
  return writer.getBuffer();
}

function parseWbxml(buffer, operation) {
  try {
    return new WbxmlParser(Buffer.from(buffer)).parse();
  } catch {
    throw new Error(`${operation} returned malformed WBXML`);
  }
}

function walk(node, visitor) {
  if (!node) return;
  visitor(node);
  for (const nested of node.children || []) walk(nested, visitor);
}

function child(node, tag) {
  return (node?.children || []).find(item => item.tag === tag);
}

function text(node, tag) {
  const content = child(node, tag)?.content;
  return content === undefined ? '' : content.toString();
}

function descendants(node, tag) {
  const matches = [];
  walk(node, current => {
    if (current.tag === tag) matches.push(current);
  });
  return matches;
}

function mediaType(response) {
  return (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
}

async function readBoundedBody(response, operation, maxBytes = MAX_RESPONSE_BYTES) {
  const declared = response.headers.get('content-length');
  if (declared && (!/^[0-9]+$/.test(declared) || Number(declared) > maxBytes)) {
    throw new Error(`${operation} response exceeds the body safety bound`);
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`${operation} response exceeds the body safety bound`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function fetchBounded(url, options, timeoutMs, operation, maxResponseBytes = MAX_RESPONSE_BYTES) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      dispatcher: transportDispatcher,
      headers: { Connection: 'close', ...(options.headers || {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError') throw new Error(`${operation} exceeded its timeout`);
    if (error?.cause?.code === 'UND_ERR_HEADERS_TIMEOUT') {
      throw new Error(`${operation} response headers timed out`);
    }
    if (error?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT') {
      throw new Error(`${operation} connection timed out`);
    }
    throw new Error(`${operation} transport failed`);
  }
  let body;
  try {
    body = await readBoundedBody(response, operation, maxResponseBytes);
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error(`${operation} exceeded its timeout`);
    }
    if (error?.cause?.code === 'UND_ERR_BODY_TIMEOUT') {
      throw new Error(`${operation} response body timed out`);
    }
    throw error;
  }
  return { response, body };
}

async function davRequest(url, {
  method,
  contentType,
  body,
  requestHeaders = {},
  expectedStatuses,
  operation,
}) {
  const headers = { Authorization: authorization, ...requestHeaders };
  if (contentType) headers['Content-Type'] = contentType;
  const { response, body: responseBody } = await fetchBounded(
    url,
    { method, headers, ...(body === undefined ? {} : { body }) },
    networkTimeoutMs,
    operation,
  );
  if (!expectedStatuses.includes(response.status)) {
    throw new Error(`${operation} returned HTTP ${response.status}`);
  }
  return responseBody;
}

const exactCleanupUrls = new Set([contactUrl, calendarEventUrl, calendarUrl]);
async function deleteExactDavUrl(url, operation) {
  if (!exactCleanupUrls.has(url)) throw new Error(`Refusing unexpected Ping cleanup URL for ${operation}`);
  await davRequest(url, {
    method: 'DELETE',
    expectedStatuses: [204, 404],
    operation,
  });
}

async function cleanupDavCanaries() {
  const failures = [];
  for (const [url, operation, owned, release] of [
    [contactUrl, 'CardDAV Ping contact cleanup', contactCreated, () => { contactCreated = false; }],
    [calendarEventUrl, 'CalDAV Ping event cleanup', calendarEventCreated, () => { calendarEventCreated = false; }],
    [calendarUrl, 'CalDAV Ping calendar cleanup', calendarCreated, () => {
      calendarCreated = false;
      calendarEventCreated = false;
    }],
  ]) {
    if (!owned) continue;
    try {
      await deleteExactDavUrl(url, operation);
      release();
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (failures.length) throw new Error(failures.join('; '));
}

async function createDisposableCalendar() {
  const body = `<?xml version="1.0" encoding="utf-8" ?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set><D:prop><D:displayname>${calendarName}</D:displayname>
    <C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>
  </D:prop></D:set>
</C:mkcalendar>`;
  await davRequest(calendarUrl, {
    method: 'MKCALENDAR',
    contentType: 'application/xml; charset=utf-8',
    body,
    expectedStatuses: [201],
    operation: 'CalDAV Ping calendar create',
  });
  calendarCreated = true;
}

async function createContactCanary() {
  const body = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `UID:${contactUid}`,
    `FN:${contactName}`,
    'N:Contact;Ping;;;',
    `EMAIL;TYPE=INTERNET:${contactEmail}`,
    'END:VCARD',
    '',
  ].join('\r\n');
  await davRequest(contactUrl, {
    method: 'PUT',
    contentType: 'text/vcard; charset=utf-8',
    body,
    requestHeaders: { 'If-None-Match': '*' },
    expectedStatuses: [201],
    operation: 'CardDAV Ping contact create',
  });
  contactCreated = true;
}

async function createCalendarCanary() {
  const body = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenMailStack//Ping Smoke//EN',
    'BEGIN:VEVENT',
    `UID:${calendarUid}`,
    'DTSTAMP:20260816T120000Z',
    'DTSTART:20300816T120000Z',
    'DTEND:20300816T123000Z',
    `SUMMARY:${calendarSubject}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
  await davRequest(calendarEventUrl, {
    method: 'PUT',
    contentType: 'text/calendar; charset=utf-8',
    body,
    requestHeaders: { 'If-None-Match': '*' },
    expectedStatuses: [201],
    operation: 'CalDAV Ping event create',
  });
  calendarEventCreated = true;
}

function activeSyncUrl(command) {
  const url = new URL(`${baseUrl}/Microsoft-Server-ActiveSync`);
  url.searchParams.set('Cmd', command);
  url.searchParams.set('User', user);
  url.searchParams.set('DeviceId', deviceId);
  url.searchParams.set('DeviceType', 'CodexSmoke');
  return url;
}

async function verifyPingAdvertisement(label) {
  const { response } = await fetchBounded(
    `${baseUrl}/Microsoft-Server-ActiveSync`,
    { method: 'OPTIONS' },
    networkTimeoutMs,
    `ActiveSync ${label} OPTIONS`,
  );
  if (response.status !== 200) {
    throw new Error(`ActiveSync ${label} OPTIONS returned HTTP ${response.status}`);
  }
  const commands = (response.headers.get('ms-asprotocolcommands') || '')
    .split(',')
    .map(command => command.trim())
    .filter(Boolean);
  if (!commands.includes('Ping')) {
    throw new Error(`ActiveSync ${label} OPTIONS does not advertise Ping`);
  }
}

async function easRequest(command, {
  body,
  includeContentType = true,
  timeoutMs = networkTimeoutMs,
  operation = `ActiveSync ${command}`,
} = {}) {
  const headers = {
    Authorization: authorization,
    'MS-ASProtocolVersion': '14.1',
  };
  if (includeContentType) headers['Content-Type'] = WBXML_CONTENT_TYPE;
  const options = { method: 'POST', headers };
  if (body !== undefined) options.body = body;
  const { response, body: responseBody } = await fetchBounded(
    activeSyncUrl(command),
    options,
    timeoutMs,
    operation,
    command === 'Sync' ? MAX_SYNC_RESPONSE_BYTES : MAX_RESPONSE_BYTES,
  );
  if (response.status !== 200) {
    throw new Error(`${operation} returned HTTP ${response.status}`);
  }
  if (mediaType(response) !== WBXML_CONTENT_TYPE) {
    throw new Error(`${operation} returned invalid Content-Type`);
  }
  if (responseBody.length < 1) throw new Error(`${operation} returned an empty WBXML body`);
  return parseWbxml(responseBody, operation);
}

async function folderSync() {
  const request = writeWbxml({
    tag: 'FolderSync',
    page: 7,
    children: [{ tag: 'SyncKey', page: 7, content: '0' }],
  });
  const ast = await easRequest('FolderSync', { body: request });
  if (ast?.tag !== 'FolderSync' || ast?.page !== 7 || text(ast, 'Status') !== '1') {
    throw new Error('FolderSync did not return page-7 Status 1');
  }
  const adds = descendants(ast, 'Add').filter(node => node.page === 7);
  const inboxes = adds.filter(node => (
    node.page === 7
    && text(node, 'Type') === '2'
    && text(node, 'DisplayName').toUpperCase() === 'INBOX'
  ));
  if (inboxes.length !== 1) throw new Error('FolderSync did not return exactly one Inbox');
  const contacts = adds.filter(node => (
    text(node, 'Type') === '9'
    && text(node, 'DisplayName') === 'Contacts'
    && text(node, 'ServerId') === contactCollectionId
  ));
  if (contacts.length !== 1) throw new Error('FolderSync did not return exactly one Contacts collection');
  const calendars = adds.filter(node => (
    text(node, 'Type') === '13' && text(node, 'DisplayName') === calendarName
  ));
  if (calendars.length !== 1) {
    throw new Error('FolderSync did not return exactly one disposable Ping calendar');
  }
  const inboxId = text(inboxes[0], 'ServerId');
  const calendarId = text(calendars[0], 'ServerId');
  if (!inboxId || Buffer.byteLength(inboxId, 'utf8') > 64
      || /[\u0000-\u001f\u007f]/.test(inboxId)) {
    throw new Error('FolderSync returned an invalid Inbox collection id');
  }
  if (!/^cal-[1-9][0-9]*$/.test(calendarId) || Buffer.byteLength(calendarId, 'utf8') > 64) {
    throw new Error('FolderSync returned an invalid disposable calendar collection id');
  }
  inboxCollectionId = inboxId;
  calendarCollectionId = calendarId;
}

async function syncInbox(syncKey, expectedSubject = '') {
  const request = writeWbxml({
    tag: 'Sync',
    page: 0,
    children: [{ tag: 'Collections', page: 0, children: [{
      tag: 'Collection',
      page: 0,
      children: [
        { tag: 'SyncKey', page: 0, content: syncKey },
        { tag: 'CollectionId', page: 0, content: inboxCollectionId },
        ...(syncKey === '0' ? [] : [{ tag: 'GetChanges', page: 0, content: '1' }]),
        { tag: 'WindowSize', page: 0, content: '50' },
      ],
    }] }],
  });
  const ast = await easRequest('Sync', { body: request });
  if (ast?.tag !== 'Sync' || ast?.page !== 0) throw new Error('Inbox Sync returned an invalid root');
  const collections = descendants(ast, 'Collection').filter(node => node.page === 0);
  if (collections.length !== 1
      || text(collections[0], 'CollectionId') !== inboxCollectionId
      || text(collections[0], 'Status') !== '1') {
    throw new Error('Inbox Sync did not return one successful current collection');
  }
  const nextKey = text(collections[0], 'SyncKey');
  if (!nextKey || nextKey === syncKey || Buffer.byteLength(nextKey, 'utf8') > 128) {
    throw new Error('Inbox Sync returned an invalid next key');
  }
  if (expectedSubject) {
    const matches = descendants(collections[0], 'Add').filter(node => (
      node.page === 0 && text(child(node, 'ApplicationData'), 'Subject') === expectedSubject
    ));
    if (matches.length !== 1) {
      throw new Error('Inbox Sync did not retrieve exactly one Ping canary message');
    }
  }
  return {
    syncKey: nextKey,
    moreAvailable: Boolean(child(collections[0], 'MoreAvailable')),
  };
}

async function drainInboxBaseline(initialSyncKey) {
  let syncKey = initialSyncKey;
  for (let page = 0; page < 64; page += 1) {
    const result = await syncInbox(syncKey);
    syncKey = result.syncKey;
    if (!result.moreAvailable) return syncKey;
  }
  throw new Error('Inbox Sync baseline still has MoreAvailable after 64 bounded pages');
}

async function syncPimCollection(collectionId, syncKey, {
  label,
  expectedTag = '',
  expectedValue = '',
} = {}) {
  const request = writeWbxml({
    tag: 'Sync',
    page: 0,
    children: [{ tag: 'Collections', page: 0, children: [{
      tag: 'Collection',
      page: 0,
      children: [
        { tag: 'SyncKey', page: 0, content: syncKey },
        { tag: 'CollectionId', page: 0, content: collectionId },
        ...(syncKey === '0' ? [] : [{ tag: 'GetChanges', page: 0, content: '1' }]),
        ...(syncKey === '0' ? [] : [{ tag: 'WindowSize', page: 0, content: '512' }]),
      ],
    }] }],
  });
  const ast = await easRequest('Sync', { body: request, operation: `ActiveSync ${label} Sync` });
  if (ast?.tag !== 'Sync' || ast?.page !== 0) throw new Error(`${label} Sync returned an invalid root`);
  const collections = descendants(ast, 'Collection').filter(node => node.page === 0);
  if (collections.length !== 1
      || text(collections[0], 'CollectionId') !== collectionId
      || text(collections[0], 'Status') !== '1') {
    throw new Error(`${label} Sync did not return one successful current collection`);
  }
  const nextKey = text(collections[0], 'SyncKey');
  if (!nextKey || nextKey === syncKey || Buffer.byteLength(nextKey, 'utf8') > 128) {
    throw new Error(`${label} Sync returned an invalid next key`);
  }
  if (expectedValue) {
    const matches = descendants(collections[0], 'Add').filter(node => (
      node.page === 0 && text(child(node, 'ApplicationData'), expectedTag) === expectedValue
    ));
    if (matches.length !== 1) {
      throw new Error(`${label} Sync did not retrieve exactly one Ping canary`);
    }
  }
  return {
    syncKey: nextKey,
    moreAvailable: Boolean(child(collections[0], 'MoreAvailable')),
  };
}

async function drainPimBaseline(collectionId, label) {
  let result = await syncPimCollection(collectionId, '0', { label });
  for (let page = 0; page < 128; page += 1) {
    result = await syncPimCollection(collectionId, result.syncKey, { label });
    if (!result.moreAvailable) return result.syncKey;
  }
  throw new Error(`${label} Sync baseline still has MoreAvailable after 128 bounded pages`);
}

async function sendPingCanary() {
  if (fixtureMode) return;
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
      messageId: canaryMessageId,
      subject: canarySubject,
      text: `ActiveSync Ping wake canary for ${deviceId}`,
    });
  } finally {
    transporter.close();
  }
}

async function cleanupPingCanary() {
  if (fixtureMode) return;
  const tls = { rejectUnauthorized: imapRejectUnauthorized };
  if (imapServerName) tls.servername = imapServerName;
  const client = new ImapFlow({
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
  try {
    await client.connect();
    const mailboxes = await client.list();
    const selectable = mailboxes.filter(mailbox => (
      !Array.from(mailbox.flags || []).some(flag => String(flag).toLowerCase() === '\\noselect')
    ));
    if (selectable.length > MAX_SELECTABLE_MAILBOXES) {
      throw new Error('IMAP cleanup mailbox count exceeds its safety bound');
    }
    let pathBytes = 0;
    for (const mailbox of selectable) {
      const mailboxPath = String(mailbox.path || '');
      const bytes = Buffer.byteLength(mailboxPath, 'utf8');
      pathBytes += bytes;
      if (!mailboxPath || bytes > MAX_MAILBOX_PATH_BYTES || pathBytes > MAX_MAILBOX_PATHS_BYTES) {
        throw new Error('IMAP cleanup mailbox path exceeds its safety bound');
      }
      const lock = await client.getMailboxLock(mailboxPath);
      try {
        const uids = await client.search({ header: { 'message-id': canaryMessageId } }, { uid: true });
        if (Array.isArray(uids) && uids.length) await client.messageDelete(uids, { uid: true });
        const remaining = await client.search({ header: { 'message-id': canaryMessageId } }, { uid: true });
        if (Array.isArray(remaining) && remaining.length) {
          throw new Error('IMAP cleanup left a Ping canary message in a selectable mailbox');
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    try { await client.logout(); } catch { client.close(); }
  }
}

function monitoredCollections() {
  return [
    { id: inboxCollectionId, className: 'Email' },
    { id: contactCollectionId, className: 'Contacts' },
    { id: calendarCollectionId, className: 'Calendar' },
  ];
}

function fullPingRequest(heartbeatSeconds, folders = monitoredCollections()) {
  return writeWbxml({
    tag: 'Ping',
    page: 13,
    children: [
      { tag: 'HeartbeatInterval', page: 13, content: String(heartbeatSeconds) },
      { tag: 'Folders', page: 13, children: folders.map(folder => ({
        tag: 'Folder',
        page: 13,
        children: [
          { tag: 'Id', page: 13, content: folder.id },
          { tag: 'Class', page: 13, content: folder.className },
        ],
      })) },
    ],
  });
}

function validatePingResponse(ast, expectedStatus, expectedHeartbeat = '') {
  if (ast?.tag !== 'Ping' || ast?.page !== 13 || ast.content !== undefined) {
    throw new Error('ActiveSync Ping returned an invalid response root');
  }
  const children = ast.children || [];
  const allowedTags = expectedHeartbeat ? ['Status', 'HeartbeatInterval'] : ['Status'];
  if (children.length !== allowedTags.length
      || children.some((node, index) => node.tag !== allowedTags[index]
        || node.page !== 13 || node.children?.length)) {
    throw new Error(`ActiveSync Ping Status ${expectedStatus} returned an invalid WBXML shape`);
  }
  if (text(ast, 'Status') !== expectedStatus) {
    throw new Error(`ActiveSync Ping expected Status ${expectedStatus}`);
  }
  if (expectedHeartbeat && text(ast, 'HeartbeatInterval') !== expectedHeartbeat) {
    throw new Error(`ActiveSync Ping Status 5 did not negotiate ${expectedHeartbeat} seconds`);
  }
}

function validateChangedPingResponse(ast, expectedCollectionId, label) {
  if (ast?.tag !== 'Ping' || ast?.page !== 13 || ast.content !== undefined) {
    throw new Error('ActiveSync Ping Status 2 returned an invalid response root');
  }
  const children = ast.children || [];
  if (children.length !== 2 || children[0]?.tag !== 'Status' || children[0]?.page !== 13
      || children[0]?.content?.toString() !== '2' || children[0]?.children?.length
      || children[1]?.tag !== 'Folders' || children[1]?.page !== 13 || children[1]?.content !== undefined) {
    throw new Error('ActiveSync Ping Status 2 returned an invalid WBXML shape');
  }
  const changed = children[1].children || [];
  if (changed.length !== 1 || changed[0]?.tag !== 'Folder' || changed[0]?.page !== 13
      || changed[0]?.children?.length || changed[0]?.content?.toString() !== expectedCollectionId) {
    throw new Error(`ActiveSync Ping Status 2 did not return the exact monitored ${label} id`);
  }
}

function elapsedMilliseconds(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function timingBounds(heartbeatSeconds) {
  const target = heartbeatSeconds * secondMs;
  if (fixtureMode) return { earliest: Math.max(0, target - 20), latest: target + 500 };
  return {
    earliest: target - 5000,
    latest: target + (heartbeatSeconds === 900 ? 30000 : 15000),
  };
}

async function expectImmediatePingStatus({ body, includeContentType = true }, status, heartbeat = '') {
  const ast = await easRequest('Ping', {
    body,
    includeContentType,
    operation: 'ActiveSync Ping',
  });
  validatePingResponse(ast, status, heartbeat);
}

async function expectHeldNoChange({ heartbeatSeconds, body, includeContentType = true, label }) {
  const bounds = timingBounds(heartbeatSeconds);
  const startedAt = process.hrtime.bigint();
  const ast = await easRequest('Ping', {
    body,
    includeContentType,
    timeoutMs: Math.ceil(bounds.latest + Math.max(1000, networkTimeoutMs)),
    operation: `ActiveSync Ping ${label}`,
  });
  const elapsed = elapsedMilliseconds(startedAt);
  validatePingResponse(ast, '1');
  if (elapsed < bounds.earliest) {
    throw new Error(`ActiveSync Ping ${label} returned too early`);
  }
  if (elapsed > bounds.latest) {
    throw new Error(`ActiveSync Ping ${label} returned too late`);
  }
}

async function expectMailWake(syncKey) {
  const bounds = timingBounds(60);
  const startedAt = process.hrtime.bigint();
  await cleanupPingCanary();
  const pendingPing = easRequest('Ping', {
    body: fullPingRequest(60, [{ id: inboxCollectionId, className: 'Email' }]),
    timeoutMs: Math.ceil(bounds.latest + Math.max(1000, networkTimeoutMs)),
    operation: 'ActiveSync Ping mail wake',
  });
  await sleep(fixtureMode ? 10 : 1000);
  await sendPingCanary();
  const ast = await pendingPing;
  const elapsed = elapsedMilliseconds(startedAt);
  validateChangedPingResponse(ast, inboxCollectionId, 'Inbox');
  if (elapsed >= bounds.earliest) {
    throw new Error('ActiveSync Ping Status 2 did not wake before the heartbeat expired');
  }
  return syncInbox(syncKey, canarySubject);
}

async function expectPimWake({
  collectionId,
  className,
  label,
  createCanary,
  syncKey,
  expectedTag,
  expectedValue,
}) {
  const bounds = timingBounds(60);
  const startedAt = process.hrtime.bigint();
  const pendingPing = easRequest('Ping', {
    body: fullPingRequest(60, [{ id: collectionId, className }]),
    timeoutMs: Math.ceil(bounds.latest + Math.max(1000, networkTimeoutMs)),
    operation: `ActiveSync Ping ${label} wake`,
  });
  await sleep(fixtureMode ? 10 : 1000);
  await createCanary();
  const ast = await pendingPing;
  const elapsed = elapsedMilliseconds(startedAt);
  validateChangedPingResponse(ast, collectionId, label);
  if (elapsed >= bounds.earliest) {
    throw new Error(`ActiveSync Ping ${label} Status 2 did not wake before the heartbeat expired`);
  }
  return syncPimCollection(collectionId, syncKey, { label, expectedTag, expectedValue });
}

const transportDispatcher = new Agent({
  headersTimeout: TRANSPORT_TIMEOUT_MS,
  bodyTimeout: TRANSPORT_TIMEOUT_MS,
});

(async () => {
  let failure;
  try {
    await cleanupPingCanary();
    await createDisposableCalendar();
    await verifyPingAdvertisement('preflight');
    await folderSync();

    await expectImmediatePingStatus({ body: fullPingRequest(901) }, '5', '900');
    await expectImmediatePingStatus({ body: fullPingRequest(59) }, '5', '60');
    await expectImmediatePingStatus({ body: Buffer.alloc(0) }, '3');

    const prime = await syncInbox('0');
    let mailSyncKey = await drainInboxBaseline(prime.syncKey);
    let contactSyncKey = await drainPimBaseline(contactCollectionId, 'Contacts');
    let calendarSyncKey = await drainPimBaseline(calendarCollectionId, 'Calendar');

    mailSyncKey = (await expectMailWake(mailSyncKey)).syncKey;
    contactSyncKey = (await expectPimWake({
      collectionId: contactCollectionId,
      className: 'Contacts',
      label: 'Contacts',
      createCanary: createContactCanary,
      syncKey: contactSyncKey,
      expectedTag: 'Email1Address',
      expectedValue: contactEmail,
    })).syncKey;
    calendarSyncKey = (await expectPimWake({
      collectionId: calendarCollectionId,
      className: 'Calendar',
      label: 'Calendar',
      createCanary: createCalendarCanary,
      syncKey: calendarSyncKey,
      expectedTag: 'Subject',
      expectedValue: calendarSubject,
    })).syncKey;

    await cleanupPingCanary();
    await deleteExactDavUrl(contactUrl, 'CardDAV Ping contact delete-before-no-change');
    contactCreated = false;
    await deleteExactDavUrl(calendarEventUrl, 'CalDAV Ping event delete-before-no-change');
    calendarEventCreated = false;

    await expectHeldNoChange({
      heartbeatSeconds: 60,
      body: fullPingRequest(60),
      label: '60-second full request after mail, contact, and calendar deletions',
    });
    await expectHeldNoChange({
      heartbeatSeconds: 60,
      body: undefined,
      includeContentType: false,
      label: '60-second bodyless renewal',
    });
    if (longMode) {
      await expectHeldNoChange({
        heartbeatSeconds: 900,
        body: fullPingRequest(900),
        label: '900-second opt-in request',
      });
    }

    await verifyPingAdvertisement('postflight');
  } catch (error) {
    failure = error;
  }
  for (const cleanup of [cleanupPingCanary, cleanupDavCanaries]) {
    try {
      await cleanup();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failure = new Error(failure ? `${failure.message}; cleanup failed: ${message}` : `cleanup failed: ${message}`);
    }
  }
  try {
    await transportDispatcher.close();
  } catch {
    failure = new Error(failure
      ? `${failure.message}; cleanup failed: Ping transport dispatcher close failed`
      : 'cleanup failed: Ping transport dispatcher close failed');
  }
  if (failure) throw failure;
  console.log(`ActiveSync Ping protocol checks passed (${longMode ? 'routine plus 900-second hold' : 'routine 60-second gate'})`);
})().catch(error => {
  console.error(`FAIL: ${error.message}`);
  process.exit(1);
});
NODE

service_state_after=$(capture_service_state)
[[ "${service_state_after}" == "${service_state_before}" ]] \
  || fail "ActiveSync Ping gate observed a backend or proxy restart"
if [[ "${PING_LONG_MODE}" == "1" ]]; then
  echo "PASS: ActiveSync Ping smoke completed (routine plus 900-second hold)"
else
  echo "PASS: ActiveSync Ping smoke completed (routine 60-second gate)"
fi
