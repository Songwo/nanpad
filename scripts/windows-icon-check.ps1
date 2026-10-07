param(
  [Parameter(Mandatory = $true)][string]$IconPath,
  [Parameter(Mandatory = $true)][string]$OutputPng
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ZhiyuShellIcon {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct Info {
    public IntPtr Icon;
    public int Index;
    public uint Attributes;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string Display;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=80)] public string Type;
  }
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
  public static extern IntPtr SHGetFileInfo(string path, uint attrs, out Info info, uint size, uint flags);
  [DllImport("user32.dll")]
  public static extern bool DestroyIcon(IntPtr icon);
}
"@

# 直接查询 Windows Shell 的文件图标，避免 Electron 接口返回通用文件类型图标。
$resolvedIcon = (Resolve-Path -LiteralPath $IconPath).Path
$info = New-Object ZhiyuShellIcon+Info
$result = [ZhiyuShellIcon]::SHGetFileInfo($resolvedIcon, 0, [ref]$info, [System.Runtime.InteropServices.Marshal]::SizeOf($info), 0x100)
if ($result -eq [IntPtr]::Zero -or $info.Icon -eq [IntPtr]::Zero) { throw 'Windows returned no icon' }
$icon = $null
$bitmap = $null
try {
  $icon = [System.Drawing.Icon]::FromHandle($info.Icon)
  $bitmap = $icon.ToBitmap()
  $opaque = 0
  $brandPixels = 0
  for ($y = 0; $y -lt $bitmap.Height; $y++) {
    for ($x = 0; $x -lt $bitmap.Width; $x++) {
      $pixel = $bitmap.GetPixel($x, $y)
      if ($pixel.A -lt 200) { continue }
      $opaque++
      # 品牌的深青和浅玉色都满足这个范围，通用文件夹或 Electron 图标不应通过。
      if ([int]$pixel.G - [int]$pixel.R -ge 15 -and [int]$pixel.B - [int]$pixel.R -ge 10) { $brandPixels++ }
    }
  }
  $bitmap.Save([IO.Path]::GetFullPath($OutputPng))
  $valid = $opaque -gt 0 -and ($brandPixels / $opaque) -gt 0.5
  @{ ok = $valid; opaque = $opaque; brandPixels = $brandPixels } | ConvertTo-Json -Compress
  if (-not $valid) { exit 1 }
} finally {
  if ($bitmap) { $bitmap.Dispose() }
  if ($icon) { $icon.Dispose() }
  [ZhiyuShellIcon]::DestroyIcon($info.Icon) | Out-Null
}
