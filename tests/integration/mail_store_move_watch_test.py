#!/usr/bin/env python3
"""Exercise the raw inotify contract used by managed mail-store backups."""

import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
WATCHER = PROJECT_ROOT / "functions" / "mail_store_move_watch.py"
TIMEOUT_SECONDS = 15
SENTINEL_PREFIX = ".oms-backup-watch-"


def fail(message):
    raise AssertionError(message)


def wait_for_line(path, expected, process, timeout=TIMEOUT_SECONDS):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.exists() and expected in path.read_bytes().splitlines():
            return
        status = process.poll()
        if status is not None:
            stderr = path.read_text(errors="replace") if path.exists() else ""
            fail(
                "watcher exited with status {} before {!r}; stderr={!r}".format(
                    status, expected, stderr
                )
            )
        time.sleep(0.02)
    stderr = path.read_text(errors="replace") if path.exists() else ""
    fail("timed out waiting for {!r}; stderr={!r}".format(expected, stderr))


def read_events(path):
    fields = path.read_bytes().split(b"\0")
    if fields[-1] != b"":
        fail("event stream was not NUL terminated")
    fields.pop()
    if len(fields) % 2:
        fail("event stream ended with a partial record")
    return list(zip(fields[::2], fields[1::2]))


def process_start_time(process_id):
    stat_payload = Path("/proc/{}/stat".format(process_id)).read_bytes()
    separator = stat_payload.rfind(b") ")
    if separator < 0:
        fail("process identity record is malformed")
    stat_fields = stat_payload[separator + 2 :].split()
    if len(stat_fields) < 20:
        fail("process identity record is incomplete")
    return int(stat_fields[19])


def watcher_ready_line(process):
    return "Watches established: {}:{}".format(
        process.pid, process_start_time(process.pid)
    ).encode("ascii")


def load_watcher_globals():
    watcher_globals = {
        "__file__": str(WATCHER),
        "__name__": "mail_store_move_watch_under_test",
    }
    exec(
        compile(WATCHER.read_bytes(), str(WATCHER), "exec"),
        watcher_globals,
    )
    return watcher_globals


def start_watcher(root, control_dir, sentinel, event_path, error_path):
    event_handle = event_path.open("wb")
    error_handle = error_path.open("wb")
    process = subprocess.Popen(
        [
            sys.executable,
            str(WATCHER),
            "--root",
            str(root),
            "--control-dir",
            str(control_dir),
            "--sentinel",
            sentinel,
        ],
        stdout=event_handle,
        stderr=error_handle,
    )
    event_handle.close()
    error_handle.close()
    try:
        wait_for_line(error_path, watcher_ready_line(process), process)
    except BaseException:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        raise
    return process


