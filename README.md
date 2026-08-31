# Pluggable Personalized AI Learning Workstation

本仓库是团队后续开发“可插拔个性化 AI 学习工作站”的正式开发仓库，用于六周 Pandas 个性化学习产品的编码、联调、测试和交付。

## 比赛 Demo 一键启动

Windows 10/11 x64 测评电脑从 GitHub 下载 ZIP 并完整解压后，直接双击仓库根目录的 `start-pi-study-helper.cmd`。在窗口中输入 DeepSeek API Key并点击“启动并打开网页”，程序会自动准备合同版本 Node.js、npm、Python、pandas 和项目依赖，随后启动实时 AI 模式并打开 `http://127.0.0.1:5173/`。

无需预装 Git、Node.js、Python 或 Conda，也不需要管理员权限。完整操作和故障排查见 [`pi-study-helper/比赛方部署与启动说明.md`](pi-study-helper/比赛方部署与启动说明.md)。

## 仓库内容

仓库的主要交付条目如下：

```text
.
├─ README.md
├─ start-pi-study-helper.cmd
├─ pi-study-helper/
├─ evaluation/
├─ pi-loop-graph-sdk-main/
├─ 新版设计文档-重写版/
└─ XH-202630上海云之脑智能科技有限公司-领域知识个性化生成与多智能体协同决策系统研究比赛方案(16).pdf
```


## 文件和目录说明

### `start-pi-study-helper.cmd`

比赛测评入口。它只负责转发到应用目录中的图形启动器，不保存 API Key。

### `pi-study-helper/`

学习助手应用主工程，也是后续功能开发的主要目录，包含：

```text
pi-study-helper/
├─ src/              # TypeScript应用源码
├─ tests/            # 单元、集成和回归测试
├─ fixtures/         # Profile、来源、模型响应和评测结果夹具
├─ scripts/          # 检查、验证脚本和按周可复算证据
├─ package.json      # 项目命令和依赖
└─ README.md         # 应用自身的安装与运行说明
```

后续 Profile v2、诊断、Evidence、KnowledgeState、PathEngine、统一应用入口、代码执行器、模型端口和网页适配均在该工程中逐步实现。

第三周PathEngine的V3-1/V3-2可复算证据及逐文件哈希位于`pi-study-helper/scripts/w3-path-validation/`。测试只读取和核对已提交证据，不在仓库内重写证据文件。

常用检查命令以该目录内的 `README.md` 和 `package.json` 为准。克隆公共仓库后可从仓库根目录安装和验证：

```powershell
pi install .\pi-study-helper
Set-Location .\pi-study-helper
npm.cmd ci
npm.cmd test
```

### `evaluation/`

确定性评测输入、独立标注、负责人资格记录和正式gold所在目录。`evaluation/golden/annotations/audit/`只保存历史审计记录和原始交付归档；其中ZIP用于审计追溯，不是应用运行依赖，也不得进入浏览器DTO、HTTP安全响应、日志、Agent上下文、学习者反馈或安全导出。

### `pi-loop-graph-sdk-main/`

项目使用的 Loop Graph SDK 完整源码。当前统一基线为 `0.2.0`，负责人批准的提交为 `401d3e9bfa49e630196caefbabd732a3209b17a0`。`pi-study-helper/package.json`、`package-lock.json` 通过带 SHA-512 完整性记录的 HTTPS 源码包锁定同一提交，首次安装不依赖 Git；本目录用于源码审计与复核。

它提供项目使用的图编排语言和运行机制，包括：

- `defineGraph`（定义图）和 `entry`（入口）；
- `codeNode`、`agentNode`、`graphNode`（阶段节点）；
- `firstMatch` 和 `finish`（路由与结束）；
- `call`（调用子图）；
- `compose`（组合子图）；
- `delegate`（委托独立Agent会话）；
- `Mechanism`（横切机制）；
- Graph校验、运行、取消、Recording/Replay、恢复和测试能力。

主要目录包括：

```text
pi-loop-graph-sdk-main/
├─ src/              # SDK源码
├─ tests/            # SDK测试
├─ docs/             # SDK文档和使用指南
├─ package.json      # SDK命令和依赖
├─ README-zh.md       # SDK中文说明
└─ README.md
```

