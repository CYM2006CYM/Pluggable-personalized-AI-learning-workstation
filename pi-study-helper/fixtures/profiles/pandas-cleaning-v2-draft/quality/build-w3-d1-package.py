"""Build the B W3-D1 candidate ZIP and a central-directory-verified manifest."""
from __future__ import annotations

import hashlib
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
PROFILE = ROOT / "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft"
ANNOTATIONS = ROOT / "evaluation/golden/annotations"
ZIP_PATH = ROOT / "w3-d1-b-rectified-candidate.zip"
MANIFEST_REL = "evaluation/golden/annotations/w3-d1-b-candidate-manifest.json"
TEXT_EXTS = {".json", ".jsonl", ".md", ".py", ".ts"}

PROPOSED = [
    "evaluation/golden/annotations/b-final-021-060.jsonl",
    "evaluation/golden/annotations/B岗位W3-D1封存与校验报告.md",
    "evaluation/golden/annotations/b-final-021-060.seal.candidate.json",
    "evaluation/golden/annotations/handoff-w3-d1-b.md",
    MANIFEST_REL,
    "evaluation/golden/annotations/w3-d1-b-verification-evidence.md",
    "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/activities/learning-activities.json",
    "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/assessments/private/task-bundles.json",
    "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/assessments/private/test-cases.json",
    "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/assessments/private/tests/test-practical-hidden-structure.py",
    "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/assessments/private/tests/test-practical-hidden-missing.py",
    "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/assessments/private/tests/test-practical-hidden-duplicates.py",
    "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/assessments/private/tests/test-practical-hidden-types.py",
    "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/assessments/private/tests/test-practical-engineering-static.py",
    "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/quality/prepare-w3-b-d1-delivery.py",
    "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/quality/build-w3-d1-package.py",
    "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/quality/verify-w3-b-static-check.py",
    "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/quality/c-execution-evidence.json",
    "pi-study-helper/tests/pandas-cleaning-v2-assets.test.ts",
    "pi-study-helper/tests/w3-b-d1-delivery.test.ts",
    "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/rubrics/rubric-practical.json",
    "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/rubrics/rubric-structure.json",
]
FROZEN = ["evaluation/personas/final-60.jsonl", "evaluation/golden/annotations/b-first-20.jsonl"]
AUDIT_ONLY = ["evaluation/golden/annotations/original/audit-only/b-final-021-060.seal.json"]


def normalized(path: Path) -> tuple[bytes, str]:
    raw = path.read_bytes()
    if path.suffix in TEXT_EXTS:
        return raw.replace(b"\r\n", b"\n").replace(b"\r", b"\n"), "normalized-text"
    return raw, "raw-binary"


def file_entry(rel: str, category: str) -> dict:
    raw, mode = normalized(ROOT / rel)
    return {"path": rel, "hashMode": mode, "byteLength": len(raw), "sha256": hashlib.sha256(raw).hexdigest(), "category": category}


def main() -> None:
    seal = json.loads((ANNOTATIONS / "b-final-021-060.seal.candidate.json").read_text(encoding="utf-8"))
    asset_paths = [item["path"] for item in seal["taskBundleAssetTree"]["entries"]]
    package = list(dict.fromkeys(asset_paths + FROZEN + AUDIT_ONLY + [
        "evaluation/golden/annotations/b-final-021-060.jsonl",
        "evaluation/golden/annotations/b-final-021-060.seal.candidate.json",
        "evaluation/golden/annotations/B岗位W3-D1封存与校验报告.md",
        "evaluation/golden/annotations/w3-d1-b-verification-evidence.md",
        *[p for p in PROPOSED if p not in {MANIFEST_REL, "evaluation/golden/annotations/handoff-w3-d1-b.md"}],
    ]))
    package = sorted(package, key=lambda p: p.encode("utf-8"))
    for rel in package:
        if not (ROOT / rel).is_file():
            raise SystemExit(f"missing package entry: {rel}")
    categories = {}
    for rel in package:
        categories[rel] = "frozenInputsReadOnly" if rel in FROZEN else "auditOnly" if rel in AUDIT_ONLY else "auditEvidence" if rel in {
            MANIFEST_REL, "evaluation/golden/annotations/B岗位W3-D1封存与校验报告.md", "evaluation/golden/annotations/w3-d1-b-verification-evidence.md", "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/quality/c-execution-evidence.json"
        } else "proposedCommit"
    entries = [file_entry(rel, categories[rel]) for rel in package]
    manifest = {
        "manifestVersion": 3,
        "packageZipFileName": ZIP_PATH.name,
        "packageEntries": package + [MANIFEST_REL],
        "actualPackageFileCount": len(package) + 1,
        "registeredFileCount": len(entries),
        "selfExcluded": True,
        "fileEntries": entries,
        "proposedCommitPaths": PROPOSED,
        "frozenInputsReadOnly": FROZEN,
        "auditOnly": AUDIT_ONLY,
        "auditEvidence": [MANIFEST_REL, "evaluation/golden/annotations/B岗位W3-D1封存与校验报告.md", "evaluation/golden/annotations/w3-d1-b-verification-evidence.md", "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/quality/c-execution-evidence.json"],
        "fileClasses": {"proposedCommitPaths": PROPOSED, "frozenInputsReadOnly": FROZEN, "auditOnly": AUDIT_ONLY, "auditEvidence": [MANIFEST_REL, "evaluation/golden/annotations/B岗位W3-D1封存与校验报告.md", "evaluation/golden/annotations/w3-d1-b-verification-evidence.md"]},
    }
    (ANNOTATIONS / "w3-d1-b-candidate-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    with zipfile.ZipFile(ZIP_PATH, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for rel in package + [MANIFEST_REL]:
            archive.write(ROOT / rel, rel)
    with zipfile.ZipFile(ZIP_PATH) as archive:
        actual = sorted(archive.namelist(), key=lambda p: p.encode("utf-8"))
    if actual != sorted(manifest["packageEntries"], key=lambda p: p.encode("utf-8")):
        raise SystemExit("central directory does not match manifest")
    print(f"PACKAGE BUILT: {ZIP_PATH}")
    print(f"actualPackageFileCount={len(actual)} registeredFileCount={len(entries)} selfExcluded=true")


if __name__ == "__main__":
    main()
