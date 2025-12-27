"""Metadata service for centralized capture metadata management"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Iterator

from fastapi import HTTPException

from services.api.enums import CaptureEvent, ErrorMessages

logger = logging.getLogger(__name__)


class MetadataService:
    """
    Service for managing capture metadata files.
    Provides centralized access to capture metadata with consistent error handling.
    """
    
    def __init__(self, meta_file: Path):
        """
        Initialize the metadata service.
        
        Args:
            meta_file: Path to the metadata file (captures_meta.jsonl)
        """
        self.meta_file = meta_file
    
    def exists(self) -> bool:
        """Check if the metadata file exists"""
        return self.meta_file.exists()
    
    def ensure_exists(self) -> None:
        """Ensure the metadata file exists, raise HTTPException if not"""
        if not self.exists():
            raise HTTPException(status_code=404, detail=ErrorMessages.NO_METADATA)
    
    def iter_rows(self) -> Iterator[dict]:
        """
        Iterate over all valid JSON rows in the metadata file.
        Ignores empty or malformed lines.
        
        Yields:
            Dictionary representing a metadata row
        """
        if not self.exists():
            return
        
        with self.meta_file.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                    yield row
                except json.JSONDecodeError as exc:
                    logger.warning(f"Invalid JSON in metadata file: {line[:50]}... Error: {exc}")
                    continue
    
    def iter_events(self) -> Iterator[tuple[dict, str]]:
        """
        Iterate over metadata rows with computed capture_id.
        
        Yields:
            Tuple of (row_dict, capture_id)
        """
        for row in self.iter_rows():
            capture_id = row.get("capture_id") or f"pid-{row.get('pid')}"
            yield row, capture_id
    
    def get_start_and_stop(self, capture_id: str) -> tuple[dict | None, dict | None]:
        """
        Get start and stop events for a capture session.
        
        Args:
            capture_id: ID of the capture session
            
        Returns:
            Tuple of (start_event, stop_event), either can be None
        """
        start: dict | None = None
        stop: dict | None = None
        
        for row, row_capture_id in self.iter_events():
            if row_capture_id != capture_id:
                continue
            
            event = row.get("event")
            if event == CaptureEvent.START.value:
                start = row
            elif event == CaptureEvent.STOP.value:
                stop = row
        
        return start, stop
    
    def get_start_event(self, capture_id: str) -> dict | None:
        """
        Get only the start event for a capture session.
        
        Args:
            capture_id: ID of the capture session
            
        Returns:
            Start event dictionary or None
        """
        start, _ = self.get_start_and_stop(capture_id)
        return start
    
    def find_related_captures(self, capture_id: str) -> tuple[dict[str, dict], dict[str, dict]]:
        """
        Find all captures related to a main capture ID (multi-interface support).
        
        Args:
            capture_id: ID of the primary capture
            
        Returns:
            Tuple of (start_events_dict, stop_events_dict) keyed by capture_id
        """
        self.ensure_exists()
        
        # First get the main capture's start event
        start_event = self.get_start_event(capture_id)
        if not start_event:
            return {}, {}
        
        # Get the main_capture_id
        main_capture_id = start_event.get("main_capture_id") or capture_id
        
        # Find all related captures
        related_starts: dict[str, dict] = {}
        related_stops: dict[str, dict] = {}
        
        for row, cid in self.iter_events():
            row_main_id = row.get("main_capture_id") or cid
            if row_main_id == main_capture_id or cid == capture_id:
                event = row.get("event")
                if event == CaptureEvent.START.value:
                    related_starts[cid] = row
                elif event == CaptureEvent.STOP.value:
                    related_stops[cid] = row
        
        return related_starts, related_stops
    
    def read_all_rows(self) -> list[dict]:
        """
        Read all metadata rows into memory.
        
        Returns:
            List of all metadata rows
        """
        return list(self.iter_rows())
    
    def write_all_rows(self, rows: list[dict]) -> None:
        """
        Write all metadata rows to the file, replacing existing content.
        
        Args:
            rows: List of metadata rows to write
        """
        try:
            with self.meta_file.open("w", encoding="utf-8") as f:
                for row in rows:
                    f.write(json.dumps(row, ensure_ascii=False) + "\n")
        except Exception as exc:
            logger.error(f"Failed to write metadata file: {exc}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Fehler beim Speichern der Metadaten: {exc}")
    
    def group_by_main_capture(self) -> dict[str, list[str]]:
        """
        Group all captures by their main_capture_id for multi-interface tests.
        
        Returns:
            Dictionary mapping main_capture_id to list of capture_ids
        """
        grouped: dict[str, list[str]] = {}
        
        for row, capture_id in self.iter_events():
            if row.get("event") != CaptureEvent.START.value:
                continue
            
            main_id = row.get("main_capture_id") or capture_id
            if main_id not in grouped:
                grouped[main_id] = []
            grouped[main_id].append(capture_id)
        
        return grouped
