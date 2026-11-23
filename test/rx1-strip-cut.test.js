// Tờ cắt đôi (2 dải 5 × 15) in đúng tỉ lệ thiết kế và dời theo "Dời đường cắt dải" (23/11): chạy các hàm
// PowerShell thật của bộ in RX1 trên một tờ thử. Windows only (GDI+).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

const skip = process.platform !== "win32" && "Windows GDI+ only";
const agent = new URL("../src/admin/installers/print-agent-dnp.ps1", import.meta.url);
const harness = `param([string]$Source, [string]$Out)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$syntaxErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($Source, [ref]$null, [ref]$syntaxErrors)
if ($syntaxErrors.Count) { throw ($syntaxErrors | Out-String) }
$wanted = @('Get-Rx1SharpenAmount','Initialize-Rx1Sharpen','Add-Rx1TestLabels','New-Rx1PageBitmap','New-Rx1ImageAttributes','Write-Rx1Page','New-Rx1CutChart')
foreach ($function in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
  if ($function.Name -in $wanted) { Invoke-Expression $function.Extent.Text }
}
# Tờ 2400 x 3600 (4 x 6 inch): nền xám, 40 điểm mép trái xanh dương, mép phải xanh lá, vạch đen 8 điểm ở giữa.
function New-Sheet {
  $sheet = New-Object Drawing.Bitmap 2400, 3600
  $g = [Drawing.Graphics]::FromImage($sheet)
  $g.Clear([Drawing.Color]::FromArgb(128, 128, 128))
  $blue = New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(0, 0, 255)); $green = New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(0, 255, 0))
  $g.FillRectangle($blue, 0, 0, 40, 3600); $g.FillRectangle($green, 2360, 0, 40, 3600)
  $g.FillRectangle([Drawing.Brushes]::Black, 1196, 0, 8, 3600)
  $blue.Dispose(); $green.Dispose(); $g.Dispose()
  return $sheet
}
# Vị trí tối nhất (vạch giữa) dọc một hàng (ngang) hoặc một cột (dọc), có nội suy theo độ tối.
function Line([Drawing.Bitmap]$page, [int]$at, [bool]$vertical = $false) {
  $count = if ($vertical) { $page.Height } else { $page.Width }
  $sum = 0.0; $weight = 0.0
  for ($i = 0; $i -lt $count; $i++) {
    $p = if ($vertical) { $page.GetPixel($at, $i) } else { $page.GetPixel($i, $at) }
    $dark = [Math]::Max(0, 128 - ($p.R + $p.G + $p.B) / 3)
    if ($p.B -lt 100 -and $p.G -lt 100) { $sum += $i * $dark; $weight += $dark }
  }
  return [Math]::Round($sum / $weight, 2)
}
function Rgb($pixel) { return @($pixel.R, $pixel.G, $pixel.B) }
$sheet = New-Sheet
$cover = New-Rx1PageBitmap $sheet 413 615 300 300 1.0 0
$exact = New-Rx1PageBitmap $sheet 413 615 300 300 1.0 0 -1 @() $true
$mm = 2400 / (4 * 25.4)
$shifted = New-Rx1PageBitmap $sheet 413 615 300 300 1.0 0 -1 @() $true $mm 0
# Trang ngang của driver: tờ dọc xoay 90 độ, dời +1 mm của thiết kế thành +y của trang.
$target = New-Object Drawing.Bitmap 1845, 1239
$target.SetResolution(300, 300)
$graphics = [Drawing.Graphics]::FromImage($target)
$event = [pscustomobject]@{ Graphics = $graphics; PageBounds = (New-Object Drawing.Rectangle(0, 0, 615, 413));
  PageSettings = [pscustomobject]@{ HardMarginX = 0; HardMarginY = 0 } }
$turnedSheet = New-Sheet
$grid = Write-Rx1Page $event $turnedSheet 1.0 0 -1 @() $true 1.0
$graphics.Dispose()
# Tờ thường (không cắt) bỏ qua độ dời.
$plainTarget = New-Object Drawing.Bitmap 1239, 1845
$plainTarget.SetResolution(300, 300)
$plainGraphics = [Drawing.Graphics]::FromImage($plainTarget)
$plainEvent = [pscustomobject]@{ Graphics = $plainGraphics; PageBounds = (New-Object Drawing.Rectangle(0, 0, 413, 615));
  PageSettings = [pscustomobject]@{ HardMarginX = 0; HardMarginY = 0 } }
$plainSheet = New-Sheet
[void](Write-Rx1Page $plainEvent $plainSheet 1.0 0 -1 @() $false 3.0)
$plainGraphics.Dispose()
$chartPath = Join-Path $Out 'cut-chart.png'
New-Rx1CutChart $chartPath
$chart = [Drawing.Bitmap]::FromFile($chartPath)
$result = @{
  size = "$($exact.Width)x$($exact.Height)"
  coverCenter = (Line $cover 900); exactCenter = (Line $exact 900); shiftedCenter = (Line $shifted 900)
  turnedGrid = $grid; turnedCenter = (Line $target 900 $true); plainCenter = (Line $plainTarget 900)
  coverEdge = (Rgb $cover.GetPixel(5, 900)); exactBleed = (Rgb $exact.GetPixel(5, 900)); exactBlueEnd = (Rgb $exact.GetPixel(36, 900))
  exactGray = (Rgb $exact.GetPixel(45, 900)); exactRightBleed = (Rgb $exact.GetPixel(1234, 900))
  chartSize = "$($chart.Width)x$($chart.Height)"; chartZero = (Rgb $chart.GetPixel(1200, 1000))
  chartLeft = (Rgb $chart.GetPixel([int](1200 - 2.25 * $mm), 1500)); chartRight = (Rgb $chart.GetPixel([int](1200 + 2.25 * $mm), 1500))
  chartOneMm = (Rgb $chart.GetPixel([int][Math]::Round(1200 + $mm), 1000)); chartPaper = (Rgb $chart.GetPixel(600, 3500))
}
$chart.Dispose()
foreach ($image in @($sheet, $cover, $exact, $shifted, $target, $turnedSheet, $plainTarget, $plainSheet)) { $image.Dispose() }
$result | ConvertTo-Json -Depth 4 -Compress
`;

