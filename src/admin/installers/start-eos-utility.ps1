param([string]$ExecutablePath = '')

$ErrorActionPreference = 'Stop'
$directory = Join-Path $env:LOCALAPPDATA 'NXC-Kiosk'
New-Item -ItemType Directory -Path $directory -Force | Out-Null
try {
  if (Get-Process -Name 'EOS Utility', 'EOS Utility 3', 'EOSUtility', 'EOSUtility3' -ErrorAction SilentlyContinue) { exit 0 }
  $candidates = @($ExecutablePath)
  foreach ($base in @(${env:ProgramFiles(x86)}, $env:ProgramFiles)) {
    if (-not $base) { continue }
    foreach ($relative in @('Canon\EOS Utility\EOS Utility.exe', 'Canon\EOS Utility\EOS Utility 3.exe', 'Canon\EOS Utility\EOS Utility3\EOS Utility 3.exe')) {
      $candidates += Join-Path $base $relative
    }
  }
  $exe = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
  if (-not $exe) { throw 'EOS Utility was not found. Install EOS Utility for EOS R100, or set -ExecutablePath.' }
  New-Item -ItemType Directory -Path 'C:\PhotoBooth\Canon' -Force | Out-Null
  # Set Destination Folder and Remote shooting once in EOS Utility itself.
  Start-Process -FilePath $exe -WorkingDirectory (Split-Path -Parent $exe) -WindowStyle Hidden
  "$(Get-Date -Format o) Started EOS Utility" | Out-File -LiteralPath (Join-Path $directory 'eos-utility-start.log') -Append -Encoding utf8
} catch {
  "$(Get-Date -Format o) $($_.Exception.Message)" | Out-File -LiteralPath (Join-Path $directory 'eos-utility-start.log') -Append -Encoding utf8
  exit 1
}
