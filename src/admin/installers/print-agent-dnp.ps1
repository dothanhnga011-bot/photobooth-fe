# NXC Photobooth - chương trình in tự động cho máy DNP DS-RX1 của MỘT phòng chụp, chạy trên mini PC
# cắm máy in. Cài bằng file "cai-may-in-*.bat" tải ở Quản lý máy → Cài máy chụp → Máy in DNP của phòng.
# Chỉ dùng PowerShell có sẵn của Windows (không cần Node.js).
#
#   -Install   tìm máy DNP, tạo hàng in "cắt đôi 2x6" cho tờ nhỏ (bật 2inch cut), lưu cấu hình và tự
#              chạy mỗi lần bật máy.
#   -Diagnose  chỉ xem: máy in, khổ giấy, cắt, ICM của Defaults/Preferences và ICC, độ phân giải và lưới
#              điểm của tờ 4x6, độ nét đang dùng (không đổi gì).
#   Mỗi tờ in được co đúng lưới điểm của máy in và vẽ 1:1, bù gamma, làm nét theo "Màu in RX1" trên web.
#   (mặc định) mỗi 3 giây hỏi web có lệnh in của phòng không, tải tờ in và in ra máy DNP:
#              tờ to (10 × 15 cm) in nguyên tờ ở hàng in chính; tờ nhỏ (2 dải 5 × 15 cm trên một tờ) in
#              qua hàng in cắt đôi để máy tự cắt thành 2 dải.
param(
  [switch]$Install,
  [switch]$Diagnose,
  # In hết lệnh đang chờ rồi thoát (kiểm tra tự động).
  [switch]$Once,
  # Không in thật: chép tờ in vào thư mục này (kiểm tra tự động).
  [string]$DryRunDir = "",
  [string]$ConfigPath = ""
)
$ErrorActionPreference = 'Stop'
$AgentDir = Join-Path $env:LOCALAPPDATA 'NXC-Printer'
if (-not $ConfigPath) { $ConfigPath = Join-Path $AgentDir 'config.json' }
$LogPath = Join-Path (Split-Path -Parent $ConfigPath) 'print-agent.log'
$StripSuffix = ' - cat doi 2x6'
$AgentPath = $PSCommandPath
$PsfNs = 'http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

function Write-Log([string]$text) {
  $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $text
  Write-Host $line
  try {
    if ((Test-Path -LiteralPath $LogPath) -and (Get-Item -LiteralPath $LogPath).Length -gt 1MB) {
      Move-Item -LiteralPath $LogPath -Destination "$LogPath.old" -Force
    }
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
  } catch {}
}

function Show-Message([string]$text, [string]$icon = 'Information') {
  Write-Host $text
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show($text, 'NXC Photobooth - Máy in DNP', 'OK', $icon)
  } catch {}
}

# Bấm chuột vào cửa sổ đen làm Windows chuyển sang chế độ chọn chữ ("Select" trên thanh tiêu đề) và DỪNG
# chương trình tới khi bấm Esc (7/11: cài máy in đứng im mãi vì vậy). Tắt chế độ đó (QuickEdit) cho cửa
# sổ cài đặt.
function Disable-QuickEdit {
  try {
    if (-not ('NXC.ConsoleMode' -as [type])) {
      Add-Type -Namespace NXC -Name ConsoleMode -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern System.IntPtr GetStdHandle(int handle);
[DllImport("kernel32.dll")] public static extern bool GetConsoleMode(System.IntPtr handle, out uint mode);
[DllImport("kernel32.dll")] public static extern bool SetConsoleMode(System.IntPtr handle, uint mode);
'@
    }
    $handle = [NXC.ConsoleMode]::GetStdHandle(-10)
    $mode = [uint32]0
    if ([NXC.ConsoleMode]::GetConsoleMode($handle, [ref]$mode)) {
      # Bỏ ENABLE_QUICK_EDIT_MODE (0x40), giữ ENABLE_EXTENDED_FLAGS (0x80) để Windows nhận thay đổi.
      [void][NXC.ConsoleMode]::SetConsoleMode($handle, [uint32]((([long]$mode) -bor 128) -band 4294967231))
    }
  } catch {}
}

# Một bước có thể treo vì driver máy in hoặc dịch vụ in của Windows (tạo hàng in, đọc / đặt tuỳ chọn của
# driver): chạy riêng, quá giờ thì báo lỗi rõ ràng thay vì đứng im mãi.
function Invoke-WithTimeout([scriptblock]$block, [object[]]$arguments, [int]$seconds, [string]$what) {
  $job = Start-Job -ScriptBlock $block -ArgumentList $arguments
  try {
    if (-not (Wait-Job $job -Timeout $seconds)) {
      Stop-Job $job -ErrorAction SilentlyContinue
      throw "$what quá $seconds giây: driver máy in hoặc dịch vụ in của Windows (Print Spooler) không trả lời. Khởi động lại máy tính rồi chạy lại file cài."
    }
    return Receive-Job $job -ErrorAction Stop
  } finally {
    Remove-Job $job -Force -ErrorAction SilentlyContinue
  }
}

# Máy DNP trong Windows: theo tên driver / tên hàng in, bỏ hàng in cắt đôi do chương trình này tạo.
function Find-Dnp {
  $all = @(Get-Printer -ErrorAction SilentlyContinue)
  $dnp = @($all | Where-Object {
    (($_.DriverName -match 'DNP|DS-?RX1|RX1') -or ($_.Name -match 'DNP|DS-?RX1|RX1')) -and
      -not $_.Name.EndsWith($StripSuffix)
  })
  if ($dnp.Count -eq 0) { return $null }
  # Ưu tiên máy không để "Use printer offline", rồi hàng in tên ngắn nhất (hàng in gốc của driver).
  return $dnp | Sort-Object @{ Expression = { [bool]$_.WorkOffline } }, @{ Expression = { $_.Name.Length } } |
    Select-Object -First 1
}

# Tên + tên hiển thị của một Feature / Option trong PrintCapabilities.
function Get-Label($node) {
  $text = $node.GetAttribute('name')
  foreach ($child in $node.ChildNodes) {
    if ($child.LocalName -eq 'Property' -and $child.GetAttribute('name') -match 'DisplayName$') {
      $text += ' ' + $child.InnerText
    }
  }
  return $text
}

# Tuỳ chọn cắt của driver (DNP: "2inch cut" Enable / Disable) trong PrintCapabilities của hàng in.
function Find-CutOptionIn([System.Xml.XmlDocument]$caps, [bool]$enable) {
  $ns = New-Object System.Xml.XmlNamespaceManager($caps.NameTable)
  $ns.AddNamespace('psf', $PsfNs)
  foreach ($feature in $caps.SelectNodes('//psf:Feature', $ns)) {
    if ((Get-Label $feature) -notmatch '(?i)cut') { continue }
    foreach ($option in $feature.SelectNodes('psf:Option', $ns)) {
      $label = Get-Label $option
      if ($enable) { $wanted = $label -match '(?i)enable|2\s*-?\s*inch|\bon\b' }
      else { $wanted = $label -match '(?i)disable|standard|normal|\boff\b' }
      if ($wanted -and $feature.GetAttribute('name').Contains(':') -and $option.GetAttribute('name').Contains(':')) {
        return @{ feature = $feature; option = $option; label = (Get-Label $feature) + ' = ' + $label }
      }
    }
  }
  return $null
}
function Get-CapabilitiesXml([string]$queueName) {
  return Invoke-WithTimeout {
    param($queueName)
    Add-Type -AssemblyName System.Printing, ReachFramework
    $server = New-Object System.Printing.LocalPrintServer
    (New-Object System.IO.StreamReader($server.GetPrintQueue($queueName).GetPrintCapabilitiesAsXml())).ReadToEnd()
  } @($queueName) 45 'Đọc tuỳ chọn của driver máy in'
}
function Find-CutOption([string]$queueName, [bool]$enable) {
  $caps = New-Object System.Xml.XmlDocument
  $caps.LoadXml([string](Get-CapabilitiesXml $queueName))
  return Find-CutOptionIn $caps $enable
}
# PrintTicket chỉ đổi đúng tuỳ chọn cắt (các tuỳ chọn khác của hàng in giữ nguyên khi gộp).
function New-CutTicketXml($found) {
  $fPrefix, $fLocal = $found.feature.GetAttribute('name').Split(':', 2)
  $oPrefix, $oLocal = $found.option.GetAttribute('name').Split(':', 2)
  $fUri = $found.feature.GetNamespaceOfPrefix($fPrefix)
  $oUri = $found.option.GetNamespaceOfPrefix($oPrefix)
  return "<psf:PrintTicket xmlns:psf=`"$PsfNs`" xmlns:f=`"$fUri`" xmlns:o=`"$oUri`" version=`"1`">" +
    "<psf:Feature name=`"f:$fLocal`"><psf:Option name=`"o:$oLocal`"/></psf:Feature></psf:PrintTicket>"
}

# Bật / tắt cắt đôi 2 inch làm mặc định của hàng in (cần quyền quản trị). Driver không cho đặt tuỳ chọn
# qua PrintTicket thì trả về $false: nhân viên bật tay một lần trong cửa sổ cài đặt in.
function Set-TwoInchCut([string]$queueName, [bool]$enable) {
  try {
    $found = Find-CutOption $queueName $enable
    if (-not $found) { return $false }
    $xml = New-CutTicketXml $found
    $oLocal = $found.option.GetAttribute('name').Split(':', 2)[1]
    $saved = Invoke-WithTimeout {
      param($queueName, $xml, $oLocal)
      Add-Type -AssemblyName System.Printing, ReachFramework
      $delta = New-Object System.Printing.PrintTicket(New-Object System.IO.MemoryStream(, [Text.Encoding]::UTF8.GetBytes($xml)))
      $server = New-Object System.Printing.PrintServer
      $queue = New-Object System.Printing.PrintQueue($server, $queueName, [System.Printing.PrintSystemDesiredAccess]::AdministratePrinter)
      $queue.DefaultPrintTicket = $queue.MergeAndValidatePrintTicket($queue.DefaultPrintTicket, $delta).ValidatedPrintTicket
      $queue.UserPrintTicket = $queue.MergeAndValidatePrintTicket($queue.UserPrintTicket, $delta).ValidatedPrintTicket
      $queue.Commit()
      $queue.Refresh()
      (New-Object System.IO.StreamReader($queue.UserPrintTicket.GetXmlStream())).ReadToEnd() -match [regex]::Escape($oLocal)
    } @($queueName, $xml, $oLocal) 60 'Bật / tắt cắt đôi 2 inch'
    if ($saved -eq $true) {
      Write-Log "Hàng in '$queueName': $($found.label)."
      return $true
    }
  } catch {
    Write-Log "Không tự đặt được tuỳ chọn cắt cho '$queueName': $($_.Exception.Message)"
  }
  return $false
}

