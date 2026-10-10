# Test for landstrip#204: does an "ALL APPLICATION PACKAGES" ACE on \Device\Null let AppContainers
# open NUL? Adds read/write for S-1-15-2-1 to the device's DACL. Needs an elevated session.
# Temporary by nature: device security descriptors are rebuilt at boot. -Remove takes it back out.
param([switch]$Remove)
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Security.AccessControl; using System.Security.Principal;
public static class NullDevice {
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sa, uint disposition, uint flags, IntPtr template);
  [DllImport("advapi32.dll", SetLastError=true)]
  static extern uint GetSecurityInfo(IntPtr h, int type, uint info, IntPtr o, IntPtr g, out IntPtr dacl, IntPtr sacl, out IntPtr sd);
  [DllImport("advapi32.dll", SetLastError=true)]
  static extern uint SetSecurityInfo(IntPtr h, int type, uint info, IntPtr o, IntPtr g, byte[] dacl, IntPtr sacl);
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  static extern bool ConvertSecurityDescriptorToStringSecurityDescriptorW(IntPtr sd, uint rev, uint info, out IntPtr s, out uint len);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  const uint READ_CONTROL = 0x20000, WRITE_DAC = 0x40000, DACL = 4; const int SE_KERNEL_OBJECT = 6;
  public static string Update(bool remove) {
    IntPtr h = CreateFileW(@"\\.\NUL", READ_CONTROL | WRITE_DAC, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if (h == new IntPtr(-1)) return "open failed: " + Marshal.GetLastWin32Error();
    try {
      IntPtr daclPtr, sd; uint e = GetSecurityInfo(h, SE_KERNEL_OBJECT, DACL, IntPtr.Zero, IntPtr.Zero, out daclPtr, IntPtr.Zero, out sd);
      if (e != 0) return "GetSecurityInfo " + e;
      IntPtr str; uint len; ConvertSecurityDescriptorToStringSecurityDescriptorW(sd, 1, DACL, out str, out len);
      var raw = new RawSecurityDescriptor(Marshal.PtrToStringUni(str));
      var dacl = raw.DiscretionaryAcl; var allPackages = new SecurityIdentifier("S-1-15-2-1");
      for (int i = dacl.Count - 1; i >= 0; i--) { var ace = dacl[i] as CommonAce; if (ace != null && ace.SecurityIdentifier == allPackages) dacl.RemoveAce(i); }
      if (!remove) dacl.InsertAce(dacl.Count, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, 0x0012019F, allPackages, false, null));
      var bytes = new byte[dacl.BinaryLength]; dacl.GetBinaryForm(bytes, 0);
      e = SetSecurityInfo(h, SE_KERNEL_OBJECT, DACL, IntPtr.Zero, IntPtr.Zero, bytes, IntPtr.Zero);
      return e == 0 ? (remove ? "removed" : "granted") + " ALL APPLICATION PACKAGES on \\Device\\Null" : "SetSecurityInfo " + e;
    } finally { CloseHandle(h); }
  }
}
"@
[NullDevice]::Update($Remove.IsPresent)
