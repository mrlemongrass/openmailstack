#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${OMS_SMOKE_BASE_URL:-https://mail.housevo.us}
SMOKE_USER=${OMS_SMOKE_USER:-}
SMOKE_PASSWORD=${OMS_SMOKE_PASSWORD:-}

if [[ -z "${SMOKE_USER}" || -z "${SMOKE_PASSWORD}" ]]; then
  echo "SKIP: set OMS_SMOKE_USER and OMS_SMOKE_PASSWORD to run authenticated calendar sync smoke checks"
  exit 0
fi

tmpdir=$(mktemp -d)
cleanup() {
  rm -rf "${tmpdir}"
}
trap cleanup EXIT

timestamp=$(date +%s)
cal_slug="oms-smoke-${timestamp}"
cal_name="OMS Smoke ${timestamp}"
event_uid="oms-smoke-event-${timestamp}"
caldav_url="${BASE_URL}/caldav/calendars/${SMOKE_USER}/${cal_slug}/"
eas_foldersync_url="${BASE_URL}/Microsoft-Server-ActiveSync?Cmd=FolderSync&User=${SMOKE_USER}&DeviceId=OMSCalendarSmoke&DeviceType=CodexSmoke"
eas_sync_url="${BASE_URL}/Microsoft-Server-ActiveSync?Cmd=Sync&User=${SMOKE_USER}&DeviceId=OMSCalendarSmoke&DeviceType=CodexSmoke"

mkcalendar_body="${tmpdir}/mkcalendar.xml"
cat > "${mkcalendar_body}" <<XML
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

status=$(curl -sS -u "${SMOKE_USER}:${SMOKE_PASSWORD}" -X MKCALENDAR \
  -H 'Content-Type: application/xml; charset=utf-8' \
  --data-binary @"${mkcalendar_body}" \
  -o "${tmpdir}/mkcalendar.out" \
  -w '%{http_code}' \
  "${caldav_url}")
if [[ "${status}" != "201" && "${status}" != "405" ]]; then
  echo "FAIL: MKCALENDAR returned HTTP ${status}"
  cat "${tmpdir}/mkcalendar.out"
  exit 1
fi

event_file="${tmpdir}/${event_uid}.ics"
cat > "${event_file}" <<ICS
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//OpenMailStack//Calendar Smoke//EN
BEGIN:VEVENT
UID:${event_uid}
DTSTAMP:20260621T130000Z
DTSTART:20260704T190000Z
DTEND:20260704T200000Z
SUMMARY:Calendar Smoke Event
LOCATION:Smoke Test
DESCRIPTION:Created by calendar_sync_smoke.sh
END:VEVENT
END:VCALENDAR
ICS

status=$(curl -sS -u "${SMOKE_USER}:${SMOKE_PASSWORD}" -X PUT \
  -H 'Content-Type: text/calendar; charset=utf-8' \
  --data-binary @"${event_file}" \
  -o "${tmpdir}/put.out" \
  -w '%{http_code}' \
  "${caldav_url}${event_uid}.ics")
if [[ "${status}" != "201" && "${status}" != "204" ]]; then
  echo "FAIL: event PUT returned HTTP ${status}"
  cat "${tmpdir}/put.out"
  exit 1
fi

report_body="${tmpdir}/calendar-query.xml"
cat > "${report_body}" <<XML
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

status=$(curl -sS -u "${SMOKE_USER}:${SMOKE_PASSWORD}" -X REPORT \
  -H 'Depth: 1' \
  -H 'Content-Type: application/xml; charset=utf-8' \
  --data-binary @"${report_body}" \
  -o "${tmpdir}/report.out" \
  -w '%{http_code}' \
  "${caldav_url}")
if [[ "${status}" != "207" ]] || ! grep -q 'Calendar Smoke Event' "${tmpdir}/report.out"; then
  echo "FAIL: REPORT did not return the smoke event"
  cat "${tmpdir}/report.out"
  exit 1
fi

node - <<'NODE' > "${tmpdir}/foldersync-0.wbxml"
const { WbxmlWriter } = require('./webmail-backend/src/wbxml/writer.js');
const writer = new WbxmlWriter();
writer.writeNode({
  tag: 'FolderSync',
  page: 7,
  children: [{ tag: 'SyncKey', page: 7, content: '0' }]
});
process.stdout.write(writer.getBuffer());
NODE

