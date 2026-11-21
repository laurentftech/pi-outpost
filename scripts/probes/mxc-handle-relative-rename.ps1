# Inside MXC's process container (Windows 11, tier 1): does a file rename relative to a directory
# handle work? bun's install probes its cache that way (NtSetInformationFile, FileRenameInformation[Ex]
# with RootDirectory) and reports "EBADF accessing temporary directory" when it fails.
#
# Run it in the current folder, once unconfined and once inside the container (a confined command of
# pi-outpost's agent shell, with TEMP pointing somewhere writable so Add-Type can compile). Measured on
# Windows 11 24H2 10.0.26100.9711, mxc-sdk 1.1.0: every relative variant 0x00000000 outside and
# 0xC0000008 (STATUS_INVALID_HANDLE) inside; the absolute \??\ variants succeed in both.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\probes\mxc-handle-relative-rename.ps1
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public static class R {
  [DllImport("kernel32", SetLastError=true, CharSet=CharSet.Unicode)] public static extern IntPtr CreateFileW(string f, uint a, uint s, IntPtr sa, uint c, uint fl, IntPtr t);
  [DllImport("kernel32")] public static extern bool CloseHandle(IntPtr h);
  [DllImport("ntdll")] public static extern int NtSetInformationFile(IntPtr h, byte[] iosb, IntPtr info, uint len, int cls);
  public static string Rename(string dir, string from, string to, int cls, uint flags, bool relative) {
    IntPtr d = CreateFileW(dir, 0x100001 /*FILE_LIST_DIRECTORY|SYNCHRONIZE*/ | 0x20 /*TRAVERSE*/, 7, IntPtr.Zero, 3, 0x02000000, IntPtr.Zero);
    System.IO.File.WriteAllText(System.IO.Path.Combine(dir, from), "x");
    IntPtr f = CreateFileW(System.IO.Path.Combine(dir, from), 0x10000 /*DELETE*/ | 0x100000, 7, IntPtr.Zero, 3, 0, IntPtr.Zero);
    string name = relative ? to : @"\??\" + System.IO.Path.Combine(dir, to);
    byte[] n = System.Text.Encoding.Unicode.GetBytes(name);
    int hdr = IntPtr.Size == 8 ? 20 : 12; // Flags/BOOLEAN(4, padded to 8 on x64) + RootDirectory + FileNameLength
    int len = 8 + IntPtr.Size + 4 + n.Length; IntPtr buf = Marshal.AllocHGlobal(len + 8);
    for (int i = 0; i < len + 8; i++) Marshal.WriteByte(buf, i, 0);
    Marshal.WriteInt32(buf, 0, (int)flags); Marshal.WriteIntPtr(buf, 8, relative ? d : IntPtr.Zero); Marshal.WriteInt32(buf, 8 + IntPtr.Size, n.Length);
    Marshal.Copy(n, 0, IntPtr.Add(buf, 8 + IntPtr.Size + 4), n.Length);
    int rc = NtSetInformationFile(f, new byte[16], buf, (uint)len, cls);
    CloseHandle(f); CloseHandle(d); Marshal.FreeHGlobal(buf);
    try { System.IO.File.Delete(System.IO.Path.Combine(dir, from)); System.IO.File.Delete(System.IO.Path.Combine(dir, to)); } catch {}
    return string.Format("0x{0:X8}", rc);
  }
}
"@
$dir = Join-Path (Get-Location).Path "rename-test"; New-Item -ItemType Directory -Force $dir | Out-Null
"Ex  POSIX|IGNORE_RO relative : " + [R]::Rename($dir, "a.tmp", "b.tmp", 65, 0x42, $true)
"Ex  POSIX|IGNORE_RO absolute : " + [R]::Rename($dir, "a.tmp", "b.tmp", 65, 0x42, $false)
"Ex  no flags        relative : " + [R]::Rename($dir, "a.tmp", "b.tmp", 65, 0, $true)
"Ex  POSIX only      relative : " + [R]::Rename($dir, "a.tmp", "b.tmp", 65, 0x2, $true)
"Ex  IGNORE_RO only  relative : " + [R]::Rename($dir, "a.tmp", "b.tmp", 65, 0x40, $true)
"Old                 relative : " + [R]::Rename($dir, "a.tmp", "b.tmp", 10, 0, $true)
"Old                 absolute : " + [R]::Rename($dir, "a.tmp", "b.tmp", 10, 0, $false)
