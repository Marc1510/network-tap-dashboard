from pathlib import Path
from datetime import datetime, timezone

from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import FileResponse

from services.api.deps import CAPTURE_DIR, capture_manager
from services.api.enums import CaptureEvent, ErrorMessages
from services.api.schemas import (
	UpdateCaptureSessionPayload,
	DownloadSelectedFilesPayload,
	BulkDownloadPayload,
	DeleteCaptureSessionsPayload,
)
from services.api.utils.error_handling import (
	raise_not_found,
	raise_bad_request,
	raise_internal_error,
	handle_generic_error,
)
from services.api.utils.metadata import MetadataService
from services.api.utils.file_operations import (
	create_zip_file,
	create_zip_response,
	get_file_media_type,
	validate_file_path,
)
from services.api.utils.capture_utils import (
	list_capture_files,
	get_session_dir_and_base,
	categorize_capture_files,
	make_safe_filename,
)
from services.api.utils.process_utils import is_process_running
from services.agent.capture_manager import write_capture_metadata
import os
import signal
import time
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_metadata_service() -> MetadataService:
	"""Helper to get MetadataService instance"""
	return MetadataService(CAPTURE_DIR / "captures_meta.jsonl")


@router.get("/capture/status")
def capture_status():
	return capture_manager.status()


@router.post("/capture/start")
def capture_start(
	interface: str = "eth0",
	filter: str | None = Query(default=None, alias="filter"),
	ring_file_size_mb: int = 50,
	ring_file_count: int = 10,
	filename_prefix: str = "capture",
	test_name: str | None = Query(default=None),
):
	return capture_manager.start(
		interface=interface,
		bpf_filter=filter,
		ring_file_size_mb=ring_file_size_mb,
		ring_file_count=ring_file_count,
		filename_prefix=filename_prefix,
		test_name=test_name,
	)


@router.post("/capture/stop")
def capture_stop():
	return capture_manager.stop()


@router.post("/captures/{capture_id}/stop")
@handle_generic_error(500, "Fehler beim Stoppen der Capture")
def stop_specific_capture(capture_id: str):
	"""
	Stops a specific capture session:
	- If the currently running process belongs to the session, use capture_manager.stop(capture_id)
	- Otherwise attempt to terminate the PID; then write a stop event to metadata
	"""
	metadata = _get_metadata_service()
	metadata.ensure_exists()

	start, stop = metadata.get_start_and_stop(capture_id)
	
	if start is None:
		raise_not_found(ErrorMessages.session_not_found(capture_id))
	
	if stop is not None:
		return {"status": "already_stopped"}

	pid = start.get("pid")
	if not isinstance(pid, int):
		pid = None

	# Check if the running manager process is this session
	try:
		st = capture_manager.status()
	except Exception:
		st = {"running": False}

	if st.get("running") and pid is not None and st.get("pid") == pid:
		# Manager knows this process – stop cleanly
		return capture_manager.stop(capture_id)

	# Best-effort: Try to terminate the process directly (if still alive)
	if pid is not None:
		try:
			os.kill(pid, signal.SIGTERM)
			time.sleep(1.0)
		except Exception:
			pass
		# Fallback: harder kill
		try:
			os.kill(pid, signal.SIGKILL)
		except Exception:
			pass

	# Write a stop event so the session is marked as ended
	timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
	stop_row = {
		"event": CaptureEvent.STOP.value,
		"utc": timestamp,
		"pid": pid,
		"capture_id": capture_id
	}
	
	try:
		write_capture_metadata(CAPTURE_DIR, stop_row)
	except Exception as exc:
		raise_internal_error("Stop-Metadaten fehlgeschlagen", exc)

	return {"status": "stopped", **stop_row}


