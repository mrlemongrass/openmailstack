#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SMOKE_SCRIPT="${PROJECT_ROOT}/tests/integration/calendar_sync_smoke.sh"

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

function_source=$(sed -n '/^write_matching_event_urls()/,/^parse_quiet_sync_key()/p' "${SMOKE_SCRIPT}" | sed '$d')
[[ -n "${function_source}" ]] || fail "could not extract CalDAV event href validator"
eval "${function_source}"
identity_source=$(sed -n '/^derive_eas_resource_name()/,/^write_matching_event_urls()/p' "${SMOKE_SCRIPT}" | sed '$d')
[[ -n "${identity_source}" ]] || fail "could not extract dependency-free ActiveSync resource derivation"
eval "${identity_source}"

fixture_sync_key="oms-pim-$(printf '0%.0s' {1..48})"
fixture_client_id="E$(printf '1%.0s' {1..40})"
fixture_server_id='5c572edde0675ae7dfbe20efa472edcb803612d84a59fe9147895aba50b4a277'
derived_resource_name=$(
    unset OMS_DB_PASSWORD
    derive_eas_resource_name \
        'oms-canary@example.test' 'OMSPG0123456789abcdef012345' 'cal-302' \
        "${fixture_sync_key}" "${fixture_client_id}" "${fixture_server_id}"
)
[[ "${derived_resource_name}" == '8dc02425-8d48-5d43-8fdd-10917c580561' ]] \
    || fail "dependency-free ActiveSync resource derivation drifted"
grep -Fq "require('./webmail-backend/src/eas-pim-identity.js')" "${SMOKE_SCRIPT}" \
    || fail "calendar smoke resource derivation imports a database-bound module"

test_root=$(mktemp -d)
trap 'rm -rf -- "${test_root}"' EXIT

export BASE_URL='https://mail.example.test'
export SMOKE_USER='oms-canary@example.test'
export cal_slug='oms-eas-calendar-fixture'
marker='OMSEASMARKER0123456789abcdef01234567'
collection_id='cal-302'
resource_name='b70af753-ab66-5261-bcd8-0cd88ee0877a'

write_report() {
    local output_file=$1
    local href=$2
    local event_marker=$3
    cat > "${output_file}" <<XML
<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>${href}</D:href>
    <D:propstat><D:prop><C:calendar-data><![CDATA[
BEGIN:VCALENDAR
BEGIN:VEVENT
UID:Efixture
CATEGORIES:${event_marker}
END:VEVENT
END:VCALENDAR
]]></C:calendar-data></D:prop></D:propstat>
  </D:response>
</D:multistatus>
XML
}

numeric_report="${test_root}/numeric.xml"
numeric_urls="${test_root}/numeric.urls"
numeric_href="/caldav/calendars/oms-canary%40example.test/302/${resource_name}.ics"
write_report "${numeric_report}" "${numeric_href}" "${marker}"
write_matching_event_urls \
    "${numeric_report}" "${marker}" "${numeric_urls}" "${collection_id}" "${resource_name}" \
    || fail "validator rejected the exact FolderSync-bound numeric CalDAV href"
grep -Fxq "${BASE_URL}${numeric_href}" "${numeric_urls}" \
    || fail "validator did not retain the exact numeric CalDAV href"

duplicate_report="${test_root}/duplicate.xml"
node - "${numeric_report}" "${duplicate_report}" <<'NODE'
const fs = require('fs');
const xml = fs.readFileSync(process.argv[2], 'utf8');
const response = xml.match(/<D:response\b[\s\S]*?<\/D:response>/i)?.[0];
if (!response) throw new Error('fixture omitted its CalDAV response');
fs.writeFileSync(process.argv[3], xml.replace('</D:multistatus>', `${response}\n</D:multistatus>`));
NODE
if write_matching_event_urls \
    "${duplicate_report}" "${marker}" "${test_root}/duplicate.urls" \
    "${collection_id}" "${resource_name}" >/dev/null 2>&1; then
    fail "validator accepted duplicate responses for the exact canary marker"
fi

slug_report="${test_root}/slug.xml"
slug_urls="${test_root}/slug.urls"
slug_href="/caldav/calendars/oms-canary%40example.test/${cal_slug}/${resource_name}.ics"
write_report "${slug_report}" "${slug_href}" "${marker}"
write_matching_event_urls \
    "${slug_report}" "${marker}" "${slug_urls}" "${collection_id}" "${resource_name}" \
    || fail "validator rejected the exact disposable slug href"
grep -Fxq "${BASE_URL}${slug_href}" "${slug_urls}" \
    || fail "validator did not retain the exact disposable slug href"

assert_rejected() {
    local label=$1
    local href=$2
    local supplied_collection_id=${3:-${collection_id}}
    local supplied_resource_name=${4:-${resource_name}}
    local report_file="${test_root}/${label}.xml"
    local output_file="${test_root}/${label}.urls"
    write_report "${report_file}" "${href}" "${marker}"
    if write_matching_event_urls \
        "${report_file}" "${marker}" "${output_file}" \
        "${supplied_collection_id}" "${supplied_resource_name}" >/dev/null 2>&1; then
        fail "validator accepted ${label}"
    fi
}

