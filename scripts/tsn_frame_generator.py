from __future__ import annotations

import argparse
import json
import signal
import socket
import struct
import time
from pathlib import Path
from typing import Any


STOP = False
MODE_LIMITS = {"ptp_resilience": (100, 60), "fuzzing": (10, 20)}


def stop_handler(_signum: int, _frame: Any) -> None:
    global STOP
    STOP = True


def interface_mac(interface: str) -> bytes:
    path = Path("/sys/class/net") / interface / "address"
    return bytes.fromhex(path.read_text(encoding="ascii").strip().replace(":", ""))


def frame(source_mac: bytes, sequence: int, mutation: int | None = None) -> bytes:
    version, domain, flags, log_interval, message_length = 2, 0, 0, 0, 44
    if mutation == 0:
        version = 15
    elif mutation == 1:
        domain = 127
    elif mutation == 2:
        flags = 0xFFFF
    elif mutation == 3:
        log_interval = 127
    elif mutation == 4:
        message_length = 34
    source_port = source_mac + b"\xff\xfe" + struct.pack("!H", 1)
    payload = struct.pack(
        "!BBHBBHqI10sHbb10s",
        0x10, version, message_length, domain, 0, flags, 0, 0,
        source_port, sequence & 0xFFFF, 0, log_interval, b"\x00" * 10,
    )
    return b"\x01\x80\xc2\x00\x00\x0e" + source_mac + b"\x88\xf7" + payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Bounded TSN laboratory frame generator")
    parser.add_argument("--interface", required=True, choices=["eth0"])
    parser.add_argument("--mode", required=True, choices=sorted(MODE_LIMITS))
    parser.add_argument("--rate", type=int, required=True)
    parser.add_argument("--duration", type=int, required=True)
    args = parser.parse_args()
    max_rate, max_duration = MODE_LIMITS[args.mode]
    if not 1 <= args.rate <= max_rate or not 1 <= args.duration <= max_duration:
        parser.error(f"limit exceeded: max {max_rate} pps and {max_duration} seconds")

    signal.signal(signal.SIGTERM, stop_handler)
    signal.signal(signal.SIGINT, stop_handler)
    source = interface_mac(args.interface)
    sock = socket.socket(socket.AF_PACKET, socket.SOCK_RAW)
    sock.bind((args.interface, 0))
    sent = 0
    started = time.monotonic()
    deadline = started + args.duration
    next_send = started
    try:
        while not STOP and time.monotonic() < deadline:
            mutation = sent % 5 if args.mode == "fuzzing" else None
            sock.send(frame(source, sent, mutation))
            sent += 1
            next_send += 1.0 / args.rate
            delay = next_send - time.monotonic()
            if delay > 0:
                time.sleep(delay)
    finally:
        sock.close()
    print(json.dumps({"sent": sent, "stopped": STOP, "durationSeconds": round(time.monotonic() - started, 3)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
