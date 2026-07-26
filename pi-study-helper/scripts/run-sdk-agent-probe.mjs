import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dataRoot = await mkdtemp(join(tmpdir(), "pi-study-sdk-agent-"));
const extensionPath = fileURLToPath(new URL("./sdk-agent-probe-extension.ts", import.meta.url));
const piEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const piCli = join(dirname(piEntry), "cli.js");

const child = spawn(
  process.execPath,
  [
    piCli,
    "--no-extensions",
    "--no-skills",
    "--no-context-files",
    "--no-session",
    "--extension",
    extensionPath,
    "--print",
    "/study-sdk-probe",
  ],
  {
    cwd: process.cwd(),
    windowsHide: true,
    env: { ...process.env, PI_STUDY_DATA: dataRoot },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let stdout = "";
let stderr = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => { stdout += chunk; });
child.stderr.on("data", (chunk) => { stderr += chunk; });

const exit = await new Promise((resolveExit, reject) => {
  const timeout = setTimeout(() => {
    child.kill();
    reject(new Error("真实 Agent probe 在 9 分钟内未完成"));
  }, 540_000);
  child.on("error", reject);
  child.on("exit", (code, signal) => {
    clearTimeout(timeout);
    resolveExit({ code, signal });
  });
});

/**
 * SDK 0.2 用 recording/replay 取代 0.1 的 JSONL traceSink：
 * 每个 Root Run 一个目录，事件写在 `<runId>/journal.jsonl`，
 * 每行是 `{ schemaVersion, sequence, rootRunId, graphInvocationId?, nodeVisitId?, agentRunId?, event }`。
 */
async function readJournalEvents(runsRoot) {
  const runIds = await readdir(runsRoot);
  const events = [];
  for (const runId of runIds) {
    let raw;
    try {
      raw = await readFile(join(runsRoot, runId, "journal.jsonl"), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      events.push(JSON.parse(line));
    }
  }
  return events;
}

try {
  const runsRoot = join(dataRoot, "traces", "sdk-agent-probe");
  let events;
  try {
    events = await readJournalEvents(runsRoot);
    if (events.length === 0) throw new Error("journal 为空");
  } catch (error) {
    throw new Error(
      `probe 没有生成 replay journal（exit=${exit.code}, signal=${exit.signal ?? "none"}）\nstdout:\n${stdout.trim()}\nstderr:\n${stderr.trim()}`,
      { cause: error },
    );
  }

  const ofType = (type) => events.filter((envelope) => envelope.event?.type === type);
  const eventCount = (type) => ofType(type).length;
  const graphExits = ofType("graph_exited").map((envelope) => envelope.event.data);
  const rootFinishes = ofType("root_finished").map((envelope) => envelope.event.data);
  const enteredStages = ofType("node_entered").map((envelope) => envelope.event.data.stageId);
  const agentRunKey = (envelope) => `${envelope.rootRunId}:${envelope.graphInvocationId}:${envelope.nodeVisitId}:${envelope.agentRunId}`;
  const contractRuns = new Set(ofType("output_contract.prepared").map(agentRunKey));
  const acceptedRuns = new Set(ofType("completion.accepted").map(agentRunKey));
  const contractRunWithoutAccepted = [...contractRuns].filter((key) => !acceptedRuns.has(key));
  const requiredStages = ["prepare_question_context", "generate_question", "grade_answer", "discuss_question", "summarize_session", "update_learning_profile", "build_profile_fragment", "plan_profile_revision", "revise_profile_draft", "review_profile_draft"];
  const pendingRoot = join(dataRoot, "profile_families", "demo-review", "_user", "summaries", "pending");
  const batches = await readdir(pendingRoot);
  if (batches.length !== 1) throw new Error(`probe 应产生一个学习记录批次，实际为 ${batches.length}`);
  const batchRoot = join(pendingRoot, batches[0]);
  const session = JSON.parse(await readFile(join(batchRoot, "session.json"), "utf8"));
  const attempts = await readdir(join(batchRoot, "attempts"));
  const summary = await readFile(join(batchRoot, "summary.md"), "utf8").catch(() => "");
  if (
    exit.code !== 0 ||
    rootFinishes.length !== 9 ||
    rootFinishes.some((data) => data.status !== "completed") ||
    graphExits.length !== 9 ||
    graphExits.some((data) => data.status !== "completed") ||
    requiredStages.some((stageId) => !enteredStages.includes(stageId)) ||
    contractRuns.size < 9 ||
    eventCount("completion.submitted") < 9 ||
    eventCount("completion.validation_started") < 9 ||
    contractRunWithoutAccepted.length > 0 ||
    session.status !== "completed" ||
    attempts.length !== 1 ||
    summary.trim() === ""
  ) {
    throw new Error(
      `probe 未闭环：exit=${exit.code}, signal=${exit.signal ?? "none"}, rootFinishes=${JSON.stringify(rootFinishes)}, graphExits=${JSON.stringify(graphExits)}, stages=${enteredStages.join(",")}, contractRuns=${contractRuns.size}, submitted=${eventCount("completion.submitted")}, validation=${eventCount("completion.validation_started")}, accepted=${eventCount("completion.accepted")}, contractRunWithoutAccepted=${contractRunWithoutAccepted.join(",")}, session=${session.status}, attempts=${attempts.length}, summary=${summary.length}\nstdout:\n${stdout.trim()}\nstderr:\n${stderr.trim()}`,
    );
  }
  console.log(`真实 pi Agent probe 通过：${enteredStages.join(" → ")}；9 张图均 completed；输出契约 Run=${contractRuns.size}；候选提交=${eventCount("completion.submitted")}；候选接受=${eventCount("completion.accepted")}；会话=${session.status}；题目记录=${attempts.length}；总结已保存；学习画像、Profile 构建与修订候选均已生成`);
  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());
} finally {
  await rm(dataRoot, { recursive: true, force: true });
}