assert_rejected 'a different numeric calendar' \
    "/caldav/calendars/oms-canary%40example.test/303/${resource_name}.ics"
assert_rejected 'a different mailbox' \
    "/caldav/calendars/other%40example.test/302/${resource_name}.ics"
assert_rejected 'a different origin' \
    "https://attacker.example.test/caldav/calendars/oms-canary%40example.test/302/${resource_name}.ics"
assert_rejected 'an encoded traversal' \
    "/caldav/calendars/oms-canary%40example.test/302/%2e%2e%2f303%2f${resource_name}.ics"
assert_rejected 'a normalizing encoded dot segment' \
    "/caldav/calendars/oms-canary%40example.test/${cal_slug}/%2e%2e/302/${resource_name}.ics"
assert_rejected 'an encoded resource slash' \
    "/caldav/calendars/oms-canary%40example.test/302/${resource_name}%2Fother.ics"
assert_rejected 'a nested resource path' \
    "/caldav/calendars/oms-canary%40example.test/302/${resource_name}/other.ics"
assert_rejected 'encoded calendar digits' \
    "/caldav/calendars/oms-canary%40example.test/%33%30%32/${resource_name}.ics"
assert_rejected 'a query-bearing href' \
    "/caldav/calendars/oms-canary%40example.test/302/${resource_name}.ics?view=1"
assert_rejected 'a fragment-bearing href' \
    "/caldav/calendars/oms-canary%40example.test/302/${resource_name}.ics#fragment"
assert_rejected 'same-origin userinfo' \
    "https://attacker@mail.example.test/caldav/calendars/oms-canary%40example.test/302/${resource_name}.ics"
assert_rejected 'a backslash path alias' \
    "https://mail.example.test/caldav/calendars/oms-canary%40example.test/302\\${resource_name}.ics"
assert_rejected 'a double-encoded mailbox' \
    "/caldav/calendars/oms-canary%2540example.test/302/${resource_name}.ics"
assert_rejected 'a same-calendar resource near miss' \
    '/caldav/calendars/oms-canary%40example.test/302/aaaaaaaa-bbbb-5ccc-8ddd-eeeeeeeeeeee.ics'
assert_rejected 'an ambiguous FolderSync collection alias' \
    "${numeric_href}" 'cal-0302'
assert_rejected 'a non-EAS expected resource identity' \
    '/caldav/calendars/oms-canary%40example.test/302/not-an-eas-resource.ics' \
    "${collection_id}" 'not-an-eas-resource'

wrong_marker_report="${test_root}/wrong-marker.xml"
wrong_marker_urls="${test_root}/wrong-marker.urls"
write_report "${wrong_marker_report}" "${numeric_href}" 'OMSEASMARKERffffffffffffffffffffffff'
write_matching_event_urls \
    "${wrong_marker_report}" "${marker}" "${wrong_marker_urls}" "${collection_id}" "${resource_name}" \
    || fail "validator errored while ignoring a response without the exact canary marker"
[[ ! -s "${wrong_marker_urls}" ]] \
    || fail "validator accepted a resource without the exact canary marker"

safe_base_url=${BASE_URL}
BASE_URL='https://attacker@mail.example.test'
if write_matching_event_urls \
    "${numeric_report}" "${marker}" "${test_root}/unsafe-base.urls" \
    "${collection_id}" "${resource_name}" >/dev/null 2>&1; then
    fail "validator accepted an unsafe credential-bearing CalDAV base URL"
fi
BASE_URL=${safe_base_url}

grep -Fq \
    "write_matching_event_urls \"\${tmpdir}/after-add.xml\" \"\${eas_marker}\" \"\${tmpdir}/after-add.urls\" \"\${cal_collection_id}\" \"\${eas_resource_name}\"" \
    "${SMOKE_SCRIPT}" || fail "calendar Add does not bind REPORT authorization to its exact collection and resource"
grep -Fq \
    "write_matching_event_urls \"\${tmpdir}/after-change.xml\" \"\${eas_marker}\" \"\${tmpdir}/after-change.urls\" \"\${cal_collection_id}\" \"\${eas_resource_name}\"" \
    "${SMOKE_SCRIPT}" || fail "calendar Change does not retain exact REPORT authorization"
grep -Fq \
    "write_matching_event_urls \"\${tmpdir}/after-delete.xml\" \"\${eas_marker}\" \"\${tmpdir}/after-delete.urls\" \"\${cal_collection_id}\" \"\${eas_resource_name}\"" \
    "${SMOKE_SCRIPT}" || fail "calendar Delete verification does not retain exact REPORT authorization"

echo 'PASS: calendar smoke authorizes only its exact slug/numeric collection and canary resource'
