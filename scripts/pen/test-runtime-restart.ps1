param([string]$InstalledExecutable, [string]$RuntimeDirectory = (Join-Path ([IO.Path]::GetTempPath()) 'zotero-pen-runtime-zotero-10-pen'))
$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskRuntimeDirectory = [IO.Path]::GetFullPath($RuntimeDirectory)
$taskProfile = Join-Path $taskRuntimeDirectory 'runtime-profile'
$taskData = Join-Path $taskRuntimeDirectory 'runtime-data'
$taskBuildName = (Get-Content -LiteralPath (Join-Path $taskRoot 'pen-build/current-build.txt') -Raw).Trim()
if ($taskBuildName -notmatch '^Zotero_win-x64(?:-[A-Za-z0-9]+)?$') { throw 'Invalid build selection.' }
$taskExecutable = Join-Path $taskRoot "pen-build/$taskBuildName/zotero.exe"
if ($InstalledExecutable) { $taskExecutable = [IO.Path]::GetFullPath($InstalledExecutable) }
if (!(Test-Path -LiteralPath $taskExecutable)) { throw 'Build the portable runtime first.' }
if (!(Test-Path -LiteralPath (Join-Path $taskRoot 'work/ink-persistence-fixture.json'))) { throw 'Run the main runtime test first.' }
if (Get-NetTCPConnection -LocalPort 11192 -State Listen -ErrorAction SilentlyContinue) { throw 'The isolated test port is in use.' }
if (Get-CimInstance Win32_Process -Filter "Name='zotero.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($taskProfile) }) { throw 'The isolated test profile is already open.' }
if (Select-String -LiteralPath (Join-Path $taskProfile 'user.js') -Pattern 'reader\.ink(?:Color|Size|Smoothing|Pressure)') { throw 'Ink preferences must not be forced by user.js for the restart check.' }
Push-Location $taskRoot
try {
    Start-Process -FilePath $taskExecutable -ArgumentList @('-no-remote','-purgecaches','-profile', ('"' + $taskProfile + '"'), '-datadir', ('"' + $taskData + '"'),'-debugger','-ZoteroDebugText','-ZoteroSkipBundledFiles') -WindowStyle Hidden -RedirectStandardOutput work/runtime-restart-stdout.log -RedirectStandardError work/runtime-restart-stderr.log
    & node scripts/pen/rdp.mjs scripts/pen/runtime-restart-test.js ('--runtime-dir=' + $taskRuntimeDirectory)
    if ($LASTEXITCODE -ne 0) { throw 'Runtime restart persistence checks failed.' }
}
finally {
    $taskClosingProcesses = Get-CimInstance Win32_Process -Filter "Name='zotero.exe'" |
        Where-Object { $_.ExecutablePath -eq $taskExecutable -and $_.CommandLine -and $_.CommandLine.Contains($taskProfile) }
    foreach ($taskProcess in $taskClosingProcesses) {
        Wait-Process -Id $taskProcess.ProcessId -Timeout 15 -ErrorAction SilentlyContinue
    }
    Get-CimInstance Win32_Process -Filter "Name='zotero.exe'" |
        Where-Object { $_.ExecutablePath -eq $taskExecutable -and $_.CommandLine -and $_.CommandLine.Contains($taskProfile) } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Pop-Location
}
