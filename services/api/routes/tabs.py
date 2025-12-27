from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
import asyncio
import contextlib

from services.api.schemas import (
	CreateTestTabPayload,
	UpdateTestTabPayload,
	StartTestTabPayload,
)
from services.api.enums import ErrorMessages
from services.api.utils.error_handling import (
	raise_not_found,
	raise_bad_request,
	raise_conflict,
	raise_internal_error,
)


def create_tabs_router(tests_manager, load_profile_func):
	router = APIRouter(prefix="/test-tabs")

	@router.get("")
	async def api_list_test_tabs():
		return await tests_manager.list_tabs()

	@router.post("")
	async def api_create_test_tab(payload: CreateTestTabPayload):
		if payload.profileId:
			# Validation: Profile must exist
			try:
				load_profile_func(payload.profileId)
			except (FileNotFoundError, KeyError, ValueError):
				raise_not_found(f"Profil nicht gefunden: {payload.profileId}")
		
		try:
			return await tests_manager.create_tab(
				title=payload.title,
				profile_id=payload.profileId
			)
		except KeyError:
			raise_not_found(ErrorMessages.TAB_NOT_FOUND)
		except Exception as exc:
			raise_internal_error("Fehler beim Erstellen des Tabs", exc)

	@router.put("/{tab_id}")
	async def api_update_test_tab(tab_id: str, payload: UpdateTestTabPayload):
		if payload.profileId:
			try:
				load_profile_func(payload.profileId)
			except (FileNotFoundError, KeyError, ValueError):
				raise_not_found(f"Profil nicht gefunden: {payload.profileId}")
		
		try:
			return await tests_manager.update_tab(
				tab_id,
				title=payload.title,
				profile_id=payload.profileId
			)
		except KeyError:
			raise_not_found(ErrorMessages.TAB_NOT_FOUND)

	@router.delete("/{tab_id}")
	async def api_delete_test_tab(tab_id: str):
		try:
			await tests_manager.delete_tab(tab_id)
		except KeyError:
			raise_not_found(ErrorMessages.TAB_NOT_FOUND)
		except RuntimeError as exc:
			raise_conflict(str(exc))
		return {"deleted": True}

	@router.post("/{tab_id}/start")
	async def api_start_test_tab(tab_id: str, payload: StartTestTabPayload):
		profile_id = payload.profileId
		
		# If no profileId provided, try to get it from the tab
		if not profile_id:
			try:
				tab = await tests_manager.get_tab(tab_id)
			except KeyError:
				raise_not_found(ErrorMessages.TAB_NOT_FOUND)
			profile_id = tab.get("profileId")
		
		if not profile_id:
			raise_bad_request(ErrorMessages.PROFILE_ID_REQUIRED)
		
		try:
			profile = load_profile_func(profile_id)
		except (FileNotFoundError, KeyError, ValueError):
			raise_not_found(f"Profil nicht gefunden: {profile_id}")
		
		try:
			return await tests_manager.start_test(tab_id, profile)
		except KeyError:
			raise_not_found(ErrorMessages.TAB_NOT_FOUND)
		except RuntimeError as exc:
			raise_conflict(str(exc))

	@router.post("/{tab_id}/stop")
	async def api_stop_test_tab(tab_id: str):
		try:
			return await tests_manager.stop_test(tab_id)
		except KeyError:
			raise_not_found(ErrorMessages.TAB_NOT_FOUND)

	@router.get("/{tab_id}/logs")
	async def api_get_test_tab_logs(tab_id: str, after: int | None = Query(default=None, ge=0)):
		try:
			return await tests_manager.get_logs(tab_id, after=after)
		except KeyError:
			raise_not_found(ErrorMessages.TAB_NOT_FOUND)

	@router.websocket("/ws")
	async def api_test_tabs_ws(ws: WebSocket):
		await ws.accept()
		queue = await tests_manager.subscribe()
		try:
			snapshot = await tests_manager.list_tabs()
			await ws.send_json({"type": "snapshot", "tabs": snapshot})
			while True:
				try:
					event = await queue.get()
				except asyncio.CancelledError:
					break
				try:
					await ws.send_json(event)
				except WebSocketDisconnect:
					break
				except Exception:
					break
		except (WebSocketDisconnect, asyncio.CancelledError):
			pass
		finally:
			await tests_manager.unsubscribe(queue)
			with contextlib.suppress(Exception):
				await ws.close(code=1001)

	return router


