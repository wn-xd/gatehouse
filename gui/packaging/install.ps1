<#
.SYNOPSIS
  Install the Gatehouse desktop app, with the CLI and TUI alongside it.

.DESCRIPTION
  Copies the application into %LOCALAPPDATA%\Programs\Gatehouse, puts its bin
  directory on the user's PATH so `gatehouse` works in any new shell, and adds
  Start Menu and optional Desktop shortcuts.

  Installs per-user by design: no administrator rights, nothing written outside
  the user's profile, and uninstalling is a directory removal plus a PATH edit.
  A security tool asking for elevation it does not need is a bad trade.

  Installing the app deliberately brings the command line with it. The reverse
  is not true: `npm install -g gatehouse` gives the CLI and TUI only, and never
  pulls in the desktop app or its native dependency.

.PARAMETER Uninstall
  Remove a previous installation: deletes the directory, strips the PATH entry
  and removes the shortcuts.

.PARAMETER NoShortcut
  Skip the Desktop shortcut (the Start Menu entry is always created).
#>
[CmdletBinding()]
param(
    [switch]$Uninstall,
    [switch]$NoShortcut
)

$ErrorActionPreference = 'Stop'

$AppName   = 'Gatehouse'
$InstallTo = Join-Path $env:LOCALAPPDATA "Programs\$AppName"
$BinDir    = Join-Path $InstallTo 'bin'
$StartMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'

function Write-Step($message) { Write-Host "  $message" }

function Remove-FromUserPath($entry) {
    $current = [Environment]::GetEnvironmentVariable('PATH', 'User')
    if (-not $current) { return }
    $kept = @($current -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ne $entry.TrimEnd('\') })
    [Environment]::SetEnvironmentVariable('PATH', ($kept -join ';'), 'User')
}

function Add-ToUserPath($entry) {
    $current = [Environment]::GetEnvironmentVariable('PATH', 'User')
    $parts = @()
    if ($current) { $parts = @($current -split ';' | Where-Object { $_ }) }
    if ($parts | Where-Object { $_.TrimEnd('\') -eq $entry.TrimEnd('\') }) {
        Write-Step 'PATH already contains the Gatehouse bin directory'
        return
    }
    [Environment]::SetEnvironmentVariable('PATH', (@($parts + $entry) -join ';'), 'User')
    Write-Step "added to PATH: $entry"
}

function New-Shortcut($linkPath, $target, $description) {
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($linkPath)
    $link.TargetPath = $target
    $link.WorkingDirectory = Split-Path $target -Parent
    $link.Description = $description
    $link.Save()
}

# ---- uninstall -----------------------------------------------------------
if ($Uninstall) {
    Write-Host "Uninstalling $AppName"

    # Stop a running instance first, or the files will be locked.
    Get-Process -Name 'node' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($InstallTo, 'OrdinalIgnoreCase') } |
        ForEach-Object { Write-Step 'closing running instance'; $_.Kill() }

    foreach ($link in @(
        (Join-Path $StartMenu "$AppName.lnk"),
        (Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk")
    )) {
        if (Test-Path $link) { Remove-Item $link -Force; Write-Step "removed shortcut: $link" }
    }

    Remove-FromUserPath $BinDir
    Write-Step 'removed PATH entry'

    if (Test-Path $InstallTo) {
        Start-Sleep -Milliseconds 400   # let file handles release
        Remove-Item $InstallTo -Recurse -Force
        Write-Step "removed $InstallTo"
    }

    Write-Host ''
    Write-Host "$AppName has been uninstalled."
    Write-Host 'Cached feeds and history in ~\.gatehouse were left in place.'
    return
}

# ---- install -------------------------------------------------------------
$source = Join-Path $PSScriptRoot $AppName
if (-not (Test-Path $source)) {
    # Also allow running the script from inside the payload directory.
    if (Test-Path (Join-Path $PSScriptRoot 'Gatehouse.exe')) { $source = $PSScriptRoot }
    else { throw "Cannot find the $AppName payload next to this script." }
}

Write-Host "Installing $AppName for $env:USERNAME"

# WebView2 is required to render the interface. It ships with Windows 11 and is
# a standard component on 10, so warn rather than fail: the user may still have
# it via an Edge install this check does not see.
$wv2 = @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
) | Where-Object { Test-Path $_ }
if (-not $wv2) {
    Write-Warning 'WebView2 runtime was not detected. If the window fails to open, install it from:'
    Write-Warning '  https://developer.microsoft.com/microsoft-edge/webview2/'
}

if (Test-Path $InstallTo) {
    Write-Step 'replacing existing installation'
    Get-Process -Name 'node' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($InstallTo, 'OrdinalIgnoreCase') } |
        ForEach-Object { $_.Kill() }
    Start-Sleep -Milliseconds 400
    Remove-Item $InstallTo -Recurse -Force
}

New-Item -ItemType Directory -Path $InstallTo -Force | Out-Null
Copy-Item (Join-Path $source '*') $InstallTo -Recurse -Force
Write-Step "installed to $InstallTo"

Add-ToUserPath $BinDir

$exe = Join-Path $InstallTo 'Gatehouse.exe'
New-Shortcut (Join-Path $StartMenu "$AppName.lnk") $exe 'Local-first security gate for npm installs'
Write-Step 'created Start Menu entry'

if (-not $NoShortcut) {
    New-Shortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) "$AppName.lnk") $exe 'Gatehouse'
    Write-Step 'created Desktop shortcut'
}

Write-Host ''
Write-Host "$AppName is installed."
Write-Host '  Desktop app : Start Menu > Gatehouse'
Write-Host '  Command line: gatehouse --help   (open a new terminal first)'
Write-Host '  TUI         : gatehouse tui'
Write-Host ''
Write-Host 'First run: gatehouse sync   to pull the current IOC feeds.'
