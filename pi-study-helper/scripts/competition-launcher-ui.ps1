[CmdletBinding()]
param([switch]$SmokeTest)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()

$launcherPath = Join-Path $PSScriptRoot "competition-launcher.ps1"
$consolePowerShell = Join-Path $env:SystemRoot "System32/WindowsPowerShell/v1.0/powershell.exe"
if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
  [Windows.Forms.MessageBox]::Show(
    "未找到核心启动脚本。请完整解压 GitHub 下载的项目后重试。",
    "Pi Study Helper",
    [Windows.Forms.MessageBoxButtons]::OK,
    [Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
  exit 1
}
if (-not (Test-Path -LiteralPath $consolePowerShell -PathType Leaf)) {
  [Windows.Forms.MessageBox]::Show(
    "未找到 Windows PowerShell 5.1，无法创建环境准备进程。",
    "Pi Study Helper",
    [Windows.Forms.MessageBoxButtons]::OK,
    [Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
  exit 1
}

$form = New-Object Windows.Forms.Form
$form.Text = "Pi Study Helper 比赛版一键启动"
$form.StartPosition = "CenterScreen"
$form.ClientSize = New-Object Drawing.Size(590, 360)
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $true
$form.Font = New-Object Drawing.Font("Microsoft YaHei UI", 10)
$form.BackColor = [Drawing.Color]::FromArgb(246, 248, 250)

$title = New-Object Windows.Forms.Label
$title.Text = "启动实时 AI 学习系统"
$title.Font = New-Object Drawing.Font("Microsoft YaHei UI", 18, [Drawing.FontStyle]::Bold)
$title.ForeColor = [Drawing.Color]::FromArgb(31, 41, 55)
$title.Location = New-Object Drawing.Point(30, 26)
$title.AutoSize = $true
$form.Controls.Add($title)

$description = New-Object Windows.Forms.Label
$description.Text = "首次启动会自动准备合同版本 Node.js、Python、pandas 和项目依赖。`r`n全部运行时保存在项目目录，不需要管理员权限。"
$description.ForeColor = [Drawing.Color]::FromArgb(75, 85, 99)
$description.Location = New-Object Drawing.Point(33, 76)
$description.Size = New-Object Drawing.Size(520, 50)
$form.Controls.Add($description)

$keyLabel = New-Object Windows.Forms.Label
$keyLabel.Text = "DeepSeek API Key"
$keyLabel.Location = New-Object Drawing.Point(33, 142)
$keyLabel.AutoSize = $true
$form.Controls.Add($keyLabel)

$keyBox = New-Object Windows.Forms.TextBox
$keyBox.Location = New-Object Drawing.Point(36, 170)
$keyBox.Size = New-Object Drawing.Size(515, 29)
$keyBox.UseSystemPasswordChar = $true
$form.Controls.Add($keyBox)

$privacy = New-Object Windows.Forms.Label
$privacy.Text = "Key 仅传入本次启动进程，不写入文件、日志或预检报告。"
$privacy.ForeColor = [Drawing.Color]::FromArgb(75, 85, 99)
$privacy.Location = New-Object Drawing.Point(33, 207)
$privacy.AutoSize = $true
$form.Controls.Add($privacy)

$startButton = New-Object Windows.Forms.Button
$startButton.Text = "启动并打开网页"
$startButton.Location = New-Object Drawing.Point(36, 250)
$startButton.Size = New-Object Drawing.Size(515, 44)
$startButton.BackColor = [Drawing.Color]::FromArgb(22, 101, 52)
$startButton.ForeColor = [Drawing.Color]::White
$startButton.FlatStyle = "Flat"
$startButton.FlatAppearance.BorderSize = 0
$form.AcceptButton = $startButton
$form.Controls.Add($startButton)

$status = New-Object Windows.Forms.Label
$status.Text = "点击启动即表示同意从文档列明的官方来源下载缺失组件。"
$status.ForeColor = [Drawing.Color]::FromArgb(75, 85, 99)
$status.Location = New-Object Drawing.Point(33, 312)
$status.Size = New-Object Drawing.Size(520, 25)
$form.Controls.Add($status)

$startButton.Add_Click({
  $apiKey = $keyBox.Text.Trim()
  if ([string]::IsNullOrWhiteSpace($apiKey) -or $apiKey.Length -lt 16 -or $apiKey -match "^\*+$") {
    [Windows.Forms.MessageBox]::Show(
      "请输入真实且完整的 DeepSeek API Key。",
      "无法启动",
      [Windows.Forms.MessageBoxButtons]::OK,
      [Windows.Forms.MessageBoxIcon]::Warning
    ) | Out-Null
    $keyBox.Focus()
    return
  }

  $startButton.Enabled = $false
  $keyBox.Enabled = $false
  $status.Text = "正在打开环境准备窗口，请在新窗口查看实时进度……"
  $status.ForeColor = [Drawing.Color]::FromArgb(22, 101, 52)
  [Windows.Forms.Application]::DoEvents()

  try {
    $env:PI_LAUNCHER_API_KEY = $apiKey
    $arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -NoExit -File "' + $launcherPath + '" -AcceptDownloads'
    Start-Process -FilePath $consolePowerShell -ArgumentList $arguments | Out-Null
    $keyBox.Clear()
    $status.Text = "启动进程已创建。环境就绪后，浏览器会自动打开。"
    $startButton.Text = "已启动"
  } catch {
    $status.Text = "启动失败：$($_.Exception.Message)"
    $status.ForeColor = [Drawing.Color]::FromArgb(185, 28, 28)
    $startButton.Enabled = $true
    $keyBox.Enabled = $true
  } finally {
    Remove-Item Env:PI_LAUNCHER_API_KEY -ErrorAction SilentlyContinue
    $apiKey = $null
  }
})

$form.Add_Shown({ $keyBox.Focus() })
if ($SmokeTest) {
  Write-Output "UI_SMOKE_OK"
  $form.Dispose()
  exit 0
}
[void]$form.ShowDialog()
