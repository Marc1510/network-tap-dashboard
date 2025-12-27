import re
from typing import Optional, Dict


ansi_escape_re = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")


def strip_ansi_sequences(text: str) -> str:
	"""
	Entfernt ANSI-Escape-Sequenzen aus einem Text.
	"""
	return ansi_escape_re.sub("", text)


def parse_enabled_disabled_line(line: str) -> Optional[Dict[str, object]]:
	"""
	Parst eine Zeile im Format "<Name>: enabled|disabled".
	Gibt ein Dict mit name und status (bool) zurück, sonst None.
	"""
	m = re.match(r"^(?P<name>[^:]+):\s*(?P<status>enabled|disabled)\s*$", line.strip(), re.IGNORECASE)
	if not m:
		return None
	name = m.group("name").strip()
	status_str = m.group("status").lower()
	return {"name": name, "status": True if status_str == "enabled" else False}


def parse_int_maybe_hex(value: str) -> Optional[int]:
	"""
	Parst eine Ganzzahl, akzeptiert auch hexadezimale Strings (mit/ohne 0x).
	Gibt None zurück, wenn Parsing fehlschlägt.
	"""
	if value is None:
		return None
	text = str(value).strip()
	if not text:
		return None
	try:
		if text.lower().startswith("0x"):
			return int(text, 16)
		# Manche Ausgaben sind reine Hex-Zeichen ohne 0x
		if re.fullmatch(r"[0-9a-fA-F]+", text):
			return int(text, 16)
		return int(text)
	except Exception:
		return None