def drain_and_stop(process, control_dir, sentinel, token, error_path):
    sentinel_path = control_dir / sentinel
    file_descriptor = os.open(
        sentinel_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600
    )
    try:
        os.write(file_descriptor, token.encode("ascii") + b"\n")
    finally:
        os.close(file_descriptor)
    wait_for_line(
        error_path,
        ("Drain complete: " + token).encode("ascii"),
        process,
    )
    sentinel_path.unlink()
    process.terminate()
    try:
        status = process.wait(timeout=TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait()
        fail("watcher did not stop after the drain barrier")
    if status != 0:
        fail("watcher exited with status {} after draining".format(status))


def test_directory_moves_are_drained():
    with tempfile.TemporaryDirectory(prefix="oms-move-watch-drain-") as tmp:
        test_root = Path(tmp)
        root = test_root / "mail"
        root.mkdir()
        (root / "alpha").mkdir()
        control_dir = test_root / "control"
        control_dir.mkdir(mode=0o700)
        event_path = test_root / "events"
        error_path = test_root / "stderr"
        token = "d" * 32
        sentinel = SENTINEL_PREFIX + ("1" * 32)
        process = start_watcher(
            root, control_dir, sentinel, event_path, error_path
        )
        try:
            for _ in range(1000):
                os.rename(root / "alpha", root / "beta")
                os.rename(root / "beta", root / "alpha")
            os.rename(root / "alpha", root / "final-directory")
            drain_and_stop(process, control_dir, sentinel, token, error_path)
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()

        events = read_events(event_path)
        final_path = os.fsencode(str(root / "final-directory"))
        if (final_path, b"MOVED_TO,ISDIR") not in events:
            fail("drain acknowledgment preceded the final directory move record")
        if any(names == b"Q_OVERFLOW" for _, names in events):
            fail("ordinary drain test unexpectedly overflowed the event queue")


def test_kernel_queue_overflow_is_reported():
    with tempfile.TemporaryDirectory(prefix="oms-move-watch-overflow-") as tmp:
        test_root = Path(tmp)
        root = test_root / "mail"
        root.mkdir()
        (root / "alpha").mkdir()
        control_dir = test_root / "control"
        control_dir.mkdir(mode=0o700)
        event_path = test_root / "events"
        error_path = test_root / "stderr"
        sentinel = SENTINEL_PREFIX + ("2" * 32)
        process = start_watcher(
            root, control_dir, sentinel, event_path, error_path
        )
        try:
            os.kill(process.pid, signal.SIGSTOP)
            max_events = int(Path("/proc/sys/fs/inotify/max_queued_events").read_text())
            for _ in range((max_events // 2) + 2048):
                os.rename(root / "alpha", root / "beta")
                os.rename(root / "beta", root / "alpha")
            os.kill(process.pid, signal.SIGCONT)

            deadline = time.monotonic() + TIMEOUT_SECONDS
            while time.monotonic() < deadline:
                if any(
                    names == b"Q_OVERFLOW"
                    for _, names in read_events(event_path)
                ):
                    break
                if process.poll() is not None:
                    fail("watcher exited before reporting kernel queue overflow")
                time.sleep(0.02)
            else:
                fail("kernel queue overflow was not reported")
            try:
                status = process.wait(timeout=TIMEOUT_SECONDS)
            except subprocess.TimeoutExpired:
                fail("watcher remained alive after kernel queue overflow")
            if status == 0:
                fail("watcher reported success after kernel queue overflow")
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()

        events = read_events(event_path)
        if not any(names == b"Q_OVERFLOW" for _, names in events):
            fail("overflow record disappeared from the final event stream")


def test_output_failure_is_fatal():
    with tempfile.TemporaryDirectory(prefix="oms-move-watch-output-") as tmp:
        test_root = Path(tmp)
        root = test_root / "mail"
        root.mkdir()
        (root / "alpha").mkdir()
        control_dir = test_root / "control"
        control_dir.mkdir(mode=0o700)
        error_path = test_root / "stderr"
        sentinel = SENTINEL_PREFIX + ("3" * 32)
        process = None
        try:
            with open("/dev/full", "wb") as event_handle, error_path.open(
                "wb"
            ) as error_handle:
                process = subprocess.Popen(
                    [
                        sys.executable,
                        str(WATCHER),
                        "--root",
                        str(root),
                        "--control-dir",
                        str(control_dir),
                        "--sentinel",
                        sentinel,
                    ],
                    stdout=event_handle,
                    stderr=error_handle,
                )
            wait_for_line(error_path, watcher_ready_line(process), process)
            os.rename(root / "alpha", root / "beta")
            status = process.wait(timeout=TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
            fail("watcher remained alive after its event output failed")
        finally:
            if process is not None and process.poll() is None:
                process.kill()
                process.wait()
        if status == 0:
            fail("watcher reported success after its event output failed")
        if b"Error:" not in error_path.read_bytes():
            fail("watcher output failure was not reported on stderr")


def test_sentinel_write_failure_is_cleaned_up():
    with tempfile.TemporaryDirectory(prefix="oms-move-watch-sentinel-") as tmp:
        test_root = Path(tmp)
        control_dir = test_root / "control"
        control_dir.mkdir(mode=0o700)
        sentinel_path = control_dir / (SENTINEL_PREFIX + ("4" * 32))
        watcher_globals = load_watcher_globals()
        original_write_all = watcher_globals["write_all"]

        def fail_write(_file_descriptor, _payload):
            raise OSError("forced sentinel write failure")

        watcher_globals["write_all"] = fail_write
        original_stdin = sys.stdin
        try:
            with tempfile.TemporaryFile(mode="w+b") as token_stream:
                token_stream.write(("e" * 32 + "\n").encode("ascii"))
                token_stream.seek(0)
                sys.stdin = type(
                    "BinaryStdin", (), {"buffer": token_stream}
                )()
                try:
                    watcher_globals["create_sentinel"](str(sentinel_path))
                except OSError as error:
                    if str(error) != "forced sentinel write failure":
                        raise
                else:
                    fail("forced sentinel write failure unexpectedly succeeded")
        finally:
            sys.stdin = original_stdin
            watcher_globals["write_all"] = original_write_all
        if sentinel_path.exists() or sentinel_path.is_symlink():
            fail("failed sentinel creation leaked its exclusive control file")


def test_process_signal_is_identity_bound():
    process = subprocess.Popen(["sleep", "10"])
    try:
        start_time = process_start_time(process.pid)
        stale_result = subprocess.run(
            [
                sys.executable,
                str(WATCHER),
                "--signal-pid",
                str(process.pid),
                "--expected-start-time",
                str(start_time + 1),
                "--process-signal",
                "TERM",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if stale_result.returncode == 0:
            fail("process signaling accepted a stale process identity")
        if process.poll() is not None:
            fail("stale process identity signaled the unrelated live process")
        subprocess.run(
            [
                sys.executable,
                str(WATCHER),
                "--signal-pid",
                str(process.pid),
                "--expected-start-time",
                str(start_time),
                "--process-signal",
                "TERM",
            ],
            check=True,
        )
        process.wait(timeout=TIMEOUT_SECONDS)
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()


def test_pre_pidfd_signal_fallback_checks_start_time():
    class ModuleWithoutPidfd:
        def __init__(self, wrapped, unavailable):
            self.wrapped = wrapped
            self.unavailable = unavailable

        def __getattr__(self, name):
            if name in self.unavailable:
                raise AttributeError(name)
            return getattr(self.wrapped, name)

    watcher_globals = load_watcher_globals()
    watcher_globals["os"] = ModuleWithoutPidfd(os, {"pidfd_open"})
    watcher_globals["signal"] = ModuleWithoutPidfd(
        signal, {"pidfd_send_signal"}
    )
    process = subprocess.Popen(["sleep", "10"])
    try:
        start_time = process_start_time(process.pid)
        try:
            watcher_globals["signal_process"](
                process.pid, start_time + 1, "TERM"
            )
        except ProcessLookupError:
            pass
        else:
            fail("pre-pidfd fallback accepted a stale process identity")
        if process.poll() is not None:
            fail("pre-pidfd fallback signaled a stale numeric process identity")
        watcher_globals["signal_process"](process.pid, start_time, "TERM")
        process.wait(timeout=TIMEOUT_SECONDS)
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()


def main():
    if not sys.platform.startswith("linux"):
        print("SKIP: raw mail-store move watcher requires Linux")
        return 0
    test_directory_moves_are_drained()
    print("PASS: mail-store move watcher drains through a post-quiescence sentinel")
    test_kernel_queue_overflow_is_reported()
    print("PASS: mail-store move watcher exposes a real kernel queue overflow")
    test_output_failure_is_fatal()
    print("PASS: mail-store move watcher fails closed on event-output errors")
    test_sentinel_write_failure_is_cleaned_up()
    print("PASS: failed sentinel creation removes its exclusive control file")
    test_process_signal_is_identity_bound()
    print("PASS: process signaling refuses stale numeric process identities")
    test_pre_pidfd_signal_fallback_checks_start_time()
    print("PASS: pre-pidfd signaling fallback checks Linux process start time")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except AssertionError as error:
        print("FAIL: {}".format(error), file=sys.stderr)
        sys.exit(1)
