[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$InputManifest,
    [Parameter(Mandatory = $true)] [string]$ToolRoot,
    [ValidateSet("Plan", "Execute")] [string]$Mode = "Plan",
    [string]$D4AuthorizationToken = "",
    [string]$OutputFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$manifest = Get-Content -LiteralPath $InputManifest -Raw -Encoding UTF8 | ConvertFrom-Json
$inputIndex = @{}
foreach ($item in $manifest.inputs) { $inputIndex[[string]$item.id] = $item }
$required = @(
    "a-d3-formal-commit",
    "a-d3-deterministic-test-files",
    "d-d3-formal-commit",
    "d-d3-fixed-trace-test-manifest",
    "owner-difficulty-gold-candidate",
    "owner-path-constraints-candidate",
    "owner-adjudication-public-index",
    "owner-freeze-record-candidate",
    "owner-public-attestation",
    "owner-candidate-verification"
)
$errors = [System.Collections.Generic.List[string]]::new()
$pending = [System.Collections.Generic.List[string]]::new()
foreach ($id in $required) {
    if (-not $inputIndex.ContainsKey($id)) { $errors.Add("missing input: $id"); continue }
    if ([string]$inputIndex[$id].status -ne "FROZEN") { $pending.Add($id) }
}

$forbiddenIds = @("owner-adjudication-log-candidate", "b-final-021-060", "mechanical-differences-owner-only")
foreach ($id in $forbiddenIds) {
    if ($inputIndex.ContainsKey($id)) { $errors.Add("forbidden E input: $id") }
}

foreach ($gate in @("V3-1", "V3-2")) {
    $configPath = Join-Path $ToolRoot "gates/$gate/gate-config.json"
    $config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ("a-d3-formal-commit" -notin @($config.requiredInputIds)) { $errors.Add("$gate does not bind A formal commit") }
    if ("a-d3-deterministic-test-files" -notin @($config.requiredInputIds)) { $errors.Add("$gate does not bind A test manifest") }
}

$traceConfigPath = Join-Path $ToolRoot "layers/fixed-trace-demo/layer-config.json"
$traceConfig = Get-Content -LiteralPath $traceConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($id in @("d-d3-formal-commit", "d-d3-fixed-trace-test-manifest")) {
    if ($id -notin @($traceConfig.requiredInputIds)) { $errors.Add("fixed trace layer missing input: $id") }
}
$traceCommandsReady = @($traceConfig.commands).Count -gt 0 -and $traceConfig.bindingStatus -eq "D4_RESOLVED"
if ($Mode -eq "Execute") {
    if ($D4AuthorizationToken -ne "W3-D4") { $errors.Add("D4 authorization token is required") }
    if ($pending.Count -gt 0) { $errors.Add("D4 inputs remain pending") }
    if (-not $traceCommandsReady) { $errors.Add("fixed trace commands are not resolved") }
}

$result = [ordered]@{
    schemaVersion = "w3-d4-readiness-r4-v1"
    contractVersion = "W3-C5/W3-R2"
    mode = $Mode
    requiredInputIds = $required
    pendingInputIds = @($pending)
    fixedTraceCommandsReady = $traceCommandsReady
    errors = @($errors)
    readiness = if ($errors.Count -eq 0 -and $pending.Count -eq 0 -and $traceCommandsReady) { "READY_FOR_D4_EXECUTION" } else { "NOT_READY_FOR_D4_EXECUTION" }
    fullV3ConclusionAllowed = $false
}
if ($OutputFile) { $result | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $OutputFile -Encoding utf8 }
$result | ConvertTo-Json -Depth 30
if ($Mode -eq "Execute" -and $result.readiness -ne "READY_FOR_D4_EXECUTION") { exit 1 }
if ($errors.Count -gt 0 -and $Mode -eq "Plan") { exit 1 }
