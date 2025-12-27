from __future__ import annotations

from pathlib import Path
from uuid import uuid4
from datetime import datetime, timezone
import json
import re

from fastapi import HTTPException

from services.api.deps import PROFILES_DIR


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def ensure_profiles_dir() -> None:
    try:
        PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Profile-Verzeichnis kann nicht erstellt werden: {exc}")


def default_profile_settings() -> dict:
    """Default settings for basic traffic capture profile."""
    return {
        # Capture Interfaces
        "interfaces": ["eth0"],
        "promiscuousMode": True,
        
        # Trigger & Duration
        # Note: startCondition removed - timing is controlled via schedule
        "stopCondition": "manual",
        "stopDurationValue": 60,
        "stopDurationUnit": "seconds",
        "stopPacketCount": None,
        "stopFileSizeValue": 100,
        "stopFileSizeUnit": "megabytes",
        
        # Capture Options (tcpdump)
        "snapLength": 0,  # Full packet capture
        "bufferSize": 2,  # 2 MiB kernel buffer
        "timestampPrecision": "micro",
        "timestampType": "",
        "immediateMode": False,
        
        # Output & Ring Buffer
        "ringFileSizeValue": 100,
        "ringFileSizeUnit": "megabytes",
        "ringFileCount": 10,
        "outputFormat": "pcap",
        "filenamePrefix": "capture",
        
        # Filtering (BPF)
        "bpfFilter": "",
        "filterProtocols": [],
        "filterHosts": "",
        "filterPorts": "",
        "filterVlanId": None,
        "filterDirection": "",
        
        # TSN-Specific Options
        "captureTsnSync": False,
        "capturePtp": False,
        "captureVlanTagged": False,
        "tsnPriorityFilter": None,
        "printLinkLevelHeader": False,
        
        # Post-Processing Options
        "headerOnly": False,
        "headerSnaplen": 96,
        "generateTestMetadataFile": True,
        "generateStatistics": False,
        
        # Resource Management
        "cpuPriority": "normal",
        "maxDiskUsageMB": 1000,
    }


def tsn_profile_settings() -> dict:
    """Settings optimized for TSN (Time-Sensitive Networking) traffic capture."""
    settings = default_profile_settings()
    settings.update({
        "filenamePrefix": "tsn_capture",
        "timestampPrecision": "nano",  # Nanosecond precision for TSN
        "immediateMode": True,  # No buffering for real-time capture
        "captureTsnSync": True,  # Capture 802.1AS/gPTP
        "capturePtp": True,  # Capture PTP traffic
        "captureVlanTagged": True,  # Capture VLAN tagged frames
        "generateStatistics": True,
        "bufferSize": 4,  # Larger buffer for high-speed capture
    })
    return settings


# Define all builtin profiles
BUILTIN_PROFILES = {
    "default": {
        "id": "default",
        "name": "Basic Traffic",
        "description": "Allgemeines Netzwerk-Monitoring. Erfasst den gesamten Netzwerkverkehr ohne spezielle Filter. Geeignet für grundlegende Netzwerkanalyse und Fehlersuche.",
        "isDefault": True,
        "settings_func": default_profile_settings,
    },
    "tsn-traffic": {
        "id": "tsn-traffic",
        "name": "TSN Traffic",
        "description": "Optimiert für Time-Sensitive Networking (TSN). Erfasst 802.1AS Synchronisation, PTP und VLAN-getaggte Frames mit Nanosekunden-Präzision. Ideal für TSN-Netzwerkanalyse.",
        "isDefault": True,
        "settings_func": tsn_profile_settings,
    },
}


def profile_path(profile_id: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9_-]", "_", profile_id)
    return PROFILES_DIR / f"{safe}.json"


def get_builtin_profile_payload(profile_id: str) -> dict | None:
    """Generate the payload for a builtin profile."""
    if profile_id not in BUILTIN_PROFILES:
        return None
    
    profile_def = BUILTIN_PROFILES[profile_id]
    now = utcnow_iso()
    return {
        "id": profile_def["id"],
        "name": profile_def["name"],
        "description": profile_def["description"],
        "isDefault": profile_def["isDefault"],
        "createdUtc": now,
        "updatedUtc": now,
        "settings": profile_def["settings_func"](),
    }


def default_profile_payload() -> dict:
    """Backward compatibility - returns the default profile payload."""
    return get_builtin_profile_payload("default")  # type: ignore


