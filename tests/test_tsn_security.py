from __future__ import annotations

import tempfile
import unittest
import struct
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch

from scripts.tsn_frame_generator import frame as generator_frame
from scripts.tsn_latency_probe import parse_scm_timestamping
from scripts.tsn_observer import wait_for_receiver_ports
from scripts.tsn_security_worker import (
    append_event,
    parse_pcap,
    ptp_payload,
    summarize_latency,
    summarize_latency_series,
    summarize_priority_series,
    runtime_metrics_delta,
    classify_burst_capture,
    compare_measurement_captures,
    compare_fuzzing_measurement_captures,
)
from services.api.tsn_security_service import TsnSecurityError, TsnSecurityManager


class FakeProcess:
    pid = 12345

    def poll(self):
        return None

    def wait(self):
        return 0


class FakeCompletedProcess:
    pid = 54321

    def poll(self):
        return 0

    def wait(self):
        return 0


class TsnSecurityManagerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.manager = TsnSecurityManager(Path(self.temp.name))

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_rejects_unconfirmed_scope(self) -> None:
        with self.assertRaisesRegex(TsnSecurityError, "bestaetigt"):
            self.manager.start({
                "mode": "baseline", "target": "192.168.1.4", "interface": "RT0",
                "scopeConfirmed": False,
            })

    def test_rejects_target_outside_scope(self) -> None:
        with self.assertRaisesRegex(TsnSecurityError, "ausserhalb"):
            self.manager.start({
                "mode": "baseline", "target": "192.168.1.3", "interface": "RT0",
                "scopeConfirmed": True,
            })

    def test_rejects_excessive_ptp_rate(self) -> None:
        with self.assertRaisesRegex(TsnSecurityError, "Grenze"):
            self.manager.start({
                "mode": "ptp_resilience", "target": "192.168.1.4", "interface": "RT0",
                "scopeConfirmed": True, "stages": [{"ratePps": 101, "durationSeconds": 1}],
            })

    def test_rejects_excessive_fuzzing_rate(self) -> None:
        with self.assertRaisesRegex(TsnSecurityError, "Grenze"):
            self.manager.start({
                "mode": "fuzzing", "target": "192.168.1.4", "interface": "RT0",
                "scopeConfirmed": True, "stages": [{"ratePps": 11, "durationSeconds": 1}],
            })

    def test_latency_mode_allows_only_one_bounded_profile(self) -> None:
        with self.assertRaisesRegex(TsnSecurityError, "Maximal 1"):
            self.manager.start({
                "mode": "latency_jitter", "target": "192.168.1.4", "interface": "RT0",
                "scopeConfirmed": True,
                "stages": [
                    {"ratePps": 10, "durationSeconds": 1},
                    {"ratePps": 10, "durationSeconds": 1},
                ],
            })

    def test_latency_series_rejects_more_than_thirty_repetitions(self) -> None:
        with self.assertRaisesRegex(TsnSecurityError, "2 bis 30"):
            self.manager.start({
                "mode": "latency_series", "target": "192.168.1.4", "interface": "RT0",
                "scopeConfirmed": True, "repetitions": 31,
                "stages": [{"ratePps": 10, "durationSeconds": 5}],
            })

    def test_latency_series_limits_each_repetition_to_ten_seconds(self) -> None:
        with self.assertRaisesRegex(TsnSecurityError, "10 s"):
            self.manager.start({
                "mode": "latency_series", "target": "192.168.1.4", "interface": "RT0",
                "scopeConfirmed": True, "repetitions": 2,
                "stages": [{"ratePps": 10, "durationSeconds": 11}],
            })

    def test_background_load_is_strictly_bounded(self) -> None:
        with self.assertRaisesRegex(TsnSecurityError, "1000 pps"):
            self.manager.start({
                "mode": "latency_load", "target": "192.168.1.4", "interface": "RT0",
                "scopeConfirmed": True,
                "stages": [{"ratePps": 1001, "durationSeconds": 5}],
            })

    def test_priority_load_uses_same_strict_load_limit(self) -> None:
        with self.assertRaisesRegex(TsnSecurityError, "1000 pps"):
            self.manager.start({
                "mode": "priority_load", "target": "192.168.1.4", "interface": "RT0",
                "scopeConfirmed": True,
                "stages": [{"ratePps": 1001, "durationSeconds": 5}],
            })

    def test_priority_series_is_bounded_to_thirty_pairs_and_five_seconds(self) -> None:
        with self.assertRaisesRegex(TsnSecurityError, "2 bis 30"):
            self.manager.start({
                "mode": "priority_series", "target": "192.168.1.4", "interface": "RT0",
                "scopeConfirmed": True, "repetitions": 31,
                "stages": [{"ratePps": 100, "durationSeconds": 5}],
            })
        with self.assertRaisesRegex(TsnSecurityError, "5 s"):
            self.manager.start({
                "mode": "priority_series", "target": "192.168.1.4", "interface": "RT0",
                "scopeConfirmed": True, "repetitions": 2,
                "stages": [{"ratePps": 100, "durationSeconds": 6}],
            })

    @patch("services.api.tsn_security_service.subprocess.Popen", return_value=FakeProcess())
    def test_start_writes_sanitized_request(self, _popen) -> None:
        result = self.manager.start({
            "mode": "ptp_resilience", "target": "192.168.1.4", "interface": "RT0",
            "scopeConfirmed": True, "dryRun": True,
            "stages": [{"ratePps": 5, "durationSeconds": 2}],
        })
        self.assertTrue(result["active"])
        self.assertEqual(result["request"]["target"], "192.168.1.4")
        self.assertNotIn("password", result["request"])

    @patch("services.api.tsn_security_service.subprocess.Popen", return_value=FakeCompletedProcess())
    def test_get_run_reports_existing_artifacts_and_state(self, _popen) -> None:
        run_id = self.manager.start({
            "mode": "baseline", "target": "192.168.1.4", "interface": "RT0",
            "scopeConfirmed": True, "dryRun": True,
        })["runId"]
        run_dir = Path(self.temp.name) / run_id
        (run_dir / "state.json").write_text('{"status":"stopped","phase":"finished"}', encoding="utf-8")
        (run_dir / "report.json").write_text('{"mode":"baseline","status":"completed"}', encoding="utf-8")
        (run_dir / "events.jsonl").write_text("hello", encoding="utf-8")
        values = self.manager.get_run(run_id)
        self.assertFalse(values["active"])
        self.assertEqual(values["state"]["status"], "completed")
        files = {entry["name"]: entry["size"] for entry in values["files"]}
        self.assertEqual(files["events.jsonl"], 5)
        self.assertEqual(files["report.json"], 40)
        self.assertEqual(files["state.json"], 39)


