// What a confined program can do to the user's desktop. Compiled by the test outside the
// sandbox, run inside it: the shape of an agent that wrote, built and ran a program to drive
// the mouse. Each line says what the call returned and where the cursor really is after it.
using System;
using System.Runtime.InteropServices;

class DesktopProbe {
  [StructLayout(LayoutKind.Sequential)] struct Point { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] struct MouseInput { public int dx, dy, mouseData, dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct Input { public int type; public MouseInput mi; }
  delegate bool EnumProc(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out Point p);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern uint SendInput(uint count, Input[] inputs, int size);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr data);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool OpenClipboard(IntPtr owner);
  [DllImport("user32.dll")] static extern bool CloseClipboard();

  static string Cursor() { Point p; GetCursorPos(out p); return p.X + "," + p.Y; }

  static void Main() {
    // An absolute move to the screen's top-left corner, as injected input.
    var move = new[] { new Input { type = 0, mi = new MouseInput { dwFlags = 0x8001 } } };
    SendInput(1, move, Marshal.SizeOf(typeof(Input)));
    Console.WriteLine("after SendInput cursor=" + Cursor());
    Console.WriteLine("SetCursorPos=" + SetCursorPos(1, 1) + " cursor=" + Cursor());
    int visible = 0;
    EnumWindows((window, data) => { if (IsWindowVisible(window)) visible++; return true; }, IntPtr.Zero);
    Console.WriteLine("visibleWindows=" + visible);
    bool clipboard = OpenClipboard(IntPtr.Zero);
    if (clipboard) CloseClipboard();
    Console.WriteLine("OpenClipboard=" + clipboard);
  }
}
