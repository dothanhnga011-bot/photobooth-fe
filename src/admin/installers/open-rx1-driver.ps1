# Open the installed RX1 driver's own UI under the current kiosk Windows account.
# This helper does not print, install a driver or write printer settings itself.
param([ValidateSet('preferences', 'properties')][string]$Mode = 'preferences')
$ErrorActionPreference = 'Stop'

function Open-Rx1DriverSettings {
  param([ValidateSet('preferences', 'properties')][string]$Mode)
  $queues = @(Get-Printer | Where-Object { $_.DriverName -match '(?i)RX1' } | Sort-Object -Property Name -Unique)
  if (-not $queues.Count) { throw 'No RX1 driver found. Run this file on the Windows PC connected to the RX1.' }
  # Check every queue before opening the first dialog. Never edit defaults mid-job.
  foreach ($queue in $queues) {
    if ($queue.Name -match '["\r\n\x00]') { throw 'The RX1 queue name contains unsupported characters.' }
    if (@(Get-PrintJob -PrinterName $queue.Name -ErrorAction Stop).Count) {
      throw "'$($queue.Name)' has pending jobs. Let them finish, then run this file again."
    }
  }
  $option = if ($Mode -eq 'preferences') { '/e' } else { '/p' }
  foreach ($queue in $queues) {
    Write-Host "Opening $Mode for: $($queue.Name)"
    Write-Host 'Close this driver dialog to continue to the next RX1 queue.'
    $arguments = 'printui.dll,PrintUIEntry {0} /n "{1}"' -f $option, $queue.Name
    $process = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\rundll32.exe') -ArgumentList $arguments -WindowStyle Normal -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Windows could not open the driver for '$($queue.Name)' (exit $($process.ExitCode))." }
  }
}

if ($MyInvocation.InvocationName -eq '.') { return }
Open-Rx1DriverSettings -Mode $Mode