@router.get("/captures/sessions")
@handle_generic_error(500, "Fehler beim Auflisten der Sessions")
def list_capture_sessions(limit: int | None = Query(default=None, gt=0)):
	"""
	Reads captures_meta.jsonl, forms start/stop sessions per capture_id.
	Groups multi-interface tests by main_capture_id.
	"""
	metadata = _get_metadata_service()
	if not metadata.exists():
		return []

	starts: dict[str, dict] = {}
	stops: dict[str, dict] = {}

	for row, cid in metadata.iter_events():
		event = row.get("event")
		if event == CaptureEvent.START.value:
			starts[cid] = row
		elif event == CaptureEvent.STOP.value:
			stops[cid] = row

	# Group by main_capture_id for multi-interface tests
	grouped = metadata.group_by_main_capture()

	sessions = []
	for main_id, capture_ids in grouped.items():
		# Use first capture for main info
		first_capture_id = capture_ids[0]
		s = starts[first_capture_id]
		
		# Collect all interfaces
		interfaces = []
		for cid in capture_ids:
			interface = starts[cid].get("interface")
			if interface and interface not in interfaces:
				interfaces.append(interface)
		
		# Check if all interface captures have stopped
		all_stopped_by_meta = all(cid in stops for cid in capture_ids)
		
		# Additionally check if the process is actually still running
		all_stopped = all_stopped_by_meta
		if not all_stopped:
			any_running = False
			for cid in capture_ids:
				if cid in stops:
					continue
				pid = starts[cid].get("pid")
				if is_process_running(pid):
					any_running = True
					break
			all_stopped = not any_running
		
		sessions.append({
			"capture_id": first_capture_id,
			"main_capture_id": main_id,
			"capture_ids": capture_ids,
			"pid": s.get("pid"),
			"interface": s.get("interface"),
			"interfaces": interfaces,
			"start_utc": s.get("utc"),
			"stop_utc": stops.get(first_capture_id, {}).get("utc") if not all_stopped_by_meta else None,
			"running": not all_stopped,
			"filename_base": s.get("filename_base"),
			"ring_file_count": s.get("ring_file_count"),
			"ring_file_size_mb": s.get("ring_file_size_mb"),
			"bpf_filter": s.get("bpf_filter", ""),
			"test_name": s.get("test_name", ""),
			"profile_id": s.get("profile_id"),
			"profile_name": s.get("profile_name"),
		})

	sessions.sort(key=lambda x: (x.get("start_utc") or ""), reverse=True)
	if limit is not None:
		sessions = sessions[:limit]
	return sessions


@router.put("/captures/sessions/{capture_id}")
@handle_generic_error(500, "Fehler beim Aktualisieren der Session")
def update_capture_session(capture_id: str, payload: UpdateCaptureSessionPayload):
	"""Updates the test_name of a capture."""
	metadata = _get_metadata_service()
	metadata.ensure_exists()

	all_rows = metadata.read_all_rows()
	found = False
	
	for row in all_rows:
		row_capture_id = row.get("capture_id") or f"pid-{row.get('pid')}"
		if row_capture_id == capture_id and row.get("event") == CaptureEvent.START.value:
			row["test_name"] = payload.test_name
			found = True

	if not found:
		raise_not_found(ErrorMessages.session_not_found(capture_id))

	metadata.write_all_rows(all_rows)
	return {"status": "updated", "test_name": payload.test_name}


@router.get("/captures/sessions/{capture_id}")
@handle_generic_error(500, "Fehler beim Abrufen der Session")
def get_capture_session(capture_id: str):
	metadata = _get_metadata_service()
	metadata.ensure_exists()

	start, stop = metadata.get_start_and_stop(capture_id)
	if start is None:
		logger.warning(f"Session nicht gefunden: {capture_id}")
		raise_not_found(ErrorMessages.session_not_found(capture_id))

	# Find all related captures (multi-interface support)
	related_starts, related_stops = metadata.find_related_captures(capture_id)
	
	# Collect all interfaces
	interfaces: list[str] = []
	for cid, s in related_starts.items():
		iface = s.get("interface")
		if iface and iface not in interfaces:
			interfaces.append(iface)

	# Collect files grouped by interface
	files: list[dict] = []
	files_by_interface: dict[str, list[dict]] = {}
	metadata_files: list[dict] = []
	
	for cid, s in related_starts.items():
		interface = s.get("interface") or "unknown"
		if interface not in files_by_interface:
			files_by_interface[interface] = []
		
		capture_files = list_capture_files(s)
		all_file_entries, meta_file_entries = categorize_capture_files(
			capture_files, interface, cid
		)
		
		files.extend(all_file_entries)
		files_by_interface[interface].extend(
			[f for f in all_file_entries if f["file_type"] == "capture"]
		)
		
		# Add metadata files (avoid duplicates)
		for mf in meta_file_entries:
			if not any(existing["name"] == mf["name"] for existing in metadata_files):
				metadata_files.append(mf)

	# Check if all related captures have stopped
	all_stopped_by_meta = all(cid in related_stops for cid in related_starts)
	
	# Additionally check if the process is actually still running
	all_stopped = all_stopped_by_meta
	if not all_stopped:
		any_running = any(
			is_process_running(related_starts[cid].get("pid"))
			for cid in related_starts
			if cid not in related_stops
		)
		all_stopped = not any_running

	main_capture_id = start.get("main_capture_id") or capture_id
	
	return {
		"capture_id": capture_id,
		"main_capture_id": main_capture_id,
		"capture_ids": list(related_starts.keys()),
		"pid": start.get("pid"),
		"interface": start.get("interface"),
		"interfaces": interfaces,
		"start_utc": start.get("utc"),
		"stop_utc": stop.get("utc") if stop else None,
		"running": not all_stopped,
		"filename_base": start.get("filename_base"),
		"ring_file_count": start.get("ring_file_count"),
		"ring_file_size_mb": start.get("ring_file_size_mb"),
		"bpf_filter": start.get("bpf_filter", ""),
		"test_name": start.get("test_name", ""),
		"profile_id": start.get("profile_id"),
		"profile_name": start.get("profile_name"),
		"files": files,
		"files_by_interface": files_by_interface,
		"metadata_files": metadata_files,
	}