curl -sS -u "${SMOKE_USER}:${SMOKE_PASSWORD}" -X POST \
  -H 'Content-Type: application/vnd.ms-sync.wbxml' \
  --data-binary @"${tmpdir}/foldersync-0.wbxml" \
  -o "${tmpdir}/foldersync-0.out" \
  "${eas_foldersync_url}"

IFS=$'\t' read -r sync_key cal_collection_id < <(node - "${tmpdir}/foldersync-0.out" "${cal_name}" <<'NODE'
const fs = require('fs');
const { WbxmlParser } = require('./webmail-backend/src/wbxml/parser.js');
const file = process.argv[2];
const expectedCalendar = process.argv[3];
const ast = new WbxmlParser(fs.readFileSync(file)).parse();
const values = [];
const folders = [];
function childContent(node, tag) {
  const child = (node.children || []).find(c => c.tag === tag);
  return child && child.content ? child.content.toString() : '';
}
function walk(node) {
  if (!node) return;
  values.push({ tag: node.tag, content: node.content && node.content.toString() });
  if (node.tag === 'Add') {
    folders.push({
      serverId: childContent(node, 'ServerId'),
      displayName: childContent(node, 'DisplayName'),
      type: childContent(node, 'Type'),
    });
  }
  for (const child of node.children || []) walk(child);
}
walk(ast);
if (!values.some(v => v.tag === 'Status' && v.content === '1')) {
  throw new Error('FolderSync did not return Status 1');
}
const key = values.find(v => v.tag === 'SyncKey' && v.content && v.content !== '0')?.content;
if (!key) throw new Error('FolderSync did not return a nonzero SyncKey');
const calendar = folders.find(folder => folder.displayName === expectedCalendar && folder.type === '8');
if (!calendar) {
  throw new Error(`FolderSync did not include ${expectedCalendar}`);
}
process.stdout.write(`${key}\t${calendar.serverId}\n`);
NODE
)
if [[ -z "${cal_collection_id}" ]]; then
  echo "FAIL: FolderSync did not return a calendar CollectionId for ${cal_name}"
  exit 1
fi

node - "${cal_collection_id}" <<'NODE' > "${tmpdir}/sync-initial-calendar.wbxml"
const { WbxmlWriter } = require('./webmail-backend/src/wbxml/writer.js');
const collectionId = process.argv[2];
const writer = new WbxmlWriter();
writer.writeNode({
  tag: 'Sync',
  page: 0,
  children: [{
    tag: 'Collections',
    page: 0,
    children: [{
      tag: 'Collection',
      page: 0,
      children: [
        { tag: 'SyncKey', page: 0, content: '0' },
        { tag: 'CollectionId', page: 0, content: collectionId },
        { tag: 'GetChanges', page: 0 },
        { tag: 'WindowSize', page: 0, content: '25' }
      ]
    }]
  }]
});
process.stdout.write(writer.getBuffer());
NODE

curl -sS -u "${SMOKE_USER}:${SMOKE_PASSWORD}" -X POST \
  -H 'Content-Type: application/vnd.ms-sync.wbxml' \
  --data-binary @"${tmpdir}/sync-initial-calendar.wbxml" \
  -o "${tmpdir}/sync-initial-calendar.out" \
  "${eas_sync_url}"

calendar_sync_key=$(node - "${tmpdir}/sync-initial-calendar.out" <<'NODE'
const fs = require('fs');
const { WbxmlParser } = require('./webmail-backend/src/wbxml/parser.js');
const ast = new WbxmlParser(fs.readFileSync(process.argv[2])).parse();
const values = [];
function walk(node) {
  if (!node) return;
  values.push({ tag: node.tag, content: node.content && node.content.toString() });
  for (const child of node.children || []) walk(child);
}
walk(ast);
if (!values.some(v => v.tag === 'Status' && v.content === '1')) {
  throw new Error('Initial ActiveSync calendar Sync did not return Status 1');
}
if (!values.some(v => v.tag === 'Subject' && v.content === 'Calendar Smoke Event')) {
  throw new Error('Initial ActiveSync calendar Sync did not return the CalDAV-created event');
}
const start = values.find(v => v.tag === 'StartTime')?.content || '';
if (!/^\d{8}T\d{6}Z$/.test(start)) {
  throw new Error(`Initial ActiveSync calendar StartTime was not compact UTC: ${start}`);
}
const key = values.find(v => v.tag === 'SyncKey' && v.content && v.content !== '0')?.content;
if (!key) throw new Error('Initial ActiveSync calendar Sync did not return a nonzero SyncKey');
process.stdout.write(`${key}\n`);
NODE
)