def ensure_builtin_profiles() -> None:
    """Ensure all builtin profiles exist on disk."""
    ensure_profiles_dir()
    for profile_id in BUILTIN_PROFILES:
        p = profile_path(profile_id)
        if not p.exists():
            payload = get_builtin_profile_payload(profile_id)
            if payload:
                try:
                    with p.open("w", encoding="utf-8") as f:
                        json.dump(payload, f, ensure_ascii=False, indent=2)
                except Exception:
                    pass  # Ignore errors during initialization


def load_profile(profile_id: str) -> dict:
    ensure_profiles_dir()
    
    # Ensure builtin profile exists
    if profile_id in BUILTIN_PROFILES:
        p = profile_path(profile_id)
        if not p.exists():
            payload = get_builtin_profile_payload(profile_id)
            if payload:
                try:
                    with p.open("w", encoding="utf-8") as f:
                        json.dump(payload, f, ensure_ascii=False, indent=2)
                except Exception as exc:
                    raise HTTPException(status_code=500, detail=f"Builtin-Profil konnte nicht angelegt werden: {exc}")
    path = profile_path(profile_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Profil nicht gefunden")
    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Profil konnte nicht gelesen werden: {exc}")

    # Handle builtin profiles - ensure they have all required fields and settings
    if profile_id in BUILTIN_PROFILES:
        changed = False
        builtin_def = BUILTIN_PROFILES[profile_id]
        defaults = get_builtin_profile_payload(profile_id)
        if not defaults:
            return data
            
        if not isinstance(data, dict):
            data = defaults
            changed = True
        else:
            if data.get("id") != profile_id:
                data["id"] = profile_id
                changed = True
            if data.get("isDefault") is not True:
                data["isDefault"] = True
                changed = True
            # Update name and description from builtin definition
            if data.get("name") != builtin_def["name"]:
                data["name"] = builtin_def["name"]
                changed = True
            if data.get("description") != builtin_def["description"]:
                data["description"] = builtin_def["description"]
                changed = True
            if not data.get("createdUtc"):
                data["createdUtc"] = defaults["createdUtc"]
                changed = True
            if not data.get("updatedUtc"):
                data["updatedUtc"] = defaults["updatedUtc"]
                changed = True
            settings = data.get("settings")
            if not isinstance(settings, dict):
                settings = {}
                changed = True
            # Merge with profile-specific default settings
            profile_default_settings = builtin_def["settings_func"]()
            merged_settings = {**profile_default_settings, **settings}
            if merged_settings != settings:
                data["settings"] = merged_settings
                changed = True

        if changed:
            try:
                with path.open("w", encoding="utf-8") as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
            except Exception as exc:  # noqa: BLE001
                raise HTTPException(status_code=500, detail=f"Builtin-Profil konnte nicht aktualisiert werden: {exc}")

    return data


def save_profile(payload: dict, *, overwrite: bool = False) -> dict:
    ensure_profiles_dir()
    profile_id = str(payload.get("id") or "").strip()
    if not profile_id:
        profile_id = uuid4().hex
        payload["id"] = profile_id
    if profile_id in BUILTIN_PROFILES:
        raise HTTPException(status_code=400, detail="Builtin-Profile sind schreibgeschützt")
    path = profile_path(profile_id)
    if path.exists() and not overwrite:
        raise HTTPException(status_code=409, detail="Profil-ID existiert bereits")
    try:
        with path.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Profil konnte nicht gespeichert werden: {exc}")
    return payload


def list_profiles() -> list[dict]:
    ensure_profiles_dir()
    # Ensure all builtin profiles exist
    for builtin_id in BUILTIN_PROFILES:
        _ = load_profile(builtin_id)
    
    profiles: list[dict] = []
    invalid_files: list[Path] = []
    try:
        for p in sorted(PROFILES_DIR.glob("*.json")):
            if p.name == "ssh_users.json":
                continue
            with p.open("r", encoding="utf-8") as f:
                profile = json.load(f)
                if (
                    isinstance(profile, dict)
                    and profile.get("id")
                    and profile.get("name")
                    and profile.get("id") != "undefined"
                    and profile.get("name") != "undefined"
                ):
                    profiles.append(profile)
                else:
                    invalid_files.append(p)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Profile konnten nicht gelesen werden: {exc}")

    # Don't delete invalid files - they might be custom profiles that need manual fixing
    # for invalid_file in invalid_files:
    #     if invalid_file.name == "ssh_users.json":
    #         continue
    #     try:
    #         invalid_file.unlink(missing_ok=True)
    #     except Exception:
    #         pass

    profiles.sort(
        key=lambda x: (
            0 if x.get("id") == "default" or x.get("isDefault") else 1,
            str(x.get("name") or "").lower(),
        )
    )
    return profiles