@router.get("/captures/{capture_id}/download")
@handle_generic_error(500, "Fehler beim Herunterladen der Capture")
def download_capture(capture_id: str):
	metadata = _get_metadata_service()
	metadata.ensure_exists()

	start = metadata.get_start_event(capture_id)
	if start is None:
		raise_not_found(ErrorMessages.session_not_found(capture_id))

	# Find all related captures (multi-interface support)
	related_starts, _ = metadata.find_related_captures(capture_id)
	
	all_files: list[Path] = []
	for s in related_starts.values():
		all_files.extend(list_capture_files(s))

	if not all_files:
		raise_not_found(ErrorMessages.NO_PCAP_FILES)

	short_id = capture_id.split('-')[0] if '-' in capture_id else capture_id[:8]
	zip_name = f"capture_{short_id}.zip"

	return create_zip_response(all_files, zip_name)


@router.get("/captures/{capture_id}/files/{filename}")
@handle_generic_error(500, "Fehler beim Herunterladen der Datei")
def download_single_pcap(capture_id: str, filename: str):
	metadata = _get_metadata_service()
	metadata.ensure_exists()

	start = metadata.get_start_event(capture_id)
	if start is None:
		raise_not_found(ErrorMessages.session_not_found(capture_id))

	# Find all related captures for multi-interface support
	related_starts, _ = metadata.find_related_captures(capture_id)
	
	valid_bases: list[tuple[Path, str]] = []
	for s in related_starts.values():
		try:
			base_dir, base_name = get_session_dir_and_base(s)
			valid_bases.append((base_dir, base_name))
		except Exception:
			continue

	if not valid_bases:
		raise_not_found(ErrorMessages.NO_BASE_FILE)

	# Try to find the file in any of the valid base directories
	for base_dir, base_name in valid_bases:
		try:
			candidate = validate_file_path(base_dir, filename, base_name)
			media_type = get_file_media_type(candidate)
			
			return FileResponse(
				path=str(candidate),
				media_type=media_type,
				filename=candidate.name,
			)
		except HTTPException:
			continue

	raise_not_found(ErrorMessages.FILE_NOT_FOUND)


@router.post("/captures/{capture_id}/download")
@handle_generic_error(500, "Fehler beim Herunterladen ausgewählter Dateien")
def download_selected_as_zip(capture_id: str, payload: DownloadSelectedFilesPayload):
	if not payload.files:
		raise_bad_request(ErrorMessages.NO_FILES_SELECTED)

	metadata = _get_metadata_service()
	metadata.ensure_exists()

	start = metadata.get_start_event(capture_id)
	if start is None:
		raise_not_found(ErrorMessages.session_not_found(capture_id))

	# Find all related captures for multi-interface support
	related_starts, _ = metadata.find_related_captures(capture_id)
	
	valid_bases: list[tuple[Path, str]] = []
	for s in related_starts.values():
		try:
			base_dir, base_name = get_session_dir_and_base(s)
			valid_bases.append((base_dir, base_name))
		except Exception:
			continue

	if not valid_bases:
		raise_not_found(ErrorMessages.NO_BASE_FILE)

	resolved_files: list[Path] = []
	for name in payload.files:
		found = False
		for base_dir, base_name in valid_bases:
			try:
				p = validate_file_path(base_dir, name, base_name)
				resolved_files.append(p)
				found = True
				break
			except HTTPException:
				continue
		
		if not found:
			raise_not_found(ErrorMessages.file_not_found(name))

	short_id = capture_id.split('-')[0] if '-' in capture_id else capture_id[:8]
	zip_name = f"capture_{short_id}_selection.zip"

	return create_zip_response(resolved_files, zip_name)


