from __future__ import annotations

import asyncio
import json
import platform
import re
import shlex
import subprocess
import time
from typing import Any
from uuid import uuid4

from fastapi import HTTPException

from services.api.deps import PROFILES_DIR
from services.api.profile_service import utcnow_iso

try:
    import asyncssh  # type: ignore
except Exception:  # noqa: BLE001
    asyncssh = None


LOCAL_TSN_STATE_FILE = PROFILES_DIR / "local_tsn_network_state.json"
LEGACY_LOCAL_TSN_DEVICES_FILE = PROFILES_DIR / "local_tsn_devices.json"
DEFAULT_ICON = "server"
DEFAULT_PRIMARY_INTERFACE = "eth0"
DEFAULT_ROLE = "generic"
STATE_VERSION = 2
MAX_ACTIVITY_ITEMS = 40
TSN_FEATURE_IDS = ("gptp", "qbv", "preemption", "timestamping")
DEVICE_ROLES = ("controller", "switch", "bridge", "endpoint", "observer", "generic")
FEATURE_STATUSES = ("inactive", "running", "success", "failed", "partial", "unknown")
PING_TRAFFIC_CLASSES = ("management", "vlan10", "vlan20")
ICON_RE = re.compile(r"^[a-z0-9_-]{1,32}$")
ROLE_RE = re.compile(r"^[a-z-]{1,32}$")
INTERFACE_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,32}$")
QOS_RE = re.compile(r"^0x[0-9a-fA-F]{1,2}$")

FEATURE_CATALOG = [
    {
        "id": "gptp",
        "name": "gPTP (IEEE 802.1AS)",
        "summary": "Startet ptp4l/phc2sys auf Switch und Endpunkten und prueft die gemeinsame Referenzzeit.",
        "requiredRoles": ["switch", "endpoint"],
    },
    {
        "id": "qbv",
        "name": "Traffic Shaping (802.1Qbv)",
        "summary": "Erzeugt VLANs, setzt QoS-Mapping und aktiviert den Time-Aware Shaper mit Taprio.",
        "requiredRoles": ["switch", "endpoint"],
    },
    {
        "id": "preemption",
        "name": "Frame Preemption (802.1Qbu/802.3br)",
        "summary": "Schaltet MAC Merge ein und aktiviert einen Taprio-Plan mit Preemption-Unterstuetzung.",
        "requiredRoles": ["switch", "endpoint"],
    },
    {
        "id": "timestamping",
        "name": "Timestamping & Verifikation",
        "summary": "Aktiviert QoS-Mapping fuer priorisierten Traffic und prueft Hardware-Timestamping.",
        "requiredRoles": ["switch", "endpoint"],
    },
]


class FeatureSelectionError(RuntimeError):
    pass


def ensure_local_tsn_state_file() -> None:
    try:
        PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Profile-Verzeichnis kann nicht erstellt werden: {exc}")

    if LOCAL_TSN_STATE_FILE.exists():
        return

    save_state_raw(_build_initial_state())


def _build_initial_state() -> dict[str, Any]:
    legacy_devices = _load_legacy_devices_for_migration()
    if not legacy_devices:
        return {"version": STATE_VERSION, "networks": []}

    now = utcnow_iso()
    migrated_network = {
        "id": uuid4().hex,
        "name": "Migriertes TSN-Netz",
        "description": "Automatisch aus der bisherigen Device-Liste uebernommen.",
        "createdUtc": now,
        "updatedUtc": now,
        "featureStates": _default_feature_states(),
        "activity": [],
        "devices": [],
    }

    for index, raw in enumerate(legacy_devices):
        sanitized = _sanitize_loaded_legacy_device(raw, index=index)
        if sanitized:
            migrated_network["devices"].append(sanitized)

    _append_activity(
        migrated_network,
        title="Migration abgeschlossen",
        message=f"{len(migrated_network['devices'])} Geraete wurden in ein erstes TSN-Netz uebernommen.",
        level="info",
    )
    return {"version": STATE_VERSION, "networks": [migrated_network]}


