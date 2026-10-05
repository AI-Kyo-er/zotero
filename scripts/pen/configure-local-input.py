"""Apply or undo local pen preferences without replacing profile data."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import uuid
from datetime import datetime, timezone

KEY = "dom.w3c_pointer_events.scroll_by_pen.enabled"
MOVE_KEY = "apz.touch_move_tolerance"
SIZE_KEY = "extensions.zotero.reader.inkSize"
LINE = b'user_pref("' + KEY.encode() + b'", false);\r\n'
CONTENT = b'// Local pen input compatibility setting; see ZoteroPenDiagnostics backup.\r\n' + LINE
PATTERN = re.compile(rb'^\s*user_pref\("' + re.escape(KEY.encode())
                     + rb'",\s*(?:true|false)\);[^\r\n]*(?:\r?\n|$)', re.MULTILINE)


def digest(content):
    return hashlib.sha256(content).hexdigest()


def preference_pattern(key):
    return re.compile(rb'^\s*user_pref\("' + re.escape(key.encode())
                      + rb'",[^\r\n]*\);[^\r\n]*(?:\r?\n|$)', re.MULTILINE)


def save_manifest(path, manifest):
    temporary = path.with_name("manifest-" + str(uuid.uuid4()) + ".tmp")
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def refine(manifest_path):
    manifest_path = manifest_path.resolve(strict=True)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest["schema"] != 1 or manifest["status"] == "restored":
        raise RuntimeError("Expected the active Direct preference backup")
    original = Path(manifest["backup"]).read_bytes()
    if digest(original) != manifest["backupSHA256"]:
        raise RuntimeError("Original configuration backup verification failed")
    profile = Path(manifest["profile"]).resolve(strict=True)
    user = profile / "user.js"
    current_user = user.read_bytes()
    if digest(current_user) != manifest["createdUserJsSHA256"]:
        raise RuntimeError("user.js has changed; leaving it intact for review")
    current_prefs = (profile / "prefs.js").read_bytes()
    directory = manifest_path.parent / ("native-fine-" + str(uuid.uuid4()))
    directory.mkdir()
    (directory / "user.js.before").write_bytes(current_user)
    (directory / "prefs.js.before").write_bytes(current_prefs)
    if ((directory / "user.js.before").read_bytes() != current_user
            or (directory / "prefs.js.before").read_bytes() != current_prefs):
        raise RuntimeError("Refinement configuration backup verification failed")
    content = (b'// Local pen input compatibility: retain scrolling and initial content moves.\r\n'
               + b'user_pref("' + KEY.encode() + b'", true);\r\n'
               + b'user_pref("' + MOVE_KEY.encode() + b'", "0.0");\r\n')
    manifest.update({"schema": 2, "mode": "NativeFine", "value": True,
        "preferences": [{"name": key, "previousPrefsLines": [line.decode("utf-8")
            for line in preference_pattern(key).findall(original)]} for key in [KEY, MOVE_KEY]],
        "acceptedUserJsSHA256": [digest(current_user), digest(content)],
        "createdUserJsSHA256": digest(content), "status": "prepared-refinement",
        "refinementBackup": {"directory": str(directory), "userJsSHA256": digest(current_user),
            "prefsSHA256": digest(current_prefs)}, "refinedAt": datetime.now(timezone.utc).isoformat()})
    save_manifest(manifest_path, manifest)
    temporary = profile / ("user.pen-input-" + str(uuid.uuid4()) + ".tmp")
    with temporary.open("xb") as output:
        output.write(content)
    if user.read_bytes() != current_user:
        raise RuntimeError("user.js changed during preparation; it has not been replaced")
    os.replace(temporary, user)
    if user.read_bytes() != content:
        raise RuntimeError("Refined preference file verification failed")
    manifest["status"] = "applied-for-next-start"
    save_manifest(manifest_path, manifest)
    print(json.dumps({"status": manifest["status"], "mode": "NativeFine",
        "manifest": str(manifest_path), "modifiedFile": str(user),
        "refinementBackup": str(directory)}, ensure_ascii=False))


def set_width(manifest_path, size):
    manifest_path = manifest_path.resolve(strict=True)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest["schema"] != 2 or manifest["status"] == "restored":
        raise RuntimeError("Expected the active NativeFine configuration backup")
    original_path = Path(manifest["backup"]).resolve(strict=True)
    original = original_path.read_bytes()
    if digest(original) != manifest["backupSHA256"]:
        raise RuntimeError("Original configuration backup verification failed")
    profile = Path(manifest["profile"]).resolve(strict=True)
    user = profile / "user.js"
    current = user.read_bytes()
    if digest(current) != manifest["createdUserJsSHA256"]:
        raise RuntimeError("user.js has changed; leaving it intact for review")
    size_value = float(size)
    if not 0 < size_value <= 64:
        raise RuntimeError("Ink width must be greater than zero and at most 64")
    content = preference_pattern(SIZE_KEY).sub(b"", current)
    content += ('user_pref("' + SIZE_KEY + '", "' + str(size_value) + '");\r\n').encode("ascii")
    directory = manifest_path.parent / ("ink-width-" + str(uuid.uuid4()))
    directory.mkdir()
    (directory / "user.js.before").write_bytes(current)
    prefs_before = (profile / "prefs.js").read_bytes()
    (directory / "prefs.js.before").write_bytes(prefs_before)
    if ((directory / "user.js.before").read_bytes() != current
            or (directory / "prefs.js.before").read_bytes() != prefs_before):
        raise RuntimeError("Width configuration backup verification failed")
    if not any(preference["name"] == SIZE_KEY for preference in manifest["preferences"]):
        manifest["preferences"].append({"name": SIZE_KEY, "previousPrefsLines": [line.decode("utf-8")
            for line in preference_pattern(SIZE_KEY).findall(original)]})
    manifest.update({"backup": str(original_path), "inkSize": size_value,
        "createdUserJsSHA256": digest(content), "status": "prepared-width",
        "widthBackup": str(directory), "widthChangedAt": datetime.now(timezone.utc).isoformat()})
    manifest.setdefault("acceptedUserJsSHA256", []).append(digest(content))
    save_manifest(manifest_path, manifest)
    temporary = profile / ("user.pen-width-" + str(uuid.uuid4()) + ".tmp")
    with temporary.open("xb") as output:
        output.write(content)
    if user.read_bytes() != current:
        raise RuntimeError("user.js changed during preparation; it has not been replaced")
    os.replace(temporary, user)
    if user.read_bytes() != content:
        raise RuntimeError("Ink width preference verification failed")
    manifest["status"] = "applied-for-next-start"
    save_manifest(manifest_path, manifest)
    print(json.dumps({"status": manifest["status"], "inkSize": size_value,
        "manifest": str(manifest_path), "widthBackup": str(directory)}, ensure_ascii=False))


def apply(profile, executable):
    profile = profile.resolve(strict=True)
    prefs = profile / "prefs.js"
    user = profile / "user.js"
    if user.exists():
        raise RuntimeError("Existing user.js requires review; it has not been modified")
    original = prefs.read_bytes()
    directory = Path(os.environ["LOCALAPPDATA"]) / "ZoteroPenDiagnostics" / "configuration-backups" / str(uuid.uuid4())
    directory.mkdir(parents=True)
    backup = directory / "prefs.js.before"
    backup.write_bytes(original)
    if digest(backup.read_bytes()) != digest(original):
        raise RuntimeError("Configuration backup verification failed")
    matched = PATTERN.findall(original)
    manifest = {
        "schema": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
        "profile": str(profile), "installedExecutable": str(executable.resolve(strict=True)),
        "preference": KEY, "value": False, "previousUserJsExisted": False,
        "previousPrefsLines": [line.decode("utf-8") for line in matched],
        "backup": str(backup), "backupSHA256": digest(original),
        "createdUserJsSHA256": digest(CONTENT), "status": "prepared"
    }
    manifest_path = directory / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    # Exclusive creation refuses to overwrite a file created after the check.
    with user.open("xb") as output:
        output.write(CONTENT)
    if user.read_bytes() != CONTENT:
        raise RuntimeError("New preference file verification failed")
    manifest["status"] = "applied-for-next-start"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"status": manifest["status"], "manifest": str(manifest_path),
                      "modifiedFile": str(user), "backupSHA256": manifest["backupSHA256"]}, ensure_ascii=False))


def restore(manifest_path):
    manifest_path = manifest_path.resolve(strict=True)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest["schema"] not in [1, 2] or manifest["preference"] != KEY or manifest["previousUserJsExisted"]:
        raise RuntimeError("Unexpected configuration backup")
    if manifest["status"] == "restored":
        print("This configuration change has already been restored")
        return
    environment = dict(os.environ, ZOTERO_PEN_INSTALLED_EXE=manifest["installedExecutable"])
    result = subprocess.run(["powershell.exe", "-NoProfile", "-Command",
        "$ErrorActionPreference='Stop'; $taskProcesses=@(Get-CimInstance Win32_Process -Filter \"Name='zotero.exe'\" | Where-Object {$_.ExecutablePath -eq $env:ZOTERO_PEN_INSTALLED_EXE}); Write-Output $taskProcesses.Count"],
        env=environment, check=True, text=True, capture_output=True)
    if int(result.stdout.strip()):
        raise RuntimeError("Exit the installed Zotero normally before restoring this preference")
    profile = Path(manifest["profile"]).resolve(strict=True)
    user = profile / "user.js"
    accepted = manifest.get("acceptedUserJsSHA256", [manifest["createdUserJsSHA256"]])
    if user.exists() and digest(user.read_bytes()) not in accepted:
        raise RuntimeError("user.js has changed; leaving it intact for review")
    if user.exists():
        user.unlink()  # Exact newly created file; never a directory deletion.
    prefs = profile / "prefs.js"
    current = prefs.read_bytes()
    preferences = manifest.get("preferences", [{"name": KEY,
        "previousPrefsLines": manifest["previousPrefsLines"]}])
    if any(preference["name"] not in [KEY, MOVE_KEY, SIZE_KEY] for preference in preferences):
        raise RuntimeError("Unexpected preference in configuration backup")
    replacement = current
    for preference in preferences:
        replacement = preference_pattern(preference["name"]).sub(b"", replacement)
        previous = "".join(preference["previousPrefsLines"]).encode("utf-8")
        if previous:
            if replacement and not replacement.endswith(b"\n"):
                replacement += b"\r\n"
            replacement += previous
    if replacement != current:
        # Restore only this preference, preserving all other current settings.
        temporary = profile / ("prefs.pen-restore-" + str(uuid.uuid4()) + ".tmp")
        with temporary.open("xb") as output:
            output.write(replacement)
        os.replace(temporary, prefs)
    manifest["status"] = "restored"
    manifest["restoredAt"] = datetime.now(timezone.utc).isoformat()
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print("Restored the previous pen preference; other current settings were preserved")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", type=Path)
    parser.add_argument("--executable", type=Path)
    parser.add_argument("--restore", type=Path)
    parser.add_argument("--refine", type=Path)
    parser.add_argument("--width", type=Path)
    parser.add_argument("--size", default="1.0")
    args = parser.parse_args()
    if args.restore:
        restore(args.restore)
    elif args.refine:
        refine(args.refine)
    elif args.width:
        set_width(args.width, args.size)
    elif args.profile and args.executable:
        apply(args.profile, args.executable)
    else:
        parser.error("Provide --profile and --executable, or --restore")


if __name__ == "__main__":
    main()
