import { encodePayload } from "./installers/payload.js";

// File cài máy in DNP cho mini PC của một phòng Photobooth (máy cắm DNP DS-RX1). Chạy một lần (xin
// quyền quản trị để tạo hàng in "cắt đôi 2x6"): giải nén chương trình in (installers/print-agent-dnp.ps1)
// vào %LOCALAPPDATA%\NXC-Printer, chạy phần cài đặt của nó (tìm máy DNP, bật 2inch cut cho hàng in tờ nhỏ,
// tự chạy khi bật máy). Địa chỉ web, mã máy in và tên phòng nằm trong file dạng base64.
export function printerInstaller({ script, api, token, room }) {
  if (!/^https?:\/\/[\w.:-]+$/.test(api)) throw new Error("Địa chỉ web không hợp lệ.");
  const extract = [
    "powershell -NoProfile -Command \"try { $s = [IO.File]::ReadAllText($env:NXC_PRINT_INSTALLER);",
    "$m = [regex]::Match($s, '(?m)^rem NXC_PRINT_AGENT_BASE64:([A-Za-z0-9+/=]+)'); if (-not $m.Success) { exit 1 };",
    "[IO.File]::WriteAllBytes((Join-Path $env:NXC_PRINT_DIR 'print-agent.ps1'), [Convert]::FromBase64String($m.Groups[1].Value)) }",
    "catch { exit 1 }\"",
  ].join(" ");
  return [
    "@echo off",
    "setlocal DisableDelayedExpansion",
    "rem NXC Photobooth - cai chuong trinh in tu dong cho may DNP DS-RX1 cua mot phong chup.",
    "rem Chay 1 lan tren mini PC cam may in DNP cua phong. To to: in nguyen to 10x15; to nho: may tu cat doi.",
    'set "NXC_SELF=%~f0"',
    "net session >nul 2>&1",
    "if errorlevel 1 (",
    "  echo Can quyen quan tri de tao hang in cat doi 2 inch: bam Yes o hop thoai cua Windows.",
    "  powershell -NoProfile -Command \"Start-Process -FilePath $env:NXC_SELF -Verb RunAs\"",
    "  exit /b",
    ")",
    'set "NXC_PRINT_INSTALLER=%~f0"',
    'set "NXC_PRINT_DIR=%LOCALAPPDATA%\\NXC-Printer"',
    'if not exist "%NXC_PRINT_DIR%" mkdir "%NXC_PRINT_DIR%"',
    "echo Dang cai chuong trinh in tu dong...",
    extract,
    "if errorlevel 1 (",
    "  echo Khong giai nen duoc chuong trinh in. Tai lai file cai o Quan ly may.",
    "  pause",
    "  exit /b 1",
    ")",
    // Phần mềm diệt virus có thể xoá ngay file vừa giải nén: báo rõ thay vì cửa sổ tự tắt.
    'if not exist "%NXC_PRINT_DIR%\\print-agent.ps1" (',
    "  echo Khong thay chuong trinh in sau khi giai nen: phan mem diet virus co the da chan.",
    "  echo Mo Windows Security - Virus and threat protection - Protection history de cho phep, roi chay lai file nay.",
    "  pause",
    "  exit /b 1",
    ")",
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%NXC_PRINT_DIR%\\print-agent.ps1" -Install',
    // Lỗi gì cũng giữ cửa sổ lại để chụp màn hình (nhật ký đầy đủ ở install.log).
    "if errorlevel 1 (",
    "  echo.",
    "  echo Cai may in chua xong. Chup man hinh cua so nay gui cho ky thuat.",
    "  echo Nhat ky: %NXC_PRINT_DIR%\\install.log",
    "  pause",
    "  exit /b 1",
    ")",
    "echo Da cai xong may in DNP. Cua so nay tu dong sau 5 giay.",
    "timeout /t 5 >nul",
    "exit /b",
    `rem NXC_PRINT_AGENT_BASE64:${encodePayload(script)}`,
    `rem NXC_PRINT_CONFIG_BASE64:${encodePayload(JSON.stringify({ api, token, room }), { bom: false })}`,
    "",
  ].join("\r\n");
}

