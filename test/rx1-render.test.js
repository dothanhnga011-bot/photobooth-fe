// A sheet is drawn on the printer's own pixel grid (one high-quality resample, then 1:1 — the DNP driver
// no longer stretches it) and sharpened on luminance. Runs the real PowerShell functions of both the
// room print agent and the backend printer script on a striped test sheet. Windows only (GDI+).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

const skip = process.platform !== "win32" && "Windows GDI+ only";
const scripts = {
  agent: new URL("../src/admin/installers/print-agent-dnp.ps1", import.meta.url),
  backend: new URL("../../photobooth-be/scripts/print-dnp.ps1", import.meta.url),
};
const harness = `param([string]$Source)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$syntaxErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($Source, [ref]$null, [ref]$syntaxErrors)
if ($syntaxErrors.Count) { throw ($syntaxErrors | Out-String) }
foreach ($function in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
  if ($function.Name -in @('Get-Rx1SharpenAmount','Initialize-Rx1Sharpen','Add-Rx1TestLabels','New-Rx1PageBitmap','New-Rx1ImageAttributes')) {
    Invoke-Expression $function.Extent.Text
  }
}
# Tờ 2400 x 3600 sọc NGANG xám 100 / 160, mỗi sọc 120 điểm: cột giữa của mọi dải tờ thử cắt qua đúng
# cùng các mép (cùng hàng), nên so được độ nét giữa các dải.
$sheet = New-Object Drawing.Bitmap 2400, 3600
$g = [Drawing.Graphics]::FromImage($sheet)
$g.Clear([Drawing.Color]::FromArgb(100, 100, 100))
$light = New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(160, 160, 160))
for ($y = 120; $y -lt 3600; $y += 240) { $g.FillRectangle($light, 0, $y, 2400, 120) }
$light.Dispose(); $g.Dispose()
# Nhỏ nhất / lớn nhất dọc cột giữa của từng dải (1/5 chiều ngang), phần giữa tờ (tránh nhãn và chú thích).
function Measure-Bands([Drawing.Bitmap]$page) {
  $band = $page.Width / 5
  $min = @(); $max = @()
  for ($i = 0; $i -lt 5; $i++) {
    $x = [int](($i + 0.5) * $band)
    $values = @([int]($page.Height * 0.3)..[int]($page.Height * 0.7) | ForEach-Object { $page.GetPixel($x, $_).R })
    $min += ($values | Measure-Object -Minimum).Minimum; $max += ($values | Measure-Object -Maximum).Maximum
  }
  return @{ min = $min; max = $max }
}
function Hash([Drawing.Bitmap]$page) {
  $stream = New-Object IO.MemoryStream
  try {
    $page.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
    $md5 = [Security.Cryptography.MD5]::Create()
    try { return [BitConverter]::ToString($md5.ComputeHash($stream.ToArray())) } finally { $md5.Dispose() }
  } finally { $stream.Dispose() }
}
$plain = New-Rx1PageBitmap $sheet 413 615 300 300 1.0 0
$resampler = $script:Rx1Resampler
# Đối chứng: cùng tờ, cùng cách phủ trang, co bằng bicubic chất lượng cao của GDI+ (cách cũ).
$fit = [Math]::Max(1239 / 2400, 1845 / 3600)
$gdi = New-Object Drawing.Bitmap 1239, 1845
$gg = [Drawing.Graphics]::FromImage($gdi)
$gg.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gg.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$wrap = New-Object Drawing.Imaging.ImageAttributes
$wrap.SetWrapMode([Drawing.Drawing2D.WrapMode]::TileFlipXY)
$gg.DrawImage($sheet, (New-Object Drawing.Rectangle([int][Math]::Round((1239 - 2400 * $fit) / 2), [int][Math]::Round((1845 - 3600 * $fit) / 2), [int][Math]::Ceiling(2400 * $fit), [int][Math]::Ceiling(3600 * $fit))), 0, 0, 2400, 3600, [Drawing.GraphicsUnit]::Pixel, $wrap)
$wrap.Dispose(); $gg.Dispose()
# Độ dốc lớn nhất giữa hai hàng liền nhau dọc một cột (mép sọc càng dốc càng sắc).
function Steepness([Drawing.Bitmap]$page) {
  $steps = @([int]($page.Height * 0.3)..[int]($page.Height * 0.7) | ForEach-Object { [Math]::Abs($page.GetPixel(600, $_ + 1).R - $page.GetPixel(600, $_).R) })
  return ($steps | Measure-Object -Maximum).Maximum
}
# Nhỏ nhất / lớn nhất dọc cột 600 trong khoảng hàng [from, to] (tỉ lệ chiều cao).
function Span([Drawing.Bitmap]$page, [double]$from, [double]$to) {
  $values = @([int]($page.Height * $from)..[int]($page.Height * $to) | ForEach-Object { $page.GetPixel(600, $_).R })
  return @{ min = ($values | Measure-Object -Minimum).Minimum; max = ($values | Measure-Object -Maximum).Maximum }
}
$timer = [Diagnostics.Stopwatch]::StartNew()
$sharp = New-Rx1PageBitmap $sheet 413 615 300 300 1.0 4
$timer.Stop()
$hires = New-Rx1PageBitmap $sheet 413 615 300 600 1.0 2
$sheetTest = New-Rx1PageBitmap $sheet 413 615 300 300 1.0 2 2
# Chỉ nửa trên của tờ là ô ảnh: nửa trên nét đủ mức 4, nửa dưới (chữ / khung) một nửa.
$masked = New-Rx1PageBitmap $sheet 413 615 300 300 1.0 4 -1 @(0, 0, 1, 0.5)
# Giữa một sọc (xa mép): làm nét không đổi gì. Tờ phủ kín trang: co theo tỉ lệ lớn hơn, cắt đều hai đầu.
$scale = [Math]::Max(1239 / 2400, 1845 / 3600); $offset = (1845 - 3600 * $scale) / 2
$centers = @(10..20 | ForEach-Object { [int](($_ * 120 + 60) * $scale + $offset) })
$flatSame = -not @($centers | Where-Object { $plain.GetPixel(600, $_).R -ne $sharp.GetPixel(600, $_).R }).Count
$band = $sheetTest.Width / 5
$labelY = [int](0.22 * 300 + 8)
$result = @{
  plainSize = "$($plain.Width)x$($plain.Height)"; hiresSize = "$($hires.Width)x$($hires.Height)"
  plain = (Measure-Bands $plain); sharp = (Measure-Bands $sharp); test = (Measure-Bands $sheetTest)
  currentLabel = @($sheetTest.GetPixel([int](2 * $band + $band * 0.24), $labelY) | ForEach-Object { $_.R, $_.G, $_.B })
  otherLabel = @($sheetTest.GetPixel([int](0 * $band + $band * 0.24), $labelY) | ForEach-Object { $_.R, $_.G, $_.B })
  flatSame = $flatSame; hash = (Hash $sharp); testHash = (Hash $sheetTest); ms = $timer.ElapsedMilliseconds
  resampler = $resampler; steepLanczos = (Steepness $plain); steepGdi = (Steepness $gdi)
  maskedTop = (Span $masked 0.3 0.45); maskedBottom = (Span $masked 0.55 0.7)
  sharpTop = (Span $sharp 0.3 0.45); sharpBottom = (Span $sharp 0.55 0.7); plainBottom = (Span $plain 0.55 0.7)
  sharpenError = $script:Rx1SharpenError
}
foreach ($page in @($plain, $sharp, $hires, $sheetTest, $masked, $gdi, $sheet)) { $page.Dispose() }
$result | ConvertTo-Json -Depth 4 -Compress
`;

