#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import subprocess
from typing import Any


INTERFACE = "eth0"
HANDLE = "100:"
MAP = [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]


def run(command: list[str], *, check: bool = False) -> dict[str, Any]:
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    value = {
        "command": command,
        "exitCode": result.returncode,
        "stdout": result.stdout[-16000:],
        "stderr": result.stderr[-8000:],
    }
    if check and result.returncode != 0:
        raise RuntimeError(f"command failed: {' '.join(command)}: {result.stderr.strip()}")
    return value


def inspect() -> dict[str, Any]:
    return {
        "interface": INTERFACE,
        "privateFlags": run(["ethtool", "--show-priv-flags", INTERFACE]),
        "channels": run(["ethtool", "-l", INTERFACE]),
        "qdisc": run(["tc", "-j", "-s", "qdisc", "show", "dev", INTERFACE]),
        "classes": run(["tc", "-j", "-s", "class", "show", "dev", INTERFACE]),
        "statistics": run(["ethtool", "-S", INTERFACE]),
    }


def verify_prerequisites() -> dict[str, Any]:
    value = inspect()
    flags = value["privateFlags"]["stdout"]
    channels = value["channels"]["stdout"]
    qdisc = value["qdisc"]["stdout"]
    if "p0-rx-ptype-rrobin: off" not in flags:
        raise RuntimeError("fixed-priority DMA mode is not active")
    tx_channels = [int(value) for value in re.findall(r"^TX:\s+(\d+)$", channels, re.MULTILINE)]
    if not tx_channels or tx_channels[-1] != 8:
        raise RuntimeError("eight TX channels are not active")
    if '"kind":"mq"' not in qdisc and '"handle":"100:"' not in qdisc:
        raise RuntimeError("unexpected root qdisc; refusing to overwrite it")
    return value


def apply_profile() -> dict[str, Any]:
    before = verify_prerequisites()
    command = [
        "tc", "qdisc", "replace", "dev", INTERFACE, "root", "handle", HANDLE,
        "mqprio", "num_tc", "2", "map", *[str(value) for value in MAP],
        "queues", "1@0", "1@7", "hw", "0",
    ]
    applied = run(command, check=True)
    return {"action": "apply", "before": before, "command": applied, "after": inspect()}


def restore_profile() -> dict[str, Any]:
    before = inspect()
    qdisc = before["qdisc"]["stdout"]
    removed = None
    if '"handle":"100:"' in qdisc:
        removed = run(["tc", "qdisc", "del", "dev", INTERFACE, "root"], check=True)
    after = inspect()
    if '"kind":"mq"' not in after["qdisc"]["stdout"]:
        raise RuntimeError("default mq qdisc was not restored")
    return {"action": "restore", "before": before, "command": removed, "after": after}


def main() -> int:
    parser = argparse.ArgumentParser(description="Temporary priority profile for the isolated TSN laboratory")
    parser.add_argument("action", choices=["inspect", "apply", "restore"])
    args = parser.parse_args()
    if args.action == "inspect":
        result = inspect()
    elif args.action == "apply":
        result = apply_profile()
    else:
        result = restore_profile()
    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