# DEVMODE (base64) của hàng in với "2inch cut" bật / tắt CHỈ cho một lệnh in: tờ nhỏ cắt đôi, tờ to in
# nguyên tờ, cùng một hàng in DNP — không cần hàng in cắt đôi riêng hay quyền quản trị. Driver không có
# tuỳ chọn cắt thì trả về $null (in như cài đặt sẵn của hàng in).
function Get-CutDevMode([string]$queueName, [bool]$enable) {
  try {
    $found = Find-CutOption $queueName $enable
    if (-not $found) { return $null }
    $xml = New-CutTicketXml $found
    return Invoke-WithTimeout {
      param($queueName, $xml)
      Add-Type -AssemblyName System.Printing, ReachFramework
      $delta = New-Object System.Printing.PrintTicket(New-Object System.IO.MemoryStream(, [Text.Encoding]::UTF8.GetBytes($xml)))
      $queue = (New-Object System.Printing.LocalPrintServer).GetPrintQueue($queueName)
      $ticket = $queue.MergeAndValidatePrintTicket($queue.UserPrintTicket, $delta).ValidatedPrintTicket
      $converter = New-Object System.Printing.Interop.PrintTicketConverter($queueName, $queue.ClientPrintSchemaVersion)
      try { [Convert]::ToBase64String($converter.ConvertPrintTicketToDevMode($ticket, [System.Printing.Interop.BaseDevModeType]::UserDefault)) }
      finally { $converter.Dispose() }
    } @($queueName, $xml) 45 'Đặt cắt đôi 2 inch cho lệnh in'
  } catch {
    Write-Log "Không đặt được cắt đôi 2 inch cho lệnh in ở '$queueName': $($_.Exception.Message)"
    return $null
  }
}
function Set-DocumentDevMode($document, [string]$devmode) {
  $bytes = [Convert]::FromBase64String($devmode)
  $handle = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
  try {
    [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $handle, $bytes.Length)
    $document.PrinterSettings.SetHdevmode($handle)
    $document.DefaultPageSettings.SetHdevmode($handle)
  } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($handle) }
}

