from __future__ import annotations
import argparse, json, subprocess, zipfile
from pathlib import Path
from typing import Any
from audit_manifest import AuditFailure, HEX64, asset_tree, digest, entry_mode, jcs, load_json, node_jcs_sha256, normalized_text, safe_path

EXPECTED_COMMIT = "fa26097e46a72a2826d960a7e1934a8885098112"
EXPECTED_ASSET_TREE = "07fb50caf5cfd646654cedf5c038f836bbbede912c6034f4e3523deaf77183ab"
EXPECTED_FINAL60 = "b77ba4902003ba20bc5b233c4797838eb26325d1b38fd02bc68ba02206cb1d1c"
EXPECTED_MANIFEST_JCS = "39a16ca7e2d7af92b327f7417d0732e79a30ea16826b08c44bf3b26c3b4ddc3b"
EXPECTED_SUMMARY_JCS = "a6000080559dbc9a12f269f8d0bd8b10d9dfd1835cdf57fda0c33939ece11e88"
EXPECTED_D4_REPORT = "d945c2456d001f4e62252d3e425b96df1c5f34dc4e161a9d56fd3932760ad014"

def git_bytes(repo: Path, commit: str, path: str) -> bytes:
    result = subprocess.run(["git", "-C", str(repo), "show", f"{commit}:{path}"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode: raise AuditFailure("commit path is missing")
    return result.stdout

def carrier_documents(carrier: Path) -> tuple[bytes, bytes]:
    with zipfile.ZipFile(carrier) as outer:
        names = outer.namelist()
        manifest = next((name for name in names if name.endswith(".manifest.json")), None)
        summary = next((name for name in names if name.endswith("diagnostic-knowledge-state-summary.json")), None)
        if not manifest or not summary: raise AuditFailure("D4 carrier lacks manifest or diagnostic summary")
        return outer.read(manifest), outer.read(summary)

def bind(repo: Path, commit: str, manifest_data: bytes, summary_data: bytes, report_path: Path, output: Path) -> int:
    result: dict[str, Any] = {"schemaVersion": 1, "status": "BLOCKED", "formalCommit": commit, "contract": "W2-C2/W2-R5", "checks": {}, "counts": {}, "hashes": {}, "blockers": []}
    try:
        actual = subprocess.check_output(["git", "-C", str(repo), "rev-parse", commit], text=True).strip()
        if actual != commit or commit != EXPECTED_COMMIT: raise AuditFailure("formal commit identity mismatch")
        manifest = load_json(manifest_data, "manifest")
        entries = manifest.get("entries")
        if not isinstance(entries, list) or len(entries) != 67: raise AuditFailure("manifest must contain 67 entries")
        paths: list[str] = []
        for item in entries:
            if set(item) != {"path", "hashMode", "byteLength", "sha256"}: raise AuditFailure("manifest entry schema mismatch")
            path = safe_path(item["path"])
            if path in paths or item["hashMode"] != entry_mode(path) or not isinstance(item["byteLength"], int) or not HEX64.fullmatch(item["sha256"]): raise AuditFailure("manifest entry validation failed")
            paths.append(path)
        if paths != sorted(paths, key=lambda p: p.encode("utf-8")): raise AuditFailure("manifest paths are not sorted")
        actual_entries = []
        for item in entries:
            raw = git_bytes(repo, commit, item["path"])
            checked = normalized_text(raw) if item["hashMode"] == "normalized-text" else raw
            if len(checked) != item["byteLength"] or digest(checked) != item["sha256"]: raise AuditFailure(f"file content or byteLength mismatch: {item['path']}")
            actual_entries.append(item)
        manifest_jcs = digest(jcs(manifest).encode("utf-8"))
        load_json(summary_data, "diagnostic summary")
        summary_jcs = node_jcs_sha256(summary_data)
        tree = asset_tree(actual_entries)
        final_entry = next((item for item in entries if item["path"] == "evaluation/personas/final-60.jsonl"), None)
        if final_entry is None or tree != manifest.get("assetTreeSha256") or tree != EXPECTED_ASSET_TREE or final_entry["sha256"] != manifest.get("final60Sha256") or final_entry["sha256"] != EXPECTED_FINAL60: raise AuditFailure("asset tree or final-60 mismatch")
        if manifest_jcs != EXPECTED_MANIFEST_JCS or summary_jcs != EXPECTED_SUMMARY_JCS: raise AuditFailure("JCS binding mismatch")
        report_hash = digest(normalized_text(report_path.read_bytes()))
        if report_hash != EXPECTED_D4_REPORT: raise AuditFailure("D4 report hash mismatch")
        result["checks"] = {"67FileHashes":"PASS", "assetTree":"PASS", "final60":"PASS", "manifestJcs":"PASS", "diagnosticSummaryJcs":"PASS", "d4Report":"PASS"}
        result["counts"] = {"manifestEntries": 67, "missingFiles": 0, "mismatchedFiles": 0}
        result["hashes"] = {"manifestJcsSha256": manifest_jcs, "diagnosticSummaryJcsSha256": summary_jcs, "assetTreeSha256": tree, "final60Sha256": final_entry["sha256"], "d4ReportNormalizedSha256": report_hash}
        result["status"] = "PASS"
    except Exception as exc:
        result["blockers"].append(f"{type(exc).__name__}: {exc}")
    output.parent.mkdir(parents=True, exist_ok=True); output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(result, ensure_ascii=False, indent=2)); return 0 if result["status"] == "PASS" else 1

def main() -> int:
    p = argparse.ArgumentParser(); p.add_argument("--repo-root", type=Path, required=True); p.add_argument("--commit", required=True); p.add_argument("--carrier", type=Path); p.add_argument("--manifest", type=Path); p.add_argument("--summary", type=Path); p.add_argument("--d4-report", type=Path, required=True); p.add_argument("--output", type=Path, required=True); a = p.parse_args()
    try:
        if a.carrier: manifest, summary = carrier_documents(a.carrier)
        elif a.manifest and a.summary: manifest, summary = a.manifest.read_bytes(), a.summary.read_bytes()
        else: raise AuditFailure("provide --carrier or both --manifest and --summary")
        return bind(a.repo_root.resolve(), a.commit, manifest, summary, a.d4_report.resolve(), a.output.resolve())
    except Exception as exc:
        print(json.dumps({"schemaVersion":1,"status":"BLOCKED","blockers":[f"{type(exc).__name__}: {exc}"]}, ensure_ascii=False)); return 1
if __name__ == "__main__": raise SystemExit(main())
