from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import sys
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from services.api.config import (
    REPO_ROOT,
    TSN_SECURITY_GENERATOR_INTERFACE,
    TSN_SECURITY_INTERFACES,
    TSN_SECURITY_OBSERVER,
    TSN_SECURITY_OBSERVER_USER,
    TSN_SECURITY_TARGET,
)


RUN_ID_RE = re.compile(r"^[0-9]{8}T[0-9]{6}Z_[a-f0-9]{8}$")
MAX_STAGE_RATE = 100
MAX_STAGE_DURATION = 60
MAX_STAGES = 3
FUZZ_MAX_RATE = 10
FUZZ_MAX_DURATION = 20
LATENCY_MAX_RATE = 100
LATENCY_MAX_DURATION = 60
LATENCY_SERIES_MAX_DURATION = 10
LATENCY_SERIES_MAX_REPETITIONS = 30
LATENCY_LOAD_MAX_RATE = 1000
LATENCY_LOAD_MAX_DURATION = 10
PRIORITY_SERIES_MAX_DURATION = 5
STOP_GRACE_SECONDS = 120
ARTIFACT_NAMES = (
    "report.json",
    "request.json",
    "state.json",
    "events.jsonl",
    "baseline-before.json",
    "baseline-observation.json",
    "baseline-after.json",
    "traffic.pcap",
    "timestamp-correlation.csv",
    "timestamp-correlation.txt",
    "capture.log",
    "worker.log",
    "latency-raw.json",
    "latency-summary.json",
    "latency-samples.csv",
    "latency-series-summary.json",
    "latency-series-runs.csv",
    "latency-load-comparison.json",
    "latency-load-comparison.csv",
    "priority-profile-apply.json",
    "priority-profile-restore.json",
    "priority-series-summary.json",
    "priority-series-runs.csv",
    "fuzzing-summary.json",
    "fuzzing-sequences.csv",
    "fuzzing-measurement-capture-start.json",
    "fuzzing-measurement-capture-stop.json",
    "fuzzing-measurement-capture-copy.json",
    "fuzzing-path-summary.json",
    "fuzzing-path-comparison.csv",
    "board4-ingress.pcap",
    "board4-ingress-capture.log",
    "board4-capture-summary.json",
    "board4-capture-bins.csv",
    "board4-capture-start.json",
    "board4-capture-stop.json",
    "board4-capture-copy.json",
    "board4-egress.pcap",
    "board1-ingress.pcap",
    "board4-egress-capture.log",
    "board1-ingress-capture.log",
    "measurement-path-summary.json",
    "measurement-path-comparison.csv",
    "measurement-capture-start.json",
    "measurement-capture-stop.json",
    "measurement-capture-copy.json",
)


def utc_compact() -> str:
    return datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")


class TsnSecurityError(RuntimeError):
    pass