# Dao cắt của máy DNP đặt TRỰC TIẾP trên máy in (thư viện cspstat.dll của DNP, cài cùng công cụ DNP
# PrinterInfo): firmware 2.x không cắt theo tuỳ chọn "2inch cut" của driver, chỉ cắt khi máy ở chế độ
# CUTTER 120 (2 inch); 0 = cắt thường (nguyên tờ). Thư viện 32-bit nên gọi qua PowerShell 32-bit.
$CutterModes = @{ on = 120; off = 0 }
function Find-CspDll {
  foreach ($path in @((Join-Path $AgentDir 'cspstat.dll'), 'C:\DNPPIA\PrinterInfo\cspstat.dll')) {
    if (Test-Path -LiteralPath $path) { return $path }
  }
  return $null
}
# 'status' → mã trạng thái (0x10001 = sẵn sàng); 'set' → đặt chế độ dao cắt, trả 1 khi máy nhận.
function Invoke-Csp([string]$action, [int]$mode = 0) {
  $dll = Find-CspDll
  if (-not $dll) { return $null }
  $call = if ($action -eq 'set') { "[NxcCsp]::SetCutterMode(0, [uint32]$mode)" } else { '[NxcCsp]::GetStatus(0)' }
  $script = @"
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class NxcCsp {
  [DllImport(@"$dll", CharSet=CharSet.Unicode)] public static extern int GetPrinterPortNum(IntPtr arr, int size);
  [DllImport(@"$dll", CharSet=CharSet.Unicode)] public static extern int SetCutterMode(int portno, uint ct);
  [DllImport(@"$dll", CharSet=CharSet.Unicode)] public static extern uint GetStatus(int portno);
}
'@
`$arr = [Runtime.InteropServices.Marshal]::AllocHGlobal(8192)
[Runtime.InteropServices.Marshal]::Copy((New-Object byte[] 8192), 0, `$arr, 8192)
if ([NxcCsp]::GetPrinterPortNum(`$arr, 8) -lt 1) { 'NOPRINTER'; exit }
$call
"@
  $ps32 = Join-Path $env:WINDIR 'SysWOW64\WindowsPowerShell\v1.0\powershell.exe'
  if (-not (Test-Path -LiteralPath $ps32)) { $ps32 = 'powershell.exe' }
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
  $result = Invoke-WithTimeout {
    param($ps32, $encoded)
    & $ps32 -NoProfile -NonInteractive -EncodedCommand $encoded
  } @($ps32, $encoded) 30 'Đọc / đặt dao cắt máy DNP'
  return ([string](@($result) | Select-Object -Last 1)).Trim()
}
# Máy in đã in xong mọi tờ (hàng in Windows trống, máy báo sẵn sàng): đổi dao cắt lúc này không làm
# tờ đang in bị cắt sai.
function Wait-PrinterIdle([int]$seconds = 300) {
  $until = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $until) {
    $jobs = 0
    foreach ($name in @($script:Config.printer, $script:Config.stripPrinter)) {
      if ($name) { $jobs += @(Get-PrintJob -PrinterName $name -ErrorAction SilentlyContinue).Count }
    }
    if ($jobs -eq 0 -and (Invoke-Csp 'status') -eq '65537') { return $true }
    Start-Sleep -Seconds 3
  }
  return $false
}
# Đặt dao cắt cho lệnh in: 'on' (khung nhỏ, cắt đôi) / 'off' (khung to, nguyên tờ). Trả về $true khi
# máy nhận lệnh; $false khi máy này chưa có thư viện DNP (in theo tuỳ chọn của driver như trước).
$script:CutterMode = $null
function Set-PrinterCutter([string]$cut) {
  if ($DryRunDir -or -not (Find-CspDll)) { return $false }
  $mode = $CutterModes[$cut]
  if ($script:CutterMode -ne $mode -and -not (Wait-PrinterIdle)) {
    Write-Log 'Máy in chưa in xong tờ trước sau 5 phút: vẫn đổi dao cắt cho lệnh mới.'
  }
  try {
    $result = Invoke-Csp 'set' $mode
    if ($result -eq '1') { $script:CutterMode = $mode; return $true }
    Write-Log "Máy DNP không nhận lệnh đặt dao cắt ($mode): $result"
  } catch { Write-Log "Không đặt được dao cắt máy DNP: $($_.Exception.Message)" }
  $script:CutterMode = $null
  return $false
}

# Khổ giấy 10 × 15 cm (4 × 6 inch) của driver (driver có thể khai báo dọc hoặc ngang).
# Output compensation belongs to the printer only; camera files and QR downloads stay untouched.
# sharpen: độ nét bản in 0–4 (0 = không làm nét); cấu hình cũ chưa có thì dùng mức 2.
function ConvertTo-Rx1Sharpen($value) {
  if ($null -eq $value -or $value -is [bool] -or $value -is [string]) { throw 'sharpen must be a whole number from 0 to 4' }
  $number = [double]$value
  if ([double]::IsNaN($number) -or $number -ne [Math]::Floor($number) -or $number -lt 0 -or $number -gt 4) {
    throw 'sharpen must be a whole number from 0 to 4'
  }
  return [int]$number
}
function Get-Rx1OutputSettings([string]$settingsPath = (Join-Path $env:LOCALAPPDATA 'NXC-Printer\rx1-output.json')) {
  $defaults = @{ gamma = 1.50; maxResolution = $true; sharpen = 2; warning = '' }
  if (-not (Test-Path -LiteralPath $settingsPath)) { return $defaults }
  try {
    $profile = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $gammaValue = $defaults.gamma
    $maximum = $true
    $sharpen = $defaults.sharpen
    if ($null -ne $profile.PSObject.Properties['gamma']) {
      if ($profile.gamma -is [bool]) { throw 'gamma must be a number' }
      $gammaValue = [double]$profile.gamma
    }
    if ([double]::IsNaN($gammaValue) -or [double]::IsInfinity($gammaValue) -or $gammaValue -lt 1.00 -or $gammaValue -gt 2.20) { throw 'gamma must be between 1.00 and 2.20' }
    if ($null -ne $profile.PSObject.Properties['maxResolution']) {
      if ($profile.maxResolution -isnot [bool]) { throw 'maxResolution must be true or false' }
      $maximum = $profile.maxResolution
    }
    if ($null -ne $profile.PSObject.Properties['sharpen']) { $sharpen = ConvertTo-Rx1Sharpen $profile.sharpen }
    return @{ gamma = $gammaValue; maxResolution = $maximum; sharpen = $sharpen; warning = '' }
  } catch {
    $defaults.warning = "Invalid rx1-output.json; using gamma $($defaults.gamma) and maximum supported DPI, sharpness $($defaults.sharpen): $($_.Exception.Message)"
    return $defaults
  }
}

# ── Tờ in đúng lưới điểm của máy in + làm nét cho in nhiệt ──────────────────────────────────────────
# Tờ in (vd. 2400 × 3600) được co MỘT lần bằng nội suy chất lượng cao về đúng số điểm thật của trang
# máy in ở độ phân giải đang dùng (300 × 300 dpi: ~1240 × 1845; 300 × 600: ~1240 × 3690) rồi vẽ 1:1, để
# driver DNP không phải co giãn nữa (co giãn của driver làm ảnh mềm / răng cưa). Sau đó làm nét trên độ
# sáng (unsharp mask: không đổi màu, bỏ qua chênh lệch rất nhỏ để không làm nổi hạt) vì mực in nhiệt
# loang nhẹ trên giấy. Mức 0 = không làm nét.
function Get-Rx1SharpenAmount([int]$level) {
  return @(0.0, 0.35, 0.6, 0.9, 1.25)[[Math]::Max(0, [Math]::Min(4, $level))]
}
function Initialize-Rx1Sharpen {
  if ('NxcRx1Sharpen' -as [type]) { return $true }
  if ($script:Rx1SharpenError) { return $false }
  try {
    Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
public static class NxcRx1Sharpen {
  // amounts: một mức cho cả tờ, hoặc nhiều mức cho các dải dọc bằng nhau (tờ in thử độ nét).
  // sigmaX / sigmaY: bán kính làm mờ tính bằng điểm của máy in từng chiều (điểm có thể không vuông).
  public static void Apply(Bitmap image, double[] amounts, double sigmaX, double sigmaY, int threshold) {
    int w = image.Width, h = image.Height, bands = amounts.Length;
    BitmapData data = image.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
    try {
      int stride = data.Stride;
      byte[] px = new byte[stride * h];
      Marshal.Copy(data.Scan0, px, 0, px.Length);
      float[] luma = new float[w * h];
      for (int r = 0; r < h; r++) {
        int o = r * stride;
        for (int c = 0; c < w; c++, o += 4) luma[r * w + c] = 0.114f * px[o] + 0.587f * px[o + 1] + 0.299f * px[o + 2];
      }
      float[] blurred = Blur(luma, w, h, sigmaX, sigmaY);
      for (int r = 0; r < h; r++) {
        int o = r * stride;
        for (int c = 0; c < w; c++, o += 4) {
          double amount = amounts[bands == 1 ? 0 : Math.Min(bands - 1, (int)((long)c * bands / w))];
          if (amount <= 0) continue;
          float diff = luma[r * w + c] - blurred[r * w + c];
          if (Math.Abs(diff) <= threshold) continue;
          float delta = (float)(amount * diff);
          px[o] = Clamp(px[o] + delta);
          px[o + 1] = Clamp(px[o + 1] + delta);
          px[o + 2] = Clamp(px[o + 2] + delta);
        }
      }
      Marshal.Copy(px, 0, data.Scan0, px.Length);
    } finally { image.UnlockBits(data); }
  }
  static byte Clamp(float value) { return value <= 0 ? (byte)0 : value >= 255 ? (byte)255 : (byte)(value + 0.5f); }
  static float[] Kernel(double sigma) {
    if (sigma < 0.05) return new float[] { 1f };
    int radius = Math.Max(1, (int)Math.Ceiling(sigma * 3));
    float[] k = new float[radius * 2 + 1];
    double sum = 0;
    for (int i = -radius; i <= radius; i++) { double v = Math.Exp(-(i * i) / (2 * sigma * sigma)); k[i + radius] = (float)v; sum += v; }
    for (int i = 0; i < k.Length; i++) k[i] = (float)(k[i] / sum);
    return k;
  }
  static float[] Blur(float[] source, int w, int h, double sigmaX, double sigmaY) {
    float[] kx = Kernel(sigmaX), ky = Kernel(sigmaY);
    int rx = kx.Length / 2, ry = ky.Length / 2;
    float[] across = new float[w * h], result = new float[w * h];
    for (int r = 0; r < h; r++)
      for (int c = 0; c < w; c++) {
        float s = 0;
        for (int i = -rx; i <= rx; i++) { int x = Math.Min(w - 1, Math.Max(0, c + i)); s += kx[i + rx] * source[r * w + x]; }
        across[r * w + c] = s;
      }
    for (int r = 0; r < h; r++)
      for (int c = 0; c < w; c++) {
        float s = 0;
        for (int i = -ry; i <= ry; i++) { int y = Math.Min(h - 1, Math.Max(0, r + i)); s += ky[i + ry] * across[y * w + c]; }
        result[r * w + c] = s;
      }
    return result;
  }
}
'@
    return $true
  } catch {
    $script:Rx1SharpenError = $_.Exception.Message
    return $false
  }
}
# Nhãn của tờ in thử: vạch trắng giữa 5 dải, số mức 0–4 ở đầu mỗi dải (mức đang dùng: ô đậm), một
# dòng hướng dẫn ở cuối tờ. Chữ đặt lùi vào trong, tránh phần tràn lề bị máy xén.
function Add-Rx1TestLabels([Drawing.Bitmap]$bitmap, [int]$current) {
  $g = [Drawing.Graphics]::FromImage($bitmap)
  $white = New-Object Drawing.SolidBrush([Drawing.Color]::White)
  $ink = New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(255, 45, 30, 24))
  $font = New-Object Drawing.Font('Arial', 22, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Point)
  $small = New-Object Drawing.Font('Arial', 8, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Point)
  $center = New-Object Drawing.StringFormat
  try {
    $center.Alignment = [Drawing.StringAlignment]::Center
    $center.LineAlignment = [Drawing.StringAlignment]::Center
    $g.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $dpiX = [double]$bitmap.HorizontalResolution; $dpiY = [double]$bitmap.VerticalResolution
    $band = $bitmap.Width / 5
    $line = [Math]::Max(1.0, $dpiX / 150)
    for ($i = 1; $i -lt 5; $i++) { $g.FillRectangle($white, [single]($i * $band - $line / 2), [single]0, [single]$line, [single]$bitmap.Height) }
    for ($i = 0; $i -lt 5; $i++) {
      $box = New-Object Drawing.RectangleF([single]($i * $band + $band * 0.2), [single](0.22 * $dpiY), [single]($band * 0.6), [single](0.42 * $dpiY))
      $fill = if ($i -eq $current) { $ink } else { $white }
      $text = if ($i -eq $current) { $white } else { $ink }
      $g.FillRectangle($fill, $box)
      $g.DrawString([string]$i, $font, $text, $box, $center)
    }
    $caption = New-Object Drawing.RectangleF([single]0, [single]($bitmap.Height - 0.5 * $dpiY), [single]$bitmap.Width, [single](0.26 * $dpiY))
    $g.FillRectangle($white, $caption)
    $g.DrawString('In thử độ nét 0 → 4 · ô đậm: mức đang dùng', $small, $ink, $caption, $center)
  } finally { $center.Dispose(); $small.Dispose(); $font.Dispose(); $ink.Dispose(); $white.Dispose(); $g.Dispose() }
}
# Một trang in đúng lưới điểm của máy in: tờ in phủ kín trang (giữ tỉ lệ, căn giữa; phần tràn lề máy xén
# như cũ), bù gamma, rồi làm nét. $pageWidth / $pageHeight: PageBounds (1/100 inch); $dpiX / $dpiY: độ phân
# giải máy in. $testCurrent ≥ 0: tờ in thử — 5 dải độ nét 0–4, dải mức đang dùng có nhãn đậm.
function New-Rx1PageBitmap([Drawing.Image]$photo, [double]$pageWidth, [double]$pageHeight, [double]$dpiX, [double]$dpiY,
    [double]$gamma, [int]$sharpen, [int]$testCurrent = -1) {
  $width = [Math]::Max(1, [int][Math]::Round($pageWidth * $dpiX / 100))
  $height = [Math]::Max(1, [int][Math]::Round($pageHeight * $dpiY / 100))
  $bitmap = New-Object Drawing.Bitmap($width, $height, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $done = $false
  try {
    $bitmap.SetResolution([single]$dpiX, [single]$dpiY)
    $g = [Drawing.Graphics]::FromImage($bitmap)
    try {
      $g.Clear([Drawing.Color]::White)
      $g.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
      # Phủ kín trang theo inch (điểm của máy in có thể không vuông), giữ tỉ lệ tờ in, căn giữa.
      $inch = [Math]::Max(($pageWidth / 100) / $photo.Width, ($pageHeight / 100) / $photo.Height)
      $w = $photo.Width * $inch * $dpiX; $h = $photo.Height * $inch * $dpiY
      $dest = New-Object Drawing.Rectangle([int][Math]::Round(($width - $w) / 2)), ([int][Math]::Round(($height - $h) / 2)), ([int][Math]::Ceiling($w)), ([int][Math]::Ceiling($h))
      $attrs = New-Rx1ImageAttributes $gamma
      try { $g.DrawImage($photo, $dest, 0, 0, $photo.Width, $photo.Height, [Drawing.GraphicsUnit]::Pixel, $attrs) }
      finally { $attrs.Dispose() }
    } finally { $g.Dispose() }
    $amounts = if ($testCurrent -ge 0) { @(0..4 | ForEach-Object { Get-Rx1SharpenAmount $_ }) } else { @(Get-Rx1SharpenAmount $sharpen) }
    if (@($amounts | Where-Object { $_ -gt 0 }).Count) {
      if (Initialize-Rx1Sharpen) { [NxcRx1Sharpen]::Apply($bitmap, [double[]]$amounts, 0.7 * $dpiX / 300, 0.7 * $dpiY / 300, 2) }
      elseif ($testCurrent -ge 0) { throw "Máy này không làm nét được ảnh: $($script:Rx1SharpenError)" }
    }
    if ($testCurrent -ge 0) { Add-Rx1TestLabels $bitmap $testCurrent }
    $done = $true
    return $bitmap
  } finally { if (-not $done) { $bitmap.Dispose() } }
}
# Vẽ một tờ in lên trang của máy in: đúng lưới điểm, 1:1 (điểm ảnh = điểm máy in, driver không co giãn).
# Trả về kích thước lưới "rộng x cao" để ghi nhật ký.
function Write-Rx1Page($event, [Drawing.Image]$photo, [double]$gamma, [int]$sharpen, [int]$testCurrent = -1) {
  # Tờ khác chiều với trang của máy in (vd. tờ ngang trên trang dọc): xoay 90 độ cho kín khổ.
  $pageLandscape = $event.PageBounds.Width -gt $event.PageBounds.Height
  if (($photo.Width -gt $photo.Height) -ne $pageLandscape) { $photo.RotateFlip([Drawing.RotateFlipType]::Rotate90FlipNone) }
  $g = $event.Graphics
  $dpiX = [double]$g.DpiX; $dpiY = [double]$g.DpiY
  $page = New-Rx1PageBitmap $photo $event.PageBounds.Width $event.PageBounds.Height $dpiX $dpiY $gamma $sharpen $testCurrent
  try {
    $g.ResetTransform()
    $g.PageUnit = [Drawing.GraphicsUnit]::Pixel
    $g.TranslateTransform([single](-$event.PageSettings.HardMarginX * $dpiX / 100), [single](-$event.PageSettings.HardMarginY * $dpiY / 100))
    $g.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $g.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::Half
    $g.DrawImage($page, (New-Object Drawing.Rectangle(0, 0, $page.Width, $page.Height)), 0, 0, $page.Width, $page.Height, [Drawing.GraphicsUnit]::Pixel)
    return ('{0}x{1}' -f $page.Width, $page.Height)
  } finally { $page.Dispose() }
}
function Set-Rx1MaximumResolution($settings, $page) {
  # Use only positive DPI pairs advertised by this driver; never invent a 600 DPI mode.
  $current = $page.PrinterResolution
  try {
    $best = @($settings.PrinterResolutions | Where-Object { $_.X -gt 0 -and $_.Y -gt 0 } |
      Sort-Object @{ Expression = { [long]$_.X * $_.Y }; Descending = $true }, @{ Expression = { $_.X }; Descending = $true } |
      Select-Object -First 1)
    if ($best.Count -and ([long]$best[0].X * $best[0].Y -gt [long]$current.X * $current.Y -or $current.X -le 0 -or $current.Y -le 0)) {
      $page.PrinterResolution = $best[0]
    }
  } catch { $page.PrinterResolution = $current }
}

# Chỉ cấu hình màu: đồng bộ nền, không nhận hoặc phát lệnh in. Giữ file cuối cùng khi mất mạng.
function Set-Rx1RemoteOutput($profile, [string]$settingsPath = (Join-Path $env:LOCALAPPDATA 'NXC-Printer\rx1-output.json')) {
  if ($null -eq $profile) { return $false }
  if ($null -eq $profile.PSObject.Properties['gamma'] -or $profile.gamma -is [bool] -or
      $profile.maxResolution -isnot [bool]) { throw 'Invalid RX1 output settings from web.' }
  $gamma = [double]$profile.gamma
  if ([double]::IsNaN($gamma) -or [double]::IsInfinity($gamma) -or $gamma -lt 1.00 -or $gamma -gt 2.20) {
    throw 'Web gamma must be between 1.00 and 2.20.'
  }
  $current = Get-Rx1OutputSettings $settingsPath
  # Máy chủ cũ chưa gửi độ nét: giữ độ nét đang dùng trên máy này.
  $sharpen = $current.sharpen
  if ($null -ne $profile.PSObject.Properties['sharpen']) {
    try { $sharpen = ConvertTo-Rx1Sharpen $profile.sharpen } catch { throw 'Web sharpness must be a whole number from 0 to 4.' }
  }
  if ((Test-Path -LiteralPath $settingsPath) -and -not $current.warning -and
      [Math]::Abs($current.gamma - $gamma) -lt 0.000001 -and $current.maxResolution -eq $profile.maxResolution -and
      $current.sharpen -eq $sharpen) { return $false }
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $settingsPath) | Out-Null
  $temp = $settingsPath + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
  try {
    $json = @{ gamma = $gamma; maxResolution = [bool]$profile.maxResolution; sharpen = $sharpen } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($temp, $json, (New-Object Text.UTF8Encoding($false)))
    if (Test-Path -LiteralPath $settingsPath) { [IO.File]::Replace($temp, $settingsPath, ($temp + '.previous')) }
    else { [IO.File]::Move($temp, $settingsPath) }
  } finally {
    foreach ($file in @($temp, ($temp + '.previous'))) {
      if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
    }
  }
  Write-Log "RX1 output received from web: gamma $gamma; maximum supported DPI = $($profile.maxResolution); sharpness $sharpen."
  return $true
}

# ── In thử độ nét (quản trị bấm ở trang Màu in RX1) ──────────────────────────────────────────────
# Yêu cầu đến qua lần đồng bộ màu; in MỘT tờ chia 5 dải độ nét 0–4 từ tờ in gần nhất của máy này (chưa có
# thì ảnh mẫu trên web), rồi báo kết quả ở lần đồng bộ sau. Mã yêu cầu đã nhận được ghi xuống đĩa TRƯỚC khi
# in: chương trình in khởi động lại giữa chừng cũng không in lần hai.
function Get-Rx1TestRecordPath { return (Join-Path $env:LOCALAPPDATA 'NXC-Printer\sharpness-tests.txt') }
function Request-Rx1SharpnessTest([string]$id) {
  if ($id -notmatch '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' -or $script:Rx1TestPending -eq $id) { return }
  $record = Get-Rx1TestRecordPath
  if ((Test-Path -LiteralPath $record) -and (@(Get-Content -LiteralPath $record) -contains $id)) {
    # Đã gửi tờ thử trước khi chương trình in khởi động lại mà chưa kịp báo: báo lại để web thôi chờ.
    if (-not $script:Rx1TestReport) { $script:Rx1TestReport = @{ id = $id; sent = $true; message = 'Tờ in thử độ nét đã được gửi tới máy in trước đó.' } }
    return
  }
  $script:Rx1TestPending = $id
}
# Giữ bản sao tờ in khách gần nhất (một file, ghi đè) làm ảnh cho tờ in thử độ nét.
function Save-Rx1LastSheet([string]$file) {
  if ($DryRunDir -or -not $file -or -not (Test-Path -LiteralPath $file)) { return }
  try {
    $directory = Join-Path $env:LOCALAPPDATA 'NXC-Printer'
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
    Get-ChildItem -LiteralPath $directory -Filter 'last-sheet.*' | Remove-Item -Force
    Copy-Item -LiteralPath $file -Destination (Join-Path $directory ('last-sheet' + [IO.Path]::GetExtension($file))) -Force
  } catch { Write-Log "Không lưu được tờ in gần nhất (dùng cho in thử độ nét): $($_.Exception.Message)" }
}
function Invoke-Rx1SharpnessTest {
  $id = $script:Rx1TestPending
  if (-not $id) { return }
  $script:Rx1TestPending = $null
  $record = Get-Rx1TestRecordPath
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $record) | Out-Null
  $seen = @(if (Test-Path -LiteralPath $record) { Get-Content -LiteralPath $record | Select-Object -Last 19 })
  Set-Content -LiteralPath $record -Value (@($seen) + $id) -Encoding ASCII
  $sample = $null; $sent = $false
  try {
    $source = Get-ChildItem -LiteralPath (Split-Path -Parent $record) -Filter 'last-sheet.*' -ErrorAction SilentlyContinue | Select-Object -First 1
    $from = 'tờ in gần nhất'
    if (-not $source) {
      $sample = Join-Path $env:TEMP ('nxc-rx1-sample-' + [guid]::NewGuid().ToString('N') + '.jpg')
      Invoke-WebRequest -Uri "$($script:Config.api)/downloads/rx1-sharpness-sample.jpg" -OutFile $sample -UseBasicParsing -TimeoutSec 60
      $source = Get-Item -LiteralPath $sample
      $from = 'ảnh mẫu'
    }
    $offline = Get-OfflineQueue
    if ($offline) { throw "hàng in '$offline' đang bật 'Use printer offline' trong Windows." }
    [void](Set-PrinterCutter 'off')
    $paper = Send-Sheets $script:Config.printer @($source.FullName) 'NXC-thu-do-net' 'off' (Get-Rx1OutputSettings).sharpen
    $message = "Đã in tờ thử độ nét từ $from ($paper)."
    $sent = $true
  } catch { $message = "Chưa in được tờ thử độ nét: $($_.Exception.Message)" }
  finally { if ($sample) { Remove-Item -LiteralPath $sample -Force -ErrorAction SilentlyContinue } }
  Write-Log $message
  if ($message.Length -gt 480) { $message = $message.Substring(0, 480) }
  $script:Rx1TestReport = @{ id = $id; sent = $sent; message = $message }
  # Báo kết quả ngay ở lần đồng bộ kế tiếp.
  if ($script:OutputSync) { $script:OutputSync.next = [datetime]::MinValue }
}

function Receive-Rx1OutputSettings {
  if ($script:OutputSyncRetryAt -and (Get-Date) -lt $script:OutputSyncRetryAt) { return }
  if (-not $script:OutputSync) {
    Add-Type -AssemblyName System.Net.Http
    $client = New-Object Net.Http.HttpClient
    $client.Timeout = [TimeSpan]::FromSeconds(10)
    $client.MaxResponseContentBufferSize = 65536
    $client.DefaultRequestHeaders.Authorization = New-Object Net.Http.Headers.AuthenticationHeaderValue('Bearer', [string]$script:Config.token)
    $script:OutputSync = @{ client = $client; task = $null; content = $null; next = [datetime]::MinValue; error = '' }
  }
  $sync = $script:OutputSync
  if ($sync.task) {
    if (-not $sync.task.IsCompleted) { return }
    $response = $null
    try {
      $response = $sync.task.GetAwaiter().GetResult()
      if (-not $response.IsSuccessStatusCode) { throw "RX1 settings sync HTTP $([int]$response.StatusCode)." }
      $result = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
      # Kết quả tờ in thử đã tới máy chủ: thôi gửi lại.
      if ($sync.report -and $script:Rx1TestReport -and $script:Rx1TestReport.id -eq $sync.report.id) { $script:Rx1TestReport = $null }
      [void](Set-Rx1RemoteOutput $result.rx1Output)
      if ($result.sharpnessTest -and $result.sharpnessTest.id) { Request-Rx1SharpnessTest ([string]$result.sharpnessTest.id) }
      $sync.error = ''
      $sync.next = (Get-Date).AddSeconds(5)
    } catch {
      $message = $_.Exception.Message
      if ($sync.error -ne $message) { Write-Log "Cannot sync RX1 color settings; keeping local settings: $message" }
      $sync.error = $message
      $sync.next = (Get-Date).AddSeconds(15)
    } finally {
      if ($response) { $response.Dispose() }
      if ($sync.content) { $sync.content.Dispose() }
      $sync.task = $null; $sync.content = $null; $sync.report = $null
    }
  }
  if ((Get-Date) -lt $sync.next) { return }
  try {
    $current = Get-Rx1OutputSettings
    $payload = @{ applied = @{ gamma = $current.gamma; maxResolution = $current.maxResolution; sharpen = $current.sharpen } }
    if ($script:Rx1TestReport) { $payload.sharpnessTest = $script:Rx1TestReport; $sync.report = $script:Rx1TestReport }
    $body = $payload | ConvertTo-Json -Compress
    $sync.content = New-Object Net.Http.StringContent($body, [Text.Encoding]::UTF8, 'application/json')
    $url = $script:Config.api.TrimEnd('/') + '/api/print-agent/output-settings/sync'
    $sync.task = $sync.client.PostAsync($url, $sync.content)
  } catch {
    if ($sync.content) { $sync.content.Dispose(); $sync.content = $null }
    $sync.next = (Get-Date).AddSeconds(15)
    Write-Log "Cannot start RX1 color sync; keeping local settings: $($_.Exception.Message)"
  }
}
function New-Rx1ImageAttributes([double]$gamma) {
  $attributes = New-Object System.Drawing.Imaging.ImageAttributes
  $attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
  # Gamma > 1 darkens midtones while pure white/black stay white/black.
  # Apply exactly once at DrawImage, before Windows/driver ICM.
  if ([Math]::Abs($gamma - 1.0) -gt 0.00001) { $attributes.SetGamma([single]$gamma) }
  return $attributes
}

# Driver DNP có phần tràn lề: nhận khoảng 4x6, ưu tiên khổ không phải x2/cắt.
function Find-Paper($settings) {
  return @($settings.PaperSizes | Where-Object {
    $short = [Math]::Min($_.Width, $_.Height); $long = [Math]::Max($_.Width, $_.Height)
    $short -ge 380 -and $short -le 440 -and $long -ge 580 -and $long -le 650
  }) | Sort-Object @{ Expression = { [bool]($_.PaperName -match 'x ?2|2x6|strip|cut') } },
    @{ Expression = { [Math]::Abs([Math]::Min($_.Width, $_.Height) - 400) + [Math]::Abs([Math]::Max($_.Width, $_.Height) - 600) } } |
    Select-Object -First 1
}

# $cut: 'on' = máy cắt đôi tờ (2 dải 5 × 15), 'off' = in nguyên tờ 10 × 15, '' = giữ cài đặt của hàng in.
# $test ≥ 0: tờ in thử độ nét (5 dải 0–4, dải $test = mức đang dùng có nhãn đậm).
function Send-Sheets([string]$printerName, [string[]]$files, [string]$docName, [string]$cut = '', [int]$test = -1) {
  if ($DryRunDir) {
    New-Item -ItemType Directory -Force -Path $DryRunDir | Out-Null
    $safe = $printerName -replace '[^\w.-]+', '_'
    $n = 0
    foreach ($file in $files) {
      $n++
      Copy-Item -LiteralPath $file -Destination (Join-Path $DryRunDir ('{0}-{1}-{2}{3}' -f $docName, $n, $safe, [IO.Path]::GetExtension($file)))
    }
    return 'thử'
  }
  Add-Type -AssemblyName System.Drawing
  $document = New-Object System.Drawing.Printing.PrintDocument
  $document.DocumentName = $docName
  $document.PrinterSettings.PrinterName = $printerName
  if (-not $document.PrinterSettings.IsValid) { throw "Không thấy hàng in '$printerName' trong Windows." }
  $document.PrintController = New-Object System.Drawing.Printing.StandardPrintController
  $script:cutApplied = $false
  if ($cut) {
    $devmode = Get-CutDevMode $printerName ($cut -eq 'on')
    if ($devmode) { Set-DocumentDevMode $document $devmode; $script:cutApplied = $true }
  }
  $paper = Find-Paper $document.PrinterSettings
  # Không nhận ra khổ 4x6 trong danh sách của driver: in bằng khổ đang đặt sẵn của hàng in (driver DNP mặc
  # định 4x6) thay vì bỏ lệnh in của khách; tên khổ ghi vào kết quả để kiểm tra.
  if ($paper) { $document.DefaultPageSettings.PaperSize = $paper }
  else { $paper = $document.DefaultPageSettings.PaperSize }
  $document.DefaultPageSettings.Landscape = $false
  $document.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
  $outputSettings = Get-Rx1OutputSettings
  if ($outputSettings.warning) { Write-Log $outputSettings.warning }
  if ($outputSettings.maxResolution) { Set-Rx1MaximumResolution $document.PrinterSettings $document.DefaultPageSettings }
  $script:printGamma = $outputSettings.gamma
  $script:printSharpen = $outputSettings.sharpen
  $script:printTest = $test
  # Resolution is selected per job; queue defaults, ICC and cutter settings remain separate.
  $quality = $document.DefaultPageSettings.PrinterResolution
  $script:printPages = $files
  $script:printIndex = 0
  $script:printGrid = ''
  $document.add_PrintPage({
    param($sender, $event)
    $photo = [System.Drawing.Image]::FromFile($script:printPages[$script:printIndex], $true)
    # Trang phủ kín, giữ tỉ lệ (trang DNP 6,15 × 4,13 inch có phần tràn lề), đúng lưới điểm của máy in, vẽ
    # 1:1 — driver không co giãn nữa; bù gamma rồi làm nét (New-Rx1PageBitmap).
    try { $script:printGrid = Write-Rx1Page $event $photo $script:printGamma $script:printSharpen $script:printTest }
    finally { $photo.Dispose() }
    $script:printIndex++
    $event.HasMorePages = $script:printIndex -lt $script:printPages.Count
  })
  try { $document.Print() } finally { $document.Dispose() }
  $sharpness = if ($test -ge 0) { 'tờ thử 0–4' } elseif ($script:Rx1SharpenError -and $script:printSharpen) { "không làm nét được: $($script:Rx1SharpenError)" } else { $script:printSharpen }
  Write-Log "RX1 output: $($quality.X)x$($quality.Y) dpi, $($script:printGrid) điểm (vẽ 1:1); gamma $script:printGamma; độ nét $sharpness; Windows/driver ICM."
  return '{0} {1}x{2}, {3} điểm, độ nét {4}' -f $paper.PaperName, $paper.Width, $paper.Height, $script:printGrid, $(if ($test -ge 0) { '0–4' } else { $script:printSharpen })
}

function Read-Config {
  if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Chưa cài máy in: không thấy $ConfigPath. Chạy lại file cai-may-in-*.bat tải ở Quản lý máy."
  }
  return Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Invoke-Api([string]$method, [string]$path, $body) {
  $params = @{
    Method = $method
    Uri = "$($script:Config.api)/api/print-agent$path"
    Headers = @{ Authorization = "Bearer $($script:Config.token)" }
    TimeoutSec = 30
    UseBasicParsing = $true
  }
  if ($null -ne $body) {
    $params.ContentType = 'application/json; charset=utf-8'
    $params.Body = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Compress -Depth 6))
  }
  return Invoke-RestMethod @params
}

# Tình trạng máy DNP cho trang quản trị: sẵn sàng, mất kết nối, hết giấy…, số tờ đang chờ trong Windows.
$StatusNames = @{
  Normal = 'Sẵn sàng'; Offline = 'Mất kết nối (máy in tắt hoặc rút cáp USB)'; PaperOut = 'Hết giấy / hết mực'
  PaperJam = 'Kẹt giấy'; Paused = 'Hàng in đang tạm dừng'; Error = 'Máy in báo lỗi'; PaperProblem = 'Lỗi giấy'
  DoorOpen = 'Đang mở nắp'; NotAvailable = 'Không dùng được'; TonerLow = 'Sắp hết mực'
}
# Hàng in đang bật "Use printer offline" (Windows giữ lệnh, không gửi xuống máy): chương trình chưa nhận lệnh
# từ web — lệnh chờ trên web và tự in khi tắt chế độ đó, thay vì web báo "đã gửi" mà máy không in (7/11).
function Get-OfflineQueue {
  if ($DryRunDir) { return $null }
  foreach ($name in @($script:Config.printer, $script:Config.stripPrinter)) {
    if (-not $name) { continue }
    $queue = Get-Printer -Name $name -ErrorAction SilentlyContinue
    if ($queue -and $queue.WorkOffline) { return $name }
  }
  return $null
}

# Máy in báo gì sau khi nhận tờ in (mất kết nối, hết giấy…): ghi vào kết quả để quản trị biết lệnh còn nằm
# trong hàng in Windows, chưa ra giấy.
function Get-PrinterProblem {
  if ($DryRunDir) { return '' }
  $printer = Get-Printer -Name $script:Config.printer -ErrorAction SilentlyContinue
  if (-not $printer) { return '' }
  $raw = [string]$printer.PrinterStatus
  if ($raw -notin @('Offline', 'Error', 'PaperOut', 'PaperJam', 'PaperProblem', 'Paused', 'DoorOpen', 'NotAvailable', 'UserInterventionRequired')) { return '' }
  $state = $StatusNames[$raw]
  if (-not $state) { $state = $raw }
  return " Máy in đang báo: $state — tờ in nằm trong hàng in Windows, máy sẽ in khi sẵn sàng."
}

# Tự cập nhật: lúc khởi động và mỗi 30 phút, tải bản mới của chính chương trình này từ trang web (cùng địa
# chỉ với API, /downloads/print-agent-dnp.ps1). Chỉ thay khi khác bản đang chạy, đọc được (không lỗi cú
# pháp) và đúng là chương trình in. Sửa lỗi chương trình in không cần chạy lại file cài trên mini PC.
function Update-Self {
  if ($Once -or $DryRunDir -or -not $AgentPath) { return $false }
  $temp = Join-Path $env:TEMP ('nxc-print-agent-' + [guid]::NewGuid().ToString('N') + '.ps1')
  try {
    Invoke-WebRequest -Uri "$($script:Config.api)/downloads/print-agent-dnp.ps1" -OutFile $temp -UseBasicParsing -TimeoutSec 60
    $new = [IO.File]::ReadAllBytes($temp)
    if ($new.Length -lt 2000) { return $false }
    if ([Convert]::ToBase64String($new) -eq [Convert]::ToBase64String([IO.File]::ReadAllBytes($AgentPath))) { return $false }
    $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($temp, [ref]$null, [ref]$errors)
    if ($errors -or ([Text.Encoding]::UTF8.GetString($new) -notmatch 'Update-Self' )) {
      Write-Log 'Bản cập nhật tải về không hợp lệ — giữ bản đang chạy.'
      return $false
    }
    Copy-Item -LiteralPath $temp -Destination $AgentPath -Force
    Write-Log 'Đã tải bản mới của chương trình in.'
    return $true
  } catch {
    Write-Log "Chưa kiểm tra được bản cập nhật: $($_.Exception.Message)"
    return $false
  } finally {
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
  }
}

function Restart-Agent {
  Write-Log 'Chạy lại chương trình in với bản mới.'
  try { $script:Mutex.ReleaseMutex() } catch {}
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', "`"$AgentPath`""
  )
  exit 0
}

