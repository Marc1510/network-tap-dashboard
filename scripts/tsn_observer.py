from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import signal
import subprocess
import time
from typing import Any


TARGET = "192.168.1.4"
RECEIVER_HOST = "192.168.1.1"
RECEIVER_ADDRESS = "10.10.10.1"
TRAFFIC_INTERFACE = "eth0.10"
GENERATOR = "/usr/local/lib/tsn-test/tsn_frame_generator.py"
LATENCY_PROBE = "/usr/local/lib/tsn-test/tsn_latency_probe.py"
UDP_LOAD = "/usr/local/lib/tsn-test/tsn_udp_load.py"
PRIORITY_PROFILE = "/usr/local/lib/tsn-test/tsn_priority_profile.py"
RUNTIME_METRICS = "/usr/local/lib/tsn-test/tsn_runtime_metrics.py"
CAPTURE_REMOTE = "/tmp/tsn-board4-ingress.pcap"
CAPTURE_REMOTE_LOG = "/tmp/tsn-board4-ingress.log"
CAPTURE_REMOTE_PID = "/tmp/tsn-board4-ingress.pid"
CAPTURE_LOCAL = Path("/tmp/tsn-board4-ingress.pcap")
CAPTURE_LOCAL_LOG = Path("/tmp/tsn-board4-ingress.log")
MEASUREMENT_CAPTURES = (
    ("board4-egress", TARGET, "out", "/tmp/tsn-board4-egress.pcap", "/tmp/tsn-board4-egress.log", "/tmp/tsn-board4-egress.pid"),
    ("board1-ingress", RECEIVER_HOST, "in", "/tmp/tsn-board1-ingress.pcap", "/tmp/tsn-board1-ingress.log", "/tmp/tsn-board1-ingress.pid"),
)
MEASUREMENT_CAPTURE_PACKET_LIMIT = 200_000
ACTIVE: list[subprocess.Popen[str]] = []


def stop_handler(_signum: int, _frame: Any) -> None:
    for process in ACTIVE:
        if process.poll() is None:
            process.terminate()


