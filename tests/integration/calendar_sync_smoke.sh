#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "${PROJECT_ROOT}"

BASE_URL=${OMS_SMOKE_BASE_URL:-https://mail.housevo.us}
BASE_URL=${BASE_URL%/}
SMOKE_USER=${OMS_SMOKE_USER:-}
SMOKE_PASSWORD=${OMS_SMOKE_PASSWORD:-}

if [[ -z "${SMOKE_USER}" || -z "${SMOKE_PASSWORD}" ]]; then
  echo "SKIP: set OMS_SMOKE_USER and OMS_SMOKE_PASSWORD to run authenticated calendar sync smoke checks"
  exit 0
fi

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

DEVICE_ID=${OMS_SMOKE_DEVICE_ID:-OMSCA$(openssl rand -hex 10)}
[[ "${DEVICE_ID}" =~ ^[A-Za-z0-9]{1,32}$ ]] \
  || fail "OMS_SMOKE_DEVICE_ID must contain 1-32 ASCII letters or digits"
CURL_CONNECT_TIMEOUT=${OMS_SMOKE_CONNECT_TIMEOUT_SECONDS:-10}
CURL_MAX_TIME=${OMS_SMOKE_MAX_TIME_SECONDS:-60}
[[ "${CURL_CONNECT_TIMEOUT}" =~ ^[1-9][0-9]{0,2}$ && "${CURL_MAX_TIME}" =~ ^[1-9][0-9]{0,2}$ ]] \
  || fail "smoke curl timeouts must be positive whole seconds"
(( CURL_CONNECT_TIMEOUT <= 120 && CURL_MAX_TIME <= 300 )) \
  || fail "smoke curl timeouts exceed their safety bounds"
[[ "${SMOKE_USER}${SMOKE_PASSWORD}" != *$'\n'* && "${SMOKE_USER}${SMOKE_PASSWORD}" != *$'\r'* ]] \
  || fail "smoke credentials cannot contain line breaks"

tmpdir=$(mktemp -d)
trap 'rm -rf -- "${tmpdir}"' EXIT
umask 077
curl_auth_config="${tmpdir}/curl-auth.conf"
curl_auth_value="${SMOKE_USER}:${SMOKE_PASSWORD}"
curl_auth_value=${curl_auth_value//\\/\\\\}
curl_auth_value=${curl_auth_value//\"/\\\"}
printf 'user = "%s"\n' "${curl_auth_value}" > "${curl_auth_config}"
chmod 600 "${curl_auth_config}"
unset curl_auth_value SMOKE_PASSWORD OMS_SMOKE_PASSWORD

curl_safe() {
  command curl --config "${curl_auth_config}" \
    --connect-timeout "${CURL_CONNECT_TIMEOUT}" \
    --max-time "${CURL_MAX_TIME}" \
    "$@"
}

calendar_created=false
calendar_run_id=${OMS_SMOKE_CALENDAR_RUN_ID:-omsca$(openssl rand -hex 12)}
[[ "${calendar_run_id}" =~ ^[a-z0-9]{1,32}$ ]] \
  || fail "OMS_SMOKE_CALENDAR_RUN_ID must contain 1-32 lowercase ASCII letters or digits"
timestamp=${calendar_run_id}
cal_slug="oms-eas-calendar-${timestamp}"
cal_name="OMS EAS Calendar ${timestamp}"
seed_event_uid="oms-eas-seed-event-${timestamp}"
seed_subject="OMS EAS Seed Event ${timestamp}"
eas_subject="OMS EAS Added Event ${timestamp}"
eas_changed_subject="OMS EAS Changed Event ${timestamp}"
eas_marker="OMSEASMARKER$(openssl rand -hex 12)"
eas_client_id="E$(openssl rand -hex 20)"
encoded_user=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "${SMOKE_USER}")
caldav_url="${BASE_URL}/caldav/calendars/${encoded_user}/${cal_slug}/"
seed_event_url="${caldav_url}${seed_event_uid}.ics"
eas_foldersync_url="${BASE_URL}/Microsoft-Server-ActiveSync?Cmd=FolderSync&User=${encoded_user}&DeviceId=${DEVICE_ID}&DeviceType=CodexSmoke"
eas_sync_url="${BASE_URL}/Microsoft-Server-ActiveSync?Cmd=Sync&User=${encoded_user}&DeviceId=${DEVICE_ID}&DeviceType=CodexSmoke"
report_body="${tmpdir}/calendar-query.xml"

cat > "${report_body}" <<'XML'
<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR"/>
  </C:filter>
</C:calendar-query>
XML

delete_calendar() {
  local output_file=$1
  local status
  status=$(curl_safe -sS -X DELETE \
    -o "${output_file}" \
    -w '%{http_code}' \
    "${caldav_url}") || return 1
  [[ "${status}" == "204" || "${status}" == "404" ]]
}

cleanup() {
  local exit_status=$?
  local cleanup_failed=0
  trap - EXIT
  set +e
  if [[ "${calendar_created}" == "true" ]] && ! delete_calendar "${tmpdir}/cleanup-calendar.out"; then
    echo "WARN: cleanup failed: could not remove the disposable calendar" >&2
    cleanup_failed=1
  fi
  rm -rf -- "${tmpdir}"
  if (( cleanup_failed != 0 && exit_status == 0 )); then
    exit_status=1
  fi
  exit "${exit_status}"
}
trap cleanup EXIT

eas_post_url() {
  local url=$1
  local request_file=$2
  local response_file=$3
  local label=$4
  local status
  status=$(curl_safe -sS -X POST \
    -H 'Content-Type: application/vnd.ms-sync.wbxml' \
    --data-binary @"${request_file}" \
    -o "${response_file}" \
    -w '%{http_code}' \
    "${url}") || fail "${label} request failed"
  [[ "${status}" == "200" ]] || fail "${label} returned HTTP ${status}"
}

report_calendar() {
  local output_file=$1
  local status
  status=$(curl_safe -sS -X REPORT \
    -H 'Depth: 1' \
    -H 'Content-Type: application/xml; charset=utf-8' \
    --data-binary @"${report_body}" \
    -o "${output_file}" \
    -w '%{http_code}' \
    "${caldav_url}") || return 1
  [[ "${status}" == "207" ]]
}

derive_eas_resource_name() {
  local user=$1
  local device_id=$2
  local collection_id=$3
  local sync_key=$4
  local client_id=$5
  local server_id=$6
  node - \
    "${user}" "${device_id}" "${collection_id}" "${sync_key}" "${client_id}" "${server_id}" <<'NODE'
const {
  deterministicPimAddServerId,
  pimSyncScopeHash,
  pimWireServerId,
} = require('./webmail-backend/src/eas-pim-identity.js');
const [user, deviceId, collectionId, syncKey, clientId, serverId] = process.argv.slice(2);
const scopeHash = pimSyncScopeHash(user, deviceId, collectionId);
const resourceName = deterministicPimAddServerId(scopeHash, syncKey, clientId);
if (pimWireServerId(collectionId, resourceName) !== serverId) {
  throw new Error('Calendar Add response does not identify the deterministic canary resource');
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(resourceName)) {
  throw new Error('Calendar Add produced an invalid deterministic canary resource');
}
process.stdout.write(resourceName);
NODE
}

write_matching_event_urls() {
  local report_file=$1
  local marker=$2
  local output_file=$3
  local collection_id=$4
  local expected_resource_name=$5
  node - \
    "${report_file}" "${marker}" "${BASE_URL}" "${SMOKE_USER}" "${cal_slug}" \
    "${collection_id}" "${expected_resource_name}" <<'NODE' > "${output_file}"
const fs = require('fs');
const xml = fs.readFileSync(process.argv[2], 'utf8');
const marker = process.argv[3];
const baseUrl = process.argv[4];
const user = process.argv[5];
const calendarSlug = process.argv[6];
const collectionId = process.argv[7];
const expectedResourceName = process.argv[8];
const decodeXml = value => value
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'");
const collectionMatch = /^cal-([1-9][0-9]*)$/.exec(collectionId);
if (!collectionMatch) throw new Error('Refusing an invalid FolderSync calendar identity');
if (!/^oms-eas-calendar-[a-z0-9]{1,32}$/.test(calendarSlug)) {
  throw new Error('Refusing an invalid disposable calendar slug');
}
if (!/^OMSEASMARKER[0-9a-f]{24}$/.test(marker)) {
  throw new Error('Refusing an invalid ActiveSync event marker');
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(expectedResourceName)) {
  throw new Error('Refusing an invalid ActiveSync event resource identity');
}
const base = new URL(baseUrl);
if (base.username || base.password || base.search || base.hash || base.pathname !== '/') {
  throw new Error('Refusing an unsafe CalDAV base URL');
}
const userSegment = encodeURIComponent(user);
const resourceSegment = `${encodeURIComponent(expectedResourceName)}.ics`;
const allowedPathnames = new Set([
  `/caldav/calendars/${userSegment}/${calendarSlug}/${resourceSegment}`,
  `/caldav/calendars/${userSegment}/${collectionMatch[1]}/${resourceSegment}`,
]);
const allowedHrefs = new Set([
  ...allowedPathnames,
  ...[...allowedPathnames].map(pathname => `${base.origin}${pathname}`),
]);
const urls = [];
for (const match of xml.matchAll(/<(?:[A-Za-z0-9_-]+:)?response\b[\s\S]*?<\/(?:[A-Za-z0-9_-]+:)?response>/gi)) {
  if (!match[0].includes(marker)) continue;
  const href = match[0].match(/<(?:[A-Za-z0-9_-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?href>/i)?.[1];
  if (!href) throw new Error(`CalDAV response containing ${marker} omitted href`);
  const decodedHref = decodeXml(href.trim());
  const url = new URL(decodedHref, baseUrl);
  if (url.origin !== base.origin || url.username || url.password || url.search || url.hash
      || !allowedPathnames.has(url.pathname) || !allowedHrefs.has(decodedHref)) {
    throw new Error(`Refusing unexpected CalDAV event href ${url.pathname}`);
  }
  urls.push(url.toString());
}
if (urls.length > 1) throw new Error(`CalDAV returned ${urls.length} responses for the exact event marker`);
process.stdout.write(urls.join('\n'));
NODE
}

parse_quiet_sync_key() {
  local response_file=$1
  local collection_id=$2
  local label=$3
  node - "${response_file}" "${collection_id}" "${label}" <<'NODE'
const fs = require('fs');
const { WbxmlParser } = require('./webmail-backend/src/wbxml/parser.js');
const ast = new WbxmlParser(fs.readFileSync(process.argv[2])).parse();
const collectionId = process.argv[3];
const label = process.argv[4];
const child = (node, tag) => (node?.children || []).find(candidate => candidate.tag === tag);
const text = (node, tag) => child(node, tag)?.content?.toString() || '';
if (ast.tag !== 'Sync' || ast.page !== 0) throw new Error(`${label} returned the wrong root`);
const collectionNodes = (child(ast, 'Collections')?.children || []).filter(node => node.tag === 'Collection');
if (collectionNodes.length !== 1) throw new Error(`${label} did not return exactly one Collection`);
const collection = collectionNodes[0];
if (text(collection, 'CollectionId') !== collectionId || text(collection, 'Status') !== '1') {
  throw new Error(`${label} did not return collection Status 1 for ${collectionId}`);
}
if (child(collection, 'Commands') || child(collection, 'Responses')) {
  throw new Error(`${label} unexpectedly returned Commands or Responses`);
}
const syncKey = text(collection, 'SyncKey');
if (!/^oms-pim-[0-9a-f]{48}$/.test(syncKey) || Buffer.byteLength(syncKey) > 64) {
  throw new Error(`${label} did not return a bounded opaque PIM SyncKey`);
}
process.stdout.write(syncKey);
NODE
}

node <<'NODE' > "${tmpdir}/foldersync.wbxml"
const { WbxmlWriter } = require('./webmail-backend/src/wbxml/writer.js');
const writer = new WbxmlWriter();
writer.writeNode({
  tag: 'FolderSync', page: 7,
  children: [{ tag: 'SyncKey', page: 7, content: '0' }],
});
process.stdout.write(writer.getBuffer());
NODE

eas_post_url "${eas_foldersync_url}" "${tmpdir}/foldersync.wbxml" "${tmpdir}/foldersync-baseline.out" "baseline FolderSync"
eas_post_url "${eas_foldersync_url}" "${tmpdir}/foldersync.wbxml" "${tmpdir}/foldersync-baseline-retry.out" "baseline FolderSync retry"
cmp -s "${tmpdir}/foldersync-baseline.out" "${tmpdir}/foldersync-baseline-retry.out" \
  || fail "Baseline FolderSync key-zero retry was not byte-identical"
node - "${tmpdir}/foldersync-baseline.out" <<'NODE'
const fs = require('fs');
const { WbxmlParser } = require('./webmail-backend/src/wbxml/parser.js');
const ast = new WbxmlParser(fs.readFileSync(process.argv[2])).parse();
const child = (node, tag) => (node?.children || []).find(candidate => candidate.tag === tag);
const text = (node, tag) => child(node, tag)?.content?.toString() || '';
if (ast.tag !== 'FolderSync' || ast.page !== 7 || text(ast, 'Status') !== '1') {
  throw new Error('Baseline FolderSync did not return Status 1');
}
const typeEight = (child(ast, 'Changes')?.children || []).filter(node =>
  node.tag === 'Add' && text(node, 'Type') === '8');
if (typeEight.length !== 1) throw new Error(`Baseline FolderSync returned ${typeEight.length} Type 8 calendars`);
const syncKey = text(ast, 'SyncKey');
if (!syncKey || syncKey === '0' || Buffer.byteLength(syncKey) > 64) {
  throw new Error('Baseline FolderSync did not return a bounded nonzero SyncKey');
}
NODE

cat > "${tmpdir}/mkcalendar.xml" <<XML
<?xml version="1.0" encoding="utf-8" ?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:A="http://apple.com/ns/ical/">
  <D:set>
    <D:prop>
      <D:displayname>${cal_name}</D:displayname>
      <A:calendar-color>#2ecc71</A:calendar-color>
      <C:supported-calendar-component-set>
        <C:comp name="VEVENT"/>
      </C:supported-calendar-component-set>
    </D:prop>
  </D:set>
</C:mkcalendar>
XML

calendar_created=true
mkcalendar_status=$(curl_safe -sS -X MKCALENDAR \
  -H 'Content-Type: application/xml; charset=utf-8' \
  --data-binary @"${tmpdir}/mkcalendar.xml" \
  -o "${tmpdir}/mkcalendar.out" \
  -w '%{http_code}' \
  "${caldav_url}") || fail "MKCALENDAR request failed"
[[ "${mkcalendar_status}" == "201" ]] || fail "MKCALENDAR returned HTTP ${mkcalendar_status}"

cat > "${tmpdir}/seed-event.ics" <<ICS
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//OpenMailStack//Calendar Smoke//EN
BEGIN:VEVENT
UID:${seed_event_uid}
DTSTAMP:20260621T130000Z
DTSTART;TZID=America/New_York:20270305T090000
DTEND;TZID=America/New_York:20270305T100000
RRULE:FREQ=WEEKLY;COUNT=4
SUMMARY:${seed_subject}
LOCATION:Seed Smoke Test
DESCRIPTION:Created through CalDAV for ActiveSync initial sync
END:VEVENT
END:VCALENDAR
ICS

seed_status=$(curl_safe -sS -X PUT \
  -H 'Content-Type: text/calendar; charset=utf-8' \
  --data-binary @"${tmpdir}/seed-event.ics" \
  -o "${tmpdir}/seed-put.out" \
  -w '%{http_code}' \
  "${seed_event_url}") || fail "seed event PUT failed"
[[ "${seed_status}" == "201" || "${seed_status}" == "204" ]] \
  || fail "seed event PUT returned HTTP ${seed_status}"
report_calendar "${tmpdir}/seed-report.xml" || fail "CalDAV REPORT failed for the seeded event"
grep -Fq "${seed_subject}" "${tmpdir}/seed-report.xml" \
  || fail "CalDAV REPORT did not return the seeded event"

eas_post_url "${eas_foldersync_url}" "${tmpdir}/foldersync.wbxml" "${tmpdir}/foldersync.out" "FolderSync"
eas_post_url "${eas_foldersync_url}" "${tmpdir}/foldersync.wbxml" "${tmpdir}/foldersync-retry.out" "FolderSync retry"
cmp -s "${tmpdir}/foldersync.out" "${tmpdir}/foldersync-retry.out" \
  || fail "FolderSync key-zero retry was not byte-identical"
folder_values=$(node - "${tmpdir}/foldersync.out" "${cal_name}" <<'NODE'
const fs = require('fs');
const { WbxmlParser } = require('./webmail-backend/src/wbxml/parser.js');
const ast = new WbxmlParser(fs.readFileSync(process.argv[2])).parse();
const expectedCalendar = process.argv[3];
const child = (node, tag) => (node?.children || []).find(candidate => candidate.tag === tag);
const text = (node, tag) => child(node, tag)?.content?.toString() || '';
if (ast.tag !== 'FolderSync' || ast.page !== 7 || text(ast, 'Status') !== '1') {
  throw new Error('FolderSync did not return Status 1');
}
const adds = (child(ast, 'Changes')?.children || []).filter(node => node.tag === 'Add');
const typeEight = adds.filter(node => text(node, 'Type') === '8');
if (typeEight.length !== 1) throw new Error(`FolderSync returned ${typeEight.length} Type 8 calendars`);
const target = adds.filter(node => text(node, 'DisplayName') === expectedCalendar);
if (target.length !== 1 || text(target[0], 'Type') !== '13') {
  throw new Error('FolderSync did not advertise the disposable non-default calendar as Type 13');
}
const collectionId = text(target[0], 'ServerId');
if (!/^cal-[1-9][0-9]*$/.test(collectionId) || Buffer.byteLength(collectionId) > 64) {
  throw new Error('FolderSync returned an invalid calendar CollectionId');
}
const syncKey = text(ast, 'SyncKey');
if (!syncKey || syncKey === '0' || Buffer.byteLength(syncKey) > 64) {
  throw new Error('FolderSync did not return a bounded nonzero SyncKey');
}
process.stdout.write(`${syncKey}\t${collectionId}`);
NODE
)
IFS=$'\t' read -r folder_sync_key cal_collection_id <<< "${folder_values}"
[[ -n "${folder_sync_key}" ]] || fail "FolderSync SyncKey capture failed"

node - "${cal_collection_id}" <<'NODE' > "${tmpdir}/prime.wbxml"
const { WbxmlWriter } = require('./webmail-backend/src/wbxml/writer.js');
const writer = new WbxmlWriter();
writer.writeNode({ tag: 'Sync', page: 0, children: [{
  tag: 'Collections', page: 0, children: [{ tag: 'Collection', page: 0, children: [
    { tag: 'SyncKey', page: 0, content: '0' },
    { tag: 'CollectionId', page: 0, content: process.argv[2] },
  ] }],
}] });
process.stdout.write(writer.getBuffer());
NODE
eas_post_url "${eas_sync_url}" "${tmpdir}/prime.wbxml" "${tmpdir}/prime.out" "calendar key-zero prime"
prime_key=$(parse_quiet_sync_key "${tmpdir}/prime.out" "${cal_collection_id}" "Calendar key-zero prime")
eas_post_url "${eas_sync_url}" "${tmpdir}/prime.wbxml" "${tmpdir}/prime-retry.out" "calendar key-zero retry"
cmp -s "${tmpdir}/prime.out" "${tmpdir}/prime-retry.out" \
  || fail "Calendar key-zero retry was not byte-identical"

node - "${cal_collection_id}" "${prime_key}" <<'NODE' > "${tmpdir}/initial.wbxml"
const { WbxmlWriter } = require('./webmail-backend/src/wbxml/writer.js');
const writer = new WbxmlWriter();
writer.writeNode({ tag: 'Sync', page: 0, children: [{
  tag: 'Collections', page: 0, children: [{ tag: 'Collection', page: 0, children: [
    { tag: 'SyncKey', page: 0, content: process.argv[3] },
    { tag: 'CollectionId', page: 0, content: process.argv[2] },
    { tag: 'GetChanges', page: 0, content: '1' },
    { tag: 'WindowSize', page: 0, content: '512' },
  ] }],
}] });
process.stdout.write(writer.getBuffer());
NODE
eas_post_url "${eas_sync_url}" "${tmpdir}/initial.wbxml" "${tmpdir}/initial.out" "initial calendar Sync"
initial_values=$(node - "${tmpdir}/initial.out" "${cal_collection_id}" "${seed_subject}" <<'NODE'
const fs = require('fs');
const { WbxmlParser } = require('./webmail-backend/src/wbxml/parser.js');
const ast = new WbxmlParser(fs.readFileSync(process.argv[2])).parse();
const collectionId = process.argv[3];
const expectedSubject = process.argv[4];
const child = (node, tag) => (node?.children || []).find(candidate => candidate.tag === tag);
const text = (node, tag) => child(node, tag)?.content?.toString() || '';
const collection = child(child(ast, 'Collections'), 'Collection');
if (!collection || text(collection, 'CollectionId') !== collectionId || text(collection, 'Status') !== '1') {
  throw new Error('Initial Calendar Sync did not return collection Status 1');
}
if (child(collection, 'Responses')) throw new Error('Initial Calendar Sync unexpectedly returned Responses');
const adds = (child(collection, 'Commands')?.children || []).filter(node => node.tag === 'Add');
const matches = adds.filter(add => text(child(add, 'ApplicationData'), 'Subject') === expectedSubject);
if (matches.length !== 1) throw new Error(`Initial Calendar Sync returned ${matches.length} seeded Adds`);
const add = matches[0];
const applicationData = child(add, 'ApplicationData');
if (applicationData.children.some(node => node.tag === 'Timezone')) {
  throw new Error('Initial Calendar Sync used the invalid Timezone tag spelling');
}
const timeZone = text(applicationData, 'TimeZone');
const timeZoneBytes = Buffer.from(timeZone, 'base64');
if (timeZoneBytes.length !== 172 || timeZoneBytes.readInt32LE(0) !== 300 || timeZoneBytes.readInt32LE(168) !== -60) {
  throw new Error('Initial Calendar Sync did not return the expected TimeZone structure');
}
if (text(applicationData, 'StartTime') !== '20270305T140000Z') {
  throw new Error('Initial Calendar Sync did not preserve New York wall time');
}
const recurrence = child(applicationData, 'Recurrence');
if (!recurrence || text(recurrence, 'Occurrences') !== '4') {
  throw new Error('Initial Calendar Sync did not return the recurrence');
}
const serverId = text(add, 'ServerId');
if (!/^[0-9a-f]{64}$/.test(serverId) || Buffer.byteLength(serverId) > 64) {
  throw new Error('Initial Calendar Sync returned an invalid opaque ServerId');
}
const syncKey = text(collection, 'SyncKey');
if (!/^oms-pim-[0-9a-f]{48}$/.test(syncKey) || Buffer.byteLength(syncKey) > 64) {
  throw new Error('Initial Calendar Sync returned an invalid opaque SyncKey');
}
process.stdout.write(`${syncKey}\t${serverId}`);
NODE
)
IFS=$'\t' read -r calendar_sync_key seed_server_id <<< "${initial_values}"
[[ "${seed_server_id}" =~ ^[0-9a-f]{64}$ ]] || fail "seeded calendar event ServerId capture failed"
eas_post_url "${eas_sync_url}" "${tmpdir}/initial.wbxml" "${tmpdir}/initial-retry.out" "initial calendar retry"
cmp -s "${tmpdir}/initial.out" "${tmpdir}/initial-retry.out" \
  || fail "Calendar initial keyed retry was not byte-identical"

node - "${cal_collection_id}" "${calendar_sync_key}" "${eas_client_id}" "${eas_subject}" "${eas_marker}" <<'NODE' > "${tmpdir}/add.wbxml"
const { WbxmlWriter } = require('./webmail-backend/src/wbxml/writer.js');
const { encodeActiveSyncTimeZone } = require('./webmail-backend/src/eas-timezone.js');
const [collectionId, syncKey, clientId, subject, marker] = process.argv.slice(2);
const timeZone = encodeActiveSyncTimeZone('America/New_York', new Date('2027-03-05T14:00:00Z'));
if (!timeZone) throw new Error('Could not encode the ActiveSync smoke TimeZone');
const writer = new WbxmlWriter();
writer.writeNode({ tag: 'Sync', page: 0, children: [{
  tag: 'Collections', page: 0, children: [{ tag: 'Collection', page: 0, children: [
    { tag: 'SyncKey', page: 0, content: syncKey },
    { tag: 'CollectionId', page: 0, content: collectionId },
    { tag: 'GetChanges', page: 0, content: '0' },
    { tag: 'Commands', page: 0, children: [{ tag: 'Add', page: 0, children: [
      { tag: 'ClientId', page: 0, content: clientId },
      { tag: 'ApplicationData', page: 0, children: [
        { tag: 'TimeZone', page: 4, content: timeZone },
        { tag: 'AllDayEvent', page: 4, content: '0' },
        { tag: 'BusyStatus', page: 4, content: '2' },
        { tag: 'DtStamp', page: 4, content: '20260621T130000Z' },
        { tag: 'EndTime', page: 4, content: '20270305T150000Z' },
        { tag: 'Location', page: 4, content: 'ActiveSync Smoke' },
        { tag: 'MeetingStatus', page: 4, content: '0' },
        { tag: 'Reminder', page: 4, content: '15' },
        { tag: 'Sensitivity', page: 4, content: '0' },
        { tag: 'Subject', page: 4, content: subject },
        { tag: 'StartTime', page: 4, content: '20270305T140000Z' },
        { tag: 'UID', page: 4, content: clientId },
        { tag: 'Categories', page: 4, children: [{ tag: 'Category', page: 4, content: marker }] },
        { tag: 'Recurrence', page: 4, children: [
          { tag: 'Type', page: 4, content: '1' },
          { tag: 'Occurrences', page: 4, content: '4' },
          { tag: 'Interval', page: 4, content: '1' },
          { tag: 'DayOfWeek', page: 4, content: '32' },
        ] },
        { tag: 'Body', page: 17, children: [
          { tag: 'Type', page: 17, content: '1' },
          { tag: 'Data', page: 17, content: 'Created through ActiveSync calendar smoke' },
        ] },
      ] },
    ] }] },
  ] }],
}] });
process.stdout.write(writer.getBuffer());
NODE
eas_post_url "${eas_sync_url}" "${tmpdir}/add.wbxml" "${tmpdir}/add.out" "calendar Add"
add_values=$(node - "${tmpdir}/add.out" "${cal_collection_id}" "${eas_client_id}" <<'NODE'
const fs = require('fs');
const { WbxmlParser } = require('./webmail-backend/src/wbxml/parser.js');
const ast = new WbxmlParser(fs.readFileSync(process.argv[2])).parse();
const collectionId = process.argv[3];
const clientId = process.argv[4];
const child = (node, tag) => (node?.children || []).find(candidate => candidate.tag === tag);
const text = (node, tag) => child(node, tag)?.content?.toString() || '';
const collection = child(child(ast, 'Collections'), 'Collection');
if (!collection || text(collection, 'CollectionId') !== collectionId || text(collection, 'Status') !== '1') {
  throw new Error('Calendar Add did not return collection Status 1');
}
if (child(collection, 'Commands')) throw new Error('Calendar Add echoed Commands');
const responseChildren = child(collection, 'Responses')?.children || [];
const adds = responseChildren.filter(node => node.tag === 'Add' && text(node, 'ClientId') === clientId);
if (responseChildren.length !== 1 || adds.length !== 1 || text(adds[0], 'Status') !== '1') {
  throw new Error('Calendar Add did not return one successful ClientId mapping');
}
const serverId = text(adds[0], 'ServerId');
if (!/^[0-9a-f]{64}$/.test(serverId) || Buffer.byteLength(serverId) > 64) {
  throw new Error('Calendar Add returned an invalid opaque ServerId');
}
const syncKey = text(collection, 'SyncKey');
if (!/^oms-pim-[0-9a-f]{48}$/.test(syncKey)) throw new Error('Calendar Add returned an invalid SyncKey');
process.stdout.write(`${syncKey}\t${serverId}`);
NODE
)
IFS=$'\t' read -r post_add_key eas_server_id <<< "${add_values}"
eas_resource_name=$(derive_eas_resource_name \
  "${SMOKE_USER}" "${DEVICE_ID}" "${cal_collection_id}" "${calendar_sync_key}" \
  "${eas_client_id}" "${eas_server_id}")
[[ "${eas_resource_name}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] \
  || fail "Calendar Add resource identity capture failed"
eas_post_url "${eas_sync_url}" "${tmpdir}/add.wbxml" "${tmpdir}/add-retry.out" "calendar Add retry"
cmp -s "${tmpdir}/add.out" "${tmpdir}/add-retry.out" \
  || fail "Calendar Add retry was not byte-identical"

report_calendar "${tmpdir}/after-add.xml" || fail "CalDAV REPORT failed after ActiveSync Add"
write_matching_event_urls "${tmpdir}/after-add.xml" "${eas_marker}" "${tmpdir}/after-add.urls" "${cal_collection_id}" "${eas_resource_name}"
mapfile -t eas_event_urls < "${tmpdir}/after-add.urls"
[[ ${#eas_event_urls[@]} -eq 1 ]] \
  || fail "ActiveSync Add created ${#eas_event_urls[@]} CalDAV events instead of exactly one"
eas_event_url=${eas_event_urls[0]}
event_get_status=$(curl_safe -sS \
  -o "${tmpdir}/after-add.ics" -w '%{http_code}' "${eas_event_url}") \
  || fail "CalDAV GET failed after ActiveSync Add"
[[ "${event_get_status}" == "200" ]] || fail "CalDAV GET after ActiveSync Add returned HTTP ${event_get_status}"
grep -Fq "SUMMARY:${eas_subject}" "${tmpdir}/after-add.ics" \
  || fail "CalDAV did not expose the ActiveSync-created event"
grep -Fq "UID:${eas_client_id}" "${tmpdir}/after-add.ics" \
  || fail "CalDAV did not preserve the client-generated ActiveSync UID"
grep -Fq 'DTSTART;TZID=America/New_York:20270305T090000' "${tmpdir}/after-add.ics" \
  || fail "CalDAV did not preserve the ActiveSync event wall time"
grep -Fq 'RRULE:FREQ=WEEKLY;COUNT=4' "${tmpdir}/after-add.ics" \
  || fail "CalDAV did not preserve the ActiveSync event recurrence"

node - "${cal_collection_id}" "${post_add_key}" <<'NODE' > "${tmpdir}/no-echo-after-add.wbxml"
const { WbxmlWriter } = require('./webmail-backend/src/wbxml/writer.js');
const writer = new WbxmlWriter();
writer.writeNode({ tag: 'Sync', page: 0, children: [{
  tag: 'Collections', page: 0, children: [{ tag: 'Collection', page: 0, children: [
    { tag: 'SyncKey', page: 0, content: process.argv[3] },
    { tag: 'CollectionId', page: 0, content: process.argv[2] },
    { tag: 'GetChanges', page: 0, content: '1' },
    { tag: 'WindowSize', page: 0, content: '512' },
  ] }],
}] });
process.stdout.write(writer.getBuffer());
NODE
eas_post_url "${eas_sync_url}" "${tmpdir}/no-echo-after-add.wbxml" "${tmpdir}/no-echo-after-add.out" "calendar post-Add poll"
post_add_poll_key=$(parse_quiet_sync_key "${tmpdir}/no-echo-after-add.out" "${cal_collection_id}" "Calendar post-Add poll")

node - "${cal_collection_id}" "${post_add_poll_key}" "${eas_server_id}" "${eas_client_id}" "${eas_changed_subject}" "${eas_marker}" <<'NODE' > "${tmpdir}/change.wbxml"
const { WbxmlWriter } = require('./webmail-backend/src/wbxml/writer.js');
const { encodeActiveSyncTimeZone } = require('./webmail-backend/src/eas-timezone.js');
const [collectionId, syncKey, serverId, uid, subject, marker] = process.argv.slice(2);
const timeZone = encodeActiveSyncTimeZone('America/New_York', new Date('2027-03-05T14:00:00Z'));
if (!timeZone) throw new Error('Could not encode the ActiveSync smoke TimeZone');
const writer = new WbxmlWriter();
writer.writeNode({ tag: 'Sync', page: 0, children: [{
  tag: 'Collections', page: 0, children: [{ tag: 'Collection', page: 0, children: [
    { tag: 'SyncKey', page: 0, content: syncKey },
    { tag: 'CollectionId', page: 0, content: collectionId },
    { tag: 'GetChanges', page: 0, content: '0' },
    { tag: 'Commands', page: 0, children: [{ tag: 'Change', page: 0, children: [
      { tag: 'ServerId', page: 0, content: serverId },
      { tag: 'ApplicationData', page: 0, children: [
        { tag: 'TimeZone', page: 4, content: timeZone },
        { tag: 'AllDayEvent', page: 4, content: '0' },
        { tag: 'BusyStatus', page: 4, content: '2' },
        { tag: 'DtStamp', page: 4, content: '20260621T140000Z' },
        { tag: 'EndTime', page: 4, content: '20270305T150000Z' },
        { tag: 'Location', page: 4, content: 'Changed ActiveSync Smoke' },
        { tag: 'MeetingStatus', page: 4, content: '0' },
        { tag: 'Reminder', page: 4, content: '5' },
        { tag: 'Sensitivity', page: 4, content: '0' },
        { tag: 'Subject', page: 4, content: subject },
        { tag: 'StartTime', page: 4, content: '20270305T140000Z' },
        { tag: 'UID', page: 4, content: uid },
        { tag: 'Categories', page: 4, children: [{ tag: 'Category', page: 4, content: marker }] },
        { tag: 'Recurrence', page: 4, children: [
          { tag: 'Type', page: 4, content: '1' },
          { tag: 'Occurrences', page: 4, content: '4' },
          { tag: 'Interval', page: 4, content: '1' },
          { tag: 'DayOfWeek', page: 4, content: '32' },
        ] },
        { tag: 'Body', page: 17, children: [
          { tag: 'Type', page: 17, content: '1' },
          { tag: 'Data', page: 17, content: 'Changed through ActiveSync calendar smoke' },
        ] },
      ] },
    ] }] },
  ] }],
}] });
process.stdout.write(writer.getBuffer());
NODE
eas_post_url "${eas_sync_url}" "${tmpdir}/change.wbxml" "${tmpdir}/change.out" "calendar Change"
post_change_key=$(parse_quiet_sync_key "${tmpdir}/change.out" "${cal_collection_id}" "Calendar Change")
eas_post_url "${eas_sync_url}" "${tmpdir}/change.wbxml" "${tmpdir}/change-retry.out" "calendar Change retry"
cmp -s "${tmpdir}/change.out" "${tmpdir}/change-retry.out" \
  || fail "Calendar Change retry was not byte-identical"

event_get_status=$(curl_safe -sS \
  -o "${tmpdir}/after-change.ics" -w '%{http_code}' "${eas_event_url}") \
  || fail "CalDAV GET failed after ActiveSync Change"
[[ "${event_get_status}" == "200" ]] || fail "CalDAV GET after ActiveSync Change returned HTTP ${event_get_status}"
grep -Fq "SUMMARY:${eas_changed_subject}" "${tmpdir}/after-change.ics" \
  || fail "CalDAV did not expose the ActiveSync event Change"
grep -Fq 'LOCATION:Changed ActiveSync Smoke' "${tmpdir}/after-change.ics" \
  || fail "CalDAV did not expose the changed ActiveSync event location"
grep -Fq 'DESCRIPTION:Changed through ActiveSync calendar smoke' "${tmpdir}/after-change.ics" \
  || fail "CalDAV did not expose the changed ActiveSync event body"
report_calendar "${tmpdir}/after-change.xml" || fail "CalDAV REPORT failed after ActiveSync Change"
write_matching_event_urls "${tmpdir}/after-change.xml" "${eas_marker}" "${tmpdir}/after-change.urls" "${cal_collection_id}" "${eas_resource_name}"
mapfile -t changed_event_urls < "${tmpdir}/after-change.urls"
[[ ${#changed_event_urls[@]} -eq 1 && "${changed_event_urls[0]}" == "${eas_event_url}" ]] \
  || fail "ActiveSync Change created a duplicate CalDAV event"

node - "${cal_collection_id}" "${post_change_key}" <<'NODE' > "${tmpdir}/no-echo-after-change.wbxml"
const { WbxmlWriter } = require('./webmail-backend/src/wbxml/writer.js');
const writer = new WbxmlWriter();
writer.writeNode({ tag: 'Sync', page: 0, children: [{
  tag: 'Collections', page: 0, children: [{ tag: 'Collection', page: 0, children: [
    { tag: 'SyncKey', page: 0, content: process.argv[3] },
    { tag: 'CollectionId', page: 0, content: process.argv[2] },
    { tag: 'GetChanges', page: 0, content: '1' },
    { tag: 'WindowSize', page: 0, content: '512' },
  ] }],
}] });
process.stdout.write(writer.getBuffer());
NODE
eas_post_url "${eas_sync_url}" "${tmpdir}/no-echo-after-change.wbxml" "${tmpdir}/no-echo-after-change.out" "calendar post-Change poll"
post_change_poll_key=$(parse_quiet_sync_key "${tmpdir}/no-echo-after-change.out" "${cal_collection_id}" "Calendar post-Change poll")

node - "${cal_collection_id}" "${post_change_poll_key}" "${eas_server_id}" <<'NODE' > "${tmpdir}/delete.wbxml"
const { WbxmlWriter } = require('./webmail-backend/src/wbxml/writer.js');
const writer = new WbxmlWriter();
writer.writeNode({ tag: 'Sync', page: 0, children: [{
  tag: 'Collections', page: 0, children: [{ tag: 'Collection', page: 0, children: [
    { tag: 'SyncKey', page: 0, content: process.argv[3] },
    { tag: 'CollectionId', page: 0, content: process.argv[2] },
    { tag: 'GetChanges', page: 0, content: '0' },
    { tag: 'Commands', page: 0, children: [{ tag: 'Delete', page: 0, children: [
      { tag: 'ServerId', page: 0, content: process.argv[4] },
    ] }] },
  ] }],
}] });
process.stdout.write(writer.getBuffer());
NODE
eas_post_url "${eas_sync_url}" "${tmpdir}/delete.wbxml" "${tmpdir}/delete.out" "calendar Delete"
parse_quiet_sync_key "${tmpdir}/delete.out" "${cal_collection_id}" "Calendar Delete" > /dev/null
eas_post_url "${eas_sync_url}" "${tmpdir}/delete.wbxml" "${tmpdir}/delete-retry.out" "calendar Delete retry"
cmp -s "${tmpdir}/delete.out" "${tmpdir}/delete-retry.out" \
  || fail "Calendar Delete retry was not byte-identical"

deleted_get_status=$(curl_safe -sS \
  -o "${tmpdir}/after-delete.ics" -w '%{http_code}' "${eas_event_url}") \
  || fail "CalDAV GET failed after ActiveSync Delete"
[[ "${deleted_get_status}" == "404" ]] \
  || fail "CalDAV GET after ActiveSync Delete returned HTTP ${deleted_get_status}"
report_calendar "${tmpdir}/after-delete.xml" || fail "CalDAV REPORT failed after ActiveSync Delete"
write_matching_event_urls "${tmpdir}/after-delete.xml" "${eas_marker}" "${tmpdir}/after-delete.urls" "${cal_collection_id}" "${eas_resource_name}"
mapfile -t deleted_event_urls < "${tmpdir}/after-delete.urls"
[[ ${#deleted_event_urls[@]} -eq 0 ]] \
  || fail "ActiveSync Delete left ${#deleted_event_urls[@]} live CalDAV events"

delete_calendar "${tmpdir}/calendar-delete.out" || fail "disposable calendar cleanup failed"
calendar_created=false

echo "PASS: calendar sync smoke completed"
