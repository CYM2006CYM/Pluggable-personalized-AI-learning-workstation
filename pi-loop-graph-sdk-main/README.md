# Loop Graph SDK

[中文说明](README-zh.md) | [Roadmap](ROADMAP.md)

> ⚠️ **Experimental**: Loop Graph SDK is in early-stage development (0.2.0). Expect instability, rough edges, and breaking API changes. Some features are incomplete. Feedback and testing are welcome, but do not rely on this in production.

Turn a complex agent task into a visible, traceable, and auditable workflow graph.

Loop Graph SDK is designed for Pi applications that require long-running, multi-phase execution with reviewable results. It lets you express "what to do first, what to check, where to go back on failure, and what to deliver at the end" as a graph, while preserving the agent's freedom to explore and reason.

It is especially suited for:

- Multi-phase workflows like code organization, generation, review, revision, and re-review;
- Processes that alternate between code execution and agent reasoning;
- Agent applications that need tool allowlists, automatic validation, and failure boundaries;
- Tasks that reuse sub-flows without letting context and state leak between them;
- Systems where you need to answer "what did the model see, which path did it take, and why was something accepted or rejected" after the run.

## Why Loop Graphs over Skills?

Skills give the agent natural-language instructions on "how to do it." But skills have inherent limitations:

- **No type boundaries**: inputs and outputs are described in prose. The agent can improvise — results are unreliable;
- **No routing control**: a skill runs and ends. You can't express "check the result, if it fails go back and fix it";
- **No monitoring or audit**: you can't see what decisions the model made inside the skill, only the final output;
- **No mechanism constraints**: you can't inject automatic validation, rejection policies, or context compaction at critical points.

Loop Graphs upgrade your workflow from "a prompt" to "a typed, routable, monitorable, auditable graph":

- Every stage has explicit **input/output schemas** (TypeBox) — results that don't match the contract are auto-rejected;
- Stages are connected by **explicit routes** — which path to take on success, where to go back on failure, what conditions trigger what actions, all in the graph;
- Built-in **Mechanism system** lets you inject automatic validation, retry policies, and failure handling at completion points;
- Full **Recording/Replay** — every run can be traced back: "what did the model see, what decision did it make, why was it accepted or rejected."

In short: **Skills have instructions. Loop Graphs have instructions + boundaries + monitoring + audit.**

## Let AI Write Your Loop Graphs

Loop Graph SDK provides a complete TypeScript API with rich type definitions. **Pi can directly write your graph definition code.** Just describe your workflow — "review the code first, fix any issues found, review again, submit when it passes" — and Pi will generate the corresponding `defineGraph` code.

The SDK's documentation is designed to be AI-friendly: detailed JSDoc, clean type hierarchies, rich working examples, and a complete doc tree covering concepts, guides, and reference. Feed the `docs/` directory to Pi and it can understand the entire system to help you write loop graphs efficiently.

## Installation

Loop Graph SDK is primarily a library imported by other projects. Business projects install the package and create their own graphs and Extensions from the root entry point. The bundled `/extension` entry is for debugging and demos only — business code should create its own Extension instance.

```bash
# Local development: install from a sibling workspace
npm install ../pi-loop-graph-extension-public

# Pre-publish verification: generate a tarball, then install in a business project
npm pack
npm install ./pi-loop-graph-sdk-0.2.0.tgz

# Git dependency: use the actual repo URL with a fixed tag/commit
npm install git+https://github.com/<owner>/<repo>.git#<tag-or-commit>
```

Once installed, use the stable root entry:

```ts
import {
  agentNode,
  codeNode,
  createGraphHost,
  createLoopGraphExtension,
  defineGraph,
  graphNode,
} from "pi-loop-graph-sdk";
```

Replay and advanced capabilities use separate entry points:

```ts
import { parseReplay, exportReplayHtml } from "pi-loop-graph-sdk/replay";
import { GraphRuntime, validateGraph } from "pi-loop-graph-sdk/advanced";
```

> Install via npm registry or Git:
>
> ```bash
> pi install npm:pi-loop-graph-sdk@0.2.0
> # or
> pi install git:github.com/0liveiraaa/pi-loop-graph-sdk@v0.2.0
> ```
>
> Local directory, tarball, and Git dependency installs also work.

## Quick Start

### 1. A minimal code-only graph

This graph has a single code phase. No model authentication is needed — it's a good way to confirm how graphs, phases, routes, and results work.

