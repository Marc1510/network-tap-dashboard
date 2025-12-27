import subprocess
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any, Union


_METADATA_LOCK = threading.Lock()


def write_capture_metadata(
    output_directory: Path,
    row: Dict[str, Any],
    test_metadata_file: Optional[Path] = None,
) -> None:
    """Thread-safe helper to append capture metadata (CSV + JSONL).
    
    Args:
        output_directory: Directory for the central metadata files.
        row: Metadata row to write.
        test_metadata_file: Optional path to a test-specific metadata CSV file.
            If provided, metadata is also written to this file.
    """
    from pathlib import Path as _Path
    import json as _json
    import csv as _csv

    if not isinstance(output_directory, _Path):
        output_directory = _Path(output_directory)

    metadata_file_csv = output_directory / "captures_meta.csv"
    metadata_file_json = output_directory / "captures_meta.jsonl"

    with _METADATA_LOCK:
        # Write to central metadata files
        is_new_csv = not metadata_file_csv.exists()
        with metadata_file_csv.open("a", encoding="utf-8", newline="") as f_csv:
            writer = _csv.DictWriter(f_csv, fieldnames=sorted(row.keys()))
            if is_new_csv:
                writer.writeheader()
            writer.writerow(row)

        with metadata_file_json.open("a", encoding="utf-8") as f_json:
            f_json.write(_json.dumps(row, ensure_ascii=False) + "\n")

        # Write to test-specific metadata file if enabled
        if test_metadata_file is not None:
            if not isinstance(test_metadata_file, _Path):
                test_metadata_file = _Path(test_metadata_file)
            # Ensure parent directory exists
            test_metadata_file.parent.mkdir(parents=True, exist_ok=True)
            is_new_test_csv = not test_metadata_file.exists()
            with test_metadata_file.open("a", encoding="utf-8", newline="") as f_test:
                writer = _csv.DictWriter(f_test, fieldnames=sorted(row.keys()))
                if is_new_test_csv:
                    writer.writeheader()
                writer.writerow(row)


class TcpdumpCaptureManager:
    """Managt einen laufenden tcpdump-Prozess (Ringpuffer) und Metadaten."""

    def __init__(self, output_directory: Union[Path, str]) -> None:
        self.output_directory = Path(output_directory)
        self.output_directory.mkdir(parents=True, exist_ok=True)

        self._process: Optional[subprocess.Popen] = None
        # RLock, weil innerhalb von start/stop status/is_running aufgerufen wird
        self._lock = threading.RLock()
        self._meta_lock = _METADATA_LOCK
        self._metadata_file_csv = self.output_directory / "captures_meta.csv"
        self._metadata_file_json = self.output_directory / "captures_meta.jsonl"
        # Merkt sich die zuletzt gestartete capture_id der laufenden Session
        self._current_capture_id: Optional[str] = None

    def is_running(self) -> bool:
        with self._lock:
            return self._process is not None and self._process.poll() is None

    def start(
        self,
        interface: str = "eth0",
        bpf_filter: Optional[str] = None,
        ring_file_size_mb: int = 50,
        ring_file_count: int = 10,
        filename_prefix: str = "capture",
        test_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Startet tcpdump mit Größe-basiertem Ringpuffer (-C, -W).
        Dateien: <prefix>-<utc>-%Y%m%d%H%M%S.pcap
        """
        with self._lock:
            if self.is_running():
                return {"status": "already_running"}

            # Besser lesbarer, stabiler Basename (tcpdump hängt bei -C/-W die Zähler 0..N an)
            # Ergebnis: <prefix>_<iface>_<UTC>.pcap0, .pcap1, ...
            timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
            # Generiere eindeutige capture_id
            capture_id = str(uuid.uuid4())
            filename_base = f"{filename_prefix}_{interface}_{timestamp}.pcap"
            output_path = self.output_directory / filename_base

            cmd: List[str] = [
                "tcpdump",
                "-i",
                interface,
                "-nn",
                "-s",
                "0",
                "-w",
                str(output_path),
                "-C",
                str(ring_file_size_mb),
                "-W",
                str(ring_file_count),
            ]

            # BPF-Filter muss am Ende stehen (kein -f)
            if bpf_filter:
                cmd.extend(bpf_filter.split())

            try:
                self._process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    text=True,
                )
            except FileNotFoundError as exc:
                return {"status": "error", "error": f"tcpdump nicht gefunden: {exc}"}
            except Exception as exc:  # noqa: BLE001
                return {"status": "error", "error": str(exc)}

            meta = {
                "event": "start",
                "utc": timestamp,
                "capture_id": capture_id,
                "interface": interface,
                "ring_file_size_mb": ring_file_size_mb,
                "ring_file_count": ring_file_count,
                "filename_base": str(output_path),
                "pid": self._process.pid,
                "bpf_filter": bpf_filter or "",
                "test_name": test_name or "",
            }
            self._write_metadata(meta)
            # Track running capture_id, um sie beim Stop zu verwenden
            self._current_capture_id = capture_id
            return {"status": "started", **meta}

    def stop(self, capture_id: Optional[str] = None) -> Dict[str, Any]:
        with self._lock:
            if not self.is_running():
                return {"status": "not_running"}
            assert self._process is not None
            pid = self._process.pid
            self._process.terminate()
            try:
                self._process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self._process.kill()
            self._process = None

            timestamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
            meta = {
                "event": "stop",
                "utc": timestamp,
                "pid": pid,
            }
            # Bevorzugt explizit übergebenes capture_id, sonst verwende die gemerkte
            effective_capture_id = capture_id or self._current_capture_id
            if effective_capture_id:
                meta["capture_id"] = effective_capture_id
            self._write_metadata(meta)
            # Cleanup gemerkte ID
            self._current_capture_id = None
            return {"status": "stopped", **meta}

    def status(self) -> Dict[str, Any]:
        with self._lock:
            if self.is_running():
                assert self._process is not None
                return {"running": True, "pid": self._process.pid}
            return {"running": False}

    def _write_metadata(self, row: Dict[str, Any]) -> None:
        write_capture_metadata(self.output_directory, row)
