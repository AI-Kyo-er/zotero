"""Replace only the installed program archive, using a verified rollback copy."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import uuid
import zipfile
from datetime import datetime, timezone


def sha(path):
    with path.open("rb") as stream:
        result = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
        return result.hexdigest()


def require_closed(target):
    executable = target.parent.parent / "zotero.exe"
    environment = dict(os.environ, ZOTERO_PEN_INSTALLED_EXE=str(executable))
    result = subprocess.run(["powershell.exe", "-NoProfile", "-Command",
        "$ErrorActionPreference='Stop'; $taskProcesses=@(Get-CimInstance Win32_Process -Filter \"Name='zotero.exe'\" | Where-Object {$_.ExecutablePath -eq $env:ZOTERO_PEN_INSTALLED_EXE}); Write-Output $taskProcesses.Count"],
        env=environment, check=True, text=True, capture_output=True)
    if int(result.stdout.strip()):
        raise RuntimeError("Exit the installed Zotero normally before replacing its program archive")


def replace(source, target, expected):
    temporary = target.with_name("omni.ja.pen-overlay-" + str(uuid.uuid4()) + ".tmp")
    # One exact file in the explicitly selected installed app directory.
    shutil.copy2(source, temporary)
    if sha(temporary) != expected:
        raise RuntimeError("Staged archive verification failed; installed archive is unchanged")
    os.replace(temporary, target)
    if sha(target) != expected:
        raise RuntimeError("Installed archive verification failed")


parser = argparse.ArgumentParser()
parser.add_argument("--manifest", required=True, type=Path)
parser.add_argument("--source", type=Path)
parser.add_argument("--restore", action="store_true")
args = parser.parse_args()
manifest_path = args.manifest.resolve(strict=True)
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
target = Path(manifest["installedFile"]).resolve(strict=True)
backup = Path(manifest["backup"]).resolve(strict=True)
if target != Path("D:/Zotero/app/omni.ja").resolve(strict=True):
    raise RuntimeError("Unexpected installation target")
if sha(backup) != manifest["originalSHA256"]:
    raise RuntimeError("Original program backup verification failed")
require_closed(target)
if args.restore:
    if manifest.get("status") == "restored":
        print("The previous program archive has already been restored")
        raise SystemExit(0)
    if sha(target) != manifest.get("installedSHA256"):
        raise RuntimeError("Installed program has changed since this overlay; leaving it intact for review")
    replace(backup, target, manifest["originalSHA256"])
    manifest["status"] = "restored"
else:
    if not args.source:
        parser.error("Provide --source or --restore")
    source = args.source.resolve(strict=True)
    if source == target or sha(target) != manifest["originalSHA256"]:
        raise RuntimeError("Installed archive changed after backup; leaving it intact for review")
    with zipfile.ZipFile(source) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("Replacement archive is damaged")
        host = archive.read("chrome/content/zotero/xpcom/reader.js")
        if b"inkSize: Number(Zotero.Prefs.get('reader.inkSize'))" not in host:
            raise RuntimeError("Replacement archive does not include the default-width bridge")
    expected = sha(source)
    try:
        replace(source, target, expected)
    except Exception:
        if sha(target) != manifest["originalSHA256"]:
            replace(backup, target, manifest["originalSHA256"])
        raise
    manifest.update({"status": "installed", "installedSHA256": expected,
                     "source": str(source)})
manifest["updatedAt"] = datetime.now(timezone.utc).isoformat()
manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(json.dumps({"status": manifest["status"], "installedFile": str(target),
                  "sha256": sha(target), "manifest": str(manifest_path)}))
