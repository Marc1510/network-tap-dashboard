from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from services.api.deps import tsn_security_manager
from services.api.tsn_security_service import TsnSecurityError


router = APIRouter(prefix="/tsn-security", tags=["TSN Security"])


class LoadStage(BaseModel):
    ratePps: int = Field(ge=1)
    durationSeconds: int = Field(ge=1)


class StartSecurityRun(BaseModel):
    mode: Literal["baseline", "ptp_resilience", "fuzzing", "latency_jitter", "latency_series", "latency_load", "priority_load", "priority_series"]
    target: str
    interface: str
    scopeConfirmed: bool = False
    dryRun: bool = True
    stages: list[LoadStage] = Field(default_factory=list)
    repetitions: int | None = None


def _bad_request(exc: TsnSecurityError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


@router.get("/config")
def security_config():
    return tsn_security_manager.config()


@router.get("/status")
def security_status():
    return tsn_security_manager.status()


@router.get("/runs")
async def list_security_runs():
    run_ids = tsn_security_manager.run_ids()
    return JSONResponse(content={"runIds": run_ids})


@router.get("/runs/{run_id}")
async def get_security_run(run_id: str):
    try:
        return JSONResponse(content=tsn_security_manager.get_run(run_id))
    except TsnSecurityError as exc:
        raise _bad_request(exc) from exc


@router.post("/runs", status_code=202)
def start_security_run(payload: StartSecurityRun):
    try:
        return tsn_security_manager.start(payload.model_dump())
    except TsnSecurityError as exc:
        raise _bad_request(exc) from exc


@router.post("/stop")
def stop_security_run():
    return tsn_security_manager.stop_active()


@router.get("/runs/{run_id}/artifacts/{name}")
def download_security_artifact(run_id: str, name: str):
    try:
        path = tsn_security_manager.artifact(run_id, name)
    except TsnSecurityError as exc:
        raise _bad_request(exc) from exc
    return FileResponse(path, filename=path.name)
