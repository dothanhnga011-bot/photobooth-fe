import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

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
 if($f.Name -in @('Start-LocalPrinter','Receive-LocalPrint','Write-LocalResponse')) {Invoke-Expression ($f.Extent.Text.Replace('8789',[string]$Port))}
}
$script:Config=@{api='https://mellowptb.com';room='Test room';token='test-only'}
$script:Posts=0
function Write-Log($text){Write-Host $text}
function Get-OfflineQueue {return $null}
function Invoke-Api {return @{ok=$true}}
function Invoke-RestMethod {
 param($Method,$Uri,$Headers,$ContentType,$Body,$TimeoutSec)
 if(($Body -join ',') -ne '1,2,3'){throw 'Wrong transferred bytes'}
 $script:Posts++
 if($script:Posts -gt 1){return @{direct=@{fresh=$false};spoolStatus='sent'}}
 return @{direct=@{fresh=$true;job=@{id='test-job';leaseId='test-lease';code='123456';printSize='full';copies=1;sheets=@(@{index=0;extension='png'})}}}
}
function Invoke-Job($job,$files) {
 if(([IO.File]::ReadAllBytes($files[0]) -join ',') -ne '1,2,3'){throw 'Wrong local file bytes'}
 [IO.File]::AppendAllText($Output,'printed-once')
 return 'Mock spool accepted'
}
Start-LocalPrinter
if(-not $script:LocalListener){throw 'Cannot start test listener'}
Write-Host 'READY'
try {while($true){Receive-LocalPrint;Start-Sleep -Milliseconds 20}} finally {$script:LocalListener.Close()}
`);
  const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Agent', agent, '-Port', String(port), '-Output', output], { windowsHide: true });
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
    const headers = { Origin: 'https://mellowptb.com', 'Content-Type': 'application/octet-stream', 'X-Album-Token': 'album-token', 'X-Print-Key': 'same-request', 'X-Print-Sheets': '3' };
    const wrong = await fetch(`${base}/print`, { method: 'POST', headers: { ...headers, Origin: 'https://untrusted.example' }, body: Buffer.from([1,2,3]) });
    assert.equal(wrong.status, 403);
    const preflight = await fetch(`${base}/print`, { method: 'OPTIONS', headers: { Origin: headers.Origin } });
    assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
    const health = await fetch(`${base}/health`, { headers: { Origin: headers.Origin } });
    assert.equal((await health.json()).directPrint, 1);
    const send = () => fetch(`${base}/print`, { method: 'POST', headers, body: Buffer.from([1,2,3]) });
    const first = await send();
    const result = await first.json();
    assert.equal(first.status, 200, JSON.stringify(result));
    assert.equal(result.sent, true);
    assert.equal((await (await send()).json()).duplicate, true);
    assert.equal(await readFile(output, 'utf8'), 'printed-once');
  } finally {
    const exited = new Promise(resolve => child.once('exit', resolve));
    if (child.exitCode === null) { child.kill(); await exited; }
    await rm(folder, { recursive: true, force: true });
  }
});
