[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$W2DifficultyGold,
    [Parameter(Mandatory = $true)] [string]$W2PathConstraints,
    [Parameter(Mandatory = $true)] [string]$W2AdjudicationLog,
    [Parameter(Mandatory = $true)] [string]$DifficultyGoldCandidate,
    [Parameter(Mandatory = $true)] [string]$PathConstraintsCandidate,
    [Parameter(Mandatory = $true)] [string]$PublicAdjudicationIndex,
    [Parameter(Mandatory = $true)] [string]$OwnerFreezeRecord,
    [Parameter(Mandatory = $true)] [string]$OwnerPublicAttestation,
    [Parameter(Mandatory = $true)] [string]$OwnerVerification,
    [string]$OutputFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Read-JsonLines {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "JSONL not found: $Path" }
    $lines = @(Get-Content -LiteralPath $Path -Encoding UTF8)
    $rows = for ($index = 0; $index -lt $lines.Count; $index++) {
        if ([string]::IsNullOrWhiteSpace($lines[$index])) { throw "Blank JSONL line at ${Path}:$($index + 1)" }
        try { $lines[$index] | ConvertFrom-Json } catch { throw "Invalid JSONL at ${Path}:$($index + 1)" }
    }
    return [ordered]@{ lines = $lines; rows = @($rows) }
}

function Read-JsonFile {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "JSON not found: $Path" }
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Get-Sha256 {
    param([string]$Path)
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Get-Utf8LineSha256 {
    param([string]$Line)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Line + [char]10)
        return ([BitConverter]::ToString($sha.ComputeHash($bytes)) -replace '-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
    }
}

function Test-BytePrefix {
    param([string]$PrefixFile, [string]$CandidateFile)
    $prefix = [System.IO.File]::ReadAllBytes($PrefixFile)
    $candidate = [System.IO.File]::ReadAllBytes($CandidateFile)
    if ($candidate.Length -lt $prefix.Length) { return $false }
    for ($index = 0; $index -lt $prefix.Length; $index++) {
        if ($prefix[$index] -ne $candidate[$index]) { return $false }
    }
    return $true
}

$difficulty = Read-JsonLines $DifficultyGoldCandidate
$paths = Read-JsonLines $PathConstraintsCandidate
$publicIndex = Read-JsonLines $PublicAdjudicationIndex
$w2Difficulty = Read-JsonLines $W2DifficultyGold
$w2Paths = Read-JsonLines $W2PathConstraints
$w2Adjudication = Read-JsonLines $W2AdjudicationLog
$freeze = Read-JsonFile $OwnerFreezeRecord
$attestation = Read-JsonFile $OwnerPublicAttestation
$verification = Read-JsonFile $OwnerVerification
$expectedCaseIds = @(1..60 | ForEach-Object { "final-{0:d3}" -f $_ })
$errors = [System.Collections.Generic.List[string]]::new()

function Assert-Coverage {
    param([object[]]$Rows, [string]$Name)
    $ids = @($Rows | ForEach-Object { [string]$_.caseId })
    if ($Rows.Count -ne 60) { $errors.Add("$Name count must be 60") }
    if (($expectedCaseIds -join '|') -ne ($ids -join '|')) { $errors.Add("$Name coverage/order mismatch") }
    if (@($ids | Sort-Object -Unique).Count -ne 60) { $errors.Add("$Name contains duplicate caseId") }
}

Assert-Coverage $difficulty.rows "difficulty candidate"
Assert-Coverage $paths.rows "path candidate"
Assert-Coverage $publicIndex.rows "public adjudication index"
if ($w2Difficulty.rows.Count -ne 20) { $errors.Add("W2 difficulty baseline must contain 20 rows") }
if ($w2Paths.rows.Count -ne 20) { $errors.Add("W2 path baseline must contain 20 rows") }
if ($w2Adjudication.rows.Count -ne 20) { $errors.Add("W2 adjudication baseline must contain 20 rows") }

if (-not (Test-BytePrefix $W2DifficultyGold $DifficultyGoldCandidate)) {
    $errors.Add("difficulty candidate first20 raw bytes differ from W2")
}
if (-not (Test-BytePrefix $W2PathConstraints $PathConstraintsCandidate)) {
    $errors.Add("path candidate first20 raw bytes differ from W2")
}
for ($index = 0; $index -lt [Math]::Min(20, $publicIndex.rows.Count); $index++) {
    $expectedHash = Get-Utf8LineSha256 $w2Adjudication.lines[$index]
    if ([string]$publicIndex.rows[$index].adjudicationRecordSha256 -ne $expectedHash) {
        $errors.Add("public adjudication index differs from W2 at final-{0:d3}" -f ($index + 1))
    }
}
if (@($publicIndex.rows | Select-Object -Skip 20 | Where-Object { [string]$_.negotiationStatus -ne "SKIPPED_BY_D44" }).Count -ne 0) {
    $errors.Add("public adjudication index D44 status mismatch")
}