def _load_legacy_devices_for_migration() -> list[dict[str, Any]]:
    if not LEGACY_LOCAL_TSN_DEVICES_FILE.exists():
        return []

    try:
        with LEGACY_LOCAL_TSN_DEVICES_FILE.open("r", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception:  # noqa: BLE001
        return []

    raw_devices = payload.get("devices") if isinstance(payload, dict) else None
    return raw_devices if isinstance(raw_devices, list) else []


def _sanitize_loaded_legacy_device(raw: Any, *, index: int) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None

    device_id = str(raw.get("id") or uuid4().hex).strip()
    name = str(raw.get("name") or "").strip()
    ip_address = str(raw.get("ipAddress") or "").strip()
    if not name or not ip_address:
        return None

    created_utc = str(raw.get("createdUtc") or "").strip() or utcnow_iso()
    updated_utc = str(raw.get("updatedUtc") or "").strip() or created_utc
    return {
        "id": device_id,
        "name": name,
        "role": "generic",
        "ipAddress": ip_address,
        "sshHost": ip_address,
        "icon": _safe_loaded_icon(raw.get("icon")),
        "description": _safe_loaded_description(raw.get("description")),
        "sshPort": _safe_loaded_port(raw.get("sshPort"), default=22),
        "sshUsername": _safe_loaded_username(raw.get("sshUsername")),
        "sshPassword": None,
        "jumpHostDeviceId": None,
        "primaryInterface": DEFAULT_PRIMARY_INTERFACE,
        "secondaryInterface": None,
        "bridgeInterface": None,
        "topologyOrder": index,
        "nodeAddressSuffix": _derive_node_address_suffix(ip_address),
        "createdUtc": created_utc,
        "updatedUtc": updated_utc,
        "featureStates": _default_feature_states(),
        "reachability": _empty_reachability_state(),
    }


def _default_feature_states() -> dict[str, dict[str, Any]]:
    return {feature_id: _empty_feature_state() for feature_id in TSN_FEATURE_IDS}


def _empty_feature_state() -> dict[str, Any]:
    return {
        "status": "inactive",
        "message": "Noch nicht aktiviert.",
        "updatedUtc": None,
        "lastAction": None,
        "lastDurationMs": None,
        "deviceResults": [],
    }


def _empty_reachability_state() -> dict[str, Any]:
    return {
        "status": "unknown",
        "message": "Noch nicht geprueft.",
        "updatedUtc": None,
        "latencyMs": None,
        "target": None,
    }


def _safe_loaded_icon(value: Any) -> str:
    icon = str(value or DEFAULT_ICON).strip().lower()
    return icon if ICON_RE.fullmatch(icon) else DEFAULT_ICON


def _safe_loaded_description(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def _safe_loaded_port(value: Any, *, default: int) -> int:
    try:
        port = int(value)
    except Exception:  # noqa: BLE001
        return default
    return port if 1 <= port <= 65535 else default


def _safe_loaded_username(value: Any) -> str | None:
    username = str(value or "").strip()
    return username or None


def load_state_raw() -> list[dict[str, Any]]:
    ensure_local_tsn_state_file()
    try:
        with LOCAL_TSN_STATE_FILE.open("r", encoding="utf-8") as f:
            payload = json.load(f)
    except Exception:  # noqa: BLE001
        return []

    raw_networks = payload.get("networks") if isinstance(payload, dict) else None
    if not isinstance(raw_networks, list):
        return []

    networks: list[dict[str, Any]] = []
    for raw_network in raw_networks:
        sanitized = _sanitize_loaded_network(raw_network)
        if sanitized:
            networks.append(sanitized)
    return networks


def save_state_raw(networks: dict[str, Any] | list[dict[str, Any]]) -> None:
    payload = networks if isinstance(networks, dict) else {"version": STATE_VERSION, "networks": networks}
    try:
        PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Profile-Verzeichnis kann nicht erstellt werden: {exc}")
    try:
        with LOCAL_TSN_STATE_FILE.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"TSN-Datei konnte nicht gespeichert werden: {exc}")


def _sanitize_loaded_network(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None

    network_id = str(raw.get("id") or "").strip()
    name = str(raw.get("name") or "").strip()
    if not network_id or not name:
        return None

    created_utc = str(raw.get("createdUtc") or "").strip() or utcnow_iso()
    updated_utc = str(raw.get("updatedUtc") or "").strip() or created_utc
    description = _safe_loaded_description(raw.get("description"))

    devices: list[dict[str, Any]] = []
    raw_devices = raw.get("devices")
    if isinstance(raw_devices, list):
        for device in raw_devices:
            sanitized_device = _sanitize_loaded_device(device)
            if sanitized_device:
                devices.append(sanitized_device)

    device_ids = {device["id"] for device in devices}
    for device in devices:
        jump_host_id = device.get("jumpHostDeviceId")
        if jump_host_id and jump_host_id not in device_ids:
            device["jumpHostDeviceId"] = None

    return {
        "id": network_id,
        "name": name,
        "description": description,
        "createdUtc": created_utc,
        "updatedUtc": updated_utc,
        "featureStates": _sanitize_feature_state_map(raw.get("featureStates")),
        "activity": _sanitize_activity(raw.get("activity")),
        "devices": sorted(devices, key=lambda device: (int(device.get("topologyOrder") or 0), device["name"].lower())),
    }


def _sanitize_loaded_device(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None

    device_id = str(raw.get("id") or "").strip()
    name = str(raw.get("name") or "").strip()
    ip_address = str(raw.get("ipAddress") or "").strip()
    if not device_id or not name or not ip_address:
        return None

    created_utc = str(raw.get("createdUtc") or "").strip() or utcnow_iso()
    updated_utc = str(raw.get("updatedUtc") or "").strip() or created_utc

    role = str(raw.get("role") or DEFAULT_ROLE).strip().lower()
    if role not in DEVICE_ROLES:
        role = DEFAULT_ROLE

    ssh_host = str(raw.get("sshHost") or ip_address).strip() or ip_address
    jump_host_id = str(raw.get("jumpHostDeviceId") or "").strip() or None
    node_address_suffix = raw.get("nodeAddressSuffix")
    try:
        node_address_suffix = int(node_address_suffix) if node_address_suffix is not None else _derive_node_address_suffix(ip_address)
    except Exception:  # noqa: BLE001
        node_address_suffix = _derive_node_address_suffix(ip_address)

    return {
        "id": device_id,
        "name": name,
        "role": role,
        "ipAddress": ip_address,
        "sshHost": ssh_host,
        "icon": _safe_loaded_icon(raw.get("icon")),
        "description": _safe_loaded_description(raw.get("description")),
        "sshPort": _safe_loaded_port(raw.get("sshPort"), default=22),
        "sshUsername": _safe_loaded_username(raw.get("sshUsername")),
        "sshPassword": _safe_loaded_description(raw.get("sshPassword")),
        "jumpHostDeviceId": jump_host_id,
        "primaryInterface": _safe_loaded_interface(raw.get("primaryInterface"), default=DEFAULT_PRIMARY_INTERFACE),
        "secondaryInterface": _safe_loaded_interface(raw.get("secondaryInterface")),
        "bridgeInterface": _safe_loaded_interface(raw.get("bridgeInterface")),
        "topologyOrder": _safe_loaded_order(raw.get("topologyOrder")),
        "nodeAddressSuffix": node_address_suffix if isinstance(node_address_suffix, int) and 1 <= node_address_suffix <= 254 else None,
        "createdUtc": created_utc,
        "updatedUtc": updated_utc,
        "featureStates": _sanitize_feature_state_map(raw.get("featureStates")),
        "reachability": _sanitize_reachability_state(raw.get("reachability")),
    }


def _safe_loaded_interface(value: Any, *, default: str | None = None) -> str | None:
    if value is None:
        return default
    text = str(value).strip()
    if not text:
        return default
    return text if INTERFACE_RE.fullmatch(text) else default


def _safe_loaded_order(value: Any) -> int:
    try:
        order = int(value)
    except Exception:  # noqa: BLE001
        return 0
    return max(0, min(order, 999))


def _sanitize_activity(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []

    items: list[dict[str, Any]] = []
    for entry in raw[:MAX_ACTIVITY_ITEMS]:
        if not isinstance(entry, dict):
            continue
        items.append(
            {
                "id": str(entry.get("id") or uuid4().hex),
                "createdUtc": str(entry.get("createdUtc") or utcnow_iso()),
                "level": _normalize_activity_level(entry.get("level")),
                "title": str(entry.get("title") or "Aktivitaet"),
                "message": str(entry.get("message") or ""),
                "featureId": str(entry.get("featureId") or "").strip() or None,
                "deviceId": str(entry.get("deviceId") or "").strip() or None,
                "outputs": _sanitize_output_list(entry.get("outputs")),
            }
        )
    return items


def _normalize_activity_level(value: Any) -> str:
    level = str(value or "info").strip().lower()
    return level if level in {"info", "success", "warning", "error"} else "info"


def _sanitize_feature_state_map(raw: Any) -> dict[str, dict[str, Any]]:
    state_map = _default_feature_states()
    if not isinstance(raw, dict):
        return state_map

    for feature_id in TSN_FEATURE_IDS:
        feature_state = raw.get(feature_id)
        if not isinstance(feature_state, dict):
            continue
        status = str(feature_state.get("status") or "inactive").strip().lower()
        if status not in FEATURE_STATUSES:
            status = "inactive"
        state_map[feature_id] = {
            "status": status,
            "message": str(feature_state.get("message") or _empty_feature_state()["message"]),
            "updatedUtc": str(feature_state.get("updatedUtc") or "").strip() or None,
            "lastAction": str(feature_state.get("lastAction") or "").strip() or None,
            "lastDurationMs": _safe_loaded_duration(feature_state.get("lastDurationMs")),
            "deviceResults": _sanitize_output_list(feature_state.get("deviceResults")),
        }
    return state_map


def _sanitize_output_list(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []

    entries: list[dict[str, Any]] = []
    for item in raw[:8]:
        if not isinstance(item, dict):
            continue
        entries.append(
            {
                "deviceId": str(item.get("deviceId") or "").strip() or None,
                "deviceName": str(item.get("deviceName") or "").strip() or None,
                "success": bool(item.get("success")),
                "status": str(item.get("status") or "").strip() or None,
                "message": _clip_text(str(item.get("message") or ""), limit=280),
                "command": _clip_text(str(item.get("command") or ""), limit=280),
                "stdout": _clip_text(str(item.get("stdout") or ""), limit=900),
                "target": str(item.get("target") or "").strip() or None,
                "latencyMs": _safe_loaded_duration(item.get("latencyMs")),
            }
        )
    return entries


def _safe_loaded_duration(value: Any) -> int | None:
    try:
        duration = int(value)
    except Exception:  # noqa: BLE001
        return None
    return duration if duration >= 0 else None


def _sanitize_reachability_state(raw: Any) -> dict[str, Any]:
    state = _empty_reachability_state()
    if not isinstance(raw, dict):
        return state
    status = str(raw.get("status") or state["status"]).strip().lower()
    if status not in {"unknown", "success", "failed", "running"}:
        status = "unknown"
    return {
        "status": status,
        "message": str(raw.get("message") or state["message"]),
        "updatedUtc": str(raw.get("updatedUtc") or "").strip() or None,
        "latencyMs": _safe_loaded_duration(raw.get("latencyMs")),
        "target": str(raw.get("target") or "").strip() or None,
    }


def _public_state(networks: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "featureCatalog": FEATURE_CATALOG,
        "networks": [_public_network(network) for network in networks],
    }


def _public_network(network: dict[str, Any]) -> dict[str, Any]:
    devices = sorted(network["devices"], key=lambda device: (device["topologyOrder"], device["name"].lower()))
    return {
        "id": network["id"],
        "name": network["name"],
        "description": network.get("description"),
        "createdUtc": network["createdUtc"],
        "updatedUtc": network["updatedUtc"],
        "featureStates": network["featureStates"],
        "activity": network["activity"],
        "devices": [_public_device(device) for device in devices],
    }


def _public_device(device: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": device["id"],
        "name": device["name"],
        "role": device["role"],
        "ipAddress": device["ipAddress"],
        "sshHost": device.get("sshHost") or device["ipAddress"],
        "icon": device["icon"],
        "description": device.get("description"),
        "sshPort": device["sshPort"],
        "sshUsername": device.get("sshUsername"),
        "hasSshPassword": bool(device.get("sshPassword")),
        "jumpHostDeviceId": device.get("jumpHostDeviceId"),
        "primaryInterface": device.get("primaryInterface"),
        "secondaryInterface": device.get("secondaryInterface"),
        "bridgeInterface": device.get("bridgeInterface"),
        "topologyOrder": device.get("topologyOrder", 0),
        "nodeAddressSuffix": device.get("nodeAddressSuffix"),
        "createdUtc": device["createdUtc"],
        "updatedUtc": device["updatedUtc"],
        "featureStates": device["featureStates"],
        "reachability": device["reachability"],
    }


def get_state() -> dict[str, Any]:
    return _public_state(load_state_raw())


def _require_network(networks: list[dict[str, Any]], network_id: str) -> dict[str, Any]:
    for network in networks:
        if network["id"] == network_id:
            return network
    raise HTTPException(status_code=404, detail="TSN-Netz nicht gefunden")


def _find_device(network: dict[str, Any], device_id: str) -> dict[str, Any] | None:
    return next((device for device in network["devices"] if device["id"] == device_id), None)


def _require_device(network: dict[str, Any], device_id: str) -> dict[str, Any]:
    device = _find_device(network, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Geraet nicht gefunden")
    return device


def create_network(data: dict[str, Any]) -> dict[str, Any]:
    networks = load_state_raw()
    now = utcnow_iso()
    network = {
        "id": uuid4().hex,
        "name": _normalize_name(data.get("name"), field="name", max_length=120),
        "description": _normalize_optional_text(data.get("description"), field="description", max_length=500),
        "createdUtc": now,
        "updatedUtc": now,
        "featureStates": _default_feature_states(),
        "activity": [],
        "devices": [],
    }
    _append_activity(
        network,
        title="Netz angelegt",
        message="Das TSN-Netz wurde erstellt und ist bereit fuer Geräte und Features.",
        level="success",
    )
    networks.append(network)
    save_state_raw(networks)
    return _public_network(network)


def update_network(network_id: str, data: dict[str, Any]) -> dict[str, Any]:
    networks = load_state_raw()
    network = _require_network(networks, network_id)

    if "name" in data:
        network["name"] = _normalize_name(data.get("name"), field="name", max_length=120)
    if "description" in data:
        network["description"] = _normalize_optional_text(data.get("description"), field="description", max_length=500)
    network["updatedUtc"] = utcnow_iso()
    save_state_raw(networks)
    return _public_network(network)


def delete_network(network_id: str) -> None:
    networks = load_state_raw()
    filtered = [network for network in networks if network["id"] != network_id]
    if len(filtered) == len(networks):
        raise HTTPException(status_code=404, detail="TSN-Netz nicht gefunden")
    save_state_raw(filtered)


def create_device(network_id: str, data: dict[str, Any]) -> dict[str, Any]:
    networks = load_state_raw()
    network = _require_network(networks, network_id)
    now = utcnow_iso()
    device = _build_device_record(network=network, data=data, existing=None, created_utc=now)
    network["devices"].append(device)
    network["devices"].sort(key=lambda item: (item["topologyOrder"], item["name"].lower()))
    network["updatedUtc"] = now
    _append_activity(
        network,
        title="Geraet angelegt",
        message=f"{device['name']} wurde dem Netz hinzugefuegt.",
        level="success",
        device_id=device["id"],
    )
    save_state_raw(networks)
    return _public_device(device)


def update_device(network_id: str, device_id: str, data: dict[str, Any]) -> dict[str, Any]:
    networks = load_state_raw()
    network = _require_network(networks, network_id)
    current = _require_device(network, device_id)
    updated = _build_device_record(network=network, data=data, existing=current, created_utc=current["createdUtc"])
    index = network["devices"].index(current)
    network["devices"][index] = updated
    network["devices"].sort(key=lambda item: (item["topologyOrder"], item["name"].lower()))
    network["updatedUtc"] = updated["updatedUtc"]
    save_state_raw(networks)
    return _public_device(updated)


def delete_device(network_id: str, device_id: str) -> None:
    networks = load_state_raw()
    network = _require_network(networks, network_id)
    device = _require_device(network, device_id)
    network["devices"] = [item for item in network["devices"] if item["id"] != device_id]
    for item in network["devices"]:
        if item.get("jumpHostDeviceId") == device_id:
            item["jumpHostDeviceId"] = None
    network["updatedUtc"] = utcnow_iso()
    _append_activity(
        network,
        title="Geraet entfernt",
        message=f"{device['name']} wurde aus dem Netz entfernt.",
        level="warning",
        device_id=device_id,
    )
    save_state_raw(networks)


def _build_device_record(
    *,
    network: dict[str, Any],
    data: dict[str, Any],
    existing: dict[str, Any] | None,
    created_utc: str,
) -> dict[str, Any]:
    name = _normalize_name(data.get("name", existing.get("name") if existing else None), field="name", max_length=120)
    ip_address = _normalize_host_value(data.get("ipAddress", existing.get("ipAddress") if existing else None), field="ipAddress")
    role = _normalize_role(data.get("role", existing.get("role") if existing else DEFAULT_ROLE))
    ssh_host = _normalize_optional_host_value(data.get("sshHost", existing.get("sshHost") if existing else None), field="sshHost") or ip_address
    icon = _normalize_icon(data.get("icon", existing.get("icon") if existing else DEFAULT_ICON))
    description = _normalize_optional_text(
        data.get("description", existing.get("description") if existing else None),
        field="description",
        max_length=500,
    )
    ssh_port = _normalize_ssh_port(data.get("sshPort", existing.get("sshPort") if existing else 22))
    ssh_username = _normalize_optional_text(
        data.get("sshUsername", existing.get("sshUsername") if existing else None),
        field="sshUsername",
        max_length=64,
    )
    ssh_password = _normalize_optional_secret(data.get("sshPassword", "__UNCHANGED__" if existing else None), existing_password=existing.get("sshPassword") if existing else None)
    primary_interface = _normalize_interface_name(
        data.get("primaryInterface", existing.get("primaryInterface") if existing else DEFAULT_PRIMARY_INTERFACE),
        field="primaryInterface",
        default=DEFAULT_PRIMARY_INTERFACE,
    )
    secondary_interface = _normalize_optional_interface_name(
        data.get("secondaryInterface", existing.get("secondaryInterface") if existing else None),
        field="secondaryInterface",
    )
    bridge_interface = _normalize_optional_interface_name(
        data.get("bridgeInterface", existing.get("bridgeInterface") if existing else None),
        field="bridgeInterface",
    )
    topology_order = _normalize_topology_order(data.get("topologyOrder", existing.get("topologyOrder") if existing else len(network["devices"])))
    node_address_suffix = _normalize_node_address_suffix(
        data.get("nodeAddressSuffix", existing.get("nodeAddressSuffix") if existing else _derive_node_address_suffix(ip_address)),
        ip_address=ip_address,
    )

    jump_host_id = data.get("jumpHostDeviceId", existing.get("jumpHostDeviceId") if existing else None)
    jump_host_id = _normalize_optional_id(jump_host_id, field="jumpHostDeviceId")
    if jump_host_id:
        jump_host = _find_device(network, jump_host_id)
        if jump_host is None or (existing and jump_host_id == existing["id"]):
            raise HTTPException(status_code=400, detail="Ausgewaehlter Jump Host ist ungueltig")

    return {
        "id": existing["id"] if existing else uuid4().hex,
        "name": name,
        "role": role,
        "ipAddress": ip_address,
        "sshHost": ssh_host,
        "icon": icon,
        "description": description,
        "sshPort": ssh_port,
        "sshUsername": ssh_username,
        "sshPassword": ssh_password,
        "jumpHostDeviceId": jump_host_id,
        "primaryInterface": primary_interface,
        "secondaryInterface": secondary_interface,
        "bridgeInterface": bridge_interface,
        "topologyOrder": topology_order,
        "nodeAddressSuffix": node_address_suffix,
        "createdUtc": created_utc,
        "updatedUtc": utcnow_iso(),
        "featureStates": existing["featureStates"] if existing else _default_feature_states(),
        "reachability": existing["reachability"] if existing else _empty_reachability_state(),
    }


def _normalize_name(value: Any, *, field: str, max_length: int) -> str:
    text = str(value or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail=f"'{field}' ist erforderlich")
    if len(text) > max_length:
        raise HTTPException(status_code=400, detail=f"'{field}' darf maximal {max_length} Zeichen haben")
    return text


def _normalize_optional_text(value: Any, *, field: str, max_length: int) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    if len(text) > max_length:
        raise HTTPException(status_code=400, detail=f"'{field}' darf maximal {max_length} Zeichen haben")
    return text


def _normalize_host_value(value: Any, *, field: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail=f"'{field}' ist erforderlich")
    if len(text) > 255 or any(ch.isspace() for ch in text):
        raise HTTPException(status_code=400, detail=f"'{field}' ist ungueltig")
    return text


def _normalize_optional_host_value(value: Any, *, field: str) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    if len(text) > 255 or any(ch.isspace() for ch in text):
        raise HTTPException(status_code=400, detail=f"'{field}' ist ungueltig")
    return text


def _normalize_icon(value: Any) -> str:
    icon = str(value or DEFAULT_ICON).strip().lower()
    if not icon:
        return DEFAULT_ICON
    if not ICON_RE.fullmatch(icon):
        raise HTTPException(status_code=400, detail="'icon' enthaelt ungueltige Zeichen")
    return icon


def _normalize_role(value: Any) -> str:
    role = str(value or DEFAULT_ROLE).strip().lower()
    if not ROLE_RE.fullmatch(role) or role not in DEVICE_ROLES:
        raise HTTPException(status_code=400, detail="'role' ist ungueltig")
    return role


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


def _normalize_optional_secret(value: Any, *, existing_password: str | None) -> str | None:
    if value == "__UNCHANGED__":
        return existing_password
    text = str(value or "").strip()
    if not text:
        return None
    if len(text) > 256:
        raise HTTPException(status_code=400, detail="'sshPassword' darf maximal 256 Zeichen haben")
    return text


def _normalize_interface_name(value: Any, *, field: str, default: str) -> str:
    text = str(value or default).strip()
    if not text:
        return default
    if not INTERFACE_RE.fullmatch(text):
        raise HTTPException(status_code=400, detail=f"'{field}' enthaelt ungueltige Zeichen")
    return text


def _normalize_optional_interface_name(value: Any, *, field: str) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    if not INTERFACE_RE.fullmatch(text):
        raise HTTPException(status_code=400, detail=f"'{field}' enthaelt ungueltige Zeichen")
    return text


def _normalize_topology_order(value: Any) -> int:
    try:
        order = int(value)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="'topologyOrder' muss eine Zahl sein")
    if order < 0 or order > 999:
        raise HTTPException(status_code=400, detail="'topologyOrder' muss zwischen 0 und 999 liegen")
    return order


def _normalize_node_address_suffix(value: Any, *, ip_address: str) -> int | None:
    if value is None or value == "":
        return _derive_node_address_suffix(ip_address)
    try:
        suffix = int(value)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="'nodeAddressSuffix' muss eine Zahl sein")
    if suffix < 1 or suffix > 254:
        raise HTTPException(status_code=400, detail="'nodeAddressSuffix' muss zwischen 1 und 254 liegen")
    return suffix


def _normalize_optional_id(value: Any, *, field: str) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    if len(text) > 128:
        raise HTTPException(status_code=400, detail=f"'{field}' ist zu lang")
    return text


def _derive_node_address_suffix(ip_address: str) -> int | None:
    match = re.match(r"^\d+\.\d+\.\d+\.(\d+)$", ip_address)
    if not match:
        return None
    value = int(match.group(1))
    return value if 1 <= value <= 254 else None


def _append_activity(
    network: dict[str, Any],
    *,
    title: str,
    message: str,
    level: str,
    feature_id: str | None = None,
    device_id: str | None = None,
    outputs: list[dict[str, Any]] | None = None,
) -> None:
    items = network.setdefault("activity", [])
    items.insert(
        0,
        {
            "id": uuid4().hex,
            "createdUtc": utcnow_iso(),
            "level": _normalize_activity_level(level),
            "title": title,
            "message": message,
            "featureId": feature_id,
            "deviceId": device_id,
            "outputs": _sanitize_output_list(outputs or []),
        },
    )
    if len(items) > MAX_ACTIVITY_ITEMS:
        del items[MAX_ACTIVITY_ITEMS:]


def _update_feature_state(
    target: dict[str, Any],
    *,
    feature_id: str,
    status: str,
    message: str,
    action: str,
    duration_ms: int | None,
    device_results: list[dict[str, Any]],
) -> None:
    feature_states = target.setdefault("featureStates", _default_feature_states())
    feature_states[feature_id] = {
        "status": status if status in FEATURE_STATUSES else "unknown",
        "message": _clip_text(message, limit=280),
        "updatedUtc": utcnow_iso(),
        "lastAction": action,
        "lastDurationMs": duration_ms,
        "deviceResults": _sanitize_output_list(device_results),
    }


def _rollup_status(results: list[dict[str, Any]]) -> tuple[str, str]:
    if not results:
        return ("unknown", "Keine Ergebnisse vorhanden.")

    success_count = sum(1 for result in results if result.get("success"))
    if success_count == len(results):
        return ("success", f"{success_count}/{len(results)} Schritte erfolgreich.")
    if success_count == 0:
        first_error = next((result.get("message") for result in results if result.get("message")), "Alle Schritte fehlgeschlagen.")
        return ("failed", str(first_error))
    return ("partial", f"{success_count}/{len(results)} Schritte erfolgreich, bitte Details pruefen.")


async def activate_feature(network_id: str, feature_id: str) -> dict[str, Any]:
    networks = load_state_raw()
    network = _require_network(networks, network_id)
    feature_id = _normalize_feature_id(feature_id)

    start = time.perf_counter()
    try:
        results = await _run_feature_operation(network, feature_id, mode="activate")
    except FeatureSelectionError as exc:
        results = [{"success": False, "message": str(exc), "deviceName": None, "deviceId": None, "command": None, "stdout": ""}]
    duration_ms = int(round((time.perf_counter() - start) * 1000))
    status, message = _rollup_status(results)

    _update_feature_state(
        network,
        feature_id=feature_id,
        status=status,
        message=message,
        action="activate",
        duration_ms=duration_ms,
        device_results=results,
    )
    _apply_feature_results_to_devices(network, feature_id=feature_id, action="activate", results=results, duration_ms=duration_ms)
    network["updatedUtc"] = utcnow_iso()
    _append_activity(
        network,
        title=f"{_feature_name(feature_id)} aktiviert",
        message=message,
        level="success" if status == "success" else "warning" if status == "partial" else "error",
        feature_id=feature_id,
        outputs=results,
    )
    save_state_raw(networks)
    return {"network": _public_network(network), "result": {"status": status, "message": message, "durationMs": duration_ms, "deviceResults": results}}


async def verify_feature(network_id: str, feature_id: str) -> dict[str, Any]:
    networks = load_state_raw()
    network = _require_network(networks, network_id)
    feature_id = _normalize_feature_id(feature_id)

    start = time.perf_counter()
    try:
        results = await _run_feature_operation(network, feature_id, mode="verify")
    except FeatureSelectionError as exc:
        results = [{"success": False, "message": str(exc), "deviceName": None, "deviceId": None, "command": None, "stdout": ""}]
    duration_ms = int(round((time.perf_counter() - start) * 1000))
    status, message = _rollup_status(results)

    _update_feature_state(
        network,
        feature_id=feature_id,
        status=status,
        message=message,
        action="verify",
        duration_ms=duration_ms,
        device_results=results,
    )
    _apply_feature_results_to_devices(network, feature_id=feature_id, action="verify", results=results, duration_ms=duration_ms)
    network["updatedUtc"] = utcnow_iso()
    _append_activity(
        network,
        title=f"{_feature_name(feature_id)} geprueft",
        message=message,
        level="success" if status == "success" else "warning" if status == "partial" else "error",
        feature_id=feature_id,
        outputs=results,
    )
    save_state_raw(networks)
    return {"network": _public_network(network), "result": {"status": status, "message": message, "durationMs": duration_ms, "deviceResults": results}}


async def refresh_network(network_id: str) -> dict[str, Any]:
    networks = load_state_raw()
    network = _require_network(networks, network_id)
    summaries: list[str] = []

    for feature_id in TSN_FEATURE_IDS:
        try:
            results = await _run_feature_operation(network, feature_id, mode="verify")
        except FeatureSelectionError as exc:
            results = [{"success": False, "message": str(exc), "deviceName": None, "deviceId": None, "command": None, "stdout": ""}]

        status, message = _rollup_status(results)
        _update_feature_state(
            network,
            feature_id=feature_id,
            status=status,
            message=message,
            action="verify",
            duration_ms=None,
            device_results=results,
        )
        _apply_feature_results_to_devices(network, feature_id=feature_id, action="verify", results=results, duration_ms=None)
        summaries.append(f"{_feature_name(feature_id)}: {message}")

    network["updatedUtc"] = utcnow_iso()
    _append_activity(
        network,
        title="Netzstatus aktualisiert",
        message=" | ".join(summaries),
        level="info",
    )
    save_state_raw(networks)
    return {"network": _public_network(network)}


async def ping_device(network_id: str, device_id: str) -> dict[str, Any]:
    networks = load_state_raw()
    network = _require_network(networks, network_id)
    device = _require_device(network, device_id)

    result: dict[str, Any]
    jump_host_id = device.get("jumpHostDeviceId")
    if jump_host_id:
        jump_host = _require_device(network, jump_host_id)
        command = f"ping -c 1 -W 2 {shlex.quote(device['ipAddress'])}"
        remote = await _run_command_on_device(network, jump_host, command, timeout=10)
        result = _ping_result_from_remote(remote, target=device["ipAddress"])
        result["via"] = jump_host["name"]
    else:
        target = device.get("sshHost") or device["ipAddress"]
        result = _run_local_ping(target)
        result["via"] = "dashboard"

    device["reachability"] = {
        "status": "success" if result["success"] else "failed",
        "message": result["message"],
        "updatedUtc": utcnow_iso(),
        "latencyMs": result.get("latencyMs"),
        "target": result.get("target"),
    }
    network["updatedUtc"] = utcnow_iso()
    _append_activity(
        network,
        title=f"Ping auf {device['name']}",
        message=result["message"],
        level="success" if result["success"] else "error",
        device_id=device_id,
        outputs=[result],
    )
    save_state_raw(networks)
    return {"network": _public_network(network), "result": {"deviceId": device_id, **result}}


async def ping_between_devices(network_id: str, data: dict[str, Any]) -> dict[str, Any]:
    networks = load_state_raw()
    network = _require_network(networks, network_id)
    source = _require_device(network, _normalize_optional_id(data.get("sourceDeviceId"), field="sourceDeviceId") or "")
    target = _require_device(network, _normalize_optional_id(data.get("targetDeviceId"), field="targetDeviceId") or "")

    traffic_class = _normalize_ping_traffic_class(data.get("trafficClass"))
    target_address = _resolve_target_address(target, traffic_class=traffic_class)
    count = _normalize_ping_count(data.get("count"))
    qos = _normalize_optional_qos_hex(data.get("qosHex"))

    qos_part = f" -Q {qos}" if qos else ""
    command = f"ping -c {count} -W 2{qos_part} {shlex.quote(target_address)}"
    remote = await _run_command_on_device(network, source, command, timeout=max(10, count * 3))
    result = _ping_result_from_remote(remote, target=target_address)
    result.update(
        {
            "sourceDeviceId": source["id"],
            "sourceDeviceName": source["name"],
            "targetDeviceId": target["id"],
            "targetDeviceName": target["name"],
            "trafficClass": traffic_class,
            "qosHex": qos,
        }
    )

    _append_activity(
        network,
        title=f"Ping {source['name']} -> {target['name']}",
        message=result["message"],
        level="success" if result["success"] else "error",
        device_id=source["id"],
        outputs=[result],
    )
    network["updatedUtc"] = utcnow_iso()
    save_state_raw(networks)
    return {"network": _public_network(network), "result": result}


def _normalize_feature_id(feature_id: str) -> str:
    feature = str(feature_id or "").strip().lower()
    if feature not in TSN_FEATURE_IDS:
        raise HTTPException(status_code=404, detail="TSN-Feature nicht gefunden")
    return feature


def _feature_name(feature_id: str) -> str:
    match = next((entry["name"] for entry in FEATURE_CATALOG if entry["id"] == feature_id), feature_id)
    return match


def _apply_feature_results_to_devices(
    network: dict[str, Any],
    *,
    feature_id: str,
    action: str,
    results: list[dict[str, Any]],
    duration_ms: int | None,
) -> None:
    grouped_results: dict[str, list[dict[str, Any]]] = {}
    for result in results:
        device_id = result.get("deviceId")
        if not device_id:
            continue
        grouped_results.setdefault(device_id, []).append(result)

    for device in network["devices"]:
        device_results = grouped_results.get(device["id"])
        if not device_results:
            continue
        status, message = _rollup_status(device_results)
        _update_feature_state(
            device,
            feature_id=feature_id,
            status=status,
            message=message,
            action=action,
            duration_ms=duration_ms,
            device_results=device_results,
        )
        device["updatedUtc"] = utcnow_iso()


def _normalize_ping_traffic_class(value: Any) -> str:
    text = str(value or "management").strip().lower()
    if text not in PING_TRAFFIC_CLASSES:
        raise HTTPException(status_code=400, detail="'trafficClass' ist ungueltig")
    return text


def _normalize_ping_count(value: Any) -> int:
    if value is None or value == "":
        return 1
    try:
        count = int(value)
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="'count' muss eine Zahl sein")
    if count < 1 or count > 20:
        raise HTTPException(status_code=400, detail="'count' muss zwischen 1 und 20 liegen")
    return count


def _normalize_optional_qos_hex(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    if not QOS_RE.fullmatch(text):
        raise HTTPException(status_code=400, detail="'qosHex' muss im Format 0x10 angegeben werden")
    return text.lower()


def _resolve_target_address(device: dict[str, Any], *, traffic_class: str) -> str:
    if traffic_class == "management":
        return device["ipAddress"]

    suffix = device.get("nodeAddressSuffix") or _derive_node_address_suffix(device["ipAddress"])
    if not suffix:
        raise HTTPException(status_code=400, detail=f"{device['name']} hat keine VLAN-Adresssuffix-Konfiguration")
    subnet = "10.10.10" if traffic_class == "vlan10" else "10.10.20"
    return f"{subnet}.{suffix}"


def _switch_devices(network: dict[str, Any]) -> list[dict[str, Any]]:
    devices = [device for device in network["devices"] if device["role"] == "switch"]
    if not devices:
        raise FeatureSelectionError("Es ist kein Switch-Geraet im Netz konfiguriert.")
    return devices


def _endpoint_devices(network: dict[str, Any]) -> list[dict[str, Any]]:
    devices = [device for device in network["devices"] if device["role"] == "endpoint"]
    if not devices:
        raise FeatureSelectionError("Es ist kein Endpunkt-Geraet im Netz konfiguriert.")
    return devices


def _device_vlan_parent(device: dict[str, Any]) -> str:
    return device.get("bridgeInterface") or device.get("primaryInterface") or DEFAULT_PRIMARY_INTERFACE


def _taprio_schedule(preemptive: bool) -> str:
    base = (
        "tc qdisc replace dev {iface} parent root handle 100 taprio "
        "num_tc 8 map 0 1 2 3 4 5 3 7 0 0 0 0 0 0 0 0 "
        "queues 1@0 1@1 1@2 1@3 1@4 1@5 1@6 1@7 "
        "base-time 0 sched-entry S 0x08 200000 sched-entry S 0x01 800000"
    )
    if preemptive:
        base += " fp P E E E E E E E"
    base += " flags 2"
    return base


def _ensure_vlan_commands(device: dict[str, Any]) -> list[str]:
    parent = _device_vlan_parent(device)
    suffix = device.get("nodeAddressSuffix") or _derive_node_address_suffix(device["ipAddress"])
    if not suffix:
        raise FeatureSelectionError(f"{device['name']} benoetigt ein IPv4-Suffix fuer VLAN-Adressen.")

    return [
        f"ip link show {shlex.quote(parent)}.10 >/dev/null 2>&1 || ip link add link {shlex.quote(parent)} name {shlex.quote(parent)}.10 type vlan id 10",
        f"ip addr replace 10.10.10.{suffix}/24 dev {shlex.quote(parent)}.10",
        f"ip link set {shlex.quote(parent)}.10 up",
        f"ip link show {shlex.quote(parent)}.20 >/dev/null 2>&1 || ip link add link {shlex.quote(parent)} name {shlex.quote(parent)}.20 type vlan id 20",
        f"ip addr replace 10.10.20.{suffix}/24 dev {shlex.quote(parent)}.20",
        f"ip link set {shlex.quote(parent)}.20 up",
    ]


async def _run_feature_operation(network: dict[str, Any], feature_id: str, *, mode: str) -> list[dict[str, Any]]:
    handlers = {
        "gptp": _apply_gptp if mode == "activate" else _verify_gptp,
        "qbv": _apply_qbv if mode == "activate" else _verify_qbv,
        "preemption": _apply_preemption if mode == "activate" else _verify_preemption,
        "timestamping": _apply_timestamping if mode == "activate" else _verify_timestamping,
    }
    handler = handlers.get(feature_id)
    if handler is None:
        raise HTTPException(status_code=404, detail="TSN-Feature nicht gefunden")
    return await handler(network)


async def _apply_gptp(network: dict[str, Any]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    switches = _switch_devices(network)
    endpoints = _endpoint_devices(network)

    for device in switches:
        primary = device["primaryInterface"]
        secondary = device.get("secondaryInterface")
        interface_args = f"-i {primary}"
        if secondary:
            interface_args += f" -i {secondary}"
        script = "\n".join(
            [
                "set -e",
                "pkill -f 'ptp4l -f /etc/gPTP.cfg' >/dev/null 2>&1 || true",
                f"pkill -f 'phc2sys -s CLOCK_REALTIME -c {primary}' >/dev/null 2>&1 || true",
                f"nohup sh -lc {shlex.quote(f'phc2sys -s CLOCK_REALTIME -c {primary} -m -O 0')} >/tmp/tsn-phc2sys-master.log 2>&1 &",
                f"nohup sh -lc {shlex.quote(f'ptp4l -f /etc/gPTP.cfg {interface_args} -m --boundary_clock_jbod=1')} >/tmp/tsn-ptp4l-master.log 2>&1 &",
                "sleep 1",
                "pgrep -af 'ptp4l|phc2sys'",
            ]
        )
        results.append(await _run_command_on_device(network, device, script, timeout=20))

    for device in endpoints:
        primary = device["primaryInterface"]
        script = "\n".join(
            [
                "set -e",
                "systemctl stop systemd-timesyncd >/dev/null 2>&1 || true",
                "pkill -f 'ptp4l -f /etc/gPTP.cfg' >/dev/null 2>&1 || true",
                f"pkill -f 'phc2sys -s {primary} -c CLOCK_REALTIME' >/dev/null 2>&1 || true",
                f"nohup sh -lc {shlex.quote(f'ptp4l -f /etc/gPTP.cfg -i {primary} -m')} >/tmp/tsn-ptp4l-slave.log 2>&1 &",
                f"nohup sh -lc {shlex.quote(f'phc2sys -s {primary} -c CLOCK_REALTIME -O 0 -m -S 1.0')} >/tmp/tsn-phc2sys-slave.log 2>&1 &",
                "sleep 1",
                "pgrep -af 'ptp4l|phc2sys'",
            ]
        )
        results.append(await _run_command_on_device(network, device, script, timeout=20))

    return results


async def _verify_gptp(network: dict[str, Any]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for device in _switch_devices(network):
        command = "set -e\npgrep -af 'ptp4l'\npgrep -af 'phc2sys'"
        results.append(await _run_command_on_device(network, device, command, timeout=10))
    for device in _endpoint_devices(network):
        primary = device["primaryInterface"]
        command = f"set -e\npgrep -af 'ptp4l'\npgrep -af 'phc2sys'\nphc_ctl {shlex.quote(primary)} cmp"
        results.append(await _run_command_on_device(network, device, command, timeout=15))
    return results


async def _apply_qbv(network: dict[str, Any]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for device in _switch_devices(network):
        parent = _device_vlan_parent(device)
        primary = device["primaryInterface"]
        script_lines = ["set -e", *_ensure_vlan_commands(device)]
        script_lines.extend(
            [
                f"ip link set {shlex.quote(parent)}.10 type vlan egress-qos-map 0:3",
                f"ip link set {shlex.quote(parent)}.20 type vlan egress-qos-map 0:0",
                _taprio_schedule(preemptive=False).format(iface=shlex.quote(primary)),
                f"tc -s qdisc show dev {shlex.quote(primary)}",
            ]
        )
        results.append(await _run_command_on_device(network, device, "\n".join(script_lines), timeout=20))

    for device in _endpoint_devices(network):
        script = "\n".join(["set -e", *_ensure_vlan_commands(device), f"ip -br addr show dev {shlex.quote(device['primaryInterface'])}.10", f"ip -br addr show dev {shlex.quote(device['primaryInterface'])}.20"])
        results.append(await _run_command_on_device(network, device, script, timeout=20))
    return results


async def _verify_qbv(network: dict[str, Any]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for device in _switch_devices(network):
        parent = _device_vlan_parent(device)
        primary = device["primaryInterface"]
        command = "\n".join(
            [
                "set -e",
                f"ip -br addr show dev {shlex.quote(parent)}.10",
                f"ip -br addr show dev {shlex.quote(parent)}.20",
                f"tc -s qdisc show dev {shlex.quote(primary)} | grep -q taprio",
                f"tc -s qdisc show dev {shlex.quote(primary)}",
            ]
        )
        results.append(await _run_command_on_device(network, device, command, timeout=15))
    for device in _endpoint_devices(network):
        primary = device["primaryInterface"]
        command = "\n".join(
            [
                "set -e",
                f"ip -br addr show dev {shlex.quote(primary)}.10",
                f"ip -br addr show dev {shlex.quote(primary)}.20",
            ]
        )
        results.append(await _run_command_on_device(network, device, command, timeout=10))
    return results


async def _apply_preemption(network: dict[str, Any]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for device in [*_switch_devices(network), *_endpoint_devices(network)]:
        primary = device["primaryInterface"]
        lines = [
            "set -e",
            f"ethtool --set-mm {shlex.quote(primary)} pmac-enabled on tx-enabled on verify-enabled off",
        ]
        if device["role"] == "switch":
            lines.append(_taprio_schedule(preemptive=True).format(iface=shlex.quote(primary)))
        lines.append(f"ethtool --show-mm {shlex.quote(primary)}")
        results.append(await _run_command_on_device(network, device, "\n".join(lines), timeout=20))
    return results


async def _verify_preemption(network: dict[str, Any]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for device in [*_switch_devices(network), *_endpoint_devices(network)]:
        primary = device["primaryInterface"]
        lines = ["set -e", f"ethtool --show-mm {shlex.quote(primary)}"]
        if device["role"] == "switch":
            lines.append(f"tc -s qdisc show dev {shlex.quote(primary)} | grep -q taprio")
        results.append(await _run_command_on_device(network, device, "\n".join(lines), timeout=15))
    return results


async def _apply_timestamping(network: dict[str, Any]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for device in _switch_devices(network):
        parent = _device_vlan_parent(device)
        lines = ["set -e", *_ensure_vlan_commands(device), f"ip link set {shlex.quote(parent)}.10 type vlan egress-qos-map 6:3", f"ip -d link show {shlex.quote(parent)}.10"]
        results.append(await _run_command_on_device(network, device, "\n".join(lines), timeout=15))
    for device in _endpoint_devices(network):
        primary = device["primaryInterface"]
        command = "\n".join(["set -e", f"hwstamp_ctl -i {shlex.quote(primary)} -r 1 -t 1", f"hwstamp_ctl -i {shlex.quote(primary)}"])
        results.append(await _run_command_on_device(network, device, command, timeout=15))
    return results


async def _verify_timestamping(network: dict[str, Any]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for device in _switch_devices(network):
        parent = _device_vlan_parent(device)
        command = "\n".join(
            [
                "set -e",
                f"ip -d link show {shlex.quote(parent)}.10",
                f"ip -d link show {shlex.quote(parent)}.20",
            ]
        )
        results.append(await _run_command_on_device(network, device, command, timeout=10))
    for device in _endpoint_devices(network):
        primary = device["primaryInterface"]
        command = "\n".join(["set -e", f"hwstamp_ctl -i {shlex.quote(primary)}", f"ethtool -T {shlex.quote(primary)}"])
        results.append(await _run_command_on_device(network, device, command, timeout=15))
    return results


async def _run_command_on_device(
    network: dict[str, Any],
    device: dict[str, Any],
    command: str,
    *,
    timeout: int,
) -> dict[str, Any]:
    if asyncssh is None:
        return _command_result(
            device=device,
            success=False,
            command=command,
            stdout="",
            message="asyncssh ist auf dem API-Server nicht installiert.",
            status="failed",
        )

    start = time.perf_counter()
    try:
        jump_host_id = device.get("jumpHostDeviceId")
        if jump_host_id:
            if device.get("sshPassword"):
                raise FeatureSelectionError(
                    f"{device['name']} nutzt einen Jump Host und gleichzeitig ein Passwort. Dieses Routing ist nur fuer schluesselbasierte Zielsysteme freigegeben."
                )
            jump_host = _require_device(network, jump_host_id)
            result = await _run_command_via_jump_host(jump_host=jump_host, device=device, command=command, timeout=timeout)
        else:
            result = await _run_command_direct(device=device, command=command, timeout=timeout)
    except FeatureSelectionError as exc:
        return _command_result(
            device=device,
            success=False,
            command=command,
            stdout="",
            message=str(exc),
            status="failed",
        )
    except Exception as exc:  # noqa: BLE001
        return _command_result(
            device=device,
            success=False,
            command=command,
            stdout="",
            message=f"SSH-Ausfuehrung fehlgeschlagen: {exc}",
            status="failed",
        )

    duration_ms = int(round((time.perf_counter() - start) * 1000))
    success = result["exit_status"] == 0
    stdout = (result["stdout"] or "").strip()
    stderr = (result["stderr"] or "").strip()
    message = stdout.splitlines()[0] if stdout else stderr.splitlines()[0] if stderr else ("Befehl erfolgreich" if success else "Befehl fehlgeschlagen")
    return _command_result(
        device=device,
        success=success,
        command=command,
        stdout=f"{stdout}\n{stderr}".strip(),
        message=message,
        status="success" if success else "failed",
        duration_ms=duration_ms,
    )


async def _run_command_direct(*, device: dict[str, Any], command: str, timeout: int):
    host = device.get("sshHost") or device["ipAddress"]
    username = device.get("sshUsername")
    if not username:
        raise FeatureSelectionError(f"{device['name']} hat keinen SSH-Nutzer hinterlegt.")

    remote_command = f"sh -lc {shlex.quote(command)}"
    ssh_password = device.get("sshPassword") or None
    if ssh_password:
        if asyncssh is None:
            raise FeatureSelectionError("Passwortbasierte SSH-Logins benoetigen asyncssh auf dem API-Server.")
        async with asyncssh.connect(
            host=host,
            port=int(device.get("sshPort") or 22),
            username=username,
            password=ssh_password,
            known_hosts=None,
            client_keys=None,
        ) as connection:
            result = await connection.run(remote_command, check=False, timeout=timeout)
            return {"exit_status": int(result.exit_status), "stdout": result.stdout or "", "stderr": result.stderr or ""}

    args = [
        "ssh",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=5",
        "-p",
        str(int(device.get("sshPort") or 22)),
        f"{username}@{host}",
        remote_command,
    ]
    return await _run_subprocess_command(args, timeout=timeout)


async def _run_command_via_jump_host(
    *,
    jump_host: dict[str, Any],
    device: dict[str, Any],
    command: str,
    timeout: int,
):
    jump_host_address = jump_host.get("sshHost") or jump_host["ipAddress"]
    jump_username = jump_host.get("sshUsername")
    if not jump_username:
        raise FeatureSelectionError(f"{jump_host['name']} hat keinen SSH-Nutzer fuer den Jump Host.")

    target_username = device.get("sshUsername")
    if not target_username:
        raise FeatureSelectionError(f"{device['name']} hat keinen SSH-Nutzer fuer das Zielsystem.")

    target_host = device.get("sshHost") or device["ipAddress"]
    target_port = int(device.get("sshPort") or 22)
    remote_command = f"sh -lc {shlex.quote(command)}"
    nested_command = (
        f"ssh -o BatchMode=yes -o ConnectTimeout=5 -p {target_port} "
        f"{shlex.quote(f'{target_username}@{target_host}')} "
        f"{shlex.quote(remote_command)}"
    )

    jump_password = jump_host.get("sshPassword") or None
    if jump_password:
        if asyncssh is None:
            raise FeatureSelectionError("Passwortbasierte Jump-Hosts benoetigen asyncssh auf dem API-Server.")
        async with asyncssh.connect(
            host=jump_host_address,
            port=int(jump_host.get("sshPort") or 22),
            username=jump_username,
            password=jump_password,
            known_hosts=None,
            client_keys=None,
        ) as connection:
            result = await connection.run(nested_command, check=False, timeout=timeout + 5)
            return {"exit_status": int(result.exit_status), "stdout": result.stdout or "", "stderr": result.stderr or ""}

    args = [
        "ssh",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=5",
        "-p",
        str(int(jump_host.get("sshPort") or 22)),
        f"{jump_username}@{jump_host_address}",
        nested_command,
    ]
    return await _run_subprocess_command(args, timeout=timeout + 5)


async def _run_subprocess_command(args: list[str], *, timeout: int) -> dict[str, Any]:
    try:
        process = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        raise FeatureSelectionError(f"SSH-Client nicht verfuegbar: {exc}") from exc

    try:
        stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
    except asyncio.TimeoutError as exc:
        process.kill()
        await process.communicate()
        raise FeatureSelectionError("SSH-Befehl ist in ein Timeout gelaufen.") from exc

    return {
        "exit_status": int(process.returncode or 0),
        "stdout": stdout.decode("utf-8", errors="replace"),
        "stderr": stderr.decode("utf-8", errors="replace"),
    }


def _command_result(
    *,
    device: dict[str, Any],
    success: bool,
    command: str,
    stdout: str,
    message: str,
    status: str,
    duration_ms: int | None = None,
) -> dict[str, Any]:
    return {
        "deviceId": device["id"],
        "deviceName": device["name"],
        "success": success,
        "status": status,
        "command": _clip_text(command, limit=280),
        "stdout": _clip_text(stdout, limit=900),
        "message": _clip_text(message, limit=280),
        "durationMs": duration_ms,
    }


def _ping_result_from_remote(remote: dict[str, Any], *, target: str) -> dict[str, Any]:
    success = bool(remote.get("success"))
    return {
        "success": success,
        "latencyMs": remote.get("durationMs"),
        "message": remote.get("message") or ("Ping erfolgreich" if success else "Ping fehlgeschlagen"),
        "target": target,
        "command": remote.get("command"),
        "stdout": remote.get("stdout"),
    }


def _clip_text(value: str, *, limit: int) -> str:
    text = value.strip()
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."


def _run_local_ping(target: str, timeout_seconds: int = 2) -> dict[str, Any]:
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
