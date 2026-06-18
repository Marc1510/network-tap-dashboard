from fastapi import APIRouter, HTTPException
import ast
import re
import subprocess

from services.api.utils.parsing import parse_enabled_disabled_line, parse_int_maybe_hex, strip_ansi_sequences

router = APIRouter(prefix="/license")


def _run_first_available(candidate_cmds: list[list[str]]) -> subprocess.CompletedProcess[str] | None:
	for cmd in candidate_cmds:
		try:
			proc = subprocess.run(
				cmd,
				capture_output=True,
				text=True,
				timeout=10,
				check=False,
			)
			if proc.returncode == 0 or (proc.stdout and proc.stdout.strip()):
				return proc
		except Exception:  # noqa: BLE001
			continue
	return None


def _literal_after_marker(text: str, marker: str) -> object | None:
	start = text.find(marker)
	if start < 0:
		return None
	remainder = text[start + len(marker):].lstrip()
	if not remainder or remainder[0] not in "{[":
		return None

	opening = remainder[0]
	closing = "}" if opening == "{" else "]"
	depth = 0
	for index, char in enumerate(remainder):
		if char == opening:
			depth += 1
		elif char == closing:
			depth -= 1
			if depth == 0:
				try:
					return ast.literal_eval(remainder[: index + 1])
				except (SyntaxError, ValueError):
					return None
	return None


def _parse_key_value_output(stdout: str) -> dict[str, object]:
	raw: dict[str, object] = {}
	for line in [line.rstrip() for line in stdout.splitlines() if line.strip()]:
		if ":" in line:
			key, val = line.split(":", 1)
			raw[key.strip()] = val.strip()
			continue
		match = re.match(r"^(?P<key>[A-Za-z0-9_]+)=(?P<val>.*)$", line)
		if match:
			raw[match.group("key")] = match.group("val").strip()
	return raw


def _parse_license_features(stdout: str) -> list[dict[str, object]]:
	clean = strip_ansi_sequences(stdout)
	features: list[dict[str, object]] = []
	current: dict[str, object] | None = None
	for line in clean.splitlines():
		parsed = parse_enabled_disabled_line(line)
		if parsed:
			if current:
				features.append(current)
			current = {"name": parsed["name"], "status": parsed["status"], "description": ""}
			continue
		if current and line.strip():
			description = str(current.get("description") or "")
			current["description"] = f"{description} {line.strip()}".strip()
	if current:
		features.append(current)
	return features


def _normalise_status(raw: dict[str, object], license_features: list[dict[str, object]]) -> dict[str, object]:
	def value(*keys: str) -> object | None:
		for key in keys:
			if key in raw:
				return raw[key]
		return None

	decoded: dict[str, object] = {}

	board_revision = value("BOARD_REV", "Board_REV")
	if board_revision is not None:
		decoded["board_revision"] = str(board_revision)

	temp_value = value("TEMP")
	if isinstance(temp_value, (int, float)):
		decoded["fpga_temperature_celsius"] = round(float(temp_value), 1)
	else:
		temp_raw = parse_int_maybe_hex(str(value("FPGA_TEMP") or "")) if value("FPGA_TEMP") is not None else None
		decoded["fpga_temperature_celsius"] = round(temp_raw * 0.0164, 1) if temp_raw is not None else None

	fpga_id = value("ID")
	if fpga_id is not None:
		decoded["fpga_id"] = str(fpga_id)
	else:
		id0 = value("FPGA_ID0")
		id1 = value("FPGA_ID1")
		if id0 or id1:
			decoded["fpga_id"] = f"{id0 or ''}-{id1 or ''}".strip("-")

	fpga_revision = value("FPGA_REV")
	if fpga_revision is not None:
		decoded["fpga_revision"] = str(fpga_revision)
		revision_int = parse_int_maybe_hex(str(fpga_revision))
		if revision_int is not None:
			use_case = (revision_int >> 24) & 0xff
			decoded["use_case"] = f"UC{use_case}"
			decoded["address_map_version"] = (revision_int >> 16) & 0xff
			decoded["design_id"] = f"0x{revision_int & 0xffff:04x}"
			decoded["active_configuration"] = "UC4/TSN TAP" if use_case == 4 else ("UC0/basic" if use_case == 0 else f"UC{use_case}")

	license_register = value("LICENSE")
	license_int = parse_int_maybe_hex(str(license_register or "")) if license_register is not None else None
	if license_register is not None:
		decoded["license_register"] = str(license_register)
	if license_int is not None:
		decoded["license_bits"] = [bit for bit in range(32) if license_int & (1 << bit)]
		decoded["license_present"] = bool(license_int)
		decoded["license"] = bool(license_int)

	normalised_features = [
		{
			"name": str(feature.get("name", "")).strip(),
			"status": bool(feature.get("status")),
			"description": str(feature.get("description", "")).strip(),
		}
		for feature in license_features
		if str(feature.get("name", "")).strip()
	]
	decoded["license_features"] = normalised_features
	decoded["feature_licenses_enabled"] = any(feature["status"] for feature in normalised_features)

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
		"FEATURE_MAP",
	]:
		field_value = value(field)
		if field_value is not None:
			decoded[field.lower()] = parse_int_maybe_hex(str(field_value))

	return decoded


@router.get("/fpga_status", operation_id="license_get_fpga_status")
def get_fpga_status():
	"""
	Read RealTimeHAT FPGA status and feature-license information.
	"""
	status_cmds = [
		["/usr/local/bin/INR_FPGA_status"],
		["INR_FPGA_status"],
		["/usr/share/InnoRoute/INR_fpga_status.sh"],
		["/usr/share/InnoRoute/INR_fpga_status"],
		["/usr/local/bin/INR_fpga_status.sh"],
		["/usr/local/bin/INR_fpga_status"],
		["bash", "/usr/share/InnoRoute/INR_fpga_status.sh"],
		["bash", "/usr/local/bin/INR_fpga_status.sh"],
	]
	license_cmds = [
		["/usr/local/bin/INR_FPGA_license"],
		["INR_FPGA_license"],
	]

	proc = _run_first_available(status_cmds)
	if proc is None:
		raise HTTPException(status_code=404, detail="INR_FPGA_status/INR_fpga_status script not found or not executable")
	if proc.returncode not in (0,) and not (proc.stdout and proc.stdout.strip()):
		raise HTTPException(status_code=500, detail=f"Script error ({proc.returncode}): {proc.stderr.strip()}")

	status_stdout = proc.stdout or ""
	raw_obj = _literal_after_marker(status_stdout, "FPGA status:")
	raw = raw_obj if isinstance(raw_obj, dict) else _parse_key_value_output(status_stdout)

	features_obj = _literal_after_marker(status_stdout, "available licenses:")
	license_features = features_obj if isinstance(features_obj, list) else []
	license_stdout = ""
	if not license_features:
		license_proc = _run_first_available(license_cmds)
		if license_proc and license_proc.stdout:
			license_stdout = license_proc.stdout
			license_features = _parse_license_features(license_proc.stdout)

	decoded = _normalise_status(raw, license_features)
	response = {
		"raw": raw,
		"decoded": decoded,
		"status_output": status_stdout,
		"license_output": license_stdout,
	}
	response.update(decoded)
	return response
