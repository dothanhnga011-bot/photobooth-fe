# NXC Photobooth - chương trình in tự động cho máy DNP DS820 của phòng Polaroid / Selfbooth (từ 14/11): in các
# tờ 20 x 30 cm (8 x 12 inch, 2400 x 3600 px) khách gửi in từ điện thoại, như web Selfbooth. Chạy trên máy tính
# Windows cắm máy DS820. Cài bằng file "cai-may-in-ds820-*.bat" tải ở Quản lý máy → Cài máy chụp (phòng Polaroid).
# Chỉ dùng PowerShell có sẵn của Windows (không cần Node.js).
#
#   -Install   tìm máy DS820, lưu cấu hình và tự chạy mỗi lần bật máy.
#   -Diagnose  chỉ xem: máy in tìm thấy và các khổ giấy driver khai báo (không đổi gì).
#   (mặc định) mỗi 3 giây hỏi web có lệnh in 20 x 30 của phòng không, tải tờ in và in tràn lề khổ 8x12.
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
$AgentDir = Join-Path $env:LOCALAPPDATA 'NXC-Printer-DS820'
if (-not $ConfigPath) { $ConfigPath = Join-Path $AgentDir 'config.json' }
$LogPath = Join-Path (Split-Path -Parent $ConfigPath) 'print-agent.log'
$AgentPath = $PSCommandPath
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
    [void][System.Windows.Forms.MessageBox]::Show($text, 'NXC Photobooth - Máy in DNP DS820', 'OK', $icon)
  } catch {}
}

# Máy DS820 trong Windows: ưu tiên hàng in không để "Use printer offline", rồi tên ngắn nhất (hàng in gốc).
function Find-DS820 {
  $all = @(Get-Printer -ErrorAction SilentlyContinue)
  $found = @($all | Where-Object { ($_.DriverName -match 'DS-?820') -or ($_.Name -match 'DS-?820') })
  if ($found.Count -eq 0) { return $null }
  return $found | Sort-Object @{ Expression = { [bool]$_.WorkOffline } }, @{ Expression = { $_.Name.Length } } |
    Select-Object -First 1
}

# Khổ (8x12) = 8 x 12 inch = 20 x 30 cm (800 x 1200 phần trăm inch); driver có thể khai báo dọc hoặc ngang.
# Bỏ các khổ cắt đôi / cắt nhiều tờ (8x6 x2, 8x4 x3...) có cùng kích thước giấy. Như script in của Selfbooth.
function Find-Paper($settings) {
  return @($settings.PaperSizes | Where-Object {
    $short = [Math]::Min($_.Width, $_.Height); $long = [Math]::Max($_.Width, $_.Height)
    [Math]::Abs($short - 800) -lt 15 -and [Math]::Abs($long - 1200) -lt 15
  }) | Sort-Object { [bool]($_.PaperName -match 'x ?[23]|div|strip|cut') } | Select-Object -First 1
}

# In các tờ (đường dẫn tệp) ra máy DS820, mỗi tờ một trang 8x12 tràn lề. Tờ khác chiều với trang của máy in
# (vd. tờ ngang 30 x 20 trên trang dọc) thì xoay 90 độ cho kín khổ. Trả về tên khổ giấy đã dùng.
function Send-Sheets([string]$printerName, [string[]]$files, [string]$docName) {
  if ($DryRunDir) {
    New-Item -ItemType Directory -Force -Path $DryRunDir | Out-Null
    $safe = ($printerName -replace '[^A-Za-z0-9-]', '_')
    $n = 0
    foreach ($file in $files) {
      $n++
      Copy-Item -LiteralPath $file -Destination (Join-Path $DryRunDir ('{0}-{1}-{2}{3}' -f $docName, $n, $safe, [IO.Path]::GetExtension($file)))
    }
    return '8x12 (thử)'
  }
  Add-Type -AssemblyName System.Drawing
  $document = New-Object System.Drawing.Printing.PrintDocument
  $document.DocumentName = $docName
  $document.PrinterSettings.PrinterName = $printerName
  if (-not $document.PrinterSettings.IsValid) { throw "Không thấy hàng in '$printerName' trong Windows." }
  $document.PrintController = New-Object System.Drawing.Printing.StandardPrintController
  $paper = Find-Paper $document.PrinterSettings
  if (-not $paper) { throw 'Driver máy in chưa có khổ 20 x 30 cm (8x12). Kiểm tra driver DNP DS820.' }
  $document.DefaultPageSettings.PaperSize = $paper
  $document.DefaultPageSettings.Landscape = $false
  $document.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
  $script:sheetFiles = @($files)
  $script:sheetIndex = 0
  $document.add_PrintPage({
    param($sender, $event)
    $photo = [System.Drawing.Image]::FromFile($script:sheetFiles[$script:sheetIndex])
    try {
      $pageLandscape = $event.PageBounds.Width -gt $event.PageBounds.Height
      if (($photo.Width -gt $photo.Height) -ne $pageLandscape) { $photo.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone) }
      $event.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $event.Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $event.Graphics.TranslateTransform(-$event.PageSettings.HardMarginX, -$event.PageSettings.HardMarginY)
      $event.Graphics.DrawImage($photo, $event.PageBounds)
    } finally { $photo.Dispose() }
    $script:sheetIndex++
    $event.HasMorePages = $script:sheetIndex -lt $script:sheetFiles.Count
  })
  try { $document.Print() } finally { $document.Dispose() }
  return $paper.PaperName
}

