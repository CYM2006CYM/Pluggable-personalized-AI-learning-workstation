[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RepositoryRoot,
    [string[]]$CSourcePaths = @(
        "pi-study-helper/src/infrastructure/activity-rubric.ts",
        "pi-study-helper/src/infrastructure/code-evaluation-port.ts",
        "pi-study-helper/src/infrastructure/evaluation-protocol.ts",
        "pi-study-helper/src/infrastructure/python-process-evaluation-adapter.ts"
    ),
    [string]$OutputFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$forbidden = @(
    '\bAttemptRepository\b', '\bEvidenceRepository\b', '\bKnowledgeStateRepository\b',
    '\bPathRepository\b', '\bSessionCommitCandidate\b', '\bcommitEvidence\b',
    '\bpublishKnowledgeState\b', '\bwriteFormalFacts\b',
    '\bCheckpointRepository\b', '\bcheckpoint(?:s)?\s*\.?(?:save|write|create)\b',
    '\bAttempt(?:Repository|Store)\b', '\bEvidence(?:Repository|Store)\b',
    '\bKnowledgeState(?:Repository|Store)\b', '\bPath(?:Repository|Store)\b'
)
$files = foreach ($relativePath in $CSourcePaths) {
    $path = Join-Path $RepositoryRoot $relativePath
    if (Test-Path -LiteralPath $path -PathType Container) {
        Get-ChildItem -LiteralPath $path -Recurse -File | Where-Object { $_.Extension -in ".ts", ".tsx", ".mjs", ".js" }
    } elseif (Test-Path -LiteralPath $path -PathType Leaf) {
        Get-Item -LiteralPath $path
    } else {
        throw "C source path not found: $relativePath"
    }
}
$files = @($files | Sort-Object FullName -Unique)
$matches = foreach ($file in $files) {
    $source = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
    foreach ($pattern in $forbidden) {
        if ($source -match $pattern) {
            [ordered]@{ file = $file.FullName; pattern = $pattern }
        }
    }
}
$result = [ordered]@{
    schemaVersion = "w3-d3-c-boundary-scan-r3-v1"
    gate = "V3-4"
    filesScanned = $files.Count
    expectedFiles = @(
        "activity-rubric.ts",
        "code-evaluation-port.ts",
        "evaluation-protocol.ts",
        "python-process-evaluation-adapter.ts"
    )
    forbiddenPatterns = $forbidden
    matches = @($matches)
    publicOutputContract = "ActivityResult only"
    formalFactsOwner = "A transaction entry"
    formalFactsWrites = "NONE"
    status = if (@($matches).Count -eq 0) { "PASS" } else { "BLOCKED" }
}
if ($OutputFile) { $result | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $OutputFile -Encoding utf8 }
$result | ConvertTo-Json -Depth 20
if (@($matches).Count -gt 0) { exit 1 }
