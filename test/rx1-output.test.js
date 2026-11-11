import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

const skip = process.platform !== "win32" && "Windows GDI+ only";
const scripts = [
  ["local agent", new URL("../src/admin/installers/print-agent-dnp.ps1", import.meta.url)],
  ["backend printer", new URL("../../photobooth-be/scripts/print-dnp.ps1", import.meta.url)],
];
const probeSource = `param([string]$Source, [string]$Work)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$syntaxErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($Source, [ref]$null, [ref]$syntaxErrors)
if ($syntaxErrors.Count) { throw ($syntaxErrors | Out-String) }
foreach ($function in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
  if ($function.Name -in @('ConvertTo-Rx1Sharpen','Get-Rx1OutputSettings','Set-Rx1MaximumResolution','New-Rx1ImageAttributes')) { Invoke-Expression $function.Extent.Text }
}
$profilePath = Join-Path $Work 'rx1-output.json'
$defaults = Get-Rx1OutputSettings $profilePath
'{"gamma":1.0,"maxResolution":false}' | Set-Content -LiteralPath $profilePath -Encoding UTF8
$neutral = Get-Rx1OutputSettings $profilePath
'{"gamma":1.18,"maxResolution":true}' | Set-Content -LiteralPath $profilePath -Encoding UTF8
$legacy = Get-Rx1OutputSettings $profilePath
'{"gamma":1.30,"maxResolution":true}' | Set-Content -LiteralPath $profilePath -Encoding UTF8
$previous = Get-Rx1OutputSettings $profilePath
'{"gamma":1.40,"maxResolution":true}' | Set-Content -LiteralPath $profilePath -Encoding UTF8
$intermediate = Get-Rx1OutputSettings $profilePath
'{"gamma":1.50,"maxResolution":true}' | Set-Content -LiteralPath $profilePath -Encoding UTF8
$selected = Get-Rx1OutputSettings $profilePath
'{"gamma":2.20,"maxResolution":true}' | Set-Content -LiteralPath $profilePath -Encoding UTF8
$highest = Get-Rx1OutputSettings $profilePath
'{"gamma":0.99,"maxResolution":true}' | Set-Content -LiteralPath $profilePath -Encoding UTF8
$belowRange = Get-Rx1OutputSettings $profilePath
'{"gamma":2.21,"maxResolution":true}' | Set-Content -LiteralPath $profilePath -Encoding UTF8
$outOfRange = Get-Rx1OutputSettings $profilePath
'{"maxResolution":false}' | Set-Content -LiteralPath $profilePath -Encoding UTF8
$partial = Get-Rx1OutputSettings $profilePath
'{"gamma":20,"maxResolution":"yes"}' | Set-Content -LiteralPath $profilePath -Encoding UTF8
$invalid = Get-Rx1OutputSettings $profilePath
'{"gamma":1.30,"maxResolution":true,"sharpen":4}' | Set-Content -LiteralPath $profilePath -Encoding UTF8
$sharpest = Get-Rx1OutputSettings $profilePath
'{"gamma":1.30,"maxResolution":true,"sharpen":0}' | Set-Content -LiteralPath $profilePath -Encoding UTF8
$unsharpened = Get-Rx1OutputSettings $profilePath
'{"gamma":1.30,"maxResolution":true,"sharpen":7}' | Set-Content -LiteralPath $profilePath -Encoding UTF8
$sharpenOutOfRange = Get-Rx1OutputSettings $profilePath
'{"gamma":1.30,"maxResolution":true,"sharpen":"2"}' | Set-Content -LiteralPath $profilePath -Encoding UTF8
$sharpenText = Get-Rx1OutputSettings $profilePath

$inputImage = New-Object Drawing.Bitmap 5,1
$inputImage.SetPixel(0,0,[Drawing.Color]::Black)
$inputImage.SetPixel(1,0,[Drawing.Color]::FromArgb(128,128,128))
$inputImage.SetPixel(2,0,[Drawing.Color]::White)
$inputImage.SetPixel(3,0,[Drawing.Color]::FromArgb(200,150,100))
$inputImage.SetPixel(4,0,[Drawing.Color]::FromArgb(240,240,240))
function Render-Probe([double]$gamma) {
  $image = New-Object Drawing.Bitmap 5,1
  $graphics = [Drawing.Graphics]::FromImage($image)
  $attributes = New-Rx1ImageAttributes $gamma
  try {
    $graphics.DrawImage($inputImage,(New-Object Drawing.Rectangle 0,0,5,1),0,0,5,1,[Drawing.GraphicsUnit]::Pixel,$attributes)
    return ,@(0..4 | ForEach-Object { $c = $image.GetPixel($_,0); ,@($c.R,$c.G,$c.B,$c.A) })
  } finally { $attributes.Dispose(); $graphics.Dispose(); $image.Dispose() }
}
$pixels = @{ neutral = (Render-Probe $neutral.gamma); previous = (Render-Probe $previous.gamma); compensated = (Render-Probe $defaults.gamma); intermediate = (Render-Probe $intermediate.gamma); selected = (Render-Probe $selected.gamma); highest = (Render-Probe $highest.gamma) }
$inputImage.Dispose()
function Resolution([int]$x,[int]$y) { [pscustomobject]@{X=$x;Y=$y} }
function Pick([object[]]$choices, $current) {
  $page = [pscustomobject]@{PrinterResolution=$current}
  Set-Rx1MaximumResolution ([pscustomobject]@{PrinterResolutions=$choices}) $page
  return $page.PrinterResolution
}
$dpi = @{
  highest = (Pick @((Resolution 300 300),(Resolution 300 600),(Resolution 600 600),(Resolution -4 -1)) (Resolution 300 300));
  supported = (Pick @((Resolution 300 300),(Resolution 300 600)) (Resolution 300 300));
  missing = (Pick @((Resolution -4 -1)) (Resolution 300 300));
  keepHigher = (Pick @((Resolution 300 300)) (Resolution 600 600))
}
@{sharpest=$sharpest;unsharpened=$unsharpened;sharpenOutOfRange=$sharpenOutOfRange;sharpenText=$sharpenText;defaults=$defaults;neutral=$neutral;legacy=$legacy;previous=$previous;intermediate=$intermediate;selected=$selected;highest=$highest;belowRange=$belowRange;outOfRange=$outOfRange;partial=$partial;invalid=$invalid;pixels=$pixels;dpi=$dpi} | ConvertTo-Json -Depth 8 -Compress
`;

