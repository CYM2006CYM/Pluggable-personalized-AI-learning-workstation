# Pi Study Helper 本地启动与真实 AI 演示完整流程

> 适用范围：Windows 开发机、本地比赛 Demo、`pi-study-helper` 子项目。
>
> 目标：从一台尚未配置的电脑开始，准备合同锁定的 Node/Python/Pandas 环境，临时配置 OpenAI 兼容 API，启动真实 AI 模式，并在浏览器打开 `http://127.0.0.1:5173/`。
>
> 安全要求：API Key 只放在当前 PowerShell 进程的环境变量中，不写入项目文件、不写入 Git、不发到聊天或截图中。下面的 `你的 API Key` 只是占位说明，不能原样执行。

## 一、先确认项目目录

本项目实际运行目录是：

```text
C:\Users\win11\Desktop\Pluggable-personalized-AI-learning-workstation\pi-study-helper
```

打开 PowerShell 后先执行：

```powershell
$projectRoot = "C:\Users\win11\Desktop\Pluggable-personalized-AI-learning-workstation\pi-study-helper"
Set-Location $projectRoot
Get-Location
Test-Path ".\package.json"
```

最后一条必须输出 `True`。如果输出 `False`，不要在当前目录继续运行，先把 `$projectRoot` 改成你电脑上的实际项目路径。

## 二、安装并切换合同要求的 Node.js

代码评测和运行环境锁定 Node.js `v22.23.1`。Node 24 即使能启动网页，也会被正式评测器判定为环境不匹配。

### 1. 安装 NVM for Windows（只需首次执行）

可以在管理员 PowerShell 中执行：

```powershell
winget install --id CoreyButler.NVMforWindows -e
```

安装程序完成后，关闭当前 PowerShell 窗口，再打开一个新的 PowerShell。旧窗口不会自动读取安装程序新增的 PATH。

### 2. 安装和启用 Node 22.23.1

```powershell
nvm version
nvm install 22.23.1
nvm use 22.23.1
node --version
npm --version
```

必须看到：

```text
v22.23.1
```

如果 `nvm` 仍然提示“找不到命令”，先关闭并重新打开 PowerShell；仍无效时重启 Windows，再重复上面的检查。不要修改项目环境锁，也不要用 Node 24 代替。

## 三、创建并激活匹配的 Python 环境

合同环境为：

```text
Python 3.13.7
pandas 3.0.5
```

本机 Anaconda 安装目录按当前开发机记录为：

```text
C:\Users\win11\anaconda3
```

### 1. 让当前 PowerShell 识别 conda

```powershell
$condaRoot = "C:\Users\win11\anaconda3"
(& "$condaRoot\Scripts\conda.exe" "shell.powershell" "hook") | Out-String | Invoke-Expression
```

### 2. 首次创建环境

如果环境尚不存在，执行：

```powershell
conda create -n pi-study-py313 python=3.13.7 pandas=3.0.5 -y
```

如果环境已经创建过，不要重复创建，直接激活：

```powershell
conda activate pi-study-py313
```

### 3. 检查实际解释器和 Pandas

```powershell
python --version
python -c "import sys, pandas; print(sys.executable); print(pandas.__version__)"
```

必须分别为：

```text
Python 3.13.7
...
3.0.5
```

## 四、绑定本次启动使用的 Python

Node 服务端会用 `PI_PYTHON_EXECUTABLE` 启动正式 Python 评测器。绑定当前 Conda 环境，避免误用系统 Python：

```powershell
$env:PI_PYTHON_EXECUTABLE = (python -c "import sys; print(sys.executable)").Trim()
Write-Host "PI_PYTHON_EXECUTABLE=$env:PI_PYTHON_EXECUTABLE"
```

输出路径应位于：

```text
C:\Users\win11\anaconda3\envs\pi-study-py313\python.exe
```

## 五、配置真实 AI API（仅当前 PowerShell 有效）

当前 Demo 使用 OpenAI 兼容接口。以 DeepSeek 为例：

```powershell
$env:OPENAI_BASE_URL = "https://api.deepseek.com/v1"
$env:OPENAI_MODEL = "deepseek-chat"
$secret = Read-Host "请输入 DeepSeek API Key（输入时不显示）" -AsSecureString
$env:OPENAI_API_KEY = [System.Net.NetworkCredential]::new("", $secret).Password
Remove-Variable secret
```