@router.post("/captures/bulk-download")
@handle_generic_error(500, "Fehler beim Bulk-Download")
def download_multiple_captures_as_zip(payload: BulkDownloadPayload):
	if not payload.capture_ids:
		raise_bad_request(ErrorMessages.NO_CAPTURE_IDS)

	metadata = _get_metadata_service()
	metadata.ensure_exists()

	sessions: dict[str, dict] = {}
	for row, cid in metadata.iter_events():
		if cid in payload.capture_ids and row.get("event") == CaptureEvent.START.value:
			sessions[cid] = row

	if not sessions:
		raise_not_found("Keine der angegebenen Sessions gefunden")

	timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
	zip_name = f"captures_bulk_{timestamp}.zip"

	def add_bulk_files(zf):
		for cap_id, session in sessions.items():
			capture_files = list_capture_files(session)
			if not capture_files:
				continue

			test_name = session.get("test_name") or session.get("interface") or "unknown"
			safe_name = make_safe_filename(test_name)
			short_id = cap_id.split('-')[0] if '-' in cap_id else cap_id[:8]
			folder_name = f"{safe_name}_{short_id}"

			for p in capture_files:
				arcname = f"{folder_name}/{p.name}"
				zf.write(p, arcname=arcname)

	zip_path = create_zip_file(zip_name, add_bulk_files)

	response = FileResponse(
		path=str(zip_path),
		media_type="application/zip",
		filename=zip_name,
	)
	response.headers["Content-Disposition"] = f'attachment; filename="{zip_name}"'
	return response


@router.delete("/captures/sessions")
@handle_generic_error(500, "Fehler beim Löschen der Sessions")
def delete_capture_sessions(payload: DeleteCaptureSessionsPayload):
	if not payload.capture_ids:
		raise_bad_request(ErrorMessages.NO_CAPTURE_IDS)

	metadata = _get_metadata_service()
	meta_csv = CAPTURE_DIR / "captures_meta.csv"
	
	if not metadata.exists():
		return {
			"deleted": [],
			"errors": {cid: ErrorMessages.NO_METADATA for cid in payload.capture_ids}
		}

	starts: dict[str, dict] = {}
	stops: dict[str, dict] = {}
	all_rows = metadata.read_all_rows()
	
	for row in all_rows:
		cid = row.get("capture_id") or f"pid-{row.get('pid')}"
		event = row.get("event")
		if event == CaptureEvent.START.value:
			starts[cid] = row
		elif event == CaptureEvent.STOP.value:
			stops[cid] = row

	deleted: list[str] = []
	errors: dict[str, str] = {}

	for capture_id in payload.capture_ids:
		start = starts.get(capture_id)
		stop = stops.get(capture_id)
		
		if start is None:
			errors[capture_id] = "Session nicht gefunden"
			continue
		if stop is None:
			errors[capture_id] = "Session läuft noch (kein Stop-Event)"
			continue

		capture_files = list_capture_files(start)
		if not capture_files:
			errors[capture_id] = ErrorMessages.NO_BASE_FILE
			continue

		try:
			for file_path in capture_files:
				try:
					file_path.unlink()
				except Exception:
					pass
			deleted.append(capture_id)
		except Exception as exc:
			errors[capture_id] = f"Fehler beim Löschen: {exc}"

	# Rewrite metadata file without deleted sessions
	remaining = [
		row for row in all_rows
		if (row.get("capture_id") or f"pid-{row.get('pid')}") not in deleted
	]
	metadata.write_all_rows(remaining)
	
	# Optional: clean up CSV metadata
	if meta_csv.exists():
		try:
			lines = meta_csv.read_text(encoding="utf-8").splitlines()
			with meta_csv.open("w", encoding="utf-8") as f:
				for ln in lines:
					if not ln.strip():
						continue
					# Simple filtering: search for capture_id in CSV
					keep = True
					for cid in deleted:
						if cid in ln:
							keep = False
							break
					if keep:
						f.write(ln + "\n")
		except Exception:
			pass

	return {"deleted": deleted, "errors": errors}


