from __future__ import annotations

import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

import bind_formal_commit as binding


class FormalBindingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.report = self.root / "d4-report.md"
        self.report.write_text("D4 report\n", encoding="utf-8", newline="\n")
        self.output = self.root / "binding.json"
        self.summary = b'{"status":"PASS"}\n'
        paths = [f"assets/item-{index:02d}.json" for index in range(66)]
        paths.append("evaluation/personas/final-60.jsonl")
        paths.sort(key=lambda value: value.encode("utf-8"))
        self.contents = {path: (path + "\n").encode("utf-8") for path in paths}
        self.entries = [
            {
                "path": path,
                "hashMode": "normalized-text",
                "byteLength": len(self.contents[path]),
                "sha256": binding.digest(self.contents[path]),
            }
            for path in paths
        ]
        final_hash = next(item["sha256"] for item in self.entries if item["path"] == "evaluation/personas/final-60.jsonl")
        self.manifest = {
            "entries": self.entries,
            "assetTreeSha256": binding.asset_tree(self.entries),
            "final60Sha256": final_hash,
        }

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def run_binding(self, *, commit: str = binding.EXPECTED_COMMIT, contents: dict[str, bytes] | None = None, report_hash: str | None = None, final_hash: str | None = None, tree_hash: str | None = None) -> tuple[int, dict]:
        manifest_data = json.dumps(self.manifest, separators=(",", ":")).encode("utf-8")
        manifest_hash = binding.digest(binding.jcs(self.manifest).encode("utf-8"))
        summary_hash = binding.node_jcs_sha256(self.summary)
        expected_report = report_hash or binding.digest(binding.normalized_text(self.report.read_bytes()))
        expected_final = final_hash or self.manifest["final60Sha256"]
        expected_tree = tree_hash or self.manifest["assetTreeSha256"]
        values = contents or self.contents

        def read_git(_repo: Path, _commit: str, path: str) -> bytes:
            if path not in values:
                raise binding.AuditFailure("commit path is missing")
            return values[path]

        with (
            mock.patch.object(binding.subprocess, "check_output", return_value=commit + "\n"),
            mock.patch.object(binding, "git_bytes", side_effect=read_git),
            mock.patch.object(binding, "EXPECTED_MANIFEST_JCS", manifest_hash),
            mock.patch.object(binding, "EXPECTED_SUMMARY_JCS", summary_hash),
            mock.patch.object(binding, "EXPECTED_D4_REPORT", expected_report),
            mock.patch.object(binding, "EXPECTED_FINAL60", expected_final),
            mock.patch.object(binding, "EXPECTED_ASSET_TREE", expected_tree),
        ):
            with redirect_stdout(io.StringIO()):
                code = binding.bind(self.root, commit, manifest_data, self.summary, self.report, self.output)
        return code, json.loads(self.output.read_text(encoding="utf-8"))

    def test_safe_path_rejects_absolute_and_traversal(self) -> None:
        for value in ("C:/x", "/x", "../x", "a\\b", "a/../b"):
            with self.assertRaises(binding.AuditFailure):
                binding.safe_path(value)

    def test_normalized_text_converts_crlf_and_cr(self) -> None:
        self.assertEqual(binding.normalized_text(b"a\r\nb\rc"), b"a\nb\nc")

    def test_normalized_text_rejects_bom(self) -> None:
        with self.assertRaises(binding.AuditFailure):
            binding.normalized_text(b"\xef\xbb\xbfx")

    def test_complete_binding_passes(self) -> None:
        code, result = self.run_binding()
        self.assertEqual(code, 0)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["counts"]["manifestEntries"], 67)

    def test_missing_file_blocks(self) -> None:
        contents = dict(self.contents)
        contents.pop(self.entries[0]["path"])
        code, result = self.run_binding(contents=contents)
        self.assertEqual(code, 1)
        self.assertIn("commit path is missing", result["blockers"][0])

    def test_content_mismatch_blocks(self) -> None:
        contents = dict(self.contents)
        original = contents[self.entries[0]["path"]]
        contents[self.entries[0]["path"]] = b"X" + original[1:]
        code, result = self.run_binding(contents=contents)
        self.assertEqual(code, 1)
        self.assertIn("file content or byteLength mismatch", result["blockers"][0])

    def test_byte_length_mismatch_blocks(self) -> None:
        self.entries[0]["byteLength"] += 1
        code, result = self.run_binding()
        self.assertEqual(code, 1)
        self.assertIn("file content or byteLength mismatch", result["blockers"][0])

    def test_commit_mismatch_blocks(self) -> None:
        code, result = self.run_binding(commit="0" * 40)
        self.assertEqual(code, 1)
        self.assertIn("formal commit identity mismatch", result["blockers"][0])

    def test_asset_tree_mismatch_blocks(self) -> None:
        code, result = self.run_binding(tree_hash="0" * 64)
        self.assertEqual(code, 1)
        self.assertIn("asset tree or final-60 mismatch", result["blockers"][0])

    def test_final60_mismatch_blocks(self) -> None:
        code, result = self.run_binding(final_hash="0" * 64)
        self.assertEqual(code, 1)
        self.assertIn("asset tree or final-60 mismatch", result["blockers"][0])

    def test_d4_report_hash_mismatch_blocks(self) -> None:
        code, result = self.run_binding(report_hash="0" * 64)
        self.assertEqual(code, 1)
        self.assertIn("D4 report hash mismatch", result["blockers"][0])


if __name__ == "__main__":
    unittest.main()
