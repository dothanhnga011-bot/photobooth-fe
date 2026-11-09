import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";
import { printerColorInstaller } from "../src/admin/printer-installer.js";

const source = fileURLToPath(new URL("../src/admin/installers/configure-rx1-color.ps1", import.meta.url));
const skip = process.platform !== "win32" && "Windows PowerShell only";
const harness = `param([string]$Source, [string]$Work, [string]$Scenario)
. $Source
Add-Type -AssemblyName System.Printing, ReachFramework
$script:commits = 0
function Fixture-Ticket([string]$mode, [string]$cut, [int]$dpi) {
  New-ColorTicket @"
<psf:PrintTicket xmlns:psf="http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework" xmlns:k="http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords" xmlns:vendor="urn:dnp-fixture" version="1">
  <psf:Feature name="k:PageColorManagement"><psf:Option name="k:$mode"/></psf:Feature>
  <psf:Feature name="k:PageICMRenderingIntent"><psf:Option name="k:BusinessGraphics"/></psf:Feature>
  <psf:Feature name="k:PageOutputColor"><psf:Option name="k:Monochrome"/></psf:Feature>
  <psf:Feature name="k:PageResolution"><psf:Option name="vendor:DPI$dpi"/></psf:Feature>
  <psf:Feature name="k:PageMediaSize"><psf:Option name="vendor:PR4x6"/></psf:Feature>
  <psf:Feature name="vendor:Cut"><psf:Option name="vendor:$cut"/></psf:Feature>
  <psf:Feature name="vendor:Finish"><psf:Option name="vendor:Glossy"/></psf:Feature>
</psf:PrintTicket>
"@
}
function Fixture-Queue([string]$name, [string]$cut) {
  $q = [pscustomobject]@{ Name = $name; DefaultPrintTicket = (Fixture-Ticket 'None' $cut 300); UserPrintTicket = (Fixture-Ticket 'Driver' $cut 600); Reject = $false; ChangePaper = $false; FailCommit = $false; FailRefresh = $false }
  $q | Add-Member ScriptMethod MergeAndValidatePrintTicket {
    param($original, $delta)
    [xml]$xml = Read-ColorTicketXml $original
    [xml]$changes = Read-ColorTicketXml $delta
    $xml.DocumentElement.SetAttribute('xmlns:psk', 'http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords')
    foreach ($feature in $changes.DocumentElement.ChildNodes) {
      if ($feature.LocalName -ne 'Feature') { continue }
      $name = $feature.GetAttribute('name').Split(':')[-1]
      $old = @($xml.DocumentElement.ChildNodes | Where-Object { $_.LocalName -eq 'Feature' -and $_.GetAttribute('name').Split(':')[-1] -eq $name })[0]
      [void]$xml.DocumentElement.RemoveChild($old)
      [void]$xml.DocumentElement.AppendChild($xml.ImportNode($feature, $true))
    }
    $text = $xml.OuterXml
    if ($this.Reject) { $text = $text.Replace('psk:System', 'psk:Driver') }
    if ($this.ChangePaper) { $text = $text.Replace('vendor:PR4x6', 'vendor:PR6x8') }
    [pscustomobject]@{ ValidatedPrintTicket = (New-ColorTicket $text) }
  }
  $q | Add-Member ScriptMethod Commit {
    $script:commits++
    if ($this.FailCommit) { $this.FailCommit = $false; throw 'fixture commit failed' }
  }
  $q | Add-Member ScriptMethod Refresh {
    if ($this.FailRefresh) { $this.FailRefresh = $false; $this.DefaultPrintTicket = Fixture-Ticket 'None' 'Enable' 300 }
  }
  return $q
}
$queues = @((Fixture-Queue 'DS-RX1' 'Disable'), (Fixture-Queue 'DS-RX1 - cat doi 2x6' 'Enable'))
if ($Scenario -eq 'inherit') { $queues[1].UserPrintTicket = $null }
$before = @($queues | ForEach-Object { @{ default = (Read-ColorTicketXml $_.DefaultPrintTicket); user = (Read-ColorTicketXml $_.UserPrintTicket) } })
if ($Scenario -eq 'reject') { $queues[1].Reject = $true }
if ($Scenario -eq 'paper') { $queues[1].ChangePaper = $true }
if ($Scenario -eq 'commit') { $queues[1].FailCommit = $true }
if ($Scenario -eq 'refresh') { $queues[1].FailRefresh = $true }
$errorText = ''
try { Set-Rx1QueueColor $queues $Work } catch { $errorText = $_.Exception.Message }
$after = @($queues | ForEach-Object { @{ default = (Read-ColorTicketXml $_.DefaultPrintTicket); user = (Read-ColorTicketXml $_.UserPrintTicket); validDefault = (Test-ColorTicket $_.DefaultPrintTicket); validUser = (Test-ColorTicket $_.UserPrintTicket) } })
@{ error = $errorText; before = $before; after = $after; commits = $script:commits; backup = (Test-Path -LiteralPath (Join-Path $Work 'color-settings.json')) } | ConvertTo-Json -Depth 6 -Compress
`;

