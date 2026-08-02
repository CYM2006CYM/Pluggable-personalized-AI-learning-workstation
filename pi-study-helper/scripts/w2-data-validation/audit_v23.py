from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import platform
import sys
from pathlib import Path
from typing import Any, Callable

import pandas as pd

sys.dont_write_bytecode = True


REQUIRED_COLUMNS = ["order_id", "customer_id", "amount", "city", "order_date", "status", "note"]
W2_V2_3_AUDIT_PANDAS_VERSION = "3.0.5"
ATOL = 1e-6
RTOL = 1e-5


class AssetFailure(Exception):
    pass


class ValidatorFailure(Exception):
    pass


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalized_sha256(path: Path) -> str:
    data = path.read_bytes()
    if data.startswith(b"\xef\xbb\xbf"):
        raise AssetFailure("text asset contains UTF-8 BOM")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise AssetFailure("text asset is not valid UTF-8") from error
    return sha256_bytes(text.replace("\r\n", "\n").replace("\r", "\n").encode("utf-8"))


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:
        raise AssetFailure("invalid JSON asset") from error
    if not isinstance(value, dict):
        raise AssetFailure("JSON asset must be an object")
    return value


def safe_path(root: Path, reference: str) -> Path:
    if not isinstance(reference, str) or not reference or "\\" in reference:
        raise AssetFailure("invalid relative asset reference")
    relative = Path(reference)
    if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
        raise AssetFailure("unsafe relative asset reference")
    resolved_root = root.resolve()
    candidate = (resolved_root / relative).resolve()
    if resolved_root not in candidate.parents:
        raise AssetFailure("asset reference escapes Profile root")
    if not candidate.is_file():
        raise AssetFailure("referenced asset is missing")
    return candidate