$actualHashes = [ordered]@{
    difficulty = Get-Sha256 $DifficultyGoldCandidate
    paths = Get-Sha256 $PathConstraintsCandidate
    publicIndex = Get-Sha256 $PublicAdjudicationIndex
    freeze = Get-Sha256 $OwnerFreezeRecord
    attestation = Get-Sha256 $OwnerPublicAttestation
    verification = Get-Sha256 $OwnerVerification
}

if ($freeze.schemaVersion -ne "w3-d3-owner-readonly-gold-candidate-v1") { $errors.Add("freeze schema mismatch") }
if ($freeze.status -ne "OWNER_READONLY_GOLD_CANDIDATE") { $errors.Add("freeze status mismatch") }
if ($freeze.contractVersion -ne "W3-C5/W3-R2") { $errors.Add("freeze contract mismatch") }
if ($freeze.qualification.status -ne "PASS") { $errors.Add("double blind qualification is not PASS") }
if ($freeze.scope.totalCaseCount -ne 60 -or $freeze.scope.newlyAdjudicatedCaseCount -ne 40) { $errors.Add("freeze scope mismatch") }
if ($freeze.checks.first20RawBytesPreserved -ne $true) { $errors.Add("freeze first20 preservation is not true") }
if ($freeze.checks.final021To060NegotiationStatus -ne "SKIPPED_BY_D44") { $errors.Add("freeze D44 status mismatch") }
if ($freeze.checks.formal60SystemRunBeforeFreezeCount -ne 0) { $errors.Add("formal system run existed before freeze") }
if ($freeze.access.formalGold -ne $false -or $freeze.access.readonlyCandidate -ne $true) { $errors.Add("freeze access boundary mismatch") }
if ($freeze.payload.difficulty.sha256 -ne $actualHashes.difficulty) { $errors.Add("freeze difficulty hash mismatch") }
if ($freeze.payload.paths.sha256 -ne $actualHashes.paths) { $errors.Add("freeze path hash mismatch") }

if ($attestation.schemaVersion -ne "w3-d3-owner-candidate-public-attestation-v1") { $errors.Add("attestation schema mismatch") }
if ($attestation.status -ne "OWNER_READONLY_GOLD_CANDIDATE" -or $attestation.formalGold -ne $false -or $attestation.gitUploadAuthorized -ne $false) { $errors.Add("attestation boundary mismatch") }
if ($attestation.files.difficulty.sha256 -ne $actualHashes.difficulty) { $errors.Add("attestation difficulty hash mismatch") }
if ($attestation.files.paths.sha256 -ne $actualHashes.paths) { $errors.Add("attestation path hash mismatch") }
if ($attestation.files.publicAdjudicationIndex.sha256 -ne $actualHashes.publicIndex) { $errors.Add("attestation public index hash mismatch") }
if ($attestation.files.ownerFreezeRecord.sha256 -ne $actualHashes.freeze) { $errors.Add("attestation freeze hash mismatch") }
if ($attestation.files.ownerVerification.sha256 -ne $actualHashes.verification) { $errors.Add("attestation verification hash mismatch") }
if ($attestation.files.withheldAdjudicationCandidate.sha256 -ne $freeze.payload.adjudication.sha256) { $errors.Add("withheld adjudication hash attestation mismatch") }
if ($attestation.files.withheldMechanicalDifferences.sha256 -ne $freeze.payload.differences.sha256) { $errors.Add("withheld differences hash attestation mismatch") }
if ($verification.status -ne "PASS" -or $verification.checks.first20RawBytesPreserved -ne $true) { $errors.Add("owner verification status mismatch") }

$result = [ordered]@{
    schemaVersion = "w3-d4-gold-freeze-check-r4-v1"
    contractVersion = "W3-C5/W3-R2"
    gate = "V3-7"
    candidateCounts = [ordered]@{ difficulty = $difficulty.rows.Count; paths = $paths.rows.Count; publicIndex = $publicIndex.rows.Count }
    first20 = [ordered]@{ difficultyRawPrefix = -not ($errors -contains "difficulty candidate first20 raw bytes differ from W2"); pathRawPrefix = -not ($errors -contains "path candidate first20 raw bytes differ from W2"); adjudicationHashesChecked = [Math]::Min(20, $publicIndex.rows.Count) }
    final021To060NegotiationStatus = "SKIPPED_BY_D44"
    visibleFileSha256 = $actualHashes
    withheldMaterialRead = $false
    formalGold = $false
    errors = @($errors)
    status = if ($errors.Count -eq 0) { "PASS" } else { "BLOCKED" }
}
if ($OutputFile) { $result | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $OutputFile -Encoding utf8 }
$result | ConvertTo-Json -Depth 30
if ($errors.Count -gt 0) { exit 1 }
