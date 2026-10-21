#!/usr/bin/env python3
"""Install checksum-pinned upstream tools locally, for supported macOS and Linux hosts."""
import hashlib
import json
import platform
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
machine = {"aarch64": "arm64", "amd64": "x86_64"}.get(platform.machine().lower(), platform.machine().lower())
platform_key = f"{platform.system().lower()}-{machine}"
manifest = json.loads((root / "toolchain.json").read_text())
if platform_key not in manifest:
    raise SystemExit(f"Unsupported platform: {platform_key}. See README.md for manual installation.")

binary_dir = root / ".tools" / "bin"
binary_dir.mkdir(parents=True, exist_ok=True)
for tool in manifest[platform_key]:
    with tempfile.TemporaryDirectory(prefix="tipper-tools-") as temp:
        archive = Path(temp) / "release.tar.gz"
        subprocess.run([
            "curl", "--fail", "--location", "--silent", "--show-error", "--retry", "2",
            "--proto", "=https", "--proto-redir", "=https",
            tool["url"], "--output", str(archive),
        ], check=True)
        actual = hashlib.sha256(archive.read_bytes()).hexdigest()
        if actual != tool["sha256"]:
            raise SystemExit(f"SHA-256 mismatch for {tool['name']}; refusing installation")
        destination = root / ".tools" / tool["name"]
        destination.mkdir(parents=True, exist_ok=True)
        subprocess.run(["tar", "-xzf", str(archive), "-C", str(destination)], check=True)
        # Release archives contain exactly one top-level directory with bin/.
        bins = list(destination.glob("*/bin/*"))
        if not bins:
            raise SystemExit(f"Missing binaries for {tool['name']}")
        for executable in bins:
            if executable.is_file():
                link = binary_dir / executable.name
                if link.is_symlink():
                    link.unlink()
                elif link.exists():
                    raise SystemExit(f"Refusing to replace non-symlink: {link}")
                # Symlinks live inside bin/, so resolve from its parent.
                link.symlink_to(Path("..") / executable.relative_to(root / ".tools"))
        print(f"Installed {tool['name']} {tool['version']} (SHA-256 verified)")
