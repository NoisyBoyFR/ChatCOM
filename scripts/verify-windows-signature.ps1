[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Path,

  [string]$ExpectedSubject,

  [switch]$RequireTimestamp,

  [switch]$Recurse,

  [switch]$SkipSignTool
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Stop-SignatureVerification {
  param([Parameter(Mandatory = $true)][string]$Code)
  Write-Output "CHATCOM_SIGNATURE kind=FAILURE code=$Code"
  exit 1
}

try {
  $resolved = Resolve-Path -LiteralPath $Path -ErrorAction Stop
  $item = Get-Item -LiteralPath $resolved.Path -Force
  if ($item.PSIsContainer) {
    if (-not $Recurse) { Stop-SignatureVerification "DIRECTORY_REQUIRES_RECURSE" }
    $targets = @(Get-ChildItem -LiteralPath $item.FullName -Recurse -File | Where-Object { $_.Extension.ToLowerInvariant() -in ".exe", ".dll", ".node" })
  } else {
    $targets = @($item)
  }

  if ($targets.Count -eq 0) { Stop-SignatureVerification "NO_SIGNABLE_FILES" }

  $signTool = $null
  if (-not $SkipSignTool) {
    $signToolCommand = Get-Command signtool.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($signToolCommand) {
      $signTool = $signToolCommand.Source
    } else {
      $kitsRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
      $signTool = Get-ChildItem -LiteralPath $kitsRoot -Filter signtool.exe -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.DirectoryName -like "*\x64" } |
        Sort-Object FullName -Descending |
        Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $signTool) { Stop-SignatureVerification "SIGNTOOL_UNAVAILABLE" }
  }

  foreach ($target in $targets) {
    $signature = Get-AuthenticodeSignature -LiteralPath $target.FullName
    if ($signature.Status -ne "Valid" -or -not $signature.SignerCertificate) {
      Stop-SignatureVerification "AUTHENTICODE_INVALID"
    }
    if ($ExpectedSubject -and $signature.SignerCertificate.Subject -cne $ExpectedSubject) {
      Stop-SignatureVerification "PUBLISHER_MISMATCH"
    }
    if ($RequireTimestamp -and -not $signature.TimeStamperCertificate) {
      Stop-SignatureVerification "TIMESTAMP_MISSING"
    }
    if (-not $SkipSignTool) {
      & $signTool verify /pa /all /v $target.FullName *> $null
      if ($LASTEXITCODE -ne 0) { Stop-SignatureVerification "SIGNTOOL_VERIFY_FAILED" }
    }
  }

  Write-Output "CHATCOM_SIGNATURE kind=VALID files=$($targets.Count) publisher=$([bool]$ExpectedSubject) timestamp=$([bool]$RequireTimestamp)"
} catch {
  Stop-SignatureVerification "SIGNATURE_CHECK_FAILED"
}
