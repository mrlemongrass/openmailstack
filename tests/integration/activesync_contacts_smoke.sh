#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "${PROJECT_ROOT}"

BASE_URL=${OMS_SMOKE_BASE_URL:-https://mail.housevo.us}
BASE_URL=${BASE_URL%/}
SMOKE_USER=${OMS_SMOKE_USER:-}
SMOKE_PASSWORD=${OMS_SMOKE_PASSWORD:-}

if [[ -z "${SMOKE_USER}" || -z "${SMOKE_PASSWORD}" ]]; then
  echo "SKIP: set OMS_SMOKE_USER and OMS_SMOKE_PASSWORD to run authenticated ActiveSync contacts smoke checks"
  exit 0
fi

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

vcard_has_internet_email() {
  local vcard_file=$1
  local expected_email=$2
  node - "${vcard_file}" "${expected_email}" <<'NODE'
const fs = require('fs');
const lines = fs.readFileSync(process.argv[2], 'utf8')
  .replace(/\r\n[ \t]/g, '')
  .replace(/\n[ \t]/g, '')
  .replace(/\r/g, '\n')
  .split('\n');
const expected = process.argv[3];
for (const line of lines) {
  const separator = line.indexOf(':');
  if (separator < 0) continue;
  const header = line.slice(0, separator).split(';');
  const property = (header.shift() || '').split('.').pop()?.toUpperCase();
  if (property !== 'EMAIL') continue;
  const types = new Set();
  for (const parameter of header) {
    const equals = parameter.indexOf('=');
    if (equals < 0) {
      types.add(parameter.trim().toUpperCase());
      continue;
    }
    if (parameter.slice(0, equals).trim().toUpperCase() !== 'TYPE') continue;
    for (const value of parameter.slice(equals + 1).split(',')) {
      if (value.trim()) types.add(value.trim().toUpperCase());
    }
  }
  if (types.has('INTERNET') && line.slice(separator + 1) === expected) process.exit(0);
}
process.exit(1);
NODE
}

DEVICE_ID=${OMS_SMOKE_DEVICE_ID:-OMSCT$(openssl rand -hex 10)}
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

contact_run_id=${OMS_SMOKE_CONTACT_RUN_ID:-omsct$(openssl rand -hex 12)}
[[ "${contact_run_id}" =~ ^[a-z0-9]{1,32}$ ]] \
  || fail "OMS_SMOKE_CONTACT_RUN_ID must contain 1-32 lowercase ASCII letters or digits"
seed_uid="oms-eas-seed-${contact_run_id}"
seed_name="OMS EAS Seed ${contact_run_id}"
seed_email="oms-eas-seed-${contact_run_id}@example.invalid"
seed_birthday="1990-02-03"
seed_birthday_eas="${seed_birthday}T00:00:00.000Z"
eas_name="OMS EAS Added ${contact_run_id}"
eas_changed_name="OMS EAS Changed ${contact_run_id}"
eas_email="oms-eas-added-${contact_run_id}@example.invalid"
eas_changed_email="oms-eas-changed-${contact_run_id}@example.invalid"
eas_birthday="1985-04-05"
eas_birthday_value="${eas_birthday}T00:00:00.000Z"
eas_changed_birthday="1986-06-07"
eas_changed_birthday_value="${eas_changed_birthday}T00:00:00.000Z"
(( ${#seed_birthday_eas} <= 32 && ${#eas_birthday_value} <= 32 && ${#eas_changed_birthday_value} <= 32 )) \
  || fail "ActiveSync birthday smoke values exceed the 32-byte field bound"
eas_client_id="C$(openssl rand -hex 20)"
eas_contact_url=''
eas_contact_dav_uid=''
encoded_user=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "${SMOKE_USER}")
addressbook_url="${BASE_URL}/carddav/addressbooks/${encoded_user}/personal/"
seed_url="${addressbook_url}${seed_uid}.vcf"
eas_base="${BASE_URL}/Microsoft-Server-ActiveSync?User=${encoded_user}&DeviceId=${DEVICE_ID}&DeviceType=CodexSmoke"
report_body="${tmpdir}/addressbook-query.xml"

cat > "${report_body}" <<'XML'
<?xml version="1.0" encoding="utf-8" ?>
<C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
</C:addressbook-query>
XML

report_contacts() {
  local output_file=$1
  local status
  status=$(curl_safe -sS -X REPORT \
    -H 'Depth: 1' \
    -H 'Content-Type: application/xml; charset=utf-8' \
    --data-binary @"${report_body}" \
    -o "${output_file}" \
    -w '%{http_code}' \
    "${addressbook_url}") || return 1
  [[ "${status}" == "207" ]]
}

write_matching_contact_urls() {
  local report_file=$1
  local marker=$2
  local output_file=$3
  node - "${report_file}" "${marker}" "${BASE_URL}" "${SMOKE_USER}" <<'NODE' > "${output_file}"
const fs = require('fs');
const xml = fs.readFileSync(process.argv[2], 'utf8');
const marker = process.argv[3];
const baseUrl = process.argv[4];
const user = process.argv[5];
const decodeXml = value => value
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'");
const urls = [];
for (const match of xml.matchAll(/<(?:[A-Za-z0-9_-]+:)?response\b[\s\S]*?<\/(?:[A-Za-z0-9_-]+:)?response>/gi)) {
  if (!match[0].includes(marker)) continue;
  const href = match[0].match(/<(?:[A-Za-z0-9_-]+:)?href\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?href>/i)?.[1];
  if (!href) throw new Error(`CardDAV response containing ${marker} omitted href`);
  const url = new URL(decodeXml(href.trim()), baseUrl);
  const pathname = decodeURIComponent(url.pathname);
  if (url.origin !== new URL(baseUrl).origin
      || !pathname.startsWith(`/carddav/addressbooks/${user}/personal/`)) {
    throw new Error(`Refusing unexpected CardDAV cleanup href ${url.pathname}`);
  }
  urls.push(url.toString());
}
if (urls.length > 0) process.stdout.write(`${[...new Set(urls)].join('\n')}\n`);
NODE
}

delete_dav_url() {
  local url=$1
  local output_file=$2
  local status
  status=$(curl_safe -sS -X DELETE \
    -o "${output_file}" \
    -w '%{http_code}' \
    "${url}") || return 1
  [[ "${status}" == "204" || "${status}" == "404" ]]
}

cleanup_marker_contacts() {
  local marker=$1
  local label=$2
  local cleanup_report="${tmpdir}/cleanup-${label}.xml"
  local cleanup_urls="${tmpdir}/cleanup-${label}.urls"
  [[ -n "${marker}" ]] || return 0
  report_contacts "${cleanup_report}" || return 1
  write_matching_contact_urls "${cleanup_report}" "${marker}" "${cleanup_urls}" || return 1
  while IFS= read -r contact_url || [[ -n "${contact_url}" ]]; do
    [[ -n "${contact_url}" ]] || continue
    delete_dav_url "${contact_url}" "${tmpdir}/cleanup-${label}.out" || return 1
  done < "${cleanup_urls}"
}

cleanup() {
  local exit_status=$?
  local cleanup_failed=0
  trap - EXIT
  set +e
  if [[ -n "${eas_contact_url:-}" ]] \
      && ! delete_dav_url "${eas_contact_url}" "${tmpdir}/cleanup-exact-added.out"; then
    echo "WARN: cleanup failed: could not remove the exact ActiveSync-created contact" >&2
    cleanup_failed=1
  fi
  if ! cleanup_marker_contacts "${seed_email:-}" seed; then
    echo "WARN: cleanup failed: could not remove the seeded ActiveSync contact" >&2
    cleanup_failed=1
  fi
  if ! cleanup_marker_contacts "${eas_email:-}" added; then
    echo "WARN: cleanup failed: could not remove the ActiveSync-created contact" >&2
    cleanup_failed=1
  fi
  if ! cleanup_marker_contacts "${eas_changed_email:-}" changed; then
    echo "WARN: cleanup failed: could not remove the changed ActiveSync-created contact" >&2
    cleanup_failed=1
  fi
  rm -rf -- "${tmpdir}"
  if (( cleanup_failed != 0 && exit_status == 0 )); then
    exit_status=1
  fi
  exit "${exit_status}"
}
trap cleanup EXIT

eas_post() {
  local command=$1
  local request_file=$2
  local response_file=$3
  local status
  status=$(curl_safe -sS -X POST \
    -H 'Content-Type: application/vnd.ms-sync.wbxml' \
    --data-binary @"${request_file}" \
    -o "${response_file}" \
    -w '%{http_code}' \
    "${eas_base}&Cmd=${command}") || fail "ActiveSync ${command} request failed"
  [[ "${status}" == "200" ]] || fail "ActiveSync ${command} returned HTTP ${status}"
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
const collections = child(ast, 'Collections');
const collectionNodes = (collections?.children || []).filter(node => node.tag === 'Collection');
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

options_status=$(curl_safe -sS -X OPTIONS \
  -D "${tmpdir}/options.headers" \
  -o "${tmpdir}/options.out" \
  -w '%{http_code}' \
  "${eas_base}") || fail "ActiveSync OPTIONS request failed"
[[ "${options_status}" == "200" ]] || fail "ActiveSync OPTIONS returned HTTP ${options_status}"
options_commands=$(tr -d '\r' < "${tmpdir}/options.headers" | awk -F': *' 'tolower($1) == "ms-asprotocolcommands" { print $2; exit }')
[[ -n "${options_commands}" ]] || fail "ActiveSync OPTIONS omitted MS-ASProtocolCommands"
[[ ",${options_commands}," != *",GetItemEstimate,"* ]] \
  || fail "ActiveSync OPTIONS advertised unsupported GetItemEstimate"

cat > "${tmpdir}/seed.vcf" <<VCF
BEGIN:VCARD
VERSION:3.0
UID:${seed_uid}
FN:${seed_name}
N:Seed;EAS;;;
EMAIL;TYPE=INTERNET:${seed_email}
TEL;TYPE=CELL:+15555550234
BDAY:${seed_birthday}
END:VCARD
VCF

seed_status=$(curl_safe -sS -X PUT \
  -H 'Content-Type: text/vcard; charset=utf-8' \
  --data-binary @"${tmpdir}/seed.vcf" \
  -o "${tmpdir}/seed-put.out" \
  -w '%{http_code}' \
  "${seed_url}") || fail "seed contact PUT failed"
[[ "${seed_status}" == "201" || "${seed_status}" == "204" ]] \
  || fail "seed contact PUT returned HTTP ${seed_status}"

node <<'NODE' > "${tmpdir}/foldersync.wbxml"
const { WbxmlWriter } = require('./webmail-backend/src/wbxml/writer.js');
const writer = new WbxmlWriter();
writer.writeNode({
  tag: 'FolderSync',
  page: 7,
  children: [{ tag: 'SyncKey', page: 7, content: '0' }],
});
process.stdout.write(writer.getBuffer());
NODE
eas_post FolderSync "${tmpdir}/foldersync.wbxml" "${tmpdir}/foldersync.out"
eas_post FolderSync "${tmpdir}/foldersync.wbxml" "${tmpdir}/foldersync-retry.out"
cmp -s "${tmpdir}/foldersync.out" "${tmpdir}/foldersync-retry.out" \
  || fail "FolderSync key-zero retry was not byte-identical"

contacts_collection_id=$(node - "${tmpdir}/foldersync.out" <<'NODE'
const fs = require('fs');
const { WbxmlParser } = require('./webmail-backend/src/wbxml/parser.js');
const ast = new WbxmlParser(fs.readFileSync(process.argv[2])).parse();
const child = (node, tag) => (node?.children || []).find(candidate => candidate.tag === tag);
const text = (node, tag) => child(node, tag)?.content?.toString() || '';
if (ast.tag !== 'FolderSync' || ast.page !== 7 || text(ast, 'Status') !== '1') {
  throw new Error('FolderSync did not return Status 1');
}
const changes = child(ast, 'Changes');
const contacts = (changes?.children || []).filter(node => node.tag === 'Add').find(node =>
  text(node, 'DisplayName') === 'Contacts' && text(node, 'Type') === '9');
const collectionId = text(contacts, 'ServerId');
if (!collectionId || Buffer.byteLength(collectionId) > 64) {
  throw new Error('FolderSync did not return a bounded Contacts CollectionId');
}
process.stdout.write(collectionId);
NODE
)

node - "${contacts_collection_id}" <<'NODE' > "${tmpdir}/prime.wbxml"
const { WbxmlWriter } = require('./webmail-backend/src/wbxml/writer.js');
const writer = new WbxmlWriter();
writer.writeNode({
  tag: 'Sync', page: 0, children: [{
    tag: 'Collections', page: 0, children: [{
      tag: 'Collection', page: 0, children: [
        { tag: 'SyncKey', page: 0, content: '0' },
        { tag: 'CollectionId', page: 0, content: process.argv[2] },
      ],
    }],
  }],
});
process.stdout.write(writer.getBuffer());
NODE
eas_post Sync "${tmpdir}/prime.wbxml" "${tmpdir}/prime.out"
prime_key=$(parse_quiet_sync_key "${tmpdir}/prime.out" "${contacts_collection_id}" "Contacts key-zero prime")
eas_post Sync "${tmpdir}/prime.wbxml" "${tmpdir}/prime-retry.out"
cmp -s "${tmpdir}/prime.out" "${tmpdir}/prime-retry.out" \
  || fail "Contacts key-zero retry was not byte-identical"

node - "${contacts_collection_id}" "${prime_key}" <<'NODE' > "${tmpdir}/initial.wbxml"
const { WbxmlWriter } = require('./webmail-backend/src/wbxml/writer.js');
const writer = new WbxmlWriter();
writer.writeNode({
  tag: 'Sync', page: 0, children: [{
    tag: 'Collections', page: 0, children: [{
      tag: 'Collection', page: 0, children: [
        { tag: 'SyncKey', page: 0, content: process.argv[3] },
        { tag: 'CollectionId', page: 0, content: process.argv[2] },
        { tag: 'GetChanges', page: 0, content: '1' },
        { tag: 'WindowSize', page: 0, content: '512' },
      ],
    }],
  }],
});
process.stdout.write(writer.getBuffer());
NODE
eas_post Sync "${tmpdir}/initial.wbxml" "${tmpdir}/initial.out"
initial_values=$(node - "${tmpdir}/initial.out" "${contacts_collection_id}" "${seed_email}" "${seed_name}" "${seed_birthday_eas}" <<'NODE'
const fs = require('fs');
const { WbxmlParser } = require('./webmail-backend/src/wbxml/parser.js');
const ast = new WbxmlParser(fs.readFileSync(process.argv[2])).parse();
const collectionId = process.argv[3];
const expectedEmail = process.argv[4];
const expectedName = process.argv[5];
const expectedBirthday = process.argv[6];
const child = (node, tag) => (node?.children || []).find(candidate => candidate.tag === tag);
const text = (node, tag) => child(node, tag)?.content?.toString() || '';
const collection = child(child(ast, 'Collections'), 'Collection');
if (!collection || text(collection, 'CollectionId') !== collectionId || text(collection, 'Status') !== '1') {
  throw new Error('Initial Contacts Sync did not return collection Status 1');
}
if (child(collection, 'Responses')) throw new Error('Initial Contacts Sync unexpectedly returned Responses');
const adds = (child(collection, 'Commands')?.children || []).filter(node => node.tag === 'Add');
const matches = adds.filter(add => {
  const data = child(add, 'ApplicationData');
  return text(data, 'Email1Address') === expectedEmail
    && text(data, 'FileAs') === expectedName
    && text(data, 'Birthday') === expectedBirthday;
});
if (matches.length !== 1) throw new Error(`Initial Contacts Sync returned ${matches.length} seeded Adds`);
const serverId = text(matches[0], 'ServerId');
if (!/^[0-9a-f]{64}$/.test(serverId) || Buffer.byteLength(serverId) > 64) {
  throw new Error('Initial Contacts Sync returned an invalid opaque ServerId');
}
const syncKey = text(collection, 'SyncKey');
if (!/^oms-pim-[0-9a-f]{48}$/.test(syncKey) || Buffer.byteLength(syncKey) > 64) {
  throw new Error('Initial Contacts Sync returned an invalid opaque SyncKey');
}
process.stdout.write(`${syncKey}\t${serverId}`);
NODE
)
IFS=$'\t' read -r contacts_sync_key seed_server_id <<< "${initial_values}"
[[ "${seed_server_id}" =~ ^[0-9a-f]{64}$ ]] || fail "seeded contact ServerId capture failed"
eas_post Sync "${tmpdir}/initial.wbxml" "${tmpdir}/initial-retry.out"
cmp -s "${tmpdir}/initial.out" "${tmpdir}/initial-retry.out" \
  || fail "Contacts initial keyed retry was not byte-identical"

node - "${contacts_collection_id}" "${contacts_sync_key}" "${eas_client_id}" "${eas_name}" "${eas_email}" "${eas_birthday_value}" <<'NODE' > "${tmpdir}/add.wbxml"
const { WbxmlWriter } = require('./webmail-backend/src/wbxml/writer.js');
const [collectionId, syncKey, clientId, name, email, birthday] = process.argv.slice(2);
const writer = new WbxmlWriter();
writer.writeNode({
  tag: 'Sync', page: 0, children: [{
    tag: 'Collections', page: 0, children: [{
      tag: 'Collection', page: 0, children: [
        { tag: 'SyncKey', page: 0, content: syncKey },
        { tag: 'CollectionId', page: 0, content: collectionId },
        { tag: 'GetChanges', page: 0, content: '0' },
        { tag: 'Commands', page: 0, children: [{
          tag: 'Add', page: 0, children: [
            { tag: 'ClientId', page: 0, content: clientId },
            { tag: 'ApplicationData', page: 0, children: [
              { tag: 'FileAs', page: 1, content: name },
              { tag: 'FirstName', page: 1, content: 'Added' },
              { tag: 'LastName', page: 1, content: 'Contact' },
              { tag: 'Email1Address', page: 1, content: email },
              { tag: 'MobilePhoneNumber', page: 1, content: '+15555550235' },
              { tag: 'Birthday', page: 1, content: birthday },
              { tag: 'NickName', page: 12, content: 'BeforeChange' },
              { tag: 'Body', page: 17, children: [
                { tag: 'Type', page: 17, content: '1' },
                { tag: 'Data', page: 17, content: 'Created by ActiveSync contacts smoke' },
              ] },
            ] },
          ],
        }] },
      ],
    }],
  }],
});
process.stdout.write(writer.getBuffer());
NODE
eas_post Sync "${tmpdir}/add.wbxml" "${tmpdir}/add.out"
add_values=$(node - "${tmpdir}/add.out" "${contacts_collection_id}" "${eas_client_id}" <<'NODE'
const fs = require('fs');
const { WbxmlParser } = require('./webmail-backend/src/wbxml/parser.js');
const ast = new WbxmlParser(fs.readFileSync(process.argv[2])).parse();
const collectionId = process.argv[3];
const clientId = process.argv[4];
const child = (node, tag) => (node?.children || []).find(candidate => candidate.tag === tag);
const text = (node, tag) => child(node, tag)?.content?.toString() || '';
const collection = child(child(ast, 'Collections'), 'Collection');
if (!collection || text(collection, 'CollectionId') !== collectionId || text(collection, 'Status') !== '1') {
  throw new Error('Contacts Add did not return collection Status 1');
}
if (child(collection, 'Commands')) throw new Error('Contacts Add echoed Commands');
const responseChildren = child(collection, 'Responses')?.children || [];
const addResponses = responseChildren.filter(node => node.tag === 'Add' && text(node, 'ClientId') === clientId);
if (responseChildren.length !== 1 || addResponses.length !== 1 || text(addResponses[0], 'Status') !== '1') {
  throw new Error('Contacts Add did not return one successful ClientId mapping');
}
const serverId = text(addResponses[0], 'ServerId');
if (!/^[0-9a-f]{64}$/.test(serverId) || Buffer.byteLength(serverId) > 64) {
  throw new Error('Contacts Add returned an invalid opaque ServerId');
}
const syncKey = text(collection, 'SyncKey');
if (!/^oms-pim-[0-9a-f]{48}$/.test(syncKey)) throw new Error('Contacts Add returned an invalid SyncKey');
process.stdout.write(`${syncKey}\t${serverId}`);
NODE
)
IFS=$'\t' read -r post_add_key eas_server_id <<< "${add_values}"
eas_post Sync "${tmpdir}/add.wbxml" "${tmpdir}/add-retry.out"
cmp -s "${tmpdir}/add.out" "${tmpdir}/add-retry.out" \
  || fail "Contacts Add retry was not byte-identical"

report_contacts "${tmpdir}/after-add.xml" || fail "CardDAV REPORT failed after ActiveSync Add"
write_matching_contact_urls "${tmpdir}/after-add.xml" "${eas_email}" "${tmpdir}/after-add.urls"
mapfile -t eas_contact_urls < "${tmpdir}/after-add.urls"
[[ ${#eas_contact_urls[@]} -eq 1 ]] \
  || fail "ActiveSync Add created ${#eas_contact_urls[@]} CardDAV contacts instead of exactly one"
eas_contact_url=${eas_contact_urls[0]}
eas_contact_dav_uid=$(node - "${eas_contact_url}" <<'NODE'
const url = new URL(process.argv[2]);
const leaf = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '');
const davUid = leaf.endsWith('.vcf') ? leaf.slice(0, -4) : '';
if (!/^[A-Za-z0-9._~-]{1,255}$/.test(davUid)) {
  throw new Error('ActiveSync Add returned an unsafe CardDAV identity');
}
process.stdout.write(davUid);
NODE
)
printf 'OMS_PROTOCOL_GATE_CONTACT_DAV_UID\t%s\n' "${eas_contact_dav_uid}"
get_status=$(curl_safe -sS \
  -o "${tmpdir}/after-add.vcf" -w '%{http_code}' "${eas_contact_url}") \
  || fail "CardDAV GET failed after ActiveSync Add"
[[ "${get_status}" == "200" ]] || fail "CardDAV GET after ActiveSync Add returned HTTP ${get_status}"
grep -Fq "FN:${eas_name}" "${tmpdir}/after-add.vcf" \
  || fail "CardDAV did not expose the ActiveSync-created contact"
vcard_has_internet_email "${tmpdir}/after-add.vcf" "${eas_email}" \
  || fail "CardDAV did not expose the ActiveSync-created contact email"
grep -Fq "BDAY:${eas_birthday}" "${tmpdir}/after-add.vcf" \
  || fail "CardDAV did not expose the bounded ActiveSync Birthday"

node - "${contacts_collection_id}" "${post_add_key}" <<'NODE' > "${tmpdir}/no-echo-after-add.wbxml"
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
eas_post Sync "${tmpdir}/no-echo-after-add.wbxml" "${tmpdir}/no-echo-after-add.out"
post_add_poll_key=$(parse_quiet_sync_key "${tmpdir}/no-echo-after-add.out" "${contacts_collection_id}" "Contacts post-Add poll")

node - "${contacts_collection_id}" "${post_add_poll_key}" "${eas_server_id}" "${eas_changed_name}" "${eas_changed_email}" "${eas_changed_birthday_value}" <<'NODE' > "${tmpdir}/change.wbxml"
const { WbxmlWriter } = require('./webmail-backend/src/wbxml/writer.js');
const [collectionId, syncKey, serverId, name, email, birthday] = process.argv.slice(2);
const writer = new WbxmlWriter();
writer.writeNode({ tag: 'Sync', page: 0, children: [{
  tag: 'Collections', page: 0, children: [{ tag: 'Collection', page: 0, children: [
    { tag: 'SyncKey', page: 0, content: syncKey },
    { tag: 'CollectionId', page: 0, content: collectionId },
    { tag: 'GetChanges', page: 0, content: '0' },
    { tag: 'Commands', page: 0, children: [{ tag: 'Change', page: 0, children: [
      { tag: 'ServerId', page: 0, content: serverId },
      { tag: 'ApplicationData', page: 0, children: [
        { tag: 'FileAs', page: 1, content: name },
        { tag: 'FirstName', page: 1, content: 'Changed' },
        { tag: 'LastName', page: 1, content: 'Contact' },
        { tag: 'Email1Address', page: 1, content: email },
        { tag: 'MobilePhoneNumber', page: 1, content: '+15555550235' },
        { tag: 'Birthday', page: 1, content: birthday },
        { tag: 'NickName', page: 12, content: 'AfterChange' },
        { tag: 'Body', page: 17, children: [
          { tag: 'Type', page: 17, content: '1' },
          { tag: 'Data', page: 17, content: 'Changed by ActiveSync contacts smoke' },
        ] },
      ] },
    ] }] },
  ] }],
}] });
process.stdout.write(writer.getBuffer());
NODE
eas_post Sync "${tmpdir}/change.wbxml" "${tmpdir}/change.out"
post_change_key=$(parse_quiet_sync_key "${tmpdir}/change.out" "${contacts_collection_id}" "Contacts Change")
eas_post Sync "${tmpdir}/change.wbxml" "${tmpdir}/change-retry.out"
cmp -s "${tmpdir}/change.out" "${tmpdir}/change-retry.out" \
  || fail "Contacts Change retry was not byte-identical"

get_status=$(curl_safe -sS \
  -o "${tmpdir}/after-change.vcf" -w '%{http_code}' "${eas_contact_url}") \
  || fail "CardDAV GET failed after ActiveSync Change"
[[ "${get_status}" == "200" ]] || fail "CardDAV GET after ActiveSync Change returned HTTP ${get_status}"
grep -Fq "FN:${eas_changed_name}" "${tmpdir}/after-change.vcf" \
  || fail "CardDAV did not expose the ActiveSync contact Change"
vcard_has_internet_email "${tmpdir}/after-change.vcf" "${eas_changed_email}" \
  || fail "CardDAV did not preserve the changed ActiveSync email"
grep -Fq 'NICKNAME:AfterChange' "${tmpdir}/after-change.vcf" \
  || fail "CardDAV did not preserve the Contacts2 nickname Change"
grep -Fq 'NOTE:Changed by ActiveSync contacts smoke' "${tmpdir}/after-change.vcf" \
  || fail "CardDAV did not preserve the ActiveSync contact Body as NOTE"
grep -Fq "BDAY:${eas_changed_birthday}" "${tmpdir}/after-change.vcf" \
  || fail "CardDAV did not preserve the changed ActiveSync Birthday"
report_contacts "${tmpdir}/after-change.xml" || fail "CardDAV REPORT failed after ActiveSync Change"
write_matching_contact_urls "${tmpdir}/after-change.xml" "${eas_changed_email}" "${tmpdir}/after-change.urls"
mapfile -t changed_contact_urls < "${tmpdir}/after-change.urls"
[[ ${#changed_contact_urls[@]} -eq 1 && "${changed_contact_urls[0]}" == "${eas_contact_url}" ]] \
  || fail "ActiveSync Change created a duplicate CardDAV contact"

node - "${contacts_collection_id}" "${post_change_key}" <<'NODE' > "${tmpdir}/no-echo-after-change.wbxml"
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
eas_post Sync "${tmpdir}/no-echo-after-change.wbxml" "${tmpdir}/no-echo-after-change.out"
post_change_poll_key=$(parse_quiet_sync_key "${tmpdir}/no-echo-after-change.out" "${contacts_collection_id}" "Contacts post-Change poll")

node - "${contacts_collection_id}" "${post_change_poll_key}" "${eas_server_id}" <<'NODE' > "${tmpdir}/delete.wbxml"
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
eas_post Sync "${tmpdir}/delete.wbxml" "${tmpdir}/delete.out"
parse_quiet_sync_key "${tmpdir}/delete.out" "${contacts_collection_id}" "Contacts Delete" > /dev/null
eas_post Sync "${tmpdir}/delete.wbxml" "${tmpdir}/delete-retry.out"
cmp -s "${tmpdir}/delete.out" "${tmpdir}/delete-retry.out" \
  || fail "Contacts Delete retry was not byte-identical"

deleted_get_status=$(curl_safe -sS \
  -o "${tmpdir}/after-delete.vcf" -w '%{http_code}' "${eas_contact_url}") \
  || fail "CardDAV GET failed after ActiveSync Delete"
[[ "${deleted_get_status}" == "404" ]] \
  || fail "CardDAV GET after ActiveSync Delete returned HTTP ${deleted_get_status}"
report_contacts "${tmpdir}/after-delete.xml" || fail "CardDAV REPORT failed after ActiveSync Delete"
write_matching_contact_urls "${tmpdir}/after-delete.xml" "${eas_changed_email}" "${tmpdir}/after-delete.urls"
mapfile -t deleted_contact_urls < "${tmpdir}/after-delete.urls"
[[ ${#deleted_contact_urls[@]} -eq 0 ]] \
  || fail "ActiveSync Delete left ${#deleted_contact_urls[@]} live CardDAV contacts"

delete_dav_url "${seed_url}" "${tmpdir}/seed-delete.out" \
  || fail "seed contact cleanup failed"

echo "PASS: ActiveSync contacts smoke completed"
