$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskProfile = Join-Path $taskRoot 'pen-profile'
$taskData = Join-Path $taskRoot 'pen-data'
New-Item -ItemType Directory -Path $taskProfile,$taskData -Force | Out-Null
$taskPrefs = Join-Path $taskProfile 'user.js'
if (!(Test-Path -LiteralPath $taskPrefs)) {
@'
user_pref("extensions.zotero.firstRun", false);
user_pref("extensions.zotero.sync.autoSync", false);
user_pref("app.update.auto", false);
user_pref("app.update.enabled", false);
user_pref("intl.locale.requested", "zh-CN");
'@ | Set-Content -LiteralPath $taskPrefs -Encoding utf8
}
$taskSavedPrefs = Join-Path $taskProfile 'prefs.js'
if (!(Test-Path -LiteralPath $taskSavedPrefs)) {
@'
user_pref("extensions.zotero.reader.inkSmoothing", false);
user_pref("extensions.zotero.reader.inkPressure", false);
'@ | Set-Content -LiteralPath $taskSavedPrefs -Encoding utf8
}
$taskExecutable = Join-Path $taskRoot 'pen-build/Zotero_win-x64/zotero.exe'
if (!(Test-Path -LiteralPath $taskExecutable)) { throw 'Run build-portable.ps1 first.' }
Start-Process -FilePath $taskExecutable -ArgumentList @('-no-remote','-purgecaches','-profile', ('"' + $taskProfile + '"'), '-datadir', ('"' + $taskData + '"')) -WindowStyle Normal
Write-Output 'Started the pen test build with an independent profile and data directory.'
