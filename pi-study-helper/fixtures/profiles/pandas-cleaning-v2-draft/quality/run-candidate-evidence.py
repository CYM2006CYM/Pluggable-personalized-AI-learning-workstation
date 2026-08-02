"""Deterministic B candidate-evidence harness; C remains the V2-3 authority."""

import hashlib
import importlib.util
import json
import platform
import sys
from pathlib import Path

import pandas as pd


HARNESS_VERSION = "b-candidate-evidence-v5"
REPEAT_COUNT = 3
ROOT = Path(__file__).resolve().parents[1]


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def safe_asset_id(category, content_hash):
    """Return a stable report identifier without exposing the source path."""
    opaque = hashlib.sha256(f"{category}\0{content_hash}".encode("utf-8")).hexdigest()[:16]
    return f"{category}-{opaque}"


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_module(path):
    name = "candidate_" + hashlib.sha256(str(path).encode()).hexdigest()[:16]
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def dataframe_fingerprint(frame):
    payload = {
        "columns": [str(column) for column in frame.columns],
        "dtypes": [str(dtype) for dtype in frame.dtypes],
        "index": [str(index) for index in frame.index],
        "records": json.loads(frame.to_json(orient="records", date_format="iso", date_unit="ns")),
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


manifest = load_json(ROOT / "assessments/private/task-bundles.json")
fixtures = {item["fixtureId"]: item for item in load_json(ROOT / "datasets/fixtures.json")["fixtures"]}
results = []
input_hashes = {}
baseline_repeat_fingerprints = {}
wrong_rejection_matrix = {}


def record_input_hash(category, path):
    content_hash = sha256(path)
    input_hashes[safe_asset_id(category, content_hash)] = content_hash


record_input_hash("harness", Path(__file__))
record_input_hash("contract", ROOT / "assessments/private/task-bundles.json")
record_input_hash("fixture-index", ROOT / "datasets/fixtures.json")


def record(bundle_id, implementation, test_id, fixture_id, repeat_index, callback, require_dataframe):
    try:
        output = callback()
        if require_dataframe and not isinstance(output, pd.DataFrame):
            raise TypeError("output test must return a pandas DataFrame")
        fingerprint = dataframe_fingerprint(output) if isinstance(output, pd.DataFrame) else None
        results.append({
            "bundleId": bundle_id,
            "implementation": implementation,
            "testId": test_id,
            "fixtureId": fixture_id,
            "repeatIndex": repeat_index,
            "exitCode": 0,
            "errorType": None,
            "errorSummary": None,
            "outputFingerprint": fingerprint,
        })
        if implementation == "baseline":
            key = f"{bundle_id}:{test_id}:{fixture_id}"
            baseline_repeat_fingerprints.setdefault(key, []).append(fingerprint)
        return True
    except Exception as error:
        results.append({
            "bundleId": bundle_id,
            "implementation": implementation,
            "testId": test_id,
            "fixtureId": fixture_id,
            "repeatIndex": repeat_index,
            "exitCode": 1,
            "errorType": type(error).__name__,
            "errorSummary": "redacted_candidate_execution_failure",
            "outputFingerprint": None,
        })
        return False


for bundle in manifest["bundles"]:
    activity = bundle["activity"]
    bundle_id = bundle["bundleId"]
    entry_name = bundle["contract"]["entryPoint"]["name"]
    ref_path = ROOT / "reference-solutions" / f'{activity["referenceSolutionRef"]}.py'
    record_input_hash("baseline", ref_path)
    reference = getattr(load_module(ref_path), entry_name)
    starter_namespace = {}
    exec(activity["starterCode"], starter_namespace)
    starter = starter_namespace[entry_name]
    reference_source = ref_path.read_text(encoding="utf-8")
    wrongs = []
    for wrong_ref in activity["knownWrongSolutionRefs"]:
        wrong_path = ROOT / "assessments/private/known-wrong" / f"{wrong_ref}.py"
        record_input_hash("known-wrong", wrong_path)
        wrongs.append((wrong_ref, getattr(load_module(wrong_path), entry_name), wrong_path.read_text(encoding="utf-8")))

    requires_dataframe = activity["kind"] in {"code_completion", "coding_practical"}
    for test in bundle["publicTests"] + bundle["hiddenTests"]:
        test_path = ROOT / test["fileRef"]
        record_input_hash("test", test_path)
        module = load_module(test_path)
        safe_test_id = safe_asset_id("test", test["assetHash"])
        for fixture_id in test["fixtureRefs"]:
            fixture = fixtures[fixture_id]
            dataset_path = ROOT / fixture["fileRef"]
            record_input_hash("dataset", dataset_path)
            safe_fixture_id = safe_asset_id("dataset", fixture["assetHash"])
            for repeat_index in range(1, REPEAT_COUNT + 1):
                frame = pd.read_csv(dataset_path, dtype="string")
                record(
                    bundle_id,
                    "baseline",
                    safe_test_id,
                    safe_fixture_id,
                    repeat_index,
                    lambda m=module, f=reference, d=frame: m.run_case(f, d.copy(deep=True)),
                    requires_dataframe,
                )
                if test["visibility"] == "public":
                    record(
                        bundle_id,
                        "starter",
                        safe_test_id,
                        safe_fixture_id,
                        repeat_index,
                        lambda m=module, f=starter, d=frame: m.run_case(f, d.copy(deep=True)),
                        requires_dataframe,
                    )
                for wrong_ref, wrong, _ in wrongs:
                    passed = record(
                        bundle_id,
                        f"known_wrong:{wrong_ref}",
                        safe_test_id,
                        safe_fixture_id,
                        repeat_index,
                        lambda m=module, f=wrong, d=frame: m.run_case(f, d.copy(deep=True)),
                        requires_dataframe,
                    )
                    wrong_key = f"{bundle_id}:{wrong_ref}:{safe_fixture_id}"
                    wrong_rejection_matrix.setdefault(wrong_key, {}).setdefault(str(repeat_index), []).append(not passed)


baseline_output_fingerprints = {
    key: values[0] for key, values in baseline_repeat_fingerprints.items() if values
}
all_baseline_repeats_stable = all(
    len(values) == REPEAT_COUNT and values[0] is not None and len(set(values)) == 1
    for values in baseline_repeat_fingerprints.values()
)
all_known_wrong_rejected_per_fixture = all(
    len(repeats) == REPEAT_COUNT and all(any(test_rejections) for test_rejections in repeats.values())
    for repeats in wrong_rejection_matrix.values()
)
summary = {
    "repeatCount": REPEAT_COUNT,
    "baselinePassed": all(item["exitCode"] == 0 for item in results if item["implementation"] == "baseline"),
    "allBaselineRepeatsStable": all_baseline_repeats_stable,
    "allStartersRejected": all(item["exitCode"] != 0 for item in results if item["implementation"] == "starter"),
    "allKnownWrongRejectedPerFixture": all_known_wrong_rejected_per_fixture,
    "baselineOutputCount": len(baseline_output_fingerprints),
}
output = {
    "schemaVersion": 1,
    "status": "candidate_evidence_only",
    "harnessVersion": HARNESS_VERSION,
    "command": "PYTHONDONTWRITEBYTECODE=1 python quality/run-candidate-evidence.py --output quality/c-execution-evidence.json",
    "environment": {"python": platform.python_version(), "pandas": pd.__version__, "platform": platform.platform()},
    "inputHashes": dict(sorted(input_hashes.items())),
    "baselineOutputFingerprints": dict(sorted(baseline_output_fingerprints.items())),
    "baselineRepeatFingerprints": dict(sorted(baseline_repeat_fingerprints.items())),
    "wrongRejectionMatrix": dict(sorted(wrong_rejection_matrix.items())),
    "results": results,
    "summary": summary,
    "overallExitCode": 0 if all(summary.values()) else 1,
    "limitations": [
        "Candidate evidence only; C executes V2-3.",
        "EnvironmentLock values remain pending C/owner prototype.",
    ],
}
rendered = json.dumps(output, ensure_ascii=False, indent=2) + "\n"
for forbidden in ("assessments/private/", "datasets/private/", "reference-solutions/", "hidden"):
    if forbidden in rendered:
        raise RuntimeError(f"Unsafe verification-report marker: {forbidden}")
if len(sys.argv) == 3 and sys.argv[1] == "--output":
    Path(sys.argv[2]).write_text(rendered, encoding="utf-8")
else:
    print(rendered, end="")
sys.exit(output["overallExitCode"])
