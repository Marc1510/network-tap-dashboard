#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import socket
import struct
import time
from typing import Any


MAGIC = b"TSNL"
PORT = 46001
MAX_COUNT = 6000
MAX_RATE_PPS = 100
SO_BINDTODEVICE = 25
SO_PRIORITY = 12
SO_TIMESTAMPING = 37
IP_RECVERR = 11
SOF_TIMESTAMPING_TX_HARDWARE = 1 << 0
SOF_TIMESTAMPING_TX_SOFTWARE = 1 << 1
SOF_TIMESTAMPING_RX_HARDWARE = 1 << 2
SOF_TIMESTAMPING_RX_SOFTWARE = 1 << 3
SOF_TIMESTAMPING_SOFTWARE = 1 << 4
SOF_TIMESTAMPING_RAW_HARDWARE = 1 << 6
SOF_TIMESTAMPING_OPT_ID = 1 << 7


def timestamp_ns(seconds: int, nanoseconds: int) -> int | None:
    if seconds == 0 and nanoseconds == 0:
        return None
    return seconds * 1_000_000_000 + nanoseconds


def parse_scm_timestamping(data: bytes) -> dict[str, int | None]:
    if len(data) >= 48:
        values = struct.unpack_from("=qqqqqq", data)
    elif len(data) >= 24:
        values = struct.unpack_from("=llllll", data)
    else:
        return {"softwareNs": None, "hardwareNs": None}
    return {
        "softwareNs": timestamp_ns(values[0], values[1]),
        "hardwareNs": timestamp_ns(values[4], values[5]),
    }


def extract_timestamp(ancillary: list[tuple[int, int, bytes]]) -> dict[str, int | None]:
    for level, kind, data in ancillary:
        if level == socket.SOL_SOCKET and kind == SO_TIMESTAMPING:
            return parse_scm_timestamping(data)
    return {"softwareNs": None, "hardwareNs": None}


def configure_timestamping(sock: socket.socket, *, sender: bool) -> None:
    flags = SOF_TIMESTAMPING_SOFTWARE | SOF_TIMESTAMPING_RAW_HARDWARE
    if sender:
        flags |= SOF_TIMESTAMPING_TX_HARDWARE | SOF_TIMESTAMPING_TX_SOFTWARE | SOF_TIMESTAMPING_OPT_ID
        sock.setsockopt(socket.IPPROTO_IP, IP_RECVERR, 1)
    else:
        flags |= SOF_TIMESTAMPING_RX_HARDWARE | SOF_TIMESTAMPING_RX_SOFTWARE
    sock.setsockopt(socket.SOL_SOCKET, SO_TIMESTAMPING, flags)


def bind_to_interface(sock: socket.socket, interface: str) -> None:
    sock.setsockopt(socket.SOL_SOCKET, SO_BINDTODEVICE, interface.encode("ascii") + b"\0")


def receive(args: argparse.Namespace) -> dict[str, Any]:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    configure_timestamping(sock, sender=False)
    if args.interface:
        bind_to_interface(sock, args.interface)
    sock.bind((args.bind, args.port))
    sock.settimeout(0.25)
    deadline = time.monotonic() + args.timeout
    samples: list[dict[str, Any]] = []
    while len(samples) < args.count and time.monotonic() < deadline:
        try:
            data, ancillary, _flags, source = sock.recvmsg(2048, 512)
        except socket.timeout:
            continue
        if len(data) < 8 or data[:4] != MAGIC:
            continue
        sequence = struct.unpack_from("!I", data, 4)[0]
        timestamp = extract_timestamp(ancillary)
        samples.append({
            "sequence": sequence,
            "source": source[0],
            "rxSoftwareNs": timestamp["softwareNs"],
            "rxHardwareNs": timestamp["hardwareNs"],
        })
    sock.close()
    return {"role": "receiver", "requested": args.count, "received": len(samples), "samples": samples}


def read_tx_timestamp(sock: socket.socket, timeout: float = 0.25) -> dict[str, int | None]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            _data, ancillary, _flags, _address = sock.recvmsg(2048, 512, socket.MSG_ERRQUEUE)
            return extract_timestamp(ancillary)
        except BlockingIOError:
            time.sleep(0.001)
    return {"softwareNs": None, "hardwareNs": None}


def send(args: argparse.Namespace) -> dict[str, Any]:
    interval = 1.0 / args.rate
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    configure_timestamping(sock, sender=True)
    sock.setsockopt(socket.SOL_SOCKET, SO_PRIORITY, args.priority)
    if args.interface:
        bind_to_interface(sock, args.interface)
    sock.setblocking(False)
    samples: list[dict[str, Any]] = []
    next_send = time.monotonic()
    for sequence in range(args.count):
        delay = next_send - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        payload = MAGIC + struct.pack("!I", sequence) + bytes(max(0, args.payload_bytes - 8))
        sock.sendto(payload, (args.target, args.port))
        timestamp = read_tx_timestamp(sock)
        samples.append({
            "sequence": sequence,
            "txSoftwareNs": timestamp["softwareNs"],
            "txHardwareNs": timestamp["hardwareNs"],
        })
        next_send += interval
    sock.close()
    return {"role": "sender", "requested": args.count, "sent": len(samples), "priority": args.priority, "samples": samples}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("role", choices=["sender", "receiver"])
    parser.add_argument("--interface", default="")
    parser.add_argument("--bind", default="0.0.0.0")
    parser.add_argument("--target")
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--count", type=int, required=True)
    parser.add_argument("--rate", type=int, default=10)
    parser.add_argument("--timeout", type=int, default=15)
    parser.add_argument("--payload-bytes", type=int, default=128)
    parser.add_argument("--priority", type=int, default=0)
    args = parser.parse_args()
    if not 1 <= args.count <= MAX_COUNT:
        parser.error(f"count must be between 1 and {MAX_COUNT}")
    if not 1 <= args.rate <= MAX_RATE_PPS:
        parser.error(f"rate must be between 1 and {MAX_RATE_PPS}")
    if not 64 <= args.payload_bytes <= 1400:
        parser.error("payload-bytes must be between 64 and 1400")
    if not 0 <= args.priority <= 7:
        parser.error("priority must be between 0 and 7")
    if args.role == "sender" and not args.target:
        parser.error("sender requires --target")
    return args


def main() -> int:
    args = parse_args()
    result = send(args) if args.role == "sender" else receive(args)
    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
