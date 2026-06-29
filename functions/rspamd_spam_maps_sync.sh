#!/usr/bin/env bash
set -euo pipefail

DB_NAME="${POSTFIXADMIN_DB_NAME:-postfixadmin}"
MAP_DIR="${RSPAMD_OMS_MAP_DIR:-/etc/rspamd/local.d/maps/openmailstack}"
MULTIMAP_CONF="${RSPAMD_OMS_MULTIMAP_CONF:-/etc/rspamd/local.d/multimap.conf}"
RELOAD_RSPAMD=0

if [[ "${1:-}" == "--reload" ]]; then
    RELOAD_RSPAMD=1
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

mysql --batch --raw --skip-column-names "${DB_NAME}" <<'SQL' > "${TMP_DIR}/rules.tsv"
SELECT 'global', 'GLOBAL', rules_json FROM global_spam_rules WHERE id = 1
UNION ALL
SELECT 'domain', domain, rules_json FROM domain_spam_rules
UNION ALL
SELECT 'user', username, rules_json FROM user_spam_rules;
SQL

cat > "${TMP_DIR}/render_maps.php" <<'PHP'
<?php
[$script, $rulesFile, $outputDir, $mapDir] = $argv;

function ensure_dir(string $path): void {
    if (!is_dir($path) && !mkdir($path, 0755, true)) {
        fwrite(STDERR, "Failed to create $path\n");
        exit(1);
    }
}

function clean_list(mixed $values): array {
    if (!is_array($values)) {
        return [];
    }

    $out = [];
    foreach ($values as $value) {
        if (!is_scalar($value)) {
            continue;
        }
        $value = strtolower(trim((string) $value));
        if ($value === '' || strpbrk($value, " \t\r\n#") !== false) {
            continue;
        }
        $out[$value] = true;
    }
    return array_keys($out);
}

function split_senders(array $values): array {
    $addresses = [];
    $domains = [];

    foreach ($values as $value) {
        $value = preg_replace('/^\*@/', '', $value);
        $value = ltrim((string) $value, '@');
        if ($value === '') {
            continue;
        }

        if (str_contains($value, '@')) {
            if (filter_var($value, FILTER_VALIDATE_EMAIL)) {
                $addresses[$value] = true;
            }
            continue;
        }

        if (preg_match('/^[a-z0-9.-]+\.[a-z]{2,}$/', $value)) {
            $domains[$value] = true;
        }
    }

    return [array_keys($addresses), array_keys($domains)];
}

function clean_ips(array $values): array {
    $out = [];
    foreach ($values as $value) {
        if (filter_var($value, FILTER_VALIDATE_IP)) {
            $out[$value] = true;
            continue;
        }
        if (preg_match('/^([0-9a-f:.]+)\/([0-9]{1,3})$/i', $value, $match) && filter_var($match[1], FILTER_VALIDATE_IP)) {
            $cidr = (int) $match[2];
            if ($cidr >= 0 && $cidr <= 128) {
                $out[$value] = true;
            }
        }
    }
    return array_keys($out);
}

function clean_extensions(array $values): array {
    $out = [];
    foreach ($values as $value) {
        $value = ltrim($value, '.');
        if (preg_match('/^[a-z0-9][a-z0-9_+-]{0,30}$/', $value)) {
            $out[$value] = true;
        }
    }
    return array_keys($out);
}

function map_path(string $mapDir, string $relative): string {
    return rtrim($mapDir, '/') . '/' . $relative;
}

function write_map(string $outputDir, string $relative, array $values): void {
    $path = rtrim($outputDir, '/') . '/maps/' . $relative;
    ensure_dir(dirname($path));
    sort($values, SORT_STRING);
    file_put_contents($path, implode("\n", $values) . (count($values) > 0 ? "\n" : ""));
}

function symbol_id(string $prefix, string $key): string {
    $safe = strtoupper(preg_replace('/[^a-z0-9]+/i', '_', $key));
    $safe = trim($safe, '_');
    $safe = substr($safe !== '' ? $safe : 'ENTRY', 0, 32);
    return $prefix . '_' . $safe . '_' . strtoupper(hash('crc32b', $key));
}

function add_sender_rules(array &$conf, string $baseSymbol, string $prefix, string $relativePrefix, string $description, float $score): void {
    $addrMap = map_path('/__MAP_DIR__', "$relativePrefix/sender_addresses.map");
    $domainMap = map_path('/__MAP_DIR__', "$relativePrefix/sender_domains.map");
    $require = $prefix !== '' ? "  require_symbols = \"$prefix\";\n" : "";

    $conf[] = <<<CONF
{$baseSymbol}_SENDER_ADDR {
  type = "from";
  filter = "email:addr";
{$require}  map = "$addrMap";
  score = $score;
  description = "$description sender addresses";
}

CONF;

    $conf[] = <<<CONF
{$baseSymbol}_SENDER_DOMAIN {
  type = "from";
  filter = "email:domain";
{$require}  map = "$domainMap";
  score = $score;
  description = "$description sender domains";
}

CONF;
}

function add_policy_rules(array &$conf, string $symbol, string $relativePrefix, string $description, string $requireSymbol = ''): void {
    $require = $requireSymbol !== '' ? "  require_symbols = \"$requireSymbol\";\n" : "";
    add_sender_rules($conf, "{$symbol}_WHITELIST", $requireSymbol, "$relativePrefix/whitelist", "$description whitelist", -999.0);
    add_sender_rules($conf, "{$symbol}_BLACKLIST", $requireSymbol, "$relativePrefix/blacklist", "$description blacklist", 999.0);

    $ipMap = map_path('/__MAP_DIR__', "$relativePrefix/banned_ips.map");
    $extMap = map_path('/__MAP_DIR__', "$relativePrefix/banned_extensions.map");

    $conf[] = <<<CONF
{$symbol}_BANNED_IP {
  type = "ip";
{$require}  map = "$ipMap";
  score = 999.0;
  description = "$description banned IPs";
}

CONF;

    $conf[] = <<<CONF
{$symbol}_BANNED_EXTENSION {
  type = "filename";
  filter = "extension";
{$require}  map = "$extMap";
  score = 999.0;
  description = "$description banned attachment extensions";
}

CONF;
}

