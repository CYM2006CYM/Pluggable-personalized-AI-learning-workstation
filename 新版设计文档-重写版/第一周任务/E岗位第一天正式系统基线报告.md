# E岗位第一天正式系统基线报告

## 1. 报告结论

```text
E基线状态：PASS
E岗位审核建议：GO
最终门禁决定：负责人
正式上传状态：负责人已预审、上传锁已授予E、待E上传
```

岗位E已在最新公共提交上独立完成依赖安装、TypeScript检查、自动测试、Extension冒烟和完整验证。五条基线命令最终全部通过，E本机实际得到21个测试文件、117项测试全部通过。

依赖审计仍有1项高危和1项中危间接依赖告警，归类为 `SECURITY_FINDING / PENDING_OWNER_ACTION`，不计为业务测试失败，不由岗位E自行运行 `npm audit fix`。

本报告依据19号第一周总任务、20—21号公共规则、26号E岗位任务书、A/B/C/D最终清点材料和岗位E本机原始运行证据形成。报告生成时间：`2026-07-23 00:42:53 +08:00`。

---

## 2. PLAN第一天要求完成情况

| PLAN要求 | 状态 | 说明 |
|---|---|---|
| 拉取默认分支最新代码 | PASS | E执行 `git fetch origin`，HEAD与 `origin/main`一致，领先/落后为0/0 |
| 没有依赖时执行 `npm ci` | PASS_WITH_ENV_NOTE | 首次因E本机证书链失败；保持严格SSL并使用Node系统CA复验后退出码0 |
| `npm run typecheck` | PASS | E本机实际运行，退出码0 |
| `npm test` | PASS | E本机实际运行，21个测试文件、117项测试全部通过 |
| `npm run smoke:extension` | PASS | E本机实际运行，Extension成功解析并初始化 |
| `npm run verify` | PASS | E本机实际运行，完整验证链退出码0 |
| 汇总A/B/C/D现状 | PASS | 四份最终清点材料已复审并纳入本报告 |
| 记录提交、环境、仓库和日志 | PASS | 见第3—5节 |
| 区分环境失败与业务失败 | PASS | 证书问题记为环境问题；安全告警与业务测试结果分开记录 |
| 记录文件所有权和未决 `spec_gap` | PASS | 见第10节 |
| 判断下一阶段是否可以开始 | PASS | E岗位建议GO，最终决定权属于负责人 |
| 取得上传锁后上传唯一正式报告 | READY_TO_UPLOAD | 负责人已完成预审并授予上传锁，E上传前仍须确认远端无新提交 |

---

## 3. 当前Git与E环境基线

### 3.1 被测代码与仓库状态

```text
分支：main
被测代码提交：ea10ab7eadde7362537515b99df18e6047bde632
origin/main：ea10ab7eadde7362537515b99df18e6047bde632
领先/落后：0/0
工作区：干净
```

该提交由负责人恢复并上传公共仓库遗漏的TypeScript配置、Git规则和3个原有回归测试文件。报告后续上传产生的新提交属于“报告上传提交”，不得与本节的“被测代码提交”混写。

### 3.2 E本机环境

```text
记录时间：2026-07-23 00:25:51 +08:00
Git：2.51.0.windows.2
Node.js：v24.18.0
npm：11.16.0
操作系统：Windows（具体版本和系统架构：本次证据未记录）
时区：UTC+08:00
```

### 3.3 公共配置和测试文件

```text
tsconfig.json：已恢复并存在
tsconfig.test.json：已恢复并存在
.gitignore：已恢复并存在
tests目录下 *.test.ts：21个
```

以上配置不再属于活动阻塞。

---

## 4. 岗位E本机实际命令结果

以下全部为岗位E在被测提交上亲自运行的结果，不是复制负责人或C岗位的数据。

| 命令 | 开始时间 | 耗时 | 退出码 | 结果 |
|---|---|---:|---:|---|
| `npm.cmd ci`（首次） | 00:26:09.725 | 75.352秒 | 1 | `FAIL / ENVIRONMENT`，GitHub codeload证书链验证失败 |
| `npm.cmd ci`（系统CA复验） | 00:32:05.808 | 83.617秒 | 0 | PASS，新增181个包并审计182个包 |
| `npm.cmd run typecheck` | 00:34:18.202 | 4.907秒 | 0 | PASS |
| `npm.cmd test` | 00:36:04.764 | 6.594秒 | 0 | PASS，21个测试文件、117项测试全部通过 |
| `npm.cmd run smoke:extension` | 00:37:04.506 | 3.064秒 | 0 | PASS，Extension成功解析并初始化 |
| `npm.cmd run verify` | 00:37:57.385 | 16.038秒 | 0 | PASS，完整验证链通过 |

### 4.1 `verify`内部结果

