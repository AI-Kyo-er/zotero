param(
    [string]$InstalledZotero = 'D:\Zotero',
    [ValidatePattern('^Zotero_win-x64(?:-[A-Za-z0-9]+)?$')]
    [string]$BuildName = 'Zotero_win-x64'
)
$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$taskRuntime = Join-Path $taskRoot "pen-build/$BuildName"
if (Get-CimInstance Win32_Process -Filter "Name='zotero.exe'" | Where-Object { $_.ExecutablePath -eq (Join-Path $taskRuntime 'zotero.exe') }) {
    throw 'This test build is running. Close it before rebuilding, or choose another -BuildName.'
}
$taskApplicationIni = Join-Path $InstalledZotero 'app/application.ini'
if (!(Test-Path -LiteralPath $taskApplicationIni) -or
    !(Select-String -LiteralPath $taskApplicationIni -Pattern '^Version=10\.0\.5$')) {
    throw 'This overlay build requires an installed Zotero 10.0.5 runtime.'
}
New-Item -ItemType Directory -Path $taskRuntime -Force | Out-Null
foreach ($taskFile in Get-ChildItem -LiteralPath $InstalledZotero -File) {
    Copy-Item -LiteralPath $taskFile.FullName -Destination $taskRuntime -Force
}
foreach ($taskDirectory in @('app','gmp-clearkey','integration')) {
    $taskSource = Join-Path $InstalledZotero $taskDirectory
    if (Test-Path -LiteralPath $taskSource) {
        Copy-Item -LiteralPath $taskSource -Destination $taskRuntime -Recurse -Force
    }
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskArchivePath = Join-Path $taskRuntime 'app/omni.ja'
$taskArchive = [System.IO.Compression.ZipFile]::Open($taskArchivePath, [System.IO.Compression.ZipArchiveMode]::Update)
try {
    # Flush startup caches belonging to the unmodified official JavaScript.
    foreach ($taskEntry in @($taskArchive.Entries | Where-Object FullName -Like 'startupCache/*')) {
        $taskEntry.Delete()
    }
    $taskReplacements = @{
        'chrome/content/zotero/xpcom/reader.js' = 'chrome/content/zotero/xpcom/reader.js'
    }
    # The packaged preferences also contain Gecko/platform defaults. Preserve
    # those defaults and append only the preferences introduced by this patch.
    $taskDefaultsStream = [System.IO.StreamReader]::new($taskArchive.GetEntry('defaults/preferences/zotero.js').Open())
    try { $taskDefaults = $taskDefaultsStream.ReadToEnd() }
    finally { $taskDefaultsStream.Dispose() }
    $taskNewPrefs = Get-Content -LiteralPath (Join-Path $taskRoot 'defaults/preferences/zotero.js') |
        Where-Object { $_ -match '^pref\("extensions\.zotero\.reader\.ink(Smoothing|Pressure|Size|Color)"' }
    # A later overlay may start from an already patched installed archive.
    $taskDefaults = $taskDefaults -replace '(?m)^pref\("extensions\.zotero\.reader\.ink(?:Smoothing|Pressure|Size|Color)"[^\r\n]*\r?\n?', ''
    $taskPrefsFile = Join-Path $taskRoot 'work/pen-preferences.js'
    New-Item -ItemType Directory -Path (Split-Path $taskPrefsFile) -Force | Out-Null
    [System.IO.File]::WriteAllText($taskPrefsFile, $taskDefaults + "`n" + ($taskNewPrefs -join "`n"), [System.Text.UTF8Encoding]::new($false))
    $taskReplacements['defaults/preferences/zotero.js'] = $taskPrefsFile
    foreach ($taskLocale in @('en-US','zh-CN','zh-TW')) {
        $taskSource = "chrome/locale/$taskLocale/zotero/reader.ftl"
        $taskReplacements[$taskSource] = $taskSource
        $taskReplacements["localization/$taskLocale/reader.ftl"] = $taskSource
    }
    $taskReaderBuild = Join-Path $taskRoot 'reader/build/zotero'
    if (!(Test-Path -LiteralPath (Join-Path $taskReaderBuild 'reader.js'))) {
        throw 'Build the reader first: npx webpack --config-name zotero'
    }
    foreach ($taskFile in Get-ChildItem -LiteralPath $taskReaderBuild -File -Recurse) {
        $taskRelative = [System.IO.Path]::GetRelativePath($taskReaderBuild, $taskFile.FullName).Replace('\','/')
        $taskReplacements["resource/reader/$taskRelative"] = $taskFile.FullName
    }
    # webpack preserves the PDF.js bundle; its CSS is copied separately by
    # pdfjs/build. Include the current source when only that CSS changes.
    $taskReplacements['resource/reader/pdf/web/viewer.css'] = Join-Path $taskRoot 'reader/pdfjs/viewer.css'
    foreach ($taskName in $taskReplacements.Keys) {
        $taskOldEntry = $taskArchive.GetEntry($taskName)
        if ($taskOldEntry) { $taskOldEntry.Delete() }
        $taskSource = $taskReplacements[$taskName]
        if (![System.IO.Path]::IsPathRooted($taskSource)) { $taskSource = Join-Path $taskRoot $taskSource }
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($taskArchive, $taskSource, $taskName) | Out-Null
    }
}
finally { $taskArchive.Dispose() }
[System.IO.File]::WriteAllText((Join-Path $taskRoot 'pen-build/current-build.txt'), $BuildName)
Write-Output "Portable test runtime: $taskRuntime"
