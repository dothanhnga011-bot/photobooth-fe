import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { printerDriverLauncher } from "../src/admin/printer-installer.js";

const source = fileURLToPath(new URL("../src/admin/installers/open-rx1-driver.ps1", import.meta.url));
const skip = process.platform !== "win32" && "Windows PowerShell only";
const run = promisify(execFile);
const harness = `param([string]$Source, [string]$Scenario, [string]$UiMode)
. $Source
$script:opened = @()
function Get-Printer {
  if ($Scenario -eq 'missing') { return @() }
  $name = if ($Scenario -eq 'name') { 'RX1" /k' } else { 'DS-RX1 - cat doi & 2x6' }
  @([pscustomobject]@{ Name = 'DS-RX1'; DriverName = 'DNP DS-RX1' },
    [pscustomobject]@{ Name = $name; DriverName = 'DNP DS-RX1' },
    [pscustomobject]@{ Name = 'Office printer'; DriverName = 'Microsoft PDF' })
}
function Get-PrintJob {
  param([string]$PrinterName, [string]$ErrorAction)
  if ($Scenario -eq 'jobs-error') { throw 'Spooler unavailable' }
  if ($Scenario -eq 'pending' -and $PrinterName -ne 'DS-RX1') { [pscustomobject]@{ ID = 1 } }
}
function Start-Process {
  param($FilePath, $ArgumentList, $WindowStyle, [switch]$Wait, [switch]$PassThru)
  $script:opened += @{ file = $FilePath; arguments = $ArgumentList; style = $WindowStyle; wait = [bool]$Wait }
  [pscustomobject]@{ ExitCode = $(if ($Scenario -eq 'open-error') { 1 } else { 0 }) }
}
$failure = ''
try { Open-Rx1DriverSettings -Mode $UiMode 6>$null } catch { $failure = $_.Exception.Message }
@{ failure = $failure; opened = @($script:opened) } | ConvertTo-Json -Depth 4 -Compress
`;

async function temporary(callback) {
  const folder = await mkdtemp(join(tmpdir(), "nxc rx1 driver "));
  try { return await callback(folder); }
  finally {
    assert.equal(dirname(folder), tmpdir());
    await rm(folder, { recursive: true, force: true });
  }
}

async function probe(scenario, mode = "preferences") {
  return temporary(async (folder) => {
    const fixture = join(folder, "probe.ps1");
    await writeFile(fixture, `\uFEFF${harness}`);
    const { stdout } = await run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture,
      "-Source", source, "-Scenario", scenario, "-UiMode", mode], { windowsHide: true, timeout: 15000 });
    return JSON.parse(stdout);
  });
}

test("driver downloads embed the exact tool and only accept fixed UI actions", async () => {
  const script = await readFile(source, "utf8");
  for (const mode of ["preferences", "properties"]) {
    const bat = printerDriverLauncher(script, mode);
    const payload = /^rem NXC_RX1_DRIVER_BASE64:([A-Za-z0-9+/=]+)\r$/m.exec(bat)[1];
    assert.equal(Buffer.from(payload, "base64").toString("utf8"), script);
    assert.doesNotMatch(bat, /RunAs|NXC_PRINT_CONFIG_BASE64|-Install|config\.json/);
  }
  assert.throws(() => printerDriverLauncher(script, "preferences; exit"), /không hợp lệ/);
});

for (const [mode, option] of [["preferences", "/e"], ["properties", "/p"]]) {
  test(`${mode} opens both RX1 queues under the current account, with quoted names`, { skip }, async () => {
    const result = await probe("success", mode);
    assert.equal(result.failure, "");
    assert.equal(result.opened.length, 2);
    assert.deepEqual(result.opened.map((call) => call.arguments), [
      `printui.dll,PrintUIEntry ${option} /n "DS-RX1"`,
      `printui.dll,PrintUIEntry ${option} /n "DS-RX1 - cat doi & 2x6"`,
    ]);
    for (const call of result.opened) {
      assert.match(call.file, /System32\\rundll32\.exe$/i);
      assert.equal(call.style, "Normal");
      assert.equal(call.wait, true);
    }
  });
}

test("missing drivers, pending jobs and unreadable queues open no dialogs", { skip }, async () => {
  for (const scenario of ["missing", "pending", "jobs-error", "name"]) {
    const result = await probe(scenario);
    assert.ok(result.failure, scenario);
    assert.equal(result.opened.length, 0, scenario);
  }
  const failedOpen = await probe("open-error");
  assert.match(failedOpen.failure, /Windows could not open/);
  assert.equal(failedOpen.opened.length, 1);
});

test("downloaded BAT runs its embedded tool with the selected mode in a path with spaces", { skip }, async () => {
  // Execute only this harmless fixture, never the real Windows printer dialogs.
  const payload = "param([string]$Mode)\n@{ mode = $Mode; sample = 'Tiếng Việt' } | ConvertTo-Json -Compress\n";
  await temporary(async (folder) => {
    for (const mode of ["preferences", "properties"]) {
      const launcher = join(folder, `open-${mode}.bat`);
      await writeFile(launcher, printerDriverLauncher(payload, mode));
      const { stdout } = await run("cmd.exe", ["/d", "/c", launcher], { windowsHide: true, timeout: 15000 });
      const result = JSON.parse(stdout.split(/\r?\n/).find((line) => line.startsWith("{")));
      assert.equal(result.mode, mode);
      // Windows console encodings vary, so verify the exact Unicode bytes in the payload above.
      assert.ok(result.sample);
    }
  });
});
