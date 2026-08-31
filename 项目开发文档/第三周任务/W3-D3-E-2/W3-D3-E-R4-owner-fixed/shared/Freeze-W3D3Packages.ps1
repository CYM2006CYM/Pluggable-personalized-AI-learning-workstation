[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$W3D3Root,
    [string]$RevisionSuffix = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = (Resolve-Path -LiteralPath $W3D3Root).Path
$sourceRoot = Join-Path $root "source"
$planRoot = Join-Path $root "plan-evidence"
$freezeRoot = Join-Path $root "baseline-freeze$RevisionSuffix"
$packageRoot = Join-Path $root "packages$RevisionSuffix"
$stagingRoot = Join-Path $packageRoot "staging"
$verifyRoot = Join-Path $packageRoot "verify"

foreach ($path in @($freezeRoot, $packageRoot)) {
    if (Test-Path -LiteralPath $path) { throw "Refusing to overwrite existing freeze output: $path" }
}

New-Item -ItemType Directory -Path $freezeRoot, $stagingRoot, $verifyRoot | Out-Null

function Get-RelativePath {
    param([string]$Base, [string]$Path)
    return $Path.Substring($Base.Length + 1).Replace('\', '/')
}

function Write-HashManifest {
    param([string]$Directory, [string]$ManifestName)
    $manifestPath = Join-Path $Directory $ManifestName
    $files = Get-ChildItem -LiteralPath $Directory -Recurse -File |
        Where-Object { $_.FullName -ne $manifestPath } |
        Sort-Object FullName
    $lines = foreach ($file in $files) {
        $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash.ToLowerInvariant()
        "$hash  $(Get-RelativePath -Base $Directory -Path $file.FullName)"
    }
    Set-Content -LiteralPath $manifestPath -Value $lines -Encoding utf8
    return [ordered]@{ path = $manifestPath; count = $files.Count; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $manifestPath).Hash.ToLowerInvariant() }
}

function Copy-GatePackage {
    param([int]$Number)
    $gate = "V3-$Number"
    $name = "W3-D3-E-$gate-tools$RevisionSuffix"
    $stage = Join-Path $stagingRoot $name
    New-Item -ItemType Directory -Path $stage, (Join-Path $stage "tools") | Out-Null
    Copy-Item -LiteralPath (Join-Path $sourceRoot "gates/$gate/gate-config.json"), (Join-Path $sourceRoot "gates/$gate/evidence-template.json"), (Join-Path $sourceRoot "gates/$gate/test-cases.md"), (Join-Path $sourceRoot "gates/$gate/DELIVERY.md") -Destination $stage
    Copy-Item -LiteralPath (Join-Path $sourceRoot "shared/Invoke-W3D3Gate.ps1") -Destination (Join-Path $stage "tools")
    if ($gate -eq "V3-4") { Copy-Item -LiteralPath (Join-Path $sourceRoot "shared/Test-CBoundary.ps1") -Destination (Join-Path $stage "tools") }
    if ($gate -eq "V3-7") { Copy-Item -LiteralPath (Join-Path $sourceRoot "shared/Test-GoldFreeze.ps1") -Destination (Join-Path $stage "tools") }
    if ($gate -eq "V3-8") { Copy-Item -LiteralPath (Join-Path $sourceRoot "shared/Test-WebBoundary.ps1") -Destination (Join-Path $stage "tools") }
    Copy-Item -LiteralPath (Join-Path $sourceRoot "input-manifest/W3-D3-input-manifest.json") -Destination (Join-Path $stage "input-manifest.json")
    Copy-Item -LiteralPath (Join-Path $planRoot "$gate/v3-$Number-plan-evidence.json") -Destination (Join-Path $stage "plan-evidence.json")
    [void](Write-HashManifest -Directory $stage -ManifestName "PACKAGE-PAYLOAD.sha256")
    return [ordered]@{ name = $name; stage = $stage }
}

$packages = [System.Collections.Generic.List[object]]::new()
foreach ($number in 1..8) { $packages.Add((Copy-GatePackage -Number $number)) }

$inputName = "W3-D3-E-input-manifest$RevisionSuffix"
$inputStage = Join-Path $stagingRoot $inputName
New-Item -ItemType Directory -Path $inputStage, (Join-Path $inputStage "tools") | Out-Null
Copy-Item -Path (Join-Path $sourceRoot "input-manifest/*") -Destination $inputStage
Copy-Item -LiteralPath (Join-Path $sourceRoot "shared/Test-W3D3InputManifest.ps1") -Destination (Join-Path $inputStage "tools")
Copy-Item -LiteralPath (Join-Path $planRoot "input-manifest/input-binding-evidence.json") -Destination $inputStage
[void](Write-HashManifest -Directory $inputStage -ManifestName "PACKAGE-PAYLOAD.sha256")
$packages.Add([ordered]@{ name = $inputName; stage = $inputStage })

$baseFiles = @(
    Get-ChildItem -LiteralPath $sourceRoot -Recurse -File
    Get-ChildItem -LiteralPath $planRoot -Recurse -File
    Get-Item -LiteralPath (Join-Path $root "W3-D3-E-delivery-report.md")
    Get-Item -LiteralPath (Join-Path $root "W3-D3-E-self-test-record.md")
    Get-Item -LiteralPath (Join-Path $root "W3-D3-E-package-index.md")
) | Sort-Object FullName
$baseLines = foreach ($file in $baseFiles) {
    $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash.ToLowerInvariant()
    "$hash  $(Get-RelativePath -Base $root -Path $file.FullName)"
}
$sourceHashPath = Join-Path $freezeRoot "W3-D3-E-source-hashes.sha256"
Set-Content -LiteralPath $sourceHashPath -Value $baseLines -Encoding utf8
$sourceHashSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourceHashPath).Hash.ToLowerInvariant()
$freezeRecord = [ordered]@{
    schemaVersion = "w3-d3-e-baseline-freeze-v1"
    contractVersion = "W3-C5/W3-R2"
    deliveryStage = "W3-D3"
    fullV3Status = "NOT_RUN_D3"
    gateConclusions = "NOT_PRODUCED_D3"
    sourceFileCount = $baseFiles.Count
    sourceHashManifest = "W3-D3-E-source-hashes.sha256"
    sourceHashManifestSha256 = $sourceHashSha
    gateCount = 8
    inputCount = 22
    frozenInputCount = 19
    pendingInputCount = 3
    planEvidenceCount = 8
    executedGateCommandCount = 0
    freezeCreatedAt = [DateTimeOffset]::Now.ToString("o")
}
$freezeRecordPath = Join-Path $freezeRoot "W3-D3-E-freeze-record.json"
$freezeRecord | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $freezeRecordPath -Encoding utf8

