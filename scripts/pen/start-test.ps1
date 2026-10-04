param([switch]$RecordInput)
$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskProfile = Join-Path $taskRoot 'pen-profile'
$taskData = Join-Path $taskRoot 'pen-data'
if (Get-CimInstance Win32_Process -Filter "Name='zotero.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($taskProfile) }) {
    throw 'Close the previous pen test window before starting another build with this profile.'
}
New-Item -ItemType Directory -Path $taskProfile,$taskData -Force | Out-Null
$taskPrefs = Join-Path $taskProfile 'user.js'
@'
user_pref("extensions.zotero.firstRun", false);
user_pref("extensions.zotero.sync.autoSync", false);
user_pref("app.update.auto", false);
user_pref("app.update.enabled", false);
user_pref("intl.locale.requested", "zh-CN");
'@ | Set-Content -LiteralPath $taskPrefs -Encoding utf8
# Restore the platform default in test profiles used for the retired comparison.
'user_pref("dom.w3c_pointer_events.scroll_by_pen.enabled", true);' | Add-Content -LiteralPath $taskPrefs -Encoding utf8
if ($RecordInput) {
    if (!(Get-Command node -ErrorAction SilentlyContinue)) { throw 'Input recording requires Node.js.' }
    @'
user_pref("devtools.debugger.remote-enabled", true);
user_pref("devtools.chrome.enabled", true);
user_pref("devtools.debugger.prompt-connection", false);
user_pref("devtools.debugger.remote-port", 11192);
user_pref("devtools.debugger.force-local", true);
'@ | Add-Content -LiteralPath $taskPrefs -Encoding utf8
}
else {
    'user_pref("devtools.debugger.remote-enabled", false);' | Add-Content -LiteralPath $taskPrefs -Encoding utf8
}
$taskSavedPrefs = Join-Path $taskProfile 'prefs.js'
if (!(Test-Path -LiteralPath $taskSavedPrefs)) {
@'
user_pref("extensions.zotero.reader.inkSmoothing", false);
user_pref("extensions.zotero.reader.inkPressure", false);
'@ | Set-Content -LiteralPath $taskSavedPrefs -Encoding utf8
}
$taskBuildName = 'Zotero_win-x64'
$taskBuildSelection = Join-Path $taskRoot 'pen-build/current-build.txt'
if (Test-Path -LiteralPath $taskBuildSelection) { $taskBuildName = (Get-Content -LiteralPath $taskBuildSelection -Raw).Trim() }
if ($taskBuildName -notmatch '^Zotero_win-x64(?:-[A-Za-z0-9]+)?$') { throw 'Invalid build selection.' }
$taskExecutable = Join-Path $taskRoot "pen-build/$taskBuildName/zotero.exe"
if (!(Test-Path -LiteralPath $taskExecutable)) { throw 'Run build-portable.ps1 first.' }
$taskArguments = @('-no-remote','-purgecaches','-profile', ('"' + $taskProfile + '"'), '-datadir', ('"' + $taskData + '"'))
if ($RecordInput) { $taskArguments += '-debugger' }
Start-Process -FilePath $taskExecutable -ArgumentList $taskArguments -WindowStyle Normal
if ($RecordInput) {
    Push-Location $taskRoot
    try {
        New-Item -ItemType Directory -Path work -Force | Out-Null
        node scripts/pen/rdp.mjs scripts/pen/record-input.js
        if ($LASTEXITCODE -ne 0) { throw 'Failed to install input recording.' }
    }
    finally { Pop-Location }
}
Write-Output 'Started the pen test build with an independent profile and data directory.'
