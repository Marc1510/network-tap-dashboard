from fastapi import APIRouter, HTTPException
import re
import subprocess

from services.api.utils.parsing import parse_int_maybe_hex

router = APIRouter(prefix="/license")


@router.get("/fpga_status", operation_id="license_get_fpga_status")
def get_fpga_status():
	"""
	Führt "INR_fpga_status" aus und parst die Ausgabe in strukturierte Felder.
	"""
	candidate_cmds = [
		["/usr/share/InnoRoute/INR_fpga_status.sh"],
		["/usr/share/InnoRoute/INR_fpga_status"],
		["/usr/local/bin/INR_fpga_status.sh"],
		["/usr/local/bin/INR_fpga_status"],
		["bash", "/usr/share/InnoRoute/INR_fpga_status.sh"],
		["bash", "/usr/local/bin/INR_fpga_status.sh"],
	]

	last_error: Exception | None = None
	proc: subprocess.CompletedProcess[str] | None = None
	for cmd in candidate_cmds:
		try:
			proc = subprocess.run(
				cmd,
				capture_output=True,
				text=True,
				timeout=10,
				check=False,
			)
			# Akzeptiere, wenn irgendeine Ausgabe vorhanden ist oder rc==0
			if proc.returncode == 0 or (proc.stdout and proc.stdout.strip()):
				break
		except Exception as exc:  # noqa: BLE001
			last_error = exc
			proc = None

	if proc is None:
		raise HTTPException(status_code=404, detail=f"INR_fpga_status Skript nicht gefunden oder nicht ausführbar: {last_error}")

	if proc.returncode not in (0,) and not (proc.stdout and proc.stdout.strip()):
		raise HTTPException(status_code=500, detail=f"Skriptfehler ({proc.returncode}): {proc.stderr.strip()}")

	lines = [ln.rstrip() for ln in (proc.stdout or "").splitlines() if ln.strip()]
	raw: dict[str, str] = {}
	for ln in lines:
		# Unterstütze sowohl "KEY:  VALUE" als auch "KEY=VALUE"
		if ":" in ln:
			key, val = ln.split(":", 1)
			raw[key.strip()] = val.strip()
			continue
		m = re.match(r"^(?P<key>[A-Za-z0-9_]+)=(?P<val>.*)$", ln)
		if m:
			raw[m.group("key")] = m.group("val").strip()

	decoded: dict[str, object] = {}
	if "BOARD_REV" in raw:
		decoded["board_revision"] = raw["BOARD_REV"]

	# Temperatur grob ableiten (siehe Kommentare im Originalcode)
	temp_raw = parse_int_maybe_hex(raw.get("FPGA_TEMP", "")) if "FPGA_TEMP" in raw else None
	if temp_raw is not None:
		decoded["fpga_temperature_celsius"] = round(temp_raw * 0.0164, 1)
	else:
		decoded["fpga_temperature_celsius"] = None

	id0 = raw.get("FPGA_ID0")
	id1 = raw.get("FPGA_ID1")
	if id0 or id1:
		decoded["fpga_id"] = f"{id0 or ''}-{id1 or ''}".strip("-")

	if "FPGA_REV" in raw:
		decoded["fpga_revision"] = raw["FPGA_REV"]

	lic_val = parse_int_maybe_hex(raw.get("LICENSE", "")) if "LICENSE" in raw else None
	if lic_val is not None:
		decoded["license"] = bool(lic_val)

	for field in [
		"INT_SET_EN",
		"INT_CLR_EN",
		"FPGA_ALARM",
		"CONFIG_CHECK",
		"ACCESS_ERROR",
		"FIFO_OVERFLOW",
		"FIFO_UNDERRUN",
		"EXT_INTERRUPT",
		"MMI_INT_BITMAP",
		"BACKPRESSURE",
		"RESET",
		"TEST_DRIVE",
		"TEST_VALUE",
	]:
		if field in raw:
			decoded[field.lower()] = parse_int_maybe_hex(raw[field])

	return {"raw": raw, "decoded": decoded}


