#!/usr/bin/python3
"""Forced SSH command: accept one bounded application archive, never a shell."""
import datetime
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

command = os.environ.get("SSH_ORIGINAL_COMMAND", "")
match = re.fullmatch(r"deploy ([0-9a-f]{40})", command)
if not match:
    sys.exit("Only the website deploy command is allowed.")
commit = match[1]
root = pathlib.Path("/var/lib/satellite-deploy")
release_id = commit + "-" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d%H%M%S") + "-" + str(os.getpid())
candidate = root / "incoming" / release_id
candidate.mkdir(mode=0o700)
archive = candidate / "application.tar.gz"
try:
    size = 0
    with archive.open("xb") as dest:
        while chunk := sys.stdin.buffer.read(1024 * 1024):
            size += len(chunk)
            if size > 128 * 1024 * 1024:
                raise ValueError("Application archive exceeds 128 MiB")
            dest.write(chunk)
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        if len(members) > 10000 or sum(m.size for m in members) > 256 * 1024 * 1024:
            raise ValueError("Application archive is too large")
        for member in members:
            path = pathlib.PurePosixPath(member.name)
            allowed = member.name in ("package.json", "package-lock.json", "server", "dist", "dist/client") or member.name.startswith(("server/", "dist/client/"))
            if not allowed or path.is_absolute() or ".." in path.parts or not (member.isfile() or member.isdir()):
                raise ValueError("Unexpected archive path: " + member.name)
        bundle.extractall(candidate, filter="data")
    archive.unlink()
    for required in ("package.json", "package-lock.json", "server/index.mjs", "dist/client/index.html"):
        if not (candidate / required).is_file():
            raise ValueError("Missing release file: " + required)
    version = json.loads((candidate / "dist/client/deploy-version.json").read_text())
    if version.get("commit") != commit:
        raise ValueError("Release metadata does not match commit")
    subprocess.run(
        ["/usr/local/bin/npm", "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"],
        cwd=candidate, check=True, timeout=300,
        env={"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": str(root), "NODE_ENV": "production"},
    )
    subprocess.run(["/usr/bin/sudo", "-n", "/usr/local/sbin/satellite-center-promote", release_id], check=True, timeout=180)
finally:
    # Only remove this invocation's validated incoming directory, never live data.
    if candidate.exists():
        shutil.rmtree(candidate)
