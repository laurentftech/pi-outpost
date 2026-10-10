// Which named kernel objects a sandboxed process may create: the MSYS2 runtime (Git Bash) creates
// its own object directory and shared memory at start, and dies with 0xC0000142 when refused
// (docs/investigations/windows-sandboxing.md, findings 3 and 7).
//
// Build: C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /out:%USERPROFILE%\tools\named-objects.exe scripts\probes\named-objects.cs
// Run inside the sandbox through mxc-run.mjs with ~\tools readable. One line per attempt.
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;

static class NamedObjects {
  [StructLayout(LayoutKind.Sequential)]
  struct UNICODE_STRING { public ushort Length, MaximumLength; public IntPtr Buffer; }
  [StructLayout(LayoutKind.Sequential)]
  struct OBJECT_ATTRIBUTES { public int Length; public IntPtr RootDirectory, ObjectName; public uint Attributes; public IntPtr SecurityDescriptor, SecurityQualityOfService; }

  [DllImport("ntdll")] static extern int NtCreateDirectoryObject(out IntPtr h, uint access, ref OBJECT_ATTRIBUTES oa);
  [DllImport("ntdll")] static extern int NtOpenDirectoryObject(out IntPtr h, uint access, ref OBJECT_ATTRIBUTES oa);
  [DllImport("ntdll")] static extern void RtlInitUnicodeString(out UNICODE_STRING s, [MarshalAs(UnmanagedType.LPWStr)] string src);
  [DllImport("ntdll")] static extern int NtClose(IntPtr h);
  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateMutexW(IntPtr sa, bool owner, string name);
  [DllImport("kernel32", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateFileMappingW(IntPtr file, IntPtr sa, uint protect, uint hi, uint lo, string name);
  [DllImport("kernel32")] static extern bool CloseHandle(IntPtr h);

  const uint OBJ_CASE_INSENSITIVE = 0x40, OBJ_OPENIF = 0x80, DIRECTORY_ALL_ACCESS = 0xF000F, DIRECTORY_QUERY_TRAVERSE = 3;

  static int NtDir(string path, bool create) {
    UNICODE_STRING name; RtlInitUnicodeString(out name, path);
    IntPtr pName = Marshal.AllocHGlobal(Marshal.SizeOf(name)); Marshal.StructureToPtr(name, pName, false);
    var oa = new OBJECT_ATTRIBUTES { Length = Marshal.SizeOf(typeof(OBJECT_ATTRIBUTES)), ObjectName = pName, Attributes = OBJ_CASE_INSENSITIVE | OBJ_OPENIF };
    IntPtr h; int st = create ? NtCreateDirectoryObject(out h, DIRECTORY_ALL_ACCESS, ref oa) : NtOpenDirectoryObject(out h, DIRECTORY_QUERY_TRAVERSE, ref oa);
    if (st >= 0) NtClose(h);
    Marshal.FreeHGlobal(pName);
    return st;
  }

  static void Line(string label, string result) { Console.WriteLine("{0,-58} {1}", label, result); }
  static string Nt(int st) { return st >= 0 ? "OK" : "NTSTATUS 0x" + st.ToString("X8"); }
  static string Win(IntPtr h) {
    if (h == IntPtr.Zero) { int e = Marshal.GetLastWin32Error(); return "ERROR " + e + " (" + new Win32Exception(e).Message + ")"; }
    CloseHandle(h); return "OK";
  }

  static void Main() {
    int session = Process.GetCurrentProcess().SessionId;
    string bno = "\\Sessions\\" + session + "\\BaseNamedObjects";
    string tag = "probe-" + Process.GetCurrentProcess().Id;
    Line("session", session.ToString());
    Line("open \\BaseNamedObjects", Nt(NtDir("\\BaseNamedObjects", false)));
    Line("open " + bno, Nt(NtDir(bno, false)));
    Line("create dir \\BaseNamedObjects\\" + tag, Nt(NtDir("\\BaseNamedObjects\\" + tag, true)));
    Line("create dir " + bno + "\\" + tag, Nt(NtDir(bno + "\\" + tag, true)));
    Line("mutex Global\\" + tag, Win(CreateMutexW(IntPtr.Zero, false, "Global\\" + tag)));
    Line("mutex Local\\" + tag, Win(CreateMutexW(IntPtr.Zero, false, "Local\\" + tag)));
    Line("mutex (no prefix) " + tag, Win(CreateMutexW(IntPtr.Zero, false, tag)));
    Line("mapping Global\\" + tag, Win(CreateFileMappingW(new IntPtr(-1), IntPtr.Zero, 4, 0, 4096, "Global\\" + tag)));
    Line("mapping Local\\" + tag, Win(CreateFileMappingW(new IntPtr(-1), IntPtr.Zero, 4, 0, 4096, "Local\\" + tag)));
    Line("mutex unnamed", Win(CreateMutexW(IntPtr.Zero, false, null)));
    // Where kernel32 actually put a Local\ object: the namespace the sandbox redirects names to.
    IntPtr m = CreateMutexW(IntPtr.Zero, false, "Local\\" + tag + "-where");
    string where = ObjectName(m);
    Line("Local\\ mutex lands in", where ?? "?");
    IntPtr g = CreateMutexW(IntPtr.Zero, false, "Global\\" + tag + "-where");
    Line("Global\\ mutex lands in", ObjectName(g) ?? "?");
    if (where != null) {
      string dir = where.Substring(0, where.LastIndexOf('\\'));
      Line("create dir in it: " + dir + "\\" + tag + "-dir", Nt(NtDir(dir + "\\" + tag + "-dir", true)));
    }
  }

  [DllImport("ntdll")] static extern int NtQueryObject(IntPtr h, int cls, IntPtr buf, int len, out int ret);
  static string ObjectName(IntPtr h) {
    if (h == IntPtr.Zero) return null;
    IntPtr buf = Marshal.AllocHGlobal(4096); int ret;
    try {
      if (NtQueryObject(h, 1, buf, 4096, out ret) < 0) return null; // ObjectNameInformation
      var s = (UNICODE_STRING)Marshal.PtrToStructure(buf, typeof(UNICODE_STRING));
      return s.Buffer == IntPtr.Zero ? "" : Marshal.PtrToStringUni(s.Buffer, s.Length / 2);
    } finally { Marshal.FreeHGlobal(buf); }
  }
}
