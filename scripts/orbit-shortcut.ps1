# Creates the "Orbit" Start menu shortcut for a built Orbit.exe, carrying Orbit's AppUserModelID
# (product.json win32AppUserModelId) so a pinned taskbar icon and the running window are one.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\orbit-shortcut.ps1 -Exe C:\path\to\Orbit.exe
param(
	[Parameter(Mandatory = $true)][string]$Exe,
	[string]$Name = 'Orbit',
	[string]$AppId = 'Orbit.Orbit',
	[switch]$Desktop
)

if (-not (Test-Path $Exe)) { throw "Introuvable : $Exe" }

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

[ComImport, Guid("00021401-0000-0000-C000-000000000046")]
class CShellLink { }

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct PropertyKey { public Guid FormatId; public uint PropertyId; }

[StructLayout(LayoutKind.Explicit, Size = 16)]
public struct PropVariant { [FieldOffset(0)] public ushort Type; [FieldOffset(8)] public IntPtr Pointer; }

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
interface IPropertyStore {
    int GetCount(out uint count);
    int GetAt(uint index, out PropertyKey key);
    int GetValue(ref PropertyKey key, out PropVariant value);
    int SetValue(ref PropertyKey key, ref PropVariant value);
    int Commit();
}

public static class OrbitShortcut {
    public static void SetAppId(string lnk, string appId) {
        var file = (IPersistFile)new CShellLink();
        file.Load(lnk, 2);
        var store = (IPropertyStore)file;
        var key = new PropertyKey { FormatId = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), PropertyId = 5 };
        var value = new PropVariant { Type = 31, Pointer = Marshal.StringToCoTaskMemUni(appId) };
        try {
            Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref value));
            Marshal.ThrowExceptionForHR(store.Commit());
            file.Save(lnk, true);
        } finally {
            Marshal.FreeCoTaskMem(value.Pointer);
        }
    }
}
"@

$targets = @(Join-Path ([Environment]::GetFolderPath('Programs')) "$Name.lnk")
if ($Desktop) { $targets += Join-Path ([Environment]::GetFolderPath('Desktop')) "$Name.lnk" }
$shell = New-Object -ComObject WScript.Shell
foreach ($lnk in $targets) {
	$s = $shell.CreateShortcut($lnk)
	$s.TargetPath = $Exe
	$s.WorkingDirectory = Split-Path $Exe
	$s.IconLocation = "$Exe,0"
	$s.Description = 'Orbit, the IDE built around Claude Code'
	$s.Save()
	[OrbitShortcut]::SetAppId($lnk, $AppId)
	"Raccourci créé : $lnk"
}