`verify`依次执行并通过：

- TypeScript源代码和测试配置检查；
- 21个测试文件、117项测试；
- 15个项目Markdown文件的本地链接检查；
- Extension解析与初始化冒烟测试；
- Release检查：77个受跟踪文件，未发现私密数据或密钥。

### 4.2 测试输出编码说明

部分中文测试名称在粘贴文本中出现终端编码乱码，但Vitest最终汇总、退出码和各验证脚本结果完整明确。该显示问题不构成测试失败。

---

## 5. 环境问题、安装警告与处理记录

### 5.1 首次安装失败

首次 `npm.cmd ci` 主错误：

```text
UNABLE_TO_VERIFY_LEAF_SIGNATURE
unable to verify the first certificate
```

失败对象是从GitHub codeload下载的 `pi-loop-graph-sdk` 固定提交压缩包。同期出现若干 `EPERM` 清理警告，但不是本次失败主因。

检查结果：

```text
npm registry：https://registry.npmjs.org/
strict-ssl：true
npm proxy：未配置
npm https-proxy：未配置
HTTP_PROXY / HTTPS_PROXY：未配置
NODE_EXTRA_CA_CERTS：未配置
NODE_OPTIONS：初始未配置
```

### 5.2 安全复验方式

E没有关闭SSL严格校验，也没有修改package或锁文件。仅在当前PowerShell会话临时使用：

```powershell
$env:NODE_OPTIONS="--use-system-ca"
```

复验成功后已移除该临时环境变量。最终 `npm ci` 退出码为0，因此证书问题不再是本次基线的活动阻塞，但应作为E环境复现注意事项保留。

### 5.3 安装阶段警告

安装成功时npm提示：

- `@google/genai` 和 `protobufjs` 的安装脚本尚未纳入 `allowScripts`；
- npm报告2项依赖漏洞；
- E未运行 `npm approve-scripts`，也未运行 `npm audit fix`。

这些提示没有导致安装、typecheck、测试、smoke或verify失败。是否调整安装脚本策略和依赖版本由负责人决定。

本机原始Transcript保存在Git忽略目录 `.manual-test/e-baseline-20260723/console.txt`，只作本地复现证据，不随正式报告上传。

---

## 6. 负责人补充验证与历史跨环境证据

### 6.1 负责人补充验证

负责人在其环境中对同一公共提交完成验证：

- `npm ci`通过；
- `npm run typecheck`通过；
- 21个测试文件、117项测试全部通过；
- `npm run smoke:extension`通过；
- `npm run verify`通过。

该结果只作为独立补充证据。本报告第4节的数据均来自E本机，不以负责人结果代替E的实际运行。

### 6.2 C岗位旧提交上的历史跨环境证据

C岗位先前在提交 `92ac6d83120b5eaaf5bdfd95f2a003f468ea7003`、Node 22.19.0、npm 10.9.3环境中运行：

- `npm ci`通过；
- 测试80项中79项通过，唯一失败由当时缺少tsconfig配置导致；
- typecheck和verify被当时的公共配置缺失阻塞；
- smoke通过；
- 依赖审计发现1项high和1项moderate告警。

该证据属于旧提交历史记录。负责人已在当前提交恢复配置和测试文件，E也已在当前提交完成117项全通过，因此C的79/80不得继续作为当前基线结果。

---

## 7. A/B/C/D最终材料接收与汇总

| 岗位 | 最终材料 | 接收状态 | 纳入内容 |
|---|---|---|---|
| A | `A-day1清点3.md` | ACCEPTED | Profile v1、五个Pi命令、三个仓储、九个Graph和缺口 |
| B | `B岗位第一天清点报告-二次整改版.md` | ACCEPTED_WITH_MINOR_NOTES | Profile/来源/资产现状、Pandas v2资产缺失、冻结规则和待批准项 |
| C | `C岗位第一天清点汇报三.md` | ACCEPTED_AS_HISTORICAL_SUPPLEMENT | 旧提交跨环境结果、Python/Pandas环境和依赖安全事实 |
| D | `D组二次修改后.md` | ACCEPTED | 九个Graph、调用关系、隔离执行器、重试/降级和权限边界 |

负责人当前提交仅补充公共配置、Git规则和3个回归测试，没有推翻A/B/D已接收的静态架构事实。涉及测试数量和配置缺失的旧结论以本报告当前复验为准。

---

## 8. Profile v1、命令、仓储与Graph基线

### 8.1 Profile v1与现有fixture

当前存在 `fixtures/profiles/demo-review/`，包含：

- `profile.json`、`subject.md`、`knowledge_index.json`、`source_map.json`、`quality_report.md`；
- 6个cards文件；
- 2个chapters文件；
- 2个exam_points文件。

