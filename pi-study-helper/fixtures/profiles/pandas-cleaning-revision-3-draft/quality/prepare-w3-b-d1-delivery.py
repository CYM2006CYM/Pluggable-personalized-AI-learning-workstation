"""Read-only verifier and isolated seal builder for B W3-D1."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

W3_START_COMMIT = "f190326a4a906b46e4001484ffa30a7839b82ed2"
B_D1_COMMIT = "277805b4dc612548f4dcdf4f91189abb4ef5c8e3"
HISTORICAL_PACKAGE_NAME = "w3-d1-b-rectified-candidate.zip"
ARCHIVED_ZIP_PATH = "evaluation/golden/annotations/audit/w3-d1-b/w3-d1-b-candidate-277805b.zip"
ARCHIVED_ZIP_SHA256 = "4472528da92359df20d0d494e4f42a74d06b04e37fec4fe2bd809ecac23034a2"
ALL_ACTIVITY_IDS = (
    "act-inspect-dataframe", "act-missing", "act-duplicates", "act-types", "act-practical",
)
W3_ACTIVITY_IDS = ("act-inspect-dataframe", "act-practical")
ANNOTATION_SHA256 = "eaefe9cfbbf8f6144e8299abfc0d82b66cb9ffe8dd1d783e841c5bdfac2690bf"
INPUT_SHA256 = "b77ba4902003ba20bc5b233c4797838eb26325d1b38fd02bc68ba02206cb1d1c"
NORMALIZED_EXTS = {".json", ".jsonl", ".md", ".py"}
FROZEN_PATHS = {
    "evaluation/personas/final-60.jsonl",
    "evaluation/golden/annotations/b-first-20.jsonl",
}
AUDIT_ONLY_PATH = "evaluation/golden/annotations/original/audit-only/b-final-021-060.seal.json"


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def canonical_json(value) -> str:
    # Match the TypeScript canonicalizer: JSON.stringify emits 1, not 1.0.
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(str(key), ensure_ascii=False) + ":" + canonical_json(value[key]) for key in sorted(value)) + "}"
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def normalized_payload(path: Path) -> tuple[bytes, str]:
    raw = path.read_bytes()
    if path.suffix in NORMALIZED_EXTS:
        return raw.replace(b"\r\n", b"\n").replace(b"\r", b"\n"), "normalized-text"
    return raw, "raw-binary"


def entry(repo_root: Path, path: Path) -> dict:
    payload, mode = normalized_payload(path)
    return {
        "path": path.resolve().relative_to(repo_root.resolve()).as_posix(),
        "hashMode": mode,
        "byteLength": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
    }


def tree_hash(entries: list[dict]) -> str:
    stream = b"".join(
        f"{item['path']}\0{item['hashMode']}\0{item['sha256']}\0{item['byteLength']}\n".encode("utf-8")
        for item in entries
    )
    return hashlib.sha256(stream).hexdigest()


def annotation_hash(path: Path) -> tuple[str, int]:
    payload, _ = normalized_payload(path)
    return hashlib.sha256(payload).hexdigest(), len(payload)


def test_registry(profile_root: Path) -> dict[str, dict]:
    public = read_json(profile_root / "assessments/public/test-cases.json")["tests"]
    private = read_json(profile_root / "assessments/private/test-cases.json")["tests"]
    registry = {}
    for test in public + private:
        if test["testId"] in registry:
            raise ValueError(f"duplicate registered testId: {test['testId']}")
        actual = hashlib.sha256((profile_root / test["fileRef"]).read_bytes()).hexdigest()
        if test["assetHash"] != f"sha256:{actual}":
            raise ValueError(f"registered test hash mismatch: {test['testId']}")
        registry[test["testId"]] = test
    return registry


def validate_bundles(profile_root: Path) -> tuple[list[dict], list[dict]]:
    manifest = read_json(profile_root / "assessments/private/task-bundles.json")
    activities = {item["activityId"]: item for item in read_json(profile_root / "activities/learning-activities.json")["activities"]}
    fixtures = read_json(profile_root / "datasets/fixtures.json")["fixtures"]
    registry = test_registry(profile_root)
    bundles = manifest["bundles"]
    ids = tuple(bundle["activity"]["activityId"] for bundle in bundles)
    if ids != ALL_ACTIVITY_IDS:
        raise ValueError(f"global Bundle order/count drift: {ids}")
    seen_tests = set()
    for bundle in bundles:
        activity = bundle["activity"]
        if activity != activities.get(activity["activityId"]):
            raise ValueError(f"embedded activity drift: {activity['activityId']}")
        refs = activity["publicTestRefs"] + activity["hiddenTestRefs"]
        bound = bundle["publicTests"] + bundle["hiddenTests"]
        if refs != [test["testId"] for test in bound]:
            raise ValueError(f"activity test reference order drift: {activity['activityId']}")
        for test in bound:
            if test["testId"] in seen_tests:
                raise ValueError(f"testId duplicated by Bundles: {test['testId']}")
            seen_tests.add(test["testId"])
            if registry.get(test["testId"]) != test:
                raise ValueError(f"Bundle test differs from registry: {test['testId']}")
            if not set(test["fixtureRefs"]).issubset(activity["datasetRefs"]):
                raise ValueError(f"test fixture escapes activity: {test['testId']}")
        without_hash = {key: value for key, value in bundle.items() if key != "assetBundleHash"}
        resolved = [fixture for fixture in fixtures if fixture["fixtureId"] in activity["datasetRefs"]]
        expected = hashlib.sha256(canonical_json({**without_hash, "resolvedFixtures": resolved}).encode("utf-8")).hexdigest()
        if expected != bundle["assetBundleHash"]:
            raise ValueError(f"stale assetBundleHash: {bundle['bundleId']}")
    targets = [bundle for bundle in bundles if bundle["activity"]["activityId"] in W3_ACTIVITY_IDS]
    if tuple(bundle["activity"]["activityId"] for bundle in targets) != W3_ACTIVITY_IDS:
        raise ValueError("W3 target Bundle set drift")
    for bundle in targets:
        rubric = read_json(profile_root / "rubrics" / f"{bundle['activity']['rubricRef']}.json")
        if bundle["rubric"] != rubric:
            raise ValueError(f"embedded W3 rubric drift: {bundle['bundleId']}")
        if bundle["activity"]["activityId"] == "act-inspect-dataframe":
            if rubric["dimensions"][0].get("label") != "列结构":
                raise ValueError("rubric-structure label must be 列结构")
        dimension_map = rubric.get("dimensionTestMap", {})
        for dimension in rubric["dimensions"]:
            if dimension["scoringMethod"] == "manual_review":
                raise ValueError("manual_review is forbidden")
            if dimension["scoringMethod"] in {"tests", "static_check"} and not dimension_map.get(dimension["dimensionId"]):
                raise ValueError(f"missing dimension map: {dimension['dimensionId']}")
    practical = next(bundle for bundle in targets if bundle["activity"]["activityId"] == "act-practical")
    expected_map = {
        "invariants": ["test-practical-public", "test-practical-hidden-01", "test-practical-hidden-02"],
        "structure": ["test-practical-hidden-structure"],
        "missing": ["test-practical-hidden-missing"],
        "duplicates": ["test-practical-hidden-duplicates"],
        "types": ["test-practical-hidden-types"],
        "engineering": ["test-practical-engineering-static"],
    }
    if practical["rubric"].get("dimensionTestMap") != expected_map:
        raise ValueError("act-practical dimensionTestMap drift")
    static_test = next(test for test in practical["hiddenTests"] if test["testId"] == "test-practical-engineering-static")
    runtime_test = next(test for test in practical["hiddenTests"] if test["testId"] == "test-practical-hidden-02")
    if static_test["fileRef"] != "assessments/private/tests/test-practical-engineering-static.py":
        raise ValueError("engineering must use independent static test file")
    if runtime_test["dimensionId"] != "invariants" or not runtime_test["blocking"]:
        raise ValueError("variant-02 runtime invariant test drift")
    return bundles, targets


def validate_reference_closure(profile_root: Path, bundles: list[dict]) -> None:
    fixtures = {item["fixtureId"] for item in read_json(profile_root / "datasets/fixtures.json")["fixtures"]}
    comparisons = {item["comparisonId"] for item in read_json(profile_root / "environments/dataframe-comparisons.json")["comparisons"]}
    for bundle in bundles:
        activity = bundle["activity"]
        if not set(activity["datasetRefs"]).issubset(fixtures):
            raise ValueError(f"missing dataset reference: {bundle['bundleId']}")
        if bundle["contract"]["output"].get("comparisonRef") not in comparisons:
            raise ValueError(f"missing comparison reference: {bundle['bundleId']}")
        for relative in (
            f"rubrics/{activity['rubricRef']}.json",
            f"reference-solutions/{activity['referenceSolutionRef']}.py",
        ):
            if not (profile_root / relative).is_file():
                raise ValueError(f"missing referenced asset: {relative}")
        for wrong in activity["knownWrongSolutionRefs"]:
            if not (profile_root / "assessments/private/known-wrong" / f"{wrong}.py").is_file():
                raise ValueError(f"missing known-wrong asset: {wrong}")


def collect_w3_assets(profile_root: Path, targets: list[dict]) -> list[Path]:
    paths = {
        profile_root / "activities/learning-activities.json",
        profile_root / "assessments/private/task-bundles.json",
        profile_root / "assessments/public/test-cases.json",
        profile_root / "assessments/private/test-cases.json",
        profile_root / "datasets/fixtures.json",
        profile_root / "environments/environment-lock.json",
        profile_root / "environments/dataframe-comparisons.json",
        profile_root / "knowledge/knowledge-points.json",
        profile_root / "goals/learning-goals.json",
        profile_root / "sources/source-map.json",
    }
    fixtures = {item["fixtureId"]: item for item in read_json(profile_root / "datasets/fixtures.json")["fixtures"]}
    for bundle in targets:
        activity = bundle["activity"]
        paths.add(profile_root / "rubrics" / f"{activity['rubricRef']}.json")
        paths.add(profile_root / "reference-solutions" / f"{activity['referenceSolutionRef']}.py")
        for wrong in activity["knownWrongSolutionRefs"]:
            paths.add(profile_root / "assessments/private/known-wrong" / f"{wrong}.py")
        for test in bundle["publicTests"] + bundle["hiddenTests"]:
            paths.add(profile_root / test["fileRef"])
        for fixture_id in activity["datasetRefs"]:
            paths.add(profile_root / fixtures[fixture_id]["fileRef"])
    return sorted(paths, key=lambda path: str(path))


def verify_zip_manifest(repo_root: Path, manifest: dict, errors: list[str]) -> None:
    package_name = manifest.get("packageZipFileName")
    if package_name != HISTORICAL_PACKAGE_NAME:
        errors.append("historical manifest packageZipFileName drift")
    package_path = repo_root / ARCHIVED_ZIP_PATH
    if not package_path.is_file():
        errors.append(f"archived D1 ZIP missing: {ARCHIVED_ZIP_PATH}")
        return
    if hashlib.sha256(package_path.read_bytes()).hexdigest() != ARCHIVED_ZIP_SHA256:
        errors.append("archived D1 ZIP SHA-256 drift")
    expected_paths = manifest.get("packageEntries", [])
    file_entries = {item["path"]: item for item in manifest.get("fileEntries", [])}
    if manifest.get("actualPackageFileCount") != len(expected_paths):
        errors.append("manifest package count is stale")
    if manifest.get("selfExcluded") is not True:
        errors.append("manifest selfExcluded must be true")
    if set(expected_paths) != set(file_entries) | {"evaluation/golden/annotations/w3-d1-b-candidate-manifest.json"}:
        errors.append("manifest file entries do not match packageEntries")
    if set(manifest.get("frozenInputsReadOnly", [])) != FROZEN_PATHS:
        errors.append("manifest frozen inputs drift")
    if manifest.get("auditOnly") != [AUDIT_ONLY_PATH]:
        errors.append("manifest audit-only path drift")
    annotation_path = "evaluation/golden/annotations/b-final-021-060.jsonl"
    if annotation_path not in expected_paths or annotation_path not in file_entries or annotation_path not in manifest.get("proposedCommitPaths", []):
        errors.append("B annotation must be a proposed package entry")
    elif file_entries[annotation_path].get("category") != "proposedCommit" or file_entries[annotation_path].get("sha256") != ANNOTATION_SHA256:
        errors.append("B annotation package entry hash/category drift")
    proposed = set(manifest.get("proposedCommitPaths", []))
    if proposed & (FROZEN_PATHS | {AUDIT_ONLY_PATH, HISTORICAL_PACKAGE_NAME, ARCHIVED_ZIP_PATH}):
        errors.append("proposedCommitPaths includes non-committable material")
    try:
        with zipfile.ZipFile(package_path) as archive:
            names = archive.namelist()
            if len(names) != len(expected_paths) or names != expected_paths:
                errors.append("ZIP central directory differs from manifest packageEntries")
            for name, item in file_entries.items():
                raw = archive.read(name)
                payload = raw.replace(b"\r\n", b"\n").replace(b"\r", b"\n") if item["hashMode"] == "normalized-text" else raw
                if len(payload) != item["byteLength"] or hashlib.sha256(payload).hexdigest() != item["sha256"]:
                    errors.append(f"ZIP entry hash mismatch: {name}")
    except (OSError, KeyError, zipfile.BadZipFile) as error:
        errors.append(f"ZIP validation error: {type(error).__name__}")


def run_verify(repo_root: Path, profile_root: Path) -> int:
    errors = []
    seal_path = repo_root / "evaluation/golden/annotations/b-final-021-060.seal.candidate.json"
    manifest_path = repo_root / "evaluation/golden/annotations/w3-d1-b-candidate-manifest.json"
    try:
        bundles, targets = validate_bundles(profile_root)
        validate_reference_closure(profile_root, bundles)
    except (KeyError, ValueError) as error:
        errors.append(str(error))
        bundles, targets = [], []
    annotation_path = repo_root / "evaluation/golden/annotations/b-final-021-060.jsonl"
    input_path = repo_root / "evaluation/personas/final-60.jsonl"
    annotation_digest, _ = annotation_hash(annotation_path)
    input_digest, _ = annotation_hash(input_path)
    if annotation_digest != ANNOTATION_SHA256:
        errors.append("frozen annotation SHA-256 changed")
    if input_digest != INPUT_SHA256:
        errors.append("frozen input SHA-256 changed")
    if not seal_path.is_file() or not manifest_path.is_file():
        errors.append("candidate seal or manifest missing")
    else:
        seal = read_json(seal_path)
        manifest = read_json(manifest_path)
        if seal.get("qualificationStatus") != "PENDING_OWNER_DUAL_SEAL_CHECK":
            errors.append("B must not mark dual-seal qualification PASS")
        if seal.get("annotation", {}).get("sha256") != ANNOTATION_SHA256 or seal.get("input", {}).get("sha256") != INPUT_SHA256:
            errors.append("candidate seal frozen hashes drift")
        if seal.get("supersedes", {}).get("originalSealPath") != AUDIT_ONLY_PATH:
            errors.append("original seal is not audit-only")
        if targets:
            entries = seal.get("taskBundleAssetTree", {}).get("entries", [])
            manifest_entries = {item["path"]: item for item in manifest.get("fileEntries", [])}
            if len(entries) != 29:
                errors.append(f"historical W3 asset tree count must be 29, got {len(entries)}")
            for item in entries:
                archived = manifest_entries.get(item.get("path"))
                if archived is None or {key: archived.get(key) for key in ("path", "hashMode", "byteLength", "sha256")} != item:
                    errors.append(f"historical W3 asset entry differs from archived manifest: {item.get('path')}")
            if seal.get("taskBundleAssetTree", {}).get("sha256") != tree_hash(entries):
                errors.append("historical candidate seal asset tree hash drift")
        verify_zip_manifest(repo_root, manifest, errors)
    if errors:
        print("VERIFICATION FAILED:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1
    print("VERIFICATION PASSED")
    print(f"  HEAD:             {subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo_root, text=True).strip()}")
    print(f"  Input hash:       {input_digest}")
    print(f"  Annotation hash:  {annotation_digest}")
    print(f"  Asset tree hash:  {seal['taskBundleAssetTree']['sha256']}")
    print("  Global bundles:   5")
    print("  W3 target bundles: act-inspect-dataframe, act-practical")
    return 0


def build_seal(repo_root: Path, profile_root: Path, temp_dir: Path) -> int:
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo_root, text=True).strip()
    if head != B_D1_COMMIT:
        print(f"ERROR: historical seal rebuild requires HEAD={B_D1_COMMIT}, got {head}", file=sys.stderr)
        return 1
    if temp_dir.exists() and any(temp_dir.iterdir()):
        print("ERROR: --temp-dir must be empty", file=sys.stderr)
        return 1
    temp_dir.mkdir(parents=True, exist_ok=True)
    bundles, targets = validate_bundles(profile_root)
    validate_reference_closure(profile_root, bundles)
    entries = sorted([entry(repo_root, path) for path in collect_w3_assets(profile_root, targets)], key=lambda item: item["path"].encode("utf-8"))
    input_digest, input_length = annotation_hash(repo_root / "evaluation/personas/final-60.jsonl")
    annotation_digest, annotation_length = annotation_hash(repo_root / "evaluation/golden/annotations/b-final-021-060.jsonl")
    seal = {
        "schemaVersion": 3,
        "owner": "B",
        "scope": {"firstCaseId": "final-021", "lastCaseId": "final-060", "caseCount": 40},
        "w3StartCommit": W3_START_COMMIT,
        "input": {"path": "evaluation/personas/final-60.jsonl", "sha256": input_digest, "hashMode": "utf8-lf-normalized", "byteLength": input_length},
        "annotation": {"path": "evaluation/golden/annotations/b-final-021-060.jsonl", "sha256": annotation_digest, "hashMode": "utf8-lf-normalized", "byteLength": annotation_length},
        "supersedes": {"originalSealPath": AUDIT_ONLY_PATH, "originalAssetTreeSha256": "557cd5bdebae5dd0e713c5a64b1058f3657be971e812e7f99d63b142ffdb1d38", "annotationHashUnchanged": True},
        "qualificationStatus": "PENDING_OWNER_DUAL_SEAL_CHECK",
        "intendedUploadSealPath": "evaluation/golden/annotations/b-final-021-060.seal.candidate.json",
        "auditOnlySealPath": AUDIT_ONLY_PATH,
        "taskBundleAssetTree": {"algorithm": "sha256", "entryCount": len(entries), "entries": entries, "sha256": tree_hash(entries)},
        "recomputeCommands": ["python quality/prepare-w3-b-d1-delivery.py --verify", "npm.cmd test -- --run tests/w3-b-d1-delivery.test.ts"],
        "sealedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
    }
    output = temp_dir / "evaluation/golden/annotations/b-final-021-060.seal.candidate.json"
    write_json(output, seal)
    print(output)
    return 0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--build-candidate", action="store_true")
    parser.add_argument("--temp-dir", type=Path)
    args = parser.parse_args()
    profile_root = Path(__file__).resolve().parents[1]
    repo_root = Path(__file__).resolve().parents[5]
    if args.build_candidate:
        if args.temp_dir is None:
            raise SystemExit("--build-candidate requires --temp-dir")
        raise SystemExit(build_seal(repo_root, profile_root, args.temp_dir))
    raise SystemExit(run_verify(repo_root, profile_root))


if __name__ == "__main__":
    main()
