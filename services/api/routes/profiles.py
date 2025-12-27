from __future__ import annotations

from uuid import uuid4
from fastapi import APIRouter, Body, HTTPException
from services.api.profile_service import (
	load_profile,
	save_profile,
	list_profiles,
	profile_path,
	ensure_profiles_dir,
	utcnow_iso,
	BUILTIN_PROFILES,
)


router = APIRouter()


def _ensure_profiles_dir() -> None:  # Backward-compat alias for routes using old name
	ensure_profiles_dir()


@router.get("/test-profiles")
def api_list_test_profiles():
	return list_profiles()


@router.get("/test-profiles/{profile_id}")
def api_get_test_profile(profile_id: str):
	return load_profile(profile_id)


@router.post("/test-profiles")
def api_create_test_profile(payload: dict = Body()):  # type: ignore[type-arg]
	name = str(payload.get("name") or "").strip()
	if not name or name == "undefined":
		raise HTTPException(status_code=400, detail="'name' ist erforderlich")
	now = utcnow_iso()
	doc = {
		"id": uuid4().hex,
		"name": name,
		"description": str(payload.get("description") or "").strip() or None,
		"isDefault": False,
		"createdUtc": now,
		"updatedUtc": now,
		"settings": payload.get("settings") or {},
	}
	return save_profile(doc, overwrite=False)


@router.put("/test-profiles/{profile_id}")
def api_update_test_profile(profile_id: str, payload: dict = Body()):  # type: ignore[type-arg]
	current = load_profile(profile_id)
	is_builtin = profile_id in BUILTIN_PROFILES
	
	if is_builtin:
		# Bei Builtin-Profilen nur das Interface in den Settings ändern
		current_settings = current.get("settings") or {}
		new_settings = payload.get("settings") or {}
		
		# Nur das Interface-Feld aus den neuen Settings übernehmen
		if "interfaces" in new_settings:
			current_settings["interfaces"] = new_settings["interfaces"]
		
		updated = {
			**current,
			"settings": current_settings,
			"updatedUtc": utcnow_iso(),
		}
		# Profil bleibt als Default markiert
		updated["isDefault"] = True
		updated["id"] = profile_id
		
		# Direkt in die Datei schreiben, ohne save_profile (da Builtin)
		from services.api.profile_service import profile_path
		import json
		path = profile_path(profile_id)
		try:
			with path.open("w", encoding="utf-8") as f:
				json.dump(updated, f, ensure_ascii=False, indent=2)
		except Exception as exc:  # noqa: BLE001
			raise HTTPException(status_code=500, detail=f"Profil konnte nicht aktualisiert werden: {exc}")
		return updated
	else:
		# Normale Profile können vollständig bearbeitet werden
		name = str(payload.get("name") or current.get("name") or "").strip()
		if not name:
			raise HTTPException(status_code=400, detail="'name' ist erforderlich")
		updated = {
			**current,
			"name": name,
			"description": str(payload.get("description") or current.get("description") or "").strip() or None,
			"settings": payload.get("settings") if payload.get("settings") is not None else current.get("settings") or {},
			"updatedUtc": utcnow_iso(),
		}
		updated["isDefault"] = False
		updated["id"] = profile_id
		return save_profile(updated, overwrite=True)


@router.delete("/test-profiles/{profile_id}")
def api_delete_test_profile(profile_id: str):
	if profile_id in BUILTIN_PROFILES:
		raise HTTPException(status_code=400, detail="Builtin-Profile können nicht gelöscht werden")
	ensure_profiles_dir()
	path = profile_path(profile_id)
	if not path.exists():
		raise HTTPException(status_code=404, detail="Profil nicht gefunden")
	try:
		path.unlink(missing_ok=True)
	except Exception as exc:  # noqa: BLE001
		raise HTTPException(status_code=500, detail=f"Profil konnte nicht gelöscht werden: {exc}")
	return {"deleted": True}