只检查“是否设置”，不要打印 Key 内容：

```powershell
if ([string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY)) { throw "OPENAI_API_KEY 未设置" }
Write-Host "OPENAI_API_KEY=已设置（内容不显示）"
Write-Host "OPENAI_BASE_URL=$env:OPENAI_BASE_URL"
Write-Host "OPENAI_MODEL=$env:OPENAI_MODEL"
```

三个变量必须同时存在。缺少任意一个，`demo:live` 会拒绝启动。

说明：关闭这个 PowerShell 窗口后，以上环境变量会消失。不要把 Key 写入 `.env`、`package.json`、源码、README 或提交记录。

## 六、设置本地 Demo 数据目录和端口

使用独立的实时 Demo 数据目录，避免与录制 Demo 或旧会话混用：

```powershell
$env:PI_STUDY_API_PORT = "4311"
$env:PI_STUDY_DATA = Join-Path $projectRoot ".demo-data-live"
New-Item -ItemType Directory -Force -Path $env:PI_STUDY_DATA | Out-Null
Write-Host "PI_STUDY_API_PORT=$env:PI_STUDY_API_PORT"
Write-Host "PI_STUDY_DATA=$env:PI_STUDY_DATA"
```

网页固定由 Vite 预览服务提供在 `5173` 端口；`4311` 是网页调用的本地 API 端口。不要把 `4311` 当成浏览器地址。

## 七、安装 JavaScript 依赖并做启动前检查

首次运行或 `package-lock.json` 发生变化后，在项目目录执行：

```powershell
npm.cmd ci
```

然后检查四个关键版本：

```powershell
node --version
npm --version
python --version
python -c "import pandas; print(pandas.__version__)"
```

预期结果：

```text
Node v22.23.1
Python 3.13.7
pandas 3.0.5
```

可以先做不调用模型的构建检查：

```powershell
npm.cmd run build:demo
npm.cmd run build:web
```

## 八、启动真实 AI 模式

确认仍在同一个、已激活 Conda 且已配置 Key 的 PowerShell 窗口中，执行：

```powershell
Set-Location $projectRoot
npm.cmd run demo:live
```

这个命令会依次：

1. 编译 Demo 服务端 TypeScript；
2. 构建 Web 页面；
3. 以 `--live` 启动本地 API；
4. 使用 `OPENAI_BASE_URL`、`OPENAI_MODEL`、`OPENAI_API_KEY` 建立真实模型后端；
5. 启动浏览器预览服务 `127.0.0.1:5173`。

启动成功后打开：

```text
http://127.0.0.1:5173/
```

保持这个 PowerShell 窗口不要关闭。停止服务时回到该窗口按 `Ctrl+C`。

## 九、如何确认看到的是实时 AI 题目

### 不是实时 AI 的启动方式

```powershell
npm.cmd run demo
```

该命令默认使用 `recorded-quiz-responses.json` 等录制响应，只适合离线演示和回归测试。录制响应里的 `modelId=deepseek-chat` 只是历史记录字段，不能证明当次启动访问了 DeepSeek。

### 实时 AI 的必要条件

必须同时满足：

- 使用 `npm.cmd run demo:live`；
- 三个 `OPENAI_*` 变量均已设置；
- API Key 对应的账户可用且网络可访问 API 地址；
- 进入章节后确实触发题目生成；
- 页面显示的题目来源为实时模型，失败时才显示固定题 fallback。

真实题目生成链路是：

```text
当前章节正式教学正文
  → Generator 生成候选题
  → Hunter 检查问题
  → 高风险时 Defender 进行辩护
  → Judge 裁决是否接受
  → 接受后展示；失败、超时或审核不通过时使用固定题 fallback
```

因此，题目应当围绕当前章节正文生成；不同讲解偏好绑定的正文版本也会进入当前会话的内容上下文。实时模型未通过审核的结果不会直接展示。

### 不要用“网页能打开”作为唯一证据

网页打开只能证明 Web 服务启动。一次真实 AI 验收至少要记录：

