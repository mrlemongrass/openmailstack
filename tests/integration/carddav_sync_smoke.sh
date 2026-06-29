#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${OMS_SMOKE_BASE_URL:-https://mail.housevo.us}
SMOKE_USER=${OMS_SMOKE_USER:-}
SMOKE_PASSWORD=${OMS_SMOKE_PASSWORD:-}

if [[ -z "${SMOKE_USER}" || -z "${SMOKE_PASSWORD}" ]]; then
  echo "SKIP: set OMS_SMOKE_USER and OMS_SMOKE_PASSWORD to run authenticated CardDAV sync smoke checks"
  exit 0
fi

tmpdir=$(mktemp -d)
cleanup() {
  rm -rf "${tmpdir}"
}
trap cleanup EXIT

timestamp=$(date +%s)
contact_uid="oms-smoke-contact-${timestamp}"
contact_name="OMS Smoke Contact ${timestamp}"
contact_email="oms-smoke-${timestamp}@example.invalid"
addressbook_url="${BASE_URL}/carddav/addressbooks/${SMOKE_USER}/personal/"
contact_url="${addressbook_url}${contact_uid}.vcf"

vcard_file="${tmpdir}/${contact_uid}.vcf"
cat > "${vcard_file}" <<VCF
BEGIN:VCARD
VERSION:3.0
UID:${contact_uid}
FN:${contact_name}
N:Contact;Smoke;;;
EMAIL;TYPE=INTERNET:${contact_email}
TEL;TYPE=CELL:+15555550123
END:VCARD
VCF

status=$(curl -sS -u "${SMOKE_USER}:${SMOKE_PASSWORD}" -X PUT \
  -H 'Content-Type: text/vcard; charset=utf-8' \
  --data-binary @"${vcard_file}" \
  -o "${tmpdir}/put.out" \
  -w '%{http_code}' \
  "${contact_url}")
if [[ "${status}" != "201" && "${status}" != "204" ]]; then
  echo "FAIL: contact PUT returned HTTP ${status}"
  cat "${tmpdir}/put.out"
  exit 1
fi

status=$(curl -sS -u "${SMOKE_USER}:${SMOKE_PASSWORD}" -X PROPFIND \
  -H 'Depth: 0' \
  -H 'Content-Type: application/xml; charset=utf-8' \
  -o "${tmpdir}/propfind-root.out" \
  -w '%{http_code}' \
  "${BASE_URL}/carddav/")
if [[ "${status}" != "207" ]] || ! grep -q 'current-user-principal' "${tmpdir}/propfind-root.out"; then
  echo "FAIL: CardDAV root PROPFIND did not return principal discovery"
  cat "${tmpdir}/propfind-root.out"
  exit 1
fi

report_body="${tmpdir}/addressbook-query.xml"
cat > "${report_body}" <<XML
<?xml version="1.0" encoding="utf-8" ?>
<C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
</C:addressbook-query>
XML

status=$(curl -sS -u "${SMOKE_USER}:${SMOKE_PASSWORD}" -X REPORT \
  -H 'Depth: 1' \
  -H 'Content-Type: application/xml; charset=utf-8' \
  --data-binary @"${report_body}" \
  -o "${tmpdir}/report.out" \
  -w '%{http_code}' \
  "${addressbook_url}")
if [[ "${status}" != "207" ]] || ! grep -q "${contact_email}" "${tmpdir}/report.out"; then
  echo "FAIL: CardDAV REPORT did not return the smoke contact"
  cat "${tmpdir}/report.out"
  exit 1
fi

status=$(curl -sS -u "${SMOKE_USER}:${SMOKE_PASSWORD}" \
  -o "${tmpdir}/get.out" \
  -w '%{http_code}' \
  "${contact_url}")
if [[ "${status}" != "200" ]] || ! grep -q "${contact_name}" "${tmpdir}/get.out"; then
  echo "FAIL: CardDAV GET did not return the smoke contact"
  cat "${tmpdir}/get.out"
  exit 1
fi

status=$(curl -sS -u "${SMOKE_USER}:${SMOKE_PASSWORD}" -X DELETE \
  -o "${tmpdir}/delete.out" \
  -w '%{http_code}' \
  "${contact_url}")
if [[ "${status}" != "204" && "${status}" != "404" ]]; then
  echo "FAIL: CardDAV DELETE returned HTTP ${status}"
  cat "${tmpdir}/delete.out"
  exit 1
fi

echo "PASS: CardDAV sync smoke completed"