eas_event_uid="oms-eas-smoke-event-${timestamp}"
node - "${cal_collection_id}" "${calendar_sync_key}" "${eas_event_uid}" <<'NODE' > "${tmpdir}/sync-add-calendar.wbxml"
const { WbxmlWriter } = require('./webmail-backend/src/wbxml/writer.js');
const collectionId = process.argv[2];
const syncKey = process.argv[3];
const eventUid = process.argv[4];
const writer = new WbxmlWriter();
writer.writeNode({
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
        { tag: 'Commands', page: 0, children: [{
          tag: 'Add',
          page: 0,
          children: [
            { tag: 'ClientId', page: 0, content: eventUid },
            { tag: 'ApplicationData', page: 0, children: [
              { tag: 'Subject', page: 4, content: 'ActiveSync Calendar Smoke Event' },
              { tag: 'UID', page: 4, content: eventUid },
              { tag: 'StartTime', page: 4, content: '20260705T150000Z' },
              { tag: 'EndTime', page: 4, content: '20260705T160000Z' },
              { tag: 'DtStamp', page: 4, content: '20260621T130000Z' },
              { tag: 'AllDayEvent', page: 4, content: '0' },
              { tag: 'Location', page: 4, content: 'ActiveSync Smoke' },
              { tag: 'Body', page: 17, children: [
                { tag: 'Type', page: 17, content: '1' },
                { tag: 'Data', page: 17, content: 'Created through ActiveSync calendar smoke' },
                { tag: 'EstimatedDataSize', page: 17, content: '42' }
              ]}
            ]}
          ]
        }]}
      ]
    }]
  }]
});
process.stdout.write(writer.getBuffer());
NODE

curl -sS -u "${SMOKE_USER}:${SMOKE_PASSWORD}" -X POST \
  -H 'Content-Type: application/vnd.ms-sync.wbxml' \
  --data-binary @"${tmpdir}/sync-add-calendar.wbxml" \
  -o "${tmpdir}/sync-add-calendar.out" \
  "${eas_sync_url}"

calendar_post_add_sync_key=$(node - "${tmpdir}/sync-add-calendar.out" "${eas_event_uid}" <<'NODE'
const fs = require('fs');
const { WbxmlParser } = require('./webmail-backend/src/wbxml/parser.js');
const ast = new WbxmlParser(fs.readFileSync(process.argv[2])).parse();
const expectedServerId = process.argv[3];
const values = [];
let commandCount = 0;
function walk(node) {
  if (!node) return;
  values.push({ tag: node.tag, content: node.content && node.content.toString() });
  if (node.tag === 'Commands') commandCount += 1;
  for (const child of node.children || []) walk(child);
}
walk(ast);
if (!values.some(v => v.tag === 'Status' && v.content === '1')) {
  throw new Error('ActiveSync calendar Add did not return Status 1');
}
if (!values.some(v => v.tag === 'ServerId' && v.content === expectedServerId)) {
  throw new Error(`ActiveSync calendar Add did not return ServerId ${expectedServerId}`);
}
if (commandCount > 0) {
  throw new Error('ActiveSync calendar Add response echoed server Commands back to the client');
}
const key = values.find(v => v.tag === 'SyncKey' && v.content && v.content !== '0')?.content;
if (!key) throw new Error('ActiveSync calendar Add did not return a nonzero SyncKey');
process.stdout.write(`${key}\n`);
NODE
)

node - "${cal_collection_id}" "${calendar_post_add_sync_key}" <<'NODE' > "${tmpdir}/sync-after-add-calendar.wbxml"
const { WbxmlWriter } = require('./webmail-backend/src/wbxml/writer.js');
const collectionId = process.argv[2];
const syncKey = process.argv[3];
const writer = new WbxmlWriter();
writer.writeNode({
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
        { tag: 'GetChanges', page: 0 },
        { tag: 'WindowSize', page: 0, content: '25' }
      ]
    }]
  }]
});
process.stdout.write(writer.getBuffer());
NODE

curl -sS -u "${SMOKE_USER}:${SMOKE_PASSWORD}" -X POST \
  -H 'Content-Type: application/vnd.ms-sync.wbxml' \
  --data-binary @"${tmpdir}/sync-after-add-calendar.wbxml" \
  -o "${tmpdir}/sync-after-add-calendar.out" \
  "${eas_sync_url}"