function Send-Status {
  $config = $script:Config
  $printer = Get-Printer -Name $config.printer -ErrorAction SilentlyContinue
  $ready = $false; $state = 'Không thấy máy in DNP trong Windows'; $jobs = 0
  if ($printer) {
    $raw = [string]$printer.PrinterStatus
    $state = $StatusNames[$raw]
    if (-not $state) { $state = $raw }
    $ready = ($raw -eq 'Normal') -and -not $printer.WorkOffline
    if ($printer.WorkOffline) { $state = 'Đang bật "Use printer offline" trong Windows' }
    $offline = Get-OfflineQueue
    if ($offline) { $ready = $false; $state = "Hàng in '$offline' đang bật ""Use printer offline"" trong Windows" }
    foreach ($name in @($config.printer, $config.stripPrinter)) {
      if ($name) { $jobs += @(Get-PrintJob -PrinterName $name -ErrorAction SilentlyContinue).Count }
    }
  }
  $cut = 'none'
  if ($config.stripPrinter -and (Get-Printer -Name $config.stripPrinter -ErrorAction SilentlyContinue)) { $cut = $config.cut }
  if ($cut -ne 'auto' -and $cut -ne 'queue') { $cut = 'none' }
  [void](Invoke-Api 'POST' '/status' @{ dnp = @{
    printer = [string]$config.printer; stripPrinter = [string]$config.stripPrinter
    ready = [bool]$ready; state = [string]$state; jobs = [int]$jobs; cut = $cut
  } })
}

