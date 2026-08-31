[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$SourceRoot,
    [Parameter(Mandatory = $true)] [string]$OutputFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$root = (Resolve-Path -LiteralPath $SourceRoot).Path
$work = Join-Path $env:TEMP ("w3-d3-e-r4-self-test-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $work -Force | Out-Null

function Write-JsonLines([string]$Path, [object[]]$Rows) {
    @($Rows | ForEach-Object { $_ | ConvertTo-Json -Compress -Depth 30 }) | Set-Content -LiteralPath $Path -Encoding utf8
}
function Get-Sha256([string]$Path) { (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant() }
function Get-LineHash([string]$Line) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Line + [char]10))) -replace '-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}
function New-Rows([int]$Count, [string]$Kind) {
    @(1..$Count | ForEach-Object { [ordered]@{ caseId = "final-{0:d3}" -f $_; kind = $Kind; value = "fixture-$_" } })
}
function Invoke-Gold([hashtable]$Files) {
    & "$PSHOME/powershell.exe" -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "shared/Test-GoldFreeze.ps1") `
        -W2DifficultyGold $Files.w2Difficulty -W2PathConstraints $Files.w2Paths -W2AdjudicationLog $Files.w2Adjudication `
        -DifficultyGoldCandidate $Files.difficulty -PathConstraintsCandidate $Files.paths `
        -PublicAdjudicationIndex $Files.publicIndex -OwnerFreezeRecord $Files.freeze `
        -OwnerPublicAttestation $Files.attestation -OwnerVerification $Files.verification 1>$null 2>$null
    return $LASTEXITCODE
}

$files = @{
    w2Difficulty = Join-Path $work "w2-difficulty.jsonl"
    w2Paths = Join-Path $work "w2-paths.jsonl"
    w2Adjudication = Join-Path $work "w2-adjudication.jsonl"
    difficulty = Join-Path $work "difficulty.candidate.jsonl"
    paths = Join-Path $work "paths.candidate.jsonl"
    publicIndex = Join-Path $work "adjudication-public-index.jsonl"
    freeze = Join-Path $work "owner-candidate-freeze-record.json"
    attestation = Join-Path $work "owner-candidate-public-attestation.json"
    verification = Join-Path $work "owner-candidate-verification.json"
}
$w2DifficultyRows = New-Rows 20 "difficulty"
$w2PathRows = New-Rows 20 "path"
$w2AdjudicationRows = @(1..20 | ForEach-Object { [ordered]@{ caseId = "final-{0:d3}" -f $_; negotiationStatus = "W2_KEEP"; ownerDecision = [ordered]@{ value = $_ } } })
$difficultyRows = @($w2DifficultyRows) + @(21..60 | ForEach-Object { [ordered]@{ caseId = "final-{0:d3}" -f $_; kind = "difficulty"; value = "fixture-$_" } })
$pathRows = @($w2PathRows) + @(21..60 | ForEach-Object { [ordered]@{ caseId = "final-{0:d3}" -f $_; kind = "path"; value = "fixture-$_" } })
Write-JsonLines $files.w2Difficulty $w2DifficultyRows
Write-JsonLines $files.w2Paths $w2PathRows
Write-JsonLines $files.w2Adjudication $w2AdjudicationRows
Write-JsonLines $files.difficulty $difficultyRows
Write-JsonLines $files.paths $pathRows
$w2AdjudicationLines = @(Get-Content -LiteralPath $files.w2Adjudication -Encoding UTF8)
$publicRows = @(1..60 | ForEach-Object {
    $index = $_ - 1
    [ordered]@{
        caseId = "final-{0:d3}" -f $_
        negotiationStatus = if ($_ -le 20) { "W2_KEEP" } else { "SKIPPED_BY_D44" }
        signaturePrecedentCaseId = $null
        adjudicationRecordSha256 = if ($_ -le 20) { Get-LineHash $w2AdjudicationLines[$index] } else { ("a" * 64) }
        ownerDecisionSha256 = "b" * 64
    }
})
Write-JsonLines $files.publicIndex $publicRows