class PtpFrameTests(unittest.TestCase):
    def test_frame_has_gptp_destination_and_ethertype(self) -> None:
        frame = ptp_payload(bytes.fromhex("020000000001"), 7)
        self.assertEqual(frame[:6], bytes.fromhex("0180c200000e"))
        self.assertEqual(frame[12:14], bytes.fromhex("88f7"))
        self.assertEqual(len(frame), 58)

    def test_mutations_remain_bounded_to_single_frame(self) -> None:
        frames = [ptp_payload(bytes.fromhex("020000000001"), index, index) for index in range(5)]
        self.assertTrue(all(len(frame) == 58 for frame in frames))
        self.assertEqual(len(set(frames)), 5)

    def test_deployed_generator_uses_same_bounded_frame_shape(self) -> None:
        value = generator_frame(bytes.fromhex("020000000001"), 3, 2)
        self.assertEqual(value[:6], bytes.fromhex("0180c200000e"))
        self.assertEqual(value[12:14], bytes.fromhex("88f7"))
        self.assertEqual(len(value), 58)

    def test_capture_event_accepts_artifact_filename(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "events.jsonl"
            append_event(path, "capture_started", captureFile="traffic.pcap")
            self.assertIn('"captureFile": "traffic.pcap"', path.read_text(encoding="utf-8"))

    def test_internal_pcap_parser_extracts_ptp_frame(self) -> None:
        value = ptp_payload(bytes.fromhex("020000000001"), 7)
        global_header = struct.pack("<IHHIIII", 0xA1B23C4D, 2, 4, 0, 0, 65535, 1)
        packet_header = struct.pack("<IIII", 100, 500_000_000, len(value), len(value))
        records = parse_pcap(global_header + packet_header + value)
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["etherType"], 0x88F7)
        self.assertEqual(records[0]["sequenceId"], 7)

    def test_burst_capture_classifies_ipv4_udp_and_multicast(self) -> None:
        ethernet = bytes.fromhex("01005e0000fb0200000000010800")
        ipv4 = bytes.fromhex("450000200001000040110000c0a80101e00000fb")
        udp = struct.pack("!HHHH", 5353, 5353, 12, 0) + b"test"
        packet = ethernet + ipv4 + udp
        global_header = struct.pack("<IHHIIII", 0xA1B23C4D, 2, 4, 0, 0, 65535, 1)
        packet_header = struct.pack("<IIII", 100, 0, len(packet), len(packet))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "capture.pcap"
            path.write_bytes(global_header + packet_header + packet)
            summary = classify_burst_capture(path, Path(directory))
            self.assertEqual(summary["packets"], 1)
            self.assertEqual(summary["destinationKinds"]["multicast"], 1)
            self.assertEqual(summary["protocols"]["ipv4-udp-dport-5353"], 1)
            self.assertTrue((Path(directory) / "board4-capture-bins.csv").is_file())

    def test_compares_test_sequences_at_egress_and_ingress(self) -> None:
        def packet(sequence: int) -> bytes:
            ethernet = bytes.fromhex("3408e180ae1b0200000000010800")
            ipv4 = bytes.fromhex("450000240001000040110000c0a80104c0a80101")
            udp = struct.pack("!HHHH", 46001, 46001, 16, 0) + b"TSNL" + struct.pack("!I", sequence)
            return ethernet + ipv4 + udp

        def pcap(packets: list[bytes]) -> bytes:
            header = struct.pack("<IHHIIII", 0xA1B23C4D, 2, 4, 0, 0, 65535, 1)
            records = [struct.pack("<IIII", 100 + index, 0, len(value), len(value)) + value for index, value in enumerate(packets)]
            return header + b"".join(records)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            egress, ingress = root / "egress.pcap", root / "ingress.pcap"
            egress.write_bytes(pcap([packet(0), packet(1)]))
            ingress.write_bytes(pcap([packet(0)]))
            summary = compare_measurement_captures(egress, ingress, root)
            self.assertEqual(summary["flows"]["TSNL"]["egressPackets"], 2)
            self.assertEqual(summary["flows"]["TSNL"]["ingressPackets"], 1)
            self.assertEqual(summary["flows"]["TSNL"]["missingAtIngress"], 1)

    def test_compares_only_fuzz_mutations_at_egress_and_ingress(self) -> None:
        def pcap(packets: list[bytes]) -> bytes:
            header = struct.pack("<IHHIIII", 0xA1B23C4D, 2, 4, 0, 0, 65535, 1)
            records = [struct.pack("<IIII", 100 + index, 0, len(value), len(value)) + value for index, value in enumerate(packets)]
            return header + b"".join(records)

        source = bytes.fromhex("020000000001")
        egress_packets = [generator_frame(source, index, index % 5) for index in range(5)]
        ingress_packets = egress_packets[:4] + [generator_frame(source, 99, None)]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            egress, ingress = root / "egress.pcap", root / "ingress.pcap"
            egress.write_bytes(pcap(egress_packets))
            ingress.write_bytes(pcap(ingress_packets))
            summary = compare_fuzzing_measurement_captures(egress, ingress, root, 5)
            self.assertEqual(summary["egressPackets"], 5)
            self.assertEqual(summary["ingressPackets"], 4)
            self.assertEqual(summary["missingAtIngress"], 1)
            self.assertEqual(summary["mutationCounts"]["egress"]["4"], 1)
            self.assertTrue((root / "fuzzing-path-comparison.csv").is_file())


