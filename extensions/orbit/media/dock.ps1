# Orbit keeps the window of an application over one of its own tabs, or away from the screens.
# Started once per application by craftView.ts; commands arrive one per line on standard input:
#   away               the window leaves the screens (it keeps drawing there) and the taskbar
#   front              the window comes back as an ordinary window, in front of the user
#   dock dx dy w h     the window is laid over Orbit: the mouse pointer is, right now, dx/dy
#                      pixels inside the top-left corner of the area to cover, w x h pixels large
#   quit
# While docked, the window follows the Orbit window it was laid over (moved, resized, minimized).
# The application is found by the port of its control channel: several copies may run (one per
# project), and the process Orbit started is not always the one that ends up owning the window.
param([int]$Port)

Add-Type @"
using System; using System.Runtime.InteropServices;
public class OrbitDock {
	public struct POINT { public int X, Y; }
	public struct RECT { public int L, T, R, B; }
	[DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
	[DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
	[DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
	[DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
	[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
	[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
	[DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetLong(IntPtr h, int index);
	[DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] public static extern IntPtr SetLong(IntPtr h, int index, IntPtr value);
	[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command);
	[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
	[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
	[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
	[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
"@
# Real pixels, whatever the scaling of each screen.
[void][OrbitDock]::SetThreadDpiAwarenessContext([IntPtr](-4))

$AWAY = -20000
$window = [IntPtr]::Zero
$process = $null
for ($i = 0; $i -lt 80 -and $window -eq [IntPtr]::Zero; $i++) {
	$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
	$process = if ($listening) { Get-Process -Id $listening.OwningProcess -ErrorAction SilentlyContinue }
	if ($process) { $window = $process.MainWindowHandle }
	if ($window -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 250 }
}
if ($window -eq [IntPtr]::Zero) { exit 1 }

$owner = [IntPtr]::Zero
$offset = $null
$last = ''
$hidden = $false
# Away is a state, not a move: the application puts its window back where it last was while it
# starts, so it is sent away again for as long as it should be. (Not `$away`: PowerShell does
# not tell it from `$AWAY`.)
$keptAway = $false

function Set-Tool([bool]$tool) {
	# A tool window has no button in the taskbar; the change only takes while the window is hidden.
	$style = [OrbitDock]::GetLong($window, -20).ToInt64()
	$wanted = if ($tool) { ($style -bor 0x80) -band (-bnot 0x40000) } else { ($style -band (-bnot 0x80)) -bor 0x40000 }
	if ($wanted -ne $style) {
		[void][OrbitDock]::ShowWindow($window, 0)
		[void][OrbitDock]::SetLong($window, -20, [IntPtr]$wanted)
		[void][OrbitDock]::ShowWindow($window, 4)
	}
}
function Set-Owner([IntPtr]$to) {
	if ($to -ne $script:owner) {
		[void][OrbitDock]::SetLong($window, -8, $to)
		$script:owner = $to
	}
}
function Move-Away {
	$script:keptAway = $true
	$script:offset = $null
	$script:last = ''
	Set-Owner ([IntPtr]::Zero)
	Set-Tool $true
	[void][OrbitDock]::SetWindowPos($window, [IntPtr]::Zero, $AWAY, 80, 0, 0, 0x0001 -bor 0x0004 -bor 0x0010)
}
function Follow {
	if ($script:keptAway) {
		$at = New-Object OrbitDock+RECT
		[void][OrbitDock]::GetWindowRect($window, [ref]$at)
		if ($at.L -ne $AWAY) { [void][OrbitDock]::SetWindowPos($window, [IntPtr]::Zero, $AWAY, 80, 0, 0, 0x0001 -bor 0x0004 -bor 0x0010) }
		return
	}
	if (-not $script:offset) { return }
	if (-not [OrbitDock]::IsWindow($script:owner)) { Move-Away; 'lost'; return }
	if ([OrbitDock]::IsIconic($script:owner)) {
		if (-not $script:hidden) { $script:hidden = $true; $script:last = ''; [void][OrbitDock]::SetWindowPos($window, [IntPtr]::Zero, $AWAY, 80, 0, 0, 0x0001 -bor 0x0004 -bor 0x0010) }
		return
	}
	$script:hidden = $false
	$r = New-Object OrbitDock+RECT
	[void][OrbitDock]::GetWindowRect($script:owner, [ref]$r)
	$x = $r.L + $script:offset[0]; $y = $r.T + $script:offset[1]
	$now = "$x $y $($script:offset[2]) $($script:offset[3])"
	if ($now -ne $script:last) {
		$script:last = $now
		[void][OrbitDock]::SetWindowPos($window, [IntPtr]::Zero, $x, $y, $script:offset[2], $script:offset[3], 0x0004 -bor 0x0010)
	}
}

'ready'
$reading = [Console]::In.ReadLineAsync()
while ($true) {
	if (-not [OrbitDock]::IsWindow($window)) { 'gone'; break }
	if ($reading.Wait(60)) {
		$line = $reading.Result
		if ($null -eq $line) { break }
		$words = $line.Trim() -split '\s+'
		switch ($words[0]) {
			'away' { Move-Away; 'away' }
			'front' {
				$keptAway = $false; $offset = $null; $last = ''
				Set-Owner ([IntPtr]::Zero)
				Set-Tool $false
				[void][OrbitDock]::SetWindowPos($window, [IntPtr]::Zero, 120, 90, 1440, 900, 0x0004)
				[void][OrbitDock]::ShowWindow($window, 5)
				[void][OrbitDock]::SetForegroundWindow($window)
				'front'
			}
			'dock' {
				$p = New-Object OrbitDock+POINT
				[void][OrbitDock]::GetCursorPos([ref]$p)
				$root = [OrbitDock]::GetAncestor([OrbitDock]::WindowFromPoint($p), 2)
				$mine = 0
				[void][OrbitDock]::GetWindowThreadProcessId($root, [ref]$mine)
				# The pointer must be over a window of Orbit: not over the application itself, nor elsewhere.
				if ($root -eq [IntPtr]::Zero -or $root -eq $window -or $mine -eq $process.Id) { 'missed' }
				else {
					$r = New-Object OrbitDock+RECT
					[void][OrbitDock]::GetWindowRect($root, [ref]$r)
					$offset = @(($p.X - [int]$words[1] - $r.L), ($p.Y - [int]$words[2] - $r.T), [int]$words[3], [int]$words[4])
					$keptAway = $false; $last = ''; $hidden = $false
					Set-Tool $true
					Set-Owner $root
					Follow
					'docked'
				}
			}
			'quit' { exit 0 }
		}
		$reading = [Console]::In.ReadLineAsync()
	}
	Follow
}
