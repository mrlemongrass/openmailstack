# Clean-host recovery drill — 2026-08-16

## Decision

The real backup, verification, successful restore, and failed-restore recovery
transaction **passed** on a disposable Debian 13 guest with real systemd,
MariaDB, rsync, filesystem objects, and service transitions.

This closes the code-level clean-host restore proof for the current
`functions/backup_restore.sh` transaction. It does **not** close the broader
clean-host installation/disaster-recovery release gate: only the installer
dry-run was exercised, the fixtures were small, and no off-host retention,
full mutating install, DNS/TLS setup, mail flow, or physical-client recovery
was performed.

## Isolation and artifact

- Host: Debian 13 under Xen, kernel `6.12.90+deb13-amd64`.
- Host tools installed for the drill: `debootstrap 1.0.141`,
  `distro-info 1.13`, and `systemd-container 257.13-1~deb13u1`.
- Guest: Debian `13.6`, systemd `257.13-1~deb13u1`, MariaDB `11.8.6`, and
  rsync `3.4.1`.
- Guest root: `/var/tmp/oms-cycle11-cleanhost.2UNL8gkS` (removed after the
  drill).
- Container flags included `--boot`, `--register=no`, and
  `--private-network`. Host and guest PID, mount, UTS, and network namespace
  identifiers were all different. The guest had only loopback networking and
  could not resolve external hosts.
- `systemd-machined` stayed inactive. The host OpenMailStack, Postfix,
  Dovecot, MariaDB, and Nginx units remained active with unchanged main PIDs.
- No production secrets, configuration, databases, mail data, users, ports,
  DNS, firewall state, or services were imported into or mutated by the
  guest. The guest used generated fixtures only.
- The tested backup script SHA-256 was
  `27f6c16e137435c88f4ecdaf608d6bc97d1434e21c2c534aee09b30583d5734c`,
  identical inside the guest and in the working tree at the end of the drill.

Representative provisioning commands:

```bash
debootstrap --variant=minbase \
  --include=systemd-sysv,dbus,mariadb-server,rsync,procps,iproute2,ca-certificates \
  trixie <temp-root> https://deb.debian.org/debian

systemd-nspawn --directory=<temp-root> --machine=oms-cycle11-cleanhost \
  --boot --register=no --private-network --hostname=oms-cycle11-guest \
  --link-journal=no --settings=no --console=pipe
```

## Results

| Check | Result | Measured evidence |
|---|---|---|
| Fresh Debian bootstrap | Pass | 939.586 s while contending with a separate live-backup I/O phase; not a representative install benchmark |
| Clean boot | Pass after fixture preparation | Guest reached `running` with zero failed units |
| Installer dry-run | Pass with one minor diagnostic | 3.555 s; detected `debian-13`; package database hash and loaded-unit count were unchanged |
| Full fixture backup | Pass | 4.798 s; root-only promoted snapshot; checksum verification passed |
| Successful exact restore | Pass | 11.650 s including pre-restore safety snapshot and health validation |
| Pre-mutation failure | Pass | An inventory symlink targeting `/etc/shadow` made safety-snapshot validation fail closed; no database/file restore ran and service activity was restored |
| Post-apply failure recovery | Pass | Injected one-shot health failure returned exit `42`; verified safety recovery completed in 13.417 s |
| Cleanup | Pass | Guest shut down; no guest process, mount, runtime file, or temp-root residue remained |

The dry-run emitted the harmless stderr diagnostic
`find: '/run/php': No such file or directory` on the minimal guest. The command
still returned success and the no-mutation checks passed. This is an installer
polish defect, not a false success for a mutating install.

The first container boot exposed two fixture-provisioning requirements rather
than OpenMailStack runtime failures: a `mktemp` root starts mode `0700`, which
prevents system users from traversing `/`, and debootstrap did not initialize
MariaDB system tables. The disposable root was changed to normal root mode
`0755`, MariaDB was initialized with `mariadb-install-db`, and the subsequent
clean boot reached `running` with no failed units.

An earlier bootstrap attempt streamed the complete package log through a
bounded command-output channel and was interrupted during unpack. It left only
the partial disposable tree plus its `/proc` and `/sys` mounts. Both exact
mounts were identified and unmounted, the validated temp target was removed,
and the successful run redirected its verbose log instead. No daemon from the
partial guest started, and the final residue check covered both temp roots.

## Recovery contract exercised

The fixture used three allowlisted databases plus one deliberately unrelated
database. It also covered present and absent inventory directories, exact file
replacement/deletion, an absolute-but-inventory-bounded Nginx symlink, the
installer configuration file, active application/Postfix services, an
inactive Scheduler worker, and a live Unix socket in the Postfix spool.

The patched rsync copy omitted the quiesced spool socket via
`--no-specials --no-devices`; snapshot validation found no socket, device, or
FIFO. The real fixture `postfix.service` was then restarted and recreated its
socket. This directly covers the runtime-object condition that blocked the
first live snapshot attempt.

For successful restore, fixture state B was replaced with snapshot state A:

- all three allowlisted databases returned to their exact row count, text,
  and binary digest;
- a stray mail-store file was deleted;
- a previously absent Roundcube directory was removed;
- deleted frontend and unit fixture files were restored;
- the bounded Nginx symlink and installer config were restored exactly;
- the unrelated database remained at its newer value; and
- the active OpenMailStack/Postfix services returned active with new PIDs,
  MariaDB remained healthy, and the inactive Scheduler worker stayed inactive.

For recovery-on-failure, fixture state C was safety-snapshotted, snapshot A was
applied, and the first post-restore health check was intentionally failed. The
trap re-quiesced services, reapplied the verified C safety snapshot, restored
the exact active/inactive service set, passed the second health check, and
returned the original nonzero status. Files, database rows/binary digests,
the unrelated database, and the regenerated spool socket all matched state C.

## RPO and RTO interpretation

- Controlled failed-restore RPO was zero fixture transactions: the verified
  pre-restore snapshot captured state C and recovery returned exactly to C.
- The 11.650 s successful RTO and 13.417 s failure-recovery RTO apply only to
  a 140 KiB requested snapshot and about 580 KiB of total guest snapshots.
  They are transaction-semantics evidence, not production-capacity estimates.
- The backup format remains logical, full, checksummed, and unencrypted. It is
  not signed, incremental, or point-in-time recovery. Outside this controlled
  transaction, operational RPO is bounded by the age of the latest retained
  backup.

## Remaining release work

- Execute the complete mutating installer on a disposable host with isolated
  but functional package access, generated DNS/TLS inputs, and no production
  credentials.
- Restore a realistically sized snapshot onto a second clean host and measure
  capacity-sensitive RTO plus service readiness and mail/protocol behavior.
- Prove encrypted/off-host storage, retention, retrieval, checksum validation,
  and restore from that independently held copy.
- Remove the minimal-host `/run/php` dry-run diagnostic.
- Keep physical iOS/macOS and public protocol-client validation as separate
  release gates; this server-side drill does not substitute for them.

The three host packages listed above remain intentionally installed for future
isolated drills. `systemd-container` added its standard `machines.target`
wants-link, but no host container daemon/service activated. Guest and fixture
residue was zero.
