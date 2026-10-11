# Orbit keeps the window of an application over one of its own tabs, or away from the screens.
# Started once per application by craftView.ts; commands arrive one per line on standard input:
#   away                          the window leaves the screens (it keeps drawing there)
#   front                         the window comes back as an ordinary window, in front of the user
#   dock pid r g b r g b r g b    the window is held over a tab of Orbit, from now on and by itself.
#                                 The tab is found by looking at Orbit's windows (process `pid`)
#                                 for what the page paints there: a small square of the first
#                                 colour at the top left of the area, one of the second at its
#                                 bottom right, and the third colour everywhere in between.
#   look                          Orbit says its tabs changed: the tab is looked at again at once
#   quit
# It answers each command with one word, and says `shown` / `hidden` whenever the window comes
# over the tab or leaves it.
#
# How it holds the window, and why this way:
# - The application's window stays a window of its own, placed exactly over the tab. It is not
#   made a child of Orbit's window, nor owned by it: both tie its life to Orbit's (it was
#   destroyed with it, work included) and detaching it could wait for ever on an Orbit closing.
# - It follows Orbit's window at once (a system hook says when that window moves or changes
#   rank), kept just above it and under whatever else is above Orbit.
# - It looks at what Orbit itself draws in the tab (several times a second while the user is
#   at work in Orbit, once a second otherwise). If the corner marks moved, the window follows.
#   If they are gone (another tab is in front), it steps aside. Where anything other than the
#   third colour shows between them (a list, a menu, a notification of Orbit drawn there),
#   that part is cut out of the window: Orbit's own things stay above the application, seen
#   and clicked through it.
#
# The application is found by the port of its control channel: several copies may run (one per
# project), and the process Orbit started is not always the one that ends up owning the window.
param([int]$Port, [int]$Link = 0, [string]$Key = '')

