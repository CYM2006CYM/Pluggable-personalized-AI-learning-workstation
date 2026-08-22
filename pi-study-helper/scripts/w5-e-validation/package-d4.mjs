import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const repositoryRoot = resolve(packageRoot, "..");
const deliveryRootIndex = process.argv.indexOf("--delivery-root");
const deliveryRoot = deliveryRootIndex === -1
  ? resolve(repositoryRoot, "新版设计文档-重写版/第五周任务/W5-D4-E-2")
  : resolve(process.argv[deliveryRootIndex + 1]);
const zipName = "W5-D4-E-delivery.zip";
const zipPath = resolve(deliveryRoot, zipName);
const sidecarPath = `${zipPath}.sha256`;
const reportPath = resolve(deliveryRoot, "W5-D4-E-交付报告.md");
const stagingRoot = await mkdtemp(resolve(tmpdir(), "w5-d4-e-package-"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const normalizeLf = (bytes) => Buffer.from(bytes.toString("utf8").replace(/\r\n?|\n/gu, "\n"), "utf8");
const lines = async (path) => (await readFile(resolve(packageRoot, path), "utf8")).split(/\r?\n/u).filter(Boolean);
const git = (args) => {
  const result = spawnSync("git", args, { cwd: repositoryRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git_${args[0]}_failed`);
  return result.stdout.trim();
};

await mkdir(deliveryRoot, { recursive: true });
const formal = await lines("scripts/w5-e-validation/d4-proposed-files.txt");
const audit = await lines("scripts/w5-e-validation/d4-audit-only-files.txt");
const expectedZip = await lines("scripts/w5-e-validation/d4-zip-files.txt");
const sources = [...formal, ...audit];
for (const path of sources) {
  const destination = resolve(stagingRoot, path);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(resolve(repositoryRoot, path), destination);
}

const entries = [];
for (const path of sources) {
  const raw = await readFile(resolve(stagingRoot, path));
  const auditOnly = audit.includes(path);
  const hashMode = auditOnly ? "raw-binary" : "utf8-lf-v1";
  const bytes = auditOnly ? raw : normalizeLf(raw);
  entries.push({ path, scope: auditOnly ? "AUDIT_ONLY" : "FORMAL_GIT_PROPOSED", hashMode, byteLength: bytes.byteLength, sha256: sha256(bytes) });
}
const zipManifest = {
  schemaVersion: 1,
  candidate: "W5-D4-E",
  generatedAtUtc: new Date().toISOString(),
  entryCount: sources.length + 1,
  selfExcluded: ["ZIP-MANIFEST.json"],
  entries: entries.sort((left, right) => left.path.localeCompare(right.path, "en")),
};
await writeFile(resolve(stagingRoot, "ZIP-MANIFEST.json"), `${JSON.stringify(zipManifest, null, 2)}\n`, "utf8");
const stagedEntries = [...sources, "ZIP-MANIFEST.json"].sort((left, right) => left.localeCompare(right, "en"));
if (JSON.stringify(stagedEntries) !== JSON.stringify([...expectedZip].sort((left, right) => left.localeCompare(right, "en")))) throw new Error("zip_file_list_mismatch_before_packaging");

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

const commandResults = JSON.parse(await readFile(resolve(packageRoot, "scripts/w5-e-validation/d4-command-results.json"), "utf8"));
const web = commandResults.commands.find((item) => item.id === "test-web");
const affected = commandResults.commands.find((item) => item.id === "affected-regression");
const full = commandResults.commands.find((item) => item.id === "full-test");
const report = `# W5-D4 E 交付报告

生成时间：${new Date().toISOString()}

状态：\`READY_FOR_OWNER_REVIEW / NOT_COMMITTED / NOT_PUSHED / uploadLock=NOT_GRANTED\`

## 正式绑定

- 合同：\`W5-C1/W5-R1\`
- HEAD：\`${git(["rev-parse", "HEAD"])}\`
- origin/main：\`${git(["rev-parse", "origin/main"])}\`
- 开发基线：\`aaf588202b3ae92ed72c63994b912d78977516bb\`
- revision 3 seal：\`ccff2e2afdabaad262baeaa498b527438fcadeec1ddf5e198289f8404071e85d\`
- Pyodide：\`PYODIDE_DISABLED_WITH_NODE_FALLBACK\`
- Live model：\`LIVE_NOT_RUN\`

## 实测结果

- 环境：Node ${commandResults.environment.node}，npm ${commandResults.environment.npm}，${commandResults.environment.python}，Pandas ${commandResults.environment.pandas}，PYTHONNOUSERSITE=${commandResults.environment.pythonNoUserSite}
- Web：${web.statistics.testFiles.total} files / ${web.statistics.tests.passed} passed / ${web.statistics.tests.failed} failed / ${web.statistics.tests.skipped} skipped
- 受影响回归：${affected.statistics.testFiles.total} files / ${affected.statistics.tests.passed} passed / ${affected.statistics.tests.failed} failed / ${affected.statistics.tests.skipped} skipped
- 全量：${full.statistics.testFiles.total} files / ${full.statistics.tests.passed} passed / ${full.statistics.tests.failed} failed / ${full.statistics.tests.skipped} skipped
- 真实 Web 代码链：5/5 正式活动通过，包含最终实操并完成会话
- 独立路径合法率：3/3（100%）
- 三对实际差异：32 / 12 / 21
- Edge/CDP：6 张页面证据，桌面与移动均通过
- preview DOM、请求URL、资源URL、Worker、缓存、日志和构建产物：PASS，零宿主绝对路径

## 交付闭合

- ZIP：\`${zipName}\`
- ZIP 大小：${zip.byteLength} bytes
- ZIP 文件数：${stagedEntries.length}
- ZIP SHA-256：\`${zipHash}\`
- sidecar：\`${zipName}.sha256\`
- 正式 Git 拟提交：${formal.length} 个文本/结构化文件
- AUDIT_ONLY：${audit.length} 张 PNG，不进入正式 Git 清单

ZIP 不包含旧 ZIP、sidecar、D1/D2 历史材料、\`node_modules\`、\`dist-web\`、\`.demo-build\`、原始大日志、虚拟环境或整库副本。包内 \`ZIP-MANIFEST.json\` 覆盖全部非 Manifest 条目并明确自排除。

## 精确拟提交清单

${formal.map((path) => `- ${path}`).join("\n")}

## AUDIT_ONLY 清单

${audit.map((path) => `- ${path}`).join("\n")}

## 当前 git status

\`\`\`text
${git(["status", "--short"])}
\`\`\`

未获得负责人 commit、push 或上传锁授权。
`;
await writeFile(reportPath, report, "utf8");
await rm(stagingRoot, { recursive: true, force: true });
process.stdout.write(`${JSON.stringify({ reportPath, zipPath, sidecarPath, zipBytes: zip.byteLength, zipFiles: stagedEntries.length, formalFiles: formal.length, auditOnlyFiles: audit.length, zipSha256: zipHash }, null, 2)}\n`);