function write_policy_maps(string $outputDir, string $relativePrefix, array $rules): void {
    [$wlAddr, $wlDomains] = split_senders(clean_list($rules['whitelisted_senders'] ?? []));
    [$blAddr, $blDomains] = split_senders(clean_list($rules['blacklisted_senders'] ?? []));

    write_map($outputDir, "$relativePrefix/whitelist/sender_addresses.map", $wlAddr);
    write_map($outputDir, "$relativePrefix/whitelist/sender_domains.map", $wlDomains);
    write_map($outputDir, "$relativePrefix/blacklist/sender_addresses.map", $blAddr);
    write_map($outputDir, "$relativePrefix/blacklist/sender_domains.map", $blDomains);
    write_map($outputDir, "$relativePrefix/banned_ips.map", clean_ips(clean_list($rules['banned_ips'] ?? [])));
    write_map($outputDir, "$relativePrefix/banned_extensions.map", clean_extensions(clean_list($rules['banned_extensions'] ?? [])));
}

ensure_dir($outputDir . '/maps');

$conf = [];
$conf[] = "# Managed by openmailstack-spam-map-sync. Do not edit by hand.\n\n";
$rows = file($rulesFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];

foreach ($rows as $row) {
    $parts = explode("\t", $row, 3);
    if (count($parts) !== 3) {
        continue;
    }

    [$scope, $key, $json] = $parts;
    $rules = json_decode($json, true);
    if (!is_array($rules)) {
        $rules = [];
    }

    if ($scope === 'global') {
        write_policy_maps($outputDir, 'global', $rules);
        add_policy_rules($conf, 'OMS_GLOBAL', 'global', 'OpenMailStack global');
        continue;
    }

    if ($scope === 'domain') {
        $domain = strtolower(trim($key));
        if (!preg_match('/^[a-z0-9.-]+\.[a-z]{2,}$/', $domain)) {
            continue;
        }
        $symbol = symbol_id('OMS_DOMAIN', $domain);
        $relative = 'domains/' . $domain;
        write_map($outputDir, "$relative/rcpt_domains.map", [$domain]);
        write_policy_maps($outputDir, $relative, $rules);
        $rcptMap = map_path('/__MAP_DIR__', "$relative/rcpt_domains.map");
        $conf[] = <<<CONF
{$symbol}_RCPT {
  type = "rcpt";
  filter = "email:domain";
  map = "$rcptMap";
  score = 0.0;
  description = "OpenMailStack domain policy selector for $domain";
}

CONF;
        add_policy_rules($conf, $symbol, $relative, "OpenMailStack domain $domain", "{$symbol}_RCPT");
        continue;
    }

    if ($scope === 'user') {
        $username = strtolower(trim($key));
        if (!filter_var($username, FILTER_VALIDATE_EMAIL)) {
            continue;
        }
        $symbol = symbol_id('OMS_USER', $username);
        $relative = 'users/' . str_replace('@', '_at_', $username);
        write_map($outputDir, "$relative/rcpt_addresses.map", [$username]);
        write_policy_maps($outputDir, $relative, $rules);
        $rcptMap = map_path('/__MAP_DIR__', "$relative/rcpt_addresses.map");
        $conf[] = <<<CONF
{$symbol}_RCPT {
  type = "rcpt";
  filter = "email:addr";
  map = "$rcptMap";
  score = 0.0;
  description = "OpenMailStack user policy selector for $username";
}

CONF;
        add_policy_rules($conf, $symbol, $relative, "OpenMailStack user $username", "{$symbol}_RCPT");
    }
}

$confText = str_replace('/__MAP_DIR__', rtrim($mapDir, '/'), implode('', $conf));
file_put_contents($outputDir . '/multimap.conf', $confText);
PHP

php "${TMP_DIR}/render_maps.php" "${TMP_DIR}/rules.tsv" "${TMP_DIR}/generated" "${MAP_DIR}"

install -d -m 0755 "${MAP_DIR}"
cp -a "${TMP_DIR}/generated/maps/." "${MAP_DIR}/"

CONFIG_CHANGED=0
if [[ ! -f "${MULTIMAP_CONF}" ]] || ! cmp -s "${TMP_DIR}/generated/multimap.conf" "${MULTIMAP_CONF}"; then
    CONFIG_CHANGED=1
    if [[ -f "${MULTIMAP_CONF}" ]]; then
        cp -a "${MULTIMAP_CONF}" "${TMP_DIR}/multimap.conf.previous"
    fi
    install -m 0644 "${TMP_DIR}/generated/multimap.conf" "${MULTIMAP_CONF}"
fi

if [[ "${RELOAD_RSPAMD}" -eq 1 && "${CONFIG_CHANGED}" -eq 1 ]]; then
    if ! rspamadm configtest >/dev/null; then
        if [[ -f "${TMP_DIR}/multimap.conf.previous" ]]; then
            install -m 0644 "${TMP_DIR}/multimap.conf.previous" "${MULTIMAP_CONF}"
        fi
        exit 1
    fi
    if systemctl is-active --quiet rspamd.service; then
        systemctl reload-or-restart rspamd.service
    fi
fi