def execute(command: list[str], timeout: int) -> int:
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    ACTIVE.append(process)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        process.terminate()
        try:
            stdout, stderr = process.communicate(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
            stdout, stderr = process.communicate()
    result = {"exitCode": process.returncode, "stdout": stdout[-16000:], "stderr": stderr[-8000:]}
    print(json.dumps(result))
    return int(process.returncode or 0)


def parse_last_json(value: str) -> dict[str, Any]:
    parsed = json.loads(value.strip().splitlines()[-1])
    if not isinstance(parsed, dict):
        raise ValueError("remote output is not an object")
    return parsed


def wait_for_receiver_ports(ports: list[int], timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = subprocess.run([
            "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=3", "root@" + RECEIVER_HOST,
            "cat /proc/net/udp /proc/net/udp6",
        ], capture_output=True, text=True, timeout=5, check=False)
        sockets = result.stdout.upper()
        if result.returncode == 0 and all(f":{port:04X}" in sockets for port in ports):
            return
        time.sleep(0.1)
    stop_handler(signal.SIGTERM, None)
    raise RuntimeError(f"receiver ports did not become ready: {ports}")


def runtime_metrics() -> int:
    commands = {
        "board1": [
            "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "root@" + RECEIVER_HOST,
            "python3", RUNTIME_METRICS, "--interfaces", "eth0", "eth2", "br0",
        ],
        "board4": [
            "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "root@" + TARGET,
            "python3", RUNTIME_METRICS, "--interfaces", "eth0",
        ],
    }
    result: dict[str, Any] = {"exitCode": 0}
    for name, command in commands.items():
        process = subprocess.run(command, capture_output=True, text=True, timeout=15, check=False)
        if process.returncode != 0:
            result["exitCode"] = process.returncode
            result[name] = {"error": process.stderr[-4000:]}
            continue
        try:
            result[name] = parse_last_json(process.stdout)
        except (IndexError, ValueError, json.JSONDecodeError) as exc:
            result["exitCode"] = 1
            result[name] = {"error": str(exc), "stdout": process.stdout[-4000:]}
    print(json.dumps(result, separators=(",", ":")))
    return int(result["exitCode"])


def capture_start() -> int:
    capture_filter = "not (ether proto 0x88f7 or udp port 46001 or udp port 46002 or tcp port 22)"
    remote = (
        f"if test -s {CAPTURE_REMOTE_PID} && kill -0 $(cat {CAPTURE_REMOTE_PID}) 2>/dev/null; then exit 2; fi; "
        f"rm -f {CAPTURE_REMOTE} {CAPTURE_REMOTE_LOG} {CAPTURE_REMOTE_PID}; "
        f"nohup tcpdump -i eth0 -Q in -nn -s 256 -U -c 20000 -w {CAPTURE_REMOTE} "
        f"'{capture_filter}' >{CAPTURE_REMOTE_LOG} 2>&1 </dev/null & echo $! >{CAPTURE_REMOTE_PID}; "
        f"sleep 1; kill -0 $(cat {CAPTURE_REMOTE_PID})"
    )
    process = subprocess.run([
        "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "root@" + TARGET, remote,
    ], capture_output=True, text=True, timeout=15, check=False)
    result = {"exitCode": process.returncode, "stderr": process.stderr[-4000:], "remoteFile": CAPTURE_REMOTE}
    print(json.dumps(result, separators=(",", ":")))
    return int(process.returncode)


def capture_stop() -> int:
    remote = (
        f"if test -s {CAPTURE_REMOTE_PID}; then pid=$(cat {CAPTURE_REMOTE_PID}); "
        f"kill -INT $pid 2>/dev/null || true; i=0; while kill -0 $pid 2>/dev/null && test $i -lt 50; "
        f"do sleep 0.1; i=$((i+1)); done; fi; rm -f {CAPTURE_REMOTE_PID}; test -f {CAPTURE_REMOTE}"
    )
    stopped = subprocess.run([
        "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "root@" + TARGET, remote,
    ], capture_output=True, text=True, timeout=20, check=False)
    for path in (CAPTURE_LOCAL, CAPTURE_LOCAL_LOG):
        try:
            path.unlink()
        except FileNotFoundError:
            pass
    copied = subprocess.run([
        "scp", "-q", "-o", "BatchMode=yes", "root@" + TARGET + ":" + CAPTURE_REMOTE, str(CAPTURE_LOCAL),
    ], capture_output=True, text=True, timeout=30, check=False)
    log_copy = subprocess.run([
        "scp", "-q", "-o", "BatchMode=yes", "root@" + TARGET + ":" + CAPTURE_REMOTE_LOG, str(CAPTURE_LOCAL_LOG),
    ], capture_output=True, text=True, timeout=15, check=False)
    exit_code = stopped.returncode or copied.returncode
    result: dict[str, Any] = {
        "exitCode": exit_code,
        "stopStderr": stopped.stderr[-2000:],
        "copyStderr": copied.stderr[-2000:],
        "logCopyExitCode": log_copy.returncode,
        "localFile": str(CAPTURE_LOCAL),
        "localLog": str(CAPTURE_LOCAL_LOG),
    }
    if CAPTURE_LOCAL.is_file():
        data = CAPTURE_LOCAL.read_bytes()
        result.update({"size": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    print(json.dumps(result, separators=(",", ":")))
    return int(exit_code)


def measurement_capture_start() -> int:
    # The path capture is for the generated measurement streams only.  PTP is
    # captured separately by the run-level capture; including it here can fill
    # the bounded file before the actual test has finished.
    capture_filter = "(udp port 46001 or udp port 46002) or (vlan and (udp port 46001 or udp port 46002))"
    captures: list[dict[str, Any]] = []
    exit_code = 0
    for name, host, direction, remote_file, remote_log, remote_pid in MEASUREMENT_CAPTURES:
        remote = (
            f"if test -s {remote_pid} && kill -0 $(cat {remote_pid}) 2>/dev/null; then exit 2; fi; "
            f"rm -f {remote_file} {remote_log} {remote_pid}; "
            f"nohup tcpdump -i eth0 -Q {direction} -nn -s 128 -U -c {MEASUREMENT_CAPTURE_PACKET_LIMIT} -w {remote_file} "
            f"'{capture_filter}' >{remote_log} 2>&1 </dev/null & echo $! >{remote_pid}; "
            f"sleep 1; kill -0 $(cat {remote_pid})"
        )
        process = subprocess.run([
            "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "root@" + host, remote,
        ], capture_output=True, text=True, timeout=15, check=False)
        exit_code = exit_code or process.returncode
        captures.append({"name": name, "exitCode": process.returncode, "stderr": process.stderr[-2000:], "remoteFile": remote_file})
    result = {"exitCode": exit_code, "captures": captures}
    print(json.dumps(result, separators=(",", ":")))
    return int(exit_code)


def measurement_capture_stop() -> int:
    captures: list[dict[str, Any]] = []
    exit_code = 0
    for name, host, _direction, remote_file, remote_log, remote_pid in MEASUREMENT_CAPTURES:
        remote = (
            f"if test -s {remote_pid}; then pid=$(cat {remote_pid}); kill -INT $pid 2>/dev/null || true; "
            f"i=0; while kill -0 $pid 2>/dev/null && test $i -lt 50; do sleep 0.1; i=$((i+1)); done; fi; "
            # A tcpdump process that reached its packet cap has already exited
            # and can leave a stale pid file.  Removing that file is safe, and
            # a valid capture file is the meaningful stop criterion.
            f"rm -f {remote_pid}; test -f {remote_file}"
        )
        stopped = subprocess.run([
            "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "root@" + host, remote,
        ], capture_output=True, text=True, timeout=20, check=False)
        local_file = Path(f"/tmp/tsn-{name}.pcap")
        local_log = Path(f"/tmp/tsn-{name}.log")
        for path in (local_file, local_log):
            try:
                path.unlink()
            except FileNotFoundError:
                pass
        copied = subprocess.run([
            "scp", "-q", "-o", "BatchMode=yes", "root@" + host + ":" + remote_file, str(local_file),
        ], capture_output=True, text=True, timeout=30, check=False)
        log_copy = subprocess.run([
            "scp", "-q", "-o", "BatchMode=yes", "root@" + host + ":" + remote_log, str(local_log),
        ], capture_output=True, text=True, timeout=15, check=False)
        current_exit = stopped.returncode or copied.returncode
        exit_code = exit_code or current_exit
        entry: dict[str, Any] = {
            "name": name, "exitCode": current_exit, "stopStderr": stopped.stderr[-2000:],
            "copyStderr": copied.stderr[-2000:], "logCopyExitCode": log_copy.returncode,
            "localFile": str(local_file), "localLog": str(local_log),
        }
        if local_file.is_file():
            data = local_file.read_bytes()
            entry.update({"size": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        captures.append(entry)
    result = {"exitCode": exit_code, "captures": captures}
    print(json.dumps(result, separators=(",", ":")))
    return int(exit_code)


def latency_measurement(rate: int, duration: int, priority: int = 0) -> int:
    if not 1 <= rate <= 100 or not 1 <= duration <= 60:
        raise ValueError("latency measurement exceeds laboratory limits")
    count = rate * duration
    receiver = subprocess.Popen([
        "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "root@" + RECEIVER_HOST,
        "python3", LATENCY_PROBE, "receiver", "--bind", RECEIVER_ADDRESS,
        "--count", str(count), "--timeout", str(duration + 6),
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    ACTIVE.append(receiver)
    wait_for_receiver_ports([46001])
    sender = subprocess.Popen([
        "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "root@" + TARGET,
        "python3", LATENCY_PROBE, "sender", "--interface", TRAFFIC_INTERFACE, "--target", RECEIVER_ADDRESS,
        "--count", str(count), "--rate", str(rate), "--priority", str(priority),
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    ACTIVE.append(sender)
    try:
        sender_stdout, sender_stderr = sender.communicate(timeout=duration + 8)
        receiver_stdout, receiver_stderr = receiver.communicate(timeout=duration + 8)
    except subprocess.TimeoutExpired:
        stop_handler(signal.SIGTERM, None)
        sender_stdout, sender_stderr = sender.communicate(timeout=3)
        receiver_stdout, receiver_stderr = receiver.communicate(timeout=3)
    exit_code = sender.returncode or receiver.returncode or 0
    result: dict[str, Any] = {
        "exitCode": exit_code,
        "stderr": (sender_stderr + "\n" + receiver_stderr)[-16000:],
    }
    try:
        result["sender"] = parse_last_json(sender_stdout)
        result["receiver"] = parse_last_json(receiver_stdout)
    except (IndexError, ValueError, json.JSONDecodeError) as exc:
        result["parseError"] = str(exc)
        result["senderOutput"] = sender_stdout[-4000:]
        result["receiverOutput"] = receiver_stdout[-4000:]
        exit_code = exit_code or 1
        result["exitCode"] = exit_code
    print(json.dumps(result, separators=(",", ":")))
    return int(exit_code)


def latency_under_load(background_rate: int, duration: int, measurement_priority: int = 0) -> int:
    if not 1 <= background_rate <= 1000 or not 1 <= duration <= 10:
        raise ValueError("background load exceeds laboratory limits")
    latency_rate = 10
    latency_count = latency_rate * duration
    background_count = background_rate * duration
    background_receiver = subprocess.Popen([
        "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "root@" + RECEIVER_HOST,
        "python3", UDP_LOAD, "receiver", "--bind", RECEIVER_ADDRESS,
        "--count", str(background_count), "--timeout", str(duration + 6),
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    latency_receiver = subprocess.Popen([
        "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "root@" + RECEIVER_HOST,
        "python3", LATENCY_PROBE, "receiver", "--bind", RECEIVER_ADDRESS,
        "--count", str(latency_count), "--timeout", str(duration + 6),
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    ACTIVE.extend([background_receiver, latency_receiver])
    wait_for_receiver_ports([46001, 46002])
    background_sender = subprocess.Popen([
        "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "root@" + TARGET,
        "python3", UDP_LOAD, "sender", "--interface", TRAFFIC_INTERFACE, "--target", RECEIVER_ADDRESS,
        "--rate", str(background_rate), "--duration", str(duration), "--payload-bytes", "1200", "--priority", "0",
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    latency_sender = subprocess.Popen([
        "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "root@" + TARGET,
        "python3", LATENCY_PROBE, "sender", "--interface", TRAFFIC_INTERFACE, "--target", RECEIVER_ADDRESS,
        "--count", str(latency_count), "--rate", str(latency_rate), "--priority", str(measurement_priority),
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    ACTIVE.extend([background_sender, latency_sender])
    processes = [background_sender, latency_sender, background_receiver, latency_receiver]
    outputs: list[tuple[str, str]] = []
    try:
        for process in processes:
            outputs.append(process.communicate(timeout=duration + 8))
    except subprocess.TimeoutExpired:
        stop_handler(signal.SIGTERM, None)
        outputs = []
        for process in processes:
            outputs.append(process.communicate(timeout=3))
    errors = "\n".join(value[1] for value in outputs)
    exit_code = next((int(process.returncode) for process in processes if process.returncode), 0)
    result: dict[str, Any] = {"exitCode": exit_code, "stderr": errors[-16000:]}
    try:
        result["background"] = {
            "sender": parse_last_json(outputs[0][0]),
            "receiver": parse_last_json(outputs[2][0]),
            "ratePps": background_rate,
            "payloadBytes": 1200,
            "priority": 0,
        }
        result["measurementPriority"] = measurement_priority
        result["sender"] = parse_last_json(outputs[1][0])
        result["receiver"] = parse_last_json(outputs[3][0])
    except (IndexError, ValueError, json.JSONDecodeError) as exc:
        result["parseError"] = str(exc)
        exit_code = exit_code or 1
        result["exitCode"] = exit_code
    print(json.dumps(result, separators=(",", ":")))
    return int(exit_code)


def main() -> int:
    parser = argparse.ArgumentParser(description="Restricted TSN laboratory observer")
    parser.add_argument("--action", required=True, choices=[
        "ping", "status", "stage", "latency", "latency_load", "latency_priority",
        "priority_inspect", "priority_apply", "priority_restore",
        "runtime_metrics",
        "capture_start", "capture_stop",
        "measurement_capture_start", "measurement_capture_stop",
    ])
    parser.add_argument("--mode", choices=["ptp_resilience", "fuzzing"])
    parser.add_argument("--rate", type=int)
    parser.add_argument("--duration", type=int)
    parser.add_argument("--priority", type=int, default=0)
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, stop_handler)
    signal.signal(signal.SIGINT, stop_handler)

    if args.action == "ping":
        return execute(["ping", "-c", "4", "-W", "1", TARGET], timeout=8)
    if args.action == "status":
        return execute([
            "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "root@" + TARGET,
            "ip -br link; ip -s link show dev eth0; pgrep -af 'ptp4l|phc2sys' || true; "
            "phc_ctl eth0 cmp 2>/dev/null || true; tail -n 16 /tmp/tsn-ptp4l-slave.log 2>/dev/null || true; "
            "ethtool -T eth0 2>/dev/null",
        ], timeout=15)
    if args.action == "latency":
        if args.rate is None or args.duration is None:
            parser.error("latency requires rate and duration")
        return latency_measurement(args.rate, args.duration, args.priority)
    if args.action == "latency_load":
        if args.rate is None or args.duration is None:
            parser.error("latency_load requires background rate and duration")
        return latency_under_load(args.rate, args.duration)
    if args.action == "latency_priority":
        if args.rate is None or args.duration is None:
            parser.error("latency_priority requires background rate and duration")
        return latency_under_load(args.rate, args.duration, measurement_priority=7)
    if args.action.startswith("priority_"):
        profile_action = args.action.removeprefix("priority_")
        return execute([
            "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "root@" + TARGET,
            "python3", PRIORITY_PROFILE, profile_action,
        ], timeout=15)
    if args.action == "runtime_metrics":
        return runtime_metrics()
    if args.action == "capture_start":
        return capture_start()
    if args.action == "capture_stop":
        return capture_stop()
    if args.action == "measurement_capture_start":
        return measurement_capture_start()
    if args.action == "measurement_capture_stop":
        return measurement_capture_stop()
    if args.mode is None or args.rate is None or args.duration is None:
        parser.error("stage requires mode, rate and duration")
    limits = {"ptp_resilience": (100, 60), "fuzzing": (10, 20)}
    max_rate, max_duration = limits[args.mode]
    if not 1 <= args.rate <= max_rate or not 1 <= args.duration <= max_duration:
        parser.error("stage exceeds laboratory limits")
    return execute([
        "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "root@" + TARGET,
        "python3", GENERATOR, "--interface", "eth0", "--mode", args.mode,
        "--rate", str(args.rate), "--duration", str(args.duration),
    ], timeout=args.duration + 10)


if __name__ == "__main__":
    raise SystemExit(main())
