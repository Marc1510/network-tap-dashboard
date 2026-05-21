from __future__ import annotations

import json
import platform
import re
import subprocess
import time
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from services.api.deps import PROFILES_DIR
from services.api.profile_service import utcnow_iso


LOCAL_TSN_DEVICES_FILE = PROFILES_DIR / "local_tsn_devices.json"
DEFAULT_ICON = "server"
ICON_RE = re.compile(r"^[a-z0-9_-]{1,32}$")


def ensure_local_tsn_devices_file() -> None:
    try:
        PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Profile-Verzeichnis kann nicht erstellt werden: {exc}")

    if LOCAL_TSN_DEVICES_FILE.exists():
        return

    try:
        with LOCAL_TSN_DEVICES_FILE.open("w", encoding="utf-8") as f:
            json.dump({"devices": []}, f, ensure_ascii=False, indent=2)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Device-Datei konnte nicht erstellt werden: {exc}")


def _normalize_name(value: Any) -> str:
    name = str(value or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="'name' ist erforderlich")
    if len(name) > 120:
        raise HTTPException(status_code=400, detail="'name' darf maximal 120 Zeichen haben")
    return name


def _normalize_ip_address(value: Any) -> str:
    ip_address = str(value or "").strip()
    if not ip_address:
        raise HTTPException(status_code=400, detail="'ipAddress' ist erforderlich")
    if len(ip_address) > 255:
        raise HTTPException(status_code=400, detail="'ipAddress' ist zu lang")
    if any(ch.isspace() for ch in ip_address):
        raise HTTPException(status_code=400, detail="'ipAddress' darf keine Leerzeichen enthalten")
    return ip_address


def _normalize_icon(value: Any) -> str:
    icon = str(value or DEFAULT_ICON).strip().lower()
    if not icon:
        return DEFAULT_ICON
    if not ICON_RE.fullmatch(icon):
        raise HTTPException(status_code=400, detail="'icon' enthaelt ungueltige Zeichen")
    return icon


def _normalize_description(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    if len(text) > 500:
        raise HTTPException(status_code=400, detail="'description' darf maximal 500 Zeichen haben")
    return text


def _normalize_ssh_port(value: Any) -> int:
    if value is None or value == "":
        return 22
    try:
        port = int(value)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="'sshPort' muss eine Zahl sein")
    if port < 1 or port > 65535:
        raise HTTPException(status_code=400, detail="'sshPort' muss zwischen 1 und 65535 liegen")
    return port


def _normalize_ssh_username(value: Any) -> str | None:
    username = str(value or "").strip()
    if not username:
        return None
    if len(username) > 64:
        raise HTTPException(status_code=400, detail="'sshUsername' darf maximal 64 Zeichen haben")
    return username