构建冒烟源材料位于 `fixtures/source-materials/p4-smoke/`，包含主动回忆和间隔复习两份Markdown材料。

当前不存在计划中的 `fixtures/profiles/pandas-cleaning-v2-draft/`。该资产属于后续岗位任务，不得在第1天冒充完成。

### 8.2 五个Pi命令

| 命令 | 当前入口 | 用途 |
|---|---|---|
| `/study` | `StudySessionController.run` | 章节、卡片或直接练习 |
| `/study-recover` | `recoverRunningSession` | 恢复并补总结未完成会话 |
| `/study-profile` | `LearningProfileController.run` | 更新长期学习画像候选 |
| `/study-build` | `ProfileBuildController.run` | 从受控材料构建Profile draft |
| `/study-revise` | `ProfileRevisionController.run` | 规划、修改并审核Profile draft |

### 8.3 三个现有仓储

| 仓储 | 当前职责 |
|---|---|
| `ProfileFamilyRepository` | Profile active/draft/archived生命周期、修订、启用和原子写 |
| `PrivateMemoryRepository` | 会话、Attempt、总结、学习批次和旧LearningProfile |
| `ProfileBuildJobRepository` | 构建任务、源批次、生成片段、进度和失败恢复状态 |

当前不存在正式v2 `LearningSessionRepository`。

### 8.4 九个现有Graph

```text
study_generate_question
study_grade_answer
study_discuss_question
study_summarize_session
study_update_learning_profile
study_build_profile_fragment
study_plan_profile_revision
study_revise_profile_draft
study_review_profile_draft
```

九个Graph统一由 `createStudyWalkingSkeletonGraphs()` 返回。`generateQuestion`为两节点Graph，其余八个为单节点Graph；应用层通过五个Pi入口编排调用。

### 8.5 隔离执行器

当前 `createIsolatedGraphExecutor(ctx, options, dependencies)` 的静态边界包括：

- 每次执行创建新host并在 `finally` 中释放；
- `boundary: "delegate"`；
- `defaultTools: []`；
- `rootMaxSteps = 10`；
- `agentRunTimeoutMs = 300000`；
- optional discussion最多尝试2次，失败返回 `unavailable`；
- summary最多尝试2次，仍失败则上抛。

本次117项测试和完整verify通过，为当前公共基线提供运行回归证据；不等于尚未建设的v2评测链已经完成。

---

## 9. 测试、评测环境与安全发现

### 9.1 当前测试基线

```text
测试文件：21个
测试项：117项
E本机结果：117 passed / 0 failed
verify复跑结果：117 passed / 0 failed
```

### 9.2 当前尚未建设的后续评测能力

第1天基线中尚不存在或尚未完成的v2能力包括：

- `code-evaluation-port.ts`；
- `evaluation-protocol.ts`；
- `model-execution-port.ts`；
- `review-orchestrator.ts`；
- `v2-learning-graphs.ts`；
- 正式 `EnvironmentLock`；
- Node/Python权威执行器；
- 公开/私有测试执行链；
- 结构化评测协议、输出截断、进程树终止和HTTP评测入口。

这些属于后续计划，不是当前v1基线失败。

### 9.3 依赖安全审计

| 审计 | 时间 | 耗时 | 退出码 | 结果 |
|---|---|---:|---:|---|
| `npm.cmd audit --json` | 00:40:33.195 | 5.837秒 | 1 | 1 high、1 moderate |
| `npm.cmd audit --omit=dev --json` | 00:40:39.033 | 3.647秒 | 1 | 同样的1 high、1 moderate |

安全发现：

| 编号 | 包 | 严重级别 | 类型 | 状态 |
|---|---|---|---|---|
| `SEC-DEP-01` | `brace-expansion` | HIGH | `@earendil-works/pi-coding-agent`树中的间接生产依赖，DoS风险 | `SECURITY_FINDING / PENDING_OWNER_ACTION` |
| `SEC-DEP-02` | `protobufjs` | MODERATE | 同一依赖树中的间接生产依赖，解析无限循环DoS风险 | `SECURITY_FINDING / PENDING_OWNER_ACTION` |

两项均显示存在可用修复，但岗位E没有权限自行变更公共依赖或锁文件。负责人应决定升级、接受风险或安排统一复验。

---

## 10. 文件所有权与未决事项

### 10.1 文件所有权

| 范围 | 所有者 | E允许动作 |
|---|---|---|
| v2公共类型、Facade、LearningSessionRepository | A | 读取、运行、独立审计和提交问题，不直接修改 |
| Pandas draft Profile及B资产记录 | B | 校验结构和隔离，不修改资产正文 |
| 评测端口、协议和evaluator fixture | C | 导入、运行和审计，不修改协议正文 |
| 模型端口、ReviewOrchestrator、v2 Graph和模型fixture | D | 导入、运行和审计，不修改角色合同 |
| 契约/安全测试、HTTP与safe-view fixture、审计报告 | E | E负责维护 |
| package/lock、tsconfig、扩展入口、README和公共规则文档 | 负责人 | E只能提出问题或申请变更 |

