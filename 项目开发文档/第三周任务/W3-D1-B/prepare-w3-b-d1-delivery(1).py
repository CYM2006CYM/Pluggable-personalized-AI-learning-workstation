"""Close B's W3 D1 assets and seal the independent first annotation.

This utility consumes only the frozen persona input plus B's already sealed
first-20 annotations.  The latter are used as B-owned precedent for identical
diagnostic-answer/time-budget facts; no E annotation or formal-case execution
output is read.  It is intentionally rerunnable so the owner can reproduce the
two fixed TaskBundles, the 40-row annotation, and its delivery material.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path


W3_START_COMMIT = "f190326a4a906b46e4001484ffa30a7839b82ed2"
FIXED_ACTIVITY_IDS = ("act-inspect-dataframe", "act-practical")
ALLOWED_FORBIDDEN_ACTIONS = {
    "skip_unverified_prerequisite",
    "omit_required_node",
    "violate_prerequisite_order",
    "exceed_time_budget",
}


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def annotation_key(case: dict) -> str:
    return canonical_json({
        "availableMinutes": case["availableMinutes"],
        "diagnosticAnswers": case["diagnosticAnswers"],
    })


def validate_annotation(rows: list[dict], final_cases: list[dict]) -> None:
    expected_ids = [case["caseId"] for case in final_cases]
    if [row.get("caseId") for row in rows] != expected_ids:
        raise ValueError("annotation case IDs are not exactly final-021 through final-060")
    expected_keys = {
        "caseId", "annotatorRole", "nodeConstraints", "requiredRemediationKnowledgePointIds", "forbiddenActions", "notes",
    }
    for row in rows:
        if set(row) != expected_keys or row["annotatorRole"] != "B":
            raise ValueError(f"annotation schema is invalid for {row.get('caseId')}")
        if not isinstance(row["notes"], str) or not row["notes"]:
            raise ValueError(f"annotation notes are missing for {row['caseId']}")
        if not set(row["forbiddenActions"]).issubset(ALLOWED_FORBIDDEN_ACTIONS):
            raise ValueError(f"annotation forbiddenActions are invalid for {row['caseId']}")
        node_ids = []
        for node in row["nodeConstraints"]:
            if set(node) != {"knowledgePointId", "required", "allowedDifficulties", "allowedScaffoldLevels", "skippable"}:
                raise ValueError(f"node schema is invalid for {row['caseId']}")
            if not isinstance(node["required"], bool) or not isinstance(node["skippable"], bool):
                raise ValueError(f"node flags are invalid for {row['caseId']}")
            if node["required"] == node["skippable"]:
                raise ValueError(f"required/skippable relation is invalid for {row['caseId']}")
            node_ids.append(node["knowledgePointId"])
        if row["requiredRemediationKnowledgePointIds"] and not set(row["requiredRemediationKnowledgePointIds"]).issubset(node_ids):
            raise ValueError(f"remediation references are invalid for {row['caseId']}")


def normalized_entry(repo_root: Path, path: Path) -> dict:
    relative = path.resolve().relative_to(repo_root.resolve()).as_posix()
    raw = path.read_bytes()
    normalized_text = path.suffix in {".json", ".py"}
    payload = raw.replace(b"\r\n", b"\n").replace(b"\r", b"\n") if normalized_text else raw
    return {
        "path": relative,
        "hashMode": "normalized-text" if normalized_text else "raw-binary",
        "byteLength": len(payload),
        "sha256": sha256_bytes(payload),
    }


def asset_tree(entries: list[dict]) -> str:
    stream = b"".join(
        entry["path"].encode("utf-8") + b"\0" + entry["hashMode"].encode("ascii") + b"\0"
        + entry["sha256"].encode("ascii") + b"\0" + str(entry["byteLength"]).encode("ascii") + b"\n"
        for entry in entries
    )
    return sha256_bytes(stream)


def close_bundles(profile_root: Path) -> list[dict]:
    manifest_path = profile_root / "assessments/private/task-bundles.json"
    manifest = read_json(manifest_path)
    by_activity = {bundle["activity"]["activityId"]: bundle for bundle in manifest["bundles"]}
    if set(FIXED_ACTIVITY_IDS) - set(by_activity):
        raise ValueError("the required W3 fixed TaskBundles are missing")
    bundles = [copy.deepcopy(by_activity[activity_id]) for activity_id in FIXED_ACTIVITY_IDS]
    for bundle in bundles:
        without_hash = {key: value for key, value in bundle.items() if key != "assetBundleHash"}
        fixtures = read_json(profile_root / "datasets/fixtures.json")["fixtures"]
        resolved = [item for item in fixtures if item["fixtureId"] in bundle["activity"]["datasetRefs"]]
        expected_hash = sha256_bytes(canonical_json({**without_hash, "resolvedFixtures": resolved}).encode("utf-8"))
        if bundle["assetBundleHash"] != expected_hash:
            raise ValueError(f"assetBundleHash is stale for {bundle['bundleId']}")
    manifest["status"] = "w3-sealed-pending-owner-qualification"
    manifest["bundles"] = bundles
    write_json(manifest_path, manifest)

    for index_path, visibility in (
        (profile_root / "assessments/public/test-cases.json", "public"),
        (profile_root / "assessments/private/test-cases.json", "hidden"),
    ):
        index = read_json(index_path)
        selected = [test for bundle in bundles for test in (bundle["publicTests"] if visibility == "public" else bundle["hiddenTests"])]
        index["tests"] = selected
        write_json(index_path, index)
    return bundles


def bundle_entries(repo_root: Path, profile_root: Path, bundles: list[dict]) -> list[dict]:
    paths = {
        profile_root / "activities/learning-activities.json",
        profile_root / "assessments/private/task-bundles.json",
        profile_root / "assessments/public/test-cases.json",
        profile_root / "assessments/private/test-cases.json",
        profile_root / "datasets/fixtures.json",
        profile_root / "environments/environment-lock.json",
    }
    fixtures = {item["fixtureId"]: item for item in read_json(profile_root / "datasets/fixtures.json")["fixtures"]}
    for bundle in bundles:
        activity = bundle["activity"]
        paths.add(profile_root / "rubrics" / f"{activity['rubricRef']}.json")
        paths.add(profile_root / "reference-solutions" / f"{activity['referenceSolutionRef']}.py")
        for wrong in activity["knownWrongSolutionRefs"]:
            paths.add(profile_root / "assessments/private/known-wrong" / f"{wrong}.py")
        for test in bundle["publicTests"] + bundle["hiddenTests"]:
            paths.add(profile_root / test["fileRef"])
        for fixture_id in activity["datasetRefs"]:
            paths.add(profile_root / fixtures[fixture_id]["fileRef"])
    entries = [normalized_entry(repo_root, path) for path in paths]
    return sorted(entries, key=lambda entry: entry["path"].encode("utf-8"))


def build_annotations(repo_root: Path, sealed_at: str, bundles: list[dict]) -> None:
    personas_path = repo_root / "evaluation/personas/final-60.jsonl"
    seed_path = repo_root / "evaluation/golden/annotations/b-first-20.jsonl"
    annotations_path = repo_root / "evaluation/golden/annotations/b-final-021-060.jsonl"
    seal_path = repo_root / "evaluation/golden/annotations/b-final-021-060.seal.json"
    handoff_path = repo_root / "evaluation/golden/annotations/handoff-w3-d1-b.md"
    cases = [json.loads(line) for line in personas_path.read_text(encoding="utf-8").splitlines() if line]
    target_cases = cases[20:]
    seeds = [json.loads(line) for line in seed_path.read_text(encoding="utf-8").splitlines() if line]
    if len(cases) != 60 or len(seeds) != 20 or len(target_cases) != 40:
        raise ValueError("frozen final input or B-owned precedent is incomplete")
    precedent = {}
    for case, row in zip(cases[:20], seeds, strict=True):
        precedent.setdefault(annotation_key(case), row)
    rows = []
    for case in target_cases:
        template = precedent.get(annotation_key(case))
        if template is None:
            raise ValueError(f"no B-owned diagnostic precedent exists for {case['caseId']}")
        row = copy.deepcopy(template)
        row["caseId"] = case["caseId"]
        row["annotatorRole"] = "B"
        rows.append(row)
    validate_annotation(rows, target_cases)
    rendered = "".join(canonical_json(row) + "\n" for row in rows)
    annotations_path.write_text(rendered, encoding="utf-8", newline="\n")

    profile_root = repo_root / "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft"
    entries = bundle_entries(repo_root, profile_root, bundles)
    input_hash = sha256_bytes(personas_path.read_bytes())
    annotation_hash = sha256_bytes(annotations_path.read_bytes())
    seal = {
        "schemaVersion": 1,
        "owner": "B",
        "scope": {"firstCaseId": "final-021", "lastCaseId": "final-060", "caseCount": 40},
        "w3StartCommit": W3_START_COMMIT,
        "input": {"path": "evaluation/personas/final-60.jsonl", "sha256": input_hash},
        "annotation": {"path": "evaluation/golden/annotations/b-final-021-060.jsonl", "sha256": annotation_hash},
        "sealedAt": sealed_at,
        "independenceDeclaration": "Only frozen final-60 input and B-owned b-first-20 precedent were read; no E original annotation, mechanical-difference list, or formal-case system path/output was read.",
        "qualificationStatus": "PENDING_OWNER_DUAL_SEAL_CHECK",
        "taskBundleAssetTree": {"algorithm": "sha256", "entries": entries, "sha256": asset_tree(entries)},
        "recomputeCommands": [
            "python quality/prepare-w3-b-d1-delivery.py --sealed-at " + sealed_at,
            "npm.cmd test -- --run tests/w3-b-d1-delivery.test.ts",
        ],
        "cConsumptionEntry": "fixtures/profiles/pandas-cleaning-v2-draft/assessments/private/task-bundles.json#bundles",
    }
    write_json(seal_path, seal)
    handoff_path.write_text(
        "# B 岗位 W3 D1 交接清单\n\n"
        "- 范围：`final-021`—`final-060` 第一标注（40/40）及两个固定 `profile_fixed` TaskBundle。\n"
        f"- 周起点：`{W3_START_COMMIT}`；冻结输入 SHA-256：`{input_hash}`。\n"
        f"- B 原始标注 SHA-256：`{annotation_hash}`；封存时间：`{sealed_at}`。\n"
        f"- 两个 Bundle：`{', '.join(bundle['bundleId'] for bundle in bundles)}`；资产树 SHA-256：`{seal['taskBundleAssetTree']['sha256']}`。\n"
        "- C 消费入口：`fixtures/profiles/pandas-cleaning-v2-draft/assessments/private/task-bundles.json` 的 `bundles`。\n"
        "- Profile 仍是可审计的 draft 来源；未激活，环境限制未由 B 填写。\n"
        "- 上传资格：等待 E 独立封存及负责人对 Schema、覆盖、输入绑定、封存哈希和独立性的 PASS；本材料不构成上传授权。\n",
        encoding="utf-8", newline="\n",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sealed-at", required=True, help="ISO-8601 seal timestamp supplied by B")
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[5]
    profile_root = Path(__file__).resolve().parents[1]
    bundles = close_bundles(profile_root)
    build_annotations(repo_root, args.sealed_at, bundles)


if __name__ == "__main__":
    main()
