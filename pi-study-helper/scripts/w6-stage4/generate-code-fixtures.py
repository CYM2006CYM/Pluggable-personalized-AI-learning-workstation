"""Generate and verify W6 stage-4 private code-evaluation fixtures."""

from __future__ import annotations

import argparse
import csv
import hashlib
import importlib.util
import json
import sys
from datetime import date, timedelta
from io import BytesIO
from pathlib import Path
from typing import Any, Callable

import pandas as pd

sys.dont_write_bytecode = True


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PROFILE_ROOT = PROJECT_ROOT / "fixtures/profiles/pandas-cleaning-revision-3-draft"
GENERATED_AT = "2026-08-25T00:00:00+08:00"
COLUMNS = ["order_id", "customer_id", "amount", "city", "order_date", "status", "note"]
FIXTURE_IDS = [
    "dataset-public-orders",
    "dataset-private-variant-01",
    "dataset-private-variant-02",
    "dataset-private-variant-03-large",
    "dataset-private-variant-04-edge",
]
PRIVATE_FIXTURE_IDS = FIXTURE_IDS[1:]
ACTIVITIES = {
    "act-load-csv": ("solution-read-csv.py", "load_orders", "wrong-read-csv.py", "test-read-csv-hidden.py"),
    "act-inspect-dataframe": ("solution-structure.py", "inspect_orders", "wrong-structure.py", "test-structure-hidden.py"),
    "act-missing": ("solution-missing.py", "clean_missing", "wrong-missing.py", "test-missing-hidden.py"),
    "act-duplicates": ("solution-duplicates.py", "deduplicate_orders", "wrong-duplicates.py", "test-duplicates-hidden.py"),
    "act-types": ("solution-types.py", "normalize_types", "wrong-types.py", "test-types-hidden.py"),
    "act-practical": ("solution-practical.py", "clean_orders", "wrong-practical.py", "test-practical-hidden-01.py"),
}
PUBLIC_TESTS = {
    "act-load-csv": "test-read-csv-public.py",
    "act-inspect-dataframe": "test-structure-public.py",
    "act-missing": "test-missing-public.py",
    "act-duplicates": "test-duplicates-public.py",
    "act-types": "test-types-public.py",
    "act-practical": "test-practical-public.py",
}
GENERIC_HIDDEN_TEST_IDS = {
    "act-load-csv": "test-read-csv-hidden",
    "act-inspect-dataframe": "test-structure-hidden",
    "act-missing": "test-missing-hidden",
    "act-duplicates": "test-duplicates-hidden",
    "act-types": "test-types-hidden",
    "act-practical": "test-practical-hidden-01",
}


def json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical_json(value: Any) -> str:
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(
            json.dumps(str(key), ensure_ascii=False) + ":" + canonical_json(value[key])
            for key in sorted(value)
        ) + "}"
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def read_json(relative: str) -> Any:
    return json.loads((PROFILE_ROOT / relative).read_text(encoding="utf-8"))


def csv_bytes(rows: list[dict[str, str]]) -> bytes:
    from io import StringIO

    buffer = StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=COLUMNS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue().encode("utf-8")


def large_rows() -> list[dict[str, str]]:
    cities = ["上海市", "沪", "北京市", "京", "广州市", "穗", "深圳", "杭州"]
    statuses = ["completed", "PENDING", "Cancelled", "unknown", ""]
    start = date(2026, 1, 1)
    rows: list[dict[str, str]] = []
    for index in range(240):
        order_id = "" if index in {47, 139, 223} else f"L{index % 180 + 1:04d}"
        if index % 29 == 0:
            amount = "inf"
        elif index % 23 == 0:
            amount = "无法解析"
        elif index % 19 == 0:
            amount = "￥1,234.50"
        else:
            amount = f"{(index * 37) % 5000 + 0.5:.2f}"
        if index % 37 == 0:
            order_date = ""
        elif index % 31 == 0:
            order_date = "2026/08/01"
        else:
            order_date = (start + timedelta(days=index % 300)).isoformat()
        rows.append({
            "order_id": order_id,
            "customer_id": "" if index % 17 == 0 else f"C{index % 73 + 1:04d}",
            "amount": amount,
            "city": cities[index % len(cities)],
            "order_date": order_date,
            "status": statuses[index % len(statuses)],
            "note": "" if index % 11 == 0 else ("包含,逗号" if index % 13 == 0 else f"批量记录{index:03d}"),
        })
    return rows


