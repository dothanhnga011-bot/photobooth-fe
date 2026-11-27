// The DNP print agent (src/admin/installers/print-agent-dnp.ps1) finds the driver's "2inch cut" option
// in a queue's PrintCapabilities and builds the PrintTicket that turns it on (small sheets) or off (big
// sheets). Driver shapes: a "2inch cut" feature with Enable / Disable, or a "Cut" feature whose options
// are "Standard" / "2inch cut". Runs the script's own functions in Windows PowerShell; Windows only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const script = fileURLToPath(new URL("../src/admin/installers/print-agent-dnp.ps1", import.meta.url));
const skip = process.platform !== "win32" && "Windows PowerShell only";

const psf = "http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework";
const capabilities = (feature) => `<?xml version="1.0" encoding="UTF-8"?>
<psf:PrintCapabilities xmlns:psf="${psf}" xmlns:psk="http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords"
  xmlns:ns0000="http://schemas.dnp.example/ns0000" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema" version="1">
  <psf:Feature name="psk:PageMediaSize">
    <psf:Option name="psk:NorthAmerica4x6"><psf:Property name="psk:DisplayName"><psf:Value xsi:type="xsd:string">PR (4x6)</psf:Value></psf:Property></psf:Option>
  </psf:Feature>
  ${feature}
</psf:PrintCapabilities>`;
const label = (text) => `<psf:Property name="psk:DisplayName"><psf:Value xsi:type="xsd:string">${text}</psf:Value></psf:Property>`;