class TsnSecurityManager:
    def __init__(self, artifact_root: Path) -> None:
        self.artifact_root = Path(artifact_root)
        self.index_file = self.artifact_root / "runs-index.json"
        self.worker = REPO_ROOT / "scripts" / "tsn_security_worker.py"
        self._process: subprocess.Popen[bytes] | None = None
        self._active_run_id: str | None = None
        self._active_request: dict[str, Any] | None = None
        self._lock = threading.RLock()

    def config(self) -> dict[str, Any]:
        return {
            "target": TSN_SECURITY_TARGET,
            "interfaces": list(TSN_SECURITY_INTERFACES),
            "limits": {
                "maxStageRatePps": MAX_STAGE_RATE,
                "maxStageDurationSeconds": MAX_STAGE_DURATION,
                "maxStages": MAX_STAGES,
                "fuzzMaxRatePps": FUZZ_MAX_RATE,
                "fuzzMaxDurationSeconds": FUZZ_MAX_DURATION,
                "latencyMaxRatePps": LATENCY_MAX_RATE,
                "latencyMaxDurationSeconds": LATENCY_MAX_DURATION,
                "latencySeriesMaxDurationSeconds": LATENCY_SERIES_MAX_DURATION,
                "latencySeriesMaxRepetitions": LATENCY_SERIES_MAX_REPETITIONS,
                "latencyLoadMaxRatePps": LATENCY_LOAD_MAX_RATE,
                "latencyLoadMaxDurationSeconds": LATENCY_LOAD_MAX_DURATION,
                "prioritySeriesMaxDurationSeconds": PRIORITY_SERIES_MAX_DURATION,
            },
            "board3Excluded": True,
            "scope": "Board 1 -> HAT 2 -> Board 4",
            "observer": TSN_SECURITY_OBSERVER,
            "generatorInterface": TSN_SECURITY_GENERATOR_INTERFACE,
        }

    def _refresh_locked(self) -> None:
        # Child reaping is handled by _watch_process. Request handlers must not
        # call Popen.poll()/wait(), as platform child watchers can block there.
        return

    def _watch_process(self, process: subprocess.Popen[bytes], run_id: str) -> None:
        process.wait()
        with self._lock:
            if self._process is process and self._active_run_id == run_id:
                self._process = None
                self._active_run_id = None
                self._active_request = None

    def _force_stop_after_grace(self, process: subprocess.Popen[bytes], run_id: str) -> None:
        """Keep a bounded emergency-stop path without interrupting cleanup."""
        time.sleep(STOP_GRACE_SECONDS)
        with self._lock:
            if self._process is not process or self._active_run_id != run_id:
                return
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            return

    def start(self, payload: dict[str, Any]) -> dict[str, Any]:
        mode = str(payload.get("mode") or "").strip()
        if mode not in {"baseline", "ptp_resilience", "fuzzing", "latency_jitter", "latency_series", "latency_load", "priority_load", "priority_series"}:
            raise TsnSecurityError("Unbekannter Testmodus")
        if payload.get("scopeConfirmed") is not True:
            raise TsnSecurityError("Der isolierte Testumfang muss explizit bestaetigt werden")

        target = str(payload.get("target") or TSN_SECURITY_TARGET).strip()
        interface = str(payload.get("interface") or "").strip()
        if target != TSN_SECURITY_TARGET:
            raise TsnSecurityError("Ziel liegt ausserhalb des konfigurierten Laborumfangs")
        if interface not in TSN_SECURITY_INTERFACES:
            raise TsnSecurityError("Interface ist fuer Security-Tests nicht freigegeben")

        dry_run = bool(payload.get("dryRun", mode != "baseline"))
        stages = self._validate_stages(mode, payload.get("stages"))
        repetitions = self._validate_repetitions(mode, payload.get("repetitions"))
        run_id = f"{utc_compact()}_{uuid4().hex[:8]}"
        run_dir = self.artifact_root / run_id
        run_dir.mkdir(parents=True, exist_ok=False)
        self._record_run_id(run_id)

        request = {
            "runId": run_id,
            "mode": mode,
            "target": target,
            "interface": interface,
            "dryRun": dry_run,
            "stages": stages,
            "repetitions": repetitions,
            "scope": "Board 1 -> HAT 2 -> Board 4",
            "board3Excluded": True,
            "observerHost": TSN_SECURITY_OBSERVER,
            "observerUser": TSN_SECURITY_OBSERVER_USER,
            "generatorInterface": TSN_SECURITY_GENERATOR_INTERFACE,
            "requestedUtc": datetime.now(UTC).isoformat(),
        }
        (run_dir / "request.json").write_text(json.dumps(request, indent=2), encoding="utf-8")

        command = [
            sys.executable,
            str(self.worker),
            "--request",
            str(run_dir / "request.json"),
            "--artifact-dir",
            str(run_dir),
        ]
        with self._lock:
            self._refresh_locked()
            if self._process is not None:
                raise TsnSecurityError("Es laeuft bereits ein TSN-Security-Test")
            log_handle = (run_dir / "worker.log").open("ab", buffering=0)
            try:
                self._process = subprocess.Popen(
                    command,
                    stdin=subprocess.DEVNULL,
                    stdout=log_handle,
                    stderr=subprocess.STDOUT,
                    start_new_session=True,
                )
            finally:
                log_handle.close()
            self._active_run_id = run_id
            self._active_request = request
            threading.Thread(
                target=self._watch_process,
                args=(self._process, run_id),
                name=f"tsn-security-{run_id}",
                daemon=True,
            ).start()
        return {
            "runId": run_id,
            "active": True,
            "request": request,
            "state": {"status": "running", "phase": "starting"},
            "report": None,
            "files": [{"name": name, "size": 0} for name in ARTIFACT_NAMES],
        }

    def _validate_stages(self, mode: str, raw: Any) -> list[dict[str, int]]:
        if mode == "baseline":
            return []
        default = ([{"ratePps": 10, "durationSeconds": 10}] if mode in {"latency_jitter", "latency_series"} else
                   [{"ratePps": 10, "durationSeconds": 10}] if mode in {"fuzzing"} else
                   [{"ratePps": 100, "durationSeconds": 5}] if mode in {"latency_load", "priority_load", "priority_series"} else
                   [{"ratePps": 5, "durationSeconds": 10}, {"ratePps": 20, "durationSeconds": 10}])
        stages = raw if isinstance(raw, list) and raw else default
        allowed_stages = 1 if mode in {"latency_jitter", "latency_series", "latency_load", "priority_load", "priority_series", "fuzzing"} else MAX_STAGES
        if len(stages) > allowed_stages:
            raise TsnSecurityError(f"Maximal {allowed_stages} Laststufen sind erlaubt")
        normalized: list[dict[str, int]] = []
        if mode == "fuzzing":
            max_rate, max_duration = FUZZ_MAX_RATE, FUZZ_MAX_DURATION
        elif mode in {"latency_jitter", "latency_series"}:
            max_rate = LATENCY_MAX_RATE
            max_duration = LATENCY_SERIES_MAX_DURATION if mode == "latency_series" else LATENCY_MAX_DURATION
        elif mode in {"latency_load", "priority_load", "priority_series"}:
            max_rate = LATENCY_LOAD_MAX_RATE
            max_duration = PRIORITY_SERIES_MAX_DURATION if mode == "priority_series" else LATENCY_LOAD_MAX_DURATION
        else:
            max_rate, max_duration = MAX_STAGE_RATE, MAX_STAGE_DURATION
        for item in stages:
            if not isinstance(item, dict):
                raise TsnSecurityError("Ungueltige Laststufe")
            try:
                rate = int(item.get("ratePps"))
                duration = int(item.get("durationSeconds"))
            except (TypeError, ValueError) as exc:
                raise TsnSecurityError("Rate und Dauer muessen Ganzzahlen sein") from exc
            if not 1 <= rate <= max_rate or not 1 <= duration <= max_duration:
                raise TsnSecurityError(f"Laststufe ueberschreitet die Grenze ({max_rate} pps, {max_duration} s)")
            normalized.append({"ratePps": rate, "durationSeconds": duration})
        return normalized

    @staticmethod
    def _validate_repetitions(mode: str, raw: Any) -> int:
        if mode not in {"latency_series", "priority_series"}:
            return 1
        try:
            repetitions = int(30 if raw is None else raw)
        except (TypeError, ValueError) as exc:
            raise TsnSecurityError("Wiederholungen muessen eine Ganzzahl sein") from exc
        if not 2 <= repetitions <= LATENCY_SERIES_MAX_REPETITIONS:
            raise TsnSecurityError(
                f"Messserie muss 2 bis {LATENCY_SERIES_MAX_REPETITIONS} Wiederholungen enthalten"
            )
        return repetitions

    def stop_active(self, reason: str = "user_emergency_stop") -> dict[str, Any]:
        with self._lock:
            self._refresh_locked()
            if self._process is None:
                return {"stopped": False, "message": "Kein Test aktiv"}
            run_id = self._active_run_id
            process = self._process
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            else:
                threading.Thread(
                    target=self._force_stop_after_grace,
                    args=(process, run_id or ""),
                    name=f"tsn-security-stop-{run_id}",
                    daemon=True,
                ).start()
        if run_id:
            marker = self.artifact_root / run_id / "stop-request.json"
            marker.write_text(json.dumps({"reason": reason, "utc": datetime.now(UTC).isoformat()}, indent=2), encoding="utf-8")
        return {"stopped": True, "runId": run_id, "message": "Not-Stopp angefordert; Aufraeumarbeiten laufen"}

    def status(self) -> dict[str, Any]:
        with self._lock:
            self._refresh_locked()
            active = self._active_run_id
            pid = self._process.pid if self._process is not None else None
        return {"active": active is not None, "runId": active, "pid": pid}

    def list_runs(self) -> list[dict[str, Any]]:
        self.artifact_root.mkdir(parents=True, exist_ok=True)
        runs = [self.get_run(path.name) for path in self.artifact_root.iterdir() if path.is_dir() and RUN_ID_RE.fullmatch(path.name)]
        return sorted(runs, key=lambda item: item["runId"], reverse=True)[:100]

    def run_ids(self) -> list[str]:
        index = self._read_json(self.index_file) or {}
        values = index.get("runIds")
        if not isinstance(values, list):
            return []
        return [value for value in values if isinstance(value, str) and RUN_ID_RE.fullmatch(value)][:100]

    def _record_run_id(self, run_id: str) -> None:
        self.artifact_root.mkdir(parents=True, exist_ok=True)
        run_ids = [run_id, *[value for value in self.run_ids() if value != run_id]][:100]
        temporary = self.index_file.with_suffix(".json.tmp")
        temporary.write_text(json.dumps({"runIds": run_ids}, indent=2), encoding="utf-8")
        temporary.replace(self.index_file)

    def get_run(self, run_id: str) -> dict[str, Any]:
        run_dir = self._run_dir(run_id)
        report = self._read_json(run_dir / "report.json")
        files = []
        for name in ARTIFACT_NAMES:
            path = run_dir / name
            files.append({"name": name, "size": path.stat().st_size if path.is_file() else 0})
        request = self._read_json(run_dir / "request.json")
        state = self._read_json(run_dir / "state.json")

        # Report reads must never wait behind a start/stop operation. The two
        # fields are atomic references in CPython and a slightly stale active
        # flag is corrected by the separately polled status endpoint.
        active = self._active_run_id == run_id
        if active:
            request = self._active_request
            state = {"status": "running", "phase": "running"}
        elif report:
            request = {
                "mode": report.get("mode"),
                "target": report.get("target"),
                "interface": report.get("interface"),
                "dryRun": report.get("dryRun"),
                "requestedUtc": report.get("startedUtc"),
            }
            state = {"status": report.get("status"), "phase": "finished"}
        else:
            request = request or {
                "mode": None,
                "target": None,
                "interface": None,
                "dryRun": None,
                "requestedUtc": None,
            }
            state = {
                "status": (state.get("status", "unknown") if isinstance(state, dict) else "unknown"),
                "phase": (state.get("phase", "unknown") if isinstance(state, dict) else "unknown"),
            }
        return {
            "runId": run_id,
            "active": active,
            "request": request,
            "state": state,
            "report": report,
            "files": files,
        }

    def artifact(self, run_id: str, name: str) -> Path:
        if not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", name):
            raise TsnSecurityError("Ungueltiger Artefaktname")
        path = self._run_dir(run_id) / name
        if not path.is_file():
            raise TsnSecurityError("Artefakt nicht gefunden")
        return path

    def _run_dir(self, run_id: str) -> Path:
        if not RUN_ID_RE.fullmatch(run_id):
            raise TsnSecurityError("Ungueltige Laufkennung")
        path = self.artifact_root / run_id
        if not path.is_dir():
            raise TsnSecurityError("Testlauf nicht gefunden")
        return path

    @staticmethod
    def _read_json(path: Path) -> dict[str, Any] | None:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            return value if isinstance(value, dict) else None
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return None
