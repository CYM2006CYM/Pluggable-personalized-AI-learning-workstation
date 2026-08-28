[CmdletBinding()]
param(
  [switch]$CheckOnly,
  [switch]$Offline,
  [switch]$SkipBrowser,
  [switch]$AcceptDownloads
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$ContractNode = "v22.23.1"
$ContractNpm = "10.9.8"
$ContractPython = "3.13.7"
$ContractPandas = "3.0.5"
$WebUrl = "http://127.0.0.1:5173/"
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$RuntimeRoot = Join-Path $ProjectRoot ".runtime"
$DownloadRoot = Join-Path $RuntimeRoot "downloads"
$ReportPath = Join-Path $RuntimeRoot "competition-preflight-report.json"
$NodeArchiveName = "node-v22.23.1-win-x64.zip"
$NodeHome = Join-Path $RuntimeRoot "node-v22.23.1-win-x64"
$PythonHome = Join-Path $RuntimeRoot "python-3.13.7"
$DependencyStamp = Join-Path $RuntimeRoot "npm-dependencies.sha256"
$script:DownloadsApproved = [bool]$AcceptDownloads
$script:Report = [ordered]@{
  generatedAt = [DateTime]::UtcNow.ToString("o")
  status = "running"
  projectRoot = $ProjectRoot
  os = [Environment]::OSVersion.VersionString
  is64Bit = [Environment]::Is64BitOperatingSystem
  powershell = $PSVersionTable.PSVersion.ToString()
  node = $null
  npm = $null
  python = $null
  pandas = $null
  dependencies = "unknown"
  dataDirectoryStrategy = "current_seal"
  liveModeRequested = -not [bool]$Offline
  failure = $null
}

function Write-Step([string]$Message) {
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
  Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Notice([string]$Message) {
  Write-Host "[INFO] $Message" -ForegroundColor DarkCyan
}

function Save-Report {
  New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
  $script:Report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
}

function Invoke-External {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$FailureMessage
  )
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FailureMessage (exit=$LASTEXITCODE)"
  }
}

function Get-CommandPath([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -eq $command) { return $null }
  return $command.Source
}