test("strip sheets print at their designed size and move with the cut calibration; the cut chart has its ruler", { skip, timeout: 240000 }, async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "rx1-strip-cut-"));
  try {
    const file = path.join(folder, "strip.ps1");
    await writeFile(file, "﻿" + harness);
    const { stdout } = await promisify(execFile)("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file, "-Source", fileURLToPath(agent), "-Out", folder,
    ], { windowsHide: true, timeout: 200000, maxBuffer: 4 * 1024 * 1024 });
    const r = JSON.parse(stdout);
    // Trang DNP 4,13 × 6,15 inch ở 300 dpi: 1239 × 1845 điểm; giữa trang ngang 619,5.
    assert.equal(r.size, "1239x1845");
    const near = (value, expected, tolerance = 1.2) => Math.abs(value - expected) <= tolerance;
    assert.ok(near(r.coverCenter, 619.5), `full sheet centred: ${r.coverCenter}`);
    assert.ok(near(r.exactCenter, 619.5), `strip sheet centred: ${r.exactCenter}`);
    // Tờ thường phủ kín trang (mép xanh ra tới mép trang); tờ cắt đôi đúng 4 inch = 1200 điểm, phần tràn lề
    // 19,5 điểm mỗi bên lấp bằng màu mép kéo dài — không có viền trắng.
    assert.deepEqual(r.coverEdge, [0, 0, 255]);
    assert.deepEqual(r.exactBleed, [0, 0, 255], "the bleed repeats the edge colour");
    assert.deepEqual(r.exactBlueEnd, [0, 0, 255], "40 design pixels of edge = 20 page pixels after the 19.5 px bleed");
    assert.deepEqual(r.exactGray, [128, 128, 128]);
    assert.deepEqual(r.exactRightBleed, [0, 255, 0]);
    // Dời +1 mm = 11,81 điểm ở 300 dpi, sang phải (dải phải).
    assert.ok(near(r.shiftedCenter - r.exactCenter, 300 / 25.4, 0.6), `1 mm shift: ${r.shiftedCenter - r.exactCenter}`);
    // Trang ngang (tờ xoay 90°): vạch giữa thành đường ngang, dời +1 mm thành +y.
    assert.equal(r.turnedGrid, "1845x1239");
    assert.ok(near(r.turnedCenter, 619.5 + 300 / 25.4, 1.2), `turned page shift: ${r.turnedCenter}`);
    // Tờ thường (không cắt đôi): bỏ qua độ dời.
    assert.ok(near(r.plainCenter, 619.5), `full sheets ignore the strip shift: ${r.plainCenter}`);
    // Tờ thử đường cắt: vạch đỏ 0 ở giữa, nền xanh bên trái, hồng bên phải, vạch +1 mm, giấy trắng ngoài thước.
    assert.equal(r.chartSize, "2400x3600");
    assert.ok(r.chartZero[0] > 150 && r.chartZero[1] < 80, `zero line is red: ${r.chartZero}`);
    assert.deepEqual(r.chartLeft, [214, 232, 252]);
    assert.deepEqual(r.chartRight, [252, 222, 228]);
    assert.ok(Math.max(...r.chartOneMm) < 90, `1 mm tick is dark: ${r.chartOneMm}`);
    assert.deepEqual(r.chartPaper, [255, 255, 255]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