def _sanitize_loaded_device(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    device_id = str(raw.get("id") or "").strip()
    if not device_id:
        return None

    try:
        name = _normalize_name(raw.get("name"))
        ip_address = _normalize_ip_address(raw.get("ipAddress"))
        icon = _normalize_icon(raw.get("icon"))
        ssh_port = _normalize_ssh_port(raw.get("sshPort"))
        description = _normalize_description(raw.get("description"))
        ssh_username = _normalize_ssh_username(raw.get("sshUsername"))
    except HTTPException:
        return None

    created_utc = str(raw.get("createdUtc") or "").strip() or utcnow_iso()
    updated_utc = str(raw.get("updatedUtc") or "").strip() or created_utc

    return {
        "id": device_id,
        "name": name,
        "ipAddress": ip_address,
        "icon": icon,
        "description": description,
        "sshPort": ssh_port,
        "sshUsername": ssh_username,
        "createdUtc": created_utc,
        "updatedUtc": updated_utc,
    }


def list_devices() -> list[dict[str, Any]]:
    ensure_local_tsn_devices_file()
    try:
        with LOCAL_TSN_DEVICES_FILE.open("r", encoding="utf-8") as f:
            payload = json.load(f)
    except FileNotFoundError:
        return []
    except Exception:  # noqa: BLE001
        return []

    raw_devices = payload.get("devices") if isinstance(payload, dict) else None
    if not isinstance(raw_devices, list):
        return []

    devices: list[dict[str, Any]] = []
    for item in raw_devices:
        sanitized = _sanitize_loaded_device(item)
        if sanitized:
            devices.append(sanitized)
    return devices


def save_devices(devices: list[dict[str, Any]]) -> None:
    ensure_local_tsn_devices_file()
    try:
        with LOCAL_TSN_DEVICES_FILE.open("w", encoding="utf-8") as f:
            json.dump({"devices": devices}, f, ensure_ascii=False, indent=2)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Device-Datei konnte nicht gespeichert werden: {exc}")


def create_device(data: dict[str, Any]) -> dict[str, Any]:
    now = utcnow_iso()
    device = {
        "id": uuid4().hex,
        "name": _normalize_name(data.get("name")),
        "ipAddress": _normalize_ip_address(data.get("ipAddress")),
        "icon": _normalize_icon(data.get("icon")),
        "description": _normalize_description(data.get("description")),
        "sshPort": _normalize_ssh_port(data.get("sshPort")),
        "sshUsername": _normalize_ssh_username(data.get("sshUsername")),
        "createdUtc": now,
        "updatedUtc": now,
    }
    devices = list_devices()
    devices.append(device)
    save_devices(devices)
    return device


def update_device(device_id: str, data: dict[str, Any]) -> dict[str, Any]:
    devices = list_devices()
    target_idx = next((idx for idx, item in enumerate(devices) if item.get("id") == device_id), -1)
    if target_idx < 0:
        raise HTTPException(status_code=404, detail="Device nicht gefunden")

    current = dict(devices[target_idx])

    if "name" in data:
        current["name"] = _normalize_name(data.get("name"))
    if "ipAddress" in data:
        current["ipAddress"] = _normalize_ip_address(data.get("ipAddress"))
    if "icon" in data:
        current["icon"] = _normalize_icon(data.get("icon"))
    if "description" in data:
        current["description"] = _normalize_description(data.get("description"))
    if "sshPort" in data:
        current["sshPort"] = _normalize_ssh_port(data.get("sshPort"))
    if "sshUsername" in data:
        current["sshUsername"] = _normalize_ssh_username(data.get("sshUsername"))

    current["updatedUtc"] = utcnow_iso()
    devices[target_idx] = current
    save_devices(devices)
    return current


def delete_device(device_id: str) -> None:
    devices = list_devices()
    filtered = [item for item in devices if item.get("id") != device_id]
    if len(filtered) == len(devices):
        raise HTTPException(status_code=404, detail="Device nicht gefunden")
    save_devices(filtered)


def _run_ping(target: str, timeout_seconds: int = 2) -> dict[str, Any]:
    system = platform.system().lower()
    timeout_seconds = max(1, int(timeout_seconds))

    if system.startswith("win"):
        command = ["ping", "-n", "1", "-w", str(timeout_seconds * 1000), target]
    elif system == "darwin":
        command = ["ping", "-c", "1", "-W", str(timeout_seconds * 1000), target]
    else:
        command = ["ping", "-c", "1", "-W", str(timeout_seconds), target]

    start = time.perf_counter()
    try:
        result = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=timeout_seconds + 1,
            check=False,
        )
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="Ping-Befehl ist auf dem Server nicht verfuegbar")
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "latencyMs": None,
            "message": "Ping-Timeout",
            "target": target,
        }

    latency_ms = int(round((time.perf_counter() - start) * 1000))
    output = (result.stdout or "").strip()
    first_line = next((line.strip() for line in output.splitlines() if line.strip()), "")

    return {
        "success": result.returncode == 0,
        "latencyMs": latency_ms,
        "message": first_line or ("Ping erfolgreich" if result.returncode == 0 else "Ping fehlgeschlagen"),
        "target": target,
    }


def ping_device(device_id: str) -> dict[str, Any]:
    devices = list_devices()
    device = next((item for item in devices if item.get("id") == device_id), None)
    if not device:
        raise HTTPException(status_code=404, detail="Device nicht gefunden")
    target = _normalize_ip_address(device.get("ipAddress"))
    result = _run_ping(target)
    return {
        "deviceId": device_id,
        **result,
    }
