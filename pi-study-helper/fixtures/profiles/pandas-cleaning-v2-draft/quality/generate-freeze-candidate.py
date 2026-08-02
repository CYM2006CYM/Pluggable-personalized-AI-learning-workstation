"""Create and verify the repository-external W2 D4 B-candidate freeze package.

The hash rules in this utility implement W2-R5 section 6.2.1.  The output
directory is deliberately required to be outside the public repository.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import zipfile
from pathlib import Path, PurePosixPath


W2_START_SHORT = "f343a6c"
A_D3_COMMIT = "1008f765e12687a0a1f7d65666a64cf13995e0a3"
MANIFEST_VERSION = "w2-freeze-manifest-v1"
TEXT_SUFFIXES = {".json", ".jsonl", ".md", ".csv", ".txt", ".py", ".js", ".cjs", ".mjs", ".ts", ".tsx", ".yaml", ".yml"}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_json(value: object) -> str:
    """RFC 8785 JCS for the manifest's finite JSON value domain."""
    if value is None or isinstance(value, bool):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if not value == value or value in (float("inf"), float("-inf")):
            raise ValueError("JCS does not permit non-finite numbers")
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(
            canonical_json(key) + ":" + canonical_json(value[key])
            for key in sorted(value)
        ) + "}"
    raise TypeError(f"Unsupported JSON value: {type(value)!r}")


def normalized_path(path: Path, repository_root: Path) -> str:
    relative = path.resolve().relative_to(repository_root.resolve())
    candidate = unicodedata.normalize("NFC", PurePosixPath(*relative.parts).as_posix())
    if not candidate or candidate.startswith("/") or any(part in {"", ".", ".."} for part in candidate.split("/")):
        raise ValueError(f"Unsafe archive path: {candidate!r}")
    return candidate


def normalized_bytes(path: Path) -> tuple[str, bytes]:
    raw = path.read_bytes()
    if path.suffix.lower() not in TEXT_SUFFIXES:
        return "raw-binary", raw
    if raw.startswith(b"\xef\xbb\xbf"):
        raise ValueError(f"UTF-8 BOM is not permitted: {path}")
    text = raw.decode("utf-8")
    return "normalized-text", text.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8")


def candidate_files(repository_root: Path) -> list[Path]:
    profile_root = repository_root / "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft"
    persona_root = repository_root / "evaluation/personas"
    author_test = repository_root / "pi-study-helper/tests/pandas-cleaning-v2-assets.test.ts"
    files = [
        path
        for root in (profile_root, persona_root)
        for path in root.rglob("*")
        if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc"
    ]
    files.append(author_test)
    if not all(path.is_file() for path in files):
        raise FileNotFoundError("B candidate source set is incomplete")
    by_path: dict[str, Path] = {}
    for path in files:
        relative = normalized_path(path, repository_root)
        folded = relative.casefold()
        if any(existing.casefold() == folded for existing in by_path):
            raise ValueError(f"Case-insensitive duplicate archive path: {relative}")
        by_path[relative] = path
    return [by_path[path] for path in sorted(by_path, key=lambda item: item.encode("utf-8"))]


def entries_for(files: list[Path], repository_root: Path) -> tuple[list[dict[str, object]], dict[str, bytes]]:
    entries: list[dict[str, object]] = []
    payloads: dict[str, bytes] = {}
    for path in files:
        relative = normalized_path(path, repository_root)
        hash_mode, payload = normalized_bytes(path)
        payloads[relative] = payload
        entries.append({
            "path": relative,
            "hashMode": hash_mode,
            "byteLength": len(payload),
            "sha256": sha256(payload),
        })
    return entries, payloads


def asset_tree_sha256(entries: list[dict[str, object]]) -> str:
    stream = b"".join(
        (
            entry["path"].encode("utf-8") + b"\0" + entry["hashMode"].encode("ascii") + b"\0"
            + entry["sha256"].encode("ascii") + b"\0" + str(entry["byteLength"]).encode("ascii") + b"\n"
        )
        for entry in entries
    )
    return sha256(stream)


