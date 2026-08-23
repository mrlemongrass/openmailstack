#!/usr/bin/env python3
"""Record directory moves below a Maildir tree with an explicit drain barrier."""

import argparse
import ctypes
import errno
import os
import select
import signal
import stat
import struct
import sys
import time


IN_MOVED_FROM = 0x00000040
IN_MOVED_TO = 0x00000080
IN_CREATE = 0x00000100
IN_DELETE_SELF = 0x00000400
IN_MOVE_SELF = 0x00000800
IN_UNMOUNT = 0x00002000
IN_Q_OVERFLOW = 0x00004000
IN_IGNORED = 0x00008000
IN_ONLYDIR = 0x01000000
IN_DONT_FOLLOW = 0x02000000
IN_ISDIR = 0x40000000

WATCH_MASK = (
    IN_MOVED_FROM
    | IN_MOVED_TO
    | IN_CREATE
    | IN_DELETE_SELF
    | IN_MOVE_SELF
    | IN_UNMOUNT
    | IN_ONLYDIR
    | IN_DONT_FOLLOW
)
CONTROL_WATCH_MASK = (
    IN_CREATE
    | IN_DELETE_SELF
    | IN_MOVE_SELF
    | IN_UNMOUNT
    | IN_ONLYDIR
    | IN_DONT_FOLLOW
)
EVENT_HEADER = struct.Struct("iIII")
READ_SIZE = 1024 * 1024
TOKEN_BYTES = frozenset(b"0123456789abcdef")


def write_all(file_descriptor, payload):
    view = memoryview(payload)
    while view:
        try:
            written = os.write(file_descriptor, view)
        except InterruptedError:
            continue
        if written <= 0:
            raise OSError("short write while recording inotify state")
        view = view[written:]


def stderr_line(message):
    write_all(2, message.encode("utf-8", "replace") + b"\n")