async function render(source, folder) {
  const file = path.join(folder, "render.ps1");
  await writeFile(file, "\ufeff" + harness);
  const { stdout } = await promisify(execFile)("powershell.exe", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", file, "-Source", fileURLToPath(source),
  ], { windowsHide: true, timeout: 120000 });
  return JSON.parse(stdout);
}

test("RX1 sheets are drawn on the printer's pixel grid and sharpened; the test sheet steps through levels 0–4", { skip, timeout: 240000 }, async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "rx1-render-"));
  try {
    const agent = await render(scripts.agent, folder);
    const backend = await render(scripts.backend, folder);
    assert.equal(agent.sharpenError, null, "the sharpening filter compiles");
    // Trang DNP 4,13 x 6,15 inch: 300 x 300 dpi → 1239 x 1845 điểm; 300 x 600 (High resolution) → 1239 x 3690.
    assert.equal(agent.plainSize, "1239x1845");
    assert.equal(agent.hiresSize, "1239x3690");
    // Mức 4: mép tối tối hơn, mép sáng sáng hơn mức 0; giữa sọc (xa mép) giữ nguyên.
    const low = (m) => Math.min(...m.min), high = (m) => Math.max(...m.max);
    assert.ok(low(agent.sharp) <= low(agent.plain) - 6, `edges darken: ${low(agent.plain)} → ${low(agent.sharp)}`);
    assert.ok(high(agent.sharp) >= high(agent.plain) + 6, `edges brighten: ${high(agent.plain)} → ${high(agent.sharp)}`);
    assert.equal(agent.flatSame, true, "flat areas are not sharpened (no grain)");
    // Tờ thử: dải 0 như không làm nét, các dải sau nét dần lên tới dải 4.
    assert.ok(Math.abs(agent.test.min[0] - agent.plain.min[0]) <= 1 && Math.abs(agent.test.max[0] - agent.plain.max[0]) <= 1,
      JSON.stringify({ test: agent.test, plain: agent.plain }));
    for (let i = 1; i < 5; i++) {
      assert.ok(agent.test.min[i] < agent.test.min[i - 1], `band ${i} darker edge: ${agent.test.min}`);
      assert.ok(agent.test.max[i] > agent.test.max[i - 1], `band ${i} brighter edge: ${agent.test.max}`);
    }
    assert.deepEqual(agent.currentLabel, [45, 30, 24], "the level in use has a dark label");
    assert.deepEqual(agent.otherLabel, [255, 255, 255], "other levels have white labels");
    assert.ok(agent.ms < 10000, `resampling + sharpening takes ${agent.ms} ms`);
    // Lanczos3: mép sọc dốc hơn bicubic của GDI+ (cách co cũ) trên cùng một tờ.
    assert.equal(agent.resampler, "lanczos3");
    assert.ok(agent.steepLanczos > agent.steepGdi, `edge step: lanczos ${agent.steepLanczos}, gdi ${agent.steepGdi}`);
    // Có vị trí ô ảnh: trong ô nét như làm nét cả tờ; ngoài ô (chữ / khung) chỉ một nửa nhưng vẫn hơn không làm nét.
    assert.deepEqual(agent.maskedTop, agent.sharpTop);
    assert.ok(agent.maskedBottom.min > agent.sharpBottom.min && agent.maskedBottom.max < agent.sharpBottom.max, JSON.stringify(agent));
    assert.ok(agent.maskedBottom.min < agent.plainBottom.min && agent.maskedBottom.max > agent.plainBottom.max, JSON.stringify(agent));
    // Agent của phòng và script in của backend cho ra đúng cùng một ảnh.
    assert.equal(backend.hash, agent.hash);
    assert.equal(backend.testHash, agent.testHash);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
