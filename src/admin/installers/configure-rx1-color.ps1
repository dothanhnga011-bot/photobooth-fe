# Configure RX1 ICM without changing resolution, media, cutter or ICC associations.
param(
  [string[]]$PrinterNames = @(),
  [string]$BackupDirectory = '',
  [string]$RestoreBackup = ''
)
$ErrorActionPreference = 'Stop'

function Read-ColorTicketXml($ticket) {
  if ($null -eq $ticket) { return $null }
  if ($ticket -is [string]) { return $ticket }
  $reader = New-Object IO.StreamReader($ticket.GetXmlStream())
  try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}
function New-ColorTicket([string]$xml) {
  return New-Object System.Printing.PrintTicket(New-Object IO.MemoryStream(, [Text.Encoding]::UTF8.GetBytes($xml)))
}
function Test-ColorTicket($ticket) {
  if ($null -eq $ticket) { return $false }
  [xml]$xml = Read-ColorTicketXml $ticket
  $ns = New-Object Xml.XmlNamespaceManager($xml.NameTable)
  $ns.AddNamespace('psf', 'http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework')
  $wanted = @{ PageColorManagement = 'System'; PageICMRenderingIntent = 'Photographs'; PageOutputColor = 'Color' }
  foreach ($feature in $xml.SelectNodes('//psf:Feature', $ns)) {
    $parts = $feature.GetAttribute('name').Split(':', 2)
    if ($parts.Count -ne 2 -or $feature.GetNamespaceOfPrefix($parts[0]) -ne 'http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords') { continue }
    if (-not $wanted.ContainsKey($parts[1])) { continue }
    $option = $feature.SelectSingleNode('psf:Option', $ns)
    if ($null -eq $option) { return $false }
    $value = $option.GetAttribute('name').Split(':', 2)
    if ($value.Count -ne 2 -or $option.GetNamespaceOfPrefix($value[0]) -ne 'http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords' -or $value[1] -ne $wanted[$parts[1]]) { return $false }
    $wanted.Remove($parts[1])
  }
  return $wanted.Count -eq 0
}
function Restore-ColorStates([object[]]$states) {
  $failures = @()
  foreach ($state in $states) {
    try {
      $state.queue.DefaultPrintTicket = New-ColorTicket $state.default
      if ($null -ne $state.user) { $state.queue.UserPrintTicket = New-ColorTicket $state.user }
      $state.queue.Commit()
    } catch { $failures += "$($state.name): $($_.Exception.Message)" }
  }
  if ($failures.Count) { throw ('Could not restore: ' + ($failures -join '; ')) }
}
function Test-PreservedPrintSettings($before, $after) {
  $snapshots = @()
  foreach ($ticket in @($before, $after)) {
    [xml]$xml = Read-ColorTicketXml $ticket
    $ns = New-Object Xml.XmlNamespaceManager($xml.NameTable)
    $ns.AddNamespace('psf', 'http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework')
    $snapshot = @{}
    foreach ($feature in $xml.SelectNodes('//psf:Feature', $ns)) {
      $name = $feature.GetAttribute('name')
      $labels = $feature.SelectNodes('psf:Property/psf:Value', $ns) | ForEach-Object { $_.InnerText }
      if (($name + ' ' + ($labels -join ' ')) -notmatch 'Resolution|MediaSize|Orientation|Borderless|Cut|Finish|Overcoat') { continue }
      $parts = $name.Split(':', 2)
      $key = $feature.GetNamespaceOfPrefix($parts[0]) + ':' + $parts[-1]
      $values = @($feature.SelectNodes('.//psf:Option | .//psf:ScoredProperty | .//psf:ParameterRef | .//psf:Value', $ns) | ForEach-Object {
        if ($_.LocalName -eq 'Value') { $_.InnerText.Trim() }
        else {
          $parts = $_.GetAttribute('name').Split(':', 2)
          $_.LocalName + ':' + $_.GetNamespaceOfPrefix($parts[0]) + ':' + $parts[-1]
        }
      })
      $snapshot[$key] = $values -join '|'
    }
    $snapshots += ,$snapshot
  }
  foreach ($key in $snapshots[0].Keys) {
    if (-not $snapshots[1].ContainsKey($key) -or $snapshots[0][$key] -ne $snapshots[1][$key]) { return $false }
  }
  return $true
}
function Set-Rx1QueueColor([object[]]$queues, [string]$backup) {
  if (Test-Path -LiteralPath (Join-Path $backup 'color-settings.json')) { throw 'Backup already exists. Choose a new backup directory.' }
  $delta = New-ColorTicket @'
<psf:PrintTicket xmlns:psf="http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework" xmlns:psk="http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords" version="1">
  <psf:Feature name="psk:PageColorManagement"><psf:Option name="psk:System"/></psf:Feature>
  <psf:Feature name="psk:PageICMRenderingIntent"><psf:Option name="psk:Photographs"/></psf:Feature>
  <psf:Feature name="psk:PageOutputColor"><psf:Option name="psk:Color"/></psf:Feature>
</psf:PrintTicket>
'@
  # Validate both scopes on ALL queues before the first write. A null user ticket
  # inherits Printing Defaults and must not become a new per-user override.
  $states = @(); $planned = @()
  foreach ($queue in $queues) {
    $originalDefault = $queue.DefaultPrintTicket
    $originalUser = $queue.UserPrintTicket
    if ($null -eq $originalDefault) { throw "No default PrintTicket for '$($queue.Name)'." }
    $nextDefault = $queue.MergeAndValidatePrintTicket($originalDefault, $delta).ValidatedPrintTicket
    $nextUser = $null
    if ($null -ne $originalUser) { $nextUser = $queue.MergeAndValidatePrintTicket($originalUser, $delta).ValidatedPrintTicket }
    if (-not (Test-ColorTicket $nextDefault) -or ($null -ne $originalUser -and -not (Test-ColorTicket $nextUser))) {
      throw "Driver did not accept System ICM / Pictures / Color for '$($queue.Name)'. No settings changed."
    }
    if (-not (Test-PreservedPrintSettings $originalDefault $nextDefault) -or ($null -ne $originalUser -and -not (Test-PreservedPrintSettings $originalUser $nextUser))) {
      throw "Driver would change resolution, media, cutter or finish for '$($queue.Name)'. No settings changed."
    }
    $states += @{ queue = $queue; name = $queue.Name; default = (Read-ColorTicketXml $originalDefault); user = (Read-ColorTicketXml $originalUser) }
    $planned += @{ default = $nextDefault; user = $nextUser }
  }
  New-Item -ItemType Directory -Path $backup -Force | Out-Null
  $saved = @($states | ForEach-Object { @{ name = $_.name; default = $_.default; user = $_.user } })
  @{ account = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value; queues = $saved } |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $backup 'color-settings.json') -Encoding UTF8
  $touched = @()
  try {
    for ($i = 0; $i -lt $states.Count; $i++) {
      $state = $states[$i]; $next = $planned[$i]
      $touched += $state
      $state.queue.DefaultPrintTicket = $next.default
      if ($null -ne $next.user) { $state.queue.UserPrintTicket = $next.user }
      $state.queue.Commit()
      $state.queue.Refresh()
      $user = $state.queue.UserPrintTicket
      if (-not (Test-ColorTicket $state.queue.DefaultPrintTicket) -or ($null -ne $user -and -not (Test-ColorTicket $user))) {
        throw "Driver did not retain ICM for '$($state.name)'."
      }
      if (-not (Test-PreservedPrintSettings $state.default $state.queue.DefaultPrintTicket) -or ($null -ne $state.user -and -not (Test-PreservedPrintSettings $state.user $user))) {
        throw "Driver changed print size, resolution, cutter or finish for '$($state.name)'."
      }
    }
  } catch {
    $failure = $_.Exception.Message
    try { Restore-ColorStates $touched } catch { throw "$failure. Rollback failed: $($_.Exception.Message). Backup: $backup" }
    throw "$failure. Previous settings restored. Backup: $backup"
  }
}

