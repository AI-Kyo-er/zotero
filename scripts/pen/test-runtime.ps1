param([switch]$RecordInput, [string]$InstalledExecutable, [ValidateSet('Platform','NativeFine')][string]$PenInputPath = 'Platform', [ValidateSet('1.0','2.0')][string]$InkSize = '2.0')
$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskProfile = Join-Path $taskRoot 'work/runtime-profile'
$taskData = Join-Path $taskRoot 'work/runtime-data'
$taskBuildName = 'Zotero_win-x64'
$taskBuildSelection = Join-Path $taskRoot 'pen-build/current-build.txt'
if (Test-Path -LiteralPath $taskBuildSelection) { $taskBuildName = (Get-Content -LiteralPath $taskBuildSelection -Raw).Trim() }
if ($taskBuildName -notmatch '^Zotero_win-x64(?:-[A-Za-z0-9]+)?$') { throw 'Invalid build selection.' }
$taskExecutable = Join-Path $taskRoot "pen-build/$taskBuildName/zotero.exe"
if ($InstalledExecutable) { $taskExecutable = [IO.Path]::GetFullPath($InstalledExecutable) }
if (!(Test-Path -LiteralPath $taskExecutable)) { throw 'Build the portable runtime first.' }
if (!(Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 22 or newer is required.' }
if (Get-NetTCPConnection -LocalPort 11192 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Port 11192 is in use. Close the previous runtime test before continuing.'
}
New-Item -ItemType Directory -Path $taskProfile,$taskData -Force | Out-Null
@'
user_pref("extensions.zotero.firstRun", false);
user_pref("extensions.zotero.sync.autoSync", false);
user_pref("app.update.auto", false);
user_pref("app.update.enabled", false);
user_pref("devtools.debugger.remote-enabled", true);
user_pref("devtools.chrome.enabled", true);
user_pref("devtools.debugger.prompt-connection", false);
user_pref("devtools.debugger.remote-port", 11192);
user_pref("devtools.debugger.force-local", true);
user_pref("intl.locale.requested", "zh-CN");
'@ | Set-Content -LiteralPath (Join-Path $taskProfile 'user.js') -Encoding utf8
'user_pref("dom.w3c_pointer_events.scroll_by_pen.enabled", true);' | Add-Content -LiteralPath (Join-Path $taskProfile 'user.js') -Encoding utf8
$taskMoveTolerance = if ($PenInputPath -eq 'NativeFine') { '0.0' } else { '0.1' }
('user_pref("apz.touch_move_tolerance", "' + $taskMoveTolerance + '");') | Add-Content -LiteralPath (Join-Path $taskProfile 'user.js') -Encoding utf8
'user_pref("apz.touch_start_tolerance", "0.1");' | Add-Content -LiteralPath (Join-Path $taskProfile 'user.js') -Encoding utf8
# Ink preferences are seeded by the test, not forced by user.js, so that
# the same profile can verify persistence across a fresh process start.
Push-Location $taskRoot
try {
    Start-Process -FilePath $taskExecutable -ArgumentList @('-no-remote','-purgecaches','-profile', ('"' + $taskProfile + '"'), '-datadir', ('"' + $taskData + '"'),'-debugger','-ZoteroDebugText','-ZoteroSkipBundledFiles') -WindowStyle Hidden -RedirectStandardOutput work/runtime-stdout.log -RedirectStandardError work/runtime-stderr.log
    $taskTestArguments = @('scripts/pen/rdp.mjs', 'scripts/pen/runtime-test.js')
    $taskTestArguments += ('--ink-size=' + $InkSize)
    if ($RecordInput) { $taskTestArguments += '--record' }
    if ($PenInputPath -eq 'NativeFine') { $taskTestArguments += '--native-fine' }
    & node @taskTestArguments
    if ($LASTEXITCODE -ne 0) { throw 'Runtime integration checks failed. See work/runtime-results.json.' }
}
finally {
    # Close only the copied test runtime using this test's isolated profile.
    # Successful tests request a normal shutdown so preferences are flushed.
    $taskClosingProcesses = Get-CimInstance Win32_Process -Filter "Name='zotero.exe'" |
        Where-Object { $_.ExecutablePath -eq $taskExecutable -and $_.CommandLine.Contains($taskProfile) }
    foreach ($taskProcess in $taskClosingProcesses) {
        Wait-Process -Id $taskProcess.ProcessId -Timeout 15 -ErrorAction SilentlyContinue
    }
    Get-CimInstance Win32_Process -Filter "Name='zotero.exe'" |
        Where-Object { $_.ExecutablePath -eq $taskExecutable -and $_.CommandLine.Contains($taskProfile) } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Pop-Location
}
