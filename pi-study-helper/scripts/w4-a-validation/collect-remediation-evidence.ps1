param(
  [Parameter(Mandatory = $true)]
  [string]$NodeDirectory,
  [Parameter(Mandatory = $true)]
  [string]$PythonDirectory,
  [string]$EvidenceDirectory = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$resultsPath = Join-Path $PSScriptRoot "command-results.json"
$rawRoot = if ([string]::IsNullOrWhiteSpace($EvidenceDirectory)) {
  Join-Path ([System.IO.Path]::GetTempPath()) "w4-d1-a-remediation-evidence"
} else {
  [System.IO.Path]::GetFullPath($EvidenceDirectory)
}
$progressPath = Join-Path $rawRoot "progress.txt"
New-Item -ItemType Directory -Path $rawRoot -Force | Out-Null
$NodeDirectory = (Resolve-Path -LiteralPath $NodeDirectory).Path
$PythonDirectory = (Resolve-Path -LiteralPath $PythonDirectory).Path
$pythonScripts = Join-Path $PythonDirectory "Scripts"
$env:PATH = "$NodeDirectory;$PythonDirectory;$pythonScripts;$env:PATH"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Utf8NoBom([string]$Path, [string]$Value) {
  [System.IO.File]::WriteAllText($Path, $Value, $utf8NoBom)
}

$historical = @()
if (Test-Path -LiteralPath $resultsPath) {
  $previous = Get-Content -Raw -Encoding UTF8 -LiteralPath $resultsPath | ConvertFrom-Json
  if ($null -ne $previous.historicalCommands) { $historical += @($previous.historicalCommands) }
  if ($null -ne $previous.remediationCommands) { $historical += @($previous.remediationCommands) }
  if ($null -ne $previous.commands) { $historical += @($previous.commands) }
}

function Get-Sha256([string]$Path) {
  (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Read-VitestCounts([string]$Text) {
  $lines = $Text -split "`r?`n"
  $fileLine = $lines | Where-Object { $_ -match 'Test Files\s+' } | Select-Object -Last 1
  $testLine = $lines | Where-Object { $_ -match '^\s*Tests\s+' } | Select-Object -Last 1
  if ($null -eq $fileLine -or $null -eq $testLine) { return $null }
  $filesPassedMatch = [regex]::Match($fileLine, '(\d+) passed')
  $filesFailedMatch = [regex]::Match($fileLine, '(\d+) failed')
  $filesTotalMatch = [regex]::Match($fileLine, '\((\d+)\)')
  $testsPassedMatch = [regex]::Match($testLine, '(\d+) passed')
  $testsFailedMatch = [regex]::Match($testLine, '(\d+) failed')
  $testsSkippedMatch = [regex]::Match($testLine, '(\d+) skipped')
  $testsTotalMatch = [regex]::Match($testLine, '\((\d+)\)')
  $filesPassed = if ($filesPassedMatch.Success) { [int]$filesPassedMatch.Groups[1].Value } else { 0 }
  $filesFailed = if ($filesFailedMatch.Success) { [int]$filesFailedMatch.Groups[1].Value } else { 0 }
  $filesTotal = if ($filesTotalMatch.Success) { [int]$filesTotalMatch.Groups[1].Value } else { $filesPassed + $filesFailed }
  $testsPassed = if ($testsPassedMatch.Success) { [int]$testsPassedMatch.Groups[1].Value } else { 0 }
  $testsFailed = if ($testsFailedMatch.Success) { [int]$testsFailedMatch.Groups[1].Value } else { 0 }
  $testsSkipped = if ($testsSkippedMatch.Success) { [int]$testsSkippedMatch.Groups[1].Value } else { 0 }
  $testsTotal = if ($testsTotalMatch.Success) { [int]$testsTotalMatch.Groups[1].Value } else { $testsPassed + $testsFailed + $testsSkipped }
  [ordered]@{ filesTotal = $filesTotal; filesPassed = $filesPassed; filesFailed = $filesFailed; testsTotal = $testsTotal; testsPassed = $testsPassed; testsFailed = $testsFailed; testsSkipped = $testsSkipped }
}

function Invoke-Recorded([string]$Id, [string]$Command) {
  $stdout = Join-Path $rawRoot "$Id.stdout.txt"
  $stderr = Join-Path $rawRoot "$Id.stderr.txt"
  $commandPath = Join-Path $rawRoot "$Id.ps1"
  Write-Utf8NoBom $commandPath "$Command`r`nif (`$null -eq `$LASTEXITCODE) { exit 0 } else { exit `$LASTEXITCODE }"
  Write-Utf8NoBom $progressPath "RUNNING $Id"
  $started = (Get-Date).ToUniversalTime().ToString("o")
  $process = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-File", $commandPath) -WorkingDirectory $projectRoot -Wait -PassThru -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $completed = (Get-Date).ToUniversalTime().ToString("o")
  $combined = (Get-Content -Raw -Encoding UTF8 -LiteralPath $stdout) + "`n" + (Get-Content -Raw -Encoding UTF8 -LiteralPath $stderr)
  $record = [ordered]@{
    id = $Id
    command = $Command
    workingDirectory = $projectRoot
    startedAt = $started
    completedAt = $completed
    exitCode = $process.ExitCode
    testCounts = Read-VitestCounts $combined
    stdoutSha256 = Get-Sha256 $stdout
    stderrSha256 = Get-Sha256 $stderr
    conclusion = if ($process.ExitCode -eq 0) { "PASS" } else { "FAIL" }
  }
  Write-Utf8NoBom $progressPath "COMPLETED $Id EXIT=$($process.ExitCode)"
  $record
}

$targeted = "npm.cmd test -- --run tests/w4-contracts.test.ts tests/profile-v2-schema.test.ts tests/profile-v2-activation.test.ts tests/profile-v2-revision-resolution.test.ts tests/path-engine.test.ts tests/path-runtime.test.ts tests/diagnostic-runtime.test.ts tests/file-learning-session-repository.test.ts tests/quiz-runtime.test.ts tests/deterministic-content-policy.test.ts tests/quiz-activity-runtime.test.ts tests/code-activity-facade-adapter.test.ts tests/composed-learning-runtime-facade.test.ts tests/app-bootstrap-facade.test.ts tests/profile-revision-3-activation.test.ts tests/activity-path-suffix.test.ts tests/learning-runtime-facade.test.ts --maxWorkers=1"
$commands = [System.Collections.Generic.List[object]]::new()
$commands.Add((Invoke-Recorded "environment" 'where.exe node; where.exe python; node --version; python -c "import platform,pandas; print(platform.python_version()); print(pandas.__version__)"'))
$commands.Add((Invoke-Recorded "path-runtime-deterministic-repeat" '1..5 | ForEach-Object { npm.cmd test -- --run tests/path-runtime.test.ts --maxWorkers=1; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }'))
$commands.Add((Invoke-Recorded "w4-a-targeted-remediation" $targeted))
$commands.Add((Invoke-Recorded "web-affected-six-files" "npm.cmd test -- --run tests/web --maxWorkers=1"))
$commands.Add((Invoke-Recorded "python-evaluator-three-files" "npm.cmd test -- --run tests/python-process-evaluation.test.ts tests/python-process-evaluation-r2.test.ts tests/w3-b-d1-delivery.test.ts --maxWorkers=1"))
$commands.Add((Invoke-Recorded "full-test-remediation" "npm.cmd test -- --run --maxWorkers=1"))
$commands.Add((Invoke-Recorded "v2-6-direct" "node scripts/w2-verification/v2-6-preconditions.mjs --development ../evaluation/personas/development-20.jsonl --final ../evaluation/personas/final-60.jsonl --profile fixtures/profiles/pandas-cleaning-v2-draft"))
$commands.Add((Invoke-Recorded "v2-6-runtime-isolated" '$env:W2_V26_DEVELOPMENT_PATH=(Resolve-Path "..\evaluation\personas\development-20.jsonl").Path; $env:W2_V26_FINAL_PATH=(Resolve-Path "..\evaluation\personas\final-60.jsonl").Path; $env:W2_V26_PROFILE_PATH=(Resolve-Path "fixtures\profiles\pandas-cleaning-v2-draft").Path; node .\node_modules\vitest\vitest.mjs run --maxWorkers=1 --run scripts/w2-verification/v2-6-preconditions.test.mjs'))
$commands.Add((Invoke-Recorded "frozen-persona-hashes" 'Get-FileHash -Algorithm SHA256 "..\evaluation\personas\development-20.jsonl","..\evaluation\personas\final-60.jsonl" | Select-Object Path,Hash'))
$commands.Add((Invoke-Recorded "tsc-root" "node .\node_modules\typescript\bin\tsc --noEmit"))
$commands.Add((Invoke-Recorded "tsc-test" "node .\node_modules\typescript\bin\tsc -p tsconfig.test.json"))
$commands.Add((Invoke-Recorded "tsc-web" "node .\node_modules\typescript\bin\tsc -p tsconfig.web.json"))
$commands.Add((Invoke-Recorded "typecheck" "npm.cmd run typecheck"))
$commands.Add((Invoke-Recorded "build-web" "npm.cmd run build:web"))
$commands.Add((Invoke-Recorded "check-docs" "npm.cmd run check:docs"))
$commands.Add((Invoke-Recorded "smoke-extension" "npm.cmd run smoke:extension"))
$commands.Add((Invoke-Recorded "check-release" "npm.cmd run check:release"))
$commands.Add((Invoke-Recorded "verify" "npm.cmd run verify"))
$commands.Add((Invoke-Recorded "diff-check" "git diff --check"))
$commands.Add((Invoke-Recorded "status-short" "git status --short"))

$result = [ordered]@{
  schemaVersion = 2
  generatedFor = "W4-A-D1-remediation-r2-owner-48"
  head = (git -C $projectRoot rev-parse HEAD).Trim()
  w4StartCommit = "ac6e307e17cf84450845dfc5ffa467063dd3ae4c"
  status = [ordered]@{ commit = "NOT_COMMITTED"; push = "NOT_PUSHED"; uploadLock = "NOT_GRANTED" }
  hashAlgorithm = "SHA-256"
  historicalCommands = $historical
  remediationCommands = $commands
}
Write-Utf8NoBom $resultsPath ($result | ConvertTo-Json -Depth 20)
Write-Utf8NoBom $progressPath "FINISHED failures=$($commands.Where({ $_.exitCode -ne 0 }).Count)"
if ($commands.Where({ $_.exitCode -ne 0 }).Count -gt 0) { exit 1 }
