# W3-D2 岗位 E React 六页候选整改交付报告 R2

生成时间：2026-08-09 11:57:26 +08:00

```text
contractVersion = W3-C4/W3-R2
deliveryStage = W3-D2
E_W3_D2 = PASS
fullV3Status = NOT_RUN_D2
gitStatus = NOT_COMMITTED / NOT_PUSHED
```

## 1. 交付边界与基线

- 本报告只确认岗位 E 的 W3-D2 React 六页候选通过整改和完整复测，不执行或签署 D4 的 V3-1 至 V3-8，不形成第三周整体 PASS 或 Go/No-Go。
- 执行工作树：`D:/.A_C_code/PPALW/.zcf/Pluggable-personalized-AI-learning-workstation/w3-d2-e-r2-final`。
- `git fetch origin main`：退出码 0。
- 实际 `HEAD=a0730d667a9429e395e92f687dbf6b2e0e0db179`。
- 实际 `origin/main=a0730d667a9429e395e92f687dbf6b2e0e0db179`。
- `git merge-base --is-ancestor 6773d99fc1f4c87dc816e44a48d9fac624a9b2b9 HEAD`：退出码 0。
- 候选迁移前后的 27 个文件逐文件 SHA-256 比对：27/27 一致。
- 未修改合同文档、A/B/C/D 文件、SDK 源码、环境锁或 Profile 状态；未读取 B 原始标注、机械差异清单或正式 gold。
- 未执行 `npm audit fix`，未 commit、push、暂存或申请上传锁。

## 2. D46 整改结果与测试映射

| D46 要求 | 实现结果 | 对应作者测试 |
| --- | --- | --- |
| 1. `ActivityResult.score=0.78`，直接显示小数 | 显示 `0.78 / 1` | `keeps ActivityResult score on the frozen 0..1 scale`；`renders the frozen ActivityResult score without percentage conversion` |
| 2. 不乘 100、不重算 PASS | 源码无 `score * 100`，页面不产生百分制或 PASS | `contains no forbidden browser capabilities or client-side result calculations`；分数 DOM 反例 |
| 3. 学习路由包含 `nodeId` | 路由为 `/learn/:sessionId/:nodeId` | `rejects the obsolete learning route without a nodeId`；`binds both sessionId and nodeId for the learning page` |
| 4. 全部学习入口包含合法 `nodeId` | AppShell、路径、活动、总结入口均为新形状 | `uses only the node-aware learning link shape in navigation`；3 组 `uses a node-aware learning entry` |
| 5. “查看检查点”进入 recovery | 真实按钮点击进入 recovery | `preserves a controlled activity draft through conflict, error, recovery, and route changes` |
| 6. “从完整检查点恢复”返回 ready | 真实按钮点击恢复开始页 ready | 同上 |
| 7. 草稿进入 React/Zustand 受控状态 | textarea 使用 Zustand `value`/更新动作 | 同上；`starts from a valid ready and draft state` |
| 8. 草稿跨错误、冲突、恢复逐字保持 | 唯一草稿跨三种状态及路由返回后完全一致 | 同上 |
| 9. 导出 `FACADE_DTO_MOCKS` | 已独立导出公共 DTO mock 集 | `exports public Facade DTO mocks and page fixtures as separate groups` |
| 10. 导出 `PAGE_DISPLAY_FIXTURES` | 已独立导出页面展示 fixture 集 | 同上 |
| 11. 页面 fixture 不使用 `SafeView/SafeSummary` | 使用 `ProfileDisplayFixture` 等私有展示类型 | `does not define page fixtures with public SafeView or SafeSummary names` |
| 12. 两组分别做白名单和泄漏扫描 | 公共 DTO 与页面 fixture 分组扫描，均为 0 泄漏 | DTO 字段白名单测试；两组参数化敏感内容扫描 |
| 13. 页面 fixture 仅位于 Web 层 | 非 Web 层引用数为 0 | `keeps page display fixtures inside the Web layer` |

## 3. 完整复测矩阵

所有命令均在实际 `a0730d6...` 候选上按指定顺序执行。

| 命令 | 退出码 | 实际结果 |
| --- | ---: | --- |
| `npm.cmd ci` | 0 | 新装 268 packages；未批准或改变 `allowScripts` |
| `npm.cmd run typecheck` | 0 | 三组 TypeScript 配置全部通过 |
| `npm.cmd run test:web` | 0 | 6 个测试文件，81/81 项通过 |
| `npm.cmd run build:web` | 0 | Vite 7.1.7，45 modules transformed |
| `npm.cmd run check:docs` | 0 | 49 个 Markdown，本地链接全部有效 |
| `npm.cmd run check:release` | 0 | 282 个 tracked files，无私密数据或 secrets |
| `git diff --check` | 0 | 无空白错误 |

覆盖结果：六条正式路由可直接匹配；旧 `/learn/:sessionId` 落入通配路由；六页分别覆盖 ready、empty、error、session_version_conflict、recovery 且主要操作可用；活动页覆盖 draft、running、submitted、safe_feedback；恢复与草稿保持使用真实 DOM 输入和按钮交互，不以直接调用 store 替代交互。

## 4. 依赖、SDK 与禁止能力审计

