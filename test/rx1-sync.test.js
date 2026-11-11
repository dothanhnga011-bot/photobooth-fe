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
  if ($f.Name -in @('ConvertTo-Rx1Sharpen','Get-Rx1OutputSettings','Set-Rx1RemoteOutput','Receive-Rx1OutputSettings','Get-Rx1TestRecordPath','Request-Rx1SharpnessTest')) { Invoke-Expression $f.Extent.Text }
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
      assert.deepEqual(result[key], { gamma: 2.2, maxResolution: false, sharpen: 2, warning: "" }, `${key}: ${JSON.stringify(result.messages)}`);
    assert.equal(result.credentialsUnchanged, true);
    assert.equal(result.noRewrite, true); assert.equal(result.temporaryFiles, 0);
    assert.equal(requests.length, 4);
    assert.ok(requests.every((req) => req.path === "/api/print-agent/output-settings/sync" && req.auth === "Bearer test-room-token"));
    // Máy chủ cũ không gửi độ nét: bộ in giữ độ nét đang dùng (mặc định 2) và báo lại.
    assert.deepEqual(requests[0].body.applied, { gamma: 1.3, maxResolution: true, sharpen: 2 });
    assert.deepEqual(requests[1].body.applied, { gamma: 2.2, maxResolution: false, sharpen: 2 });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    assert.equal(path.resolve(path.dirname(folder)), path.resolve(os.tmpdir()));
    await rm(folder, { recursive: true, force: true });
  }
});