// Tên file: không dấu, chỉ chữ số và gạch nối ("Phòng 1" → cai-may-in-phong-1.bat).
export const printerInstallerName = (room) =>
  `cai-may-in-${room.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u0111/gi, "d")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "phong"}.bat`;

// Standalone colour repair: no room token, agent installation or physical print.
export function printerColorInstaller(script) {
  return [
    "@echo off",
    "setlocal DisableDelayedExpansion",
    'set "NXC_SELF=%~f0"',
    'powershell -NoProfile -Command "$p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent()); if ($p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { exit 0 }; exit 1"',
    "if errorlevel 1 (",
    "  echo Run using the kiosk Windows account. Allow administrator access to update both print defaults.",
    '  powershell -NoProfile -Command "Start-Process -FilePath $env:NXC_SELF -Verb RunAs"',
    "  exit /b",
    ")",
    'set "NXC_COLOR_SCRIPT=%LOCALAPPDATA%\\NXC-Printer\\configure-rx1-color.ps1"',
    'if not exist "%LOCALAPPDATA%\\NXC-Printer" mkdir "%LOCALAPPDATA%\\NXC-Printer"',
    `powershell -NoProfile -Command "try { $s = [IO.File]::ReadAllText($env:NXC_SELF); $m = [regex]::Match($s, '(?m)^rem NXC_COLOR_BASE64:([A-Za-z0-9+/=]+)'); if (-not $m.Success) { exit 1 }; [IO.File]::WriteAllBytes($env:NXC_COLOR_SCRIPT, [Convert]::FromBase64String($m.Groups[1].Value)) } catch { exit 1 }"`,
    "if errorlevel 1 (",
    "  echo Could not unpack the RX1 colour tool. Download it again.",
    "  pause",
    "  exit /b 1",
    ")",
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%NXC_COLOR_SCRIPT%"',
    "if errorlevel 1 (",
    "  echo RX1 colour configuration failed. Read the error above; old settings are backed up before changes.",
    "  pause",
    "  exit /b 1",
    ")",
    "echo ICM configuration completed. Check the RX1 ICC profile and verify with a kiosk test print.",
    "pause",
    "exit /b",
    `rem NXC_COLOR_BASE64:${encodePayload(script)}`,
    "",
  ].join("\r\n");
}

// No elevation: Preferences and ICC associations belong to the kiosk Windows account.
// Only the two fixed UI modes can be passed to the embedded, self-contained tool.
export function printerDriverLauncher(script, mode = "preferences") {
  if (!["preferences", "properties"].includes(mode)) throw new Error("Chế độ driver không hợp lệ.");
  return [
    "@echo off",
    "setlocal DisableDelayedExpansion",
    'set "NXC_RX1_LAUNCHER=%~f0"',
    "echo Opening installed RX1 driver settings. Use the Windows account running the kiosk.",
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $s = [IO.File]::ReadAllText($env:NXC_RX1_LAUNCHER); $m = [regex]::Match($s, '(?m)^rem NXC_RX1_DRIVER_BASE64:([A-Za-z0-9+/=]+)'); if (-not $m.Success) { throw 'Driver tool payload missing.' }; $code = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($m.Groups[1].Value)); & ([scriptblock]::Create($code)) -Mode ${mode} } catch { Write-Host $_.Exception.Message; exit 1 }"`,
    "if errorlevel 1 (",
    "  echo Could not open RX1 settings. Read the message above.",
    "  pause",
    "  exit /b 1",
    ")",
    "exit /b 0",
    `rem NXC_RX1_DRIVER_BASE64:${encodePayload(script, { bom: false })}`,
    "",
  ].join("\r\n");
}