for (const [name, source] of scripts) test(`${name}: maximum supported DPI and stronger output darkening preserve white, black and neutral mode`, { skip }, async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "rx1-output-"));
  try {
    const harness = path.join(folder, "probe.ps1");
    await writeFile(harness, probeSource);
    const { stdout } = await promisify(execFile)("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", harness, "-Source", fileURLToPath(source), "-Work", folder,
    ], { windowsHide: true, timeout: 30000 });
    const r = JSON.parse(stdout);
    assert.equal(r.defaults.gamma, 1.50); assert.equal(r.defaults.maxResolution, true);
    // Độ nét: mặc định 2 (cả cấu hình cũ chưa có độ nét), 0–4 hợp lệ, ngoài khoảng / chữ → mặc định kèm cảnh báo.
    assert.equal(r.defaults.sharpen, 2); assert.equal(r.legacy.sharpen, 2);
    assert.equal(r.sharpest.sharpen, 4); assert.equal(r.sharpest.gamma, 1.3);
    assert.equal(r.unsharpened.sharpen, 0); assert.equal(r.unsharpened.warning, '');
    for (const bad of [r.sharpenOutOfRange, r.sharpenText]) {
      assert.equal(bad.sharpen, 2); assert.match(bad.warning, /sharpen must be a whole number from 0 to 4/);
    }
    assert.deepEqual(r.pixels.neutral, [[0,0,0,255],[128,128,128,255],[255,255,255,255],[200,150,100,255],[240,240,240,255]]);
    assert.equal(r.legacy.gamma, 1.18, 'existing local choices remain in effect');
    assert.equal(r.previous.gamma, 1.30);
    assert.equal(r.intermediate.gamma, 1.40); assert.equal(r.intermediate.warning, '');
    assert.equal(r.selected.gamma, 1.50); assert.equal(r.selected.warning, '', '1.50 is accepted as a local override');
    assert.deepEqual(r.pixels.selected, r.pixels.compensated);
    assert.equal(r.highest.gamma, 2.2); assert.equal(r.highest.warning, '', '2.20 is accepted');
    assert.equal(r.belowRange.gamma, 1.50); assert.match(r.belowRange.warning, /between 1\.00 and 2\.20/);
    assert.equal(r.outOfRange.gamma, 1.50); assert.match(r.outOfRange.warning, /between 1\.00 and 2\.20/);
    assert.deepEqual(r.pixels.highest[0], r.pixels.neutral[0]);
    assert.deepEqual(r.pixels.highest[2], r.pixels.neutral[2]);
    assert.ok(r.pixels.highest[1][0] >= 55 && r.pixels.highest[1][0] <= 57, '2.20 darkens midtones more strongly');
    assert.deepEqual(r.pixels.compensated[0], r.pixels.neutral[0]);
    assert.deepEqual(r.pixels.compensated[2], r.pixels.neutral[2]);
    assert.ok(r.pixels.compensated[1][0] >= 90 && r.pixels.compensated[1][0] <= 92, 'midtone reduction');
    assert.ok(r.pixels.intermediate[1][0] < r.pixels.previous[1][0], '1.40 is darker than the previous 1.30 setting');
    assert.ok(r.pixels.compensated[1][0] < r.pixels.intermediate[1][0], '1.50 is darker than 1.40');
    assert.equal(r.pixels.compensated[1][0], r.pixels.compensated[1][1]);
    assert.equal(r.pixels.compensated[1][1], r.pixels.compensated[1][2], 'neutral gray stays neutral');
    assert.ok(r.pixels.compensated[4][0] < 240 && r.pixels.compensated[4][0] > 230, 'highlights retain detail');
    assert.equal(r.neutral.maxResolution, false);
    assert.equal(r.partial.gamma, 1.50); assert.equal(r.partial.maxResolution, false);
    assert.equal(r.invalid.gamma, 1.50); assert.match(r.invalid.warning, /using gamma 1\.5/);
    assert.deepEqual(r.dpi.highest, { X:600, Y:600 });
    assert.deepEqual(r.dpi.supported, { X:300, Y:600 });
    assert.deepEqual(r.dpi.missing, { X:300, Y:300 });
    assert.deepEqual(r.dpi.keepHigher, { X:600, Y:600 });
  } finally {
    assert.equal(path.dirname(folder), os.tmpdir());
    await rm(folder, { recursive: true, force: true });
  }
});