def edge_rows() -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for index in range(60):
        pair = index // 2
        first = index % 2 == 0
        if first:
            order_date = f"2026-08-{pair % 28 + 1:02d}"
        elif pair % 3 == 0:
            order_date = "not-a-date"
        elif pair % 3 == 1:
            order_date = f"2025-07-{pair % 28 + 1:02d}"
        else:
            order_date = f"2026-09-{pair % 28 + 1:02d}"
        amounts = [" 88 ", "￥9,999.99", "-0.01", "NaN", "1e3", "-inf"]
        cities = ["上海市", "沪", "北京市", "京", "广州市", "穗", "未知城市"]
        statuses = [" COMPLETED ", "pending", "CANCELLED", "unknown", ""]
        rows.append({
            "order_id": "" if index == 58 else f"E{pair + 1:04d}",
            "customer_id": "" if index % 10 == 0 else f"边界客户{pair + 1:03d}",
            "amount": amounts[index % len(amounts)],
            "city": cities[index % len(cities)],
            "order_date": order_date,
            "status": statuses[index % len(statuses)],
            "note": "" if index % 7 == 0 else ("带引号\"与,逗号" if index % 9 == 0 else f"边界记录{index:02d}"),
        })
    return rows


def import_function(path: Path, function_name: str) -> Callable[..., Any]:
    module_name = "w6_stage4_" + hashlib.sha256(str(path).encode("utf-8")).hexdigest()[:12]
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    function = getattr(module, function_name, None)
    if not callable(function):
        raise RuntimeError(f"missing callable {function_name}: {path}")
    return function


def normalize_value(value: Any) -> Any:
    if pd.isna(value):
        return None
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if hasattr(value, "item"):
        value = value.item()
    return value


def serialize_output(activity_id: str, fixture_id: str, frame: pd.DataFrame) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "activityId": activity_id,
        "fixtureId": fixture_id,
        "columns": [str(column) for column in frame.columns],
        "dtypes": [str(dtype) for dtype in frame.dtypes],
        "rowCount": len(frame),
        "records": [
            [normalize_value(value) for value in row]
            for row in frame.itertuples(index=False, name=None)
        ],
    }


def fixture_source(fixture_id: str) -> str:
    return {
        "dataset-public-orders": "existing_public_small_sample",
        "dataset-private-variant-01": "existing_private_fixture",
        "dataset-private-variant-02": "existing_private_fixture",
        "dataset-private-variant-03-large": "w6_stage4_deterministic_large",
        "dataset-private-variant-04-edge": "w6_stage4_deterministic_edge",
    }[fixture_id]


