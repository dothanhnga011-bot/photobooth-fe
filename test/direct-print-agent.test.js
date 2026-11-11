import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

test('local PowerShell bridge enforces origin and forwards the exact bytes only once', { skip: process.platform !== 'win32', timeout: 45000 }, async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'nxc-local-test-'));
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const agent = fileURLToPath(new URL('../src/admin/installers/print-agent-dnp.ps1', import.meta.url));
  const script = path.join(folder, 'test.ps1');
  const output = path.join(folder, 'printed.txt');
  await writeFile(script, `param($Agent, $Port, $Output)
$ErrorActionPreference='Stop'
$errors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseFile($Agent,[ref]$null,[ref]$errors)
if($errors){throw ($errors | Out-String)}
foreach($f in $ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst]},$true)) {
 if($f.Name -in @('Start-LocalPrinter','Receive-LocalPrint','Write-LocalResponse','ConvertTo-Rx1Sharpen','Get-Rx1OutputSettings','ConvertFrom-Rx1PhotoRegions')) {Invoke-Expression ($f.Extent.Text.Replace('8789',[string]$Port))}
}
$script:Config=@{api='https://mellowptb.com';room='Test room';token='test-only'}
$ConfigPath=Join-Path (Split-Path -Parent $Output) 'config.json'
Add-Type -AssemblyName System.Drawing
$bitmap=New-Object Drawing.Bitmap(1200,1800)
try {$bitmap.Save(($Output+'.png'),[Drawing.Imaging.ImageFormat]::Png)} finally {$bitmap.Dispose()}
function Write-Log($text){Write-Host $text}
function Get-OfflineQueue {return $null}
function Invoke-Api {throw 'Network access during local printing is forbidden in this test'}
function Invoke-RestMethod {throw 'Network access during local printing is forbidden in this test'}
function Invoke-Job($job,$files) {
 if([Convert]::ToBase64String([IO.File]::ReadAllBytes($files[0])) -ne [Convert]::ToBase64String([IO.File]::ReadAllBytes($Output+'.png'))){throw 'Wrong local file bytes'}
 [IO.File]::AppendAllText($Output,'printed-once')
 [IO.File]::WriteAllText($Output+'.photos', (@($job.photos | ForEach-Object { $_.ToString('R',[Globalization.CultureInfo]::InvariantCulture) }) -join ','))
 return 'Mock spool accepted'
}
Start-LocalPrinter
if(-not $script:LocalListener){throw 'Cannot start test listener'}
Write-Host 'READY'
try {while($true){Receive-LocalPrint;Start-Sleep -Milliseconds 20}} finally {$script:LocalListener.Close()}
`);
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Agent', agent, '-Port', String(port), '-Output', output], { windowsHide: true, env: { ...process.env, LOCALAPPDATA: folder } });
  let diagnostic = '';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No bridge ready: ${diagnostic}`)), 15000);
      child.stdout.on('data', data => { diagnostic += data; if (diagnostic.includes('READY')) { clearTimeout(timer); resolve(); } });
      child.stderr.on('data', data => { diagnostic += data; });
      child.once('error', reject);
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Bridge exited ${code}: ${diagnostic}`)); });
    });
    const base = `http://127.0.0.1:${port}`;
    const bytes = await readFile(output + '.png');
    // X-Print-Photos: hai ô ảnh của khung (tỉ lệ 0–1 của tờ) để bộ in chỉ làm nét đủ phần ảnh.
    const headers = { Origin: 'https://mellowptb.com', 'Content-Type': 'application/octet-stream', 'X-Album-Token': 'album-token', 'X-Print-Key': randomUUID(), 'X-Print-Sheets': String(bytes.length), 'X-Print-Size': 'full', 'X-Print-Photos': '0.05,0.05,0.9,0.42;0.05,0.53,0.9,0.42' };
    const wrong = await fetch(`${base}/print`, { method: 'POST', headers: { ...headers, Origin: 'https://untrusted.example' }, body: bytes });
    assert.equal(wrong.status, 403);
    const preflight = await fetch(`${base}/print`, { method: 'OPTIONS', headers: { Origin: headers.Origin } });
    assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
    assert.match(preflight.headers.get('access-control-allow-headers'), /X-Print-Photos/);
    const health = await fetch(`${base}/health`, { headers: { Origin: headers.Origin } });
    const printer = await health.json();
    assert.equal(printer.directPrint, 2);
    assert.equal(printer.photoRegions, true, 'the kiosk may send photo regions to this agent');
    assert.equal(printer.outputSettingsVersion, 1);
    assert.deepEqual(printer.output, { gamma: 1.5, maxResolution: true, sharpen: 2 });
    const send = () => fetch(`${base}/print`, { method: 'POST', headers, body: bytes });
    const first = await send();
    const result = await first.json();
    assert.equal(first.status, 200, JSON.stringify(result));
    assert.equal(result.sent, true);
    assert.equal((await (await send()).json()).duplicate, true);
    assert.equal(await readFile(output + '.photos', 'utf8'), '0.05,0.05,0.9,0.42,0.05,0.53,0.9,0.42');
    for (const photos of ['0.05,0.05,0.9', '0.5,0,0.6,1', '-1,0,1,1', '0,0,0,1'])
      assert.equal((await fetch(`${base}/print`, { method: 'POST', headers: { ...headers, 'X-Print-Key': randomUUID(), 'X-Print-Photos': photos }, body: bytes })).status,
        503, `invalid photo regions are rejected without printing: ${photos}`);
    const journal = path.join(folder, 'direct-print-records', headers['X-Print-Key'] + '.json');
    const record = JSON.parse((await readFile(journal, 'utf8')).replace(/^\uFEFF/, ''));
    await writeFile(journal, JSON.stringify({ ...record, state: 'sending' }));
    const uncertain = await send();
    assert.equal(uncertain.status, 503, 'a durable uncertain record cannot print again');
    const invalid = await fetch(`${base}/print`, { method: 'POST', headers: { ...headers, 'X-Print-Key': randomUUID(), 'X-Print-Sheets': '3' }, body: bytes });
    assert.equal(invalid.status, 503, 'invalid sheet sizes are rejected without printing');
    assert.equal(await readFile(output, 'utf8'), 'printed-once');
  } finally {
    const exited = new Promise(resolve => child.once('exit', resolve));
    if (child.exitCode === null) { child.kill(); await exited; }
    assert.equal(path.resolve(path.dirname(folder)), path.resolve(os.tmpdir()));
    await rm(folder, { recursive: true, force: true });
  }
});
