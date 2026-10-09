# Installs the build waiting in ..\VSCode-win32-x64 as soon as the installed Orbit is closed.
# Nothing is ever closed by this script: it waits for the user to quit Orbit, checks that it
# stays closed for a moment, then runs the normal update without rebuilding.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\orbit-install-when-closed.ps1 [-MaxHours 24]
param([int]$MaxHours = 24)

$repo = Split-Path $PSScriptRoot
$install = Join-Path $env:LOCALAPPDATA 'Programs\Orbit'
$built = Join-Path (Split-Path $repo) 'VSCode-win32-x64'
$log = Join-Path $env:TEMP 'orbit-install-auto.log'
function Note([string]$text) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $text" | Out-File $log -Append -Encoding utf8 }
function OrbitRunning { [bool](Get-Process Orbit -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$install*" }) }

Note "en attente de la fermeture d'Orbit (construction : $built)"
$deadline = (Get-Date).AddHours($MaxHours)
$quiet = 0
while ((Get-Date) -lt $deadline) {
	if (-not (Test-Path "$built\Orbit.exe")) { Note 'plus de construction en attente : arrêt'; exit 0 }
	if (OrbitRunning) { $quiet = 0 } else { $quiet++ }
	# Closed for 20 seconds in a row: not a restart in progress.
	if ($quiet -ge 4) {
		Note 'Orbit est fermé : installation'
		try {
			& "$PSScriptRoot\orbit-update.ps1" -SkipBuild *>&1 | ForEach-Object { Note "$_" }
			Note 'installation terminée'
		} catch {
			Note "échec : $($_.Exception.Message)"
		}
		exit 0
	}
	Start-Sleep -Seconds 5
}
Note 'délai dépassé sans fermeture d''Orbit : arrêt'