# Dot-sourcing exposes the functions for tests without touching Windows queues.
if ($MyInvocation.InvocationName -eq '.') { return }
Add-Type -AssemblyName System.Printing, ReachFramework
$server = New-Object System.Printing.LocalPrintServer
$queues = @()
try {
  if ($RestoreBackup) {
    $saved = Get-Content -LiteralPath (Join-Path $RestoreBackup 'color-settings.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($saved.account -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { throw 'Restore using the same Windows account that created the backup.' }
    $PrinterNames = @($saved.queues | ForEach-Object { $_.name })
  } elseif (-not $PrinterNames.Count) {
    $PrinterNames = @(Get-Printer | Where-Object { $_.DriverName -match '(?i)RX1' } | ForEach-Object { $_.Name })
  }
  if (-not $PrinterNames.Count) { throw 'No DNP RX1 driver found. Run this file on the PC connected to the RX1.' }
  foreach ($name in $PrinterNames) {
    $printer = Get-Printer -Name $name
    if ($printer.DriverName -notmatch '(?i)RX1') { throw "'$name' is not using an RX1 driver." }
    if (@(Get-PrintJob -PrinterName $name).Count) { throw "'$name' has pending jobs. Let them finish before changing colour settings." }
    $queues += New-Object System.Printing.PrintQueue($server, $name, [System.Printing.PrintSystemDesiredAccess]::AdministratePrinter)
  }
  if ($RestoreBackup) {
    $states = @()
    foreach ($queue in $queues) {
      $row = $saved.queues | Where-Object { $_.name -eq $queue.Name } | Select-Object -First 1
      $states += @{ queue = $queue; name = $queue.Name; default = $row.default; user = $row.user }
    }
    Restore-ColorStates $states
    Write-Host 'Previous RX1 colour settings restored.'
  } else {
    if (-not $BackupDirectory) { $BackupDirectory = Join-Path $env:LOCALAPPDATA ('NXC-Printer\color-backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff')) }
    Set-Rx1QueueColor $queues $BackupDirectory
    Write-Host 'Configured System ICM / Pictures / Color for Printing Defaults and existing user Preferences:'
    $PrinterNames | ForEach-Object { Write-Host "  $_" }
    Write-Host "Backup: $BackupDirectory"
    Write-Host 'Resolution, paper, cutter, finish and ICC associations were preserved.'
    Write-Host 'Check Color Management > Devices: both RX1 queues need the correct RX1/media ICC profile.'
    Write-Host 'Print the SAME photo through the kiosk to verify. This tool does not calibrate paper or screen colours.'
  }
} finally {
  foreach ($queue in $queues) { $queue.Dispose() }
  $server.Dispose()
}