$baselineName = "W3-D3-E-baseline-freeze$RevisionSuffix"
$baselineStage = Join-Path $stagingRoot $baselineName
New-Item -ItemType Directory -Path $baselineStage | Out-Null
Copy-Item -LiteralPath $sourceRoot -Destination $baselineStage -Recurse
Copy-Item -LiteralPath $planRoot -Destination $baselineStage -Recurse
Copy-Item -LiteralPath $freezeRoot -Destination $baselineStage -Recurse
Copy-Item -LiteralPath (Join-Path $root "W3-D3-E-delivery-report.md") -Destination (Join-Path $baselineStage "DELIVERY.md")
Copy-Item -LiteralPath (Join-Path $root "W3-D3-E-self-test-record.md"), (Join-Path $root "W3-D3-E-package-index.md") -Destination $baselineStage
[void](Write-HashManifest -Directory $baselineStage -ManifestName "PACKAGE-PAYLOAD.sha256")
$packages.Add([ordered]@{ name = $baselineName; stage = $baselineStage })

$zipRecords = foreach ($package in $packages) {
    $zipPath = Join-Path $packageRoot ("{0}.zip" -f $package.name)
    & tar.exe -a -c -f $zipPath -C $package.stage .
    if ($LASTEXITCODE -ne 0) { throw "Failed to create $zipPath" }
    [ordered]@{
        name = $package.name
        zipPath = $zipPath
        sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()
    }
}

$verification = foreach ($record in $zipRecords) {
    $verifyDirectory = Join-Path $verifyRoot $record.name
    Expand-Archive -LiteralPath $record.zipPath -DestinationPath $verifyDirectory
    $manifestPath = Join-Path $verifyDirectory "PACKAGE-PAYLOAD.sha256"
    $lines = Get-Content -LiteralPath $manifestPath -Encoding UTF8 | Where-Object { $_ -match '^[0-9a-fA-F]{64}  ' }
    $mismatches = foreach ($line in $lines) {
        $expected = $line.Substring(0, 64).ToLowerInvariant()
        $relative = $line.Substring(66)
        $path = Join-Path $verifyDirectory $relative
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            "MISSING $relative"
        } else {
            $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
            if ($actual -ne $expected) { "MISMATCH $relative" }
        }
    }
    [ordered]@{
        name = $record.name
        payloadCount = $lines.Count
        mismatchCount = @($mismatches).Count
        mismatches = @($mismatches)
    }
}

$failedVerification = @($verification | Where-Object { $_.mismatchCount -ne 0 })
if ($failedVerification.Count -gt 0) { throw "Package payload verification failed." }

$hashLines = @(
    "# W3-D3 E package SHA-256"
    "PACKAGE_COUNT $($zipRecords.Count)"
    "PACKAGE_RECALC_MISMATCHES 0"
) + @($zipRecords | ForEach-Object { "$($_.sha256)  $($_.name).zip" })
$packageHashPath = Join-Path $root "W3-D3-E-package-hashes$RevisionSuffix.sha256"
Set-Content -LiteralPath $packageHashPath -Value $hashLines -Encoding utf8
foreach ($record in $zipRecords) {
    Set-Content -LiteralPath (Join-Path $packageRoot ("{0}.zip.sha256" -f $record.name)) -Value ("$($record.sha256)  $($record.name).zip") -Encoding utf8
}

$verificationRecord = [ordered]@{
    schemaVersion = "w3-d3-e-package-verification-v1"
    contractVersion = "W3-C5/W3-R2"
    deliveryStage = "W3-D3"
    fullV3Status = "NOT_RUN_D3"
    packageCount = $zipRecords.Count
    packages = @($zipRecords | ForEach-Object { [ordered]@{ name = $_.name; sha256 = $_.sha256 } })
    payloadVerification = @($verification)
    mismatchCount = 0
    verifiedAt = [DateTimeOffset]::Now.ToString("o")
}
$verificationRecord | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath (Join-Path $root "W3-D3-E-package-verification$RevisionSuffix.json") -Encoding utf8

Write-Output "PACKAGES_FROZEN count=$($zipRecords.Count) mismatches=0 sourceFiles=$($baseFiles.Count)"

