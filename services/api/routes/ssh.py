from __future__ import annotations

import asyncio
import contextlib
import json
from typing import Any

from fastapi import APIRouter, Body, HTTPException, WebSocket, WebSocketDisconnect

from services.api.ssh_service import load_users, sanitize_username, save_users


router = APIRouter(prefix="/ssh")


@router.get("/users")
def api_list_ssh_users():
    try:
        return {"users": load_users()}
    except Exception:
        return {"users": []}


@router.post("/users")
def api_create_ssh_user(payload: dict = Body()):  # type: ignore[type-arg]
    raw = str(payload.get("username") or "")
    username = sanitize_username(raw)
    if not username:
        raise HTTPException(status_code=400, detail="'username' ist erforderlich")
    users = load_users()
    if username in users:
        raise HTTPException(status_code=409, detail="Nutzer existiert bereits")
    users.append(username)
    users = sorted(set(users), key=lambda value: value.lower())
    save_users(users)
    return {"username": username}


@router.delete("/users/{username}")
def api_delete_ssh_user(username: str):
    name = sanitize_username(username)
    users = load_users()
    if name not in users:
        raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")
    users = [user for user in users if user != name]
    save_users(users)
    return {"deleted": True}


@router.websocket("/ws")
async def ssh_websocket(ws: WebSocket):  # pragma: no cover - interactive
    """
    WebSocket bridge around the local OpenSSH client.

    This keeps key-based auth, jump hosts, password prompts, and remote shell
    behavior aligned with the machine's own `ssh` binary instead of re-implementing
    terminal semantics in Python.
    """

    await ws.accept()

    process: asyncio.subprocess.Process | None = None
    stdout_task: asyncio.Task | None = None
    wait_task: asyncio.Task | None = None
    closed_sent = False

    async def send_status(status: str, message: str | None = None) -> None:
        nonlocal closed_sent
        if status == "closed":
            if closed_sent:
                return
            closed_sent = True
        payload: dict[str, Any] = {"type": "status", "status": status}
        if message:
            payload["message"] = message
        with contextlib.suppress(Exception):
            await ws.send_text(json.dumps(payload))

    async def close_all() -> None:
        nonlocal stdout_task, wait_task, process

        for task in (stdout_task, wait_task):
            if task and not task.done():
                task.cancel()
                with contextlib.suppress(Exception):
                    await task

        if process:
            if process.stdin and not process.stdin.is_closing():
                with contextlib.suppress(Exception):
                    process.stdin.close()
            if process.returncode is None:
                with contextlib.suppress(Exception):
                    process.terminate()
                with contextlib.suppress(Exception):
                    await asyncio.wait_for(process.wait(), timeout=2)

    try:
        await send_status("connecting")
        initial = await ws.receive_text()
        try:
            msg = json.loads(initial)
        except Exception:
            await send_status("error", "Ungueltige Startnachricht")
            await ws.close()
            return

        if not isinstance(msg, dict) or msg.get("type") != "connect":
            await send_status("error", "Erste Nachricht muss 'connect' sein")
            await ws.close()
            return

        host = str(msg.get("host") or "localhost").strip()
        port = int(msg.get("port") or 22)
        username = str(msg.get("username") or "").strip()
        jump_host = str(msg.get("jumpHost") or "").strip()
        jump_port = int(msg.get("jumpPort") or 22)
        jump_username = str(msg.get("jumpUsername") or "").strip()

        target = f"{username}@{host}" if username else host
        if not host:
            await send_status("error", "Host fehlt")
            await ws.close()
            return

        args = [
            "ssh",
            "-tt",
            "-o",
            "StrictHostKeyChecking=no",
            "-o",
            "ServerAliveInterval=15",
            "-p",
            str(port),
        ]

        if jump_host:
            jump_target = f"{jump_username}@{jump_host}" if jump_username else jump_host
            if jump_port and jump_port != 22:
                jump_target = f"{jump_target}:{jump_port}"
            args.extend(["-J", jump_target])

        args.append(target)

        try:
            process = await asyncio.create_subprocess_exec(
                *args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
        except FileNotFoundError:
            await send_status("error", "SSH-Client nicht gefunden")
            await ws.close()
            return
        except Exception as exc:  # noqa: BLE001
            await send_status("error", f"SSH-Verbindung fehlgeschlagen: {exc}")
            await ws.close()
            return

        await send_status("connected")

        async def pump_stdout() -> None:
            assert process is not None and process.stdout is not None
            try:
                while True:
                    data = await process.stdout.read(4096)
                    if not data:
                        break
                    await ws.send_text(json.dumps({"type": "output", "data": data.decode('utf-8', errors='replace')}))
            except asyncio.CancelledError:
                pass
            except Exception:
                pass

        async def watch_process() -> None:
            assert process is not None
            try:
                await process.wait()
            except asyncio.CancelledError:
                return
            await send_status("closed")
            with contextlib.suppress(Exception):
                await ws.close()

        stdout_task = asyncio.create_task(pump_stdout())
        wait_task = asyncio.create_task(watch_process())

        while True:
            try:
                msg_text = await ws.receive_text()
            except WebSocketDisconnect:
                break
            except Exception:
                break

            try:
                message = json.loads(msg_text)
            except Exception:
                continue

            if not isinstance(message, dict):
                continue

            msg_type = message.get("type")
            if msg_type == "input":
                if process is not None and process.stdin is not None and "data" in message:
                    with contextlib.suppress(Exception):
                        process.stdin.write(str(message.get("data") or "").encode("utf-8", errors="replace"))
                        await process.stdin.drain()
            elif msg_type == "resize":
                continue
            elif msg_type == "disconnect":
                break

    except asyncio.CancelledError:
        pass
    finally:
        await close_all()
        await send_status("closed")
        with contextlib.suppress(Exception):
            await ws.close()