| 项目 | 冻结/实际值 | 结论 |
| --- | --- | --- |
| React / React DOM | 18.3.1 / 18.3.1 | PASS |
| React Router DOM | 6.30.1 | PASS |
| Zustand | 5.0.14 | PASS |
| Vite / React plugin | 7.1.7 / 5.0.4 | PASS |
| jsdom / TypeScript / Vitest | 26.1.0 / 5.9.3 / 4.1.10 | PASS |
| SDK | `0.2.0@401d3e9bfa49e630196caefbabd732a3209b17a0` | PASS |
| `allowScripts` | package 与 lock 根节点均未新增 | PASS |

- `package.json` 精确依赖集合测试通过，无白名单外新增直接依赖。
- Web 源码真实 HTTP/`fetch`、Pyodide、审核页、隐藏测试、参考实现、私有 CSV、宿主绝对路径、API Key、浏览器端评分/PASS/路径/mastery/Rubric 判定、仓储写入或事务恢复模拟：匹配数均为 0。
- 实际 `dist-web` JavaScript 经 Babel AST 扫描，可执行全局或成员 `fetch` 调用数为 0。
- `FACADE_DTO_MOCKS` 和 `PAGE_DISPLAY_FIXTURES` 分别通过字段白名单及敏感内容扫描，两组对象不混用；非 Web 层 fixture 引用数为 0。

## 5. 首次失败与根因记录

整改前旧测试套件显示 5 个文件、61/61 项通过，但没有覆盖 D46。补入 D46 反例后首次为 6 个文件、77 项，其中 19 项失败，根因如下：

1. mock 分数仍为百分制值，页面存在百分制展示/计算。
2. 学习路由与部分导航入口缺少 `nodeId`。
3. 检查点按钮没有形成 `ready -> recovery -> ready` 闭环。
4. 活动草稿使用 `defaultValue`，未进入 Zustand 受控状态，跨状态不能得到合同保证。
5. 公共 DTO mock 与页面私有 fixture 未明确分组，私有类型命名和分层扫描不满足 D46。

修复只涉及 E 拥有的前端实现与测试。旧基线工作树的一次 `npm ci` 曾因本任务自行启动的 Vite 进程占用 `esbuild.exe` 而以 EPERM 退出 1；停止该进程后重试通过。该历史环境占用不影响本轮最终工作树，最终 `npm ci` 首次即退出 0。

## 6. 视觉与响应式证据

- 1440x900：开始、诊断、路径、学习、活动、总结六页，6 张。
- 390x844：开始、路径、活动，3 张。
- 正式提交 `0.78 / 1`、进入 recovery、恢复完成，各 1 张；共 12 张 R2 截图。
- 390px 浏览器机械测量：六路由均为 `scrollWidth=innerWidth=390`，页面级横向溢出 0，主要控件越界 0。
- 五个状态按钮尺寸均为 `45x34`；文本、导航、按钮和状态面板无重叠，最长文本未溢出，主要操作均可访问。
- 截图构建与最终 `a0730d6...` 构建的 `index.html`、CSS、JavaScript 三个产物 SHA-256 完全一致（3/3），截图可机械绑定到本轮最终候选。

## 7. 拟提交文件清单

负责人复审通过并另行授权上传锁后，拟提交仅包含以下 27 个 E 文件：

```text
pi-study-helper/.gitignore
pi-study-helper/index.html
pi-study-helper/package.json
pi-study-helper/package-lock.json
pi-study-helper/tsconfig.web.json
pi-study-helper/vite.config.ts
pi-study-helper/src/web/app/AppShell.tsx
pi-study-helper/src/web/app/routes.tsx
pi-study-helper/src/web/components/PageFrame.tsx
pi-study-helper/src/web/components/PageStatePanel.tsx
pi-study-helper/src/web/main.tsx
pi-study-helper/src/web/mocks/safe-dtos.ts
pi-study-helper/src/web/pages/ActivityPage.tsx
pi-study-helper/src/web/pages/DiagnosticPage.tsx
pi-study-helper/src/web/pages/LearnPage.tsx
pi-study-helper/src/web/pages/PathPage.tsx
pi-study-helper/src/web/pages/StartPage.tsx
pi-study-helper/src/web/pages/SummaryPage.tsx
pi-study-helper/src/web/state/ui-store.ts
pi-study-helper/src/web/styles.css
pi-study-helper/src/web/styles/layout-contract.ts
pi-study-helper/tests/web/boundary-contract.test.mjs
pi-study-helper/tests/web/dto-contract.test.ts
pi-study-helper/tests/web/layout-contract.test.ts
pi-study-helper/tests/web/pages.test.tsx
pi-study-helper/tests/web/routes.test.tsx
pi-study-helper/tests/web/state.test.ts
```

明确排除：`node_modules`、`dist-web`、日志、浏览器 profile、整个仓库副本、旧 `9b00cc...` 包、D1 标注、B/E 原始封存、机械差异清单、正式 gold、A/B/C/D 文件、SDK 源码、合同文档，以及本地工作区既有审计材料。

## 8. 负责人复审入口

- 新审核包：`W3-D2-E-owner-review-package-r2.zip`。
- 外层 SHA-256：见同目录 `W3-D2-E-hashes-r2.sha256` 与交付消息。
- 包内 payload 逐文件 SHA-256：见包内 `W3-D2-E-payload-hashes-r2.sha256`；包外 `W3-D2-E-hashes-r2.sha256` 另登记 ZIP 外层哈希和 ZIP 内全部条目，机械复算结果必须为全部一致。
- 详细执行证据：`W3-D2-E-review-record-r2.md`。

本交付仍处于负责人复审阶段，不构成 commit、push、上传锁申请、完整 V3 或第三周整体结论。
