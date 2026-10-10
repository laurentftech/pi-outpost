// Which Win32 path call a sandbox refuses: how Git for Windows' getcwd and Node's realpath.native
// fail under MXC tier 1 (docs/investigations/windows-sandboxing.md, finding 7).
//
// Build (no SDK needed, .NET Framework ships csc):
//   C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /out:%USERPROFILE%\tools\path-apis.exe scripts\probes\path-apis.cs
// Run inside the sandbox through mxc-run.mjs, with ~\tools readable:
//   path-apis.exe [path ...]      (default: the working directory)
// One line per call: OK and its answer, or the Win32 error.
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

static class PathApis {
  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sa, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern uint GetFinalPathNameByHandleW(IntPtr h, StringBuilder buf, uint len, uint flags);
  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern uint GetLongPathNameW(string shortPath, StringBuilder buf, uint len);
  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern uint GetCurrentDirectoryW(uint len, StringBuilder buf);
  [DllImport("kernel32", SetLastError = true)]
  static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern uint GetFileAttributesW(string path);
  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool SetCurrentDirectoryW(string path);

  const uint FILE_READ_ATTRIBUTES = 0x80, SHARE_ALL = 7, OPEN_EXISTING = 3, BACKUP_SEMANTICS = 0x02000000;
  static readonly IntPtr Invalid = new IntPtr(-1);

  static string Err() { int e = Marshal.GetLastWin32Error(); return "ERROR " + e + " (" + new Win32Exception(e).Message + ")"; }

  static void Report(string label, uint ret, StringBuilder buf) {
    Console.WriteLine("  {0,-40} {1}", label, ret == 0 ? Err() : "OK " + buf);
  }

  static void Probe(string path) {
    Console.WriteLine(path);
    var buf = new StringBuilder(1024);
    Report("GetLongPathNameW", GetLongPathNameW(path, buf, 1024), buf);
    Console.WriteLine("  {0,-40} {1}", "GetFileAttributesW", GetFileAttributesW(path) == 0xFFFFFFFF ? Err() : "OK");
    Console.WriteLine("  {0,-40} {1}", "SetCurrentDirectoryW", SetCurrentDirectoryW(path) ? "OK" : Err());
    foreach (uint access in new uint[] { 0, FILE_READ_ATTRIBUTES }) {
      IntPtr h = CreateFileW(path, access, SHARE_ALL, IntPtr.Zero, OPEN_EXISTING, BACKUP_SEMANTICS, IntPtr.Zero);
      string open = "CreateFileW(access=0x" + access.ToString("x") + ")";
      if (h == Invalid) { Console.WriteLine("  {0,-40} {1}", open, Err()); continue; }
      Console.WriteLine("  {0,-40} OK", open);
      // flags: 0 = DOS volume + normalized (what git and libuv ask for), 8 = opened name, 2 = NT volume.
      foreach (var f in new[] { Tuple.Create(0u, "normalized, DOS"), Tuple.Create(8u, "opened, DOS"), Tuple.Create(2u, "normalized, NT"), Tuple.Create(10u, "opened, NT") }) {
        buf.Clear();
        Report("  GetFinalPathNameByHandleW(" + f.Item2 + ")", GetFinalPathNameByHandleW(h, buf, 1024, f.Item1), buf);
      }
      CloseHandle(h);
    }
  }

  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool GetVolumeNameForVolumeMountPointW(string mountPoint, StringBuilder buf, uint len);
  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool GetVolumePathNamesForVolumeNameW(string volume, char[] buf, uint len, out uint needed);

  // NT -> DOS translation goes through the Mount Manager (\Device\MountPointManager): ask it directly.
  static void MountManager() {
    Console.WriteLine("Mount Manager");
    var vol = new StringBuilder(100);
    if (!GetVolumeNameForVolumeMountPointW("C:\\", vol, 100)) { Console.WriteLine("  {0,-40} {1}", "GetVolumeNameForVolumeMountPointW(C:\\)", Err()); return; }
    Console.WriteLine("  {0,-40} OK {1}", "GetVolumeNameForVolumeMountPointW(C:\\)", vol);
    var names = new char[1024]; uint needed;
    Console.WriteLine("  {0,-40} {1}", "GetVolumePathNamesForVolumeNameW", GetVolumePathNamesForVolumeNameW(vol.ToString(), names, 1024, out needed) ? "OK " + new string(names).TrimEnd('\0') : Err());
  }

  static void Main(string[] args) {
    var cwd = new StringBuilder(1024);
    GetCurrentDirectoryW(1024, cwd);
    MountManager();
    if (args.Length == 0) args = new[] { cwd.ToString() };
    foreach (var p in args) Probe(p);
  }
}
