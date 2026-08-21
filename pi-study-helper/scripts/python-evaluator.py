"""Single-stage Python harness for the W3 trusted-local Node evaluator."""

from __future__ import annotations

import argparse
import ast
import json
import runpy
import sys
import traceback
from pathlib import Path

def write_result(path: Path, value: dict) -> None:
    encoded = json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    path.write_text(encoded, encoding="utf-8", newline="\n")


def fail(path: Path, code: str, category: str) -> int:
    write_result(path, {"status": "failed", "category": category, "errorCode": code})
    return 0


def mark_state(path: Path | None, phase: str) -> None:
    if path is not None:
        write_result(path, {"phase": phase})


def validate_source(source: str, allowed_libraries: set[str]) -> str | None:
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return "syntax_error"
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            if any(item.name.split(".")[0] not in allowed_libraries for item in node.names):
                return "disallowed_import"
        elif isinstance(node, ast.ImportFrom):
            if (node.module or "").split(".")[0] not in allowed_libraries:
                return "disallowed_import"
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "__import__":
            return "disallowed_import"
    return None


def traceback_has_submission(error: BaseException, submission_path: Path) -> bool:
    target = str(submission_path.resolve()).casefold()
    return any(str(frame.filename).casefold() == target for frame in traceback.extract_tb(error.__traceback__))


def load_submission(submission_path: Path, entry_point: str, result_path: Path, allowed: set[str]):
    try:
        source = submission_path.read_text(encoding="utf-8")
    except (OSError, UnicodeError):
        return None, fail(result_path, "submission_contract_error", "learner")
    validation_error = validate_source(source, allowed)
    if validation_error is not None:
        return None, fail(result_path, validation_error, "learner")
    try:
        namespace = runpy.run_path(str(submission_path))
    except SyntaxError:
        return None, fail(result_path, "syntax_error", "learner")
    except BaseException:
        return None, fail(result_path, "runtime_error", "learner")
    candidate = namespace.get(entry_point)
    if not callable(candidate):
        return None, fail(result_path, "submission_contract_error", "learner")
    return candidate, None


def run_tests(args, candidate, result_path: Path, state_path: Path | None) -> int:
    try:
        import pandas as pd
    except (ImportError, ModuleNotFoundError):
        return fail(result_path, "dependency_missing", "evaluator")
    try:
        tests = json.loads(Path(args.test_manifest).read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return fail(result_path, "result_protocol_invalid", "evaluator")
    results = []
    def candidate_proxy(*call_args, **call_kwargs):
        mark_state(state_path, "candidate_running")
        try:
            return candidate(*call_args, **call_kwargs)
        finally:
            mark_state(state_path, "harness_running")

    for test in tests:
        mark_state(state_path, "harness_running")
        test_path = Path(test["filePath"])
        try:
            test_namespace: dict = {}
            source = test_path.read_text(encoding="utf-8")
            exec(compile(source, str(test_path), "exec"), test_namespace)
            run_case = test_namespace.get("run_case")
            if not callable(run_case):
                return fail(result_path, "test_asset_invalid", "evaluator")
        except BaseException:
            return fail(result_path, "test_asset_invalid", "evaluator")

        passed = True
        for fixture_path in test["fixturePaths"]:
            try:
                # Fixtures are raw dirty input: every column must reach the
                # candidate as text so that missing keys stay pd.NA instead of
                # becoming float NaN. Type conversion is the learner's job under
                # the frozen seven-column contract, never the loader's.
                frame = pd.read_csv(fixture_path, dtype="string")
                run_case(candidate_proxy, frame)
            except BaseException as error:
                if traceback_has_submission(error, Path(args.submission)):
                    return fail(result_path, "runtime_error", "learner")
                if isinstance(error, (AssertionError, KeyError, IndexError, ValueError, AttributeError)):
                    # Frozen healthy tests use assertions and deterministic
                    # result lookups as their contract checks. RuntimeError,
                    # TypeError, and loader failures remain evaluator faults.
                    passed = False
                else:
                    return fail(result_path, "test_asset_invalid", "evaluator")
        results.append({
            "testId": test["testId"],
            "dimensionId": test["dimensionId"],
            "blocking": test["blocking"],
            "passed": passed,
        })

    write_result(result_path, {"status": "ok", "tests": results})
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage", choices=("user_code", "public_tests", "hidden_tests"), required=True)
    parser.add_argument("--submission", required=True)
    parser.add_argument("--entry-point", required=True)
    parser.add_argument("--allowed-library", action="append", default=[])
    parser.add_argument("--test-manifest")
    parser.add_argument("--state")
    parser.add_argument("--result", required=True)
    args = parser.parse_args()
    sys.argv = [args.submission]

    result_path = Path(args.result)
    candidate, exit_code = load_submission(
        Path(args.submission),
        args.entry_point,
        result_path,
        set(args.allowed_library),
    )
    if exit_code is not None:
        return exit_code
    if args.stage == "user_code":
        write_result(result_path, {
            "status": "ok",
            "tests": [],
        })
        return 0
    if not args.test_manifest:
        return fail(result_path, "result_protocol_invalid", "evaluator")
    return run_tests(args, candidate, result_path, Path(args.state) if args.state else None)


if __name__ == "__main__":
    sys.exit(main())
