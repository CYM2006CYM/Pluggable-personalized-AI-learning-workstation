# Pi Study Helper

Pi Study Helper 是一款基于 [pi](https://pi.dev) 和 [Loop Graph SDK](https://github.com/0liveiraaa/pi-loop-graph-sdk) `0.2` 的任务驱动学习助手，通过回路图组织学习活动、复习反馈与资料演进。

## 功能

- **三种学习模式** — 自由练习、卡片练习、章节学习
- **资料包生命周期** — Active/Draft/Archived 三态管理，安全修订与回滚
- **自动资料构建** — 从 Markdown/txt 笔记自动生成规范化资料包
- **资料包修订** — 安全编辑，含 diff 预览、质量门禁和原子提交/回滚
- **学习画像** — 从累积的会话记录生成长周期学习画像
- **会话恢复** — 中断后可补总结，不丢失已完成题目
- **隐私设计** — 学习记录保存在本地，不随资料包分发

## 安装

先克隆正式公共仓库，再从仓库根目录安装应用子目录：

```powershell
git clone https://github.com/CYM2006CYM/Pluggable-personalized-AI-learning-workstation.git
Set-Location .\Pluggable-personalized-AI-learning-workstation
pi install .\pi-study-helper
```

重启 pi 或执行 `/reload` 后生效。

## 环境要求

- [pi](https://pi.dev) `>=0.80.3`
- Node.js `>=22`
- 已配置的模型后端（OpenAI 兼容 API）

## 配置 API Key（以 DeepSeek 为例）

先在 DeepSeek 开放平台创建 API Key。请勿把真实 Key 写进项目文件、README 或提交到 GitHub。

### 临时配置

在 Windows PowerShell 中执行：

```powershell
$env:DEEPSEEK_API_KEY="你的 API Key"
pi --provider deepseek
```

该设置只对当前 PowerShell 窗口有效，关闭窗口后失效，适合快速测试。

### 永久配置（推荐）

在 Windows PowerShell 中执行：

```powershell
[Environment]::SetEnvironmentVariable(
  "DEEPSEEK_API_KEY",
  "你的 API Key",
  "User"
)
```

执行后关闭并重新打开 PowerShell，让新的环境变量生效，然后启动 Pi：

```powershell
pi --provider deepseek
```

如果需要明确指定模型，可以先查看 Pi 当前支持的模型，再选择一个 DeepSeek 模型：

```powershell
pi --list-models deepseek
pi --provider deepseek --model <模型 ID>
```

进入 Pi 后即可执行 `/study`。不建议通过 `pi --api-key "你的 API Key"` 长期使用 Key，因为命令可能被保存到终端历史中。

## 命令

| 命令 | 说明 |
|------|------|
| `/study [subjectId]` | 启动一次学习会话 |
| `/study-recover` | 处理未完成的学习会话 |
| `/study-profile [subjectId]` | 生成或更新学习画像 |
| `/study-build [sourceDir]` | 从 Markdown/txt 构建新资料包 |
| `/study-revise [subjectId]` | 安全修订活跃资料包 |

## 快速开始

```bash
# 1. 在公共仓库根目录安装扩展
pi install .\pi-study-helper
# 重启 pi 或 /reload

# 2. 开始学习
/study

# 3. 从笔记构建资料包
/study-build ./我的笔记目录
```

首次加载会自动初始化 `demo-review` 示例资料包。执行 `/study` 即可选择资料包开始学习。

## 上手体验

下面的流程可以依次体验直接练习、卡片练习、章节学习、学习画像、资料包构建、修订与会话恢复。

> PowerShell 命令在系统终端中执行；以 `/` 开头的命令需要进入 Pi 后执行。

### 0. 确认扩展已加载

从 GitHub 安装后，可在 PowerShell 中检查安装清单并启动 Pi：

```powershell
pi list
pi --provider deepseek
```

如果正在仓库目录中进行本地开发，也可以安装本地版本：

```powershell
Set-Location "<仓库根目录>\pi-study-helper"
pi install .
pi --provider deepseek
```

启动时应看到 `Pi Study Helper 已加载；使用 /study 开始学习`。如果看不到这条提示，请退出 Pi，重新执行安装命令后再启动。

### 1. 直接做题

在 Pi 中输入：

```text
/study demo-review
```

建议依次选择：

1. 范围：第 1 章
2. 学习方式：`练习 · 直接答题`
3. 难度：`S-U · 基础理解`
4. 题型：`单选题`

答题后可以尝试“继续讨论这道题”，并输入：

```text
为什么其他选项不正确？请结合资料逐项解释。
```

随后可在学习功能菜单中体验“下一题”“提高难度”“查看当前目标材料”“查看当前学习总结”或“结束并保存总结”。

### 2. 卡片练习

再次输入：

```text
/study demo-review
```

建议选择第 1 章、`卡片练习 · 先回忆概念`、`主动回忆`卡片、`S-U · 基础理解`和`简答题`。看到卡片标题后先尝试自行回忆，再决定是否查看材料并开始答题。

完成一题后选择“更换卡片/章节”，继续体验“间隔复习”或“交错练习”。

### 3. 章节学习

```text
/study demo-review
```

建议选择第 2 章、`章节学习 · 结合章节材料`、任意小节、`M-U · 综合理解`和`判断题`。该模式会先展示章节内容，再根据当前材料生成题目。

### 4. 生成学习画像

完整结束一次学习会话后输入：

```text
/study-profile demo-review
```

选择要消费的学习记录，检查生成的画像，然后确认保存。建议先完成 3～5 道题，画像会更有参考价值。

### 5. 从示例笔记构建资料包

仓库内置了两篇用于体验构建流程的 Markdown 笔记。在 Pi 中输入：

```text
/study-build "<仓库根目录>\pi-study-helper\fixtures\source-materials\p4-smoke"
```

按提示填写：

```text
资料包 ID：my-learning-demo
科目名称：我的学习方法练习
```

构建完成后选择启用 draft，然后开始学习新资料包：

```text
/study my-learning-demo
```

如果仓库位于其他目录，请把命令中的绝对路径替换为你本机的实际路径。你也可以将路径换成自己的 Markdown/TXT 笔记目录。

### 6. 安全修订资料包

```text
/study-revise my-learning-demo
```

可以输入以下修订意见进行体验：

```text
为主动回忆补充一个大学期末复习场景，并增加一个常见误区。保留现有章节结构，不删除原内容。
```

Agent 会先生成计划和实际文件变更供确认。初次体验可先保留 draft；确认内容符合预期后，再启用修订版。启用时旧 active 会自动归档。

### 7. 恢复未完成会话

先通过 `/study demo-review` 开始一轮学习，完成至少一道题后退出 Pi。重新启动 Pi，然后输入：

```text
/study-recover
```

根据提示选择生成总结并结束，或将会话标记为中断。

推荐按以下顺序完整体验：

```text
/study demo-review
/study-profile demo-review
/study-build "<仓库根目录>\pi-study-helper\fixtures\source-materials\p4-smoke"
/study my-learning-demo
/study-revise my-learning-demo
```

## Loop Graph SDK 0.2 集成

本项目统一使用 Loop Graph SDK `0.2.0`，固定提交为 `401d3e9bfa49e630196caefbabd732a3209b17a0`，不保留旧版兼容层。当前集成边界为：

- 使用 `defineGraph({ id, version, input, output, context, entries, stages })` 定义图，使用 `finish({ output })` 返回最终结果；
- 使用 `codeNode()`、`agentNode()`和`graphNode()`定义阶段，TypeBox负责输入输出结构校验；
- 使用 `createPiGraphHost()`创建隔离Pi宿主，通过`host.execute(graph, input)`执行；
- `GraphRunResult`为`completed | failed | cancelled`判别联合，成功读取`output`，失败或取消读取`failure`；
- 使用`recording: "replay"`和`FileRunStore`记录Root Run，数据位于`<数据目录>/traces/runs/<rootRunId>/`。

Replay 记录可以用 SDK 的 `/replay` 子路径导出为离线 HTML：

```typescript
import { parseReplay, exportReplayHtml } from "pi-loop-graph-sdk/replay";
```

## 项目结构

```
src/
├── application/      # 控制器
├── domain/           # 核心业务逻辑
├── extension/        # Pi 扩展入口
├── graphs/           # Loop Graph 定义
├── infrastructure/   # SDK 封装
├── repositories/     # 数据持久化
├── tui/              # TUI 组件
└── config/           # 配置
tests/                # 测试套件
fixtures/
├── profiles/         # 示例资料包
└── source-materials/ # 构建测试用源文件
```

## 开发

```bash
npm ci
npm test             # 全部单元测试
npm run typecheck
npm run verify       # 完整 CI 验证（无需模型）
```

## 协议

MIT — 见 [LICENSE](LICENSE)。

## 相关项目

- [pi-loop-graph-sdk](https://github.com/0liveiraaa/pi-loop-graph-sdk) — Loop Graph SDK 运行时
- [pi-review-agent](https://github.com/0liveiraaa/pi-review-agent) — 参考实现

## Windows 本地网页 Demo 完整部署流程

本节用于在一台新的 Windows 10/11 电脑上，从零部署当前六节 Pandas 中文教学网页。下面的命令均在 **PowerShell** 中执行；除非步骤明确要求，否则不需要管理员权限。

当前比赛 Demo 的合同环境为：

```text
Node.js 22.23.1
npm 10.9.8
Python 3.13.7
pandas 3.0.5
网页地址 http://127.0.0.1:5173/
默认本地 API 端口 4311
实时模型提示词版本 w4-d2-v9
```

> API Key 只能放在当前 PowerShell 进程的环境变量中。不要把真实 Key 写入 README、`.env`、源码、截图、聊天记录或 Git 提交。

### 1. 安装基础工具

打开一个新的 PowerShell，检查 Git、NVM 和 Conda：

```powershell
git --version
nvm version
conda --version
```

缺少哪个工具，就安装哪个工具：

```powershell
winget install --id Git.Git -e
winget install --id CoreyButler.NVMforWindows -e
winget install --id Anaconda.Miniconda3 -e
```

安装结束后关闭所有 PowerShell 窗口，再重新打开 PowerShell。旧窗口不会自动读取安装程序新增的 PATH。

如果新窗口中 `conda` 仍不可用，先找到 Miniconda 的实际安装目录，再执行初始化：

```powershell
$condaExe = "$env:USERPROFILE/miniconda3/Scripts/conda.exe"
Test-Path $condaExe
& $condaExe init powershell
```

`Test-Path` 必须输出 `True`。如果 Miniconda 安装在其他位置，请把 `$condaExe` 改成实际路径。初始化后再次关闭并重新打开 PowerShell。

### 2. 克隆仓库

首次部署时执行：

```powershell
$sourceRoot = Join-Path $env:USERPROFILE "source"
New-Item -ItemType Directory -Force -Path $sourceRoot | Out-Null
Set-Location $sourceRoot
git clone https://github.com/CYM2006CYM/Pluggable-personalized-AI-learning-workstation.git
$repoRoot = Join-Path $sourceRoot "Pluggable-personalized-AI-learning-workstation"
$projectRoot = Join-Path $repoRoot "pi-study-helper"
Set-Location $projectRoot
Test-Path ".\package.json"
```

最后一条必须输出 `True`。如果已经克隆过仓库，不要再次 `git clone`；确认本地没有未保存修改后，从仓库根目录快进到最新 `main`：

```powershell
Set-Location $repoRoot
git status --short
git pull --ff-only origin main
Set-Location $projectRoot
```

`git status --short` 有输出时，先处理自己的本地修改，不要用 `reset --hard` 覆盖文件。

### 3. 安装并切换合同 Node.js

```powershell
nvm install 22.23.1
nvm use 22.23.1
node --version
npm.cmd --version
```

预期输出：

```text
v22.23.1
10.9.8
```

如果仍提示找不到 `nvm` 或 `node`，关闭 PowerShell 后重新打开；仍无效时重启 Windows。不要用 Node 24 代替合同版本。

### 4. 创建合同 Python 环境

环境只需创建一次：

```powershell
conda create -n pi-study-py313 python=3.13.7 -y
conda activate pi-study-py313
python -m pip install --upgrade pip
python -m pip install "pandas==3.0.5"
```

以后重新打开 PowerShell 时，只需激活：

```powershell
conda activate pi-study-py313
```

核对实际版本和解释器：

```powershell
python --version
python -c "import sys, pandas; print(sys.executable); print(pandas.__version__)"
```

必须看到 `Python 3.13.7` 和 `3.0.5`。不要通过修改环境锁绕过版本检查。

### 5. 安装项目依赖

进入应用目录并按锁文件安装：

```powershell
Set-Location $projectRoot
npm.cmd ci
```

`npm.cmd ci` 需要访问 npm registry 和 GitHub，因为 Loop Graph SDK 使用固定 Git 提交。不要改用 `npm install` 更新锁文件，也不要执行 `npm audit fix`。

安装完成后执行不调用模型的检查：

```powershell
npm.cmd run typecheck
npm.cmd run build:demo
npm.cmd run build:web
```

### 6. 绑定 Python、数据目录和端口

以下变量只对当前 PowerShell 窗口有效：

```powershell
$env:PYTHONNOUSERSITE = "1"
$env:PI_PYTHON_EXECUTABLE = (python -c "import sys; print(sys.executable)").Trim()
$env:PI_STUDY_API_PORT = "4311"
$env:PI_STUDY_DATA = Join-Path $projectRoot ".demo-data-live"
New-Item -ItemType Directory -Force -Path $env:PI_STUDY_DATA | Out-Null
Write-Host "PI_PYTHON_EXECUTABLE=$env:PI_PYTHON_EXECUTABLE"
Write-Host "PI_STUDY_API_PORT=$env:PI_STUDY_API_PORT"
Write-Host "PI_STUDY_DATA=$env:PI_STUDY_DATA"
```

`PI_PYTHON_EXECUTABLE` 应指向 `pi-study-py313` 环境中的 `python.exe`。`.demo-data-live` 是本机运行数据，不得提交到 Git。

如果 4311 被占用，先检查占用者：

```powershell
Get-NetTCPConnection -State Listen -LocalPort 4311 -ErrorAction SilentlyContinue
```

确认是旧的 Pi Study Helper 后，回到旧服务窗口按 `Ctrl+C`。不要结束不确定的系统进程。确实需要换端口时，可以在启动前把 `PI_STUDY_API_PORT` 改成另一个空闲本地端口；前端和后端会读取同一个值。

### 7. 配置 DeepSeek API Key

真实 AI 模式使用 OpenAI 兼容接口。使用安全输入，Key 不会显示在屏幕上：

```powershell
$env:OPENAI_BASE_URL = "https://api.deepseek.com/v1"
$env:OPENAI_MODEL = "deepseek-chat"
$secret = Read-Host "请输入 DeepSeek API Key（输入时不显示）" -AsSecureString
$env:OPENAI_API_KEY = [System.Net.NetworkCredential]::new("", $secret).Password
Remove-Variable secret
```

只检查变量是否存在，不打印 Key：

```powershell
if ([string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY)) { throw "OPENAI_API_KEY 未设置" }
Write-Host "OPENAI_API_KEY=已设置（内容不显示）"
Write-Host "OPENAI_BASE_URL=$env:OPENAI_BASE_URL"
Write-Host "OPENAI_MODEL=$env:OPENAI_MODEL"
```

`OPENAI_BASE_URL`、`OPENAI_MODEL` 和 `OPENAI_API_KEY` 必须同时存在。关闭当前 PowerShell 后，临时Key自动失效。

### 8. 启动真实 AI 网页

确认仍在同一个已激活Conda、已配置Key的PowerShell中执行：

```powershell
Set-Location $projectRoot
npm.cmd run demo:live
```

启动成功后，终端必须出现类似：

```text
PI_STUDY_READY mode=live_model promptVersion=w4-d2-v9 apiPort=4311 url=http://127.0.0.1:5173/
```

然后打开：

```text
http://127.0.0.1:5173/
```

保持启动服务的 PowerShell 窗口开启。停止服务时回到该窗口按 `Ctrl+C`。

### 9. 确认题目确实来自实时 AI

每次验收新版本时新建学习会话，不要恢复旧会话。进入某一节教学内容并打开课后客观题，实时链路为：

```text
当前会话选中的中文教学正文
→ Generator 生成4至6道中文单选题和候选答案
→ Hunter 逐题检查题干、选项、答案、解析和正文依据
→ 高风险或存在争议时 Defender 辩护
→ Judge 裁决；安全措辞不合规时允许一次 Judge Repair
→ 审核通过后展示AI题组
→ API失败、超时或审核不通过时使用固定题保障
```

页面右上角应显示“AI个性化生成题组”。显示“固定题保障”表示本次没有通过实时生成与审核链，不能把它记录为实时模型成功。实时审核可能需要几十秒，等待期间不要重复点击。

注意：

- `npm.cmd run demo:live` 才是实时 API 模式。
- `npm.cmd run demo` 使用录制响应，适合离线演示和回归测试，不代表当次调用了DeepSeek。
- 录制文件里的 `modelId=deepseek-chat` 只是历史字段，不是实时调用证据。
- 网页能打开只证明本地服务启动，不能单独证明实时AI成功。

### 10. 不使用 API 的离线启动

需要先确认网页和确定性学习闭环时，不配置 `OPENAI_*`，执行：

```powershell
Set-Location $projectRoot
npm.cmd run demo
```

离线模式会使用录制响应或固定保障题。它不会产生实时模型通过证据，但诊断、路径、教学正文、正式活动、Node/Python判分、重试和恢复仍可本地运行。

### 11. 常见故障

#### 网页显示固定题保障

先确认启动终端包含：

```text
mode=live_model promptVersion=w4-d2-v9
```

如果没有，说明启动方式或运行进程不正确。回到旧窗口按 `Ctrl+C`，在保留三个 `OPENAI_*` 变量的同一窗口重新执行 `npm.cmd run demo:live`，然后创建新会话。

如果启动标志正确但仍回退，可能是API错误、超时、Generator结构不合法或Agent审核拒绝。保留本地 `.demo-data-live` 供负责人读取脱敏轨迹，不要把该目录上传。

#### 页面打不开或端口被占用

```powershell
Get-NetTCPConnection -State Listen -LocalPort 5173,4311 -ErrorAction SilentlyContinue
```

优先在旧服务窗口按 `Ctrl+C`，再重新启动。网页固定使用5173；4311是本地API端口，不是浏览器页面地址。

#### Python代码评测提示环境不匹配

```powershell
conda activate pi-study-py313
$env:PYTHONNOUSERSITE = "1"
$env:PI_PYTHON_EXECUTABLE = (python -c "import sys; print(sys.executable)").Trim()
node --version
python --version
python -c "import pandas; print(pandas.__version__)"
```

版本必须分别为Node `v22.23.1`、Python `3.13.7`和pandas `3.0.5`。

#### API变量不完整

```powershell
@("OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_API_KEY") | ForEach-Object {
  $value = [Environment]::GetEnvironmentVariable($_)
  Write-Host "$_=" -NoNewline
  Write-Host ($(if ([string]::IsNullOrWhiteSpace($value)) { "未设置" } else { "已设置" }))
}
```

不要执行会打印 `$env:OPENAI_API_KEY` 实际内容的命令。

### 12. 最短重复启动命令

完成首次安装、克隆和 `npm.cmd ci` 后，新开 PowerShell 可逐行执行：

```powershell
$repoRoot = Join-Path $env:USERPROFILE "source/Pluggable-personalized-AI-learning-workstation"
$projectRoot = Join-Path $repoRoot "pi-study-helper"
Set-Location $projectRoot
nvm use 22.23.1
conda activate pi-study-py313
$env:PYTHONNOUSERSITE = "1"
$env:PI_PYTHON_EXECUTABLE = (python -c "import sys; print(sys.executable)").Trim()
$env:PI_STUDY_API_PORT = "4311"
$env:PI_STUDY_DATA = Join-Path $projectRoot ".demo-data-live"
$env:OPENAI_BASE_URL = "https://api.deepseek.com/v1"
$env:OPENAI_MODEL = "deepseek-chat"
$secret = Read-Host "请输入 DeepSeek API Key（输入时不显示）" -AsSecureString
$env:OPENAI_API_KEY = [System.Net.NetworkCredential]::new("", $secret).Password
Remove-Variable secret
node --version
python --version
python -c "import pandas; print(pandas.__version__)"
npm.cmd run demo:live
```

浏览器打开 `http://127.0.0.1:5173/`。

停止服务后，可清除当前 PowerShell 中的临时变量：

```powershell
Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:OPENAI_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:OPENAI_MODEL -ErrorAction SilentlyContinue
Remove-Item Env:PI_PYTHON_EXECUTABLE -ErrorAction SilentlyContinue
Remove-Item Env:PI_STUDY_API_PORT -ErrorAction SilentlyContinue
Remove-Item Env:PI_STUDY_DATA -ErrorAction SilentlyContinue
Remove-Item Env:PYTHONNOUSERSITE -ErrorAction SilentlyContinue
```