Add-Type -ReferencedAssemblies System.Drawing @"
using System; using System.Collections.Generic; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices; using System.Threading;
public class OrbitDock {
	public struct RECT { public int L, T, R, B; }
	public struct POINT { public int X, Y; }
	public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public POINT pt; }
	public delegate bool EnumProc(IntPtr h, IntPtr l);
	public delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
	[DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
	[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
	[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
	[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
	[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
	[DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] public static extern IntPtr GetLong(IntPtr h, int index);
	[DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] public static extern IntPtr SetLong(IntPtr h, int index, IntPtr value);
	[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int command);
	[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
	[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
	[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
	[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint command);
	[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
	[DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
	[DllImport("user32.dll")] public static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, WinEventProc proc, uint process, uint thread, uint flags);
	[DllImport("user32.dll")] public static extern int GetMessage(out MSG m, IntPtr h, uint min, uint max);
	[DllImport("user32.dll")] public static extern bool TranslateMessage(ref MSG m);
	[DllImport("user32.dll")] public static extern IntPtr DispatchMessage(ref MSG m);
	[DllImport("user32.dll")] public static extern UIntPtr SetTimer(IntPtr h, UIntPtr id, uint ms, IntPtr proc);
	public struct LASTINPUT { public uint size; public uint time; }
	[DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUT info);
	[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
	[DllImport("user32.dll")] public static extern int SetWindowRgn(IntPtr h, IntPtr region, bool redraw);
	[DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int l, int t, int r, int b);
	[DllImport("gdi32.dll")] public static extern int CombineRgn(IntPtr into, IntPtr a, IntPtr b, int how);
	[DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr o);

	const int AWAY = -20000;
	public static IntPtr App = IntPtr.Zero;
	static IntPtr orbit = IntPtr.Zero;
	static uint orbitPid;
	static int[] first, second, plain;
	/** Where the tab is in Orbit's window (from its top-left corner), once found. */
	static int offX, offY, width, height;
	static bool found, covered, shown;
	/** away, front, or held (over the tab, by itself). */
	static string mode = "away";
	static readonly object gate = new object();
	static WinEventProc onEvent;
	/** Said at once, on standard output: the script is busy waiting for its next order. */
	public static System.IO.TextWriter Out = Console.Out;
	public static void Say(string word) { lock (gate) { try { Out.WriteLine(word); Out.Flush(); } catch { } } }

	[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder name, int size);

	/**
	 * The application's own window among those of its process: visible, with no owner, the
	 * largest one. Its process also holds windows that are not it (the one its toolkit keeps to
	 * receive events, a dialog box): the system's idea of a « main window » picked those at times.
	 */
	public static IntPtr MainOf(uint pid) {
		IntPtr best = IntPtr.Zero; long bestArea = 0; int bestRank = 0;
		EnumWindows((h, l) => {
			uint p; GetWindowThreadProcessId(h, out p);
			if (p != pid || GetWindow(h, 4) != IntPtr.Zero) { return true; }
			var name = new System.Text.StringBuilder(200); GetClassName(h, name, 200);
			string kind = name.ToString();
			if (kind.Contains("Event Target") || kind == "#32770") { return true; }
			// The Crafting Apps all name their window's class the same way. A visible window
			// first; a hidden one only when it is of that class and there is no other: a helper
			// stopped half-way once left the application hidden, and it must be found again
			// (among hidden windows of the graphics driver, some as large as a real one).
			bool seen = IsWindowVisible(h), own = kind == "Window Class";
			if (!seen && !own) { return true; }
			int rank = (seen ? 2 : 0) + (own ? 1 : 0);
			RECT r; GetWindowRect(h, out r);
			long area = (long)(r.R - r.L) * (r.B - r.T);
			if (r.R - r.L >= 200 && r.B - r.T >= 150 && (rank > bestRank || (rank == bestRank && area > bestArea))) { best = h; bestArea = area; bestRank = rank; }
			return true;
		}, IntPtr.Zero);
		return best;
	}

	static List<IntPtr> WindowsOf(uint pid) {
		var all = new List<IntPtr>();
		EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && h != App && IsWindowVisible(h) && !IsIconic(h)) { all.Add(h); } return true; }, IntPtr.Zero);
		return all;
	}

	/** The last picture taken of a window of Orbit, and its size. */
	static Bitmap picture;
	static byte[] px = new byte[0];
	static int stride, ww, wh;
	/** The size Orbit's window had when the tab was last found in it. */
	static int knownW, knownH;
	/** The parts of the tab Orbit draws something over, as rectangles in the tab, and what is cut out of the window now. */
	static List<RECT> holes = new List<RECT>();
	static string holesNow = "", holesCut = "";
	static int lastLook;

	static bool Near(int i, int[] c) {
		return Math.Abs(px[i + 2] - c[0]) <= 2 && Math.Abs(px[i + 1] - c[1]) <= 2 && Math.Abs(px[i] - c[2]) <= 2;
	}

	/**
	 * A mark is a small square of one colour: five by five pixels from here, all that colour.
	 * A picture behind the interface (the wallpaper) holds stray pixels of any colour, never
	 * such a square.
	 */
	static bool Mark(int x, int y, int[] c) {
		const int side = 5;
		if (x < 0 || y < 0 || x + side > ww || y + side > wh) { return false; }
		for (int dy = 0; dy < side; dy++) {
			for (int dx = 0; dx < side; dx++) {
				if (!Near((y + dy) * stride + (x + dx) * 4, c)) { return false; }
			}
		}
		return true;
	}

	/** What a window of Orbit draws, into memory: it need not be in front, and the application over it is not in the picture. */
	static bool Grab(IntPtr h) {
		RECT r; GetWindowRect(h, out r);
		int w = r.R - r.L, hh = r.B - r.T;
		if (w < 200 || hh < 200 || w > 16000 || hh > 16000) { return false; }
		if (picture == null || picture.Width != w || picture.Height != hh) {
			if (picture != null) { picture.Dispose(); }
			picture = new Bitmap(w, hh, PixelFormat.Format32bppArgb);
		}
		using (var g = Graphics.FromImage(picture)) { IntPtr dc = g.GetHdc(); bool ok = PrintWindow(h, dc, 2); g.ReleaseHdc(dc); if (!ok) { return false; } }
		var data = picture.LockBits(new Rectangle(0, 0, w, hh), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
		stride = data.Stride; ww = w; wh = hh;
		if (px.Length != stride * hh) { px = new byte[stride * hh]; }
		Marshal.Copy(data.Scan0, px, 0, px.Length);
		picture.UnlockBits(data);
		return true;
	}

	/**
	 * Looks at a window of Orbit for the tab: the two corner marks, then what shows between them.
	 * 0: the tab is not there. 1: it is, plain. 2: it is, with something of Orbit drawn over
	 * parts of it (`holes`). 3: it is, almost all of it under something else.
	 */
	static int Look(IntPtr h, out int x, out int y, out int w, out int hh) {
		x = y = w = hh = 0;
		if (!Grab(h)) { return 0; }
		bool same = h == orbit && found && ww == knownW && wh == knownH;
		if (same && Mark(offX, offY, first) && Mark(offX + width - 5, offY + height - 5, second)) {
			// Where it was: nothing to search.
			x = offX; y = offY; w = width; hh = height;
		} else {
			const int side = 5;
			int ax = int.MaxValue, ay = int.MaxValue, bx = -1, by = -1;
			for (int yy = 0; yy + side <= wh; yy++) {
				int row = yy * stride;
				for (int xx = 0; xx + side <= ww; xx++) {
					int i = row + xx * 4;
					bool a = Near(i, first);
					if (!a && !Near(i, second)) { continue; }
					if (!Mark(xx, yy, a ? first : second)) { continue; }
					if (a) { if (xx < ax) { ax = xx; } if (yy < ay) { ay = yy; } }
					else { if (xx + side - 1 > bx) { bx = xx + side - 1; } if (yy + side - 1 > by) { by = yy + side - 1; } }
				}
			}
			bool hasA = ay != int.MaxValue, hasB = bx >= 0;
			if (hasA && hasB) {
				if (bx - ax < 300 || by - ay < 200) { return 0; }
				x = ax; y = ay; w = bx - ax + 1; hh = by - ay + 1;
			} else if (same && ((hasA && ax == offX && ay == offY) || (hasB && bx == offX + width - 1 && by == offY + height - 1))) {
				// One mark is under something Orbit shows (a notification in a corner): the other
				// one has not moved and the window has not changed size, so neither has the tab.
				x = offX; y = offY; w = width; hh = height;
			} else { return 0; }
		}
		// Between the marks Orbit must show the plain colour. Looked at on a grid; a cell where
		// anything else shows is a part of the tab Orbit draws over (a list, a menu, a notification).
		const int cell = 8, corner = 24;
		int cols = w / cell, rows = hh / cell, other = 0;
		if (cols < 4 || rows < 4) { return 0; }
		var over = new bool[rows, cols];
		for (int r = 0; r < rows; r++) {
			int py = y + r * cell + cell / 2;
			for (int c = 0; c < cols; c++) {
				int qx = c * cell + cell / 2, qy = r * cell + cell / 2;
				if ((qx < corner && qy < corner) || (qx > w - corner && qy > hh - corner)) { continue; }
				// Loosely: the faint edge of a shadow over the plain colour is not worth a hole.
				int i = py * stride + (x + qx) * 4;
				if (Math.Abs(px[i + 2] - plain[0]) > 12 || Math.Abs(px[i + 1] - plain[1]) > 12 || Math.Abs(px[i] - plain[2]) > 12) { over[r, c] = true; other++; }
			}
		}
		holes.Clear();
		if (other == 0) { holesNow = ""; return 1; }
		if (other > rows * cols * 7 / 10) { holesNow = ""; return 3; }
		// Each covered cell with a cell of margin around it (shadows, rounded corners), gathered
		// in runs along each row, and rows that hold the same runs in one band.
		var text = new System.Text.StringBuilder();
		string before = null; int bandStart = 0;
		var bandRuns = new List<int>();
		for (int r = 0; r <= rows; r++) {
			var runs = new List<int>();
			if (r < rows) {
				int start = -1;
				for (int c = 0; c <= cols; c++) {
					bool on = false;
					if (c < cols) {
						for (int dr = -1; dr <= 1 && !on; dr++) {
							for (int dc = -1; dc <= 1; dc++) {
								int rr = r + dr, cc = c + dc;
								if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && over[rr, cc]) { on = true; break; }
							}
						}
					}
					if (on && start < 0) { start = c; }
					if (!on && start >= 0) { runs.Add(start); runs.Add(c); start = -1; }
				}
			}
			string key = r < rows ? string.Join(",", runs) : null;
			if (key != before) {
				for (int k = 0; k + 1 < bandRuns.Count; k += 2) {
					var hole = new RECT();
					hole.L = bandRuns[k] == 0 ? 0 : bandRuns[k] * cell; hole.R = bandRuns[k + 1] >= cols ? w : bandRuns[k + 1] * cell;
					hole.T = bandStart == 0 ? 0 : bandStart * cell; hole.B = r >= rows ? hh : r * cell;
					holes.Add(hole);
					text.Append(hole.L).Append(' ').Append(hole.T).Append(' ').Append(hole.R).Append(' ').Append(hole.B).Append(';');
				}
				before = key; bandStart = r; bandRuns = runs;
			}
		}
		holesNow = w + "x" + hh + ":" + text;
		return 2;
	}

	/** The window in one piece again. */
	static void Whole() {
		if (holesCut != "") { SetWindowRgn(App, IntPtr.Zero, true); holesCut = ""; }
	}

	/**
	 * Cuts out of the window the parts of the tab Orbit draws over: what Orbit shows there is
	 * seen, and clicked, through the window, as if the application were part of the page.
	 */
	static void Shape() {
		if (holesNow == holesCut) { return; }
		if (holesNow == "") { Whole(); return; }
		IntPtr region = CreateRectRgn(0, 0, width, height);
		foreach (RECT hole in holes) {
			IntPtr cut = CreateRectRgn(hole.L, hole.T, hole.R, hole.B);
			CombineRgn(region, region, cut, 4);
			DeleteObject(cut);
		}
		// The system keeps the region from here on.
		SetWindowRgn(App, region, true);
		holesCut = holesNow;
	}

	static void Tool(bool tool) {
		// A tool window has no button in the taskbar; the change only takes while the window is hidden.
		long style = GetLong(App, -20).ToInt64();
		long wanted = tool ? ((style | 0x80) & ~0x40000L) : ((style & ~0x80L) | 0x40000);
		if (wanted != style) { ShowWindow(App, 0); SetLong(App, -20, new IntPtr(wanted)); ShowWindow(App, 4); }
	}

	static void Aside() {
		RECT at; GetWindowRect(App, out at);
		if (at.L != AWAY) { SetWindowPos(App, IntPtr.Zero, AWAY, 80, 0, 0, 0x0001 | 0x0004 | 0x0010); }
		Whole();
		if (shown) { shown = false; Say("hidden"); }
	}

	/** Puts the window where it belongs right now. Called on every move of Orbit's window and on every look. */
	static void Place() {
		lock (gate) {
			if (mode != "held") { return; }
			if (!found || covered || orbit == IntPtr.Zero || !IsWindow(orbit) || IsIconic(orbit) || !IsWindowVisible(orbit)) { Aside(); return; }
			RECT r; GetWindowRect(orbit, out r);
			// Just above Orbit's window, under whatever else is above it.
			IntPtr above = GetWindow(orbit, 3);
			if (above == App) {
				SetWindowPos(App, IntPtr.Zero, r.L + offX, r.T + offY, width, height, 0x0004 | 0x0010 | 0x0040);
			} else if (above == IntPtr.Zero) {
				// Orbit is on top of everything (it was just clicked). Another program may not
				// simply go over the window in front: it goes through the always-on-top rank
				// for an instant, and leaves it at once.
				SetWindowPos(App, new IntPtr(-1), r.L + offX, r.T + offY, width, height, 0x0010 | 0x0040);
				SetWindowPos(App, new IntPtr(-2), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010);
			} else {
				SetWindowPos(App, above, r.L + offX, r.T + offY, width, height, 0x0010 | 0x0040);
			}
			Shape();
			if (!shown) { shown = true; Say("shown"); }
		}
	}

	static void Scan() {
		lock (gate) {
			// The application was closed: nothing left to hold.
			if (!IsWindow(App)) { Say("gone"); Environment.Exit(0); }
			lastLook = Environment.TickCount;
			if (mode == "away") { Aside(); return; }
			if (mode != "held") { return; }
			int x = 0, y = 0, w = 0, h = 0, saw = 0;
			if (orbit != IntPtr.Zero && IsWindow(orbit) && !IsIconic(orbit)) { saw = Look(orbit, out x, out y, out w, out h); }
			if (saw == 0) {
				// Not in the window it was in (or none yet): the other windows of Orbit are looked at.
				foreach (IntPtr candidate in WindowsOf(orbitPid)) {
					if (candidate == orbit) { continue; }
					saw = Look(candidate, out x, out y, out w, out h);
					if (saw != 0) { orbit = candidate; break; }
				}
			}
			found = saw != 0;
			covered = saw == 3;
			if (found) { offX = x; offY = y; width = w; height = h; knownW = ww; knownH = wh; }
		}
		Place();
	}

	/**
	 * Looking at Orbit's window costs some twenty milliseconds of processor. What Orbit draws
	 * over the tab changes when the user does something in Orbit: it is looked at often then
	 * (and while something is over the tab), and once a second the rest of the time.
	 */
	static void Tick() {
		int every = 1000;
		uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid);
		if (mode == "held" && pid == orbitPid) {
			var input = new LASTINPUT(); input.size = 8;
			if (holesCut != "" || (GetLastInputInfo(ref input) && unchecked((uint)Environment.TickCount - input.time) < 1500)) { every = 140; }
		}
		if (unchecked(Environment.TickCount - lastLook) >= every) { Scan(); }
	}

	/** Orbit's window changed size: the tab did too. Looked at again without waiting for the next turn. */
	static void Resized() {
		RECT r; GetWindowRect(orbit, out r);
		if ((r.R - r.L != knownW || r.B - r.T != knownH) && unchecked(Environment.TickCount - lastLook) > 60) { Scan(); }
	}

	public static string Order(string[] words) {
		lock (gate) {
			if (words[0] == "away") { mode = "away"; found = false; Whole(); Tool(true); Aside(); return "away"; }
			if (words[0] == "front") {
				mode = "front"; found = false; shown = false;
				Whole();
				Tool(false);
				SetWindowPos(App, IntPtr.Zero, 120, 90, 1440, 900, 0x0004);
				ShowWindow(App, 5);
				SetForegroundWindow(App);
				return "front";
			}
			if (words[0] == "look") { lastLook = Environment.TickCount - 100000; return "looked"; }
			if (words[0] == "dock" && words.Length >= 11) {
				orbitPid = uint.Parse(words[1]);
				first = new int[] { int.Parse(words[2]), int.Parse(words[3]), int.Parse(words[4]) };
				second = new int[] { int.Parse(words[5]), int.Parse(words[6]), int.Parse(words[7]) };
				plain = new int[] { int.Parse(words[8]), int.Parse(words[9]), int.Parse(words[10]) };
				Tool(true);
				mode = "held";
			} else { return "unknown"; }
		}
		Scan();
		return "held";
	}

	/** The thread that listens to the system and looks at Orbit: hooks need a message loop of their own. */
	public static void Start() {
		var thread = new Thread(() => {
			SetThreadDpiAwarenessContext(new IntPtr(-4));
			onEvent = (hook, ev, hwnd, idObject, idChild, th, time) => {
				// The window itself (not one of its parts) moved, was minimized, or changed rank.
				if (idObject == 0 && (hwnd == orbit || ev == 0x0003)) { try { Place(); if (hwnd == orbit && ev == 0x800B) { Resized(); } } catch { } }
			};
			SetWinEventHook(0x0003, 0x0003, IntPtr.Zero, onEvent, 0, 0, 0);
			SetWinEventHook(0x0016, 0x0017, IntPtr.Zero, onEvent, 0, 0, 0);
			SetWinEventHook(0x800B, 0x800B, IntPtr.Zero, onEvent, 0, 0, 0);
			SetTimer(IntPtr.Zero, UIntPtr.Zero, 70, IntPtr.Zero);
			MSG m;
			while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) {
				if (m.message == 0x0113) { try { Tick(); } catch { } }
				TranslateMessage(ref m); DispatchMessage(ref m);
			}
		});
		thread.IsBackground = true;
		thread.SetApartmentState(ApartmentState.STA);
		thread.Start();
	}
}
"@
# Real pixels, whatever the scaling of each screen.
[void][OrbitDock]::SetThreadDpiAwarenessContext([IntPtr](-4))

# The line to Orbit: a local port it listens on (the helper is started detached, with no pipes,
# so that it outlives Orbit's extensions long enough to bring the window back). Without -Link,
# orders come on standard input, for a trial by hand.
$reader = [Console]::In
if ($Link -gt 0) {
	$client = New-Object System.Net.Sockets.TcpClient
	# Nobody to answer to: nothing to do here.
	try { $client.Connect('127.0.0.1', $Link) } catch { exit 2 }
	$stream = $client.GetStream()
	$writer = New-Object System.IO.StreamWriter($stream)
	$writer.NewLine = "`n"
	[OrbitDock]::Out = $writer
	$reader = New-Object System.IO.StreamReader($stream)
	[OrbitDock]::Say($Key)
}

$window = [IntPtr]::Zero
for ($i = 0; $i -lt 120 -and $window -eq [IntPtr]::Zero; $i++) {
	$listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
	if ($listening) { $window = [OrbitDock]::MainOf([uint32]$listening.OwningProcess) }
	if ($window -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 250 }
}
if ($window -eq [IntPtr]::Zero) { [OrbitDock]::Say('nowindow'); exit 1 }
[OrbitDock]::App = $window
[OrbitDock]::Start()

[OrbitDock]::Say('ready')
# Reading an order waits for it: what happens meanwhile is said by the class itself.
while ($true) {
	$line = $null
	try { $line = $reader.ReadLine() } catch { }
	if ($null -eq $line) { break }
	$words = $line.Trim() -split '\s+'
	if ($words[0] -eq 'quit') { exit 0 }
	[OrbitDock]::Say([OrbitDock]::Order($words))
}
# Orbit is gone (closed, or its extensions restarted): nobody holds the application any more.
# It must never be left out of sight with work in it: back in front.
[void][OrbitDock]::Order(@('front'))