def load_function(path: Path, entry_point: str) -> Callable[[pd.DataFrame], pd.DataFrame]:
    module_name = "c_v23_" + hashlib.sha256(str(path).encode("utf-8")).hexdigest()[:16]
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise AssetFailure("implementation module cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except Exception as error:
        raise AssetFailure("implementation module import failed") from error
    function = getattr(module, entry_point, None)
    if not callable(function):
        raise AssetFailure("implementation entry point is missing")
    return function


def load_test(path: Path) -> Callable[[Callable[..., Any], pd.DataFrame], Any]:
    module_name = "c_v23_test_" + hashlib.sha256(str(path).encode("utf-8")).hexdigest()[:16]
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise AssetFailure("test module cannot be loaded")
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except Exception as error:
        raise AssetFailure("test module import failed") from error
    function = getattr(module, "run_case", None)
    if not callable(function):
        raise AssetFailure("test module run_case is missing")
    return function


def invoke(function: Callable[[pd.DataFrame], Any], frame: pd.DataFrame) -> pd.DataFrame:
    before = frame.copy(deep=True)
    output = function(frame)
    if not isinstance(output, pd.DataFrame):
        raise AssetFailure("implementation did not return a DataFrame")
    try:
        pd.testing.assert_frame_equal(frame, before, check_exact=True)
    except AssertionError as error:
        raise AssetFailure("implementation mutated its input DataFrame") from error
    return output


def compare_frames(actual: pd.DataFrame, expected: pd.DataFrame) -> None:
    if list(actual.columns) != list(expected.columns):
        raise AssetFailure("column name/order mismatch")
    actual_reset = actual.reset_index(drop=True)
    expected_reset = expected.reset_index(drop=True)
    if actual_reset.shape != expected_reset.shape:
        raise AssetFailure("shape mismatch")
    if [str(dtype) for dtype in actual_reset.dtypes] != [str(dtype) for dtype in expected_reset.dtypes]:
        raise AssetFailure("dtype mismatch")
    if not actual_reset.isna().equals(expected_reset.isna()):
        raise AssetFailure("missing-value position mismatch")
    try:
        pd.testing.assert_frame_equal(
            actual_reset,
            expected_reset,
            check_dtype=True,
            check_exact=False,
            check_like=False,
            atol=ATOL,
            rtol=RTOL,
        )
    except AssertionError as error:
        raise AssetFailure("cell value or business row order mismatch") from error


def dataframe_fingerprint(frame: pd.DataFrame) -> str:
    payload = {
        "columns": [str(column) for column in frame.columns],
        "dtypes": [str(dtype) for dtype in frame.dtypes],
        "index": [str(index) for index in frame.index],
        "records": json.loads(frame.to_json(orient="records", date_format="iso", date_unit="ns")),
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return "sha256:" + sha256_bytes(encoded)


def null_mask_fingerprint(frame: pd.DataFrame) -> str:
    payload = frame.reset_index(drop=True).isna().to_numpy().astype(int).tolist()
    return sha256_bytes(json.dumps(payload, separators=(",", ":")).encode("ascii"))


def verify_opaque_fingerprint_multisets(
    expected_by_bundle: dict[str, list[tuple[str, ...]]],
    observed_by_bundle: dict[str, list[tuple[str, ...]]],
    bundle_ids: list[str],
) -> int:
    matched = 0
    for bundle_id in bundle_ids:
        expected = sorted(expected_by_bundle.get(bundle_id, []))
        observed = sorted(observed_by_bundle.get(bundle_id, []))
        if observed != expected:
            raise AssetFailure("opaque baseline fingerprint multiset differs from independent outputs")
        matched += sum(len(values) for values in observed)
    return matched


def run(profile_root: Path, manifest_audit_path: Path, output_path: Path) -> int:
    report: dict[str, Any] = {
        "schemaVersion": 1,
        "status": "BLOCKED",
        "v23Status": "BLOCKED",
        "validationId": "V2-3",
        "contract": "W2-C2/W2-R5",
        "contractSupplement": "W2-V2-3-ENV-1",
        "environment": {
            "python": platform.python_version(),
            "pandas": pd.__version__,
            "expectedPandas": W2_V2_3_AUDIT_PANDAS_VERSION,
            "platform": platform.platform(),
        },
        "counts": {},
        "datasetResults": [],
        "knownWrongResults": [],
        "hashes": {
            "fixtures": {}, "references": {}, "knownWrong": {}, "tests": {},
        },
        "classifications": [],
        "blockers": [],
        "limitations": [
            "environment_lock_and_final_dtype_names_remain_pending_owner_prototype",
        ],
    }
    # D33 requires the environment gate to run before any manifest or B asset read.
    if pd.__version__ != W2_V2_3_AUDIT_PANDAS_VERSION:
        report["environment_mismatch"] = True
        report["classifications"] = ["environment_mismatch"]
        report["blockers"].append(
            f"EnvironmentMismatch: pandas {pd.__version__} does not match required "
            f"W2 V2-3 audit version {W2_V2_3_AUDIT_PANDAS_VERSION}"
        )
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 2

    try:
        manifest_audit = load_json(manifest_audit_path)
        report["blockers"].extend(manifest_audit.get("blockers", []))
        if manifest_audit.get("status") != "PASS":
            report["classifications"].append("b_asset_defect")
        else:
            report["formalCommit"] = manifest_audit.get("formalCommit")
            if not report["formalCommit"]:
                raise AssetFailure("formal binding lacks commit identity")

        profile = load_json(safe_path(profile_root, "profile.json"))
        if profile.get("version") != "0.2.0-draft" or profile.get("revision") != 2 or profile.get("status") != "draft":
            raise AssetFailure("Profile identity is not the required revision 2 draft")

        fixtures_path = safe_path(profile_root, "datasets/fixtures.json")
        bundles_path = safe_path(profile_root, "assessments/private/task-bundles.json")
        comparisons_path = safe_path(profile_root, "environments/dataframe-comparisons.json")
        environment_path = safe_path(profile_root, "environments/environment-lock.json")
        evidence_path = safe_path(profile_root, "quality/c-execution-evidence.json")
        fixtures_doc = load_json(fixtures_path)
        bundles_doc = load_json(bundles_path)
        comparisons = load_json(comparisons_path)
        environment_lock = load_json(environment_path)
        candidate_evidence = load_json(evidence_path)

        report["hashes"]["fixturesManifest"] = normalized_sha256(fixtures_path)
        report["hashes"]["taskBundles"] = normalized_sha256(bundles_path)
        report["hashes"]["dataframeComparisons"] = normalized_sha256(comparisons_path)
        report["hashes"]["environmentLock"] = normalized_sha256(environment_path)
        report["hashes"]["candidateEvidence"] = normalized_sha256(evidence_path)

        if environment_lock.get("status") != "draft_pending_C_prototype":
            raise AssetFailure("unexpected environment lock status")
        if candidate_evidence.get("status") != "candidate_evidence_only":
            raise AssetFailure("unexpected candidate evidence status")
        comparison_ids = {item.get("comparisonId") for item in comparisons.get("comparisons", [])}
        if "dfcmp-orders-clean-final" not in comparison_ids:
            raise AssetFailure("final clean DataFrame comparison contract is missing")

        fixtures = {item["fixtureId"]: item for item in fixtures_doc.get("fixtures", [])}
        if len(fixtures) != 3:
            raise AssetFailure("expected exactly three dataset fixtures")
        visibility_counts = {
            "public": sum(item.get("visibility") == "public" for item in fixtures.values()),
            "private": sum(item.get("visibility") == "private" for item in fixtures.values()),
        }
        if visibility_counts != {"public": 1, "private": 2}:
            raise AssetFailure("dataset visibility inventory mismatch")
        for fixture_id, fixture in fixtures.items():
            path = safe_path(profile_root, fixture["fileRef"])
            actual_hash = normalized_sha256(path)
            declared = fixture.get("assetHash", "")
            if declared != "sha256:" + actual_hash:
                raise AssetFailure("fixture assetHash mismatch")
            report["hashes"]["fixtures"][fixture_id] = actual_hash

        bundles = bundles_doc.get("bundles", [])
        if len(bundles) != 5:
            raise AssetFailure("expected exactly five task bundles")
        expected_fingerprints = candidate_evidence.get("referenceRepeatFingerprints")
        opaque_fingerprint_bindings = expected_fingerprints is None
        if opaque_fingerprint_bindings:
            expected_fingerprints = candidate_evidence.get("baselineRepeatFingerprints", {})
        if not isinstance(expected_fingerprints, dict) or not expected_fingerprints:
            raise AssetFailure("candidate evidence has no repeat fingerprint bindings")
        opaque_expected_by_bundle: dict[str, list[tuple[str, ...]]] = {}
        if opaque_fingerprint_bindings:
            for opaque_key, values in expected_fingerprints.items():
                if not isinstance(values, list) or len(values) != 3:
                    raise AssetFailure("candidate evidence has an invalid opaque fingerprint binding")
                bundle_key = opaque_key.split(":", 1)[0]
                opaque_expected_by_bundle.setdefault(bundle_key, []).append(tuple(values))
        opaque_observed_by_bundle: dict[str, list[tuple[str, ...]]] = {}
        reference_oracles: dict[tuple[str, str], pd.DataFrame] = {}
        reference_execution_count = 0
        candidate_fingerprint_match_count = 0
        full_clean_runs: dict[str, list[pd.DataFrame]] = {}
        test_case_count = 0

        for bundle in bundles:
            bundle_id = bundle["bundleId"]
            activity = bundle["activity"]
            entry_point = bundle["contract"]["entryPoint"]["name"]
            reference_path = safe_path(profile_root, f"reference-solutions/{activity['referenceSolutionRef']}.py")
            reference = load_function(reference_path, entry_point)
            report["hashes"]["references"][bundle_id] = normalized_sha256(reference_path)
            tests = bundle.get("publicTests", []) + bundle.get("hiddenTests", [])
            if not tests:
                raise AssetFailure("task bundle has no tests")
            for test in tests:
                test_id = test["testId"]
                test_path = safe_path(profile_root, test["fileRef"])
                run_case = load_test(test_path)
                report["hashes"]["tests"][test_id] = normalized_sha256(test_path)
                for fixture_id in test.get("fixtureRefs", []):
                    if fixture_id not in fixtures or fixture_id not in activity.get("datasetRefs", []):
                        raise AssetFailure("test fixture binding is not closed")
                    data_path = safe_path(profile_root, fixtures[fixture_id]["fileRef"])
                    evidence_key = f"{bundle_id}:{test_id}:{fixture_id}"
                    declared_repeats = expected_fingerprints.get(evidence_key) if not opaque_fingerprint_bindings else None
                    if not opaque_fingerprint_bindings and (
                        not isinstance(declared_repeats, list) or len(declared_repeats) != 3
                    ):
                        raise AssetFailure("candidate evidence is missing a three-run fingerprint binding")
                    test_case_count += 1
                    observed: list[pd.DataFrame] = []
                    observed_fingerprints: list[str] = []
                    for repeat_index in range(3):
                        frame = pd.read_csv(data_path, dtype="string")

                        def checked_reference(value: pd.DataFrame) -> pd.DataFrame:
                            return invoke(reference, value)

                        before = frame.copy(deep=True)
                        try:
                            output = run_case(checked_reference, frame)
                        except Exception as error:
                            raise AssetFailure("reference implementation failed a bound test") from error
                        if not isinstance(output, pd.DataFrame):
                            raise AssetFailure("bound test did not return the reference DataFrame")
                        try:
                            pd.testing.assert_frame_equal(frame, before, check_exact=True)
                        except AssertionError as error:
                            raise AssetFailure("bound test mutated its input DataFrame") from error
                        fingerprint = dataframe_fingerprint(output)
                        if declared_repeats is not None and fingerprint != declared_repeats[repeat_index]:
                            raise AssetFailure("reference output fingerprint differs from candidate binding")
                        observed.append(output)
                        observed_fingerprints.append(fingerprint)
                        reference_execution_count += 1
                        if declared_repeats is not None:
                            candidate_fingerprint_match_count += 1
                    if len(set(observed_fingerprints)) != 1:
                        raise AssetFailure("reference output is not deterministic across three runs")
                    if opaque_fingerprint_bindings:
                        opaque_observed_by_bundle.setdefault(bundle_id, []).append(tuple(observed_fingerprints))
                    for output in observed[1:]:
                        compare_frames(output, observed[0])
                    oracle_key = (bundle_id, fixture_id)
                    if oracle_key in reference_oracles:
                        compare_frames(observed[0], reference_oracles[oracle_key])
                    else:
                        reference_oracles[oracle_key] = observed[0]
                    if entry_point == "clean_orders":
                        full_clean_runs.setdefault(fixture_id, []).extend(observed)

        if opaque_fingerprint_bindings:
            candidate_fingerprint_match_count += verify_opaque_fingerprint_multisets(
                opaque_expected_by_bundle,
                opaque_observed_by_bundle,
                [bundle["bundleId"] for bundle in bundles],
            )

        if set(full_clean_runs) != set(fixtures):
            raise AssetFailure("full clean reference did not cover every fixture")
        for fixture_id, outputs in sorted(full_clean_runs.items()):
            if len(outputs) != 3:
                raise AssetFailure("full clean reference did not run exactly three times per fixture")
            first = outputs[0]
            if list(first.columns) != REQUIRED_COLUMNS:
                raise AssetFailure("clean_df fixed seven-column contract mismatch")
            for output in outputs[1:]:
                compare_frames(output, first)
            report["datasetResults"].append({
                "fixtureId": fixture_id,
                "visibility": fixtures[fixture_id]["visibility"],
                "repeatCount": 3,
                "rowCount": len(first),
                "columnCount": len(first.columns),
                "dtypes": [str(dtype) for dtype in first.dtypes],
                "nullMaskSha256": null_mask_fingerprint(first),
                "outputFingerprint": dataframe_fingerprint(first),
                "status": "PASS",
            })

        distinct_wrong: set[str] = set()
        wrong_fixture_repeat_count = 0
        wrong_test_rejection_count = 0
        for bundle in bundles:
            bundle_id = bundle["bundleId"]
            activity = bundle["activity"]
            entry_point = bundle["contract"]["entryPoint"]["name"]
            tests = bundle.get("publicTests", []) + bundle.get("hiddenTests", [])
            for wrong_ref in activity.get("knownWrongSolutionRefs", []):
                wrong_path = safe_path(profile_root, f"assessments/private/known-wrong/{wrong_ref}.py")
                wrong = load_function(wrong_path, entry_point)
                distinct_wrong.add(wrong_ref)
                report["hashes"]["knownWrong"][bundle_id] = normalized_sha256(wrong_path)
                rejected_repeats = 0
                for fixture_id in activity.get("datasetRefs", []):
                    matching_tests = [test for test in tests if fixture_id in test.get("fixtureRefs", [])]
                    if not matching_tests:
                        raise AssetFailure("known-wrong fixture has no bound test")
                    data_path = safe_path(profile_root, fixtures[fixture_id]["fileRef"])
                    oracle = reference_oracles[(bundle_id, fixture_id)]
                    for _ in range(3):
                        wrong_output = invoke(wrong, pd.read_csv(data_path, dtype="string"))
                        try:
                            compare_frames(wrong_output, oracle)
                        except AssetFailure:
                            contract_mismatch = True
                        else:
                            contract_mismatch = False
                        if not contract_mismatch:
                            raise AssetFailure("known-wrong implementation matches the reference output")
                        rejected_by_test = False
                        for test in matching_tests:
                            run_case = load_test(safe_path(profile_root, test["fileRef"]))

                            def checked_wrong(value: pd.DataFrame) -> pd.DataFrame:
                                return invoke(wrong, value)

                            try:
                                run_case(checked_wrong, pd.read_csv(data_path, dtype="string"))
                            except Exception:
                                rejected_by_test = True
                                wrong_test_rejection_count += 1
                        if not rejected_by_test:
                            raise AssetFailure("known-wrong implementation was not rejected by any bound test")
                        rejected_repeats += 1
                        wrong_fixture_repeat_count += 1
                report["knownWrongResults"].append({
                    "category": bundle_id.removeprefix("bundle-act-").removesuffix("-v2"),
                    "fixtureRepeatRejections": rejected_repeats,
                    "status": "PASS",
                })

        if len(distinct_wrong) < 4:
            raise AssetFailure("fewer than four distinct known-wrong implementations")

        report["counts"] = {
            "datasetFixtures": len(fixtures),
            "taskBundles": len(bundles),
            "referenceTestFixtureCases": test_case_count,
            "referenceExecutions": reference_execution_count,
            "candidateFingerprintMatches": candidate_fingerprint_match_count,
            "fullCleanExecutions": sum(len(items) for items in full_clean_runs.values()),
            "knownWrongImplementations": len(distinct_wrong),
            "knownWrongFixtureRepeatChecks": wrong_fixture_repeat_count,
            "knownWrongTestRejections": wrong_test_rejection_count,
        }
        report["v23Status"] = "PASS"
        report["status"] = "BLOCKED" if report["blockers"] else "PASS"
        code = 1 if report["blockers"] else 0
    except AssetFailure as error:
        report["classifications"].append("b_asset_defect")
        report["blockers"].append(f"AssetFailure: {error}")
        code = 1
    except Exception as error:
        report["classifications"].append("c_validator_defect")
        report["blockers"].append(f"{type(error).__name__}: {error}")
        code = 1

    report["classifications"] = sorted(set(report["classifications"]))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return code


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile-root", type=Path, required=True)
    parser.add_argument("--manifest-audit", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    return run(args.profile_root.resolve(), args.manifest_audit.resolve(), args.output.resolve())


if __name__ == "__main__":
    raise SystemExit(main())
