from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import shutil
import signal
import socket
import statistics
import struct
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


STOP_REQUESTED = False


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def atomic_json(path: Path, value: Any) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def append_event(path: Path, event: str, **details: Any) -> None:
    record = {"utc": utc_now(), "monotonic": time.monotonic(), "event": event, **details}
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def run_command(command: list[str], timeout: int = 10, output_limit: int = 16000) -> dict[str, Any]:
    started = time.monotonic()
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
        return {
            "command": command,
            "exitCode": result.returncode,
            "stdout": result.stdout[-output_limit:],
            "stderr": result.stderr[-8000:],
            "durationMs": round((time.monotonic() - started) * 1000),
        }
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        return {
            "command": command,
            "exitCode": None,
            "stdout": "",
            "stderr": str(exc),
            "durationMs": round((time.monotonic() - started) * 1000),
        }


def observer_command(
    observer_user: str,
    observer_host: str,
    action: str,
    timeout: int = 15,
    arguments: list[str] | None = None,
    output_limit: int = 16000,
) -> dict[str, Any]:
    command = [
        "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "-o", "StrictHostKeyChecking=yes",
        f"{observer_user}@{observer_host}", "--", "python3", "/usr/local/lib/tsn-test/tsn_observer.py",
        "--action", action,
    ]
    command.extend(arguments or [])
    raw = run_command(command, timeout=timeout, output_limit=output_limit)
    try:
        nested = json.loads(raw["stdout"].strip().splitlines()[-1])
        if isinstance(nested, dict):
            raw["observer"] = nested
    except (IndexError, json.JSONDecodeError):
        pass
    return raw


def snapshot(interface: str, target: str, observer_user: str, observer_host: str) -> dict[str, Any]:
    commands = {
        "link": ["ip", "-s", "link", "show", "dev", interface],
        "addresses": ["ip", "-br", "address"],
        "neighbors": ["ip", "neighbor", "show"],
        "timestamping": ["ethtool", "-T", interface],
        "processes": ["pgrep", "-af", "ptp4l|phc2sys"],
        "clock": ["timedatectl", "show", "--property=NTPSynchronized", "--property=TimeUSec"],
    }
    result = {"utc": utc_now(), "commands": {name: run_command(command) for name, command in commands.items()}}
    result["commands"]["observerPing"] = observer_command(observer_user, observer_host, "ping")
    result["commands"]["targetStatus"] = observer_command(observer_user, observer_host, "status", timeout=20)
    return result


def start_capture(interface: str, artifact_dir: Path, events: Path) -> tuple[subprocess.Popen[bytes] | None, Path | None]:
    if shutil.which("tcpdump") is None:
        append_event(events, "capture_unavailable", reason="tcpdump not installed")
        return None, None
    capture_path = artifact_dir / "traffic.pcap"
    base = ["tcpdump", "-i", interface, "-nn", "-s", "0", "-U", "-w", str(capture_path)]
    capture_filter = ["ether proto 0x88f7 or arp or icmp"]
    command = base[:1] + ["--time-stamp-precision", "nano"] + base[1:] + capture_filter
    log = (artifact_dir / "capture.log").open("ab", buffering=0)
    try:
        process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        time.sleep(0.5)
        if process.poll() is not None:
            command = base + capture_filter
            process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        append_event(events, "capture_started", pid=process.pid, captureFile=capture_path.name)
        return process, capture_path
    except OSError as exc:
        append_event(events, "capture_failed", reason=str(exc))
        return None, None
    finally:
        log.close()


def stop_process(process: subprocess.Popen[bytes] | None, events: Path, event: str) -> None:
    if process is None or process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=5)
    except (ProcessLookupError, subprocess.TimeoutExpired):
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    append_event(events, event)


def interface_mac(interface: str) -> bytes:
    value = Path("/sys/class/net") / interface / "address"
    return bytes.fromhex(value.read_text(encoding="ascii").strip().replace(":", ""))


def ptp_payload(source_mac: bytes, sequence: int, mutation: int | None = None) -> bytes:
    # IEEE 1588 v2 / 802.1AS-compatible L2 Sync-shaped frame. Mutations are
    # deliberately restricted to header fields and never exceed one frame.
    transport_and_type = 0x10
    version = 0x02
    message_length = 44
    domain = 0
    flags = 0
    correction = 0
    source_port = source_mac + b"\xff\xfe" + struct.pack("!H", 1)
    control = 0
    log_interval = 0
    if mutation == 0:
        version = 0x0F
    elif mutation == 1:
        domain = 127
    elif mutation == 2:
        flags = 0xFFFF
    elif mutation == 3:
        log_interval = 127
    elif mutation == 4:
        message_length = 34
    header = struct.pack(
        "!BBHBBHqI10sHbb10s",
        transport_and_type,
        version,
        message_length,
        domain,
        0,
        flags,
        correction,
        0,
        source_port,
        sequence & 0xFFFF,
        control,
        log_interval,
        b"\x00" * 10,
    )
    return b"\x01\x80\xc2\x00\x00\x0e" + source_mac + b"\x88\xf7" + header


def send_stage(
    observer_user: str,
    observer_host: str,
    target: str,
    generator_interface: str,
    rate: int,
    duration: int,
    mode: str,
    events: Path,
    dry_run: bool,
) -> int:
    global STOP_REQUESTED
    append_event(events, "stage_started", ratePps=rate, durationSeconds=duration, mode=mode, dryRun=dry_run)
    if dry_run:
        deadline = time.monotonic() + min(duration, 2)
        while time.monotonic() < deadline and not STOP_REQUESTED:
            time.sleep(0.1)
        append_event(events, "stage_finished", sent=0, dryRun=True)
        return 0

    command = [
        "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "-o", "StrictHostKeyChecking=yes",
        f"{observer_user}@{observer_host}", "--", "python3", "/usr/local/lib/tsn-test/tsn_observer.py",
        "--action", "stage", "--mode", mode,
        "--rate", str(rate), "--duration", str(duration),
    ]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
    try:
        while process.poll() is None and not STOP_REQUESTED:
            time.sleep(0.1)
        if STOP_REQUESTED and process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
        stdout, stderr = process.communicate(timeout=8)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        stdout, stderr = process.communicate()
    sent = 0
    try:
        observer_output = json.loads(stdout.strip().splitlines()[-1])
        generator_output = json.loads(str(observer_output.get("stdout") or "").strip().splitlines()[-1])
        sent = int(generator_output.get("sent", 0))
    except (IndexError, ValueError, json.JSONDecodeError):
        pass
    if process.returncode != 0 and not STOP_REQUESTED:
        raise RuntimeError(f"remote generator failed ({process.returncode}): {stderr[-1000:]}")
    append_event(events, "stage_finished", sent=sent, dryRun=False, generatorStderr=stderr[-1000:])
    return sent


def classify_fuzz_mutation(record: dict[str, Any]) -> int:
    version = int(record.get("ptpVersion") or 2)
    if version == 0x0F:
        return 0
    if int(record.get("ptpDomain") or 0) == 127:
        return 1
    if int(record.get("ptpFlags") or 0) == 0xFFFF:
        return 2
    if int(record.get("ptpLogInterval") or 0) == 127:
        return 3
    if int(record.get("ptpMessageLength") or 0) == 34:
        return 4
    return -1


