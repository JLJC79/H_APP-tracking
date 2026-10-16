# Regenerates the PNG app icons in ../icons (Windows PowerShell, System.Drawing).
# Usage: powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1
param([string]$OutDir = (Join-Path $PSScriptRoot '..\icons'))
Add-Type -AssemblyName System.Drawing

function Make-Icon([int]$size, [bool]$maskable, [string]$path) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $gfx = [System.Drawing.Graphics]::FromImage($bmp)
  $gfx.SmoothingMode = 'AntiAlias'
  $gfx.Clear([System.Drawing.Color]::Transparent)
  $blue = [System.Drawing.Color]::FromArgb(255, 11, 95, 174)
  $brush = New-Object System.Drawing.SolidBrush $blue
  if ($maskable) {
    # Full bleed; artwork kept inside the 80% safe zone.
    $gfx.FillRectangle($brush, 0, 0, $size, $size)
    $pad = [int]($size * 0.22)
  } else {
    $r = [int]($size * 0.22)
    $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
    $gp.AddArc(0, 0, $r * 2, $r * 2, 180, 90)
    $gp.AddArc($size - $r * 2, 0, $r * 2, $r * 2, 270, 90)
    $gp.AddArc($size - $r * 2, $size - $r * 2, $r * 2, $r * 2, 0, 90)
    $gp.AddArc(0, $size - $r * 2, $r * 2, $r * 2, 90, 90)
    $gp.CloseFigure()
    $gfx.FillPath($brush, $gp)
    $pad = [int]($size * 0.14)
  }
  $w = $size - 2 * $pad
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), ([float]($size * 0.07))
  $pen.LineJoin = 'Round'; $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
  $mid = $size / 2
  # A simple pulse line.
  $pts = @(
    @(0.00, 0.0), @(0.28, 0.0), @(0.38, -0.30), @(0.50, 0.32), @(0.60, -0.12), @(0.68, 0.0), @(1.00, 0.0)
  ) | ForEach-Object { New-Object System.Drawing.PointF ([float]($pad + $_[0] * $w)), ([float]($mid + $_[1] * $w)) }
  $gfx.DrawLines($pen, [System.Drawing.PointF[]]$pts)
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $gfx.Dispose(); $bmp.Dispose()
}

New-Item -ItemType Directory -Force $OutDir | Out-Null
Make-Icon 192 $false (Join-Path $OutDir 'icon-192.png')
Make-Icon 512 $false (Join-Path $OutDir 'icon-512.png')
Make-Icon 512 $true  (Join-Path $OutDir 'icon-maskable-512.png')
Make-Icon 180 $true  (Join-Path $OutDir 'apple-touch-icon.png')