function Write-SafeRecords {
    $freeze = [ordered]@{
        schemaVersion = "w3-d3-owner-readonly-gold-candidate-v1"; status = "OWNER_READONLY_GOLD_CANDIDATE"; contractVersion = "W3-C5/W3-R2"
        scope = [ordered]@{ totalCaseCount = 60; newlyAdjudicatedCaseCount = 40 }
        qualification = [ordered]@{ status = "PASS"; sha256 = "c" * 64 }
        payload = [ordered]@{
            difficulty = [ordered]@{ sha256 = Get-Sha256 $files.difficulty }
            paths = [ordered]@{ sha256 = Get-Sha256 $files.paths }
            adjudication = [ordered]@{ sha256 = "d" * 64 }
            differences = [ordered]@{ sha256 = "e" * 64 }
        }
        checks = [ordered]@{ first20RawBytesPreserved = $true; final021To060NegotiationStatus = "SKIPPED_BY_D44"; formal60SystemRunBeforeFreezeCount = 0 }
        access = [ordered]@{ formalGold = $false; readonlyCandidate = $true }
    }
    $freeze | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $files.freeze -Encoding utf8
    $verification = [ordered]@{ status = "PASS"; checks = [ordered]@{ first20RawBytesPreserved = $true } }
    $verification | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $files.verification -Encoding utf8
    $attestation = [ordered]@{
        schemaVersion = "w3-d3-owner-candidate-public-attestation-v1"; status = "OWNER_READONLY_GOLD_CANDIDATE"; formalGold = $false; gitUploadAuthorized = $false
        files = [ordered]@{
            difficulty = [ordered]@{ sha256 = Get-Sha256 $files.difficulty }
            paths = [ordered]@{ sha256 = Get-Sha256 $files.paths }
            publicAdjudicationIndex = [ordered]@{ sha256 = Get-Sha256 $files.publicIndex }
            ownerFreezeRecord = [ordered]@{ sha256 = Get-Sha256 $files.freeze }
            ownerVerification = [ordered]@{ sha256 = Get-Sha256 $files.verification }
            withheldAdjudicationCandidate = [ordered]@{ sha256 = "d" * 64 }
            withheldMechanicalDifferences = [ordered]@{ sha256 = "e" * 64 }
        }
    }
    $attestation | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $files.attestation -Encoding utf8
}

Write-SafeRecords
$checks = [ordered]@{}
$checks.safeSchemaAccepted = (Invoke-Gold $files) -eq 0

$mutatedDifficulty = @($difficultyRows | ForEach-Object { $_ | ConvertTo-Json -Depth 20 | ConvertFrom-Json })
$mutatedDifficulty[0].value = "MUTATED_WITH_SAME_CASE_ID"
Write-JsonLines $files.difficulty $mutatedDifficulty
Write-SafeRecords
$checks.first20ContentMutationRejected = (Invoke-Gold $files) -ne 0
Write-JsonLines $files.difficulty $difficultyRows

$mutatedPublic = @($publicRows | ForEach-Object { $_ | ConvertTo-Json -Depth 20 | ConvertFrom-Json })
$mutatedPublic[0].adjudicationRecordSha256 = "f" * 64
Write-JsonLines $files.publicIndex $mutatedPublic
Write-SafeRecords
$checks.first20AdjudicationHashMutationRejected = (Invoke-Gold $files) -ne 0
Write-JsonLines $files.publicIndex $publicRows
Write-SafeRecords

$manifest = Join-Path $root "input-manifest/W3-D3-input-manifest.json"
$readiness = Join-Path $root "shared/Test-W3D4Readiness.ps1"
$readinessPlan = Join-Path $work "d4-readiness-plan.json"
& "$PSHOME/powershell.exe" -NoProfile -ExecutionPolicy Bypass -File $readiness -InputManifest $manifest -ToolRoot $root -Mode Plan -OutputFile $readinessPlan 1>$null 2>$null
$checks.d3ReadinessPlanAccepted = $LASTEXITCODE -eq 0
if ($checks.d3ReadinessPlanAccepted) {
    $readinessPlanValue = Get-Content -LiteralPath $readinessPlan -Raw -Encoding UTF8 | ConvertFrom-Json
    $checks.emptyFixedTraceCommandsDetected = $readinessPlanValue.fixedTraceCommandsReady -eq $false
}
& "$PSHOME/powershell.exe" -NoProfile -ExecutionPolicy Bypass -File $readiness -InputManifest $manifest -ToolRoot $root -Mode Execute 1>$null 2>$null
$checks.missingD4TokenRejected = $LASTEXITCODE -ne 0
& "$PSHOME/powershell.exe" -NoProfile -ExecutionPolicy Bypass -File $readiness -InputManifest $manifest -ToolRoot $root -Mode Execute -D4AuthorizationToken W3-D4 1>$null 2>$null
$checks.dPendingBlocksD4Execute = $LASTEXITCODE -ne 0

$result = [ordered]@{
    schemaVersion = "w3-d3-e-r4-self-test-v1"
    contractVersion = "W3-C5/W3-R2"
    executionStatus = "NOT_RUN_D3"
    gateConclusion = "NOT_PRODUCED_D3"
    checks = $checks
    allPassed = @($checks.GetEnumerator() | Where-Object { -not $_.Value }).Count -eq 0
    workDirectory = $work
    note = "Synthetic rejection tests only; no D4, Python evaluator, formal 60-case system, real key, or online model was run."
}
$result | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $OutputFile -Encoding utf8
$result | ConvertTo-Json -Depth 30
if (-not $result.allPassed) { exit 1 }