def summarize_fuzzing_capture(capture_path: Path, requested_frames: int, artifact_dir: Path) -> dict[str, Any]:
    if capture_path is None or not capture_path.exists():
        return {"available": False, "reason": "no capture"}
    data = capture_path.read_bytes()
    records = parse_pcap(data)
    ptp_records = [record for record in records if record.get("etherType") == 0x88F7]
    sequence_counts: dict[int, int] = {}
    mutation_counts: dict[str, int] = {str(value): 0 for value in range(-1, 5)}
    missing_sequences: list[dict[str, int]] = []
    for record in ptp_records:
        sequence = record.get("sequenceId")
        if not isinstance(sequence, int):
            continue
        sequence_counts[sequence] = sequence_counts.get(sequence, 0) + 1
        mutation = classify_fuzz_mutation(record)
        mutation_counts[str(mutation)] = mutation_counts.get(str(mutation), 0) + 1
    missing_count = 0
    for sequence in range(requested_frames):
        observed = sequence_counts.get(sequence, 0)
        if observed == 0:
            missing_count += 1
            missing_sequences.append({"sequence": sequence, "occurrences": 1})
    duplicates = sum(max(0, count - 1) for count in sequence_counts.values())
    seen_mutation_keys = sorted(mutation_counts.keys(), key=lambda item: int(item) if item.lstrip("-").isdigit() else 999)
    with (artifact_dir / "fuzzing-sequences.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["sequence", "egress_count"])
        for sequence in range(requested_frames):
            writer.writerow([sequence, sequence_counts.get(sequence, 0)])
    summary = {
        "available": True,
        "requestedFrames": requested_frames,
        "observedPackets": len(ptp_records),
        "uniqueSequences": len(sequence_counts),
        "missingPacketsAtCapture": missing_count,
        "duplicatePackets": duplicates,
        "missingSequences": missing_sequences[:200],
        "mutationCounts": {name: mutation_counts[name] for name in seen_mutation_keys},
    }
    atomic_json(artifact_dir / "fuzzing-summary.json", summary)
    return summary


def percentile(sorted_values: list[int], percentage: float) -> float | None:
    if not sorted_values:
        return None
    position = (len(sorted_values) - 1) * percentage
    lower = int(position)
    upper = min(lower + 1, len(sorted_values) - 1)
    fraction = position - lower
    return sorted_values[lower] * (1 - fraction) + sorted_values[upper] * fraction


def summarize_latency(measurement: dict[str, Any], artifact_dir: Path) -> dict[str, Any]:
    sender = measurement.get("sender") if isinstance(measurement.get("sender"), dict) else {}
    receiver = measurement.get("receiver") if isinstance(measurement.get("receiver"), dict) else {}
    sent_samples = {
        sample.get("sequence"): sample
        for sample in sender.get("samples", [])
        if isinstance(sample, dict) and isinstance(sample.get("sequence"), int)
    }
    received_samples = {
        sample.get("sequence"): sample
        for sample in receiver.get("samples", [])
        if isinstance(sample, dict) and isinstance(sample.get("sequence"), int)
    }
    joined: list[dict[str, Any]] = []
    hardware_pairs = 0
    for sequence in sorted(set(sent_samples) & set(received_samples)):
        tx = sent_samples[sequence]
        rx = received_samples[sequence]
        tx_hardware, rx_hardware = tx.get("txHardwareNs"), rx.get("rxHardwareNs")
        tx_software, rx_software = tx.get("txSoftwareNs"), rx.get("rxSoftwareNs")
        if isinstance(tx_hardware, int) and isinstance(rx_hardware, int):
            hardware_pairs += 1
            method, tx_ns, rx_ns = "hardware", tx_hardware, rx_hardware
        elif isinstance(tx_software, int) and isinstance(rx_software, int):
            method, tx_ns, rx_ns = "kernel-software", tx_software, rx_software
        else:
            continue
        joined.append({
            "sequence": sequence,
            "method": method,
            "txNs": tx_ns,
            "rxNs": rx_ns,
            "latencyNs": rx_ns - tx_ns,
        })
    selected_method = "hardware" if hardware_pairs else "kernel-software"
    selected = [sample for sample in joined if sample["method"] == selected_method]
    values = sorted(sample["latencyNs"] for sample in selected)
    adjacent_variations = [abs(selected[index]["latencyNs"] - selected[index - 1]["latencyNs"]) for index in range(1, len(selected))]
    with (artifact_dir / "latency-samples.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["sequence", "timestamp_method", "tx_ns", "rx_ns", "latency_ns", "latency_us"])
        for sample in selected:
            writer.writerow([
                sample["sequence"], sample["method"], sample["txNs"], sample["rxNs"],
                sample["latencyNs"], f"{sample['latencyNs'] / 1000:.3f}",
            ])
    requested = int(sender.get("requested") or receiver.get("requested") or 0)
    summary = {
        "available": bool(values),
        "timestampMethod": selected_method if values else None,
        "hardwareTimestampPairs": hardware_pairs,
        "requestedPackets": requested,
        "sentPackets": int(sender.get("sent") or 0),
        "senderPriority": sender.get("priority") if isinstance(sender.get("priority"), int) else None,
        "receivedPackets": int(receiver.get("received") or 0),
        "matchedPackets": len(values),
        "lostPackets": max(0, requested - len(values)),
        "lossPercent": round((max(0, requested - len(values)) / requested * 100), 6) if requested else None,
        "negativeLatencySamples": sum(1 for value in values if value < 0),
        "minNs": min(values) if values else None,
        "meanNs": round(statistics.fmean(values), 3) if values else None,
        "p50Ns": round(percentile(values, 0.50) or 0, 3) if values else None,
        "p95Ns": round(percentile(values, 0.95) or 0, 3) if values else None,
        "p99Ns": round(percentile(values, 0.99) or 0, 3) if values else None,
        "maxNs": max(values) if values else None,
        "jitterStddevNs": round(statistics.pstdev(values), 3) if len(values) > 1 else 0,
        "packetDelayVariationMeanNs": round(statistics.fmean(adjacent_variations), 3) if adjacent_variations else 0,
    }
    atomic_json(artifact_dir / "latency-summary.json", summary)
    return summary


def measure_latency(
    observer_user: str,
    observer_host: str,
    rate: int,
    duration: int,
    artifact_dir: Path,
    events: Path,
    dry_run: bool,
    action: str = "latency",
    priority: int = 0,
) -> tuple[int, dict[str, Any]]:
    append_event(events, "latency_measurement_started", ratePps=rate, durationSeconds=duration, dryRun=dry_run, measurementAction=action)
    if dry_run:
        deadline = time.monotonic() + min(duration, 2)
        while time.monotonic() < deadline and not STOP_REQUESTED:
            time.sleep(0.1)
        summary = {"available": False, "reason": "dry-run", "requestedPackets": rate * duration}
        atomic_json(artifact_dir / "latency-summary.json", summary)
        return 0, summary
    raw = observer_command(
        observer_user,
        observer_host,
        action,
        timeout=duration + 20,
        arguments=["--rate", str(rate), "--duration", str(duration), "--priority", str(priority)],
        output_limit=2_000_000,
    )
    measurement = raw.get("observer") if isinstance(raw.get("observer"), dict) else {}
    atomic_json(artifact_dir / "latency-raw.json", {"transport": raw, "measurement": measurement})
    if raw.get("exitCode") != 0 or measurement.get("exitCode") != 0:
        raise RuntimeError(f"latency probe failed: {raw.get('stderr') or measurement.get('stderr')}")
    summary = summarize_latency(measurement, artifact_dir)
    append_event(events, "latency_measurement_finished", **summary)
    return int(summary.get("sentPackets") or 0), summary


def measure_latency_load_comparison(
    observer_user: str,
    observer_host: str,
    background_rate: int,
    duration: int,
    artifact_dir: Path,
    events: Path,
    dry_run: bool,
    priority_profile: bool = False,
    order: str = "baseline-first",
    manage_profile: bool = True,
) -> tuple[int, dict[str, Any]]:
    if order not in {"baseline-first", "load-first"}:
        raise ValueError("unsupported comparison order")
    if dry_run:
        time.sleep(min(0.2, duration))
        result = {
            "available": False,
            "reason": "dry-run",
            "backgroundRatePps": background_rate,
            "backgroundPayloadBytes": 1200,
            "priorityProfile": priority_profile,
            "order": order,
        }
        atomic_json(artifact_dir / "latency-load-comparison.json", result)
        return 0, result
    baseline_dir = artifact_dir / ("priority-load-baseline" if priority_profile else "latency-load-baseline")
    loaded_dir = artifact_dir / ("priority-load-active" if priority_profile else "latency-load-active")
    baseline_dir.mkdir(exist_ok=False)
    loaded_dir.mkdir(exist_ok=False)
    profile_apply: dict[str, Any] | None = None
    profile_restore: dict[str, Any] | None = None
    try:
        if priority_profile and manage_profile:
            profile_apply = observer_command(observer_user, observer_host, "priority_apply", timeout=20, output_limit=500_000)
            atomic_json(artifact_dir / "priority-profile-apply.json", profile_apply)
            if profile_apply.get("exitCode") != 0 or profile_apply.get("observer", {}).get("exitCode") != 0:
                raise RuntimeError("priority profile could not be applied")
        def baseline_measurement() -> tuple[int, dict[str, Any]]:
            return measure_latency(
                observer_user, observer_host, 10, duration, baseline_dir, events, False,
                priority=7 if priority_profile else 0,
            )

        def loaded_measurement() -> tuple[int, dict[str, Any]]:
            return measure_latency(
                observer_user, observer_host, background_rate, duration, loaded_dir, events, False,
                action="latency_priority" if priority_profile else "latency_load",
                priority=7 if priority_profile else 0,
            )

        if order == "baseline-first":
            baseline_sent, baseline = baseline_measurement()
            if STOP_REQUESTED:
                raise RuntimeError("stop requested between comparison phases")
            loaded_sent, loaded = loaded_measurement()
        else:
            loaded_sent, loaded = loaded_measurement()
            if STOP_REQUESTED:
                raise RuntimeError("stop requested between comparison phases")
            baseline_sent, baseline = baseline_measurement()
    finally:
        if priority_profile and manage_profile:
            profile_restore = observer_command(observer_user, observer_host, "priority_restore", timeout=20, output_limit=500_000)
            atomic_json(artifact_dir / "priority-profile-restore.json", profile_restore)
    raw_loaded = json.loads((loaded_dir / "latency-raw.json").read_text(encoding="utf-8"))
    measurement = raw_loaded.get("measurement") if isinstance(raw_loaded, dict) else {}
    background = measurement.get("background") if isinstance(measurement, dict) else {}
    background_sender = background.get("sender") if isinstance(background, dict) else {}
    background_receiver = background.get("receiver") if isinstance(background, dict) else {}
    result = {
        "available": bool(baseline.get("available") and loaded.get("available")),
        "timestampMethod": loaded.get("timestampMethod"),
        "backgroundRatePps": background_rate,
        "backgroundPayloadBytes": 1200,
        "backgroundSentPackets": int(background_sender.get("sent") or 0) if isinstance(background_sender, dict) else 0,
        "backgroundReceivedPackets": int(background_receiver.get("received") or 0) if isinstance(background_receiver, dict) else 0,
        "baseline": baseline,
        "loaded": loaded,
        "meanDeltaNs": round(float(loaded.get("meanNs") or 0) - float(baseline.get("meanNs") or 0), 3),
        "p95DeltaNs": round(float(loaded.get("p95Ns") or 0) - float(baseline.get("p95Ns") or 0), 3),
        "jitterDeltaNs": round(float(loaded.get("jitterStddevNs") or 0) - float(baseline.get("jitterStddevNs") or 0), 3),
        "lossDeltaPercent": round(float(loaded.get("lossPercent") or 0) - float(baseline.get("lossPercent") or 0), 6),
        "priorityProfile": priority_profile,
        "order": order,
        "measurementPriority": 7 if priority_profile else 0,
        "backgroundPriority": 0,
        "priorityProfileApplied": bool(priority_profile and (not manage_profile or profile_apply)),
        "priorityProfileRestored": bool(priority_profile and manage_profile and profile_restore and profile_restore.get("exitCode") == 0),
        "priorityClaim": "vlan-pcp-7-tagged-measurement" if priority_profile else False,
        "interpretation": (
            "VLAN 10 traffic is marked with PCP 7 at sender egress; path captures provide the packet-level forwarding evidence"
            if priority_profile else "background-load comparison; no queue or PCP priority proof"
        ),
    }
    atomic_json(artifact_dir / "latency-load-comparison.json", result)
    with (artifact_dir / "latency-load-comparison.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["profile", "matched_packets", "loss_percent", "mean_ns", "p95_ns", "p99_ns", "jitter_stddev_ns"])
        for profile, value in (("baseline", baseline), ("background_load", loaded)):
            writer.writerow([
                profile, value.get("matchedPackets"), value.get("lossPercent"), value.get("meanNs"),
                value.get("p95Ns"), value.get("p99Ns"), value.get("jitterStddevNs"),
            ])
    append_event(events, "latency_load_comparison_finished", **result)
    return baseline_sent + loaded_sent, result


def capture_runtime_metrics(
    observer_user: str,
    observer_host: str,
    artifact_path: Path,
) -> dict[str, Any]:
    raw = observer_command(
        observer_user, observer_host, "runtime_metrics", timeout=40, output_limit=1_000_000,
    )
    metrics = raw.get("observer") if isinstance(raw.get("observer"), dict) else {}
    atomic_json(artifact_path, {"transport": raw, "metrics": metrics})
    if raw.get("exitCode") != 0 or metrics.get("exitCode") != 0:
        raise RuntimeError("runtime metrics could not be collected")
    return metrics


def runtime_metrics_delta(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    def qdisc_drops(snapshot: dict[str, Any]) -> int:
        total = 0
        qdiscs = snapshot.get("qdisc") if isinstance(snapshot.get("qdisc"), dict) else {}
        for interface in qdiscs.values():
            entries = interface.get("value") if isinstance(interface, dict) else None
            if isinstance(entries, list):
                total += sum(int(entry.get("drops") or 0) for entry in entries if isinstance(entry, dict))
        return total

    result: dict[str, Any] = {}
    for board in ("board1", "board4"):
        earlier = before.get(board) if isinstance(before.get(board), dict) else {}
        later = after.get(board) if isinstance(after.get(board), dict) else {}
        cpu_before = earlier.get("cpu", {}).get("cpu", [])
        cpu_after = later.get("cpu", {}).get("cpu", [])
        cpu_utilization = None
        if isinstance(cpu_before, list) and isinstance(cpu_after, list) and len(cpu_before) >= 5 and len(cpu_after) >= 5:
            total_delta = sum(cpu_after) - sum(cpu_before)
            idle_delta = (cpu_after[3] + cpu_after[4]) - (cpu_before[3] + cpu_before[4])
            if total_delta > 0:
                cpu_utilization = round((total_delta - idle_delta) / total_delta * 100, 3)
        udp_before = earlier.get("snmp", {}).get("Udp", {})
        udp_after = later.get("snmp", {}).get("Udp", {})
        udp_delta = {
            field: int(udp_after.get(field, 0)) - int(udp_before.get(field, 0))
            for field in ("InDatagrams", "NoPorts", "InErrors", "RcvbufErrors", "SndbufErrors")
        }
        interface_delta: dict[str, dict[str, int]] = {}
        earlier_interfaces = earlier.get("interfaces") if isinstance(earlier.get("interfaces"), dict) else {}
        later_interfaces = later.get("interfaces") if isinstance(later.get("interfaces"), dict) else {}
        for interface in sorted(set(earlier_interfaces) & set(later_interfaces)):
            interface_delta[interface] = {
                field: int(later_interfaces[interface].get(field, 0)) - int(earlier_interfaces[interface].get(field, 0))
                for field in ("rx_packets", "tx_packets", "rx_dropped", "tx_dropped", "rx_errors", "tx_errors")
            }
        ethtool_delta: dict[str, dict[str, int]] = {}
        earlier_ethtool = earlier.get("ethtool") if isinstance(earlier.get("ethtool"), dict) else {}
        later_ethtool = later.get("ethtool") if isinstance(later.get("ethtool"), dict) else {}
        selected_ethtool_fields = (
            "rx_good_frames", "rx_broadcast_frames", "rx_multicast_frames", "rx_octets",
            "tx_good_frames", "tx_broadcast_frames", "tx_multicast_frames", "tx_octets",
            "rx_crc_errors", "rx_align_code_errors", "rx_jabber_frames", "iet_rx_smd_err",
            "ale_drop", "rx_port_mask_drop", "ale_vid_ingress_drop", "ale_secure_drop",
            "p0_rx_good_frames", "p0_rx_broadcast_frames",
            "p0_rx_multicast_frames", "p0_tx_good_frames", "p0_tx_broadcast_frames", "p0_tx_multicast_frames",
        )
        for interface in sorted(set(earlier_ethtool) & set(later_ethtool)):
            ethtool_delta[interface] = {
                field: int(later_ethtool[interface].get(field, 0)) - int(earlier_ethtool[interface].get(field, 0))
                for field in selected_ethtool_fields
            }
        frequencies = [int(value) for value in later.get("frequencies", {}).values() if isinstance(value, int)]
        process_before = earlier.get("processCounts") if isinstance(earlier.get("processCounts"), dict) else {}
        process_after = later.get("processCounts") if isinstance(later.get("processCounts"), dict) else {}
        process_delta = {
            marker: int(process_after.get(marker, 0)) - int(process_before.get(marker, 0))
            for marker in ("tsn_latency_probe", "tsn_udp_load", "ssh", "total")
        }
        result[board] = {
            "cpuUtilizationPercent": cpu_utilization,
            "loadAverageAfter": later.get("loadAverage"),
            "memoryAvailableAfterKiB": later.get("memory", {}).get("MemAvailableKiB"),
            "frequencyMinAfterKiHz": min(frequencies) if frequencies else None,
            "frequencyMaxAfterKiHz": max(frequencies) if frequencies else None,
            "udpDelta": udp_delta,
            "interfaceDelta": interface_delta,
            "ethtoolDelta": ethtool_delta,
            "processDelta": process_delta,
            "udpPortsAfter": later.get("udpPorts"),
            "qdiscDropsDelta": qdisc_drops(later) - qdisc_drops(earlier),
        }
    return result


def summarize_priority_series(
    comparisons: list[dict[str, Any]],
    requested_repetitions: int,
    background_rate: int,
    artifact_dir: Path,
) -> dict[str, Any]:
    available = [item for item in comparisons if item.get("available")]
    mean_deltas = [float(item["meanDeltaNs"]) for item in available]
    p95_deltas = [float(item["p95DeltaNs"]) for item in available]
    jitter_deltas = [float(item["jitterDeltaNs"]) for item in available]

    def distribution(values: list[float]) -> dict[str, float | None]:
        if not values:
            return {"mean": None, "stddev": None, "confidence95Lower": None, "confidence95Upper": None}
        mean = statistics.fmean(values)
        stddev = statistics.stdev(values) if len(values) > 1 else 0.0
        half_width = 1.96 * stddev / (len(values) ** 0.5) if len(values) > 1 else 0.0
        return {
            "mean": round(mean, 3),
            "stddev": round(stddev, 3),
            "confidence95Lower": round(mean - half_width, 3),
            "confidence95Upper": round(mean + half_width, 3),
        }

    ordered = sorted(mean_deltas)
    outlier_repetitions: list[int] = []
    if len(ordered) >= 4:
        q1, q3 = percentile(ordered, 0.25), percentile(ordered, 0.75)
        if q1 is not None and q3 is not None:
            lower, upper = q1 - 1.5 * (q3 - q1), q3 + 1.5 * (q3 - q1)
            outlier_repetitions = [
                int(item["repetition"])
                for item in available
                if float(item["meanDeltaNs"]) < lower or float(item["meanDeltaNs"]) > upper
            ]
    order_groups: dict[str, dict[str, Any]] = {}
    for order in ("baseline-first", "load-first"):
        values = [float(item["meanDeltaNs"]) for item in available if item.get("order") == order]
        order_groups[order] = {"repetitions": len(values), **distribution(values)}
    total_baseline_requested = sum(int(item["baseline"].get("requestedPackets") or 0) for item in available)
    total_baseline_matched = sum(int(item["baseline"].get("matchedPackets") or 0) for item in available)
    total_loaded_requested = sum(int(item["loaded"].get("requestedPackets") or 0) for item in available)
    total_loaded_matched = sum(int(item["loaded"].get("matchedPackets") or 0) for item in available)
    background_sent = sum(int(item.get("backgroundSentPackets") or 0) for item in available)
    background_received = sum(int(item.get("backgroundReceivedPackets") or 0) for item in available)
    without_outliers = [item for item in available if int(item["repetition"]) not in outlier_repetitions]
    mean_deltas_without_outliers = [float(item["meanDeltaNs"]) for item in without_outliers]
    loaded_requested_without_outliers = sum(int(item["loaded"].get("requestedPackets") or 0) for item in without_outliers)
    loaded_matched_without_outliers = sum(int(item["loaded"].get("matchedPackets") or 0) for item in without_outliers)

    runtime_summary: dict[str, Any] = {}
    runtime_anomaly_repetitions: set[int] = set()
    for board in ("board1", "board4"):
        board_values = [
            item.get("runtime", {}).get(board, {})
            for item in available
            if isinstance(item.get("runtime", {}).get(board), dict)
        ]
        cpu_values = [float(value["cpuUtilizationPercent"]) for value in board_values if isinstance(value.get("cpuUtilizationPercent"), (int, float))]
        memory_values = [int(value["memoryAvailableAfterKiB"]) for value in board_values if isinstance(value.get("memoryAvailableAfterKiB"), int)]
        frequency_min_values = [int(value["frequencyMinAfterKiHz"]) for value in board_values if isinstance(value.get("frequencyMinAfterKiHz"), int)]
        frequency_max_values = [int(value["frequencyMaxAfterKiHz"]) for value in board_values if isinstance(value.get("frequencyMaxAfterKiHz"), int)]
        udp_fields = ("NoPorts", "InErrors", "RcvbufErrors", "SndbufErrors")
        udp_totals = {
            field: sum(int(value.get("udpDelta", {}).get(field, 0)) for value in board_values)
            for field in udp_fields
        }
        qdisc_drops = sum(int(value.get("qdiscDropsDelta") or 0) for value in board_values)
        phy_fields = ("rx_crc_errors", "rx_align_code_errors", "rx_jabber_frames", "iet_rx_smd_err", "rx_port_mask_drop")
        phy_error_totals = {
            field: sum(
                int(value.get("ethtoolDelta", {}).get("eth0", {}).get(field, 0))
                for value in board_values
            )
            for field in phy_fields
        }
        interface_drop_totals: dict[str, dict[str, int]] = {}
        for value in board_values:
            for interface, counters in value.get("interfaceDelta", {}).items():
                target = interface_drop_totals.setdefault(interface, {"rx_dropped": 0, "tx_dropped": 0, "rx_errors": 0, "tx_errors": 0})
                for field in target:
                    target[field] += int(counters.get(field, 0))
        runtime_summary[board] = {
            "samples": len(board_values),
            "cpuUtilizationMeanPercent": round(statistics.fmean(cpu_values), 3) if cpu_values else None,
            "cpuUtilizationMaxPercent": round(max(cpu_values), 3) if cpu_values else None,
            "memoryAvailableMinKiB": min(memory_values) if memory_values else None,
            "frequencyMinKiHz": min(frequency_min_values) if frequency_min_values else None,
            "frequencyMaxKiHz": max(frequency_max_values) if frequency_max_values else None,
            "udpErrorDeltas": udp_totals,
            "qdiscDropsDelta": qdisc_drops,
            "phyErrorDeltas": phy_error_totals,
            "interfaceDropDeltas": interface_drop_totals,
        }
    for item in available:
        repetition = int(item["repetition"])
        for board in ("board1", "board4"):
            value = item.get("runtime", {}).get(board, {})
            udp = value.get("udpDelta", {}) if isinstance(value, dict) else {}
            processes = value.get("processDelta", {}) if isinstance(value, dict) else {}
            if (
                any(int(udp.get(field, 0)) > 0 for field in ("InErrors", "RcvbufErrors", "SndbufErrors"))
                or int(value.get("qdiscDropsDelta") or 0) > 0
                or any(
                    int(value.get("ethtoolDelta", {}).get("eth0", {}).get(field, 0)) > 0
                    for field in ("rx_crc_errors", "rx_align_code_errors", "rx_jabber_frames", "iet_rx_smd_err", "rx_port_mask_drop")
                )
                or int(processes.get("tsn_latency_probe", 0)) != 0
                or int(processes.get("tsn_udp_load", 0)) != 0
            ):
                runtime_anomaly_repetitions.add(repetition)
    result = {
        "available": bool(available),
        "requestedRepetitions": requested_repetitions,
        "completedRepetitions": len(available),
        "backgroundRatePps": background_rate,
        "backgroundPayloadBytes": 1200,
        "timestampMethods": sorted({str(item.get("timestampMethod")) for item in available}),
        "meanDeltaNs": distribution(mean_deltas),
        "p95DeltaNs": distribution(p95_deltas),
        "jitterDeltaNs": distribution(jitter_deltas),
        "orderGroups": order_groups,
        "baselineRequestedPackets": total_baseline_requested,
        "baselineMatchedPackets": total_baseline_matched,
        "baselineLossPercent": round((total_baseline_requested - total_baseline_matched) / total_baseline_requested * 100, 6) if total_baseline_requested else None,
        "loadedRequestedPackets": total_loaded_requested,
        "loadedMatchedPackets": total_loaded_matched,
        "loadedLossPercent": round((total_loaded_requested - total_loaded_matched) / total_loaded_requested * 100, 6) if total_loaded_requested else None,
        "backgroundSentPackets": background_sent,
        "backgroundReceivedPackets": background_received,
        "backgroundLossPercent": round((background_sent - background_received) / background_sent * 100, 6) if background_sent else None,
        "outlierRule": "1.5-IQR-of-mean-deltas",
        "outlierRepetitions": outlier_repetitions,
        "sensitivityExcludingOutliers": {
            "repetitions": len(without_outliers),
            "meanDeltaNs": distribution(mean_deltas_without_outliers),
            "loadedLossPercent": round(
                (loaded_requested_without_outliers - loaded_matched_without_outliers)
                / loaded_requested_without_outliers * 100,
                6,
            ) if loaded_requested_without_outliers else None,
        },
        "runtimeDiagnostics": runtime_summary,
        "runtimeAnomalyRepetitions": sorted(runtime_anomaly_repetitions),
        "confidence95Method": "normal-approximation-of-paired-run-deltas",
        "priorityClaim": "vlan-pcp-7-tagged-measurement",
    }
    with (artifact_dir / "priority-series-runs.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow([
            "repetition", "order", "baseline_matched", "loaded_matched", "baseline_loss_percent",
            "loaded_loss_percent", "baseline_mean_ns", "loaded_mean_ns", "mean_delta_ns",
            "baseline_p95_ns", "loaded_p95_ns", "p95_delta_ns", "jitter_delta_ns", "outlier_mean_delta",
            "board1_cpu_percent", "board4_cpu_percent", "board1_udp_in_errors", "board4_udp_in_errors",
            "board1_qdisc_drops", "board4_qdisc_drops", "runtime_anomaly",
            "board1_rx_dropped", "board4_rx_dropped", "board1_memory_available_kib",
            "board4_memory_available_kib", "board1_probe_process_delta", "board4_probe_process_delta",
            "board1_rx_broadcast", "board1_rx_multicast", "board4_rx_broadcast", "board4_rx_multicast",
            "board1_crc_errors", "board1_align_errors", "board1_jabber_frames", "board1_smd_errors", "board1_port_mask_drops",
            "board4_crc_errors", "board4_align_errors", "board4_jabber_frames", "board4_smd_errors", "board4_port_mask_drops",
        ])
        for item in available:
            writer.writerow([
                item["repetition"], item["order"], item["baseline"].get("matchedPackets"),
                item["loaded"].get("matchedPackets"), item["baseline"].get("lossPercent"),
                item["loaded"].get("lossPercent"), item["baseline"].get("meanNs"), item["loaded"].get("meanNs"),
                item["meanDeltaNs"], item["baseline"].get("p95Ns"), item["loaded"].get("p95Ns"),
                item["p95DeltaNs"], item["jitterDeltaNs"], item["repetition"] in outlier_repetitions,
                item.get("runtime", {}).get("board1", {}).get("cpuUtilizationPercent"),
                item.get("runtime", {}).get("board4", {}).get("cpuUtilizationPercent"),
                item.get("runtime", {}).get("board1", {}).get("udpDelta", {}).get("InErrors"),
                item.get("runtime", {}).get("board4", {}).get("udpDelta", {}).get("InErrors"),
                item.get("runtime", {}).get("board1", {}).get("qdiscDropsDelta"),
                item.get("runtime", {}).get("board4", {}).get("qdiscDropsDelta"),
                item["repetition"] in runtime_anomaly_repetitions,
                sum(
                    int(value.get("rx_dropped", 0))
                    for value in item.get("runtime", {}).get("board1", {}).get("interfaceDelta", {}).values()
                ),
                sum(
                    int(value.get("rx_dropped", 0))
                    for value in item.get("runtime", {}).get("board4", {}).get("interfaceDelta", {}).values()
                ),
                item.get("runtime", {}).get("board1", {}).get("memoryAvailableAfterKiB"),
                item.get("runtime", {}).get("board4", {}).get("memoryAvailableAfterKiB"),
                item.get("runtime", {}).get("board1", {}).get("processDelta", {}).get("tsn_latency_probe"),
                item.get("runtime", {}).get("board4", {}).get("processDelta", {}).get("tsn_latency_probe"),
                item.get("runtime", {}).get("board1", {}).get("ethtoolDelta", {}).get("eth0", {}).get("rx_broadcast_frames"),
                item.get("runtime", {}).get("board1", {}).get("ethtoolDelta", {}).get("eth0", {}).get("rx_multicast_frames"),
                item.get("runtime", {}).get("board4", {}).get("ethtoolDelta", {}).get("eth0", {}).get("rx_broadcast_frames"),
                item.get("runtime", {}).get("board4", {}).get("ethtoolDelta", {}).get("eth0", {}).get("rx_multicast_frames"),
                item.get("runtime", {}).get("board1", {}).get("ethtoolDelta", {}).get("eth0", {}).get("rx_crc_errors"),
                item.get("runtime", {}).get("board1", {}).get("ethtoolDelta", {}).get("eth0", {}).get("rx_align_code_errors"),
                item.get("runtime", {}).get("board1", {}).get("ethtoolDelta", {}).get("eth0", {}).get("rx_jabber_frames"),
                item.get("runtime", {}).get("board1", {}).get("ethtoolDelta", {}).get("eth0", {}).get("iet_rx_smd_err"),
                item.get("runtime", {}).get("board1", {}).get("ethtoolDelta", {}).get("eth0", {}).get("rx_port_mask_drop"),
                item.get("runtime", {}).get("board4", {}).get("ethtoolDelta", {}).get("eth0", {}).get("rx_crc_errors"),
                item.get("runtime", {}).get("board4", {}).get("ethtoolDelta", {}).get("eth0", {}).get("rx_align_code_errors"),
                item.get("runtime", {}).get("board4", {}).get("ethtoolDelta", {}).get("eth0", {}).get("rx_jabber_frames"),
                item.get("runtime", {}).get("board4", {}).get("ethtoolDelta", {}).get("eth0", {}).get("iet_rx_smd_err"),
                item.get("runtime", {}).get("board4", {}).get("ethtoolDelta", {}).get("eth0", {}).get("rx_port_mask_drop"),
            ])
    atomic_json(artifact_dir / "priority-series-summary.json", result)
    return result


def measure_priority_series(
    observer_user: str,
    observer_host: str,
    background_rate: int,
    duration: int,
    repetitions: int,
    artifact_dir: Path,
    events: Path,
    state: dict[str, Any],
    state_path: Path,
    dry_run: bool,
) -> tuple[int, dict[str, Any]]:
    if dry_run:
        for repetition in range(1, repetitions + 1):
            if STOP_REQUESTED:
                break
            state.update({"phase": "priority_series_dry_run", "stage": repetition, "repetitions": repetitions})
            atomic_json(state_path, state)
            time.sleep(0.02)
        result = summarize_priority_series([], repetitions, background_rate, artifact_dir)
        result["reason"] = "dry-run"
        atomic_json(artifact_dir / "priority-series-summary.json", result)
        return 0, result

    series_dir = artifact_dir / "priority-series"
    series_dir.mkdir(exist_ok=True)
    comparisons: list[dict[str, Any]] = []
    sent_total = 0
    profile_apply = observer_command(observer_user, observer_host, "priority_apply", timeout=20, output_limit=500_000)
    atomic_json(artifact_dir / "priority-profile-apply.json", profile_apply)
    nested_apply = profile_apply.get("observer") if isinstance(profile_apply.get("observer"), dict) else {}
    if profile_apply.get("exitCode") != 0 or nested_apply.get("exitCode") != 0:
        raise RuntimeError("priority profile could not be applied")
    profile_restore: dict[str, Any] | None = None
    capture_started = False
    measurement_path_summary: dict[str, Any] = {"available": False, "reason": "capture not started"}
    try:
        capture_start = observer_command(observer_user, observer_host, "measurement_capture_start", timeout=30)
        atomic_json(artifact_dir / "measurement-capture-start.json", capture_start)
        nested_capture_start = capture_start.get("observer") if isinstance(capture_start.get("observer"), dict) else {}
        if capture_start.get("exitCode") != 0 or nested_capture_start.get("exitCode") != 0:
            raise RuntimeError("bounded measurement path captures could not be started")
        capture_started = True
        for repetition in range(1, repetitions + 1):
            if STOP_REQUESTED:
                break
            order = "baseline-first" if repetition % 2 else "load-first"
            state.update({"phase": "priority_series_measurement", "stage": repetition, "repetitions": repetitions, "order": order})
            atomic_json(state_path, state)
            repetition_dir = series_dir / f"{repetition:02d}"
            repetition_dir.mkdir(exist_ok=False)
            append_event(events, "priority_series_repetition_started", repetition=repetition, order=order)
            metrics_before = capture_runtime_metrics(
                observer_user, observer_host, repetition_dir / "runtime-before.json",
            )
            try:
                sent, comparison = measure_latency_load_comparison(
                    observer_user, observer_host, background_rate, duration, repetition_dir, events, False,
                    priority_profile=True, order=order, manage_profile=False,
                )
            finally:
                metrics_after = capture_runtime_metrics(
                    observer_user, observer_host, repetition_dir / "runtime-after.json",
                )
            diagnostic = runtime_metrics_delta(metrics_before, metrics_after)
            atomic_json(repetition_dir / "runtime-summary.json", diagnostic)
            comparison = {"repetition": repetition, **comparison, "runtime": diagnostic}
            atomic_json(repetition_dir / "latency-load-comparison.json", comparison)
            comparisons.append(comparison)
            sent_total += sent
            append_event(events, "priority_series_repetition_finished", repetition=repetition, order=order)
    finally:
        try:
            if capture_started:
                capture_stop = observer_command(observer_user, observer_host, "measurement_capture_stop", timeout=90, output_limit=100_000)
                atomic_json(artifact_dir / "measurement-capture-stop.json", capture_stop)
                nested_capture_stop = capture_stop.get("observer") if isinstance(capture_stop.get("observer"), dict) else {}
                if capture_stop.get("exitCode") == 0 and nested_capture_stop.get("exitCode") == 0:
                    copies: dict[str, Any] = {}
                    local_paths: dict[str, Path] = {}
                    for entry in nested_capture_stop.get("captures", []):
                        if not isinstance(entry, dict) or not isinstance(entry.get("name"), str) or not isinstance(entry.get("localFile"), str):
                            continue
                        name = entry["name"]
                        destination = artifact_dir / f"{name}.pcap"
                        capture_copy = run_command([
                            "scp", "-q", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
                            f"{observer_user}@{observer_host}:{entry['localFile']}", str(destination),
                        ], timeout=60)
                        copies[name] = capture_copy
                        if capture_copy.get("exitCode") == 0 and destination.is_file():
                            local_paths[name] = destination
                        local_log = entry.get("localLog")
                        if isinstance(local_log, str):
                            log_destination = artifact_dir / f"{name}-capture.log"
                            copies[f"{name}-log"] = run_command([
                                "scp", "-q", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
                                f"{observer_user}@{observer_host}:{local_log}", str(log_destination),
                            ], timeout=30)
                    atomic_json(artifact_dir / "measurement-capture-copy.json", copies)
                    egress = local_paths.get("board4-egress")
                    ingress = local_paths.get("board1-ingress")
                    if egress and ingress:
                        measurement_path_summary = compare_measurement_captures(egress, ingress, artifact_dir)
                    else:
                        measurement_path_summary = {"available": False, "reason": "capture export failed", "copies": copies}
                else:
                    measurement_path_summary = {"available": False, "reason": "capture stop failed"}
        finally:
            profile_restore = observer_command(observer_user, observer_host, "priority_restore", timeout=20, output_limit=500_000)
            atomic_json(artifact_dir / "priority-profile-restore.json", profile_restore)
    result = summarize_priority_series(comparisons, repetitions, background_rate, artifact_dir)
    result["priorityProfileApplied"] = True
    result["priorityProfileRestored"] = bool(profile_restore and profile_restore.get("exitCode") == 0)
    result["measurementPathCapture"] = measurement_path_summary
    atomic_json(artifact_dir / "priority-series-summary.json", result)
    append_event(events, "priority_series_finished", **result)
    return sent_total, result


def summarize_latency_series(
    summaries: list[dict[str, Any]],
    requested_repetitions: int,
    artifact_dir: Path,
) -> dict[str, Any]:
    available = [item for item in summaries if item.get("available")]
    run_means = [float(item["meanNs"]) for item in available if isinstance(item.get("meanNs"), (int, float))]
    run_p95 = [float(item["p95Ns"]) for item in available if isinstance(item.get("p95Ns"), (int, float))]
    run_jitter = [float(item["jitterStddevNs"]) for item in available if isinstance(item.get("jitterStddevNs"), (int, float))]
    total_requested = sum(int(item.get("requestedPackets") or 0) for item in available)
    total_sent = sum(int(item.get("sentPackets") or 0) for item in available)
    total_matched = sum(int(item.get("matchedPackets") or 0) for item in available)
    total_lost = max(0, total_requested - total_matched)
    mean_of_means = statistics.fmean(run_means) if run_means else None
    stddev_of_means = statistics.stdev(run_means) if len(run_means) > 1 else 0 if run_means else None
    confidence_half_width = (
        1.96 * stddev_of_means / (len(run_means) ** 0.5)
        if len(run_means) > 1 and isinstance(stddev_of_means, float)
        else 0 if run_means else None
    )
    outlier_repetitions: list[int] = []
    if len(run_means) >= 4:
        ordered = sorted(run_means)
        q1 = percentile(ordered, 0.25)
        q3 = percentile(ordered, 0.75)
        if q1 is not None and q3 is not None:
            lower, upper = q1 - 1.5 * (q3 - q1), q3 + 1.5 * (q3 - q1)
            outlier_repetitions = [
                int(item.get("repetition") or index)
                for index, (item, value) in enumerate(zip(available, run_means), start=1)
                if value < lower or value > upper
            ]
    summary = {
        "available": bool(run_means),
        "requestedRepetitions": requested_repetitions,
        "completedRepetitions": len(available),
        "timestampMethods": sorted({str(item.get("timestampMethod")) for item in available}),
        "totalRequestedPackets": total_requested,
        "totalSentPackets": total_sent,
        "totalMatchedPackets": total_matched,
        "totalLostPackets": total_lost,
        "totalLossPercent": round(total_lost / total_requested * 100, 6) if total_requested else None,
        "meanOfRunMeansNs": round(mean_of_means, 3) if mean_of_means is not None else None,
        "stddevOfRunMeansNs": round(stddev_of_means, 3) if stddev_of_means is not None else None,
        "confidence95Method": "normal-approximation-of-run-means",
        "confidence95LowerNs": round(mean_of_means - confidence_half_width, 3) if mean_of_means is not None and confidence_half_width is not None else None,
        "confidence95UpperNs": round(mean_of_means + confidence_half_width, 3) if mean_of_means is not None and confidence_half_width is not None else None,
        "runMeanMinNs": round(min(run_means), 3) if run_means else None,
        "runMeanMaxNs": round(max(run_means), 3) if run_means else None,
        "p95MeanNs": round(statistics.fmean(run_p95), 3) if run_p95 else None,
        "p95MinNs": round(min(run_p95), 3) if run_p95 else None,
        "p95MaxNs": round(max(run_p95), 3) if run_p95 else None,
        "jitterMeanNs": round(statistics.fmean(run_jitter), 3) if run_jitter else None,
        "jitterMinNs": round(min(run_jitter), 3) if run_jitter else None,
        "jitterMaxNs": round(max(run_jitter), 3) if run_jitter else None,
        "outlierRule": "1.5-IQR-of-run-means",
        "outlierRepetitions": outlier_repetitions,
    }
    with (artifact_dir / "latency-series-runs.csv").open("w", encoding="utf-8", newline="") as handle:
        fields = [
            "repetition", "timestamp_method", "requested_packets", "matched_packets", "loss_percent",
            "mean_ns", "p95_ns", "p99_ns", "max_ns", "jitter_stddev_ns", "outlier_run_mean",
        ]
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for index, item in enumerate(available, start=1):
            repetition = int(item.get("repetition") or index)
            writer.writerow({
                "repetition": repetition,
                "timestamp_method": item.get("timestampMethod"),
                "requested_packets": item.get("requestedPackets"),
                "matched_packets": item.get("matchedPackets"),
                "loss_percent": item.get("lossPercent"),
                "mean_ns": item.get("meanNs"),
                "p95_ns": item.get("p95Ns"),
                "p99_ns": item.get("p99Ns"),
                "max_ns": item.get("maxNs"),
                "jitter_stddev_ns": item.get("jitterStddevNs"),
                "outlier_run_mean": repetition in outlier_repetitions,
            })
    atomic_json(artifact_dir / "latency-series-summary.json", summary)
    return summary


def measure_latency_series(
    observer_user: str,
    observer_host: str,
    rate: int,
    duration: int,
    repetitions: int,
    artifact_dir: Path,
    events: Path,
    state: dict[str, Any],
    state_path: Path,
    dry_run: bool,
) -> tuple[int, dict[str, Any]]:
    series_dir = artifact_dir / "latency-series"
    series_dir.mkdir(exist_ok=True)
    summaries: list[dict[str, Any]] = []
    sent_total = 0
    append_event(events, "latency_series_started", repetitions=repetitions, ratePps=rate, durationSeconds=duration, dryRun=dry_run)
    if dry_run:
        for repetition in range(1, repetitions + 1):
            if STOP_REQUESTED:
                break
            state["phase"] = "latency_series_dry_run"
            state["stage"] = repetition
            state["repetitions"] = repetitions
            atomic_json(state_path, state)
            time.sleep(0.02)
        result = summarize_latency_series([], repetitions, artifact_dir)
        result["reason"] = "dry-run"
        atomic_json(artifact_dir / "latency-series-summary.json", result)
        return 0, result
    for repetition in range(1, repetitions + 1):
        if STOP_REQUESTED:
            break
        state["phase"] = "latency_series_measurement"
        state["stage"] = repetition
        state["repetitions"] = repetitions
        atomic_json(state_path, state)
        repetition_dir = series_dir / f"{repetition:02d}"
        repetition_dir.mkdir(exist_ok=False)
        append_event(events, "latency_series_repetition_started", repetition=repetition)
        sent, summary = measure_latency(
            observer_user, observer_host, rate, duration, repetition_dir, events, False,
        )
        summary = {"repetition": repetition, **summary}
        summaries.append(summary)
        sent_total += sent
        append_event(events, "latency_series_repetition_finished", **summary)
    result = summarize_latency_series(summaries, repetitions, artifact_dir)
    append_event(events, "latency_series_finished", **result)
    return sent_total, result


def parse_pcap(data: bytes) -> list[dict[str, Any]]:
    if len(data) < 24:
        return []
    magic = data[:4]
    if magic == b"\xd4\xc3\xb2\xa1":
        endian, divisor = "<", 1_000_000
    elif magic == b"\x4d\x3c\xb2\xa1":
        endian, divisor = "<", 1_000_000_000
    elif magic == b"\xa1\xb2\xc3\xd4":
        endian, divisor = ">", 1_000_000
    elif magic == b"\xa1\xb2\x3c\x4d":
        endian, divisor = ">", 1_000_000_000
    else:
        return []
    records: list[dict[str, Any]] = []
    offset = 24
    while offset + 16 <= len(data):
        seconds, fraction, captured_length, original_length = struct.unpack_from(endian + "IIII", data, offset)
        offset += 16
        if captured_length > 16_777_216 or offset + captured_length > len(data):
            break
        packet = data[offset:offset + captured_length]
        offset += captured_length
        ether_type = struct.unpack("!H", packet[12:14])[0] if len(packet) >= 14 else None
        payload_offset = 14
        if ether_type == 0x8100 and len(packet) >= 18:
            ether_type = struct.unpack("!H", packet[16:18])[0]
            payload_offset = 18
        record: dict[str, Any] = {
            "epoch": seconds + fraction / divisor,
            "capturedLength": captured_length,
            "originalLength": original_length,
            "etherType": ether_type,
            "destinationMac": packet[0:6].hex(":") if len(packet) >= 6 else None,
            "sourceMac": packet[6:12].hex(":") if len(packet) >= 12 else None,
        }
        destination = packet[0:6] if len(packet) >= 6 else b""
        if destination == b"\xff" * 6:
            record["destinationKind"] = "broadcast"
        elif destination and destination[0] & 1:
            record["destinationKind"] = "multicast"
        else:
            record["destinationKind"] = "unicast"
        if ether_type == 0x88F7 and len(packet) >= payload_offset + 34:
            ptp = packet[payload_offset:]
            record["messageType"] = ptp[0] & 0x0F
            record["sequenceId"] = struct.unpack("!H", ptp[30:32])[0]
            record["ptpVersion"] = ptp[1]
            record["ptpDomain"] = ptp[4]
            record["ptpFlags"] = struct.unpack("!H", ptp[6:8])[0]
            record["ptpMessageLength"] = struct.unpack("!H", ptp[2:4])[0]
            record["ptpLogInterval"] = struct.unpack("!b", ptp[33:34])[0]
        elif ether_type == 0x0800 and len(packet) >= payload_offset + 20:
            ip = packet[payload_offset:]
            header_length = (ip[0] & 0x0F) * 4
            record["ipVersion"] = 4
            record["ipProtocol"] = ip[9]
            record["sourceIp"] = socket.inet_ntop(socket.AF_INET, ip[12:16])
            record["destinationIp"] = socket.inet_ntop(socket.AF_INET, ip[16:20])
            if ip[9] in {6, 17} and len(ip) >= header_length + 4:
                record["sourcePort"], record["destinationPort"] = struct.unpack("!HH", ip[header_length:header_length + 4])
                if ip[9] == 17 and len(ip) >= header_length + 16:
                    udp_payload = ip[header_length + 8:]
                    if udp_payload[:4] in {b"TSNL", b"TSNB"}:
                        record["testFlow"] = udp_payload[:4].decode("ascii")
                        record["testSequence"] = struct.unpack("!I", udp_payload[4:8])[0]
        elif ether_type == 0x86DD and len(packet) >= payload_offset + 40:
            ip = packet[payload_offset:]
            record["ipVersion"] = 6
            record["ipProtocol"] = ip[6]
            record["sourceIp"] = socket.inet_ntop(socket.AF_INET6, ip[8:24])
            record["destinationIp"] = socket.inet_ntop(socket.AF_INET6, ip[24:40])
            if ip[6] in {6, 17} and len(ip) >= 44:
                record["sourcePort"], record["destinationPort"] = struct.unpack("!HH", ip[40:44])
        elif ether_type == 0x0806 and len(packet) >= payload_offset + 28:
            arp = packet[payload_offset:]
            record["arpOperation"] = struct.unpack("!H", arp[6:8])[0]
            if arp[4] == 6 and arp[5] == 4:
                record["sourceIp"] = socket.inet_ntop(socket.AF_INET, arp[14:18])
                record["destinationIp"] = socket.inet_ntop(socket.AF_INET, arp[24:28])
        records.append(record)
    return records


def classify_burst_capture(capture_path: Path, artifact_dir: Path) -> dict[str, Any]:
    data = capture_path.read_bytes()
    records = parse_pcap(data)
    ether_types: dict[str, int] = {}
    destination_kinds: dict[str, int] = {}
    protocols: dict[str, int] = {}
    source_macs: dict[str, int] = {}
    destination_macs: dict[str, int] = {}
    bins: dict[int, int] = {}
    for record in records:
        ether_type = record.get("etherType")
        ether_key = f"0x{ether_type:04x}" if isinstance(ether_type, int) else "unknown"
        ether_types[ether_key] = ether_types.get(ether_key, 0) + 1
        kind = str(record.get("destinationKind") or "unknown")
        destination_kinds[kind] = destination_kinds.get(kind, 0) + 1
        source_mac = str(record.get("sourceMac") or "unknown")
        destination_mac = str(record.get("destinationMac") or "unknown")
        source_macs[source_mac] = source_macs.get(source_mac, 0) + 1
        destination_macs[destination_mac] = destination_macs.get(destination_mac, 0) + 1
        protocol = "other"
        if ether_type == 0x0806:
            protocol = "arp"
        elif record.get("ipVersion") in {4, 6}:
            name = {1: "icmp", 6: "tcp", 17: "udp", 58: "icmpv6"}.get(record.get("ipProtocol"), str(record.get("ipProtocol")))
            protocol = f"ipv{record['ipVersion']}-{name}"
            if isinstance(record.get("destinationPort"), int):
                protocol += f"-dport-{record['destinationPort']}"
        protocols[protocol] = protocols.get(protocol, 0) + 1
        bin_start = int(float(record["epoch"]) // 10 * 10)
        bins[bin_start] = bins.get(bin_start, 0) + 1

    def top(values: dict[str, int], limit: int = 12) -> list[dict[str, Any]]:
        return [{"value": key, "packets": count} for key, count in sorted(values.items(), key=lambda item: (-item[1], item[0]))[:limit]]

    with (artifact_dir / "board4-capture-bins.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["bin_start_epoch", "packets"])
        for start, count in sorted(bins.items()):
            writer.writerow([start, count])
    summary = {
        "available": True,
        "file": capture_path.name,
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "packets": len(records),
        "etherTypes": ether_types,
        "destinationKinds": destination_kinds,
        "protocols": protocols,
        "topSourceMacs": top(source_macs),
        "topDestinationMacs": top(destination_macs),
        "topTenSecondBins": [
            {"startEpoch": start, "packets": count}
            for start, count in sorted(bins.items(), key=lambda item: (-item[1], item[0]))[:12]
        ],
    }
    atomic_json(artifact_dir / "board4-capture-summary.json", summary)
    return summary


def compare_measurement_captures(egress_path: Path, ingress_path: Path, artifact_dir: Path) -> dict[str, Any]:
    def flow_counts(path: Path) -> dict[str, dict[int, int]]:
        values: dict[str, dict[int, int]] = {"TSNL": {}, "TSNB": {}}
        for record in parse_pcap(path.read_bytes()):
            flow = record.get("testFlow")
            sequence = record.get("testSequence")
            if flow in values and isinstance(sequence, int):
                values[flow][sequence] = values[flow].get(sequence, 0) + 1
        return values

    egress = flow_counts(egress_path)
    ingress = flow_counts(ingress_path)
    flows: dict[str, Any] = {}
    with (artifact_dir / "measurement-path-comparison.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["flow", "sequence", "egress_count", "ingress_count", "missing_at_ingress"])
        for flow in ("TSNL", "TSNB"):
            sequences = sorted(set(egress[flow]) | set(ingress[flow]))
            missing_occurrences = 0
            missing_sequences: list[dict[str, int]] = []
            for sequence in sequences:
                egress_count = egress[flow].get(sequence, 0)
                ingress_count = ingress[flow].get(sequence, 0)
                missing = max(0, egress_count - ingress_count)
                missing_occurrences += missing
                if missing:
                    missing_sequences.append({"sequence": sequence, "occurrences": missing})
                writer.writerow([flow, sequence, egress_count, ingress_count, missing])
            flows[flow] = {
                "egressPackets": sum(egress[flow].values()),
                "ingressPackets": sum(ingress[flow].values()),
                "missingAtIngress": missing_occurrences,
                "extraAtIngress": max(0, sum(ingress[flow].values()) - sum(egress[flow].values())),
                "missingSequences": missing_sequences[:100],
            }
    summary = {
        "available": True,
        "board4Egress": {"file": egress_path.name, "size": egress_path.stat().st_size, "sha256": hashlib.sha256(egress_path.read_bytes()).hexdigest()},
        "board1Ingress": {"file": ingress_path.name, "size": ingress_path.stat().st_size, "sha256": hashlib.sha256(ingress_path.read_bytes()).hexdigest()},
        "flows": flows,
    }
    atomic_json(artifact_dir / "measurement-path-summary.json", summary)
    return summary


def compare_fuzzing_measurement_captures(
    egress_path: Path, ingress_path: Path, artifact_dir: Path, requested_frames: int,
) -> dict[str, Any]:
    def mutation_counts(path: Path) -> tuple[dict[int, int], dict[str, int]]:
        sequences: dict[int, int] = {}
        mutations = {str(index): 0 for index in range(5)}
        for record in parse_pcap(path.read_bytes()):
            if record.get("etherType") != 0x88F7:
                continue
            mutation = classify_fuzz_mutation(record)
            sequence = record.get("sequenceId")
            if mutation not in range(5) or not isinstance(sequence, int) or not 0 <= sequence < requested_frames:
                continue
            sequences[sequence] = sequences.get(sequence, 0) + 1
            mutations[str(mutation)] += 1
        return sequences, mutations

    egress, egress_mutations = mutation_counts(egress_path)
    ingress, ingress_mutations = mutation_counts(ingress_path)
    missing_occurrences = 0
    missing_sequences: list[dict[str, int]] = []
    with (artifact_dir / "fuzzing-path-comparison.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["sequence", "egress_count", "ingress_count", "missing_at_ingress"])
        for sequence in sorted(set(egress) | set(ingress)):
            egress_count = egress.get(sequence, 0)
            ingress_count = ingress.get(sequence, 0)
            missing = max(0, egress_count - ingress_count)
            missing_occurrences += missing
            if missing:
                missing_sequences.append({"sequence": sequence, "occurrences": missing})
            writer.writerow([sequence, egress_count, ingress_count, missing])
    summary = {
        "available": True,
        "board4Egress": {"file": egress_path.name, "size": egress_path.stat().st_size, "sha256": hashlib.sha256(egress_path.read_bytes()).hexdigest()},
        "board1Ingress": {"file": ingress_path.name, "size": ingress_path.stat().st_size, "sha256": hashlib.sha256(ingress_path.read_bytes()).hexdigest()},
        "egressPackets": sum(egress.values()),
        "ingressPackets": sum(ingress.values()),
        "missingAtIngress": missing_occurrences,
        "extraAtIngress": max(0, sum(ingress.values()) - sum(egress.values())),
        "missingSequences": missing_sequences[:100],
        "mutationCounts": {"egress": egress_mutations, "ingress": ingress_mutations},
    }
    atomic_json(artifact_dir / "fuzzing-path-summary.json", summary)
    return summary


def start_fuzzing_path_capture(observer_user: str, observer_host: str, artifact_dir: Path) -> None:
    result = observer_command(observer_user, observer_host, "measurement_capture_start", timeout=30)
    atomic_json(artifact_dir / "fuzzing-measurement-capture-start.json", result)
    nested = result.get("observer") if isinstance(result.get("observer"), dict) else {}
    if result.get("exitCode") != 0 or nested.get("exitCode") != 0:
        raise RuntimeError("fuzzing path captures could not be started")


def finish_fuzzing_path_capture(
    observer_user: str, observer_host: str, artifact_dir: Path, requested_frames: int,
) -> dict[str, Any]:
    result = observer_command(observer_user, observer_host, "measurement_capture_stop", timeout=90, output_limit=100_000)
    atomic_json(artifact_dir / "fuzzing-measurement-capture-stop.json", result)
    nested = result.get("observer") if isinstance(result.get("observer"), dict) else {}
    if result.get("exitCode") != 0 or nested.get("exitCode") != 0:
        return {"available": False, "reason": "capture stop failed"}
    copies: dict[str, Any] = {}
    local_paths: dict[str, Path] = {}
    for entry in nested.get("captures", []):
        if not isinstance(entry, dict) or not isinstance(entry.get("name"), str) or not isinstance(entry.get("localFile"), str):
            continue
        name = entry["name"]
        destination = artifact_dir / f"{name}.pcap"
        copy = run_command([
            "scp", "-q", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
            f"{observer_user}@{observer_host}:{entry['localFile']}", str(destination),
        ], timeout=60)
        copies[name] = copy
        if copy.get("exitCode") == 0 and destination.is_file():
            local_paths[name] = destination
    atomic_json(artifact_dir / "fuzzing-measurement-capture-copy.json", copies)
    egress = local_paths.get("board4-egress")
    ingress = local_paths.get("board1-ingress")
    if not egress or not ingress:
        return {"available": False, "reason": "capture export failed", "copies": copies}
    return compare_fuzzing_measurement_captures(egress, ingress, artifact_dir, requested_frames)


def correlate(capture_path: Path | None, artifact_dir: Path, events: Path) -> dict[str, Any]:
    if capture_path is None or not capture_path.exists():
        return {"available": False, "reason": "no capture"}
    data = capture_path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    records = parse_pcap(data)
    ptp_records = [record for record in records if record.get("etherType") == 0x88F7]
    with (artifact_dir / "timestamp-correlation.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["frame_time_epoch", "source_mac", "message_type", "sequence_id", "captured_length"])
        for record in ptp_records:
            writer.writerow([
                f"{record['epoch']:.9f}", record.get("sourceMac"), record.get("messageType"),
                record.get("sequenceId"), record.get("capturedLength"),
            ])
    ether_type_counts: dict[str, int] = {}
    for record in records:
        key = f"0x{record['etherType']:04x}" if isinstance(record.get("etherType"), int) else "unknown"
        ether_type_counts[key] = ether_type_counts.get(key, 0) + 1
    result: dict[str, Any] = {
        "available": True,
        "file": capture_path.name,
        "sha256": digest,
        "size": len(data),
        "method": "internal-pcap-parser",
        "packets": len(records),
        "ptpFrames": len(ptp_records),
        "etherTypes": ether_type_counts,
    }
    append_event(events, "correlation_finished", **result)
    return result


def parse_ping_success(snapshot_value: dict[str, Any]) -> bool:
    ping = snapshot_value.get("commands", {}).get("observerPing", {})
    nested = ping.get("observer") if isinstance(ping, dict) else None
    return isinstance(nested, dict) and nested.get("exitCode") == 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    parser.add_argument("--artifact-dir", required=True)
    args = parser.parse_args()
    artifact_dir = Path(args.artifact_dir).resolve()
    request_path = Path(args.request).resolve()
    if request_path.parent != artifact_dir:
        raise SystemExit("request must be inside artifact directory")
    request = json.loads(request_path.read_text(encoding="utf-8"))
    events = artifact_dir / "events.jsonl"
    state_path = artifact_dir / "state.json"
    report_path = artifact_dir / "report.json"

    def stop_handler(_signum: int, _frame: Any) -> None:
        global STOP_REQUESTED
        STOP_REQUESTED = True
        append_event(events, "stop_signal_received")

    signal.signal(signal.SIGTERM, stop_handler)
    signal.signal(signal.SIGINT, stop_handler)

    mode = request["mode"]
    interface = request["interface"]
    target = request["target"]
    observer_host = request["observerHost"]
    observer_user = request["observerUser"]
    generator_interface = request["generatorInterface"]
    dry_run = bool(request["dryRun"])
    state = {"status": "running", "phase": "baseline_before", "startedUtc": utc_now(), "pid": os.getpid()}
    atomic_json(state_path, state)
    append_event(events, "run_started", mode=mode, interface=interface, target=target, dryRun=dry_run)
    capture_process: subprocess.Popen[bytes] | None = None
    capture_path: Path | None = None
    sent_total = 0
    latency_summary: dict[str, Any] | None = None
    latency_series_summary: dict[str, Any] | None = None
    latency_load_summary: dict[str, Any] | None = None
    priority_series_summary: dict[str, Any] | None = None
    fuzzing_summary: dict[str, Any] | None = None
    fuzzing_path_capture_started = False
    fuzzing_path_summary: dict[str, Any] = {"available": False, "reason": "capture not started"}
    error: str | None = None
    before: dict[str, Any] = {}
    after: dict[str, Any] = {}
    try:
        before = snapshot(interface, target, observer_user, observer_host)
        atomic_json(artifact_dir / "baseline-before.json", before)
        capture_process, capture_path = start_capture(interface, artifact_dir, events)
        if mode == "latency_jitter":
            stage = request["stages"][0]
            state["phase"] = "latency_measurement"
            state["stage"] = 1
            atomic_json(state_path, state)
            sent_total, latency_summary = measure_latency(
                observer_user, observer_host, stage["ratePps"], stage["durationSeconds"],
                artifact_dir, events, dry_run,
            )
        elif mode == "latency_series":
            stage = request["stages"][0]
            sent_total, latency_series_summary = measure_latency_series(
                observer_user, observer_host, stage["ratePps"], stage["durationSeconds"],
                int(request["repetitions"]), artifact_dir, events, state, state_path, dry_run,
            )
        elif mode == "latency_load":
            stage = request["stages"][0]
            state["phase"] = "latency_load_comparison"
            state["stage"] = 1
            atomic_json(state_path, state)
            sent_total, latency_load_summary = measure_latency_load_comparison(
                observer_user, observer_host, stage["ratePps"], stage["durationSeconds"],
                artifact_dir, events, dry_run,
            )
        elif mode == "priority_load":
            stage = request["stages"][0]
            state["phase"] = "priority_load_comparison"
            state["stage"] = 1
            atomic_json(state_path, state)
            sent_total, latency_load_summary = measure_latency_load_comparison(
                observer_user, observer_host, stage["ratePps"], stage["durationSeconds"],
                artifact_dir, events, dry_run, priority_profile=True,
            )
        elif mode == "priority_series":
            stage = request["stages"][0]
            sent_total, priority_series_summary = measure_priority_series(
                observer_user, observer_host, stage["ratePps"], stage["durationSeconds"],
                int(request["repetitions"]), artifact_dir, events, state, state_path, dry_run,
            )
        elif mode == "fuzzing":
            stage = request["stages"][0]
            state["phase"] = "fuzzing"
            state["stage"] = 1
            atomic_json(state_path, state)
            if not dry_run:
                start_fuzzing_path_capture(observer_user, observer_host, artifact_dir)
                fuzzing_path_capture_started = True
            sent_total = send_stage(
                observer_user, observer_host, target, generator_interface,
                stage["ratePps"], stage["durationSeconds"], mode, events, dry_run,
            )
            fuzzing_summary = {
                "available": False,
                "reason": "completed" if not dry_run else "dry-run",
                "requestedFrames": stage["ratePps"] * stage["durationSeconds"],
            }
        elif mode != "baseline":
            for index, stage in enumerate(request["stages"], start=1):
                if STOP_REQUESTED:
                    break
                state["phase"] = f"stage_{index}"
                state["stage"] = index
                atomic_json(state_path, state)
                sent_total += send_stage(
                    observer_user, observer_host, target, generator_interface,
                    stage["ratePps"], stage["durationSeconds"], mode, events, dry_run,
                )
        else:
            state["phase"] = "baseline_observation"
            atomic_json(state_path, state)
            observation = observer_command(observer_user, observer_host, "ping")
            atomic_json(artifact_dir / "baseline-observation.json", observation)
    except Exception as exc:  # worker must always produce a report
        error = f"{type(exc).__name__}: {exc}"
        append_event(events, "run_error", error=error)
    finally:
        state["phase"] = "recovery"
        atomic_json(state_path, state)
        stop_process(capture_process, events, "capture_stopped")
        if fuzzing_path_capture_started:
            stage = request["stages"][0] if request.get("stages") else {}
            requested_frames = int(stage.get("ratePps", 0) * stage.get("durationSeconds", 0)) if isinstance(stage, dict) else 0
            fuzzing_path_summary = finish_fuzzing_path_capture(
                observer_user, observer_host, artifact_dir, requested_frames,
            )
        if mode == "fuzzing" and not dry_run:
            stage = request["stages"][0] if request.get("stages") else {}
            requested_frames = int(stage.get("ratePps", 0) * stage.get("durationSeconds", 0)) if isinstance(stage, dict) else 0
            fuzzing_summary = summarize_fuzzing_capture(capture_path, max(sent_total, requested_frames), artifact_dir)
            fuzzing_summary["measurementPathCapture"] = fuzzing_path_summary
        recovery_started = time.monotonic()
        after = snapshot(interface, target, observer_user, observer_host)
        while not parse_ping_success(after) and time.monotonic() - recovery_started < 15 and not STOP_REQUESTED:
            time.sleep(1)
            after = snapshot(interface, target, observer_user, observer_host)
        recovery_seconds = round(time.monotonic() - recovery_started, 3)
        atomic_json(artifact_dir / "baseline-after.json", after)
        correlation = correlate(capture_path, artifact_dir, events)
        status = "stopped" if STOP_REQUESTED else ("failed" if error else "completed")
        report = {
            "runId": request["runId"],
            "mode": mode,
            "status": status,
            "scope": request["scope"],
            "board3Excluded": True,
            "dryRun": dry_run,
            "startedUtc": state["startedUtc"],
            "finishedUtc": utc_now(),
            "interface": interface,
            "target": target,
            "framesSent": sent_total,
            "baselineReachable": parse_ping_success(before),
            "recoveryReachable": parse_ping_success(after),
            "recoverySeconds": recovery_seconds,
            "correlation": correlation,
            "latency": latency_summary,
            "latencySeries": latency_series_summary,
            "latencyLoad": latency_load_summary,
            "prioritySeries": priority_series_summary,
            "fuzzing": fuzzing_summary,
            "error": error,
        }
        atomic_json(report_path, report)
        atomic_json(state_path, {**state, "status": status, "phase": "finished", "finishedUtc": report["finishedUtc"]})
        append_event(events, "run_finished", status=status, recoverySeconds=recovery_seconds)
    return 1 if error else 0


if __name__ == "__main__":
    raise SystemExit(main())