def build_summary(repository_root: Path, output_directory: Path) -> tuple[Path, str]:
    summary_path = output_directory / f"B-W2-D4-freeze-candidate-{W2_START_SHORT}.diagnostic-knowledge-state-summary.json"
    quality_root = repository_root / "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/quality"
    command = [
        "node",
        str(quality_root / "run-diagnostic-summary-vite.mjs"),
        str(quality_root / "generate-diagnostic-summary.mjs"),
        str(summary_path),
    ]
    subprocess.run(command, cwd=repository_root / "pi-study-helper", check=True)
    return summary_path, sha256(summary_path.read_bytes().rstrip(b"\n"))


def create_zip(zip_path: Path, payloads: dict[str, bytes]) -> None:
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9, strict_timestamps=True) as archive:
        for relative in sorted(payloads, key=lambda item: item.encode("utf-8")):
            entry = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, payloads[relative], compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def verify_archive(zip_path: Path, manifest: dict[str, object]) -> None:
    expected_entries = manifest["entries"]
    with zipfile.ZipFile(zip_path) as archive:
        names = archive.namelist()
        if names != [entry["path"] for entry in expected_entries]:
            raise ValueError("ZIP entry paths do not exactly match manifest entries")
        for entry in expected_entries:
            payload = archive.read(entry["path"])
            if len(payload) != entry["byteLength"] or sha256(payload) != entry["sha256"]:
                raise ValueError(f"ZIP content hash mismatch: {entry['path']}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True, help="Repository-external audit directory")
    args = parser.parse_args()

    repository_root = Path(__file__).resolve().parents[5]
    output_directory = args.output_dir.resolve()
    if output_directory == repository_root or repository_root in output_directory.parents:
        raise ValueError("--output-dir must be outside the public repository")
    output_directory.mkdir(parents=True, exist_ok=True)

    profile = json.loads((repository_root / "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/profile.json").read_text(encoding="utf-8"))
    blueprint = json.loads((repository_root / "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/assessments/diagnostic/questions.json").read_text(encoding="utf-8"))
    answer_key = json.loads((repository_root / "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/assessments/diagnostic/private/answer-key.json").read_text(encoding="utf-8"))
    if profile["version"] != "0.2.0-draft" or profile["revision"] != 2 or profile["status"] != "draft":
        raise ValueError("Only the revision 2 draft Profile may be frozen")

    files = candidate_files(repository_root)
    entries, payloads = entries_for(files, repository_root)
    final_entry = next((entry for entry in entries if entry["path"] == "evaluation/personas/final-60.jsonl"), None)
    if final_entry is None:
        raise ValueError("final-60.jsonl is missing from candidate entries")
    summary_path, diagnostic_summary_sha256 = build_summary(repository_root, output_directory)
    manifest = {
        "manifestVersion": MANIFEST_VERSION,
        "hashAlgorithm": "SHA-256",
        "aCommit": A_D3_COMMIT,
        "profileVersion": profile["version"],
        "profileRevision": profile["revision"],
        "scoringVersion": blueprint["scoringVersion"],
        "evaluatorVersion": answer_key["evaluatorVersion"],
        "entries": entries,
        "assetTreeSha256": asset_tree_sha256(entries),
        "final60Sha256": final_entry["sha256"],
        "diagnosticKnowledgeStateSummarySha256": diagnostic_summary_sha256,
    }
    manifest_name = f"B-W2-D4-freeze-candidate-{W2_START_SHORT}.manifest.json"
    zip_name = f"B-W2-D4-freeze-candidate-{W2_START_SHORT}.zip"
    manifest_path = output_directory / manifest_name
    zip_path = output_directory / zip_name
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    create_zip(zip_path, payloads)
    verify_archive(zip_path, manifest)
    zip_sha256 = sha256(zip_path.read_bytes())
    (output_directory / f"{zip_name}.sha256").write_text(f"{zip_sha256}  {zip_name}\n", encoding="ascii", newline="\n")
    print(json.dumps({
        "outputDirectory": str(output_directory),
        "zip": zip_name,
        "zipSha256": zip_sha256,
        "manifest": manifest_name,
        "manifestJcsSha256": sha256(canonical_json(manifest).encode("utf-8")),
        "assetTreeSha256": manifest["assetTreeSha256"],
        "final60Sha256": manifest["final60Sha256"],
        "diagnosticSummary": summary_path.name,
        "diagnosticKnowledgeStateSummarySha256": diagnostic_summary_sha256,
        "entryCount": len(entries),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
