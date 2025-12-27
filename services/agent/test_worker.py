"""Simple long-running worker to simulate execution of hardware tests.

The script reads a JSON config containing profile details and emits status lines
to stdout so the API can stream progress to connected clients.
"""

from __future__ import annotations

import argparse
import json
import signal
import sys
import time
from pathlib import Path
from typing import Any, Dict

_stop_requested = False


def _handle_stop(signum: int, frame: Any) -> None:  # noqa: D401
    global _stop_requested
    _stop_requested = True


for _sig in (signal.SIGINT, signal.SIGTERM):
    try:
        signal.signal(_sig, _handle_stop)
    except (AttributeError, ValueError):
        # Not all signals exist on every platform
        pass


def _load_config(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _print(line: str) -> None:
    print(line, flush=True)


def run(config_path: Path) -> int:
    cfg = _load_config(config_path)
    profile = cfg.get("profile") or {}
    run_id = cfg.get("runId") or "unknown"
    profile_name = profile.get("name") or profile.get("id") or "Unbenannt"

    _print(f"[worker] Starte Testlauf {run_id} für Profil '{profile_name}'.")
    settings = profile.get("settings")
    if isinstance(settings, dict):
        _print("[worker] Übernommene Einstellungen:")
        for key, value in sorted(settings.items()):
            _print(f"    - {key}: {value}")
    else:
        _print("[worker] Keine zusätzlichen Einstellungen gefunden.")

    steps = 20
    for idx in range(steps):
        if _stop_requested:
            _print("[worker] Abbruchsignal erhalten, räume auf…")
            time.sleep(0.5)
            _print("[worker] Testlauf wurde abgebrochen.")
            return 130
        progress = int(((idx + 1) / steps) * 100)
        _print(f"[progress] Schritt {idx + 1}/{steps} – Fortschritt {progress}%")
        time.sleep(0.5)

    _print("[worker] Testlauf erfolgreich abgeschlossen.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="BA-TAP Test Worker")
    parser.add_argument("--config", required=True, help="Pfad zur Run-Konfiguration (JSON)")
    args = parser.parse_args(argv)
    config_path = Path(args.config)
    if not config_path.exists():
        print(f"Config-Datei {config_path} wurde nicht gefunden.", file=sys.stderr)
        return 2
    try:
        return run(config_path)
    except KeyboardInterrupt:
        return 130
    except Exception as exc:  # noqa: BLE001
        print(f"Testlauf fehlgeschlagen: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
