#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import signal
import socket
import struct
import time


MAGIC = b"TSNB"
PORT = 46002
MAX_RATE_PPS = 1000
MAX_DURATION_SECONDS = 10
SO_BINDTODEVICE = 25
SO_PRIORITY = 12
STOP = False


def stop_handler(_signum: int, _frame: object) -> None:
    global STOP
    STOP = True


def bind_to_interface(sock: socket.socket, interface: str) -> None:
    sock.setsockopt(socket.SOL_SOCKET, SO_BINDTODEVICE, interface.encode("ascii") + b"\0")


def receive(args: argparse.Namespace) -> dict[str, object]:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((args.bind, args.port))
    sock.settimeout(0.25)
    received = 0
    bytes_received = 0
    deadline = time.monotonic() + args.timeout
    while not STOP and received < args.count and time.monotonic() < deadline:
        try:
            payload, _source = sock.recvfrom(2048)
        except socket.timeout:
            continue
        if len(payload) >= 8 and payload[:4] == MAGIC:
            received += 1
            bytes_received += len(payload)
    sock.close()
    return {"role": "receiver", "requested": args.count, "received": received, "bytesReceived": bytes_received, "stopped": STOP}


def send(args: argparse.Namespace) -> dict[str, object]:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, SO_PRIORITY, args.priority)
    if args.interface:
        bind_to_interface(sock, args.interface)
    started = time.monotonic()
    deadline = started + args.duration
    next_send = started
    sent = 0
    while not STOP and time.monotonic() < deadline:
        payload = MAGIC + struct.pack("!I", sent) + bytes(args.payload_bytes - 8)
        sock.sendto(payload, (args.target, args.port))
        sent += 1
        next_send += 1.0 / args.rate
        delay = next_send - time.monotonic()
        if delay > 0:
            time.sleep(delay)
    sock.close()
    return {
        "role": "sender", "sent": sent, "bytesSent": sent * args.payload_bytes,
        "durationSeconds": round(time.monotonic() - started, 3), "priority": args.priority, "stopped": STOP,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bounded UDP background load for the isolated TSN laboratory")
    parser.add_argument("role", choices=["sender", "receiver"])
    parser.add_argument("--interface", default="")
    parser.add_argument("--bind", default="0.0.0.0")
    parser.add_argument("--target")
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--rate", type=int, default=100)
    parser.add_argument("--duration", type=int, default=5)
    parser.add_argument("--count", type=int, default=1)
    parser.add_argument("--timeout", type=int, default=15)
    parser.add_argument("--payload-bytes", type=int, default=1200)
    parser.add_argument("--priority", type=int, default=0)
    args = parser.parse_args()
    if not 1 <= args.rate <= MAX_RATE_PPS:
        parser.error(f"rate must be between 1 and {MAX_RATE_PPS}")
    if not 1 <= args.duration <= MAX_DURATION_SECONDS:
        parser.error(f"duration must be between 1 and {MAX_DURATION_SECONDS}")
    if not 1 <= args.count <= MAX_RATE_PPS * MAX_DURATION_SECONDS:
        parser.error("count exceeds laboratory limit")
    if not 64 <= args.payload_bytes <= 1400:
        parser.error("payload-bytes must be between 64 and 1400")
    if not 0 <= args.priority <= 7:
        parser.error("priority must be between 0 and 7")
    if args.role == "sender" and not args.target:
        parser.error("sender requires --target")
    return args


def main() -> int:
    signal.signal(signal.SIGTERM, stop_handler)
    signal.signal(signal.SIGINT, stop_handler)
    args = parse_args()
    result = send(args) if args.role == "sender" else receive(args)
    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