test("a sharpness test print from the web prints once from the latest sheet (or the sample) and reports back", {
  skip: process.platform !== "win32" && "Windows PowerShell only", timeout: 60000,
}, async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "rx1-sharpness-"));
  const first = "11111111-1111-4111-8111-111111111111", second = "22222222-2222-4222-8222-222222222222";
  const syncs = [], downloads = [];
  // Lần đồng bộ: 1 → yêu cầu in thử A; 2 → máy chủ vẫn trả A (đã in rồi: không in lại); 3 → yêu cầu B.
  const replies = [first, first, second, null];
  const server = createServer(async (req, res) => {
    if (req.method === "GET") {
      downloads.push(req.url);
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    syncs.push(JSON.parse(Buffer.concat(chunks)));
    const id = replies[Math.min(syncs.length, replies.length) - 1];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ rx1Output: { gamma: 1.5, maxResolution: true, sharpen: 3 }, sharpnessTest: id ? { id } : null }));
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const harness = path.join(folder, "sharpness.ps1");
    await writeFile(harness, `\ufeffparam([string]$Source,[string]$Origin)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http, System.Drawing
$ast = [Management.Automation.Language.Parser]::ParseFile($Source, [ref]$null, [ref]$null)
foreach ($f in $ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
  if ($f.Name -in @('ConvertTo-Rx1Sharpen','Get-Rx1OutputSettings','Set-Rx1RemoteOutput','Receive-Rx1OutputSettings',
    'Get-Rx1TestRecordPath','Request-Rx1SharpnessTest','Save-Rx1LastSheet','Invoke-Rx1SharpnessTest')) { Invoke-Expression $f.Extent.Text }
}
$DryRunDir = ''
$script:Messages = @(); $script:Sends = @()
function Write-Log([string]$message) { $script:Messages += $message }
function Get-OfflineQueue { return $null }
function Set-PrinterCutter([string]$cut) { return $false }
# Máy in giả: ghi lại lệnh in thử (file còn tồn tại lúc in không).
function Send-Sheets([string]$printerName, [string[]]$files, [string]$docName, [string]$cut = '', [int]$test = -1) {
  $script:Sends += @{ printer = $printerName; file = [IO.Path]::GetFileName($files[0]); existed = (Test-Path -LiteralPath $files[0]); doc = $docName; cut = $cut; test = $test }
  return 'PC 4x6 413x615, 1239x1845 điểm, độ nét 0–4'
}
$script:Config = @{ api = $Origin; token = 'test-room-token'; printer = 'DNP TEST' }
function Sync-Once {
  $script:OutputSync.next = [datetime]::MinValue
  Receive-Rx1OutputSettings
  $until = (Get-Date).AddSeconds(5)
  while ($script:OutputSync.task -and (Get-Date) -lt $until) { Receive-Rx1OutputSettings; Start-Sleep -Milliseconds 10 }
}
Receive-Rx1OutputSettings
$until = (Get-Date).AddSeconds(5)
while ($script:OutputSync.task -and (Get-Date) -lt $until) { Receive-Rx1OutputSettings; Start-Sleep -Milliseconds 10 }
$pendingAfterFirst = $script:Rx1TestPending
# Tờ in khách gần nhất (máy in vừa in một tờ).
$sheet = Join-Path $env:TEMP 'guest-sheet.png'
$bitmap = New-Object Drawing.Bitmap 12, 18; $bitmap.Save($sheet); $bitmap.Dispose()
Save-Rx1LastSheet $sheet
Invoke-Rx1SharpnessTest
Sync-Once
Invoke-Rx1SharpnessTest
# Không còn tờ in gần nhất: tờ thử dùng ảnh mẫu tải từ web.
Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'NXC-Printer') -Filter 'last-sheet.*' | Remove-Item -Force
Sync-Once
Invoke-Rx1SharpnessTest
Sync-Once
$script:OutputSync.client.Dispose()
$samples = @(Get-ChildItem -LiteralPath $env:TEMP -Filter 'nxc-rx1-sample-*' -ErrorAction SilentlyContinue).Count
@{ pendingAfterFirst = $pendingAfterFirst; sends = $script:Sends; settings = (Get-Rx1OutputSettings); leftoverSamples = $samples
  record = ((Get-Content -LiteralPath (Get-Rx1TestRecordPath)) -join ','); messages = $script:Messages } | ConvertTo-Json -Depth 4 -Compress
`);
    const { stdout } = await promisify(execFile)("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", harness,
      "-Source", fileURLToPath(new URL("../src/admin/installers/print-agent-dnp.ps1", import.meta.url)),
      "-Origin", `http://127.0.0.1:${server.address().port}`], {
      windowsHide: true, timeout: 40000, env: { ...process.env, LOCALAPPDATA: folder, TEMP: folder, TMP: folder },
    });
    const result = JSON.parse(stdout);
    assert.equal(result.pendingAfterFirst, first);
    assert.equal(result.settings.sharpen, 3, "the web sharpness is applied");
    // Đúng 2 tờ thử: A từ tờ in gần nhất, B từ ảnh mẫu; A không in lại khi máy chủ còn trả A.
    assert.deepEqual(result.sends, [
      { printer: "DNP TEST", file: "last-sheet.png", existed: true, doc: "NXC-thu-do-net", cut: "off", test: 3 },
      { printer: "DNP TEST", file: result.sends[1]?.file, existed: true, doc: "NXC-thu-do-net", cut: "off", test: 3 },
    ], JSON.stringify(result.messages));
    assert.match(result.sends[1].file, /^nxc-rx1-sample-/);
    assert.equal(result.leftoverSamples, 0, "the downloaded sample is removed after printing");
    assert.deepEqual(downloads, ["/downloads/rx1-sharpness-sample.jpg"]);
    assert.equal(result.record, `${first},${second}`);
    // Kết quả báo về máy chủ ở lần đồng bộ ngay sau khi in.
    assert.equal(syncs[0].sharpnessTest, undefined);
    assert.equal(syncs[1].sharpnessTest.id, first); assert.equal(syncs[1].sharpnessTest.sent, true);
    assert.match(syncs[1].sharpnessTest.message, /Đã in tờ thử độ nét từ tờ in gần nhất/);
    assert.equal(syncs.at(-1).sharpnessTest.id, second);
    assert.match(syncs.at(-1).sharpnessTest.message, /từ ảnh mẫu/);
    assert.deepEqual(syncs[0].applied, { gamma: 1.5, maxResolution: true, sharpen: 2 });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(folder, { recursive: true, force: true });
  }
});
