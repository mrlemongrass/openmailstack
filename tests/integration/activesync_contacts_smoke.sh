#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${OMS_SMOKE_BASE_URL:-https://mail.housevo.us}
SMOKE_USER=${OMS_SMOKE_USER:-}
SMOKE_PASSWORD=${OMS_SMOKE_PASSWORD:-}

if [[ -z "${SMOKE_USER}" || -z "${SMOKE_PASSWORD}" ]]; then
  echo "SKIP: set OMS_SMOKE_USER and OMS_SMOKE_PASSWORD to run authenticated ActiveSync contacts smoke checks"
  exit 0
fi

tmpdir=$(mktemp -d)
cleanup() {
  rm -rf "${tmpdir}"
}
trap cleanup EXIT

timestamp=$(date +%s)
contact_uid="oms-eas-contact-${timestamp}"
contact_name="OMS EAS Contact ${timestamp}"
contact_email="oms-eas-${timestamp}@example.invalid"
addressbook_url="${BASE_URL}/carddav/addressbooks/${SMOKE_USER}/personal/"
contact_url="${addressbook_url}${contact_uid}.vcf"
eas_base="${BASE_URL}/Microsoft-Server-ActiveSync?User=${SMOKE_USER}&DeviceId=OMSEASContactsSmoke&DeviceType=CodexSmoke"

vcard_file="${tmpdir}/${contact_uid}.vcf"
cat > "${vcard_file}" <<VCF
BEGIN:VCARD
VERSION:3.0
UID:${contact_uid}
FN:${contact_name}
N:Contact;EAS;;;
EMAIL;TYPE=INTERNET:${contact_email}
TEL;TYPE=CELL:+15555550234
END:VCARD
VCF

status=$(curl -sS -u "${SMOKE_USER}:${SMOKE_PASSWORD}" -X PUT \
  -H 'Content-Type: text/vcard; charset=utf-8' \
  --data-binary @"${vcard_file}" \
  -o "${tmpdir}/put.out" \
  -w '%{http_code}' \
  "${contact_url}")
if [[ "${status}" != "201" && "${status}" != "204" ]]; then
  echo "FAIL: seed contact PUT returned HTTP ${status}"
  cat "${tmpdir}/put.out"
  exit 1
fi

node <<'NODE' > "${tmpdir}/foldersync-0.wbxml"
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
  "${eas_base}&Cmd=FolderSync"

contacts_collection_id=$(node - "${tmpdir}/foldersync-0.out" <<'NODE'
const fs = require('fs');
const { WbxmlParser } = require('./webmail-backend/src/wbxml/parser.js');
const ast = new WbxmlParser(fs.readFileSync(process.argv[2])).parse();
const adds = [];
function walk(node) {
  if (!node) return;
  if (node.tag === 'Add') adds.push(node);
  for (const child of node.children || []) walk(child);
}
function childText(node, tag) {
  return (node.children || []).find(child => child.tag === tag)?.content?.toString() || '';
}
walk(ast);
if (!adds.length) throw new Error('FolderSync returned no Add nodes');
const contacts = adds.find(add => childText(add, 'DisplayName') === 'Contacts' && childText(add, 'Type') === '9');
if (!contacts) throw new Error('FolderSync did not include a Contacts folder');
process.stdout.write(childText(contacts, 'ServerId'));
NODE
)

if [[ -z "${contacts_collection_id}" ]]; then
  echo "FAIL: ActiveSync Contacts collection id was empty"
  exit 1
fi

node - "${contacts_collection_id}" <<'NODE' > "${tmpdir}/estimate.wbxml"
const { WbxmlWriter } = require('./webmail-backend/src/wbxml/writer.js');
const collectionId = process.argv[2];
const writer = new WbxmlWriter();
writer.writeNode({
  tag: 'GetItemEstimate',
  page: 6,
  children: [
    { tag: 'Collections', page: 6, children: [
      { tag: 'Collection', page: 6, children: [
        { tag: 'Class', page: 6, content: 'Contacts' },
        { tag: 'CollectionId', page: 6, content: collectionId }
      ]}
    ]}
  ]
});
process.stdout.write(writer.getBuffer());
NODE

