$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$outputPath = Join-Path $repositoryRoot 'frontend\public\hollowrun.png'
$size = 256
$bitmap = [System.Drawing.Bitmap]::new(
    $size,
    $size,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$brush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
$outerGlowPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(34, 255, 255, 255), 18)
$innerGlowPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(70, 255, 255, 255), 9)
$hPath = [System.Drawing.Drawing2D.GraphicsPath]::new()
$rPath = [System.Drawing.Drawing2D.GraphicsPath]::new(
    [System.Drawing.Drawing2D.FillMode]::Alternate
)

try {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $outerGlowPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $innerGlowPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    [System.Drawing.PointF[]]$hPoints = @(
        [System.Drawing.PointF]::new(31, 42),
        [System.Drawing.PointF]::new(63, 42),
        [System.Drawing.PointF]::new(63, 111),
        [System.Drawing.PointF]::new(101, 111),
        [System.Drawing.PointF]::new(101, 42),
        [System.Drawing.PointF]::new(133, 42),
        [System.Drawing.PointF]::new(133, 214),
        [System.Drawing.PointF]::new(101, 214),
        [System.Drawing.PointF]::new(101, 143),
        [System.Drawing.PointF]::new(63, 143),
        [System.Drawing.PointF]::new(63, 214),
        [System.Drawing.PointF]::new(31, 214)
    )
    $hPath.AddPolygon($hPoints)

    $rPath.StartFigure()
    $rPath.AddLine(101, 42, 167, 42)
    $rPath.AddBezier(167, 42, 201, 42, 219, 60, 219, 90)
    $rPath.AddBezier(219, 90, 219, 113, 207, 129, 184, 136)
    $rPath.AddLine(184, 136, 225, 214)
    $rPath.AddLine(225, 214, 189, 214)
    $rPath.AddLine(189, 214, 153, 141)
    $rPath.AddLine(153, 141, 133, 141)
    $rPath.AddLine(133, 141, 133, 214)
    $rPath.AddLine(133, 214, 101, 214)
    $rPath.CloseFigure()

    $rPath.StartFigure()
    $rPath.AddLine(133, 70, 133, 113)
    $rPath.AddLine(133, 113, 165, 113)
    $rPath.AddBezier(165, 113, 181, 113, 189, 105, 189, 91)
    $rPath.AddBezier(189, 91, 189, 77, 181, 70, 165, 70)
    $rPath.CloseFigure()

    $graphics.DrawPath($outerGlowPen, $hPath)
    $graphics.DrawPath($outerGlowPen, $rPath)
    $graphics.DrawPath($innerGlowPen, $hPath)
    $graphics.DrawPath($innerGlowPen, $rPath)
    $graphics.FillPath($brush, $hPath)
    $graphics.FillPath($brush, $rPath)
    $bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
    $rPath.Dispose()
    $hPath.Dispose()
    $innerGlowPen.Dispose()
    $outerGlowPen.Dispose()
    $brush.Dispose()
    $graphics.Dispose()
    $bitmap.Dispose()
}

Write-Output "Generated $outputPath"
