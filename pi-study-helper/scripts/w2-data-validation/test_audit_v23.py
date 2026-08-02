from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

import pandas as pd


MODULE_PATH = Path(__file__).with_name("audit_v23.py")
SPEC = importlib.util.spec_from_file_location("audit_v23", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


class AuditV23Tests(unittest.TestCase):
    def frame(self) -> pd.DataFrame:
        return pd.DataFrame({
            "id": pd.Series(["a", "b"], dtype="string"),
            "value": pd.Series([1.0, None], dtype="Float64"),
        })

    def test_equal_frames_pass(self) -> None:
        AUDIT.compare_frames(self.frame(), self.frame().copy(deep=True))

    def test_column_order_mismatch_fails(self) -> None:
        with self.assertRaises(AUDIT.AssetFailure):
            AUDIT.compare_frames(self.frame()[["value", "id"]], self.frame())

    def test_row_order_mismatch_fails(self) -> None:
        with self.assertRaises(AUDIT.AssetFailure):
            AUDIT.compare_frames(self.frame().iloc[::-1], self.frame())

    def test_dtype_mismatch_fails(self) -> None:
        actual = self.frame()
        actual["value"] = actual["value"].astype("float64")
        with self.assertRaises(AUDIT.AssetFailure):
            AUDIT.compare_frames(actual, self.frame())

    def test_null_position_mismatch_fails(self) -> None:
        actual = self.frame()
        actual.loc[0, "value"] = None
        actual.loc[1, "value"] = 1.0
        with self.assertRaises(AUDIT.AssetFailure):
            AUDIT.compare_frames(actual, self.frame())

    def test_numeric_tolerance_passes(self) -> None:
        actual = self.frame()
        actual.loc[0, "value"] = 1.0000005
        AUDIT.compare_frames(actual, self.frame())

    def test_numeric_outside_tolerance_fails(self) -> None:
        actual = self.frame()
        actual.loc[0, "value"] = 1.1
        with self.assertRaises(AUDIT.AssetFailure):
            AUDIT.compare_frames(actual, self.frame())

    def test_invoke_rejects_input_mutation(self) -> None:
        def mutate(frame: pd.DataFrame) -> pd.DataFrame:
            frame.loc[0, "id"] = "changed"
            return frame

        with self.assertRaises(AUDIT.AssetFailure):
            AUDIT.invoke(mutate, self.frame())

    def test_fingerprint_is_deterministic(self) -> None:
        self.assertEqual(AUDIT.dataframe_fingerprint(self.frame()), AUDIT.dataframe_fingerprint(self.frame()))

    def test_opaque_fingerprint_multiset_ignores_key_order(self) -> None:
        expected = {"bundle": [("a", "a", "a"), ("b", "b", "b")]}
        observed = {"bundle": [("b", "b", "b"), ("a", "a", "a")]}
        self.assertEqual(AUDIT.verify_opaque_fingerprint_multisets(expected, observed, ["bundle"]), 6)

    def test_opaque_fingerprint_multiset_rejects_mismatch(self) -> None:
        expected = {"bundle": [("a", "a", "a")]}
        observed = {"bundle": [("b", "b", "b")]}
        with self.assertRaises(AUDIT.AssetFailure):
            AUDIT.verify_opaque_fingerprint_multisets(expected, observed, ["bundle"])


if __name__ == "__main__":
    unittest.main()