curl -sS -u "${SMOKE_USER}:${SMOKE_PASSWORD}" -X POST \
  -H 'Content-Type: application/vnd.ms-sync.wbxml' \
  --data-binary @"${tmpdir}/estimate.wbxml" \
  -o "${tmpdir}/estimate.out" \
  "${eas_base}&Cmd=GetItemEstimate"

node - "${tmpdir}/estimate.out" <<'NODE'
const fs = require('fs');
const { WbxmlParser } = require('./webmail-backend/src/wbxml/parser.js');
const ast = new WbxmlParser(fs.readFileSync(process.argv[2])).parse();
let ok = false;
let estimate = -1;
function walk(node) {
  if (!node) return;
  if (node.tag === 'Status' && node.content?.toString() === '1') ok = true;
  if (node.tag === 'Estimate' && node.content) estimate = Number(node.content.toString());
  for (const child of node.children || []) walk(child);
}
walk(ast);
if (!ok) throw new Error('GetItemEstimate did not return Status 1');
if (!Number.isFinite(estimate) || estimate < 1) throw new Error(`GetItemEstimate returned invalid estimate ${estimate}`);
NODE

node - "${contacts_collection_id}" <<'NODE' > "${tmpdir}/contacts-sync.wbxml"
const { WbxmlWriter } = require('./webmail-backend/src/wbxml/writer.js');
const collectionId = process.argv[2];
const writer = new WbxmlWriter();
writer.writeNode({
  tag: 'Sync',
  page: 0,
  children: [
    { tag: 'Collections', page: 0, children: [
      { tag: 'Collection', page: 0, children: [
        { tag: 'SyncKey', page: 0, content: '0' },
        { tag: 'CollectionId', page: 0, content: collectionId },
        { tag: 'GetChanges', page: 0, content: '1' },
        { tag: 'WindowSize', page: 0, content: '50' }
      ]}
    ]}
  ]
});
process.stdout.write(writer.getBuffer());
NODE

curl -sS -u "${SMOKE_USER}:${SMOKE_PASSWORD}" -X POST \
  -H 'Content-Type: application/vnd.ms-sync.wbxml' \
  --data-binary @"${tmpdir}/contacts-sync.wbxml" \
  -o "${tmpdir}/contacts-sync.out" \
  "${eas_base}&Cmd=Sync"

node - "${tmpdir}/contacts-sync.out" "${contact_email}" "${contact_name}" <<'NODE'
const fs = require('fs');
const { WbxmlParser } = require('./webmail-backend/src/wbxml/parser.js');
const ast = new WbxmlParser(fs.readFileSync(process.argv[2])).parse();
const expectedEmail = process.argv[3];
const expectedName = process.argv[4];
const values = [];
function walk(node) {
  if (!node) return;
  if (node.content) values.push({ tag: node.tag, content: node.content.toString() });
  for (const child of node.children || []) walk(child);
}
walk(ast);
if (!values.some(value => value.tag === 'Status' && value.content === '1')) {
  throw new Error('Contacts Sync did not return Status 1');
}
if (!values.some(value => value.tag === 'SyncKey' && value.content.startsWith('contacts-'))) {
  throw new Error('Contacts Sync did not return a contacts SyncKey');
}
if (!values.some(value => value.tag === 'Email1Address' && value.content === expectedEmail)) {
  throw new Error(`Contacts Sync did not return ${expectedEmail}`);
}
if (!values.some(value => value.tag === 'FileAs' && value.content === expectedName)) {
  throw new Error(`Contacts Sync did not return ${expectedName}`);
}
NODE

curl -sS -u "${SMOKE_USER}:${SMOKE_PASSWORD}" -X DELETE \
  -o /dev/null \
  -w '%{http_code}' \
  "${contact_url}" | grep -Eq '^(204|404)$'

echo "PASS: ActiveSync contacts smoke completed"