```ts
import {
  Type,
  codeNode,
  createGraphHost,
  defineGraph,
  entry,
  finish,
  firstMatch,
} from "pi-loop-graph-sdk";

const Input = Type.Object({ name: Type.String() });
const Output = Type.Object({ message: Type.String() });

const helloGraph = defineGraph({
  id: "hello",
  version: "1",
  goal: "Generate a greeting",
  input: Input,
  output: Output,
  context: {
    background: { select: "all" },
  },
  entries: [entry("main", { to: "greet" })],
  stages: {
    greet: {
      node: codeNode({
        subGoal: "Generate greeting",
        input: Input,
        output: Output,
        execute: ({ input, complete }) =>
          complete({ message: `Hello, ${input.name}` }),
      }),
      route: firstMatch({
        done: finish({
          output: ({ completion }) => completion.result,
        }),
      }),
    },
  },
});

const host = createGraphHost({ recording: "off" });

try {
  const result = await host.execute(helloGraph, { name: "World" });

  if (result.status === "completed") {
    console.log(result.output.message);
  } else {
    console.error(result.failure.code, result.failure.message);
  }
} finally {
  await host.dispose();
}
```

Key relationships:

- `defineGraph` describes the entire task graph;
- `entry` declares where execution starts;
- `codeNode` defines a code phase;
- `firstMatch` and `finish` define routing and termination;
- `createGraphHost` provides an execution channel with a manageable lifecycle.

### 2. From code phase to agent phase

When a phase needs model reasoning, swap `codeNode` for `agentNode`. Input, output, tools, and skills remain part of the graph definition:

```ts
import {
  Type,
  agentNode,
  skillRef,
  toolSet,
} from "pi-loop-graph-sdk";

const DraftInput = Type.Object({ topic: Type.String() });
const DraftOutput = Type.Object({ answer: Type.String() });

const writeDraft = agentNode({
  subGoal: "Write a concise answer for the topic",
  input: DraftInput,
  output: DraftOutput,
  prompt: "Complete the current phase and submit a structured result matching the output contract.",
  tools: toolSet("read"),
  skills: [skillRef("answer-writing", "1")],
  context: {
    focus: { select: "all" },
  },
});
```

The agent must submit results via the protected completion tool:

```text
__graph_complete__({ result })
```

Only `{ result }` is accepted. `status`, `reportedStatus`, and other extra fields are not part of the model protocol and will be rejected. Acceptance, rejection, and failure are decided by the SDK based on output contract, validators, mechanisms, and routing rules — not by the model self-reporting status.

### 3. Using as a Pi Extension

Business Extensions create their own instance, register graphs, and decide how to expose them:

```ts
import {
  createLoopGraphExtension,
  graphRef,
} from "pi-loop-graph-sdk";
import { helloGraph } from "./hello-graph.js";

export default function setup(pi) {
  const loop = createLoopGraphExtension(pi);

  loop.registerGraph(helloGraph);
  loop.exposeGraph(graphRef("hello", "1"), {
    kind: "command",
    name: "hello",
    description: "Generate a greeting",
    parseInput: (args) => ({ name: args.trim() || "World" }),
  });
}
```

Registration and exposure are separate actions: a graph can be registered once and exposed as a command or tool as needed. Exposed entries run in an isolated Pi Session by default. Only set `execution: "current-session"` when sharing the caller's session state is intentional.

### 4. Handling results, cancellation, and lifecycle

Every execution returns a `GraphRunResult`:

- `completed`: provides `output` that has passed output schema validation;
- `failed`: provides a structured `failure` with error code, phase, message, and whether it's retryable;
- `cancelled`: provides the cancellation reason.

A single Host allows only one Root Run at a time. Concurrent Root Runs should use independent Hosts. External `AbortSignal` propagates to the active execution; `dispose()` waits for the active run to clean up before releasing resources.

### 5. Recording, Replay, and Resume

The Host defaults to `replay` recording, writing run data to `.loop-graph/runs/{rootRunId}`. You can also choose per-run: `off`, `events`, `replay`, or `forensic`:

```ts
const result = await host.execute(graph, input, {
  recording: "replay",
  recordingRequired: true,
});

console.log(result.replay.status, result.replay.location);
```

Offline replay reading and HTML export come from the dedicated entry point:

```ts
import {
  exportReplayHtml,
  parseReplay,
} from "pi-loop-graph-sdk/replay";

const model = parseReplay(replayJsonText);
const html = exportReplayHtml(model);
```

Currently, checkpoint/resume supports reliable single-layer Root recovery at phase boundaries. Nested `call`, `compose`, and `delegate` continuation recovery is not yet implemented; encountering such checkpoints returns `resume-incompatible` rather than incorrectly applying child-graph state to the parent.

### 6. Choosing the right entry point

For everyday business code, use the root entry:

```ts
import {
  agentNode,
  codeNode,
  createGraphHost,
  createLoopGraphExtension,
  defineGraph,
  graphNode,
} from "pi-loop-graph-sdk";
```

For low-level graph runtime, validators, routers, or advanced isolated Hosts:

```ts
import {
  GraphRuntime,
  selectEdge,
  validateGraph,
} from "pi-loop-graph-sdk/advanced";
```

For recording, replay, and checkpoint types:

```ts
import {
  FileRunStore,
  decodeCheckpoint,
  parseReplay,
} from "pi-loop-graph-sdk/replay";
```