class MailStoreMoveWatch:
    def __init__(self, root, control_dir, sentinel):
        self.root = root
        self.control_dir = control_dir
        self.sentinel = sentinel
        self.stop_requested = False
        self.wd_to_path = {}
        self.path_to_wd = {}
        self.pending_moves = {}
        self.root_wd = None
        self.control_wd = None
        self.control_fd = os.open(
            control_dir,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
        )

        self.libc = ctypes.CDLL(None, use_errno=True)
        self.libc.inotify_init1.argtypes = [ctypes.c_int]
        self.libc.inotify_init1.restype = ctypes.c_int
        self.libc.inotify_add_watch.argtypes = [
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_uint32,
        ]
        self.libc.inotify_add_watch.restype = ctypes.c_int

        self.fd = self.libc.inotify_init1(os.O_NONBLOCK | os.O_CLOEXEC)
        if self.fd < 0:
            error_number = ctypes.get_errno()
            raise OSError(error_number, os.strerror(error_number))

    def close(self):
        if self.fd >= 0:
            os.close(self.fd)
            self.fd = -1
        if self.control_fd >= 0:
            os.close(self.control_fd)
            self.control_fd = -1

    def request_stop(self, _signum, _frame):
        self.stop_requested = True

    def emit(self, path, names):
        write_all(1, path + b"\0" + names + b"\0")

    def remember_watch(self, watch_descriptor, path):
        old_path = self.wd_to_path.get(watch_descriptor)
        if old_path is not None and self.path_to_wd.get(old_path) == watch_descriptor:
            del self.path_to_wd[old_path]
        displaced = self.path_to_wd.get(path)
        if displaced is not None and displaced != watch_descriptor:
            self.wd_to_path.pop(displaced, None)
        self.wd_to_path[watch_descriptor] = path
        self.path_to_wd[path] = watch_descriptor

    def forget_watch(self, watch_descriptor):
        path = self.wd_to_path.pop(watch_descriptor, None)
        if path is not None and self.path_to_wd.get(path) == watch_descriptor:
            del self.path_to_wd[path]

    def add_watch(self, path, mask=WATCH_MASK):
        try:
            path_stat = os.lstat(path)
        except (FileNotFoundError, NotADirectoryError):
            return None
        if not stat.S_ISDIR(path_stat.st_mode) or stat.S_ISLNK(path_stat.st_mode):
            return None

        watch_descriptor = self.libc.inotify_add_watch(self.fd, path, mask)
        if watch_descriptor < 0:
            error_number = ctypes.get_errno()
            if error_number in (errno.ENOENT, errno.ENOTDIR, errno.ELOOP):
                return None
            raise OSError(error_number, os.strerror(error_number), os.fsdecode(path))
        self.remember_watch(watch_descriptor, path)
        return watch_descriptor

    def add_tree(self, path):
        pending = [path]
        while pending:
            if self.stop_requested:
                return
            directory = pending.pop()
            watch_descriptor = self.add_watch(directory)
            if watch_descriptor is None:
                continue
            try:
                with os.scandir(directory) as entries:
                    for entry in entries:
                        if self.stop_requested:
                            return
                        try:
                            if entry.is_dir(follow_symlinks=False):
                                pending.append(entry.path)
                        except (FileNotFoundError, NotADirectoryError):
                            continue
            except (FileNotFoundError, NotADirectoryError):
                continue

    def rename_watches(self, old_path, new_path):
        old_prefix = old_path + os.sep.encode()
        updates = []
        for watch_descriptor, current_path in self.wd_to_path.items():
            if current_path == old_path:
                updates.append((watch_descriptor, new_path))
            elif current_path.startswith(old_prefix):
                updates.append(
                    (watch_descriptor, new_path + current_path[len(old_path) :])
                )
        for watch_descriptor, _ in updates:
            current_path = self.wd_to_path.get(watch_descriptor)
            if (
                current_path is not None
                and self.path_to_wd.get(current_path) == watch_descriptor
            ):
                del self.path_to_wd[current_path]
        for watch_descriptor, updated_path in updates:
            self.remember_watch(watch_descriptor, updated_path)

    def lose_continuity(self, names, message):
        self.emit(self.root, names)
        stderr_line("Error: " + message)
        return False

    def acknowledge_sentinel(self):
        file_descriptor = os.open(
            self.sentinel,
            os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW,
            dir_fd=self.control_fd,
        )
        try:
            sentinel_stat = os.fstat(file_descriptor)
            if not stat.S_ISREG(sentinel_stat.st_mode) or sentinel_stat.st_uid != 0:
                raise OSError("drain sentinel is not a root-owned regular file")
            deadline = time.monotonic() + 2
            while True:
                if self.stop_requested:
                    raise OSError("drain sentinel acknowledgment was interrupted")
                os.lseek(file_descriptor, 0, os.SEEK_SET)
                payload = os.read(file_descriptor, 64)
                token_prefix = payload[: min(len(payload), 32)]
                if any(byte not in TOKEN_BYTES for byte in token_prefix):
                    raise OSError("drain sentinel token is malformed")
                if len(payload) == 33 and payload[32:] == b"\n":
                    token = payload[:32]
                    break
                if len(payload) > 32 or time.monotonic() >= deadline:
                    raise OSError("drain sentinel token is incomplete")
                time.sleep(0.01)
            sentinel_stat = os.fstat(file_descriptor)
            if sentinel_stat.st_nlink < 1:
                raise OSError("drain sentinel was removed before acknowledgment")
        finally:
            os.close(file_descriptor)
        stderr_line("Drain complete: " + token.decode("ascii"))

    def process_event(self, watch_descriptor, mask, cookie, name):
        if mask & IN_Q_OVERFLOW:
            self.emit(self.root, b"Q_OVERFLOW")
            stderr_line("Error: inotify event queue overflowed")
            return False

        parent_path = self.wd_to_path.get(watch_descriptor)
        if parent_path is None:
            if mask & IN_IGNORED:
                return True
            return self.lose_continuity(
                b"WATCH_LOST", "received an event for an unknown watch"
            )

        if watch_descriptor == self.control_wd:
            if mask & IN_UNMOUNT:
                return self.lose_continuity(
                    b"UNMOUNT", "mail-store watch control directory was unmounted"
                )
            if mask & (IN_DELETE_SELF | IN_MOVE_SELF):
                return self.lose_continuity(
                    b"WATCH_LOST", "mail-store watch control directory moved or was deleted"
                )
            if mask & IN_IGNORED:
                self.forget_watch(watch_descriptor)
                return self.lose_continuity(
                    b"WATCH_LOST", "mail-store watch control watch was removed"
                )
            if mask & IN_CREATE and not (mask & IN_ISDIR) and name == self.sentinel:
                self.acknowledge_sentinel()
            return True

        if mask & IN_UNMOUNT:
            return self.lose_continuity(b"UNMOUNT", "mail store was unmounted")
        if watch_descriptor == self.root_wd and mask & (IN_DELETE_SELF | IN_MOVE_SELF):
            return self.lose_continuity(
                b"WATCH_LOST", "mail-store root moved or was deleted"
            )
        if mask & IN_IGNORED:
            root_was_ignored = watch_descriptor == self.root_wd
            self.forget_watch(watch_descriptor)
            if root_was_ignored:
                return self.lose_continuity(
                    b"WATCH_LOST", "mail-store root watch was removed"
                )
            return True

        event_path = parent_path if not name else os.path.join(parent_path, name)
        is_directory = bool(mask & IN_ISDIR)

        if not is_directory:
            return True

        if mask & IN_MOVED_FROM:
            self.emit(event_path, b"MOVED_FROM,ISDIR")
            if cookie:
                self.pending_moves[cookie] = event_path

        if mask & IN_MOVED_TO:
            self.emit(event_path, b"MOVED_TO,ISDIR")
            old_path = self.pending_moves.pop(cookie, None) if cookie else None
            if old_path is not None:
                self.rename_watches(old_path, event_path)
            self.add_tree(event_path)

        if mask & IN_CREATE:
            self.add_tree(event_path)
        return True

    def process_buffer(self, payload):
        offset = 0
        payload_length = len(payload)
        while offset < payload_length:
            if payload_length - offset < EVENT_HEADER.size:
                raise OSError("partial inotify event header")
            watch_descriptor, mask, cookie, name_length = EVENT_HEADER.unpack_from(
                payload, offset
            )
            event_length = EVENT_HEADER.size + name_length
            if event_length > payload_length - offset:
                raise OSError("partial inotify event body")
            raw_name = payload[
                offset + EVENT_HEADER.size : offset + event_length
            ]
            name = raw_name.split(b"\0", 1)[0]
            if not self.process_event(watch_descriptor, mask, cookie, name):
                return False
            offset += event_length
        return True

    def run(self):
        self.root_wd = self.add_watch(self.root)
        if self.root_wd is None:
            raise OSError("mail-store root disappeared before it could be watched")
        self.add_tree(self.root)
        # A single inotify queue orders the protected barrier after source events.
        self.control_wd = self.add_watch(self.control_dir, CONTROL_WATCH_MASK)
        if self.control_wd is None:
            raise OSError(
                "mail-store watch control directory disappeared before it could be watched"
            )
        process_state, process_start_time = read_process_identity(os.getpid())
        if process_state in (b"Z", b"X", b"x"):
            raise OSError("mail-store watcher became inactive before readiness")
        stderr_line(
            "Watches established: {}:{}".format(os.getpid(), process_start_time)
        )

        poller = select.poll()
        poller.register(self.fd, select.POLLIN | select.POLLERR | select.POLLHUP)
        while not self.stop_requested:
            for _file_descriptor, ready_mask in poller.poll(1000):
                if ready_mask & (select.POLLERR | select.POLLHUP):
                    return self.lose_continuity(
                        b"WATCH_LOST", "inotify descriptor became unavailable"
                    )
                while True:
                    try:
                        payload = os.read(self.fd, READ_SIZE)
                    except BlockingIOError:
                        break
                    except InterruptedError:
                        continue
                    if not payload:
                        return self.lose_continuity(
                            b"WATCH_LOST", "inotify descriptor reached end of file"
                        )
                    if not self.process_buffer(payload):
                        return False
        return True


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--check-process-signaling", action="store_true")
    parser.add_argument("--create-sentinel")
    parser.add_argument("--signal-pid", type=int)
    parser.add_argument("--expected-start-time")
    parser.add_argument("--process-signal", choices=("TERM", "KILL"))
    parser.add_argument("--root")
    parser.add_argument("--control-dir")
    parser.add_argument("--sentinel")
    args = parser.parse_args()
    watch_values = (args.root, args.control_dir, args.sentinel)
    if args.check_process_signaling:
        if (
            args.create_sentinel is not None
            or args.signal_pid is not None
            or args.expected_start_time is not None
            or args.process_signal is not None
            or any(value is not None for value in watch_values)
        ):
            parser.error(
                "--check-process-signaling cannot be combined with another mode"
            )
        return args, None, None, None
    if args.signal_pid is not None:
        if (
            args.create_sentinel is not None
            or args.expected_start_time is None
            or args.process_signal is None
            or any(value is not None for value in watch_values)
        ):
            parser.error("process signaling requires only its complete signal arguments")
        if (
            args.signal_pid <= 0
            or not args.expected_start_time.isdecimal()
            or int(args.expected_start_time) <= 0
        ):
            parser.error("process signaling identity is invalid")
        return args, None, None, None
    if args.expected_start_time is not None or args.process_signal is not None:
        parser.error("process signal arguments require --signal-pid")
    if args.create_sentinel is not None:
        if (
            args.root is not None
            or args.control_dir is not None
            or args.sentinel is not None
        ):
            parser.error("--create-sentinel cannot be combined with watch arguments")
        return args, None, None, None
    if args.root is None or args.control_dir is None or args.sentinel is None:
        parser.error(
            "--root, --control-dir, and --sentinel are required in watch mode"
        )
    root = os.fsencode(args.root)
    control_dir = os.fsencode(args.control_dir)
    sentinel = os.fsencode(args.sentinel)

    if not os.path.isabs(root) or root == os.sep.encode():
        parser.error("--root must be a bounded absolute path")
    try:
        root_stat = os.lstat(root)
    except OSError as error:
        parser.error("--root is unavailable: {}".format(error))
    if not stat.S_ISDIR(root_stat.st_mode) or stat.S_ISLNK(root_stat.st_mode):
        parser.error("--root must be a real directory")
    try:
        control_stat = os.lstat(control_dir)
        control_parent_stat = os.lstat(os.path.dirname(control_dir))
    except OSError as error:
        parser.error("--control-dir is unavailable: {}".format(error))
    if (
        not os.path.isabs(control_dir)
        or control_dir == os.sep.encode()
        or not stat.S_ISDIR(control_stat.st_mode)
        or stat.S_ISLNK(control_stat.st_mode)
        or control_stat.st_uid != 0
        or control_stat.st_mode & 0o022
        or not stat.S_ISDIR(control_parent_stat.st_mode)
        or stat.S_ISLNK(control_parent_stat.st_mode)
        or control_parent_stat.st_uid != 0
        or control_parent_stat.st_mode & 0o022
    ):
        parser.error("--control-dir must have a protected root-owned parent")
    if os.path.commonpath((root, control_dir)) == root:
        parser.error("--control-dir must be outside the mail-store root")
    if (
        len(sentinel) != len(b".oms-backup-watch-") + 32
        or not sentinel.startswith(b".oms-backup-watch-")
        or any(byte not in TOKEN_BYTES for byte in sentinel[-32:])
    ):
        parser.error("--sentinel must be a safe OpenMailStack watcher basename")
    return args, root, control_dir, sentinel


