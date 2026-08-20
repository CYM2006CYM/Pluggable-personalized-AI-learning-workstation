import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const repositoryRoot = resolve(packageRoot, "..");
const deliveryRoot = resolve(repositoryRoot, "..", "W5-D2");
const zipName = "W5-D2-E-R2-delivery.zip";
const zipPath = resolve(deliveryRoot, zipName);
const sidecarPath = `${zipPath}.sha256`;
const reportPath = resolve(deliveryRoot, "W5-D2-E-R2-交付报告.md");
const stagingRoot = await mkdtemp(resolve(tmpdir(), "w5-d2-e-r2-package-"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const lines = async (path) => (await readFile(resolve(packageRoot, path), "utf8")).split(/\r?\n/u).filter(Boolean);
const command = (args) => {
  const result = spawnSync("git", args, { cwd: repositoryRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git_${args[0]}_failed`);
  return result.stdout.trim();
};

await mkdir(deliveryRoot, { recursive: true });
const formal = await lines("scripts/w5-e-validation/d2-proposed-files.txt");
const audit = await lines("scripts/w5-e-validation/d2-audit-only-files.txt");
const expectedZip = await lines("scripts/w5-e-validation/d2-zip-files.txt");
const sources = [...formal, ...audit];
for (const path of sources) {
  const destination = resolve(stagingRoot, path);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(resolve(repositoryRoot, path), destination);
}

const manifestFiles = [];
for (const path of sources) {
  const value = await readFile(resolve(stagingRoot, path));
  manifestFiles.push({ path, bytes: value.byteLength, sha256: sha256(value), scope: audit.includes(path) ? "AUDIT_ONLY" : "FORMAL_GIT_PROPOSED" });
}
const zipManifest = {
  schemaVersion: 1,
  candidate: "W5-D2-E-R2",
  generatedAtUtc: new Date().toISOString(),
  selfExcluded: ["ZIP-MANIFEST.json"],
  files: manifestFiles.sort((left, right) => left.path.localeCompare(right.path)),
};
await writeFile(resolve(stagingRoot, "ZIP-MANIFEST.json"), `${JSON.stringify(zipManifest, null, 2)}\n`, "utf8");
const stagedEntries = [...sources, "ZIP-MANIFEST.json"].sort();
if (JSON.stringify(stagedEntries) !== JSON.stringify([...expectedZip].sort())) throw new Error("zip_file_list_mismatch_before_packaging");

const archiveCommand = ["-NoProfile", "-Command", `Compress-Archive -Path '${stagingRoot.replaceAll("'", "''")}\\*' -DestinationPath '${zipPath.replaceAll("'", "''")}' -CompressionLevel Optimal -Force`];
let archive;
for (const executable of ["pwsh", "powershell"]) {
  archive = spawnSync(executable, archiveCommand, { encoding: "utf8", timeout: 120_000 });
  if (archive.error?.code !== "ENOENT") break;
}
if (archive?.status !== 0) throw new Error(`compress_archive_failed:${archive?.error?.message ?? archive?.stderr ?? "shell_unavailable"}`);
const zip = await readFile(zipPath);
const zipHash = sha256(zip);
await writeFile(sidecarPath, `${zipHash}  ${zipName}\n`, "utf8");

const commands = JSON.parse(await readFile(resolve(packageRoot, "scripts/w5-e-validation/d2-command-results.json"), "utf8"));
const web = commands.commands.find((item) => item.id === "test-web");
const full = commands.commands.find((item) => item.id === "full-test");
const runtime = commands.commands.find((item) => item.id === "runtime-evidence-tests");
const capture = commands.commands.find((item) => item.id === "browser-capture");
const gitStatus = command(["status", "--short"]);
const report = `# W5-D2-E R2 交付报告

生成时间：${new Date().toISOString()}

状态：\`NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED\`

## 基线与范围

- 合同：W5-C1 / W5-R1
- W5_START_COMMIT：\`4e316822d343d90bdf295f37b7aaaa0131890501\`
- HEAD：\`${command(["rev-parse", "HEAD"])}\`
- origin/main：\`${command(["rev-parse", "origin/main"])}\`
- A-D1：\`0fd1f45386682a3859d8d9f6b37904b47ae98c33\`
- C-D1：\`677f54c609ef3bfbe78ff6d37f6b432e9c68ff4d\`
- A-D2：\`127a71cce4a8423327fb5ce75d31294252b92a0b\`
- 被审计旧 ZIP：\`40ea7e52cef617fe1dc60771ae9d243e03db30e20165bc94e7956ff86f5f04ea\`

本轮只整改证据、打包和拟提交范围。未重做 Web 实现，未执行 D3/D4，未修改公共 DTO、Facade、HTTP 服务端、Profile、seal、gold、SDK、依赖或锁文件。

## 实测结果

- 环境：Node ${commands.environment.node}；npm ${commands.environment.npm}；${commands.environment.python}；Pandas ${commands.environment.pandas}；PYTHONNOUSERSITE=${commands.environment.pythonNoUserSite}
- Web：${web.statistics.testFiles.total} files / ${web.statistics.tests.passed} passed / ${web.statistics.tests.failed} failed / ${web.statistics.tests.skipped} skipped
- 全量：${full.statistics.testFiles.total} files / ${full.statistics.tests.passed} passed / ${full.statistics.tests.failed} failed / ${full.statistics.tests.skipped} skipped
- 运行期专项：${runtime.statistics.testFiles.total} file / ${runtime.statistics.tests.passed} passed；CDP 捕获：${capture.status}
- 命令总状态：${commands.overallStatus}
- 机器一致性标记：\`WEB_TESTS=${web.statistics.tests.passed}/${web.statistics.tests.failed}/${web.statistics.tests.skipped}\`；\`FULL_TESTS=${full.statistics.tests.passed}/${full.statistics.tests.failed}/${full.statistics.tests.skipped}\`

首次失败、Node 24 失败和最终复验历史保留在 \`d2-command-results.json\`。\`LIVE_MODEL=LIVE_NOT_RUN\`；\`PYODIDE_CANDIDATE_UNAVAILABLE\`；D3/D4 未执行。

## 交付闭合

- ZIP：\`${zipName}\`
- ZIP 大小：${zip.byteLength} bytes
- ZIP 文件数：${stagedEntries.length}
- ZIP SHA-256：\`${zipHash}\`
- sidecar：\`${zipName}.sha256\`
- 正式 Git 拟提交：${formal.length} 个文本/结构化文件
- AUDIT_ONLY：${audit.length} 张本轮 PNG；不进入正式 Git 清单

ZIP 不含旧 ZIP、旧 sidecar、D1 历史准备材料、缓存、node_modules、dist-web、原始大日志、虚拟环境或整库副本。包内 \`ZIP-MANIFEST.json\` 覆盖全部非 Manifest 条目并明确自排除；\`d2-zip-files.txt\` 覆盖全部 ZIP 条目。

## 正式 Git 拟提交清单

${formal.map((path) => `- ${path}`).join("\n")}

## AUDIT_ONLY 清单

${audit.map((path) => `- ${path}`).join("\n")}

## 当前 git status

\`\`\`text
${gitStatus}
\`\`\`

未获得负责人明确授权，不执行 commit、push、强推或申请上传锁。
`;
await writeFile(reportPath, report, "utf8");
await rm(stagingRoot, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify({ reportPath, zipPath, sidecarPath, zipBytes: zip.byteLength, zipFiles: stagedEntries.length, zipSha256: zipHash }, null, 2)}\n`);
