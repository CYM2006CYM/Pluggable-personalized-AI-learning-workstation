[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$InputManifest,
    [Parameter(Mandatory = $true)] [string]$RepositoryRoot,
    [string]$OwnerHandoffRoot,
    [string[]]$RequiredInputIds = @(),
    [switch]$AllowUnavailableEOwnedInputs,
    [string]$OutputFile
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$manifest = Get-Content -LiteralPath $InputManifest -Raw -Encoding UTF8 | ConvertFrom-Json
$repoRoot = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$handoffRoot = if ([string]::IsNullOrWhiteSpace($OwnerHandoffRoot)) { "" } else { (Resolve-Path -LiteralPath $OwnerHandoffRoot).Path }
$errors = [System.Collections.Generic.List[string]]::new()
$checks = [System.Collections.Generic.List[object]]::new()

function Add-Check {
    param([string]$Id, [string]$Kind, [bool]$Passed, [string]$Actual)
    $checks.Add([ordered]@{ id = $Id; kind = $Kind; passed = $Passed; actual = $Actual })
    if (-not $Passed) { $errors.Add("$Id $Kind mismatch") }
}

function Test-RawHash {
    param([string]$Id, [string]$Path, [string]$Expected, [string]$Kind = "raw-byte-sha256")
    $exists = Test-Path -LiteralPath $Path -PathType Leaf
    $actual = if ($exists) { (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant() } else { "MISSING" }
    Add-Check $Id $Kind ($exists -and $actual -eq $Expected) $actual
}

if ($manifest.schemaVersion -ne "w3-d3-input-manifest-v2") { $errors.Add("manifest schema mismatch") }
if ($manifest.contractVersion -ne "W3-C5/W3-R2") { $errors.Add("manifest contract mismatch") }
$actualHead = (& git -C $repoRoot rev-parse HEAD).Trim()
$actualOrigin = (& git -C $repoRoot rev-parse origin/main).Trim()
Add-Check "repository-head" "exact-commit" ($actualHead -eq [string]$manifest.repositorySnapshot.head) $actualHead
Add-Check "repository-origin-main" "exact-commit" ($actualOrigin -eq [string]$manifest.repositorySnapshot.originMain) $actualOrigin

foreach ($inputItem in $manifest.inputs) {
    $id = [string]$inputItem.id
    if ($RequiredInputIds.Count -gt 0 -and $id -notin $RequiredInputIds) { continue }
    $status = [string]$inputItem.status
    if ($status -eq "PENDING") {
        Add-Check $id "pending-marker" $true "PENDING"
        continue
    }
    if ($status -ne "FROZEN") {
        Add-Check $id "status" $false $status
        continue
    }

    switch ([string]$inputItem.pathKind) {
        "git-object" {
            $commit = [string]$inputItem.gitCommit
            & git -C $repoRoot cat-file -e "$commit^{commit}" 2>$null
            $exists = $LASTEXITCODE -eq 0
            if ($exists) {
                & git -C $repoRoot merge-base --is-ancestor $commit HEAD
                $exists = $LASTEXITCODE -eq 0
            }
            Add-Check $id "git-ancestor" $exists $commit
        }
        "repo-relative" {
            $path = Join-Path $repoRoot ([string]$inputItem.path)
            Test-RawHash $id $path ([string]$inputItem.sha256)
            if ($id -eq "a-d3-deterministic-test-files" -and $null -ne $inputItem.additionalHashes) {
                foreach ($property in $inputItem.additionalHashes.PSObject.Properties) {
                    $testPath = Join-Path $repoRoot ("pi-study-helper/tests/{0}" -f $property.Name)
                    Test-RawHash "$id/$($property.Name)" $testPath ([string]$property.Value) "declared-test-sha256"
                }
            }
        }
        "owner-handoff-relative" {
            if ([string]::IsNullOrWhiteSpace($handoffRoot)) {
                Add-Check $id "owner-handoff-root" $false "MISSING_ROOT"
            } else {
                Test-RawHash $id (Join-Path $handoffRoot ([string]$inputItem.path)) ([string]$inputItem.sha256)
            }
        }
        "external-absolute" {
            $path = [string]$inputItem.path
            if ($AllowUnavailableEOwnedInputs -and [string]$inputItem.owner -eq "E" -and -not (Test-Path -LiteralPath $path -PathType Leaf)) {
                $checks.Add([ordered]@{ id = $id; kind = "e-owned-external-not-available-to-owner"; passed = $true; actual = "NOT_REVERIFIED" })
            } else {
                Test-RawHash $id $path ([string]$inputItem.sha256)
            }
        }
        "logical" {
            if ($id -in @("b-asset-inspect", "b-asset-practical")) {
                $bundlesPath = Join-Path $repoRoot "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/assessments/private/task-bundles.json"
                $bundles = Get-Content -LiteralPath $bundlesPath -Raw -Encoding UTF8 | ConvertFrom-Json
                $activityId = if ($id -eq "b-asset-inspect") { "act-inspect-dataframe" } else { "act-practical" }
                $bundle = $bundles.bundles | Where-Object { $_.activity.activityId -eq $activityId }
                $actual = [string]$bundle.assetBundleHash
                Add-Check $id "assetBundleHash" ($actual -eq [string]$inputItem.sha256) $actual
            } elseif ($id -eq "c-environment-hash") {
                $environmentPath = Join-Path $repoRoot "pi-study-helper/fixtures/profiles/pandas-cleaning-v2-draft/environments/environment-lock.json"
                $environment = Get-Content -LiteralPath $environmentPath -Raw -Encoding UTF8 | ConvertFrom-Json
                $actual = ([string]$environment.environmentHash).Replace("sha256:", "")
                Add-Check $id "environmentHash" ($actual -eq [string]$inputItem.sha256) $actual
            } else {
                Add-Check $id "logical-kind" $false "UNSUPPORTED"
            }
        }
        default {
            Add-Check $id "path-kind" $false ([string]$inputItem.pathKind)
        }
    }
}

$result = [ordered]@{
    schemaVersion = "w3-d3-input-binding-evidence-r4-v1"
    contractVersion = "W3-C5/W3-R2"
    deliveryStage = "W3-D3"
    fullV3Status = "NOT_RUN_D3"
    repositoryHead = $actualHead
    repositoryOriginMain = $actualOrigin
    inputCount = $manifest.inputs.Count
    checkedInputIds = if ($RequiredInputIds.Count -gt 0) { @($RequiredInputIds) } else { @($manifest.inputs | ForEach-Object { [string]$_.id }) }
    frozenCount = @($manifest.inputs | Where-Object { $_.status -eq "FROZEN" }).Count
    pendingCount = @($manifest.inputs | Where-Object { $_.status -eq "PENDING" }).Count
    checks = @($checks)
    errors = @($errors)
    status = if ($errors.Count -eq 0) { "INPUT_BINDING_PASS_D3" } else { "INPUT_BINDING_INVALID_D3" }
}
if ($OutputFile) { $result | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $OutputFile -Encoding utf8 }
$result | ConvertTo-Json -Depth 100
if ($errors.Count -gt 0) { exit 1 }