function Read-Config {
  if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Chưa cài máy in: không thấy $ConfigPath. Chạy lại file cai-may-in-ds820-*.bat tải ở Quản lý máy."
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

$StatusNames = @{
  Normal = 'Sẵn sàng'; Offline = 'Mất kết nối (máy in tắt hoặc rút cáp USB)'; PaperOut = 'Hết giấy / hết mực'
  PaperJam = 'Kẹt giấy'; Paused = 'Hàng in đang tạm dừng'; Error = 'Máy in báo lỗi'; PaperProblem = 'Lỗi giấy'
  DoorOpen = 'Đang mở nắp'; NotAvailable = 'Không dùng được'; TonerLow = 'Sắp hết mực'
}

# Hàng in đang bật "Use printer offline": chưa nhận lệnh (lệnh chờ trên web, tự in khi tắt chế độ đó).
function Test-Offline {
  if ($DryRunDir) { return $false }
  $queue = Get-Printer -Name $script:Config.printer -ErrorAction SilentlyContinue
  return [bool]($queue -and $queue.WorkOffline)
}

# Máy in báo gì sau khi nhận tờ in: ghi vào kết quả để quản trị biết tờ còn nằm trong hàng in Windows.
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

# Tình trạng máy DS820 cho trang quản trị (Quản lý máy → Máy in tự động): sẵn sàng / mất kết nối / hết giấy…
function Send-Status {
  $printer = $null
  if (-not $DryRunDir) { $printer = Get-Printer -Name $script:Config.printer -ErrorAction SilentlyContinue }
  $ready = [bool]$DryRunDir; $state = 'Không thấy máy in DNP DS820 trong Windows'; $jobs = 0
  if ($DryRunDir) { $state = 'Sẵn sàng (chạy thử)' }
  if ($printer) {
    $raw = [string]$printer.PrinterStatus
    $state = $StatusNames[$raw]
    if (-not $state) { $state = $raw }
    $ready = ($raw -eq 'Normal') -and -not $printer.WorkOffline
    if ($printer.WorkOffline) { $state = 'Đang bật "Use printer offline" trong Windows' }
    $jobs = @(Get-PrintJob -PrinterName $script:Config.printer -ErrorAction SilentlyContinue).Count
  }
  [void](Invoke-Api 'POST' '/status' @{ dnp = @{
    printer = [string]$script:Config.printer; stripPrinter = ''; ready = [bool]$ready; state = [string]$state
    jobs = [int]$jobs; cut = 'none'
  } })
}

function Invoke-Job($job) {
  $config = $script:Config
  $dir = Join-Path $env:TEMP ('nxc-ds820-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $dir | Out-Null
  try {
    $files = @()
    foreach ($sheet in @($job.sheets)) {
      $file = Join-Path $dir ('{0}.{1}' -f $sheet.index, $sheet.extension)
      Invoke-WebRequest -Uri "$($config.api)/api/print-agent/jobs/$($job.id)/sheets/$($sheet.index)" `
        -Headers @{ Authorization = "Bearer $($config.token)"; 'X-Print-Lease' = $job.leaseId } `
        -OutFile $file -UseBasicParsing -TimeoutSec 180
      $copies = [Math]::Max(1, [int]$job.copies)
      for ($n = 0; $n -lt $copies; $n++) { $files += $file }
    }
    $paper = Send-Sheets $config.printer $files ("NXC-$($job.code)")
    return "Đã gửi $($files.Count) tờ 20 x 30 tới máy DNP DS820 ($paper).$(Get-PrinterProblem)"
  } finally {
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# Tự cập nhật lúc khởi động và mỗi 30 phút từ trang web (/downloads/print-agent-ds820.ps1): chỉ thay khi khác
# bản đang chạy, đọc được (không lỗi cú pháp) và đúng là chương trình in DS820.
function Update-Self {
  if ($Once -or $DryRunDir -or -not $AgentPath) { return $false }
  $temp = Join-Path $env:TEMP ('nxc-print-ds820-' + [guid]::NewGuid().ToString('N') + '.ps1')
  try {
    Invoke-WebRequest -Uri "$($script:Config.api)/downloads/print-agent-ds820.ps1" -OutFile $temp -UseBasicParsing -TimeoutSec 60
    $new = [IO.File]::ReadAllBytes($temp)
    if ($new.Length -lt 2000) { return $false }
    if ([Convert]::ToBase64String($new) -eq [Convert]::ToBase64String([IO.File]::ReadAllBytes($AgentPath))) { return $false }
    $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($temp, [ref]$null, [ref]$errors)
    $text = [Text.Encoding]::UTF8.GetString($new)
    if ($errors -or ($text -notmatch 'Update-Self') -or ($text -notmatch 'DS820')) {
      Write-Log 'Bản cập nhật tải về không hợp lệ — giữ bản đang chạy.'
      return $false
    }
    Copy-Item -LiteralPath $temp -Destination $AgentPath -Force
    Write-Log 'Đã tải bản mới của chương trình in DS820.'
    return $true
  } catch {
    Write-Log "Chưa kiểm tra được bản cập nhật: $($_.Exception.Message)"
    return $false
  } finally {
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
  }
}

function Restart-Agent {
  Write-Log 'Chạy lại chương trình in DS820 với bản mới.'
  try { $script:Mutex.ReleaseMutex() } catch {}
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', "`"$AgentPath`""
  )
  exit 0
}

function Start-Agent {
  $script:Config = Read-Config
  if (-not $Once) {
    $script:Mutex = New-Object System.Threading.Mutex($false, 'Local\NXC-Printer-DS820-Agent')
    if (-not $script:Mutex.WaitOne(15000)) { Write-Log 'Chương trình in DS820 đã đang chạy.'; return }
    if (Update-Self) { Restart-Agent }
  }
  $updateAt = Get-Date
  Write-Log "Bắt đầu nhận lệnh in 20 x 30 của phòng '$($script:Config.room)' → $($script:Config.printer)."
  $statusAt = [datetime]::MinValue
  $delay = 3
  while ($true) {
    try {
      if (-not $Once -and ((Get-Date) - $updateAt).TotalMinutes -ge 30) {
        $updateAt = Get-Date
        if (Update-Self) { Restart-Agent }
      }
      if (((Get-Date) - $statusAt).TotalSeconds -ge 60) {
        try { Send-Status } catch { Write-Log "Không báo được tình trạng máy in: $($_.Exception.Message)" }
        $statusAt = Get-Date
      }
      if (Test-Offline) {
        if (-not $script:WasOffline) { Write-Log "Hàng in '$($script:Config.printer)' đang bật 'Use printer offline': chưa nhận lệnh in." }
        $script:WasOffline = $true
        if ($Once) { break }
        Start-Sleep -Seconds 10
        continue
      }
      $script:WasOffline = $false
      $claim = Invoke-Api 'POST' '/claim' @{ printSizes = @('large') }
      $job = $claim.job
      if ($job) {
        $sent = $false
        try {
          $message = Invoke-Job $job
          $sent = $true
          Write-Log "Lệnh $($job.code): $message"
        } catch {
          $message = "Máy in DS820 không nhận lệnh: $($_.Exception.Message)"
          Write-Log "Lệnh $($job.code): $message"
        }
        if ($message.Length -gt 480) { $message = $message.Substring(0, 480) }
        [void](Invoke-Api 'POST' "/jobs/$($job.id)/complete" @{ leaseId = [string]$job.leaseId; sent = $sent; message = $message })
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
    if ($delay -gt 0) { Start-Sleep -Seconds $delay }
  }
}

function Show-Diagnosis {
  $main = Find-DS820
  if (-not $main) { Write-Host 'Không thấy máy DNP DS820 (driver / tên hàng in có "DS820").'; return }
  Write-Host "Máy in: $($main.Name) (driver $($main.DriverName), cổng $($main.PortName), trạng thái $($main.PrinterStatus))"
  Add-Type -AssemblyName System.Drawing
  $settings = New-Object System.Drawing.Printing.PrinterSettings
  $settings.PrinterName = $main.Name
  foreach ($paper in $settings.PaperSizes) { Write-Host ('  khổ: {0} ({1} x {2})' -f $paper.PaperName, $paper.Width, $paper.Height) }
  $paper = Find-Paper $settings
  Write-Host "  khổ dùng để in: $(if ($paper) { $paper.PaperName } else { 'KHÔNG CÓ 8x12 (20 x 30 cm)' })"
}

function Install-Agent {
  # Địa chỉ web, mã máy in và tên phòng nằm trong file cài (.bat) dạng base64, không qua dòng lệnh.
  $installer = $env:NXC_PRINT_INSTALLER
  if (-not $installer -or -not (Test-Path -LiteralPath $installer)) { throw 'Hãy chạy file cai-may-in-ds820-*.bat, không chạy trực tiếp file này.' }
  $payload = [regex]::Match([IO.File]::ReadAllText($installer), '(?m)^rem NXC_PRINT_CONFIG_BASE64:([A-Za-z0-9+/=]+)')
  if (-not $payload.Success) { throw 'File cài bị hỏng: tải lại ở Quản lý máy.' }
  $setup = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload.Groups[1].Value)) | ConvertFrom-Json
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ConfigPath) | Out-Null
  Write-Host "Cài máy in DNP DS820 cho phòng: $($setup.room)"
  $main = Find-DS820
  if (-not $main) {
    Show-Message ("Chưa thấy máy in DNP DS820 trong Windows.`n`nCắm máy in vào máy tính này, cài driver DS820 " +
      "(dnpphoto.com → Support → Drivers), bật máy in rồi chạy lại file cài.") 'Warning'
    exit 1
  }
  Write-Host "Máy in: $($main.Name) (driver $($main.DriverName), cổng $($main.PortName))"
  Add-Type -AssemblyName System.Drawing
  $settings = New-Object System.Drawing.Printing.PrinterSettings
  $settings.PrinterName = $main.Name
  if (-not (Find-Paper $settings)) {
    Show-Message ("Driver của '$($main.Name)' chưa có khổ giấy 20 x 30 cm (8x12).`n`nKiểm tra cuộn giấy / driver DS820 " +
      "(Printing Preferences → Paper Size: (8x12)) rồi chạy lại file cài.") 'Warning'
    exit 1
  }
  $config = [ordered]@{ api = [string]$setup.api; token = [string]$setup.token; room = [string]$setup.room; printer = $main.Name }
  $config | ConvertTo-Json | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
  # Bật máy là chạy: lối tắt trong thư mục Startup của người dùng này.
  $startup = $env:NXC_STARTUP_DIR
  if (-not $startup) { $startup = [Environment]::GetFolderPath('Startup') }
  Set-Content -LiteralPath (Join-Path $startup 'NXC-May-in-DS820.bat') -Encoding ASCII -Value @(
    '@echo off',
    "start `"`" /min powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  )
  # Dừng bản đang chạy (cài lại / đổi phòng) rồi chạy bản mới ngay.
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*NXC-Printer-DS820*print-agent-ds820.ps1*' -and $_.CommandLine -notlike '*-Install*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`""
  )
  Show-Message ("Đã cài xong máy in DNP DS820 cho phòng '$($setup.room)'.`n`nKhách gửi in từ điện thoại: máy in tự in " +
    "tờ 20 x 30 cm ở '$($main.Name)'.`n`nChương trình in chạy ẩn và tự chạy mỗi lần bật máy. Xem tình trạng ở " +
    "Quản lý máy → Máy in tự động.")
}

if ($Diagnose) { Show-Diagnosis; return }
if ($Install) {
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ConfigPath) | Out-Null
    Start-Transcript -LiteralPath (Join-Path (Split-Path -Parent $ConfigPath) 'install.log') -Force | Out-Null
  } catch {}
  $failed = $false
  try { Install-Agent } catch {
    $failed = $true
    Write-Host ($_ | Out-String) -ForegroundColor Red
    Show-Message "Cài máy in DS820 không thành công: $($_.Exception.Message)" 'Error'
  }
  try { Stop-Transcript | Out-Null } catch {}
  if ($failed) { exit 1 }
  exit 0
}
Start-Agent
