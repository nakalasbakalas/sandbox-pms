param(
    [Parameter(Mandatory = $true)]
    [string]$BackupFile,
    [switch]$DropExisting
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-StoredChecksum {
    param([string]$Path)

    if (-not (Test-Path $Path)) {
        return $null
    }
    return ((Get-Content -Path $Path -Raw).Trim() -split "\s+")[0].ToLowerInvariant()
}

if (-not $env:DATABASE_URL) {
    throw "DATABASE_URL is required."
}

if (-not (Test-Path $BackupFile)) {
    throw "Backup file not found: $BackupFile"
}

$backupFileAbsolute = [System.IO.Path]::GetFullPath($BackupFile)
$checksumFile = "$backupFileAbsolute.sha256"
$manifestFile = "$backupFileAbsolute.json"
$pgRestoreBin = if ($env:PG_RESTORE_BIN) { $env:PG_RESTORE_BIN } else { "pg_restore" }

$storedChecksum = Get-StoredChecksum -Path $checksumFile
if ($storedChecksum) {
    $actualChecksum = (Get-FileHash -Path $backupFileAbsolute -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($storedChecksum -ne $actualChecksum) {
        throw "Backup checksum verification failed."
    }
}

if (Test-Path $manifestFile) {
    $manifest = Get-Content -Path $manifestFile -Raw | ConvertFrom-Json
    Write-Host "Restore manifest loaded for $($manifest.backup_file)"
}

$args = @("--verbose", "--no-owner", "--no-privileges", "--dbname=$env:DATABASE_URL")
if ($DropExisting) {
    $args += @("--clean", "--if-exists")
}

Write-Host "Restoring $backupFileAbsolute into target database."
& $pgRestoreBin @args $backupFileAbsolute
$lastExitVariable = Get-Variable LASTEXITCODE -ErrorAction SilentlyContinue
$lastExitCode = if ($lastExitVariable) { $lastExitVariable.Value } else { $null }
if ($null -ne $lastExitCode -and $lastExitCode -ne 0) {
    throw "pg_restore failed with exit code $lastExitCode."
}

$verifyCommand = [Environment]::GetEnvironmentVariable("RESTORE_VERIFY_COMMAND")
if (-not [string]::IsNullOrWhiteSpace($verifyCommand)) {
    Write-Host "Running restore verification command."
    Invoke-Expression $verifyCommand
}

Write-Host "Restore complete."
