[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SourceRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$resolvedRoot = (Resolve-Path -LiteralPath $SourceRoot).Path
$manifestPath = Join-Path $resolvedRoot "input-manifest/W3-D3-input-manifest.json"
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$errors = [System.Collections.Generic.List[string]]::new()

if ($manifest.schemaVersion -ne "w3-d3-input-manifest-v2") { $errors.Add("input manifest schema") }
if ($manifest.contractVersion -ne "W3-C5/W3-R2") { $errors.Add("contract version") }
if ($manifest.deliveryStage -ne "W3-D3") { $errors.Add("delivery stage") }
if ($manifest.fullV3Status -ne "NOT_RUN_D3") { $errors.Add("full V3 status") }

$requiredIds = @(
    "w3-start-commit", "b-formal-commit", "b-task-bundles-file", "b-asset-inspect",
    "b-asset-practical", "c-formal-commit", "c-binding-fix-commit", "c-environment-lock",
    "c-environment-hash", "owner-profile-approval", "a-d3-formal-commit", "a-d3-deterministic-test-files",
    "d-d3-formal-commit", "d-d3-fixed-trace-test-manifest", "e-d1-sealed-annotations", "e-d2-r2-package",
    "owner-difficulty-gold-candidate",
    "owner-path-constraints-candidate",
    "owner-adjudication-public-index",
    "owner-freeze-record-candidate",
    "owner-public-attestation",
    "owner-candidate-verification",
    "w2-difficulty-gold",
    "w2-path-constraints",
    "w2-adjudication-log",
    "d47-ruling"
)
$presentIds = @($manifest.inputs | ForEach-Object { [string]$_.id })
foreach ($requiredId in $requiredIds) {
    if ($requiredId -notin $presentIds) { $errors.Add("missing input id $requiredId") }
}

$pendingExpected = @(
    "d-d3-formal-commit",
    "d-d3-fixed-trace-test-manifest"
)
foreach ($pendingId in $pendingExpected) {
    $entry = $manifest.inputs | Where-Object { $_.id -eq $pendingId }
    if ($null -eq $entry -or $entry.status -ne "PENDING") { $errors.Add("pending status $pendingId") }
}

$configs = Get-ChildItem -LiteralPath (Join-Path $resolvedRoot "gates") -Recurse -Filter "gate-config.json" -File | Sort-Object FullName
if ($configs.Count -ne 8) { $errors.Add("expected 8 gate configs, found $($configs.Count)") }
$gateIds = [System.Collections.Generic.HashSet[string]]::new()
foreach ($configFile in $configs) {
    $config = Get-Content -LiteralPath $configFile.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($config.schemaVersion -ne "w3-d3-gate-config-v1") { $errors.Add("config schema $($configFile.FullName)") }
    if ($config.contractVersion -ne "W3-C5/W3-R2") { $errors.Add("config contract $($configFile.FullName)") }
    if ([string]$config.gate -notmatch '^V3-[1-8]$') { $errors.Add("config gate $($configFile.FullName)") }
    if (-not $gateIds.Add([string]$config.gate)) { $errors.Add("duplicate gate $($config.gate)") }

    $gateDirectory = $configFile.Directory.FullName
    $templatePath = Join-Path $gateDirectory "evidence-template.json"
    $template = Get-Content -LiteralPath $templatePath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($template.executionStatus -ne "NOT_RUN_D3") { $errors.Add("template execution status $($config.gate)") }
    if ($template.gateConclusion -ne "NOT_PRODUCED_D3") { $errors.Add("template gate conclusion $($config.gate)") }
    foreach ($requiredInputId in $config.requiredInputIds) {
        if ([string]$requiredInputId -notin $presentIds) { $errors.Add("$($config.gate) unknown input $requiredInputId") }
    }
}

$traceConfigPath = Join-Path $resolvedRoot "layers/fixed-trace-demo/layer-config.json"
if (-not (Test-Path -LiteralPath $traceConfigPath -PathType Leaf)) { $errors.Add("fixed trace layer config missing") }
else {
    $trace = Get-Content -LiteralPath $traceConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($trace.contractVersion -ne "W3-C5/W3-R2") { $errors.Add("fixed trace contract") }
    if ("d-d3-formal-commit" -notin @($trace.requiredInputIds)) { $errors.Add("fixed trace D commit binding") }
    if ("d-d3-fixed-trace-test-manifest" -notin @($trace.requiredInputIds)) { $errors.Add("fixed trace test manifest binding") }
}

if ($errors.Count -gt 0) {
    $errors | ForEach-Object { Write-Error $_ }
    exit 1
}

Write-Output "BASELINE_STRUCTURE_PASS gates=8 layers=3 inputs=$($manifest.inputs.Count) pending=$($pendingExpected.Count) fullV3Status=NOT_RUN_D3"
