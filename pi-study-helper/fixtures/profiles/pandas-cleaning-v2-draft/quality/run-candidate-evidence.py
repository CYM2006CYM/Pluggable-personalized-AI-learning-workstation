"""Deterministic candidate-evidence harness; not the authoritative C evaluator."""

import hashlib
import importlib.util
import json
import os
import platform
import sys
from pathlib import Path

import pandas as pd

HARNESS_VERSION = "b-candidate-evidence-v2"
ROOT = Path(__file__).resolve().parents[1]


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_module(path):
    name = "candidate_" + hashlib.sha256(str(path).encode()).hexdigest()[:16]
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


manifest = load_json(ROOT / "assessments/private/task-bundles.json")
fixtures = {item["fixtureId"]: item for item in load_json(ROOT / "datasets/fixtures.json")["fixtures"]}
results = []
input_hashes = {"harness": sha256(Path(__file__))}


def record(bundle_id, implementation, test, fixture_id, callback):
    try:
        callback()
        results.append({"bundleId": bundle_id, "implementation": implementation, "testId": test["testId"], "fixtureId": fixture_id, "exitCode": 0, "errorType": None, "errorSummary": None})
    except Exception as error:
        results.append({"bundleId": bundle_id, "implementation": implementation, "testId": test["testId"], "fixtureId": fixture_id, "exitCode": 1, "errorType": type(error).__name__, "errorSummary": str(error).replace(str(ROOT), "<PROFILE_ROOT>")[:240]})


for bundle in manifest["bundles"]:
    activity = bundle["activity"]
    bundle_id = bundle["bundleId"]
    entry_name = bundle["contract"]["entryPoint"]["name"]
    ref_path = ROOT / "reference-solutions" / f'{activity["referenceSolutionRef"]}.py'
    wrong_path = ROOT / "assessments/private/known-wrong" / f'{activity["knownWrongSolutionRefs"][0]}.py'
    input_hashes[str(ref_path.relative_to(ROOT)).replace("\\", "/")] = sha256(ref_path)
    input_hashes[str(wrong_path.relative_to(ROOT)).replace("\\", "/")] = sha256(wrong_path)
    reference = getattr(load_module(ref_path), entry_name)
    wrong = getattr(load_module(wrong_path), entry_name)
    starter_namespace = {}
    exec(activity["starterCode"], starter_namespace)
    starter = starter_namespace[entry_name]
    reference_source = ref_path.read_text(encoding="utf-8")
    wrong_source = wrong_path.read_text(encoding="utf-8")

    for test in bundle["publicTests"] + bundle["hiddenTests"]:
        test_path = ROOT / test["fileRef"]
        input_hashes[test["fileRef"]] = sha256(test_path)
        module = load_module(test_path)
        for fixture_id in test["fixtureRefs"]:
            fixture = fixtures[fixture_id]
            dataset_path = ROOT / fixture["fileRef"]
            input_hashes[fixture["fileRef"]] = sha256(dataset_path)
            if hasattr(module, "run_static_case"):
                record(bundle_id, "reference", test, fixture_id, lambda m=module, s=reference_source: m.run_static_case(s))
                record(bundle_id, "known_wrong", test, fixture_id, lambda m=module, s=wrong_source: m.run_static_case(s))
                continue
            frame = pd.read_csv(dataset_path, dtype="string")
            record(bundle_id, "reference", test, fixture_id, lambda m=module, f=reference, d=frame: m.run_case(f, d.copy(deep=True)))
            if test["visibility"] == "public":
                record(bundle_id, "starter", test, fixture_id, lambda m=module, f=starter, d=frame: m.run_case(f, d.copy(deep=True)))
                record(bundle_id, "known_wrong", test, fixture_id, lambda m=module, f=wrong, d=frame: m.run_case(f, d.copy(deep=True)))

summary = {
    "referencePassed": all(item["exitCode"] == 0 for item in results if item["implementation"] == "reference"),
    "allStartersRejected": all(item["exitCode"] != 0 for item in results if item["implementation"] == "starter"),
    "allKnownWrongRejectedByAtLeastOneTest": all(any(item["implementation"] == "known_wrong" and item["bundleId"] == bundle["bundleId"] and item["exitCode"] != 0 for item in results) for bundle in manifest["bundles"]),
}
output = {
    "schemaVersion": 1,
    "status": "candidate_evidence_only",
    "harnessVersion": HARNESS_VERSION,
    "command": "PYTHONDONTWRITEBYTECODE=1 python quality/run-candidate-evidence.py",
    "environment": {"python": platform.python_version(), "pandas": pd.__version__, "platform": platform.platform()},
    "inputHashes": dict(sorted(input_hashes.items())),
    "results": results,
    "summary": summary,
    "overallExitCode": 0 if all(summary.values()) else 1,
    "limitations": ["Candidate evidence only; does not freeze EnvironmentLock values.", "C/owner prototype remains authoritative."],
}
rendered = json.dumps(output, ensure_ascii=False, indent=2) + "\n"
if len(sys.argv) == 3 and sys.argv[1] == "--output":
    Path(sys.argv[2]).write_text(rendered, encoding="utf-8")
else:
    print(rendered, end="")
sys.exit(output["overallExitCode"])