function Invoke-Job($job, [string[]]$localFiles = @()) {
  $config = $script:Config
  $dir = Join-Path $env:TEMP ('nxc-print-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $dir | Out-Null
  try {
    $files = @($localFiles)
    if (-not $localFiles.Count) { foreach ($sheet in @($job.sheets)) {
      $file = Join-Path $dir ('{0}.{1}' -f $sheet.index, $sheet.extension)
      Invoke-WebRequest -Uri "$($config.api)/api/print-agent/jobs/$($job.id)/sheets/$($sheet.index)" `
        -Headers @{ Authorization = "Bearer $($config.token)"; 'X-Print-Lease' = $job.leaseId } `
        -OutFile $file -UseBasicParsing -TimeoutSec 120
      $copies = [Math]::Max(1, [int]$job.copies)
      for ($n = 0; $n -lt $copies; $n++) { $files += $file }
    } }
    # Khung nhỏ: 1 tờ 1200 × 1800 (2 dải) bật "2inch cut" cho riêng lệnh này để máy cắt đôi; khung to:
    # tắt cắt, in nguyên tờ. Có hàng in cắt đôi riêng thì tờ nhỏ vẫn đi qua hàng đó.
    $queue = $config.printer; $note = ''; $cut = 'off'
    if ($job.printSize -eq 'strip') {
      $cut = 'on'
      if ($config.stripPrinter -and (($DryRunDir) -or (Get-Printer -Name $config.stripPrinter -ErrorAction SilentlyContinue))) {
        $queue = $config.stripPrinter
      }
    }
    $cutter = Set-PrinterCutter $cut
    $paper = Send-Sheets $queue $files ("NXC-$($job.code)") $cut
    Save-Rx1LastSheet $files[0]
    if ($job.printSize -eq 'strip') {
      if ($cutter) { $note = ', tờ nhỏ: máy cắt đôi 2 inch (dao cắt 120)' }
      elseif ($script:cutApplied -or $queue -ne $config.printer) { $note = ', tờ nhỏ cắt đôi 2 inch' }
      else { $note = ' — driver không nhận lệnh cắt đôi 2 inch: tờ nhỏ ra nguyên tờ, nhân viên tự cắt' }
    } elseif ($cutter) { $note = ', tờ to: in nguyên tờ (dao cắt thường)' }
    return "Đã gửi $($files.Count) tờ tới máy DNP ($paper)$note.$(Get-PrinterProblem)"
  } finally {
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Start-LocalPrinter {
  $script:LocalListener = New-Object Net.HttpListener
  $script:LocalListener.Prefixes.Add('http://127.0.0.1:8789/')
  try {
    $script:LocalListener.Start()
    $script:LocalRequest = $script:LocalListener.BeginGetContext($null, $null)
    Write-Log 'Direct RX1 printing: http://127.0.0.1:8789 (no print dialog).'
  } catch {
    Write-Log "Cannot start direct printing: $($_.Exception.Message). Run the room printer installer again."
    $script:LocalListener = $null
  }
}

function Write-LocalResponse($response, [int]$status, $body) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 6 -Compress))
  $response.StatusCode = $status
  $response.ContentType = 'application/json; charset=utf-8'
  $response.ContentLength64 = $bytes.Length
  try { $response.OutputStream.Write($bytes, 0, $bytes.Length) } finally { $response.Close() }
}