The legacy global `registerGraph`, `initRegistry`, `findEntry`, and `createAgentExecute` are not part of the 0.2 public API.

## Four Core Concepts

Once you've completed your first run, these four concepts explain what the SDK solves. Think of it as "an agent workflow engine with function-call boundaries and full work recording" — no need to understand the internal runtime code.

### 1. Loop Graphs: draw the task process

A graph consists of entries, stages, and routes. After each stage completes, routing decides where to go next: continue, return to a previous stage, or finish and deliver the result.

A model can go through many rounds of reasoning and tool calls within a single stage; those details are the stage's internal work. The graph only expresses cross-stage business flow, so you can see how the task progresses at a glance without drowning in a long conversation transcript.

### 2. Context Frame Stack: remember work like a call stack

Cross-stage information doesn't scatter across global variables — it enters an ordered context frame stack:

```text
Task background
  └─ Working memory left after Stage A completes
      └─ Working memory left after Stage B completes
          └─ Current stage workspace
```

When a stage finishes, the flow only folds what the next stages actually need into a single frame:

- Subsequent agents see useful working memory, not all prior raw conversations;
- Each route decides "what this completion should leave behind" — state transitions aren't hidden in node side effects;
- `call` working memory is isolated and destroyed when the sub-graph ends; `compose` lets sub-graph frames remain visible to subsequent parent-graph nodes.

The frame stack and the full log are separate things: the frame stack serves the next step of work; the log serves later audit and review.

### 3. Three invocation boundaries: like three kinds of function calls

Sub-graphs can be invoked by another stage like functions, but you explicitly choose how much working context they share with the caller:

| Boundary     | Think of it as                                                    | Best for                                                           |
| ------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| `call`     | Call a function with its own workspace, return result             | Reusing complete sub-flows like review, extraction, classification |
| `compose`  | Inline a complex function's steps into the current function       | Sub-flows that need to read and write the parent's working memory  |
| `delegate` | Hand off to an independent worker, isolated session and resources | Long tasks, risky tasks, or work needing an independent lifecycle  |

All three boundaries express sequential invocation — none implies automatic parallelism.

### 4. Complete logging system: reconstruct the process after the run

The SDK's recording is not a simple one-line "success/failure" log. It can record:

- Graph, stage, invocation boundary, and node enter/exit;
- Agent execution, model turns, tool calls, and tool results;
- Completion submission, validation, acceptance or rejection;
- Context snapshots, compaction, expansion mechanisms, and recovery points;
- Large result file references and safe, sanitized summaries.

Recording can be set to off, events, replay, or forensic mode. Replays can be parsed into a structured model or exported as HTML reports to answer "what did the model see" and "why did the system make this decision". Full audit trails never crowd the next stage's working context.

## Current Limitations

- A graph run follows a single explicit path; no automatic fork/join parallel scheduling;
- Multi-agent communication is an independent research direction, not a current public capability;
- `delegate` is an isolated execution boundary, not parallelism;
- Real LLM tests require valid authentication, network access, and model responses; such tests are skipped by default;

Debug log files are not written by default. `debug: true` only exists on the legacy compatibility/characterization path and is not a public configuration of the current 0.2 root entry. Use recording/replay for formal auditing.

## Verification

Run in the repository:

```bash
npm run typecheck
npm test
npm run test:package-consumer
npm pack --dry-run --json
git diff --check
```

## Documentation Index

### Getting Started

- [10-Minute Quick Start](docs/getting-started.md)
- [0.1 → 0.2 Migration Guide](docs/migration-0.1-to-0.2.md)

### Understanding the System

- [Core Concepts Index](docs/concepts/README.md)
- [Graph Model](docs/concepts/graph-model.md)
- [Context & State](docs/concepts/context-and-state.md)
- [Sub-graph Boundaries](docs/concepts/subgraph-boundaries.md)
- [Mechanisms](docs/concepts/mechanisms.md)

### How-To Guides

- [Guides Index](docs/guides/README.md)
- [Building Loops & Conditional Routes](docs/guides/build-a-loop.md)
- [Mixing Code & Agent](docs/guides/mix-code-and-agent.md)
- [Calling Sub-graphs](docs/guides/call-subgraphs.md)
- [Control Tools](docs/guides/control-tools.md)
- [Customizing Context](docs/guides/customize-context.md)
- [Observability](docs/guides/observability.md)

### Reference

- [API Reference Index](docs/reference/README.md)
- [Configuration](docs/reference/configuration.md)
- [Lifecycle](docs/reference/lifecycle.md)
- [Errors & Limits](docs/reference/errors-and-limits.md)

### Maintaining the SDK

- [Core Design](docs/design/core-design.md)
- [Internals Index](docs/internals/README.md)
- [ADRs](docs/adr/)

### Research

- [Research Documents](docs/research/README.md)

### Roadmap

- [Roadmap](ROADMAP.md)
