param(
    [string]$BackupDir = ".\backups",
    [string]$Label = "sandbox_hotel"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-EnvInt {
    param(
        [string]$Name,
        [int]$DefaultValue
    )

    $rawValue = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($rawValue)) {
        return $DefaultValue
    }
    return [int]$rawValue
}

function Get-RedactedDatabaseTarget {
    param([string]$DatabaseUrl)

    try {
        $uri = [System.Uri]$DatabaseUrl
        $hostPart = if ($uri.IsDefaultPort) { $uri.Host } else { "$($uri.Host):$($uri.Port)" }
        return "{0}://***@{1}{2}" -f $uri.Scheme, $hostPart, $uri.AbsolutePath
    } catch {
        return "[unparseable database url]"
    }
}

if (-not $env:DATABASE_URL) {
    throw "DATABASE_URL is required."
}

$pgDumpBin = if ($env:PG_DUMP_BIN) { $env:PG_DUMP_BIN } else { "pg_dump" }
$retentionDays = Get-EnvInt -Name "BACKUP_RETENTION_DAYS" -DefaultValue 14
$encryptionRequired = [Environment]::GetEnvironmentVariable("BACKUP_ENCRYPTION_REQUIRED") -eq "1"
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDirAbsolute = [System.IO.Path]::GetFullPath($BackupDir)
$baseName = "{0}_{1}" -f $Label, $timestamp
$outputPath = Join-Path $backupDirAbsolute "$baseName.dump"
$checksumPath = "$outputPath.sha256"
$manifestPath = "$outputPath.json"

New-Item -ItemType Directory -Force -Path $backupDirAbsolute | Out-Null

Write-Host "Writing backup to $outputPath"
& $pgDumpBin --format=custom --no-owner --no-privileges --file="$outputPath" "$env:DATABASE_URL"
$lastExitVariable = Get-Variable LASTEXITCODE -ErrorAction SilentlyContinue
$lastExitCode = if ($lastExitVariable) { $lastExitVariable.Value } else { $null }
if ($null -ne $lastExitCode -and $lastExitCode -ne 0) {
    throw "pg_dump failed with exit code $lastExitCode."
}

$checksum = (Get-FileHash -Path $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -Path $checksumPath -Value $checksum -NoNewline

$manifest = [ordered]@{
    label = $Label
    backup_file = [System.IO.Path]::GetFileName($outputPath)
    created_at_utc = (Get-Date).ToUniversalTime().ToString("o")
    database_target = Get-RedactedDatabaseTarget -DatabaseUrl $env:DATABASE_URL
    checksum_sha256 = $checksum
    retention_days = $retentionDays
    storage_encryption_required = $encryptionRequired
    restore_verify_command = $env:RESTORE_VERIFY_COMMAND
}
$manifest | ConvertTo-Json | Set-Content -Path $manifestPath

if ($retentionDays -gt 0) {
    $cutoff = (Get-Date).ToUniversalTime().AddDays(-$retentionDays)
    Get-ChildItem -Path $backupDirAbsolute -Filter "*.dump" -File |
        Where-Object { $_.LastWriteTimeUtc -lt $cutoff } |
        ForEach-Object {
            Remove-Item -Path $_.FullName -Force -ErrorAction SilentlyContinue
            Remove-Item -Path "$($_.FullName).sha256" -Force -ErrorAction SilentlyContinue
            Remove-Item -Path "$($_.FullName).json" -Force -ErrorAction SilentlyContinue
        }
}

Write-Host "Backup complete."
Write-Host "Checksum: $checksum"
Write-Host "Manifest: $manifestPath"