function Get-ExternalText([string]$FilePath, [string[]]$Arguments) {
  $previousPreference = $ErrorActionPreference
  try {
    # Windows PowerShell 5.1 can promote native stderr to an ErrorRecord when
    # the caller uses Stop. Candidate probing must continue after that case.
    $ErrorActionPreference = "Continue"
    $output = & $FilePath @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return (($output | Out-String).Trim())
  } catch {
    return $null
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

function Get-UniqueExistingPaths([object[]]$Candidates) {
  $seen = @{}
  $result = New-Object System.Collections.Generic.List[string]
  foreach ($candidate in $Candidates) {
    if ($null -eq $candidate) { continue }
    $text = [string]$candidate
    if ([string]::IsNullOrWhiteSpace($text)) { continue }
    try { $full = [IO.Path]::GetFullPath($text.Trim('"')) } catch { continue }
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { continue }
    $key = $full.ToLowerInvariant()
    if (-not $seen.ContainsKey($key)) {
      $seen[$key] = $true
      $result.Add($full)
    }
  }
  return $result.ToArray()
}

function Test-NodeRuntime([string]$NodePath) {
  if ([string]::IsNullOrWhiteSpace($NodePath) -or -not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { return $false }
  $nodeVersion = Get-ExternalText $NodePath @("--version")
  $npmPath = Join-Path (Split-Path $NodePath -Parent) "npm.cmd"
  if (-not (Test-Path -LiteralPath $npmPath -PathType Leaf)) { return $false }
  $npmVersion = Get-ExternalText $npmPath @("--version")
  return $nodeVersion -eq $ContractNode -and $npmVersion -eq $ContractNpm
}

function Find-NodeRuntime {
  $commandNode = Get-CommandPath "node.exe"
  $nvmHomeNode = $null
  if (-not [string]::IsNullOrWhiteSpace($env:NVM_HOME)) { $nvmHomeNode = Join-Path $env:NVM_HOME "v22.23.1/node.exe" }
  $candidates = Get-UniqueExistingPaths @(
    (Join-Path $NodeHome "node.exe"),
    $commandNode,
    $nvmHomeNode,
    (Join-Path $env:APPDATA "nvm/v22.23.1/node.exe"),
    (Join-Path $env:LOCALAPPDATA "nvm/v22.23.1/node.exe"),
    "C:/Program Files/nodejs/node.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-NodeRuntime $candidate) { return $candidate }
  }
  return $null
}

function Confirm-Downloads {
  if ($script:DownloadsApproved) { return }
  Write-Host ""
  Write-Host "首次部署需要下载或安装缺失的合同运行环境和锁定依赖。" -ForegroundColor Yellow
  Write-Host "下载来源仅包括 nodejs.org、python.org、npm registry 和锁定的 GitHub SDK。"
  Write-Host "运行时优先安装在项目 .runtime 目录，DeepSeek API Key 不会保存。"
  $answer = Read-Host "输入大写 YES 继续"
  if ($answer -cne "YES") { throw "用户取消了环境安装" }
  $script:DownloadsApproved = $true
}

function Install-NodeRuntime {
  Confirm-Downloads
  Write-Step "下载合同 Node.js $ContractNode"
  New-Item -ItemType Directory -Force -Path $DownloadRoot | Out-Null
  $archivePath = Join-Path $DownloadRoot $NodeArchiveName
  $checksumPath = Join-Path $DownloadRoot "SHASUMS256.txt"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/download/release/v22.23.1/$NodeArchiveName" -OutFile $archivePath
  Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/download/release/v22.23.1/SHASUMS256.txt" -OutFile $checksumPath
  $escapedArchiveName = [regex]::Escape($NodeArchiveName)
  $checksumLine = Get-Content -LiteralPath $checksumPath | Where-Object { $_ -match "^[0-9a-f]{64}\s+$escapedArchiveName$" } | Select-Object -First 1
  if ($null -eq $checksumLine) { throw "Node 官方校验清单中缺少 $NodeArchiveName" }
  $expected = ($checksumLine -split "\s+", 2)[0].ToLowerInvariant()
  $actual = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw "Node 压缩包 SHA-256 校验失败" }
  if (Test-Path -LiteralPath $NodeHome) { throw "本地 Node 目录存在但版本校验失败，请将其改名后重试：$NodeHome" }
  Expand-Archive -LiteralPath $archivePath -DestinationPath $RuntimeRoot
  $nodePath = Join-Path $NodeHome "node.exe"
  if (-not (Test-NodeRuntime $nodePath)) { throw "下载的 Node/npm 未通过合同版本检查" }
  Write-Ok "Node $ContractNode / npm $ContractNpm 已安装到项目内"
  return $nodePath
}

function Get-PythonRuntimeInfo([string]$PythonPath) {
  if ([string]::IsNullOrWhiteSpace($PythonPath) -or -not (Test-Path -LiteralPath $PythonPath -PathType Leaf)) { return $null }
  # Use no double quotes in -c: Windows PowerShell 5.1 strips them when it
  # builds a native command line, unlike PowerShell 7.
  $probe = "import importlib.util,json,sys; p=(__import__('pandas').__version__ if importlib.util.find_spec('pandas') else None); print(json.dumps(dict(python=sys.version.split()[0],pandas=p,executable=sys.executable)))"
  $raw = Get-ExternalText $PythonPath @("-I", "-c", $probe)
  if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
  try { return $raw | ConvertFrom-Json } catch { return $null }
}

function Get-PythonCandidates {
  $candidates = New-Object System.Collections.Generic.List[object]
  $candidates.Add((Join-Path $PythonHome "python.exe"))
  if ($env:PI_PYTHON_EXECUTABLE) { $candidates.Add($env:PI_PYTHON_EXECUTABLE) }
  $commandPython = Get-CommandPath "python.exe"
  if ($commandPython) { $candidates.Add($commandPython) }
  foreach ($path in @(
    (Join-Path $env:USERPROFILE "anaconda3/envs/pi-study-py313/python.exe"),
    (Join-Path $env:USERPROFILE "miniconda3/envs/pi-study-py313/python.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs/Python/Python313/python.exe")
  )) { $candidates.Add($path) }
  $condaPath = Get-CommandPath "conda.exe"
  if ($condaPath) {
    try {
      $conda = (& $condaPath env list --json 2>$null | Out-String) | ConvertFrom-Json
      foreach ($prefix in $conda.envs) { $candidates.Add((Join-Path $prefix "python.exe")) }
    } catch { Write-Notice "Conda 环境列表读取失败，继续检查其他 Python。" }
  }
  return Get-UniqueExistingPaths $candidates.ToArray()
}

function Find-PythonRuntime {
  foreach ($candidate in Get-PythonCandidates) {
    $info = Get-PythonRuntimeInfo $candidate
    if ($null -ne $info -and $info.python -eq $ContractPython -and $info.pandas -eq $ContractPandas) {
      return [PSCustomObject]@{ Path = $candidate; Info = $info }
    }
  }
  return $null
}

function Install-PythonRuntime {
  Confirm-Downloads
  Write-Step "下载合同 Python $ContractPython"
  New-Item -ItemType Directory -Force -Path $DownloadRoot | Out-Null
  $installer = Join-Path $DownloadRoot "python-3.13.7-amd64.exe"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -Uri "https://www.python.org/ftp/python/3.13.7/python-3.13.7-amd64.exe" -OutFile $installer
  $signature = Get-AuthenticodeSignature -LiteralPath $installer
  if ($signature.Status -ne "Valid" -or $null -eq $signature.SignerCertificate -or $signature.SignerCertificate.Subject -notmatch "Python Software Foundation") {
    throw "Python 安装包签名校验失败，已停止安装"
  }
  if (Test-Path -LiteralPath $PythonHome) { throw "本地 Python 目录存在但版本校验失败，请将其改名后重试：$PythonHome" }
  $argumentLine = @(
    "/quiet", "InstallAllUsers=0", "PrependPath=0", "Include_launcher=0", "Include_test=0",
    "Include_doc=0", "Include_symbols=0", "Include_debug=0", "AssociateFiles=0", "Shortcuts=0",
    ('TargetDir="' + $PythonHome + '"')
  ) -join " "
  $process = Start-Process -FilePath $installer -ArgumentList $argumentLine -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Python 安装失败 (exit=$($process.ExitCode))" }
  $pythonPath = Join-Path $PythonHome "python.exe"
  if (-not (Test-Path -LiteralPath $pythonPath)) { throw "Python 安装完成但未找到 python.exe" }
  Write-Step "安装 pandas $ContractPandas"
  Invoke-External $pythonPath @("-m", "pip", "install", "--disable-pip-version-check", "pandas==$ContractPandas") "pandas 安装失败"
  $info = Get-PythonRuntimeInfo $pythonPath
  if ($null -eq $info -or $info.python -ne $ContractPython -or $info.pandas -ne $ContractPandas) {
    throw "本地 Python/pandas 未通过合同版本检查"
  }
  Write-Ok "Python $ContractPython / pandas $ContractPandas 已安装到项目内"
  return [PSCustomObject]@{ Path = $pythonPath; Info = $info }
}

function Test-ProjectFiles {
  foreach ($relative in @(
    "package.json",
    "package-lock.json",
    "vite.config.ts",
    "fixtures/profiles/pandas-cleaning-revision-3-draft/quality/revision-seal.json"
  )) {
    if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $relative) -PathType Leaf)) { throw "项目文件缺失：$relative" }
  }
}

