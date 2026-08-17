#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SMOKE_SCRIPT="${PROJECT_ROOT}/tests/integration/activesync_contacts_smoke.sh"

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

grep -Fq 'OMS_PROTOCOL_GATE_CONTACT_DAV_UID' "${SMOKE_SCRIPT}" \
    || fail "contacts smoke does not publish an immutable cleanup identity"
grep -Fq 'eas_contact_url' "${SMOKE_SCRIPT}" \
    || fail "contacts smoke does not retain the exact created href"
grep -Fq "vcard_has_internet_email \"\${tmpdir}/after-add.vcf\" \"\${eas_email}\"" "${SMOKE_SCRIPT}" \
    || fail "contacts smoke Add does not use the semantic vCard email assertion"
grep -Fq "vcard_has_internet_email \"\${tmpdir}/after-change.vcf\" \"\${eas_changed_email}\"" "${SMOKE_SCRIPT}" \
    || fail "contacts smoke Change does not use the semantic vCard email assertion"

vcard_email_source=$(sed -n '/^vcard_has_internet_email()/,/^DEVICE_ID=/p' "${SMOKE_SCRIPT}" | sed '$d')
[[ -n "${vcard_email_source}" ]] || fail "could not extract semantic vCard email assertion"
eval "${vcard_email_source}"

function_source=$(sed -n '/^cleanup_marker_contacts()/,/^}/p' "${SMOKE_SCRIPT}")
[[ -n "${function_source}" ]] || fail "could not extract contact marker cleanup"
eval "${function_source}"
cleanup_source=$(sed -n '/^cleanup()/,/^}/p' "${SMOKE_SCRIPT}")
[[ -n "${cleanup_source}" ]] || fail "could not extract contact cleanup"
eval "${cleanup_source}"

test_root=$(mktemp -d)
trap 'rm -rf -- "${test_root}"' EXIT
export tmpdir=${test_root}
deleted_log="${test_root}/deleted.log"

cat > "${test_root}/slot-after-type.vcf" <<'VCARD'
BEGIN:VCARD
VERSION:3.0
FN:OMS Fixture
EMAIL;TYPE=INTERNET;X-OMS-EAS-SLOT=Email1Address:fixture@example.invalid
END:VCARD
VCARD
vcard_has_internet_email "${test_root}/slot-after-type.vcf" 'fixture@example.invalid' \
    || fail "semantic email assertion rejected ActiveSync slot metadata"

cat > "${test_root}/slot-before-type.vcf" <<'VCARD'
BEGIN:VCARD
VERSION:3.0
FN:OMS Fixture
EMAIL;X-OMS-EAS-SLOT=Email1Address;
 TYPE=HOME,INTERNET:fixture@example.invalid
END:VCARD
VCARD
vcard_has_internet_email "${test_root}/slot-before-type.vcf" 'fixture@example.invalid' \
    || fail "semantic email assertion depended on parameter order or folding"
if vcard_has_internet_email "${test_root}/slot-after-type.vcf" 'different@example.invalid'; then
    fail "semantic email assertion accepted the wrong email value"
fi

cat > "${test_root}/missing-internet-type.vcf" <<'VCARD'
BEGIN:VCARD
VERSION:3.0
FN:OMS Fixture
EMAIL;TYPE=HOME:fixture@example.invalid
END:VCARD
VCARD
if vcard_has_internet_email "${test_root}/missing-internet-type.vcf" 'fixture@example.invalid'; then
    fail "semantic email assertion accepted an EMAIL without INTERNET type"
fi

report_contacts() {
    : > "$1"
}

write_matching_contact_urls() {
    local _report_file=$1
    local _marker=$2
    local output_file=$3
    printf '%s' 'https://mail.example.test/carddav/addressbooks/fixture@example.test/personal/exact.vcf' \
        > "${output_file}"
}

delete_dav_url() {
    local url=$1
    local _output_file=$2
    printf '%s\n' "${url}" >> "${deleted_log}"
}

cleanup_marker_contacts 'marker@example.invalid' fixture
[[ $(wc -l < "${deleted_log}") -eq 1 ]] \
    || fail "unterminated single-URL cleanup did not execute exactly once"
grep -Fxq 'https://mail.example.test/carddav/addressbooks/fixture@example.test/personal/exact.vcf' "${deleted_log}" \
    || fail "contact cleanup did not preserve the exact href"

: > "${deleted_log}"
mkdir "${test_root}/work"
export tmpdir="${test_root}/work"
export eas_contact_url='https://mail.example.test/carddav/addressbooks/fixture@example.test/personal/immutable.vcf'
export seed_email='seed@example.invalid'
export eas_email='original@example.invalid'
export eas_changed_email='changed@example.invalid'
write_matching_contact_urls() {
    local _report_file=$1
    local _marker=$2
    local output_file=$3
    : > "${output_file}"
}
(cleanup)
[[ $(wc -l < "${deleted_log}") -eq 1 ]] \
    || fail "cleanup did not prefer exactly one retained href after an email change"
grep -Fxq 'https://mail.example.test/carddav/addressbooks/fixture@example.test/personal/immutable.vcf' "${deleted_log}" \
    || fail "cleanup lost the immutable href after an email change"

echo 'PASS: ActiveSync contact smoke validates semantic vCard emails and exact cleanup identity'