def read_process_identity(process_id):
    with open("/proc/{}/stat".format(process_id), "rb") as stat_file:
        stat_payload = stat_file.read()
    separator = stat_payload.rfind(b") ")
    if separator < 0:
        raise OSError("process identity record is malformed")
    stat_fields = stat_payload[separator + 2 :].split()
    if len(stat_fields) < 20 or not stat_fields[19].isdigit():
        raise OSError("process identity record is incomplete")
    return stat_fields[0], int(stat_fields[19])


def check_process_signaling_support():
    read_process_identity(os.getpid())


def signal_process(process_id, expected_start_time, signal_name):
    process_fd = None
    if hasattr(os, "pidfd_open") and hasattr(signal, "pidfd_send_signal"):
        try:
            process_fd = os.pidfd_open(process_id, 0)
        except OSError as error:
            if error.errno != errno.ENOSYS:
                raise
    if process_fd is not None:
        try:
            process_state, process_start_time = read_process_identity(process_id)
            if process_start_time != expected_start_time or process_state in (
                b"Z",
                b"X",
                b"x",
            ):
                raise ProcessLookupError("process identity changed before signaling")
            signal.pidfd_send_signal(
                process_fd, getattr(signal, "SIG" + signal_name), None, 0
            )
        finally:
            os.close(process_fd)
    else:
        # Linux before pidfds: re-check the captured start time immediately
        # before signaling so an already-reused numeric PID is never accepted.
        process_state, process_start_time = read_process_identity(process_id)
        if process_start_time != expected_start_time or process_state in (
            b"Z",
            b"X",
            b"x",
        ):
            raise ProcessLookupError("process identity changed before signaling")
        os.kill(process_id, getattr(signal, "SIG" + signal_name))