async function probe(xml) {
  const folder = await mkdtemp(path.join(os.tmpdir(), "nxc-cut-"));
  try {
    const caps = path.join(folder, "caps.xml"), harness = path.join(folder, "harness.ps1");
    await writeFile(caps, xml);
    await writeFile(harness, `param([string]$Agent, [string]$Caps)
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Agent, [ref]$null, [ref]$null)
$PsfNs = '${psf}'
foreach ($f in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
  if ($f.Name -in @('Get-Label', 'Find-CutOptionIn', 'New-CutTicketXml')) { Invoke-Expression $f.Extent.Text }
}
Add-Type -AssemblyName System.Printing, ReachFramework
$doc = New-Object System.Xml.XmlDocument
$doc.Load($Caps)
$result = @{}
foreach ($enable in @($true, $false)) {
  $found = Find-CutOptionIn $doc $enable
  if (-not $found) { $result["$enable"] = $null; continue }
  $xml = New-CutTicketXml $found
  # Windows phải đọc được PrintTicket này (đúng lược đồ Print Schema).
  [void](New-Object System.Printing.PrintTicket(New-Object System.IO.MemoryStream(, [Text.Encoding]::UTF8.GetBytes($xml))))
  $result["$enable"] = @{ label = $found.label; ticket = $xml }
}
$result | ConvertTo-Json -Depth 4 -Compress
`);
    const { stdout } = await promisify(execFile)("powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", harness, "-Agent", script, "-Caps", caps],
      { timeout: 60000, windowsHide: true });
    return JSON.parse(stdout);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

test("a '2inch cut' feature with Enable / Disable: small sheets enable it, big sheets disable it", { skip, timeout: 70000 }, async () => {
  const result = await probe(capabilities(`<psf:Feature name="ns0000:TwoInchCut">${label("2inch cut")}
    <psf:Option name="ns0000:Disable">${label("Disable")}</psf:Option>
    <psf:Option name="ns0000:Enable">${label("Enable")}</psf:Option></psf:Feature>`));
  assert.equal(result.True.label, "ns0000:TwoInchCut 2inch cut = ns0000:Enable Enable");
  assert.equal(result.False.label, "ns0000:TwoInchCut 2inch cut = ns0000:Disable Disable");
  assert.match(result.True.ticket, /xmlns:f="http:\/\/schemas\.dnp\.example\/ns0000"/);
  assert.match(result.True.ticket, /<psf:Feature name="f:TwoInchCut"><psf:Option name="o:Enable"\/><\/psf:Feature>/);
});

test("a 'Cut' feature whose options are Standard / 2inch cut is recognised too; other drivers have none", { skip, timeout: 70000 }, async () => {
  const result = await probe(capabilities(`<psf:Feature name="ns0000:CutMode">${label("Cut")}
    <psf:Option name="ns0000:Standard">${label("Standard")}</psf:Option>
    <psf:Option name="ns0000:Cut2inch">${label("2inch Cut")}</psf:Option></psf:Feature>`));
  assert.match(result.True.ticket, /name="o:Cut2inch"/);
  assert.match(result.False.ticket, /name="o:Standard"/);
  const none = await probe(capabilities(""));
  assert.deepEqual([none.True, none.False], [null, null]);
});

test("the room's installer carries the agent and its settings, and its own command unpacks the agent intact", { timeout: 70000 }, async () => {
  const { printerInstaller, printerInstallerName } = await import("../src/admin/printer-installer.js");
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(script, "utf8");
  const bat = printerInstaller({ script: source, api: "https://photobooth.example.dev", token: "header.payload.sig", room: "Phòng 1" });
  assert.equal(printerInstallerName("Phòng Đỏ 1"), "cai-may-in-phong-do-1.bat");
  assert.ok(bat.includes("\r\n") && !/[^\r]\n/.test(bat), "Windows line endings throughout");
  assert.match(bat, /Start-Process -FilePath \$env:NXC_SELF -Verb RunAs/, "asks for admin rights to add the cut queue");
  assert.match(bat, /\r\nexit \/b\r\nrem NXC_PRINT_AGENT_BASE64:/, "nothing after exit /b is ever executed");
  const field = (name) => Buffer.from(new RegExp(`^rem ${name}:([A-Za-z0-9+/=]+)\r$`, "m").exec(bat)[1], "base64");
  assert.deepEqual(JSON.parse(field("NXC_PRINT_CONFIG_BASE64").toString("utf8")),
    { api: "https://photobooth.example.dev", token: "header.payload.sig", room: "Phòng 1" });
  const agent = field("NXC_PRINT_AGENT_BASE64");
  assert.deepEqual([...agent.subarray(0, 3)], [0xef, 0xbb, 0xbf], "one BOM so PowerShell 5.1 reads Vietnamese text");
  assert.equal(agent.subarray(3).toString("utf8"), source.replace(/^\uFEFF/, ""));
  assert.throws(() => printerInstaller({ script: source, api: "https://x.dev/\" & calc", token: "t", room: "r" }));
  if (process.platform !== "win32") return;
  // Chạy chính file cài bằng cmd như khi nhân viên bấm đúp file, chỉ bỏ bước xin quyền quản trị và thay
  // -Install (thêm hàng in, hộp thoại) bằng -Diagnose (chỉ đọc): đường dẫn, giải nén và lệnh chạy
  // chương trình in đều là của file thật (6/11: thiếu dấu \ trong đường dẫn làm cửa sổ tự tắt).
  assert.ok(bat.includes('set "NXC_PRINT_DIR=%LOCALAPPDATA%\\NXC-Printer"\r\n'));
  assert.ok(bat.includes('-File "%NXC_PRINT_DIR%\\print-agent.ps1" -Install\r\n'));
  const folder = await mkdtemp(path.join(os.tmpdir(), "nxc-installer-"));
  try {
    const lines = bat.split("\r\n");
    const from = lines.indexOf("net session >nul 2>&1"), to = lines.indexOf(")", from);
    const runnable = [...lines.slice(0, from), ...lines.slice(to + 1)].join("\r\n")
      .replace('print-agent.ps1" -Install', 'print-agent.ps1" -Diagnose')
      .replace("timeout /t 5 >nul", "rem");
    const installer = path.join(folder, "cai-may-in-phong-1.bat");
    await writeFile(installer, runnable);
    const local = path.join(folder, "Local");
    const { stdout } = await promisify(execFile)("cmd.exe", ["/d", "/c", installer], {
      windowsHide: true, timeout: 60000, env: { ...process.env, LOCALAPPDATA: local },
    });
    assert.match(stdout, /Dang cai chuong trinh in tu dong/);
    assert.match(stdout, /== M/, "the unpacked agent ran (its read-only printer check printed)");
    assert.match(stdout, /Da cai xong may in DNP/);
    assert.deepEqual(await readFile(path.join(local, "NXC-Printer", "print-agent.ps1")), agent);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
