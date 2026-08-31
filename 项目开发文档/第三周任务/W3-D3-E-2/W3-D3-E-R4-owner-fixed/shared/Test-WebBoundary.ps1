[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$WebRoot,
    [Parameter(Mandatory = $true)]
    [string]$SourceRoot,
    [string]$OutputFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$webFiles = @(Get-ChildItem -LiteralPath $WebRoot -Recurse -File | Where-Object { $_.Extension -in ".ts", ".tsx", ".js", ".mjs" })
$forbidden = @(
    'correctAnswer', 'hiddenTest', 'referenceSolution', 'privateCsv', 'systemPrompt',
    'apiKey', 'score\s*\*\s*100', '\bfetch\s*\(', 'https?://', 'pyodide',
    'AttemptRepository', 'EvidenceRepository', 'KnowledgeStateRepository', 'PathRepository'
)
$matches = foreach ($file in $webFiles) {
    $source = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
    foreach ($pattern in $forbidden) {
        if ($source -match $pattern) { [ordered]@{ file = $file.FullName; pattern = $pattern } }
    }
}
$outsideWebFiles = @(Get-ChildItem -LiteralPath $SourceRoot -Recurse -File | Where-Object {
    $_.Extension -in ".ts", ".tsx" -and -not $_.FullName.StartsWith((Resolve-Path -LiteralPath $WebRoot).Path)
})
$fixtureLeaks = foreach ($file in $outsideWebFiles) {
    $source = Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8
    if ($source -match 'PAGE_DISPLAY_FIXTURES|ProfileDisplayFixture|DiagnosticQuestionDisplayFixture|LearningCardDisplayFixture') {
        $file.FullName
    }
}
$result = [ordered]@{
    schemaVersion = "w3-d3-web-boundary-scan-v1"
    gate = "V3-8"
    webFilesScanned = $webFiles.Count
    forbiddenMatches = @($matches)
    nonWebFixtureLeaks = @($fixtureLeaks)
    status = if (@($matches).Count -eq 0 -and @($fixtureLeaks).Count -eq 0) { "PASS" } else { "BLOCKED" }
}
if ($OutputFile) { $result | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $OutputFile -Encoding utf8 }
$result | ConvertTo-Json -Depth 20
if ($result.status -ne "PASS") { exit 1 }