def build_assets() -> tuple[dict[Path, bytes], dict[str, str]]:
    generated: dict[Path, bytes] = {
        PROFILE_ROOT / "datasets/private/orders-variant-03-large.csv": csv_bytes(large_rows()),
        PROFILE_ROOT / "datasets/private/orders-variant-04-edge.csv": csv_bytes(edge_rows()),
    }

    fixtures = read_json("datasets/fixtures.json")
    fixture_paths = {
        "dataset-public-orders": "datasets/public/orders-learning.csv",
        "dataset-private-variant-01": "datasets/private/orders-variant-01.csv",
        "dataset-private-variant-02": "datasets/private/orders-variant-02.csv",
        "dataset-private-variant-03-large": "datasets/private/orders-variant-03-large.csv",
        "dataset-private-variant-04-edge": "datasets/private/orders-variant-04-edge.csv",
    }
    existing_by_id = {item["fixtureId"]: item for item in fixtures["fixtures"]}
    fixture_entries = []
    for fixture_id in FIXTURE_IDS:
        path = PROFILE_ROOT / fixture_paths[fixture_id]
        payload = generated[path] if path in generated else path.read_bytes()
        visibility = "public" if fixture_id == "dataset-public-orders" else "private"
        fixture_entries.append({
            "fixtureId": fixture_id,
            "visibility": visibility,
            "fileRef": fixture_paths[fixture_id],
            "format": "csv",
            "assetHash": f"sha256:{sha256(payload)}",
        })
        if fixture_id in existing_by_id:
            unchanged = {**existing_by_id[fixture_id], "assetHash": f"sha256:{sha256(payload)}"}
            if unchanged != fixture_entries[-1]:
                raise RuntimeError(f"existing fixture contract drift: {fixture_id}")
    fixtures["fixtures"] = fixture_entries
    generated[PROFILE_ROOT / "datasets/fixtures.json"] = json_bytes(fixtures)

    activities_document = read_json("activities/learning-activities.json")
    activities_by_id = {item["activityId"]: item for item in activities_document["activities"]}
    for activity_id in ACTIVITIES:
        activities_by_id[activity_id]["datasetRefs"] = list(FIXTURE_IDS)
    generated[PROFILE_ROOT / "activities/learning-activities.json"] = json_bytes(activities_document)

    public_registry = read_json("assessments/public/test-cases.json")
    private_registry = read_json("assessments/private/test-cases.json")
    private_by_id = {item["testId"]: item for item in private_registry["tests"]}
    for test_id in GENERIC_HIDDEN_TEST_IDS.values():
        private_by_id[test_id]["fixtureRefs"] = list(PRIVATE_FIXTURE_IDS)
    for registry in (public_registry, private_registry):
        for test in registry["tests"]:
            test_path = PROFILE_ROOT / test["fileRef"]
            test["assetHash"] = f"sha256:{sha256(test_path.read_bytes())}"
    generated[PROFILE_ROOT / "assessments/public/test-cases.json"] = json_bytes(public_registry)
    generated[PROFILE_ROOT / "assessments/private/test-cases.json"] = json_bytes(private_registry)

    input_payloads: dict[str, bytes] = {}
    for fixture_id, relative in fixture_paths.items():
        path = PROFILE_ROOT / relative
        input_payloads[fixture_id] = generated[path] if path in generated else path.read_bytes()

    cases: list[dict[str, Any]] = []
    for activity_id, (solution_file, function_name, _, _) in ACTIVITIES.items():
        solution = import_function(PROFILE_ROOT / "reference-solutions" / solution_file, function_name)
        activity = activities_by_id[activity_id]
        for fixture_id in FIXTURE_IDS:
            input_path = PROFILE_ROOT / fixture_paths[fixture_id]
            input_source: Any = BytesIO(input_payloads[fixture_id])
            argument: Any = input_source if activity_id == "act-load-csv" else pd.read_csv(input_source, dtype="string")
            result = solution(argument)
            if not isinstance(result, pd.DataFrame):
                raise RuntimeError(f"reference output is not DataFrame: {activity_id}/{fixture_id}")
            output_relative = f"datasets/private/expected/{activity_id}/{fixture_id}.json"
            output_payload = json_bytes(serialize_output(activity_id, fixture_id, result))
            generated[PROFILE_ROOT / output_relative] = output_payload
            cases.append({
                "caseId": f"{activity_id}--{fixture_id}",
                "activityId": activity_id,
                "activityVersion": activity["templateVersion"],
                "profileRevision": 3,
                "fixtureId": fixture_id,
                "source": fixture_source(fixture_id),
                "generatedAt": GENERATED_AT,
                "inputRef": fixture_paths[fixture_id],
                "inputSha256": f"sha256:{sha256(input_payloads[fixture_id])}",
                "expectedOutputRef": output_relative,
                "expectedOutputSha256": f"sha256:{sha256(output_payload)}",
                "inputRowCount": len(pd.read_csv(BytesIO(input_payloads[fixture_id]), dtype="string")),
                "outputRowCount": len(result),
            })
    case_manifest = {
        "schemaVersion": 1,
        "profileRevision": 3,
        "generatorVersion": "w6-stage4-code-fixtures-v1",
        "generatedAt": GENERATED_AT,
        "visibility": "private",
        "cases": cases,
    }
    generated[PROFILE_ROOT / "assessments/private/code-fixture-cases.json"] = json_bytes(case_manifest)

    public_by_id = {item["testId"]: item for item in public_registry["tests"]}
    private_by_id = {item["testId"]: item for item in private_registry["tests"]}
    fixture_by_id = {item["fixtureId"]: item for item in fixture_entries}
    bundle_document = read_json("assessments/private/task-bundles.json")
    formal_hashes: dict[str, str] = {}
    for bundle in bundle_document["bundles"]:
        activity_id = bundle["activity"]["activityId"]
        if activity_id not in ACTIVITIES:
            continue
        activity = activities_by_id[activity_id]
        bundle["activity"] = activity
        bundle["contract"]["entryPoint"]["argumentFixtureIds"] = list(FIXTURE_IDS)
        bundle["publicTests"] = [public_by_id[test_id] for test_id in activity["publicTestRefs"]]
        bundle["hiddenTests"] = [private_by_id[test_id] for test_id in activity["hiddenTestRefs"]]
        without_hash = {key: value for key, value in bundle.items() if key != "assetBundleHash"}
        resolved_fixtures = [fixture_by_id[fixture_id] for fixture_id in activity["datasetRefs"]]
        digest = sha256(canonical_json({**without_hash, "resolvedFixtures": resolved_fixtures}).encode("utf-8"))
        bundle["assetBundleHash"] = digest
        formal_hashes[activity_id] = digest
    generated[PROFILE_ROOT / "assessments/private/task-bundles.json"] = json_bytes(bundle_document)
    return generated, formal_hashes