function Test-DependenciesReady {
  foreach ($relative in @(
    "node_modules/typescript/lib/tsc.js",
    "node_modules/vite/bin/vite.js",
    "node_modules/pi-loop-graph-sdk/package.json"
  )) {
    if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $relative) -PathType Leaf)) { return $false }
  }
  return $true
}

function Get-LockHash {
  return (Get-FileHash -LiteralPath (Join-Path $ProjectRoot "package-lock.json") -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Ensure-Git {
  $gitPath = Get-CommandPath "git.exe"
  if ($gitPath) { return $gitPath }
  Confirm-Downloads
  $wingetPath = Get-CommandPath "winget.exe"
  if (-not $wingetPath) {
    throw "首次 npm ci 需要 Git，且当前机器没有 winget。请先安装 Git for Windows 后重试。"
  }
  Write-Step "安装 npm 锁定 SDK 所需的 Git for Windows"
  Invoke-External $wingetPath @(
    "install", "--id", "Git.Git", "--exact", "--source", "winget", "--silent",
    "--accept-package-agreements", "--accept-source-agreements"
  ) "Git for Windows 安装失败"
  $candidates = Get-UniqueExistingPaths @(
    "C:/Program Files/Git/cmd/git.exe",
    (Join-Path $env:LOCALAPPDATA "Programs/Git/cmd/git.exe")
  )
  if ($candidates.Count -eq 0) {
    throw "Git 已安装但当前进程尚未发现它。请关闭窗口并重新双击启动程序。"
  }
  $gitPath = $candidates[0]
  $env:PATH = "$(Split-Path $gitPath -Parent);$env:PATH"
  Write-Ok "Git for Windows 已就绪"
  return $gitPath
}

function Ensure-NpmDependencies([string]$NpmPath) {
  $lockHash = Get-LockHash
  $stampMatches = (Test-Path -LiteralPath $DependencyStamp -PathType Leaf) -and ((Get-Content -LiteralPath $DependencyStamp -Raw).Trim() -eq $lockHash)
  if ((Test-DependenciesReady) -and ($stampMatches -or -not (Test-Path -LiteralPath $DependencyStamp))) {
    Write-Ok "项目依赖已存在"
    $script:Report.dependencies = "ready"
    return
  }
  Confirm-Downloads
  $null = Ensure-Git
  Write-Step "按 package-lock.json 安装项目依赖"
  Push-Location $ProjectRoot
  try { Invoke-External $NpmPath @("ci", "--no-audit", "--no-fund") "npm ci 失败" }
  finally { Pop-Location }
  New-Item -ItemType Directory -Force -Path $RuntimeRoot | Out-Null
  Set-Content -LiteralPath $DependencyStamp -Value $lockHash -Encoding ASCII
  $script:Report.dependencies = "installed"
  Write-Ok "项目依赖安装完成"
}

function Test-WebPort {
  $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 5173)
  try { $listener.Start() }
  catch { throw "端口 5173 已被占用。请确认并停止旧服务后重试。" }
  finally { try { $listener.Stop() } catch { } }
}

function Start-BrowserWhenReady {
  if ($SkipBrowser) { return $null }
  return Start-Job -ScriptBlock {
    param($Url)
    $deadline = [DateTime]::UtcNow.AddMinutes(5)
    while ([DateTime]::UtcNow -lt $deadline) {
      $client = New-Object Net.Sockets.TcpClient
      try {
        $connection = $client.BeginConnect("127.0.0.1", 5173, $null, $null)
        if ($connection.AsyncWaitHandle.WaitOne(500) -and $client.Connected) {
          $client.EndConnect($connection)
          Start-Process $Url
          return
        }
      } catch { } finally { $client.Dispose() }
      Start-Sleep -Milliseconds 500
    }
  } -ArgumentList $WebUrl
}

try {
  Write-Host "Pi Study Helper 比赛交付启动器" -ForegroundColor White
  Write-Host "项目目录：$ProjectRoot"
  if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw "当前原生启动器仅支持 Windows 10/11 x64" }
  if (-not [Environment]::Is64BitOperatingSystem) { throw "合同运行环境要求 Windows x64" }
  if ($PSVersionTable.PSVersion.Major -lt 5) { throw "需要 PowerShell 5.1 或更高版本" }
  Test-ProjectFiles

  Write-Step "检查合同 Node.js 与 npm"
  $nodePath = Find-NodeRuntime
  if ($null -eq $nodePath) {
    if ($CheckOnly) { throw "未找到 Node $ContractNode / npm $ContractNpm" }
    $nodePath = Install-NodeRuntime
  }
  $nodeHomeResolved = Split-Path $nodePath -Parent
  $env:PATH = "$nodeHomeResolved;$env:PATH"
  $npmPath = Join-Path $nodeHomeResolved "npm.cmd"
  $script:Report.node = Get-ExternalText $nodePath @("--version")
  $script:Report.npm = Get-ExternalText $npmPath @("--version")
  Write-Ok "Node $($script:Report.node) / npm $($script:Report.npm)"

  Write-Step "检查合同 Python 与 pandas"
  $pythonRuntime = Find-PythonRuntime
  if ($null -eq $pythonRuntime) {
    if ($CheckOnly) { throw "未找到 Python $ContractPython / pandas $ContractPandas" }
    $pythonRuntime = Install-PythonRuntime
  }
  $script:Report.python = $pythonRuntime.Info.python
  $script:Report.pandas = $pythonRuntime.Info.pandas
  Write-Ok "Python $($script:Report.python) / pandas $($script:Report.pandas)"
  Write-Notice "Python：$($pythonRuntime.Path)"

  Write-Step "检查项目依赖"
  if ($CheckOnly) {
    if (-not (Test-DependenciesReady)) { throw "node_modules 不完整，请运行启动程序完成 npm ci" }
    $script:Report.dependencies = "ready"
    $script:Report.status = "check_ok"
    Save-Report
    Write-Ok "项目依赖完整"
    Write-Host "`nCHECK_OK：比赛合同环境与项目依赖均已就绪。" -ForegroundColor Green
    exit 0
  }
  Ensure-NpmDependencies $npmPath
  Test-WebPort

  $env:PYTHONNOUSERSITE = "1"
  $env:PI_PYTHON_EXECUTABLE = $pythonRuntime.Path
  # Do not inherit a stale manual data directory. The TypeScript launcher is
  # the single authority that derives .demo-data-<current seal>.
  Remove-Item Env:PI_STUDY_DATA -ErrorAction SilentlyContinue

  if ($Offline) {
    Remove-Item Env:OPENAI_BASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:OPENAI_MODEL -ErrorAction SilentlyContinue
    Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
    $npmScript = "demo"
    Write-Notice "正在使用离线回归模式；该模式不代表实时调用 DeepSeek。"
  } else {
    $env:OPENAI_BASE_URL = "https://api.deepseek.com/v1"
    $env:OPENAI_MODEL = "deepseek-chat"
    Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
    $secret = Read-Host "请输入 DeepSeek API Key（输入时不显示）" -AsSecureString
    $env:OPENAI_API_KEY = [Net.NetworkCredential]::new("", $secret).Password
    Remove-Variable secret
    if ([string]::IsNullOrWhiteSpace($env:OPENAI_API_KEY) -or $env:OPENAI_API_KEY.Length -lt 16 -or $env:OPENAI_API_KEY -match "^\*+$") {
      throw "DeepSeek API Key 为空、过短或仍是占位符"
    }
    $npmScript = "demo:live"
    Write-Ok "DeepSeek 配置已进入当前进程；Key 未写入文件"
  }

  $script:Report.status = "starting"
  Save-Report
  Write-Step "构建并启动 Pi Study Helper"
  Write-Host "成功标志：PI_STUDY_READY mode=$(if ($Offline) { 'recorded_response' } else { 'live_model' })"
  Write-Host "网页地址：$WebUrl"
  Write-Host "停止服务：回到本窗口按 Ctrl+C。"
  $browserJob = Start-BrowserWhenReady
  Push-Location $ProjectRoot
  try { Invoke-External $npmPath @("run", $npmScript) "Pi Study Helper 启动失败" }
  finally {
    Pop-Location
    if ($null -ne $browserJob) {
      Stop-Job -Job $browserJob -ErrorAction SilentlyContinue
      Remove-Job -Job $browserJob -Force -ErrorAction SilentlyContinue
    }
  }
} catch {
  $script:Report.status = "failed"
  $script:Report.failure = $_.Exception.Message
  Save-Report
  Write-Host "`n[FAILED] $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "脱敏预检报告：$ReportPath" -ForegroundColor Yellow
  Write-Host "请查看《比赛方部署与启动说明.md》的故障排查章节。" -ForegroundColor Yellow
  exit 1
} finally {
  Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:OPENAI_BASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:OPENAI_MODEL -ErrorAction SilentlyContinue
  Remove-Item Env:PI_STUDY_DATA -ErrorAction SilentlyContinue
}