### 10.2 未决 `spec_gap` 与内容批准项

| 编号 | 事项 | 当前处理 |
|---|---|---|
| `SPEC-B-01` | `profile.json.paths`完整公共结构尚未由公共类型统一落地 | B等待A公共类型和负责人裁决，不自行扩Schema |
| `SPEC-B-02` | `primaryKnowledgePointId` 与 `knowledgePointIds` 的映射 | 不写入当前公共合同，等待负责人/A明确 |
| `CONTENT-B-01` | 六个知识点、固定活动数量、Rubric权重与0.80阈值 | 作为候选规则，批准前不得标记active |
| `ENV-FUTURE-01` | 环境锁具体数值 | 等待后续原型和压力测试，不在第1天虚构 |

---

## 11. 已解决的历史问题与当前剩余事项

### 11.1 已解决的历史问题

| 问题 | 状态 | 处理结果 |
|---|---|---|
| PowerShell阻止执行 `npm.ps1` | RESOLVED | Windows环境统一使用 `npm.cmd` |
| package与lock不同步导致 `EUSAGE` | RESOLVED | 负责人在提交 `92ac6d8` 修复锁文件 |
| 缺少 `tsconfig.json` 和 `tsconfig.test.json` | RESOLVED | 负责人在当前提交 `ea10ab7` 恢复并上传 |
| E首次GitHub证书链验证失败 | RESOLVED_FOR_CURRENT_RUN | 保持 `strict-ssl=true`，使用Node系统CA后安装通过 |
| 旧基线只有18个测试文件、C环境79/80 | SUPERSEDED | 当前E本机21个文件、117项全部通过 |

### 11.2 当前剩余事项

| 事项 | 分类 | 是否阻塞本次业务基线 | 处理方 |
|---|---|---:|---|
| 两项间接生产依赖安全告警 | SECURITY_FINDING | 否；需要负责人风险决策 | 负责人 |
| E环境复现时可能需要Node系统CA | ENVIRONMENT_NOTE | 否；本次已成功复验 | E/负责人 |
| 两个依赖安装脚本未纳入allowScripts | INSTALL_POLICY_NOTE | 否；当前五条命令均通过 | 负责人 |
| 后续v2类型、执行器、评测和网页安全边界 | PLANNED_WORK | 否；属于第2天以后任务 | A/B/C/D/E按计划 |

当前没有公共配置活动阻塞，也没有E本机业务测试失败。

---

## 12. 基线门禁与上传状态

| 门禁 | 状态 | 依据 |
|---|---|---|
| 仓库和提交可复现 | PASS | HEAD与origin/main一致、0/0、工作区干净 |
| A/B/C/D事实输入完整 | PASS | 四份最终材料已接收并复审 |
| E依赖安装 | PASS_WITH_ENV_NOTE | 严格SSL下使用系统CA安装成功 |
| E TypeScript检查 | PASS | 退出码0 |
| E自动测试 | PASS | 21个文件、117项全部通过 |
| E Extension冒烟 | PASS | 解析并初始化成功 |
| E完整verify | PASS | 退出码0，全部内部阶段通过 |
| 安全发现 | PENDING_OWNER_ACTION | 1 high、1 moderate间接生产依赖告警 |
| E岗位审核建议 | GO | 当前公共基线满足进入下一阶段的技术条件 |
| 最终门禁决定 | 负责人 | E不得自行宣布正式进入第2天 |

本文件已通过负责人预审，上传锁已授予E。E上传前仍须重新确认远端没有新提交；如受测范围出现新提交，必须重新运行基线。最终只上传：

```text
新版设计文档-重写版/第一周任务/handoff-w1-e-baseline.md
```

不得同时上传旧版或相互矛盾的多份“正式基线报告”。

---

## 13. 最终结论

```text
被测代码提交：ea10ab7eadde7362537515b99df18e6047bde632
E npm ci：PASS（使用系统CA安全复验）
E typecheck：PASS
E test：PASS，21个测试文件、117项测试
E smoke:extension：PASS
E verify：PASS
当前业务失败：无
安全发现：1 high、1 moderate，PENDING_OWNER_ACTION
E基线状态：PASS
E岗位审核建议：GO
最终门禁决定：负责人
上传锁：负责人已授予E，待E上传
```

本报告不降低测试标准，不把负责人或C岗位结果冒充E结果，不把安全审计告警写成业务测试失败，也不越权修改公共依赖、锁文件或其他岗位资产。
