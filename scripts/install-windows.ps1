[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = "Medium")]
param(
  [string]$SourcePath,
  [string]$InstallRoot,
  [switch]$AddToUserPath
)

$ErrorActionPreference = "Stop"

function Stop-Install([string]$Code) {
  throw [System.InvalidOperationException]::new("CHATCOM_WINDOWS_INSTALL kind=FAILURE code=$Code")
}

function Normalize-PathForComparison([string]$Path) {
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $pathRoot = [System.IO.Path]::GetPathRoot($fullPath)
  if ([string]::Equals($fullPath, $pathRoot, [StringComparison]::OrdinalIgnoreCase)) {
    return $pathRoot
  }
  return $fullPath.TrimEnd("\")
}

function Test-SameOrChildPath([string]$Candidate, [string]$Parent) {
  $candidatePath = Normalize-PathForComparison $Candidate
  $parentPath = Normalize-PathForComparison $Parent
  return [string]::Equals($candidatePath, $parentPath, [StringComparison]::OrdinalIgnoreCase) -or $candidatePath.StartsWith("$parentPath\", [StringComparison]::OrdinalIgnoreCase)
}

function Resolve-ExistingDirectory([string]$Path, [string]$FailureCode) {
  try {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { Stop-Install $FailureCode }
    return (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
  } catch {
    if ($_.Exception.Message -like "CHATCOM_WINDOWS_INSTALL kind=FAILURE code=*") { throw }
    Stop-Install $FailureCode
  }
}

function Resolve-SingleExecutable([string]$CommandName, [string]$FailureCode) {
  $paths = @()
  $commands = @(Get-Command -Name $CommandName -CommandType Application -All -ErrorAction SilentlyContinue)
  foreach ($command in $commands) {
    $candidatePath = [string]$command.Path
    if ([string]::IsNullOrWhiteSpace($candidatePath)) { continue }
    if (-not (Test-Path -LiteralPath $candidatePath -PathType Leaf)) { continue }
    try {
      $canonicalPath = (Resolve-Path -LiteralPath $candidatePath -ErrorAction Stop).Path
    } catch {
      continue
    }
    if (-not ($paths -contains $canonicalPath)) { $paths += $canonicalPath }
  }
  if ($paths.Count -eq 0) { Stop-Install $FailureCode }
  $selectedPath = @($paths | Sort-Object)[0]
  if ([string]::IsNullOrWhiteSpace($selectedPath) -or -not (Test-Path -LiteralPath $selectedPath -PathType Leaf)) { Stop-Install $FailureCode }
  return [string]$selectedPath
}

try {
  $scriptPath = $MyInvocation.MyCommand.Path
  if ([string]::IsNullOrWhiteSpace($scriptPath)) { Stop-Install "SCRIPT_PATH_MISSING" }
  $scriptDirectory = Split-Path -Parent $scriptPath
  if ([string]::IsNullOrWhiteSpace($scriptDirectory)) { Stop-Install "SCRIPT_DIRECTORY_MISSING" }

  if ([string]::IsNullOrWhiteSpace($SourcePath)) { $SourcePath = Split-Path -Parent $scriptDirectory }
  if ([string]::IsNullOrWhiteSpace($InstallRoot)) {
    if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { Stop-Install "LOCALAPPDATA_MISSING" }
    $InstallRoot = Join-Path $env:LOCALAPPDATA "ChatCOM"
  }

  $resolvedSource = Resolve-ExistingDirectory $SourcePath "SOURCE_NOT_FOUND"
  $packagePath = Join-Path $resolvedSource "package.json"
  $portableCliPath = Join-Path $resolvedSource "dist\portable-cli.js"
  $mcpServerPath = Join-Path $resolvedSource "dist\mcp-server.js"
  if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) { Stop-Install "PACKAGE_JSON_MISSING" }
  if (-not (Test-Path -LiteralPath $portableCliPath -PathType Leaf)) { Stop-Install "BUILD_ARTIFACT_MISSING" }
  if (-not (Test-Path -LiteralPath $mcpServerPath -PathType Leaf)) { Stop-Install "BUILD_ARTIFACT_MISSING" }

  try {
    $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
  } catch {
    Stop-Install "PACKAGE_JSON_INVALID"
  }
  if ($package.name -ne "chatcom") { Stop-Install "PACKAGE_NAME_MISMATCH" }

  $nodePath = Resolve-SingleExecutable "node.exe" "NODE_EXE_NOT_FOUND"
  $npmPath = Resolve-SingleExecutable "npm.cmd" "NPM_CMD_NOT_FOUND"
  $nodeVersionOutput = @(& $nodePath --version 2>$null)
  if ($LASTEXITCODE -ne 0 -or $nodeVersionOutput.Count -ne 1) { Stop-Install "NODE_VERSION_READ_FAILED" }
  $nodeVersion = ([string]$nodeVersionOutput[0]).Trim().TrimStart("v")
  $nodeVersionParts = $nodeVersion.Split(".")
  if ($nodeVersionParts.Count -lt 1) { Stop-Install "NODE_VERSION_INVALID" }
  try { $nodeMajor = [int]$nodeVersionParts[0] } catch { Stop-Install "NODE_VERSION_INVALID" }
  if ($nodeMajor -lt 22) { Stop-Install "NODE_VERSION_UNSUPPORTED" }

  try {
    $installRootCandidate = Normalize-PathForComparison $InstallRoot
    $driveRoot = [System.IO.Path]::GetPathRoot($installRootCandidate)
    if ([string]::Equals($installRootCandidate, $driveRoot, [StringComparison]::OrdinalIgnoreCase)) { Stop-Install "INSTALL_ROOT_DRIVE_ROOT" }
    $installRootParent = Split-Path -Parent $installRootCandidate
    $installRootLeaf = Split-Path -Leaf $installRootCandidate
    if ([string]::IsNullOrWhiteSpace($installRootParent) -or [string]::IsNullOrWhiteSpace($installRootLeaf)) { Stop-Install "INSTALL_ROOT_INVALID" }
    if (-not (Test-Path -LiteralPath $installRootParent -PathType Container)) { Stop-Install "INSTALL_ROOT_PARENT_MISSING" }
    $canonicalInstallParent = (Resolve-Path -LiteralPath $installRootParent -ErrorAction Stop).Path
    $resolvedInstallRoot = Join-Path $canonicalInstallParent $installRootLeaf
    if (Test-Path -LiteralPath $resolvedInstallRoot) { $resolvedInstallRoot = (Resolve-Path -LiteralPath $resolvedInstallRoot -ErrorAction Stop).Path }
  } catch {
    if ($_.Exception.Message -like "CHATCOM_WINDOWS_INSTALL kind=FAILURE code=*") { throw }
    Stop-Install "INSTALL_ROOT_INVALID"
  }

  $installRootComparison = Normalize-PathForComparison $resolvedInstallRoot

  $protectedDirectories = @()
  $userProfile = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
  if (-not [string]::IsNullOrWhiteSpace($userProfile)) { $protectedDirectories += $userProfile }
  if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { $protectedDirectories += $env:LOCALAPPDATA }
  foreach ($protectedDirectory in $protectedDirectories) {
    if ([string]::Equals($installRootComparison, (Normalize-PathForComparison $protectedDirectory), [StringComparison]::OrdinalIgnoreCase)) { Stop-Install "INSTALL_ROOT_PROTECTED" }
  }
  if (Test-SameOrChildPath $resolvedInstallRoot $resolvedSource -or Test-SameOrChildPath $resolvedSource $resolvedInstallRoot) { Stop-Install "INSTALL_ROOT_SOURCE_CONFLICT" }

  $pathUpdated = $false
  if ($PSCmdlet.ShouldProcess($resolvedInstallRoot, "Install ChatCOM $($package.version) for the current user")) {
    New-Item -ItemType Directory -Path $resolvedInstallRoot -Force | Out-Null
    & $npmPath install --global --prefix $resolvedInstallRoot --omit=dev --ignore-scripts $resolvedSource 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { Stop-Install "NPM_INSTALL_FAILED" }
    if (-not (Test-Path -LiteralPath (Join-Path $resolvedInstallRoot "chatcom.cmd") -PathType Leaf)) { Stop-Install "CLI_SHIM_MISSING" }
    if (-not (Test-Path -LiteralPath (Join-Path $resolvedInstallRoot "chatcom-mcp.cmd") -PathType Leaf)) { Stop-Install "MCP_SHIM_MISSING" }

    if ($AddToUserPath) {
      try {
        $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
        $pathEntries = @($userPath -split ";" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        $alreadyPresent = $pathEntries | Where-Object { [string]::Equals($_.TrimEnd("\"), $installRootComparison.TrimEnd("\"), [StringComparison]::OrdinalIgnoreCase) }
        if ($null -eq $alreadyPresent) {
          $newUserPath = if ([string]::IsNullOrWhiteSpace($userPath)) { $installRootComparison } else { "$userPath;$installRootComparison" }
          [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
          $pathUpdated = $true
        }
      } catch {
        Stop-Install "PATH_UPDATE_FAILED"
      }
    }
    Write-Output "CHATCOM_WINDOWS_INSTALL kind=SUCCESS version=$($package.version) install_root=$installRootComparison path_updated=$($pathUpdated.ToString().ToLowerInvariant())"
  } else {
    Write-Output "CHATCOM_WINDOWS_INSTALL kind=WHAT_IF version=$($package.version) install_root=$installRootComparison path_updated=false"
  }
} catch {
  $message = [string]$_.Exception.Message
  if ($message -match '^CHATCOM_WINDOWS_INSTALL kind=FAILURE code=[A-Z0-9_]+$') {
    Write-Output $message
  } else {
    Write-Output "CHATCOM_WINDOWS_INSTALL kind=FAILURE code=INSTALLER_FAILED"
  }
  exit 1
}
