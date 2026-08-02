"""W2-R5 manifest and byte-normalization helpers used by C audits."""
from __future__ import annotations

import hashlib
import json
import math
import re
import subprocess
import unicodedata
from pathlib import PurePosixPath
from typing import Any

HEX64 = re.compile(r"^[0-9a-f]{64}$")
TEXT_EXTENSIONS = {".json", ".jsonl", ".md", ".csv", ".txt", ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".yaml", ".yml"}

class AuditFailure(Exception):
    pass

def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def normalized_text(data: bytes) -> bytes:
    if data.startswith(b"\xef\xbb\xbf"):
        raise AuditFailure("UTF-8 BOM is forbidden")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise AuditFailure("text is not UTF-8") from exc
    return text.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8")

def safe_path(raw: str) -> str:
    if not isinstance(raw, str) or not raw or "\\" in raw or raw.startswith("/") or ":" in raw:
        raise AuditFailure(f"unsafe path: {raw!r}")
    if unicodedata.normalize("NFC", raw) != raw or PurePosixPath(raw).as_posix() != raw:
        raise AuditFailure(f"non-canonical path: {raw!r}")
    if any(part in {"", ".", ".."} for part in raw.split("/")):
        raise AuditFailure(f"unsafe path segment: {raw!r}")
    return raw

def load_json(data: bytes, label: str = "JSON") -> Any:
    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in items:
            if key in result:
                raise AuditFailure(f"duplicate key in {label}: {key}")
            result[key] = value
        return result
    try:
        return json.loads(data.decode("utf-8"), object_pairs_hook=pairs)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise AuditFailure(f"invalid UTF-8 JSON: {label}") from exc

def jcs(value: Any) -> str:
    if value is None: return "null"
    if value is True: return "true"
    if value is False: return "false"
    if isinstance(value, int) and not isinstance(value, bool): return str(value)
    if isinstance(value, float):
        if not math.isfinite(value): raise AuditFailure("non-finite JCS number")
        raise AuditFailure("floating point is not allowed in this manifest")
    if isinstance(value, str): return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, list): return "[" + ",".join(jcs(item) for item in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value, key=lambda key: key.encode("utf-16-be"))
        return "{" + ",".join(jcs(key) + ":" + jcs(value[key]) for key in keys) + "}"
    raise AuditFailure(f"unsupported JCS type: {type(value).__name__}")

def entry_mode(path: str) -> str:
    return "normalized-text" if __import__("pathlib").Path(path).suffix.lower() in TEXT_EXTENSIONS else "raw-binary"

def asset_tree(entries: list[dict[str, Any]]) -> str:
    chunks = bytearray()
    for item in entries:
        chunks.extend(item["path"].encode("utf-8")); chunks.extend(b"\0" + item["hashMode"].encode("ascii"))
        chunks.extend(b"\0" + item["sha256"].encode("ascii")); chunks.extend(b"\0" + str(item["byteLength"]).encode("ascii") + b"\n")
    return digest(bytes(chunks))

def node_jcs_sha256(data: bytes) -> str:
    script = r"""
const crypto = require('node:crypto'); let input = '';
process.stdin.setEncoding('utf8'); process.stdin.on('data', c => input += c);
process.stdin.on('end', () => {
  const c = v => v === null || typeof v !== 'object' ? JSON.stringify(v) :
    Array.isArray(v) ? '[' + v.map(c).join(',') + ']' :
    '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + c(v[k])).join(',') + '}';
  process.stdout.write(crypto.createHash('sha256').update(c(JSON.parse(input)), 'utf8').digest('hex'));
});
"""
    result = subprocess.run(["node", "-e", script], input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    value = result.stdout.decode("ascii", errors="replace")
    if result.returncode or not HEX64.fullmatch(value): raise AuditFailure("Node JCS canonicalization failed")
    return value
