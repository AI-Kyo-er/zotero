"""Back up the current library and install remembered ink tool settings."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import uuid
import zipfile


ROOT = Path(__file__).resolve().parents[2]
PROFILE = Path(r'C:\Users\world\AppData\Roaming\Zotero\Zotero\Profiles\x927jje8.default')
DATA = Path(r'D:\ZoteroData')
PROGRAM = Path(r'D:\Zotero\app\omni.ja')
BACKUP_ROOT = Path(r'D:\ZoteroBackups')
INK_PREFS = {
    'extensions.zotero.reader.inkColor', 'extensions.zotero.reader.inkSize',
    'extensions.zotero.reader.inkSmoothing', 'extensions.zotero.reader.inkPressure',
}
PREF_RE = re.compile(r'^user_pref\(("(?:[^"\\]|\\.)*"),\s*(.*?)\);\s*$')


def report(stage, **values):
    print(json.dumps(dict(stage=stage, **values), ensure_ascii=False), flush=True)


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(2 * 1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def require_closed():
    script = "@(Get-CimInstance Win32_Process -Filter \"Name='zotero.exe'\" | Where-Object { $_.ExecutablePath -eq 'D:\\Zotero\\zotero.exe' } | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress"
    result = subprocess.run(['powershell.exe', '-NoProfile', '-Command', script], check=True, capture_output=True, text=True)
    if result.stdout.strip() and json.loads(result.stdout):
        raise RuntimeError('Normally exit daily Zotero before installation; nothing changed')


def inventory(root):
    files, directories = {}, []
    for path in [root, *sorted(root.rglob('*'))]:
        if path.lstat().st_file_attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            raise RuntimeError('Refusing a redirected directory or file during backup')
        if path == root:
            continue
        relative = str(path.relative_to(root))
        if path.is_file():
            files[relative] = {'bytes': path.stat().st_size, 'sha256': sha(path)}
        elif path.is_dir():
            directories.append(relative)
        else:
            raise RuntimeError('Unsupported object in the backup tree')
    return {'files': files, 'directories': directories}


def preference_values(raw):
    values = {}
    for line in raw.decode('utf-8-sig').splitlines():
        match = PREF_RE.fullmatch(line)
        if match:
            values[json.loads(match.group(1))] = json.loads(match.group(2))
    return values


def remove_forced_ink_preferences(raw):
    lines, removed = [], []
    for line in raw.splitlines(keepends=True):
        match = PREF_RE.fullmatch(line.decode('utf-8-sig').rstrip('\r\n'))
        name = json.loads(match.group(1)) if match else None
        if name in INK_PREFS:
            removed.append(name)
        else:
            lines.append(line)
    return b''.join(lines), removed


def atomic_write(path, raw):
    temporary = path.with_name(path.name + '.' + str(uuid.uuid4()) + '.tmp')
    with temporary.open('xb') as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--build-name', default='Zotero_win-x64-v5')
    parser.add_argument('--date-label', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'Zotero_win-x64(?:-[A-Za-z0-9]+)?', args.build_name):
        raise RuntimeError('Invalid build name')
    if not re.fullmatch(r'\d{8}', args.date_label):
        raise RuntimeError('Invalid client date label')
    require_closed()
    for path in (PROFILE, DATA, PROGRAM, BACKUP_ROOT):
        if path.resolve() != path:
            raise RuntimeError('Unexpected path redirection')
    prefs_path = PROFILE / 'prefs.js'
    prefs_before = prefs_path.read_bytes()
    prefs = preference_values(prefs_before)
    if prefs.get('extensions.zotero.dataDir') != str(DATA) or prefs.get('extensions.zotero.useDataDir') is not True:
        raise RuntimeError('The personal data directory differs from the verified D: library')
    user_path = PROFILE / 'user.js'
    user_before = user_path.read_bytes() if user_path.exists() else None
    user_after, removed = remove_forced_ink_preferences(user_before or b'')
    source = ROOT / 'pen-build' / args.build_name / 'app' / 'omni.ja'
    with zipfile.ZipFile(source) as archive:
        if archive.testzip() is not None:
            raise RuntimeError('The built archive is damaged')
        host = archive.read('chrome/content/zotero/xpcom/reader.js')
        if not all(token in host for token in (b'onChangeInkColor:', b'onChangeInkSize:', b'_handleInkSizePrefChange')):
            raise RuntimeError('The built archive lacks the remembered ink settings bridge')
    data_before = inventory(DATA)
    profile_before = inventory(PROFILE)
    total = sum(row['bytes'] for row in data_before['files'].values()) + sum(row['bytes'] for row in profile_before['files'].values()) + PROGRAM.stat().st_size
    if shutil.disk_usage(BACKUP_ROOT).free < total + 512 * 1024 * 1024:
        raise RuntimeError('Not enough room for the verified backup')
    backup = BACKUP_ROOT / ('pen-settings-' + args.date_label + '-' + str(uuid.uuid4())[:8])
    backup.mkdir(exist_ok=False)
    manifest_path = backup / 'manifest.json'
    manifest = {
        'createdAt': datetime.now(timezone.utc).isoformat(), 'clientDate': args.date_label,
        'installedFile': str(PROGRAM), 'backup': str(backup / 'omni.ja.before'),
        'originalSHA256': sha(PROGRAM), 'profile': str(PROFILE), 'dataDirectory': str(DATA),
        'status': 'backing-up', 'dataInventory': data_before, 'profileInventory': profile_before,
        'removedUserJsPreferences': removed,
    }
    atomic_write(manifest_path, json.dumps(manifest, indent=2).encode('utf-8'))
    report('backing-up', backup=str(backup), libraryFiles=len(data_before['files']))
    shutil.copytree(DATA, backup / 'data', copy_function=shutil.copy2)
    shutil.copytree(PROFILE, backup / 'profile', copy_function=shutil.copy2)
    shutil.copy2(PROGRAM, backup / 'omni.ja.before')
    if inventory(backup / 'data') != data_before or inventory(backup / 'profile') != profile_before or sha(backup / 'omni.ja.before') != manifest['originalSHA256']:
        raise RuntimeError('The backup does not match; installation cancelled')
    if inventory(DATA) != data_before or inventory(PROFILE) != profile_before:
        raise RuntimeError('The library or profile changed during backup; installation cancelled')
    require_closed()
    manifest['status'] = 'backup-verified'
    atomic_write(manifest_path, json.dumps(manifest, indent=2).encode('utf-8'))
    report('backup-verified', backup=str(backup))
    overlay = ROOT / 'scripts' / 'pen' / 'install-program-overlay.py'
    subprocess.run([sys.executable, str(overlay), '--manifest', str(manifest_path), '--source', str(source)], check=True)
    try:
        if user_before is not None and user_after != user_before:
            atomic_write(user_path, user_after)
        after = inventory(PROFILE)
        unchanged_profile = {name: value for name, value in after['files'].items() if name != 'user.js'}
        expected_profile = {name: value for name, value in profile_before['files'].items() if name != 'user.js'}
        if unchanged_profile != expected_profile or inventory(DATA) != data_before:
            raise RuntimeError('Unexpected personal data or configuration changes')
    except Exception:
        subprocess.run([sys.executable, str(overlay), '--manifest', str(manifest_path), '--restore'], check=True)
        if user_before is not None:
            atomic_write(user_path, user_before)
        raise
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    manifest.update({
        'status': 'installed-and-personal-data-verified',
        'installedUserJsSHA256': sha(user_path) if user_path.exists() else None,
        'preservedLibraryFiles': len(data_before['files']),
        'preservedProfileFiles': len(unchanged_profile),
    })
    atomic_write(manifest_path, json.dumps(manifest, indent=2).encode('utf-8'))
    pointer = ROOT / 'work' / 'remembered-tools-installation.json'
    atomic_write(pointer, json.dumps({'manifest': str(manifest_path), 'backup': str(backup),
                                    'installedSHA256': manifest['installedSHA256']}, indent=2).encode('utf-8'))
    report('installed', manifest=str(manifest_path), backup=str(backup),
           preservedLibraryFiles=manifest['preservedLibraryFiles'], removedForcedPreferences=removed)


if __name__ == '__main__':
    main()
