# Runs an Orbit installer as soon as the installed Orbit is closed, then opens Orbit again.
# Nothing is ever closed by this script: it waits for the user to quit Orbit and checks that it
# stays closed for a moment (a reload is not a quit).
# Usage: powershell -ExecutionPolicy Bypass -File scripts\orbit-setup-when-closed.ps1 -Setup C:\path\OrbitSetup-x64-1.0.0.exe [-MaxHours 48]
param([Parameter(Mandatory = $true)][string]$Setup, [int]$MaxHours = 48)

$install = Join-Path $env:LOCALAPPDATA 'Programs\Orbit'
$log = Join-Path $env:TEMP 'orbit-install-auto.log'
function Note([string]$text) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $text" | Out-File $log -Append -Encoding utf8 }
function OrbitRunning { [bool](Get-Process Orbit -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$install*" }) }

if (-not (Test-Path $Setup)) { Note "installateur introuvable : $Setup"; exit 1 }
Note "en attente de la fermeture d'Orbit (installateur : $Setup)"
$deadline = (Get-Date).AddHours($MaxHours)
$quiet = 0
while ((Get-Date) -lt $deadline) {
	if (OrbitRunning) { $quiet = 0 } else { $quiet++ }
	# Closed for 20 seconds in a row: not a restart in progress.
	if ($quiet -ge 4) {
		Note 'Orbit est fermé : installation'
		$p = Start-Process -FilePath $Setup -ArgumentList '/VERYSILENT', '/NORESTART', '/MERGETASKS=runcode,!desktopicon,!quicklaunchicon', "/LOG=$env:TEMP\orbit-setup.log" -PassThru -Wait
		Note "installateur terminé (code $($p.ExitCode))"
		exit $p.ExitCode
	}
	Start-Sleep -Seconds 5
}
Note 'délai dépassé : rien installé'