node - "${tmpdir}/sync-after-add-calendar.out" <<'NODE'
const fs = require('fs');
const { WbxmlParser } = require('./webmail-backend/src/wbxml/parser.js');
const ast = new WbxmlParser(fs.readFileSync(process.argv[2])).parse();
const values = [];
let commandCount = 0;
function walk(node) {
  if (!node) return;
  values.push({ tag: node.tag, content: node.content && node.content.toString() });
  if (node.tag === 'Commands') commandCount += 1;
  for (const child of node.children || []) walk(child);
}
walk(ast);
if (!values.some(v => v.tag === 'Status' && v.content === '1')) {
  throw new Error('Post-add ActiveSync calendar Sync did not return Status 1');
}
if (commandCount > 0) {
  throw new Error('Post-add ActiveSync calendar Sync returned duplicate Commands for an already-current key');
}
NODE

status=$(curl -sS -u "${SMOKE_USER}:${SMOKE_PASSWORD}" -X REPORT \
  -H 'Depth: 1' \
  -H 'Content-Type: application/xml; charset=utf-8' \
  --data-binary @"${report_body}" \
  -o "${tmpdir}/report-after-eas.out" \
  -w '%{http_code}' \
  "${caldav_url}")
if [[ "${status}" != "207" ]] || ! grep -q 'ActiveSync Calendar Smoke Event' "${tmpdir}/report-after-eas.out"; then
  echo "FAIL: REPORT did not return the ActiveSync-created smoke event"
  cat "${tmpdir}/report-after-eas.out"
  exit 1
fi

second_slug="oms-smoke-second-${timestamp}"
second_name="OMS Smoke Second ${timestamp}"
second_url="${BASE_URL}/caldav/calendars/${SMOKE_USER}/${second_slug}/"
second_body="${tmpdir}/mkcalendar-second.xml"
sed "s/${cal_name}/${second_name}/" "${mkcalendar_body}" > "${second_body}"
status=$(curl -sS -u "${SMOKE_USER}:${SMOKE_PASSWORD}" -X MKCALENDAR \
  -H 'Content-Type: application/xml; charset=utf-8' \
  --data-binary @"${second_body}" \
  -o "${tmpdir}/mkcalendar-second.out" \
  -w '%{http_code}' \
  "${second_url}")
if [[ "${status}" != "201" && "${status}" != "405" ]]; then
  echo "FAIL: second MKCALENDAR returned HTTP ${status}"
  cat "${tmpdir}/mkcalendar-second.out"
  exit 1
fi

node - "${sync_key}" <<'NODE' > "${tmpdir}/foldersync-stale.wbxml"
const { WbxmlWriter } = require('./webmail-backend/src/wbxml/writer.js');
const syncKey = process.argv[2];
const writer = new WbxmlWriter();
writer.writeNode({
  tag: 'FolderSync',
  page: 7,
  children: [{ tag: 'SyncKey', page: 7, content: syncKey }]
});
process.stdout.write(writer.getBuffer());
NODE

curl -sS -u "${SMOKE_USER}:${SMOKE_PASSWORD}" -X POST \
  -H 'Content-Type: application/vnd.ms-sync.wbxml' \
  --data-binary @"${tmpdir}/foldersync-stale.wbxml" \
  -o "${tmpdir}/foldersync-stale.out" \
  "${eas_foldersync_url}"

node - "${tmpdir}/foldersync-stale.out" <<'NODE'
const fs = require('fs');
const { WbxmlParser } = require('./webmail-backend/src/wbxml/parser.js');
const ast = new WbxmlParser(fs.readFileSync(process.argv[2])).parse();
const statuses = [];
function walk(node) {
  if (!node) return;
  if (node.tag === 'Status' && node.content) statuses.push(node.content.toString());
  for (const child of node.children || []) walk(child);
}
walk(ast);
if (!statuses.includes('9')) {
  throw new Error(`Expected stale FolderSync key to return Status 9, got ${statuses.join(',')}`);
}
NODE

curl -sS -u "${SMOKE_USER}:${SMOKE_PASSWORD}" -X DELETE -o /dev/null -w '%{http_code}' "${second_url}" | grep -Eq '^(204|404)$'
curl -sS -u "${SMOKE_USER}:${SMOKE_PASSWORD}" -X DELETE -o /dev/null -w '%{http_code}' "${caldav_url}" | grep -Eq '^(204|404)$'

echo "PASS: calendar sync smoke completed"
