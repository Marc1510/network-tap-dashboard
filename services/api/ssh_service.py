from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi import HTTPException

from services.api.deps import PROFILES_DIR


SSH_USERS_FILE = PROFILES_DIR / "ssh_users.json"


def ensure_profiles_and_users_file() -> None:
    try:
        PROFILES_DIR.mkdir(parents=True, exist_ok=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Profile-Verzeichnis kann nicht erstellt werden: {exc}")
    if not SSH_USERS_FILE.exists():
        try:
            with SSH_USERS_FILE.open("w", encoding="utf-8") as f:
                json.dump({"users": []}, f, ensure_ascii=False, indent=2)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"Nutzerdatei konnte nicht erstellt werden: {exc}")


def sanitize_username(name: str) -> str:
    name2 = str(name or "").strip()
    name2 = re.sub(r"[^a-zA-Z0-9_.-]", "_", name2)
    name2 = re.sub(r"^[._-]+", "", name2)
    return name2


def load_users() -> list[str]:
    ensure_profiles_and_users_file()
    try:
        with SSH_USERS_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
            users = data.get("users")
            if isinstance(users, list):
                cleaned: list[str] = []
                seen = set()
                for u in users:
                    if not isinstance(u, str):
                        continue
                    name = sanitize_username(u)
                    if not name or name in seen:
                        continue
                    seen.add(name)
                    cleaned.append(name)
                return sorted(cleaned, key=lambda x: x.lower())
            return []
    except FileNotFoundError:
        return []
    except Exception:  # noqa: BLE001
        return []


def save_users(users: list[str]) -> None:
    ensure_profiles_and_users_file()
    try:
        with SSH_USERS_FILE.open("w", encoding="utf-8") as f:
            json.dump({"users": users}, f, ensure_ascii=False, indent=2)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Nutzerdatei konnte nicht gespeichert werden: {exc}")