def create_sentinel(path):
    sentinel_path = os.fsencode(path)
    sentinel_name = os.path.basename(sentinel_path)
    parent_path = os.path.dirname(sentinel_path)
    if (
        not os.path.isabs(sentinel_path)
        or sentinel_path == os.sep.encode()
        or len(sentinel_name) != len(b".oms-backup-watch-") + 32
        or not sentinel_name.startswith(b".oms-backup-watch-")
        or any(byte not in TOKEN_BYTES for byte in sentinel_name[-32:])
    ):
        raise ValueError("sentinel path is not a bounded OpenMailStack watch path")
    payload = sys.stdin.buffer.read(64)
    if (
        len(payload) != 33
        or payload[32:] != b"\n"
        or any(byte not in TOKEN_BYTES for byte in payload[:32])
    ):
        raise ValueError("sentinel token is malformed")
    parent_fd = os.open(
        parent_path,
        os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
    )
    try:
        parent_stat = os.fstat(parent_fd)
        if parent_stat.st_uid != 0 or parent_stat.st_mode & 0o022:
            raise OSError("sentinel parent is not a protected root-owned directory")
        file_descriptor = os.open(
            sentinel_name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
            0o600,
            dir_fd=parent_fd,
        )
        try:
            write_all(file_descriptor, payload)
        except BaseException:
            os.close(file_descriptor)
            file_descriptor = -1
            try:
                os.unlink(sentinel_name, dir_fd=parent_fd)
            except OSError:
                pass
            raise
        finally:
            if file_descriptor >= 0:
                os.close(file_descriptor)
    finally:
        os.close(parent_fd)


def main():
    args, root, control_dir, sentinel = parse_args()
    if args.check_process_signaling:
        check_process_signaling_support()
        return 0
    if args.signal_pid is not None:
        signal_process(
            args.signal_pid,
            int(args.expected_start_time),
            args.process_signal,
        )
        return 0
    if args.create_sentinel is not None:
        create_sentinel(args.create_sentinel)
        return 0
    watcher = MailStoreMoveWatch(root, control_dir, sentinel)
    signal.signal(signal.SIGTERM, watcher.request_stop)
    signal.signal(signal.SIGINT, watcher.request_stop)
    signal.signal(signal.SIGHUP, watcher.request_stop)
    try:
        return 0 if watcher.run() else 1
    finally:
        watcher.close()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError) as error:
        stderr_line("Error: {}".format(error))
        sys.exit(1)
