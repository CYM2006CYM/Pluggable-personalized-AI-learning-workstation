[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$GateConfig,

    [Parameter(Mandatory = $true)]
    [string]$InputManifest,

    [ValidateSet("Plan", "Execute")]
    [string]$Mode = "Plan",

    [string]$RepositoryRoot,
    [string]$OwnerHandoffRoot,
    [string]$OutputRoot = (Join-Path (Get-Location) "w3-d3-output"),
    [string]$D4AuthorizationToken = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Read-JsonFile {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Required JSON file not found: $Path"
    }

    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Get-Sha256 {
    param([string]$Path)

    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Write-JsonFile {
    param(
        [string]$Path,
        [object]$Value
    )

    $Value | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $Path -Encoding utf8
}

function Invoke-FrozenCommand {
    param(
        [object]$Command,
        [string]$RepoRoot,
        [string]$EvidenceRoot,
        [hashtable]$Replacements
    )

    $workingDirectory = Join-Path $RepoRoot ([string]$Command.workingDirectory)
    if (-not (Test-Path -LiteralPath $workingDirectory -PathType Container)) {
        throw "Command working directory does not exist: $workingDirectory"
    }

    $stdoutPath = Join-Path $EvidenceRoot ("{0}.stdout.log" -f $Command.id)
    $stderrPath = Join-Path $EvidenceRoot ("{0}.stderr.log" -f $Command.id)
    $expandedArguments = [System.Collections.Generic.List[string]]::new()
    foreach ($argument in $Command.arguments) {
        $expandedArgument = [string]$argument
        foreach ($replacement in $Replacements.GetEnumerator()) {
            $expandedArgument = $expandedArgument.Replace([string]$replacement.Key, [string]$replacement.Value)
        }
        $expandedArguments.Add($expandedArgument)
    }
    $startedAt = [DateTimeOffset]::UtcNow
    $previousLocation = Get-Location
    try {
        Set-Location -LiteralPath $workingDirectory
        $exitCode = 1
        $executable = [string]$Command.executable
        if ($executable -eq "powershell.exe" -and $null -eq (Get-Command $executable -ErrorAction SilentlyContinue)) {
            $executable = Join-Path $PSHOME "powershell.exe"
        }
        & $executable @expandedArguments 1> $stdoutPath 2> $stderrPath
        $exitCode = $LASTEXITCODE
    } finally {
        Set-Location -LiteralPath $previousLocation
    }

    return [ordered]@{
        id = [string]$Command.id
        executable = $executable
        arguments = @($expandedArguments)
        argumentTemplate = @($Command.arguments)
        workingDirectory = [string]$Command.workingDirectory
        startedAt = $startedAt.ToString("o")
        completedAt = [DateTimeOffset]::UtcNow.ToString("o")
        exitCode = $exitCode
        expectedExitCode = [int]$Command.expectedExitCode
        stdoutFile = Split-Path -Leaf $stdoutPath
        stdoutSha256 = Get-Sha256 $stdoutPath
        stderrFile = Split-Path -Leaf $stderrPath
        stderrSha256 = Get-Sha256 $stderrPath
        passed = $exitCode -eq [int]$Command.expectedExitCode
    }
}

$configPath = (Resolve-Path -LiteralPath $GateConfig).Path
$manifestPath = (Resolve-Path -LiteralPath $InputManifest).Path
$config = Read-JsonFile $configPath
$manifest = Read-JsonFile $manifestPath

if ($config.schemaVersion -ne "w3-d3-gate-config-v1") {
    throw "Unsupported gate config schema: $($config.schemaVersion)"
}
if ($manifest.schemaVersion -ne "w3-d3-input-manifest-v2") {
    throw "Unsupported input manifest schema: $($manifest.schemaVersion)"
}
if ($config.contractVersion -ne "W3-C5/W3-R2" -or $manifest.contractVersion -ne "W3-C5/W3-R2") {
    throw "Contract mismatch. W3-C5/W3-R2 is required."
}
if ([string]$config.gate -notmatch '^V3-[1-8]$') {
    throw "Invalid gate id: $($config.gate)"
}

$inputIndex = @{}
foreach ($inputItem in $manifest.inputs) {
    $inputIndex[[string]$inputItem.id] = $inputItem
}

$missingInputIds = [System.Collections.Generic.List[string]]::new()
$pendingInputIds = [System.Collections.Generic.List[string]]::new()
foreach ($requiredId in $config.requiredInputIds) {
    $id = [string]$requiredId
    if (-not $inputIndex.ContainsKey($id)) {
        $missingInputIds.Add($id)
        continue
    }
    if ([string]$inputIndex[$id].status -ne "FROZEN") {
        $pendingInputIds.Add($id)
    }
}

if ($missingInputIds.Count -gt 0) {
    throw "Input manifest is missing required ids: $($missingInputIds -join ', ')"
}

New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
$configHash = Get-Sha256 $configPath
$manifestHash = Get-Sha256 $manifestPath

if ($Mode -eq "Plan") {
    $planEvidence = [ordered]@{
        schemaVersion = "w3-d3-plan-evidence-v1"
        contractVersion = "W3-C5/W3-R2"
        deliveryStage = "W3-D3"
        gate = [string]$config.gate
        testLayer = [string]$config.testLayer
        d47Decision = "W3-D47-TEST-LAYERS-1"
        gateConfigSha256 = $configHash
        inputManifestSha256 = $manifestHash
        executionStatus = "NOT_RUN_D3"
        gateConclusion = "NOT_PRODUCED_D3"
        readyForD4 = $pendingInputIds.Count -eq 0
        pendingInputIds = @($pendingInputIds)
        plannedCommands = @($config.commands)
        expectedMetrics = $config.expectedMetrics
        outputContract = $config.outputContract
        failureClassifications = @("CODE_DEFECT", "ENVIRONMENT_MISMATCH", "AUDIT_INPUT_INCOMPLETE", "LIVE_NOT_RUN", "MOCK_FALLBACK_USED")
        generatedAt = [DateTimeOffset]::Now.ToString("o")
    }
    $planPath = Join-Path $OutputRoot ("{0}-plan-evidence.json" -f ([string]$config.gate).ToLowerInvariant())
    Write-JsonFile -Path $planPath -Value $planEvidence
    Write-Output "PLAN_ONLY gate=$($config.gate) status=NOT_RUN_D3 readyForD4=$($planEvidence.readyForD4)"
    Write-Output "planEvidence=$planPath"
    exit 0
}

if ($D4AuthorizationToken -ne "W3-D4") {
    throw "Execute mode requires -D4AuthorizationToken W3-D4."
}
if ($pendingInputIds.Count -gt 0) {
    throw "Execute mode is blocked by pending inputs: $($pendingInputIds -join ', ')"
}
if ([string]::IsNullOrWhiteSpace($RepositoryRoot)) {
    throw "Execute mode requires -RepositoryRoot."
}

$resolvedRepositoryRoot = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$resolvedOutputRoot = (Resolve-Path -LiteralPath $OutputRoot).Path
$resolvedOwnerHandoffRoot = if ([string]::IsNullOrWhiteSpace($OwnerHandoffRoot)) { "" } else { (Resolve-Path -LiteralPath $OwnerHandoffRoot).Path }

$bindingParameters = @{
    InputManifest = $manifestPath
    RepositoryRoot = $resolvedRepositoryRoot
    RequiredInputIds = @($config.requiredInputIds)
    OutputFile = (Join-Path $resolvedOutputRoot "input-binding-evidence.json")
}
if (-not [string]::IsNullOrWhiteSpace($resolvedOwnerHandoffRoot)) {
    $bindingParameters.OwnerHandoffRoot = $resolvedOwnerHandoffRoot
}
& (Join-Path $PSScriptRoot "Test-W3D3InputManifest.ps1") @bindingParameters 1>$null

$replacements = @{
    "{RepositoryRoot}" = $resolvedRepositoryRoot
    "{OutputRoot}" = $resolvedOutputRoot
    "{ToolRoot}" = $PSScriptRoot
}
foreach ($inputItem in $manifest.inputs) {
    if ([string]$inputItem.status -ne "FROZEN") { continue }
    $inputPath = switch ([string]$inputItem.pathKind) {
        "repo-relative" { Join-Path $resolvedRepositoryRoot ([string]$inputItem.path) }
        "owner-handoff-relative" {
            if ([string]::IsNullOrWhiteSpace($resolvedOwnerHandoffRoot)) { throw "Owner handoff root is required for $($inputItem.id)." }
            Join-Path $resolvedOwnerHandoffRoot ([string]$inputItem.path)
        }
        default { [string]$inputItem.path }
    }
    $replacements["{InputPath:$([string]$inputItem.id)}"] = $inputPath
}
$results = foreach ($command in $config.commands) {
    Invoke-FrozenCommand -Command $command -RepoRoot $resolvedRepositoryRoot -EvidenceRoot $resolvedOutputRoot -Replacements $replacements
}
$allCommandsPassed = @($results | Where-Object { -not $_.passed }).Count -eq 0
$executionEvidence = [ordered]@{
    schemaVersion = "w3-d4-command-evidence-v1"
    contractVersion = "W3-C5/W3-R2"
    deliveryStage = "W3-D4"
    gate = [string]$config.gate
    gateConfigSha256 = $configHash
    inputManifestSha256 = $manifestHash
    repositoryRoot = $resolvedRepositoryRoot
    repositoryCommit = (& git -C $resolvedRepositoryRoot rev-parse HEAD).Trim()
    ownerHandoffRoot = if ([string]::IsNullOrWhiteSpace($resolvedOwnerHandoffRoot)) { "NOT_USED" } else { $resolvedOwnerHandoffRoot }
    commands = @($results)
    commandStatus = if ($allCommandsPassed) { "PASS" } else { "BLOCKED" }
    gateConclusion = "REQUIRES_EVIDENCE_ASSERTIONS"
    expectedMetrics = $config.expectedMetrics
    completedAt = [DateTimeOffset]::Now.ToString("o")
}
$executionPath = Join-Path $OutputRoot ("{0}-command-evidence.json" -f ([string]$config.gate).ToLowerInvariant())
Write-JsonFile -Path $executionPath -Value $executionEvidence
Write-Output "EXECUTED gate=$($config.gate) commandStatus=$($executionEvidence.commandStatus)"
Write-Output "commandEvidence=$executionPath"
if (-not $allCommandsPassed) { exit 1 }
