from __future__ import annotations

from fastapi import APIRouter, Body, HTTPException, WebSocket, WebSocketDisconnect
import asyncio
import contextlib
import json

from services.api.ssh_service import (
	load_users,
	save_users,
	sanitize_username,
	ensure_profiles_and_users_file,
)


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
	users = sorted(set(users), key=lambda x: x.lower())
	save_users(users)
	return {"username": username}


@router.delete("/users/{username}")
def api_delete_ssh_user(username: str):
	name = sanitize_username(username)
	users = load_users()
	if name not in users:
		raise HTTPException(status_code=404, detail="Nutzer nicht gefunden")
	users = [u for u in users if u != name]
	save_users(users)
	return {"deleted": True}


# --- SSH Terminal WebSocket Bridge ---
try:
	import asyncssh  # type: ignore
except Exception:  # noqa: BLE001
	asyncssh = None


@router.websocket("/ws")
async def ssh_websocket(ws: WebSocket):  # pragma: no cover - interactive
	"""
	Einfacher WebSocket-zu-SSH Bridge:

	Client-Protokoll (JSON pro Nachricht):
	  - {"type":"connect","host":"localhost","port":22,"username":"pi","password":"...","cols":80,"rows":24}
	  - {"type":"input","data":"<text>"}
	  - {"type":"resize","cols":80,"rows":24}
	  - {"type":"disconnect"}

	Server-Events:
	  - {"type":"status","status":"connecting|connected|error|closed","message"?:string}
	  - {"type":"output","data":"..."}
	"""
	await ws.accept()
	if asyncssh is None:
		await ws.send_text(json.dumps({"type": "status", "status": "error", "message": "asyncssh nicht installiert"}))
		await ws.close()
		return

	ssh_conn = None
	ssh_proc = None
	reader_task: asyncio.Task | None = None

	async def close_all():
		nonlocal reader_task, ssh_proc, ssh_conn
		try:
			if reader_task and not reader_task.done():
				reader_task.cancel()
				with contextlib.suppress(Exception):
					await reader_task
		except Exception:
			pass
		try:
			if ssh_proc:
				with contextlib.suppress(Exception):
					ssh_proc.stdin.write_eof()
				with contextlib.suppress(Exception):
					ssh_proc.terminate()
		except Exception:
			pass
		try:
			if ssh_conn:
				with contextlib.suppress(Exception):
					ssh_conn.close()
				with contextlib.suppress(Exception):
					await ssh_conn.wait_closed()
		except Exception:
			pass

	try:
		await ws.send_text(json.dumps({"type": "status", "status": "connecting"}))
		initial = await ws.receive_text()
		try:
			msg = json.loads(initial)
		except Exception:
			await ws.send_text(json.dumps({"type": "status", "status": "error", "message": "Ungültige Startnachricht"}))
			await ws.close()
			return
		if not isinstance(msg, dict) or msg.get("type") != "connect":
			await ws.send_text(json.dumps({"type": "status", "status": "error", "message": "Erste Nachricht muss 'connect' sein"}))
			await ws.close()
			return

		host = str(msg.get("host") or "localhost")
		port = int(msg.get("port") or 22)
		username = str(msg.get("username") or "pi")
		password = str(msg.get("password") or "")
		cols = int(msg.get("cols") or 80)
		rows = int(msg.get("rows") or 24)

		try:
			ssh_conn = await asyncssh.connect(
				host=host,
				port=port,
				username=username,
				password=password,
				known_hosts=None,
				client_keys=None,
			)
			ssh_proc = await ssh_conn.create_process(term_type="xterm-256color", term_size=(cols, rows))
		except Exception as exc:  # noqa: BLE001
			await ws.send_text(json.dumps({"type": "status", "status": "error", "message": f"SSH-Verbindung fehlgeschlagen: {exc}"}))
			await ws.close()
			return

		await ws.send_text(json.dumps({"type": "status", "status": "connected"}))

		async def pump_stdout():
			assert ssh_proc is not None
			try:
				while True:
					data = await ssh_proc.stdout.read(4096)
					if not data:
						break
					await ws.send_text(json.dumps({"type": "output", "data": data}))
			except asyncio.CancelledError:
				pass
			except Exception:
				pass

		reader_task = asyncio.create_task(pump_stdout())

		while True:
			try:
				msg_text = await ws.receive_text()
			except WebSocketDisconnect:
				break
			except Exception:
				break
			try:
				m = json.loads(msg_text)
			except Exception:
				continue

			if not isinstance(m, dict):
				continue
			t = m.get("type")
			if t == "input":
				if ssh_proc is not None and "data" in m:
					try:
						ssh_proc.stdin.write(m.get("data") or "")
					except Exception:
						pass
			elif t == "resize":
				if ssh_proc is not None:
					c = int(m.get("cols") or cols)
					r = int(m.get("rows") or rows)
					with contextlib.suppress(Exception):
						ssh_proc.set_terminal_size(c, r)
			elif t == "disconnect":
				break

	except asyncio.CancelledError:
		pass
	finally:
		await close_all()
		with contextlib.suppress(Exception):
			await ws.send_text(json.dumps({"type": "status", "status": "closed"}))
		with contextlib.suppress(Exception):
			await ws.close()