def validate_runtime_cases() -> dict[str, int]:
    reference_passes = 0
    wrong_rejections = 0
    fixtures = read_json("datasets/fixtures.json")["fixtures"]
    paths = {item["fixtureId"]: PROFILE_ROOT / item["fileRef"] for item in fixtures}
    for activity_id, (solution_file, function_name, wrong_file, hidden_test_file) in ACTIVITIES.items():
        solution = import_function(PROFILE_ROOT / "reference-solutions" / solution_file, function_name)
        wrong = import_function(PROFILE_ROOT / "assessments/private/known-wrong" / wrong_file, function_name)
        public_test = import_function(PROFILE_ROOT / "assessments/public/tests" / PUBLIC_TESTS[activity_id], "run_case")
        hidden_test = import_function(PROFILE_ROOT / "assessments/private/tests" / hidden_test_file, "run_case")
        for fixture_id in FIXTURE_IDS:
            path = paths[fixture_id]
            argument: Any = path if activity_id == "act-load-csv" else pd.read_csv(path, dtype="string")
            (public_test if fixture_id == "dataset-public-orders" else hidden_test)(solution, argument)
            reference_passes += 1
        for fixture_id in FIXTURE_IDS[-2:]:
            path = paths[fixture_id]
            argument = path if activity_id == "act-load-csv" else pd.read_csv(path, dtype="string")
            try:
                wrong_result = wrong(argument)
            except Exception:
                wrong_rejections += 1
                continue
            if not isinstance(wrong_result, pd.DataFrame):
                wrong_rejections += 1
                continue
            reference = import_function(PROFILE_ROOT / "reference-solutions" / solution_file, function_name)
            reference_argument: Any = path if activity_id == "act-load-csv" else pd.read_csv(path, dtype="string")
            expected_result = reference(reference_argument)
            if serialize_output(activity_id, fixture_id, wrong_result) == serialize_output(activity_id, fixture_id, expected_result):
                raise RuntimeError(f"known-wrong implementation escaped new fixture: {activity_id}/{fixture_id}")
            wrong_rejections += 1
    return {"referencePasses": reference_passes, "knownWrongRejections": wrong_rejections}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Verify generated bytes without changing files")
    args = parser.parse_args()

    generated, formal_hashes = build_assets()
    if args.check:
        mismatches = [
            str(path.relative_to(PROJECT_ROOT))
            for path, payload in generated.items()
            if not path.is_file() or path.read_bytes() != payload
        ]
        if mismatches:
            raise RuntimeError("generated assets are stale: " + ", ".join(mismatches))
    else:
        for path, payload in generated.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(payload)

    runtime = validate_runtime_cases()
    print(json.dumps({
        "mode": "check" if args.check else "write",
        "fixtureCount": len(FIXTURE_IDS),
        "activityCount": len(ACTIVITIES),
        "caseCount": len(FIXTURE_IDS) * len(ACTIVITIES),
        "formalAssetBundleHashes": formal_hashes,
        **runtime,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
