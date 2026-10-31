// File cài "bật máy là kiosk tự mở" cho máy tính trong phòng chụp, gắn sẵn liên kết của phòng.
// Chạy một lần: mỗi lần đăng nhập máy sẽ mở Chrome (hoặc Edge) toàn màn hình đúng trang kiosk.
// Giữ hồ sơ riêng "NXC-Kiosk" để nhớ quyền camera / thư mục ảnh.
// Windows có menu nhỏ để điều khiển cửa sổ; Mac dùng nút cửa sổ và menu Xem của trình duyệt.
import windowsCornerControl from "./installers/kiosk-window-control.ps1?raw";
import startFujiAcquire from "./installers/start-fuji-acquire.ps1?raw";

const FLAGS =
  "--no-first-run --disable-session-crashed-bubble --noerrdialogs --autoplay-policy=no-user-gesture-required --overscroll-history-navigation=0";

// Liên kết kiosk chỉ có chữ, số và - _ . : / ? = — an toàn khi đặt trong script .bat / bash.
const safe = (url) => {
  if (!/^https?:\/\/[\w.:/?=-]+$/.test(url))
    throw new Error("Liên kết máy chụp không hợp lệ.");
  return url;
};

function encodePayload(source) {
  // PowerShell 5.1 cần BOM để đọc đúng tiếng Việt trong file UTF-8.
  const bytes = new TextEncoder().encode(`\ufeff${source}`);
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

// Phòng Photobooth và Polaroid đều chụp bằng Fujifilm + dây bấm: mở FUJIFILM X Acquire.
export function windowsScript(url, room) {
  const camera = [
    'set "NXC_FUJI_ACQUIRE=%LOCALAPPDATA%\\NXC-Kiosk\\start-fuji-acquire.ps1"',
    `powershell -NoProfile -Command "try { $source = [IO.File]::ReadAllText($env:NXC_KIOSK_INSTALLER); $payload = [regex]::Match($source, '(?m)^rem NXC_FUJI_ACQUIRE_BASE64:([A-Za-z0-9+/=]+)'); if (-not $payload.Success) { exit 1 }; [IO.File]::WriteAllBytes($env:NXC_FUJI_ACQUIRE, [Convert]::FromBase64String($payload.Groups[1].Value)) } catch { exit 1 }"`,
    'if not errorlevel 1 start "" /min powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%NXC_FUJI_ACQUIRE%"',
  ];
  const lines = [
    "@echo off",
    "setlocal DisableDelayedExpansion",
    `rem NXC Photobooth - tu mo kiosk phong: ${room.replace(/[^\w .-]/g, "")}`,
    `set "URL=${safe(url)}"`,
    'set "STARTUP=%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\NXC-Kiosk.bat"',
    // Lần đầu chạy: tự chép vào Startup (bật máy là chạy) và ra màn hình nền.
    'if /i not "%~f0"=="%STARTUP%" (',
    '  copy /y "%~f0" "%STARTUP%" >nul',
    '  for /f "delims=" %%D in (\'powershell -NoProfile -Command "[Environment]::GetFolderPath(\\"Desktop\\")"\') do copy /y "%~f0" "%%D\\Mo kiosk NXC.bat" >nul',
    "  echo Da cai xong: tu lan bat may sau, may chup se tu mo.",
    '  echo Lan dau: cho phep camera va chon thu muc anh trong "Cai dat may chup".',
    "  echo Bam dau tich o goc phai: toan man hinh (F11), ve cua so, hoac thu xuong taskbar.",
    "  echo Mo lai sau khi thu nho: bam bieu tuong Chrome / Edge o thanh tac vu. Dong may chup: Alt+F4.",
    "  timeout /t 6 >nul",
    ")",
    'set "BROWSER=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"',
    'if not exist "%BROWSER%" set "BROWSER=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"',
    'if not exist "%BROWSER%" set "BROWSER=%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe"',
    'if not exist "%BROWSER%" set "BROWSER=%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"',
    'if not exist "%BROWSER%" set "BROWSER=%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"',
    'set "NXC_KIOSK_INSTALLER=%~f0"',
    'set "NXC_KIOSK_CONTROL=%LOCALAPPDATA%\\NXC-Kiosk\\window-control.ps1"',
    'if not exist "%LOCALAPPDATA%\\NXC-Kiosk" mkdir "%LOCALAPPDATA%\\NXC-Kiosk"',
    ...camera,
    'set "NXC_KIOSK_CONTROL_READY=0"',
    // Payload nằm sau exit /b: không tải thêm file, không đưa base64 dài vào dòng lệnh.
    `powershell -NoProfile -Command "try { $source = [IO.File]::ReadAllText($env:NXC_KIOSK_INSTALLER); $payload = [regex]::Match($source, '(?m)^rem NXC_WINDOW_CONTROL_BASE64:([A-Za-z0-9+/=]+)'); if (-not $payload.Success) { exit 1 }; [IO.File]::WriteAllBytes($env:NXC_KIOSK_CONTROL, [Convert]::FromBase64String($payload.Groups[1].Value)) } catch { exit 1 }"`,
    'if not errorlevel 1 set "NXC_KIOSK_CONTROL_READY=1"',
    `start "" "%BROWSER%" --start-fullscreen --new-window "%URL%" --user-data-dir="%LOCALAPPDATA%\\NXC-Kiosk" ${FLAGS}`,
    'if "%NXC_KIOSK_CONTROL_READY%"=="1" start "" powershell -NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File "%NXC_KIOSK_CONTROL%" -ProfileDirectory "%LOCALAPPDATA%\\NXC-Kiosk"',
    "exit /b",
    `rem NXC_WINDOW_CONTROL_BASE64:${encodePayload(windowsCornerControl)}`,
    `rem NXC_FUJI_ACQUIRE_BASE64:${encodePayload(startFujiAcquire)}`,
    "",
  ];
  return lines.join("\r\n");
}

export function macScript(url, room) {
  return `#!/bin/bash
# NXC Photobooth - tự mở máy chụp phòng: ${room.replace(/[^\p{L}\p{N} .-]/gu, "")}
# Chạy một lần: mỗi lần đăng nhập Mac sẽ tự mở Chrome toàn màn hình.
URL='${safe(url)}'
DIR="$HOME/NXC-Kiosk"
mkdir -p "$DIR"
printf '%s' "$URL" > "$DIR/url.txt"
cat > "$DIR/mo-kiosk.sh" <<'SCRIPT'
#!/bin/bash
# Mo phan mem nhan anh tren may rieng truoc khi don khach.
APP="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$APP" ] || APP="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
"$APP" --start-fullscreen --new-window --user-data-dir="$HOME/NXC-Kiosk/chrome" ${FLAGS} "$(cat "$HOME/NXC-Kiosk/url.txt")" >/dev/null 2>&1 &
SCRIPT
chmod +x "$DIR/mo-kiosk.sh"
PLIST="$HOME/Library/LaunchAgents/vn.nxc.kiosk.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>vn.nxc.kiosk</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$DIR/mo-kiosk.sh</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>
PLIST
launchctl unload "$PLIST" 2>/dev/null
if ! launchctl load "$PLIST"; then
  echo "Chưa bật được tự mở máy chụp. Hãy giữ cửa sổ Terminal này để kiểm tra lỗi bên trên."
  exit 1
fi
echo "Đã cài xong: từ lần bật máy sau, máy chụp sẽ tự mở."
echo "Lần đầu: cho phép camera và chọn thư mục ảnh trong “Cài đặt máy chụp”."
echo "Chuyển màn phụ: đưa chuột lên mép trên, bấm nút xanh để thoát toàn màn hình, kéo cửa sổ sang màn phụ rồi bấm nút xanh để phóng to lại."
echo "Có thể dùng Fn+F hoặc Control+Command+F tùy phiên bản Chrome; xem phím tắt trong menu Xem (View)."
echo "Thoát máy chụp: Cmd+Q. Gỡ: xóa $PLIST"
`;
}

export function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