class LatencyMeasurementTests(unittest.TestCase):
    @patch("scripts.tsn_observer.subprocess.run")
    def test_waits_for_both_udp_receiver_ports(self, remote_run) -> None:
        remote_run.return_value = SimpleNamespace(
            returncode=0,
            stdout=" 1: 0101A8C0:B3B1 00000000:0000 07\n 2: 0101A8C0:B3B2 00000000:0000 07\n",
        )
        wait_for_receiver_ports([46001, 46002], timeout=0.1)
        remote_run.assert_called_once()

    def test_runtime_metrics_delta_calculates_cpu_udp_and_process_changes(self) -> None:
        before = {"board1": {
            "cpu": {"cpu": [100, 0, 50, 850, 0]},
            "snmp": {"Udp": {"InDatagrams": 10, "InErrors": 1, "RcvbufErrors": 0, "SndbufErrors": 0, "NoPorts": 0}},
            "interfaces": {"eth0": {"rx_packets": 10, "tx_packets": 5, "rx_dropped": 0, "tx_dropped": 0, "rx_errors": 0, "tx_errors": 0}},
            "ethtool": {"eth0": {"rx_crc_errors": 2, "rx_align_code_errors": 3, "rx_jabber_frames": 4, "iet_rx_smd_err": 5, "rx_port_mask_drop": 6}},
            "frequencies": {"policy0KiHz": 1000000},
            "processCounts": {"tsn_latency_probe": 0, "tsn_udp_load": 0, "ssh": 2, "total": 30},
            "memory": {"MemAvailableKiB": 1000}, "qdisc": {},
        }}
        after = {"board1": {
            "cpu": {"cpu": [120, 0, 60, 920, 0]},
            "snmp": {"Udp": {"InDatagrams": 20, "InErrors": 2, "RcvbufErrors": 1, "SndbufErrors": 0, "NoPorts": 0}},
            "interfaces": {"eth0": {"rx_packets": 20, "tx_packets": 10, "rx_dropped": 1, "tx_dropped": 0, "rx_errors": 0, "tx_errors": 0}},
            "ethtool": {"eth0": {"rx_crc_errors": 3, "rx_align_code_errors": 5, "rx_jabber_frames": 7, "iet_rx_smd_err": 8, "rx_port_mask_drop": 10}},
            "frequencies": {"policy0KiHz": 1200000},
            "processCounts": {"tsn_latency_probe": 0, "tsn_udp_load": 0, "ssh": 2, "total": 30},
            "memory": {"MemAvailableKiB": 900}, "loadAverage": [0.1, 0.2, 0.3], "udpPorts": {"46001": 0}, "qdisc": {},
        }}
        result = runtime_metrics_delta(before, after)["board1"]
        self.assertEqual(result["cpuUtilizationPercent"], 30)
        self.assertEqual(result["udpDelta"]["InErrors"], 1)
        self.assertEqual(result["interfaceDelta"]["eth0"]["rx_dropped"], 1)
        self.assertEqual(result["ethtoolDelta"]["eth0"]["rx_jabber_frames"], 3)
        self.assertEqual(result["frequencyMinAfterKiHz"], 1200000)

    def test_parses_software_and_hardware_timestamps(self) -> None:
        data = struct.pack("=qqqqqq", 10, 20, 0, 0, 30, 40)
        value = parse_scm_timestamping(data)
        self.assertEqual(value["softwareNs"], 10_000_000_020)
        self.assertEqual(value["hardwareNs"], 30_000_000_040)

    def test_summarizes_sequence_correlated_software_timestamps(self) -> None:
        measurement = {
            "sender": {
                "requested": 3,
                "sent": 3,
                "samples": [
                    {"sequence": 0, "txSoftwareNs": 1_000, "txHardwareNs": None},
                    {"sequence": 1, "txSoftwareNs": 2_000, "txHardwareNs": None},
                    {"sequence": 2, "txSoftwareNs": 3_000, "txHardwareNs": None},
                ],
            },
            "receiver": {
                "requested": 3,
                "received": 2,
                "samples": [
                    {"sequence": 0, "rxSoftwareNs": 1_100, "rxHardwareNs": None},
                    {"sequence": 1, "rxSoftwareNs": 2_300, "rxHardwareNs": None},
                ],
            },
        }
        with tempfile.TemporaryDirectory() as directory:
            summary = summarize_latency(measurement, Path(directory))
            self.assertEqual(summary["timestampMethod"], "kernel-software")
            self.assertEqual(summary["matchedPackets"], 2)
            self.assertEqual(summary["lostPackets"], 1)
            self.assertEqual(summary["minNs"], 100)
            self.assertEqual(summary["maxNs"], 300)
            self.assertTrue((Path(directory) / "latency-samples.csv").is_file())

    def test_summarizes_repeated_latency_runs_and_confidence_interval(self) -> None:
        summaries = [
            {
                "repetition": index,
                "available": True,
                "timestampMethod": "kernel-software",
                "requestedPackets": 10,
                "sentPackets": 10,
                "matchedPackets": 10,
                "meanNs": mean,
                "p95Ns": mean + 20,
                "p99Ns": mean + 30,
                "maxNs": mean + 40,
                "jitterStddevNs": 10,
            }
            for index, mean in enumerate([100, 110, 120, 130], start=1)
        ]
        with tempfile.TemporaryDirectory() as directory:
            result = summarize_latency_series(summaries, 4, Path(directory))
            self.assertTrue(result["available"])
            self.assertEqual(result["completedRepetitions"], 4)
            self.assertEqual(result["totalMatchedPackets"], 40)
            self.assertEqual(result["meanOfRunMeansNs"], 115)
            self.assertLess(result["confidence95LowerNs"], 115)
            self.assertGreater(result["confidence95UpperNs"], 115)
            self.assertTrue((Path(directory) / "latency-series-runs.csv").is_file())

    def test_summarizes_paired_priority_series_and_order_groups(self) -> None:
        comparisons = []
        for repetition, delta in enumerate([-10, 20, -30, 40], start=1):
            comparisons.append({
                "repetition": repetition,
                "available": True,
                "order": "baseline-first" if repetition % 2 else "load-first",
                "timestampMethod": "kernel-software",
                "meanDeltaNs": delta,
                "p95DeltaNs": delta + 5,
                "jitterDeltaNs": delta - 5,
                "backgroundSentPackets": 100,
                "backgroundReceivedPackets": 100,
                "baseline": {"requestedPackets": 10, "matchedPackets": 10, "lossPercent": 0, "meanNs": 100, "p95Ns": 120},
                "loaded": {"requestedPackets": 10, "matchedPackets": 10, "lossPercent": 0, "meanNs": 100 + delta, "p95Ns": 125 + delta},
            })
        with tempfile.TemporaryDirectory() as directory:
            result = summarize_priority_series(comparisons, 4, 100, Path(directory))
            self.assertEqual(result["completedRepetitions"], 4)
            self.assertEqual(result["meanDeltaNs"]["mean"], 5)
            self.assertEqual(result["orderGroups"]["baseline-first"]["repetitions"], 2)
            self.assertEqual(result["orderGroups"]["load-first"]["repetitions"], 2)
            self.assertEqual(result["loadedLossPercent"], 0)
            self.assertEqual(result["backgroundReceivedPackets"], 400)
            self.assertEqual(result["backgroundLossPercent"], 0)
            self.assertEqual(result["sensitivityExcludingOutliers"]["repetitions"], 4)
            self.assertTrue((Path(directory) / "priority-series-runs.csv").is_file())


if __name__ == "__main__":
    unittest.main()