SDK版本和提交哈希由负责人统一管理，普通成员不得自行升级、改成本地路径依赖或混入其他版本文件。需要升级时，必须同步替换SDK源码目录，更新`pi-study-helper`依赖声明和锁文件，修订公共合同，并完成SDK自身测试与应用回归测试。

### `新版设计文档-重写版/`

当前开发使用的正式设计文档目录，包含：

- `00—18`号产品和专项设计文档；
- Profile、诊断、路径、活动、执行器、Agent、界面和测试设计；
- `第一周任务/19`：第一周总任务、依赖顺序和仓库协作规则；
- `第一周任务/20`：负责人冻结决策；
- `第一周任务/21`：公共合同总册；
- `第一周任务/22—26`：五个岗位的独立任务书。

设计和实现发生冲突时，按以下顺序处理：

```text
负责人冻结决策
→ 公共合同总册
→ 当周总任务书和岗位任务书
→ 专项设计文档
→ 当前源码事实
```

普通成员不得直接修改总设计文档、冻结决策、公共合同和任务书。发现设计缺口时提交问题，由负责人统一修改。

### 比赛方案PDF

```text
XH-202630上海云之脑智能科技有限公司-领域知识个性化生成与多智能体协同决策系统研究比赛方案(16).pdf
```

这是比赛要求的原始材料，用于核对赛题目标、交付要求和评价方向，不作为源码运行依赖。

## 后续开发入口

负责人建议按以下顺序阅读：

```text
新版设计文档-重写版/第一周任务/20-第一周开发前负责人决策冻结清单.md
→ 新版设计文档-重写版/第一周任务/21-第一周公共合同总册.md
→ 新版设计文档-重写版/第一周任务/19-第一周总任务布置与权限边界.md
→ 新版设计文档-重写版/第一周任务/22—26岗位任务书
```

组员应先读19号总任务，再阅读20号中与自己有关的决策、21号相关合同章节和自己的岗位任务书。

## 仓库协作规则

当前团队采用：

```text
一个GitHub仓库
一个默认分支
不开个人分支
不使用PR
使用上传锁串行上传
```

每次上传必须遵循：

```text
申请上传锁
→ 确认无人正在上传
→ 检查只修改本人负责文件
→ 提交本地修改
→ 拉取GitHub最新内容
→ 处理本人文件的冲突
→ 运行最小测试
→ 上传GitHub
→ 公布提交编号、文件和测试结果
→ 释放上传锁
```

第一周详细顺序以 `新版设计文档-重写版/第一周任务/19-第一周总任务布置与权限边界.md` 为准。

## 明确不上传的内容

以下本地内容不属于本仓库：

- `新版设计文档/`旧版目录；
- `tmp/`及其他临时、解压或缓存目录；
- `第一周任务布置与单仓库协作管理习惯总结.md`等本地管理笔记；
- 其他论文摘要、草稿、截图或个人笔记；
- `node_modules/`、构建产物和运行缓存；
- API Key、访问令牌、密码和认证配置；
- 私人原始答案、私人代码和未脱敏模型轨迹；
- 不应公开的隐藏测试、参考实现或评测隐藏集副本；
- 宿主绝对路径和本地环境文件。


## 当前状态

`pi-study-helper`目前主要提供已有学习助手基础框架；Profile v2、Pandas正式资料包、个性化路径、代码执行器、网页和新增测试仍需按六周计划逐步实现。设计文档中的规划、候选和延期能力，不代表源码已经具备。

本仓库将作为团队后续开发的唯一正式协作仓库。可交付代码、负责人批准的SDK修改和正式设计变更都应进入本仓库规定的五个项目条目中，不能再形成第二套项目目录。

## 本地网页部署入口

需要在新的 Windows 电脑上部署并运行当前 `pi-study-helper` 网页 Demo 时，请按照应用目录 README 中新增的“Windows 本地网页 Demo 完整部署流程”逐项操作：

- [`pi-study-helper/README.md`](pi-study-helper/README.md)

该流程包含 Git、NVM、Node.js `22.23.1`、Python `3.13.7`、pandas `3.0.5`、npm 依赖、DeepSeek API Key、安全环境变量、本地端口、真实 AI 模式、录制模式和故障排查。不要把 API Key、`.demo-data*` 或 `.demo-build` 提交到 GitHub。
