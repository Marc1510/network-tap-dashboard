#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


ALLOWED_INTERFACES = {"eth0", "eth2", "br0"}
PROCESS_MARKERS = ("ptp4l", "phc2sys", "tsn_latency_probe", "tsn_udp_load", "ssh")


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def proc_stat() -> dict[str, list[int]]:
    result: dict[str, list[int]] = {}
    for line in read_text(Path("/proc/stat")).splitlines():
        fields = line.split()
        if fields and fields[0].startswith("cpu"):
            try:
                result[fields[0]] = [int(value) for value in fields[1:]]
            except ValueError:
                continue
    return result


def meminfo() -> dict[str, int]:
    selected = {"MemTotal", "MemAvailable", "Buffers", "Cached", "SwapTotal", "SwapFree"}
    result: dict[str, int] = {}
    for line in read_text(Path("/proc/meminfo")).splitlines():
        key, separator, raw = line.partition(":")
        if separator and key in selected:
            try:
                result[key + "KiB"] = int(raw.strip().split()[0])
            except (IndexError, ValueError):
                pass
    return result


def snmp() -> dict[str, dict[str, int]]:
    lines = read_text(Path("/proc/net/snmp")).splitlines()
    result: dict[str, dict[str, int]] = {}
    for index in range(0, len(lines) - 1, 2):
        header, values = lines[index], lines[index + 1]
        section, separator, names = header.partition(":")
        value_section, value_separator, raw_values = values.partition(":")
        if not separator or not value_separator or section != value_section:
            continue
        try:
            result[section] = {
                name: int(value)
                for name, value in zip(names.split(), raw_values.split())
            }
        except ValueError:
            continue
    return result


def interface_stats(interfaces: list[str]) -> dict[str, dict[str, int]]:
    names = [name for name in interfaces if name in ALLOWED_INTERFACES]
    fields = (
        "rx_packets", "tx_packets", "rx_bytes", "tx_bytes", "rx_dropped", "tx_dropped",
        "rx_errors", "tx_errors", "rx_missed_errors", "tx_aborted_errors",
    )
    result: dict[str, dict[str, int]] = {}
    for name in names:
        statistics = Path("/sys/class/net") / name / "statistics"
        if not statistics.is_dir():
            continue
        values: dict[str, int] = {}
        for field in fields:
            try:
                values[field] = int(read_text(statistics / field).strip())
            except ValueError:
                pass
        result[name] = values
    return result


def frequencies() -> dict[str, int]:
    result: dict[str, int] = {}
    root = Path("/sys/devices/system/cpu/cpufreq")
    for policy in sorted(root.glob("policy*")):
        try:
            result[policy.name + "KiHz"] = int(read_text(policy / "scaling_cur_freq").strip())
        except ValueError:
            continue
    return result


def process_counts() -> dict[str, int]:
    counts = {marker: 0 for marker in PROCESS_MARKERS}
    counts["total"] = 0
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        counts["total"] += 1
        command = read_text(entry / "cmdline").replace("\0", " ")
        for marker in PROCESS_MARKERS:
            if marker in command:
                counts[marker] += 1
    return counts


def udp_ports() -> dict[str, int]:
    watched = {46001: 0, 46002: 0}
    for source in (Path("/proc/net/udp"), Path("/proc/net/udp6")):
        for line in read_text(source).splitlines()[1:]:
            fields = line.split()
            if len(fields) < 2 or ":" not in fields[1]:
                continue
            try:
                port = int(fields[1].rsplit(":", 1)[1], 16)
            except ValueError:
                continue
            if port in watched:
                watched[port] += 1
    return {str(port): count for port, count in watched.items()}


def qdisc(interfaces: list[str]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for interface in interfaces:
        if interface not in ALLOWED_INTERFACES:
            continue
        command = subprocess.run(
            ["tc", "-j", "-s", "qdisc", "show", "dev", interface],
            capture_output=True, text=True, timeout=5, check=False,
        )
        try:
            value = json.loads(command.stdout) if command.returncode == 0 else None
        except json.JSONDecodeError:
            value = None
        result[interface] = {"exitCode": command.returncode, "value": value, "stderr": command.stderr[-1000:]}
    return result


def ethtool_stats(interfaces: list[str]) -> dict[str, dict[str, int]]:
    result: dict[str, dict[str, int]] = {}
    for interface in interfaces:
        if interface not in ALLOWED_INTERFACES:
            continue
        command = subprocess.run(
            ["ethtool", "-S", interface], capture_output=True, text=True, timeout=8, check=False,
        )
        values: dict[str, int] = {}
        if command.returncode == 0:
            for line in command.stdout.splitlines():
                key, separator, raw = line.strip().partition(":")
                if not separator:
                    continue
                try:
                    values[key] = int(raw.strip())
                except ValueError:
                    continue
        result[interface] = values
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only TSN runtime metrics")
    parser.add_argument("--interfaces", nargs="+", required=True)
    args = parser.parse_args()
    interfaces = [name for name in args.interfaces if name in ALLOWED_INTERFACES]
    if not interfaces:
        parser.error("no allowed interface supplied")
    result = {
        "utc": datetime.now(UTC).isoformat(),
        "monotonic": time.monotonic(),
        "hostname": os.uname().nodename,
        "loadAverage": list(os.getloadavg()),
        "cpu": proc_stat(),
        "memory": meminfo(),
        "snmp": snmp(),
        "interfaces": interface_stats(interfaces),
        "frequencies": frequencies(),
        "processCounts": process_counts(),
        "udpPorts": udp_ports(),
        "qdisc": qdisc(interfaces),
        "ethtool": ethtool_stats(interfaces),
    }
    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
