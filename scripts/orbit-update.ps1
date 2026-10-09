# Rebuilds Orbit for Windows and replaces the installed copy (%LOCALAPPDATA%\Programs\Orbit).
# Orbit must be closed: Windows cannot replace a running Orbit.exe.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\orbit-update.ps1 [-NodeDir C:\path\to\node-v24] [-SkipBuild]
# -SkipBuild installs the build already in ..\VSCode-win32-x64 (made while Orbit was open).
param([string]$NodeDir = "$env:USERPROFILE\.orbit-node\node-v24.18.0-win-x64", [switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
$install = Join-Path $env:LOCALAPPDATA 'Programs\Orbit'
$built = Join-Path (Split-Path $repo) 'VSCode-win32-x64'

$running = Get-Process Orbit -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$install*" }
if ($running) { throw 'Ferme Orbit (la version installée) avant la mise à jour.' }

if (-not $SkipBuild) {
	if (Test-Path $NodeDir) { $env:PATH = "$NodeDir;" + $env:PATH }
	$env:NODE_OPTIONS = '--max-old-space-size=8192'
	Set-Location $repo
	# The last step (code signing) needs signtool; the app is complete before it.
	npm run gulp vscode-win32-x64-min
}
if (-not (Test-Path "$built\Orbit.exe")) { throw "La construction n'a pas produit $built\Orbit.exe" }

# The folder itself is often held open (a terminal, the file explorer): empty and refill it instead of replacing it.
New-Item -ItemType Directory -Force $install | Out-Null
Get-ChildItem $install -Force | Remove-Item -Recurse -Force
Get-ChildItem $built -Force | ForEach-Object { Move-Item $_.FullName $install -Force }
Remove-Item $built -Force
& "$PSScriptRoot\orbit-shortcut.ps1" -Exe "$install\Orbit.exe"
"Orbit mis à jour dans $install"