function Receive-LocalPrint {
  if (-not $script:LocalListener -or -not $script:LocalRequest.IsCompleted) { return }
  $context = $script:LocalListener.EndGetContext($script:LocalRequest)
  $script:LocalRequest = $script:LocalListener.BeginGetContext($null, $null)
  $request = $context.Request; $response = $context.Response
  $response.Headers['Cache-Control'] = 'no-store'
  $origin = [string]$request.Headers['Origin']
  $apiOrigin = ([uri]$script:Config.api).GetLeftPart([UriPartial]::Authority)
  $allowed = @($apiOrigin, 'https://mellowptb.com', 'https://photobooth.ngathanh.workers.dev', 'https://studio.selfbooth.workers.dev', 'http://localhost:5173', 'http://127.0.0.1:5173')
  if ($request.UserHostName -ne '127.0.0.1:8789' -or -not $origin -or $origin -notin $allowed) {
    Write-LocalResponse $response 403 @{ message = 'Kiosk origin not allowed.' }; return
  }
  $response.Headers['Access-Control-Allow-Origin'] = $origin
  $response.Headers['Vary'] = 'Origin'
  $response.Headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
  $response.Headers['Access-Control-Allow-Headers'] = 'Content-Type, X-Album-Token, X-Print-Key, X-Print-Frame, X-Print-Sheets, X-Print-Size'
  $response.Headers['Access-Control-Allow-Private-Network'] = 'true'
  if ($request.HttpMethod -eq 'OPTIONS') { Write-LocalResponse $response 200 @{ ok = $true }; return }
  if ($request.HttpMethod -eq 'GET' -and $request.Url.AbsolutePath -eq '/health') {
    $output = Get-Rx1OutputSettings
    Write-LocalResponse $response 200 @{ directPrint = 2; room = [string]$script:Config.room; outputSettingsVersion = 1;
      output = @{ gamma = $output.gamma; maxResolution = $output.maxResolution; sharpen = $output.sharpen } }; return
  }
  if ($request.HttpMethod -ne 'POST' -or $request.Url.AbsolutePath -ne '/print') {
    Write-LocalResponse $response 404 @{ message = 'Unknown local printer endpoint.' }; return
  }
  $directory = $null
  try {
    $albumToken = [string]$request.Headers['X-Album-Token']
    if ($albumToken -notmatch '^[a-zA-Z0-9_-]{8,200}$') { throw 'Invalid album token.' }
    if ($request.ContentLength64 -le 0 -or $request.ContentLength64 -gt 64MB) { throw 'Print body must be between 1 byte and 64 MB.' }
    $memory = New-Object IO.MemoryStream
    try {
      $buffer = New-Object byte[] 65536
      while (($read = $request.InputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
        $memory.Write($buffer, 0, $read)
        if ($memory.Length -gt 64MB) { throw 'Print body exceeds 64 MB.' }
      }
      $bytes = $memory.ToArray()
    } finally { $memory.Dispose() }
    $requestKey = [string]$request.Headers['X-Print-Key']
    $parsedKey = [guid]::Empty
    if (-not [guid]::TryParse($requestKey, [ref]$parsedKey)) { throw 'Invalid print request ID.' }
    $requestKey = $parsedKey.ToString('D')
    $sizeText = [string]$request.Headers['X-Print-Sheets']
    if ($sizeText -notmatch '^\d{1,9}(,\d{1,9}){0,19}$') { throw 'Invalid sheet lengths.' }
    $sizes = @($sizeText.Split(',') | ForEach-Object { [int]$_ })
    if (@($sizes | Where-Object { $_ -le 0 -or $_ -gt 36MB }).Count -or ($sizes | Measure-Object -Sum).Sum -ne $bytes.Length) { throw 'Sheet lengths do not match the image bytes.' }
    $printSize = [string]$request.Headers['X-Print-Size']
    if ($printSize -notin @('full','strip')) { throw 'Direct RX1 printing requires full or strip paper.' }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $fingerprint = [Convert]::ToBase64String($sha.ComputeHash($bytes)) + ':' + $sizeText + ':' + $printSize + ':' + $albumToken }
    finally { $sha.Dispose() }
    $journal = Join-Path (Split-Path -Parent $ConfigPath) 'direct-print-records'
    New-Item -ItemType Directory -Force -Path $journal | Out-Null
    $recordPath = Join-Path $journal ($requestKey + '.json')
    if (Test-Path -LiteralPath $recordPath) {
      $previous = Get-Content -LiteralPath $recordPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ($previous.fingerprint -ne $fingerprint) { throw 'The images for this print request have changed.' }
      if ($previous.state -eq 'sent') { Write-LocalResponse $response 200 @{ sent = $true; duplicate = $true }; return }
      throw 'This request was already received. Check the printer before reprinting.'
    }
    $job = @{ code = $requestKey.Substring(0,8); printSize = $printSize; copies = 1 }
    $directory = Join-Path $env:TEMP ('nxc-direct-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $directory | Out-Null
    $offset = 0; $files = @()
    Add-Type -AssemblyName System.Drawing
    for ($index = 0; $index -lt $sizes.Count; $index++) {
      $length = $sizes[$index]
      $file = Join-Path $directory ("$index.png")
      $stream = [IO.File]::Create($file)
      try { $stream.Write($bytes, $offset, $length) } finally { $stream.Dispose() }
      $image = [Drawing.Image]::FromFile($file)
      try {
        $short = [Math]::Min($image.Width, $image.Height); $long = [Math]::Max($image.Width, $image.Height)
        if (-not (($short -eq 1200 -and $long -eq 1800) -or ($short -eq 1181 -and $long -eq 1772) -or ($short -eq 2400 -and $long -eq 3600))) { throw 'RX1 sheet must be 1181x1772, 1200x1800 or 2400x3600 pixels.' }
      } finally { $image.Dispose() }
      $offset += $length; $files += $file
    }
    if (Get-OfflineQueue) { throw 'The Windows printer queue is offline.' }
    # Durable marker BEFORE physical output. An interrupted process must never print this ID again.
    $record = @{ fingerprint = $fingerprint; state = 'sending'; at = (Get-Date).ToUniversalTime().ToString('o') }
    $marker = [Text.Encoding]::UTF8.GetBytes(($record | ConvertTo-Json -Compress))
    $stream = New-Object IO.FileStream($recordPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try { $stream.Write($marker, 0, $marker.Length); $stream.Flush($true) } finally { $stream.Dispose() }
    $sent = $false; $message = ''
    try {
      $message = Invoke-Job $job $files
      $sent = $true
    } catch { $message = $_.Exception.Message }
    $record.state = if ($sent) { 'sent' } else { 'uncertain' }
    try { $record | ConvertTo-Json -Compress | Set-Content -LiteralPath $recordPath -Encoding UTF8 }
    catch { Write-Log 'Could not update local print record; do not resend this print automatically.' }
    Write-LocalResponse $response $(if ($sent) { 200 } else { 503 }) @{ sent = $sent; message = $message }
  } catch {
    try { Write-LocalResponse $response 503 @{ sent = $false; message = $_.Exception.Message } } catch {}
  } finally {
    if ($directory -and (Split-Path -Parent $directory) -eq $env:TEMP -and (Split-Path -Leaf $directory) -like 'nxc-direct-*') {
      Remove-Item -LiteralPath $directory -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}

function Wait-WithLocalPrinter([int]$seconds) {
  $until = (Get-Date).AddSeconds($seconds)
  do { Receive-LocalPrint; Start-Sleep -Milliseconds 100 } while ((Get-Date) -lt $until)
}

function Start-Agent {
  $script:Config = Read-Config
  if (-not $Once) {
    $script:Mutex = New-Object System.Threading.Mutex($false, 'Local\NXC-Printer-Agent')
    # Bản cũ vừa tự cập nhật đang thoát: chờ nó nhả khoá một lúc.
    if (-not $script:Mutex.WaitOne(15000)) { Write-Log 'Chương trình in đã đang chạy.'; return }
    if (Update-Self) { Restart-Agent }
  }
  $updateAt = Get-Date
  if (-not $Once -and -not $DryRunDir) {
    Start-LocalPrinter
    if ($script:LocalListener) {
      Write-Log 'RX1 direct mode: browser -> local agent -> Windows printer. No cloud print queue or network authorization.'
      # A cloud status request must not block a local customer print when the Internet is down.
      while ($true) {
        Receive-LocalPrint
        try { Receive-Rx1OutputSettings } catch {
          $script:OutputSyncRetryAt = (Get-Date).AddSeconds(15)
          Write-Log "RX1 color sync unavailable: $($_.Exception.Message)"
        }
        # Tờ in thử độ nét quản trị vừa yêu cầu (nếu có): in giữa hai lần nhận lệnh in của khách.
        try { Invoke-Rx1SharpnessTest } catch { Write-Log "In thử độ nét lỗi: $($_.Exception.Message)" }
        Start-Sleep -Milliseconds 50
      }
    }
    throw 'Direct printer could not start. Run the room printer installer again.'
  }
  Write-Log "Bắt đầu nhận lệnh in phòng '$($script:Config.room)' → $($script:Config.printer) (tờ nhỏ: $($script:Config.stripPrinter))."
  $statusAt = [datetime]::MinValue
  $delay = 3
  while ($true) {
    try {
      Receive-LocalPrint
      if (-not $Once -and ((Get-Date) - $updateAt).TotalMinutes -ge 30) {
        $updateAt = Get-Date
        if (Update-Self) { Restart-Agent }
      }
      if (((Get-Date) - $statusAt).TotalSeconds -ge 60) {
        try { Send-Status } catch { Write-Log "Không báo được tình trạng máy in: $($_.Exception.Message)" }
        $statusAt = Get-Date
      }
      $offline = Get-OfflineQueue
      if ($offline) {
        if ($script:OfflineQueue -ne $offline) { Write-Log "Hàng in '$offline' đang bật 'Use printer offline': chưa nhận lệnh in." }
        $script:OfflineQueue = $offline
        if ($Once) { break }
        $delay = 10
        Wait-WithLocalPrinter $delay
        continue
      }
      $script:OfflineQueue = $null
      $claim = Invoke-Api 'POST' '/claim' @{ printSizes = @('full', 'strip') }
      $job = $claim.job
      if ($job) {
        $sent = $false
        try {
          $message = Invoke-Job $job
          $sent = $true
          Write-Log "Lệnh $($job.code): $message"
        } catch {
          $message = "Máy in DNP không nhận lệnh: $($_.Exception.Message)"
          Write-Log "Lệnh $($job.code): $message"
        }
        if ($message.Length -gt 480) { $message = $message.Substring(0, 480) }
        [void](Invoke-Api 'POST' "/jobs/$($job.id)/complete" @{ leaseId = [string]$job.leaseId; sent = $sent; message = $message })
        # Còn lệnh khác thì lấy ngay; báo lại tình trạng (số tờ đang chờ) cho quản trị.
        $delay = 0
        $statusAt = [datetime]::MinValue
      } else {
        if ($Once) { break }
        $delay = 3
      }
    } catch {
      $code = 0
      try { $code = [int]$_.Exception.Response.StatusCode } catch {}
      if ($code -eq 403) {
        Write-Log 'Mã máy in không hợp lệ hoặc đã hết hạn: tải lại file cài máy in ở Quản lý máy và chạy lại.'
        $delay = 60
      } else {
        Write-Log "Chưa kết nối được máy chủ: $($_.Exception.Message)"
        $delay = [Math]::Min(30, [Math]::Max(3, $delay * 2))
      }
      if ($Once) { throw }
    }
    if ($delay -gt 0) { Wait-WithLocalPrinter $delay }
  }
}

function Show-ColorDiagnosis([string]$name) {
  Write-Host "== Color settings: $name"
  try {
    Add-Type -AssemblyName System.Printing, ReachFramework
    $server = New-Object System.Printing.LocalPrintServer
    $queue = $null
    try {
      $queue = $server.GetPrintQueue($name)
      $scopes = [ordered]@{ 'Printing Defaults' = $queue.DefaultPrintTicket; 'Printing Preferences (current user)' = $queue.UserPrintTicket }
      foreach ($scope in $scopes.GetEnumerator()) {
        Write-Host "  $($scope.Key)"
        if ($null -eq $scope.Value) { Write-Host '    Inherits Printing Defaults'; continue }
        $reader = New-Object IO.StreamReader($scope.Value.GetXmlStream())
        try { [xml]$ticket = $reader.ReadToEnd() } finally { $reader.Dispose() }
        $ns = New-Object Xml.XmlNamespaceManager($ticket.NameTable)
        $ns.AddNamespace('psf', $PsfNs)
        foreach ($feature in $ticket.SelectNodes('//psf:Feature', $ns)) {
          if ($feature.GetAttribute('name') -notmatch 'Color|ICM|Intent|Resolution|Gamma|Brightness|Contrast|Chroma|Sharp|Quality') { continue }
          $values = @($feature.SelectNodes('psf:Option', $ns) | ForEach-Object {
            $_.GetAttribute('name')
            $_.SelectNodes('.//psf:Value', $ns) | ForEach-Object { $_.InnerText }
          })
          Write-Host ('    {0}: {1}' -f $feature.GetAttribute('name'), ($values -join ' '))
        }
      }
    } finally { if ($queue) { $queue.Dispose() }; $server.Dispose() }
    if (-not ('NxcPrinterColor' -as [type])) {
      Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class NxcPrinterColor {
  [DllImport("gdi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern IntPtr CreateDC(string driver, string device, string output, IntPtr mode);
  [DllImport("gdi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool GetICMProfile(IntPtr dc, ref uint size, StringBuilder profile);
  [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr dc);
}
'@
    }
    $dc = [NxcPrinterColor]::CreateDC('WINSPOOL', $name, $null, [IntPtr]::Zero)
    if ($dc -eq [IntPtr]::Zero) { throw 'Cannot read the printer color profile.' }
    try {
      [uint32]$size = 2048
      $profile = New-Object Text.StringBuilder 2048
      if ([NxcPrinterColor]::GetICMProfile($dc, [ref]$size, $profile)) {
        Write-Host "  ICC selected by Windows: $profile"
      } else { Write-Host '  ICC: Windows did not return a profile. Check Color Management for this queue.' }
    } finally { [void][NxcPrinterColor]::DeleteDC($dc) }
  } catch { Write-Host "  Cannot read color settings: $($_.Exception.Message)" }
}

function Show-Diagnosis {
  $outputSettings = Get-Rx1OutputSettings
  Write-Host "== RX1 output per job: gamma $($outputSettings.gamma); maximum supported DPI = $($outputSettings.maxResolution); sharpness $($outputSettings.sharpen) (0-4)"
  if ($outputSettings.warning) { Write-Host $outputSettings.warning }
  Add-Type -AssemblyName System.Drawing
  if (Initialize-Rx1Sharpen) { Write-Host '  làm nét: sẵn sàng (tờ in vẽ đúng lưới điểm của máy in, 1:1)' }
  else { Write-Host "  làm nét: KHÔNG dùng được trên máy này — $($script:Rx1SharpenError)" }
  Write-Host '  Khi dùng độ nét trên web, để Sharpness trong driver DNP = 0 (không làm nét hai lần).'
  Write-Host '== Máy in trong Windows'
  Get-Printer | Format-Table -AutoSize Name, DriverName, PortName, PrinterStatus, WorkOffline | Out-String -Width 200 | Write-Host
  $main = Find-Dnp
  if (-not $main) { Write-Host 'Không thấy máy DNP (driver DNP / DS-RX1).'; return }
  Write-Host "== Máy DNP: $($main.Name)"
  Add-Type -AssemblyName System.Drawing
  $settings = New-Object System.Drawing.Printing.PrinterSettings
  $settings.PrinterName = $main.Name
  foreach ($paper in $settings.PaperSizes) { Write-Host ('  khổ: {0} ({1} x {2})' -f $paper.PaperName, $paper.Width, $paper.Height) }
  $paper = Find-Paper $settings
  Write-Host "  khổ dùng để in: $(if ($paper) { $paper.PaperName } else { 'KHÔNG CÓ 4x6' })"
  # Độ phân giải driver cho chọn (300 x 600 = chế độ High resolution của RX1HS) và lưới điểm của tờ 4x6.
  foreach ($resolution in $settings.PrinterResolutions) { Write-Host ('  độ phân giải: {0} {1}x{2}' -f $resolution.Kind, $resolution.X, $resolution.Y) }
  $page = New-Object System.Drawing.Printing.PageSettings($settings)
  if ($paper) { $page.PaperSize = $paper }
  if ($outputSettings.maxResolution) { Set-Rx1MaximumResolution $settings $page }
  $dpi = $page.PrinterResolution
  if ($paper -and $dpi.X -gt 0 -and $dpi.Y -gt 0) {
    Write-Host ('  in ở {0}x{1} dpi: lưới điểm tờ 4x6 ~ {2}x{3}' -f $dpi.X, $dpi.Y,
      [Math]::Round([Math]::Min($paper.Width, $paper.Height) * $dpi.X / 100), [Math]::Round([Math]::Max($paper.Width, $paper.Height) * $dpi.Y / 100))
  }
  foreach ($name in @($main.Name, $main.Name + $StripSuffix)) {
    if (-not (Get-Printer -Name $name -ErrorAction SilentlyContinue)) { continue }
    Show-ColorDiagnosis $name
    try {
      $on = Find-CutOption $name $true; $off = Find-CutOption $name $false
      Write-Host "  cắt đôi qua PrintTicket ($name): bật = $(if ($on) { $on.label } else { 'không có' }); tắt = $(if ($off) { $off.label } else { 'không có' })"
    } catch { Write-Host "  không đọc được PrintCapabilities của $($name): $($_.Exception.Message)" }
  }
}

function Install-Agent {
  # Địa chỉ web, mã máy in và tên phòng nằm trong file cài (.bat) dạng base64, không qua dòng lệnh.
  $installer = $env:NXC_PRINT_INSTALLER
  if (-not $installer -or -not (Test-Path -LiteralPath $installer)) { throw 'Hãy chạy file cai-may-in-*.bat, không chạy trực tiếp file này.' }
  $payload = [regex]::Match([IO.File]::ReadAllText($installer), '(?m)^rem NXC_PRINT_CONFIG_BASE64:([A-Za-z0-9+/=]+)')
  if (-not $payload.Success) { throw 'File cài bị hỏng: tải lại ở Quản lý máy.' }
  $setup = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload.Groups[1].Value)) | ConvertFrom-Json
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ConfigPath) | Out-Null
  Disable-QuickEdit
  # Http.sys binding limited to the current Windows account and loopback address.
  if (-not $env:NXC_STARTUP_DIR) {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    & netsh.exe http add urlacl url=http://127.0.0.1:8789/ "user=$identity" 2>&1 | Out-Null
    # An existing reservation is normal on reinstall; listener startup reports an actual failure.
  }
  Write-Host "Cài máy in DNP cho phòng: $($setup.room)"

  $main = Find-Dnp
  if (-not $main) {
    Show-Message ("Chưa thấy máy in DNP DS-RX1 trong Windows.`n`nCắm máy in vào máy tính này, cài driver DNP " +
      "(dnpphoto.com → Support → Drivers), bật máy in rồi chạy lại file cài.") 'Warning'
    exit 1
  }
  Write-Host "Máy in DNP: $($main.Name) (driver $($main.DriverName), cổng $($main.PortName))"
  $stripName = $main.Name + $StripSuffix
  $created = $false
  if (-not (Get-Printer -Name $stripName -ErrorAction SilentlyContinue)) {
    Write-Host "Đang tạo hàng in cho tờ nhỏ: $stripName (có thể mất tới 1 phút)..."
    [void](Invoke-WithTimeout {
      param($name, $driver, $port)
      Add-Printer -Name $name -DriverName $driver -PortName $port
    } @($stripName, $main.DriverName, $main.PortName) 120 'Tạo hàng in cho tờ nhỏ')
    $created = $true
    Write-Host "Đã tạo hàng in cho tờ nhỏ: $stripName"
    # Same printer/driver: start both queues with the same quality and ICM options.
    # Existing queues keep their calibrated settings when the installer is run again.
    try {
      $mainSettings = Get-PrintConfiguration -PrinterName $main.Name
      Set-PrintConfiguration -PrinterName $stripName -PrintTicketXml $mainSettings.PrintTicketXML
    } catch { Write-Log "Cannot copy initial print settings to strip queue: $($_.Exception.Message)" }
  } else {
    Write-Host "Đã có hàng in cho tờ nhỏ: $stripName"
  }
  Write-Host 'Đang thử tự bật cắt đôi 2 inch cho tờ nhỏ...'
  $cut = 'queue'
  if (Set-TwoInchCut $stripName $true) {
    $cut = 'auto'
    # Hàng in chính không cắt: tờ to ra nguyên tờ 10 × 15.
    [void](Set-TwoInchCut $main.Name $false)
  } elseif ($created -or -not (Test-Path -LiteralPath $ConfigPath)) {
    Show-Message ("Bước cuối (chỉ làm 1 lần): bật cắt đôi cho tờ nhỏ.`n`nBấm OK, cửa sổ cài đặt in của hàng " +
      "'$stripName' sẽ mở ra:`n  Advanced… (Nâng cao) → Printer Features → 2inch cut → Enable → OK → OK.`n`n" +
      "Hàng in '$($main.Name)' giữ nguyên (2inch cut = Disable) để tờ to in nguyên tờ.")
    Start-Process -FilePath 'rundll32.exe' -ArgumentList "printui.dll,PrintUIEntry /e /n `"$stripName`"" -Wait
  }
  $config = [ordered]@{
    api = [string]$setup.api; token = [string]$setup.token; room = [string]$setup.room
    printer = $main.Name; stripPrinter = $stripName; cut = $cut
  }
  $config | ConvertTo-Json | Set-Content -LiteralPath $ConfigPath -Encoding UTF8

  # Bật máy là chạy: lối tắt trong thư mục Startup của người dùng này.
  $startup = $env:NXC_STARTUP_DIR
  if (-not $startup) { $startup = [Environment]::GetFolderPath('Startup') }
  Set-Content -LiteralPath (Join-Path $startup 'NXC-May-in.bat') -Encoding ASCII -Value @(
    '@echo off',
    "start `"`" /min powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  )
  # Dừng bản đang chạy (cài lại / đổi phòng) rồi chạy bản mới ngay.
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*NXC-Printer*print-agent.ps1*' -and $_.CommandLine -notlike '*-Install*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`""
  )
  $cutText = if ($cut -eq 'auto') { 'đã tự bật cắt đôi 2 inch' } else { 'nhớ bật 2inch cut = Enable như hướng dẫn' }
  Show-Message ("Đã cài xong máy in DNP cho phòng '$($setup.room)'.`n`n" +
    "Tờ to: in nguyên tờ ở '$($main.Name)'.`nTờ nhỏ: in qua '$stripName' ($cutText).`n`n" +
    "Chương trình in chạy ẩn và tự chạy mỗi lần bật máy. Xem tình trạng ở Quản lý máy → Máy in tự động.")
}

if ($Diagnose) { Show-Diagnosis; return }
if ($Install) {
  # Nhật ký cài đặt (gửi cho kỹ thuật khi cài lỗi): %LOCALAPPDATA%\NXC-Printer\install.log
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ConfigPath) | Out-Null
    Start-Transcript -LiteralPath (Join-Path (Split-Path -Parent $ConfigPath) 'install.log') -Force | Out-Null
  } catch {}
  $failed = $false
  try { Install-Agent } catch {
    $failed = $true
    Write-Host ($_ | Out-String) -ForegroundColor Red
    Show-Message "Cài máy in không thành công: $($_.Exception.Message)" 'Error'
  }
  try { Stop-Transcript | Out-Null } catch {}
  if ($failed) { exit 1 }
  exit 0
}
Start-Agent
