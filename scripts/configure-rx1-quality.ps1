param(
  [string[]]$PrinterNames = @('DS-RX1', 'DS-RX1 - cat doi 2x6'),
  [Parameter(Mandatory=$true)][string]$BackupDirectory
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Printing, ReachFramework
New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
$server = New-Object System.Printing.LocalPrintServer
foreach ($name in $PrinterNames) {
  $settings = Get-PrintConfiguration -PrinterName $name
  $safeName = $name -replace '[^\w.-]', '_'
  $backup = Join-Path $BackupDirectory ($safeName + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.xml')
  [IO.File]::WriteAllText($backup, $settings.PrintTicketXML, [Text.Encoding]::UTF8)
  $queue = $server.GetPrintQueue($name)
  $xml = @'
<psf:PrintTicket xmlns:psf="http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework" xmlns:psk="http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" version="1">
  <psf:Feature name="psk:PageResolution"><psf:Option><psf:ScoredProperty name="psk:ResolutionX"><psf:Value xsi:type="xsd:integer">600</psf:Value></psf:ScoredProperty><psf:ScoredProperty name="psk:ResolutionY"><psf:Value xsi:type="xsd:integer">600</psf:Value></psf:ScoredProperty></psf:Option></psf:Feature>
  <psf:Feature name="psk:PageColorManagement"><psf:Option name="psk:System"/></psf:Feature>
  <psf:Feature name="psk:PageICMRenderingIntent"><psf:Option name="psk:Photographs"/></psf:Feature>
</psf:PrintTicket>
'@
  $delta = New-Object System.Printing.PrintTicket(New-Object System.IO.MemoryStream(, [Text.Encoding]::UTF8.GetBytes($xml)))
  $base = New-Object System.Printing.PrintTicket(New-Object System.IO.MemoryStream(, [Text.Encoding]::UTF8.GetBytes($settings.PrintTicketXML)))
  $ticket = $queue.MergeAndValidatePrintTicket($base, $delta).ValidatedPrintTicket
  $reader = New-Object IO.StreamReader($ticket.GetXmlStream())
  try { $updated = $reader.ReadToEnd() } finally { $reader.Dispose() }
  Set-PrintConfiguration -PrinterName $name -PrintTicketXml $updated
  [xml]$actual = (Get-PrintConfiguration -PrinterName $name).PrintTicketXML
  $ns = New-Object Xml.XmlNamespaceManager($actual.NameTable)
  $ns.AddNamespace('psf', 'http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework')
  $resolution = $actual.SelectSingleNode('//psf:Feature[@name="psk:PageResolution"]', $ns)
  $color = $actual.SelectSingleNode('//psf:Feature[@name="psk:PageColorManagement"]/psf:Option', $ns)
  $values = @($resolution.SelectNodes('psf:Option/psf:ScoredProperty/psf:Value', $ns) | ForEach-Object { $_.InnerText })
  if (($values -join 'x') -ne '600x600' -or $color.GetAttribute('name') -ne 'psk:System') {
    Set-PrintConfiguration -PrinterName $name -PrintTicketXml $settings.PrintTicketXML
    throw "Driver did not retain HQ/ICM for '$name'; original settings restored."
  }
  Write-Output "$name : 600x600 dpi; ICM System; Photographs. Backup: $backup"
}
