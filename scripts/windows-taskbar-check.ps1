param(
  [Parameter(Mandatory = $true)][long]$WindowHandle,
  [Parameter(Mandatory = $true)][string]$ExpectedAppId,
  [Parameter(Mandatory = $true)][string]$ExpectedIconPath,
  [Parameter(Mandatory = $true)][string]$ExpectedExecutable
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ZhiyuTaskbarProperties {
  [StructLayout(LayoutKind.Sequential)]
  public struct Key {
    public Guid Format;
    public uint Id;
    public Key(uint id) { Format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"); Id = id; }
  }
  [StructLayout(LayoutKind.Explicit, Size=24)]
  public struct Value {
    [FieldOffset(0)] public ushort Type;
    [FieldOffset(8)] public IntPtr Text;
  }
  [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface Store {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int GetAt(uint index, out Key key);
    [PreserveSig] int GetValue(ref Key key, out Value value);
  }
  [DllImport("shell32.dll")]
  static extern int SHGetPropertyStoreForWindow(IntPtr window, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out Store store);
  [DllImport("ole32.dll")]
  static extern int PropVariantClear(ref Value value);
  // 只读接口：验证任务栏实际分组属性，不能修改被测窗口。
  public static string Read(IntPtr window, uint id) {
    Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
    Store store;
    Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(window, ref iid, out store));
    try {
      Key key = new Key(id);
      Value value;
      Marshal.ThrowExceptionForHR(store.GetValue(ref key, out value));
      try { return value.Type == 31 ? Marshal.PtrToStringUni(value.Text) : null; }
      finally { PropVariantClear(ref value); }
    } finally { Marshal.ReleaseComObject(store); }
  }
}
"@
$window = [IntPtr]$WindowHandle
$appId = [ZhiyuTaskbarProperties]::Read($window, 5)
$icon = [ZhiyuTaskbarProperties]::Read($window, 3)
$command = [ZhiyuTaskbarProperties]::Read($window, 2)
$displayName = [ZhiyuTaskbarProperties]::Read($window, 4)
if ($appId -cne $ExpectedAppId) { throw "Taskbar identity mismatch: $appId" }
if (-not [string]::Equals($icon, "$ExpectedIconPath,0", [StringComparison]::OrdinalIgnoreCase)) { throw 'Taskbar icon path mismatch' }
if (-not [string]::Equals($command, ('"' + $ExpectedExecutable + '"'), [StringComparison]::OrdinalIgnoreCase)) { throw 'Taskbar relaunch command mismatch' }
if ($displayName -cne '知屿 Zhiyu') { throw "Taskbar display name mismatch: $displayName" }
@{ ok = $true; appId = $appId; displayName = $displayName; icon = $icon } | ConvertTo-Json -Compress
