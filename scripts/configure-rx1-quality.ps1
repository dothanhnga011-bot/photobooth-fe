# Compatibility entry point. Colour setup no longer forces 600x600 dpi.
param([string[]]$PrinterNames = @(), [string]$BackupDirectory = '', [string]$RestoreBackup = '')
& (Join-Path $PSScriptRoot '..\src\admin\installers\configure-rx1-color.ps1') @PSBoundParameters