async function probe(scenario) {
  const folder = await mkdtemp(path.join(os.tmpdir(), "nxc-rx1-color-"));
  try {
    const fixture = path.join(folder, "probe.ps1"), backup = path.join(folder, "backup");
    await writeFile(fixture, harness);
    const { stdout } = await promisify(execFile)("powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture, "-Source", source, "-Work", backup, "-Scenario", scenario],
      { windowsHide: true, timeout: 30000 });
    return JSON.parse(stdout);
  } finally {
    assert.equal(path.dirname(folder), os.tmpdir());
    await rm(folder, { recursive: true, force: true });
  }
}

test("RX1 colour setup updates user and global ICM while preserving each queue's DPI, media, cutter and finish", { skip }, async () => {
  const r = await probe("success");
  assert.equal(r.error, ""); assert.equal(r.backup, true); assert.equal(r.commits, 2);
  for (const [i, q] of r.after.entries()) {
    assert.equal(q.validDefault, true); assert.equal(q.validUser, true);
    for (const scope of ["default", "user"]) {
      assert.match(q[scope], new RegExp(`DPI${scope === "default" ? 300 : 600}`));
      assert.match(q[scope], new RegExp(i ? 'vendor:Enable' : 'vendor:Disable'));
      assert.match(q[scope], /vendor:PR4x6/); assert.match(q[scope], /vendor:Glossy/);
    }
  }
});
test("an inherited user ticket stays inherited and a rejected driver causes no writes", { skip }, async () => {
  const inherited = await probe("inherit");
  assert.equal(inherited.error, ""); assert.equal(inherited.after[1].user, null);
  const rejected = await probe("reject");
  assert.match(rejected.error, /did not accept/); assert.equal(rejected.commits, 0); assert.equal(rejected.backup, false);
  assert.deepEqual(rejected.after.map(({ default: d, user }) => ({ default: d, user })), rejected.before);
});
test("driver validation cannot silently change paper size while configuring colour", { skip }, async () => {
  const r = await probe("paper");
  assert.match(r.error, /would change/); assert.equal(r.commits, 0); assert.equal(r.backup, false);
  assert.deepEqual(r.after.map(({ default: d, user }) => ({ default: d, user })), r.before);
});
for (const scenario of ["commit", "refresh"]) test(`RX1 colour setup restores both queues when ${scenario} fails`, { skip }, async () => {
  const r = await probe(scenario);
  assert.match(r.error, /Previous settings restored/); assert.equal(r.backup, true);
  assert.deepEqual(r.after.map(({ default: d, user }) => ({ default: d, user })), r.before);
});
test("the colour installer contains only the standalone tool and preserves its exact payload", async () => {
  const script = await readFile(source, "utf8"), bat = printerColorInstaller(script);
  const payload = Buffer.from(/^rem NXC_COLOR_BASE64:([A-Za-z0-9+/=]+)\r$/m.exec(bat)[1], "base64");
  assert.equal(payload.subarray(3).toString("utf8"), script.replace(/^\uFEFF/, ""));
  assert.match(bat, /configure-rx1-color\.ps1/);
  assert.match(bat, /-Verb RunAs/);
  assert.doesNotMatch(bat, /NXC_PRINT_CONFIG_BASE64|Start-Agent|-Install/);
});

test("the Windows colour installer actually unpacks and runs its tool in a path with spaces", { skip }, async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "nxc colour installer "));
  try {
    // Only a harmless payload is run; real printer settings are not touched.
    const harmless = "Write-Output 'RX1-COLOUR-FIXTURE-EXECUTED'\n";
    const bat = printerColorInstaller(harmless).split("\r\n");
    const from = bat.findIndex((line) => line.startsWith('powershell -NoProfile -Command "$p ='));
    const to = bat.indexOf(")", from);
    assert.ok(from > 0 && to > from);
    const runnable = [...bat.slice(0, from), ...bat.slice(to + 1)].map((line) => line === "pause" ? "rem" : line).join("\r\n");
    const installer = path.join(folder, "cai-mau-RX1.bat");
    await writeFile(installer, runnable);
    const local = path.join(folder, "Local App Data");
    const { stdout } = await promisify(execFile)("cmd.exe", ["/d", "/c", installer], {
      windowsHide: true, timeout: 30000, env: { ...process.env, LOCALAPPDATA: local },
    });
    assert.match(stdout, /RX1-COLOUR-FIXTURE-EXECUTED/);
    const extracted = await readFile(path.join(local, "NXC-Printer", "configure-rx1-color.ps1"), "utf8");
    assert.equal(extracted.replace(/^\uFEFF/, ""), harmless);
  } finally {
    assert.equal(path.dirname(folder), os.tmpdir());
    await rm(folder, { recursive: true, force: true });
  }
});
