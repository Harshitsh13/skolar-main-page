<#
  Installs the SKOLAR Studio worker as a Windows Task Scheduler task.

  Usage (from the project folder, normal PowerShell — no admin needed for "AtLogOn"):
    powershell -ExecutionPolicy Bypass -File scripts\worker\install-windows.ps1
    powershell -ExecutionPolicy Bypass -File scripts\worker\install-windows.ps1 -Trigger AtStartup   # needs admin
    powershell -ExecutionPolicy Bypass -File scripts\worker\install-windows.ps1 -Uninstall

  The project path is detected from this script's location — nothing is hard-coded.
  The worker itself prevents duplicates (PID lock + database lease), and restarts
  automatically if it exits with an error.
#>
param(
  [ValidateSet("AtLogOn", "AtStartup")] [string]$Trigger = "AtLogOn",
  [string]$TaskName = "SKOLAR Studio Worker",
  [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Removed scheduled task '$TaskName'."
  } else {
    Write-Host "Task '$TaskName' is not installed."
  }
  exit 0
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "Node.js was not found in PATH. Install Node.js 20+ first." }
$tsxCli = Join-Path $ProjectRoot "node_modules\tsx\dist\cli.mjs"
if (-not (Test-Path $tsxCli)) { throw "Dependencies missing. Run 'npm install' in $ProjectRoot first." }
$entry = Join-Path $ProjectRoot "scripts\studio-worker.mts"

$action = New-ScheduledTaskAction -Execute $node -Argument "`"$tsxCli`" `"$entry`"" -WorkingDirectory $ProjectRoot
$trig = if ($Trigger -eq "AtStartup") { New-ScheduledTaskTrigger -AtStartup } else { New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME }
# Give the network a moment after logon/boot.
$trig.Delay = "PT1M"
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 5) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew

if ($Trigger -eq "AtStartup") {
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited
} else {
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trig -Settings $settings -Principal $principal `
  -Description "SKOLAR Studio background worker: research, drafts, source monitoring and scheduled publishing." -Force | Out-Null

Write-Host "Installed '$TaskName' ($Trigger) for $ProjectRoot"
Write-Host "Start it now:   Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Logs:           $ProjectRoot\.studio-data\logs\"
