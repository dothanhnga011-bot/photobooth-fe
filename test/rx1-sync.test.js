import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

test("RX1 cloud sync is nonblocking, atomic, survives server errors and never alters printer credentials", {
  skip: process.platform !== "win32" && "Windows PowerShell only", timeout: 30000,
}, async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "rx1-sync-"));
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks)) });
    const number = requests.length;
    if (number === 1) await new Promise((resolve) => setTimeout(resolve, 1000));
    res.writeHead(number === 3 ? 503 : 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ rx1Output: number === 1 ? { gamma: 2.2, maxResolution: false }
      : number === 2 ? { gamma: 9, maxResolution: true } : null }));
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const harness = path.join(folder, "sync.ps1");
    await writeFile(harness, `param([string]$Source,[string]$Origin)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
$ast = [Management.Automation.Language.Parser]::ParseFile($Source, [ref]$null, [ref]$null)
foreach ($f in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
  if ($f.Name -in @('Get-Rx1OutputSettings','Set-Rx1RemoteOutput','Receive-Rx1OutputSettings')) { Invoke-Expression $f.Extent.Text }
}
function Write-Log([string]$message) { $script:Messages += $message }
$script:Messages = @()
$script:Config = @{ api = $Origin; token = 'test-room-token' }
$directory = Join-Path $env:LOCALAPPDATA 'NXC-Printer'
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$profile = Join-Path $directory 'rx1-output.json'
$credentialPath = Join-Path $directory 'config.json'
'{"gamma":1.30,"maxResolution":true}' | Set-Content -LiteralPath $profile -Encoding UTF8
'{"token":"unchanged-test-credential"}' | Set-Content -LiteralPath $credentialPath -Encoding UTF8
$before = [IO.File]::ReadAllText($credentialPath)
$timer = [Diagnostics.Stopwatch]::StartNew()
Receive-Rx1OutputSettings
$timer.Stop()
$firstCallMs = $timer.ElapsedMilliseconds
function Finish-Sync {
  $until = (Get-Date).AddSeconds(5)
  while ($script:OutputSync.task -and (Get-Date) -lt $until) { Receive-Rx1OutputSettings; Start-Sleep -Milliseconds 10 }
  if ($script:OutputSync.task) { throw 'Sync did not settle' }
}
Finish-Sync
$received = Get-Rx1OutputSettings
$noRewrite = -not (Set-Rx1RemoteOutput ([pscustomobject]@{gamma=2.2;maxResolution=$false}))
$script:OutputSync.next = [datetime]::MinValue
Receive-Rx1OutputSettings; Finish-Sync
$afterInvalid = Get-Rx1OutputSettings
$script:OutputSync.next = [datetime]::MinValue
Receive-Rx1OutputSettings; Finish-Sync
$afterOffline = Get-Rx1OutputSettings
$script:OutputSync.next = [datetime]::MinValue
Receive-Rx1OutputSettings; Finish-Sync
$afterNull = Get-Rx1OutputSettings
$script:OutputSync.client.Dispose()
@{firstCallMs=$firstCallMs;received=$received;afterInvalid=$afterInvalid;afterOffline=$afterOffline;afterNull=$afterNull;
  noRewrite=$noRewrite;credentialsUnchanged=($before -eq [IO.File]::ReadAllText($credentialPath));
  messages=$script:Messages;temporaryFiles=@(Get-ChildItem -LiteralPath $directory | Where-Object { $_.Name.StartsWith('rx1-output.json.') }).Count} | ConvertTo-Json -Depth 4 -Compress
`);
    const { stdout } = await promisify(execFile)("powershell.exe", ["-NoProfile", "-File", harness,
      "-Source", fileURLToPath(new URL("../src/admin/installers/print-agent-dnp.ps1", import.meta.url)),
      "-Origin", `http://127.0.0.1:${server.address().port}`], {
      windowsHide: true, timeout: 20000, env: { ...process.env, LOCALAPPDATA: folder },
    });
    const result = JSON.parse(stdout);
    assert.ok(result.firstCallMs < 800, "a one-second cloud response does not block the local print loop");
    for (const key of ["received", "afterInvalid", "afterOffline", "afterNull"])
      assert.deepEqual(result[key], { gamma: 2.2, maxResolution: false, warning: "" }, `${key}: ${JSON.stringify(result.messages)}`);
    assert.equal(result.credentialsUnchanged, true);
    assert.equal(result.noRewrite, true); assert.equal(result.temporaryFiles, 0);
    assert.equal(requests.length, 4);
    assert.ok(requests.every((req) => req.path === "/api/print-agent/output-settings/sync" && req.auth === "Bearer test-room-token"));
    assert.deepEqual(requests[0].body.applied, { gamma: 1.3, maxResolution: true });
    assert.deepEqual(requests[1].body.applied, { gamma: 2.2, maxResolution: false });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    assert.equal(path.resolve(path.dirname(folder)), path.resolve(os.tmpdir()));
    await rm(folder, { recursive: true, force: true });
  }
});
