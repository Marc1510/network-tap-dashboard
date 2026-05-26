from __future__ import annotations

from fastapi import APIRouter

from services.api.local_tsn_network_service import (
    activate_feature,
    create_device,
    create_network,
    delete_device,
    delete_network,
    get_state,
    ping_between_devices,
    ping_device,
    refresh_network,
    update_device,
    update_network,
    verify_feature,
)
from services.api.schemas import (
    CreateLocalTsnDevicePayload,
    CreateLocalTsnNetworkPayload,
    LocalTsnDevicePingBetweenPayload,
    UpdateLocalTsnDevicePayload,
    UpdateLocalTsnNetworkPayload,
)


router = APIRouter(prefix="/local-tsn-network")


@router.get("/state")
def api_get_local_tsn_state():
    return get_state()


@router.post("/networks")
def api_create_local_tsn_network(payload: CreateLocalTsnNetworkPayload):
    return create_network(payload.model_dump())


@router.put("/networks/{network_id}")
def api_update_local_tsn_network(network_id: str, payload: UpdateLocalTsnNetworkPayload):
    return update_network(network_id, payload.model_dump(exclude_unset=True))


@router.delete("/networks/{network_id}")
def api_delete_local_tsn_network(network_id: str):
    delete_network(network_id)
    return {"deleted": True}


@router.post("/networks/{network_id}/devices")
def api_create_local_tsn_device(network_id: str, payload: CreateLocalTsnDevicePayload):
    return create_device(network_id, payload.model_dump())


@router.put("/networks/{network_id}/devices/{device_id}")
def api_update_local_tsn_device(network_id: str, device_id: str, payload: UpdateLocalTsnDevicePayload):
    return update_device(network_id, device_id, payload.model_dump(exclude_unset=True))


@router.delete("/networks/{network_id}/devices/{device_id}")
def api_delete_local_tsn_device(network_id: str, device_id: str):
    delete_device(network_id, device_id)
    return {"deleted": True}


@router.post("/networks/{network_id}/devices/{device_id}/ping")
async def api_ping_local_tsn_device(network_id: str, device_id: str):
    return await ping_device(network_id, device_id)


@router.post("/networks/{network_id}/ping")
async def api_ping_between_local_tsn_devices(network_id: str, payload: LocalTsnDevicePingBetweenPayload):
    return await ping_between_devices(network_id, payload.model_dump())


@router.post("/networks/{network_id}/features/{feature_id}/activate")
async def api_activate_local_tsn_feature(network_id: str, feature_id: str):
    return await activate_feature(network_id, feature_id)


@router.post("/networks/{network_id}/features/{feature_id}/verify")
async def api_verify_local_tsn_feature(network_id: str, feature_id: str):
    return await verify_feature(network_id, feature_id)


@router.post("/networks/{network_id}/refresh")
async def api_refresh_local_tsn_network(network_id: str):
    return await refresh_network(network_id)
