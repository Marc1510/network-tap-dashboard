from __future__ import annotations

from fastapi import APIRouter

from services.api.local_tsn_network_service import (
    create_device,
    delete_device,
    list_devices,
    ping_device,
    update_device,
)
from services.api.schemas import CreateLocalTsnDevicePayload, UpdateLocalTsnDevicePayload


router = APIRouter(prefix="/local-tsn-network")


@router.get("/devices")
def api_list_local_tsn_devices():
    return {"devices": list_devices()}


@router.post("/devices")
def api_create_local_tsn_device(payload: CreateLocalTsnDevicePayload):
    return create_device(payload.model_dump())


@router.put("/devices/{device_id}")
def api_update_local_tsn_device(device_id: str, payload: UpdateLocalTsnDevicePayload):
    return update_device(device_id, payload.model_dump(exclude_unset=True))


@router.delete("/devices/{device_id}")
def api_delete_local_tsn_device(device_id: str):
    delete_device(device_id)
    return {"deleted": True}


@router.post("/devices/{device_id}/ping")
def api_ping_local_tsn_device(device_id: str):
    return ping_device(device_id)