- 启动命令为 `npm.cmd run demo:live`；
- `OPENAI_MODEL`、`OPENAI_BASE_URL` 已设置（只记录名称和地址，不记录 Key）；
- 进入某一章节后触发了新的题目生成请求；
- 生成结果的题面与该章节正文有明确关联；
- Generator/Hunter/Defender/Judge 的审核结果或安全降级结果；
- API 失败时是否明确降级为固定题，而不是伪装成实时生成成功。

## 十、常见故障处理

### 1. `nvm` 或 `node` 找不到

关闭当前 PowerShell，重新打开；仍无效时重启 Windows。然后重新执行：

```powershell
nvm version
nvm use 22.23.1
node --version
```

### 2. 报 `ENVIRONMENT_MISMATCH`

依次检查：

```powershell
node --version
python --version
python -c "import pandas; print(pandas.__version__)"
```

必须是 `v22.23.1`、`3.13.7`、`3.0.5`。不要通过修改 `environment-lock.json` 绕过检查。

### 3. 报 API 变量缺失或不完整

在同一个 PowerShell 窗口重新执行第五节配置，并确认：

```powershell
@("OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_API_KEY") | ForEach-Object {
  $value = [Environment]::GetEnvironmentVariable($_)
  Write-Host "$_=" -NoNewline
  Write-Host ($(if ([string]::IsNullOrWhiteSpace($value)) { "未设置" } else { "已设置" }))
}
```

不要输出 `$env:OPENAI_API_KEY` 的实际内容。

### 4. 端口被占用

检查 `4311`：

```powershell
Get-NetTCPConnection -LocalPort 4311 -ErrorAction SilentlyContinue
```

确认是旧 Demo 进程后，优先回到旧窗口按 `Ctrl+C`。不要随意结束不确定的系统进程。若确实需要换端口，只在当前窗口设置新的 `PI_STUDY_API_PORT`，并保持网页仍使用项目启动器提供的 `5173`。

### 5. 点击后长时间等待

实时模型和四阶段审核本来可能比录制响应慢。观察按钮状态、处理秒数和浏览器网络请求；不要连续重复点击。若最终超时，应该出现明确失败或固定题 fallback，并保留当前页面恢复能力。

### 6. 页面显示旧会话或“暂无路径候选”

本次验收使用新的实时数据目录 `.demo-data-live`，并新建一次学习会话。不要把旧 `.demo-data` 中的会话当作本次实时 AI 结果。

## 十一、停止、清理和重新开始

停止当前服务：

```text
在运行 npm.cmd run demo:live 的 PowerShell 窗口按 Ctrl+C
```

清除本次 Demo 的本地临时环境变量（不会删除文件）：

```powershell
Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
Remove-Item Env:OPENAI_BASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:OPENAI_MODEL -ErrorAction SilentlyContinue
Remove-Item Env:PI_PYTHON_EXECUTABLE -ErrorAction SilentlyContinue
Remove-Item Env:PI_STUDY_API_PORT -ErrorAction SilentlyContinue
Remove-Item Env:PI_STUDY_DATA -ErrorAction SilentlyContinue
```

不要删除或覆盖旧 `.demo-data`、Profile 资产、环境锁、gold、hidden tests、Rubric 或 reference solution。它们属于既有验收证据和合同资产。

## 十二、最短重复启动版

当 Node、Conda 环境和 npm 依赖都已准备好时，新开 PowerShell，完整复制下面这段即可：

```powershell
$projectRoot = "C:\Users\win11\Desktop\Pluggable-personalized-AI-learning-workstation\pi-study-helper"
Set-Location $projectRoot
nvm use 22.23.1
$condaRoot = "C:\Users\win11\anaconda3"
(& "$condaRoot\Scripts\conda.exe" "shell.powershell" "hook") | Out-String | Invoke-Expression
conda activate pi-study-py313
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

随后在浏览器打开：

```text
http://127.0.0.1:5173/
```

这份流程只负责本地启动和现场验证，不代表已经完成 Git 提交、远端上传或比赛最终验收。任何真实 API 运行记录都必须如实标注 `LIVE_MODEL` 状态，不能把录制响应写成实时模型证据。
