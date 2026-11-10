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
  if ($function.Name -in @('Get-Rx1OutputSettings','Set-Rx1MaximumResolution','New-Rx1ImageAttributes')) { Invoke-Expression $function.Extent.Text }
}
$profilePath = Join-Path $Work 'rx1-output.json'
$defaults = Get-Rx1OutputSettings $profilePath
'{"gamma":1.0,"maxResolution":false}' | Set-Content -LiteralPath $profilePath -Encoding UTF8
$neutral = Get-Rx1OutputSettings $profilePath
'{"gamma":1.07,"maxResolution":true}' | Set-Content -LiteralPath $profilePath -Encoding UTF8
$previous = Get-Rx1OutputSettings $profilePath
'{"gamma":1.20,"maxResolution":true}' | Set-Content -LiteralPath $profilePath -Encoding UTF8
$darker = Get-Rx1OutputSettings $profilePath
'{"maxResolution":false}' | Set-Content -LiteralPath $profilePath -Encoding UTF8
$partial = Get-Rx1OutputSettings $profilePath
'{"gamma":20,"maxResolution":"yes"}' | Set-Content -LiteralPath $profilePath -Encoding UTF8
$invalid = Get-Rx1OutputSettings $profilePath

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
$pixels = @{ neutral = (Render-Probe $neutral.gamma); previous = (Render-Probe $previous.gamma); compensated = (Render-Probe $defaults.gamma); darker = (Render-Probe $darker.gamma) }
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
@{defaults=$defaults;neutral=$neutral;previous=$previous;darker=$darker;partial=$partial;invalid=$invalid;pixels=$pixels;dpi=$dpi} | ConvertTo-Json -Depth 8 -Compress
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
    assert.equal(r.defaults.gamma, 1.15); assert.equal(r.defaults.maxResolution, true);
    assert.deepEqual(r.pixels.neutral, [[0,0,0,255],[128,128,128,255],[255,255,255,255],[200,150,100,255],[240,240,240,255]]);
    assert.equal(r.previous.gamma, 1.07, 'existing local choices remain in effect');
    assert.deepEqual(r.pixels.compensated[0], r.pixels.neutral[0]);
    assert.deepEqual(r.pixels.compensated[2], r.pixels.neutral[2]);
    assert.ok(r.pixels.compensated[1][0] >= 113 && r.pixels.compensated[1][0] <= 117, 'midtone reduction');
    assert.ok(r.pixels.compensated[1][0] < r.pixels.previous[1][0], 'darker than the previous 1.07 setting');
    assert.equal(r.pixels.compensated[1][0], r.pixels.compensated[1][1]);
    assert.equal(r.pixels.compensated[1][1], r.pixels.compensated[1][2], 'neutral gray stays neutral');
    assert.ok(r.pixels.darker[1][0] < r.pixels.compensated[1][0]);
    assert.ok(r.pixels.compensated[4][0] < 240 && r.pixels.compensated[4][0] > 230, 'highlights retain detail');
    assert.equal(r.neutral.maxResolution, false);
    assert.equal(r.partial.gamma, 1.15); assert.equal(r.partial.maxResolution, false);
    assert.equal(r.invalid.gamma, 1.15); assert.match(r.invalid.warning, /using gamma 1\.15/);
    assert.deepEqual(r.dpi.highest, { X:600, Y:600 });
    assert.deepEqual(r.dpi.supported, { X:300, Y:600 });
    assert.deepEqual(r.dpi.missing, { X:300, Y:300 });
    assert.deepEqual(r.dpi.keepHigher, { X:600, Y:600 });
  } finally {
    assert.equal(path.dirname(folder), os.tmpdir());
    await rm(folder, { recursive: true, force: true });
  }
});
