#!/usr/bin/env python3
"""Inspect sanitized macOS CardDAV account capability metadata.

This diagnostic opens the macOS Accounts database in read-only mode. It reads
only selected CardDAV account-property archives for HouseVo and iCloud, then
prints metadata key paths plus Boolean/numeric values. String and binary values
are always replaced with their lengths.
"""

from __future__ import annotations

import argparse
import plistlib
import re
import sqlite3
import sys
from pathlib import Path
from typing import Any


CAPABILITY_PROPERTIES = (
    "HomeInfo",
    "PrincipalInfo",
    "principalInfo",
    "AccountConfigCompleted",
    "isChildDelegate",
    "searchable",
)


def default_accounts_database() -> Path | None:
    accounts_dir = Path.home() / "Library" / "Accounts"
    candidates = list(accounts_dir.glob("Accounts*.sqlite"))
    return max(candidates, key=lambda path: path.stat().st_mtime) if candidates else None


def load_capability_rows(database_path: Path) -> list[tuple[int, str, str, bytes]]:
    connection = sqlite3.connect(f"{database_path.resolve().as_uri()}?mode=ro", uri=True)
    try:
        connection.execute("PRAGMA query_only=ON")
        placeholders = ", ".join("?" for _ in CAPABILITY_PROPERTIES)
        return connection.execute(
            f"""
            SELECT
                account.Z_PK,
                account.ZACCOUNTDESCRIPTION,
                property.ZKEY,
                property.ZVALUE
            FROM ZACCOUNT AS account
            JOIN ZACCOUNTTYPE AS account_type
                ON account_type.Z_PK = account.ZACCOUNTTYPE
            JOIN ZACCOUNTPROPERTY AS property
                ON property.ZOWNER = account.Z_PK
            WHERE lower(account_type.ZIDENTIFIER) LIKE '%carddav%'
              AND (
                lower(account.ZACCOUNTDESCRIPTION) LIKE '%housevo%'
                OR lower(account.ZACCOUNTDESCRIPTION) = 'icloud'
              )
              AND property.ZKEY IN ({placeholders})
            ORDER BY
                account.ZACCOUNTDESCRIPTION,
                account.Z_PK,
                property.ZKEY
            """,
            CAPABILITY_PROPERTIES,
        ).fetchall()
    finally:
        connection.close()


def decode_keyed_archive(blob: bytes) -> Any:
    archive = plistlib.loads(blob)
    objects = archive.get("$objects")
    if not isinstance(objects, list):
        return archive

    def resolve(value: Any, trail: frozenset[int] = frozenset()) -> Any:
        if isinstance(value, plistlib.UID):
            index = value.data
            if index in trail:
                return f"<reference:{index}>"
            if not 0 <= index < len(objects):
                return f"<invalid-reference:{index}>"
            return resolve(objects[index], trail | {index})

        if isinstance(value, dict):
            if "NS.keys" in value and "NS.objects" in value:
                keys = [resolve(item, trail) for item in value["NS.keys"]]
                values = [resolve(item, trail) for item in value["NS.objects"]]
                return {str(key): item for key, item in zip(keys, values)}
            if "NS.objects" in value and len(value) <= 2:
                return [resolve(item, trail) for item in value["NS.objects"]]
            if "NS.string" in value:
                return resolve(value["NS.string"], trail)
            if "NS.data" in value:
                data = resolve(value["NS.data"], trail)
                size = len(data) if isinstance(data, bytes) else "?"
                return f"<data:{size} bytes>"
            return {
                str(key): resolve(item, trail)
                for key, item in value.items()
                if key != "$class"
            }

        if isinstance(value, list):
            return [resolve(item, trail) for item in value]
        return value

    top = archive.get("$top", {})
    root = top.get("root")
    if root is None and top:
        root = next(iter(top.values()))
    return resolve(root)


def sanitized_key(value: Any) -> str:
    text = str(value)
    if len(text) <= 80 and re.fullmatch(r"[A-Za-z0-9_.:{}-]+", text):
        return text
    return f"<redacted-key:{len(text)} chars>"


def emit_sanitized(value: Any, path: str = "root", depth: int = 0) -> None:
    if depth > 12:
        print(f"{path}=<depth-limit>")
        return

    if isinstance(value, dict):
        if not value:
            print(f"{path}=<empty-dictionary>")
        for key in sorted(value, key=str):
            child_path = f"{path}.{sanitized_key(key)}"
            print(f"{child_path}=<key>")
            emit_sanitized(value[key], child_path, depth + 1)
        return

    if isinstance(value, list):
        print(f"{path}=<array:{len(value)}>")
        for index, item in enumerate(value):
            emit_sanitized(item, f"{path}[{index}]", depth + 1)
        return

    if isinstance(value, bool):
        print(f"{path}={str(value).lower()}")
    elif isinstance(value, (int, float)):
        print(f"{path}={value}")
    elif value is None:
        print(f"{path}=null")
    elif isinstance(value, bytes):
        print(f"{path}=<data:{len(value)} bytes>")
    else:
        text = str(value)
        if text.startswith(("<reference:", "<invalid-reference:")):
            print(f"{path}={text}")
        else:
            print(f"{path}=<string:{len(text)} chars>")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "database",
        nargs="?",
        type=Path,
        help="Accounts*.sqlite path (defaults to the newest database)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    database_path = args.database or default_accounts_database()
    if database_path is None or not database_path.is_file():
        print("ERROR: no macOS Accounts*.sqlite database found", file=sys.stderr)
        return 2

    try:
        rows = load_capability_rows(database_path)
    except sqlite3.Error as error:
        print(f"ERROR: read-only Accounts query failed: {error}", file=sys.stderr)
        return 2

    if not rows:
        print("ERROR: no matching HouseVo/iCloud CardDAV properties found", file=sys.stderr)
        return 2

    for account_pk, description, property_key, blob in rows:
        print(
            f"=== account={description!r} pk={account_pk} "
            f"property={property_key!r} ==="
        )
        try:
            emit_sanitized(decode_keyed_archive(blob))
        except Exception as error:
            print(f"DECODE_ERROR={type(error).__name__}: {error}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
