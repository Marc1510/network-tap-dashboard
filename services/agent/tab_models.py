"""Data models for test tabs and runs."""

from __future__ import annotations

import re
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Deque, Dict, List, Optional


# ================================================================================
# Enums
# ================================================================================

class TabStatus(str, Enum):
    """Tab status values."""
    IDLE = "idle"
    STARTING = "starting"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


# ================================================================================
# Helper Functions
# ================================================================================

def utcnow_iso() -> str:
    """Get current UTC timestamp in ISO format."""
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


_SLUG_CLEAN_RE = re.compile(r"[^a-z0-9]+")


def slugify(value: str) -> str:
    """
    Convert a string to a slug (lowercase, alphanumeric with underscores).
    
    Args:
        value: String to slugify
        
    Returns:
        Slugified string
    """
    value_norm = value.lower()
    value_norm = _SLUG_CLEAN_RE.sub("_", value_norm)
    return value_norm.strip("_") or "capture"


# ================================================================================
# Dataclasses
# ================================================================================

@dataclass
class LogEntry:
    """A single log entry."""
    seq: int
    timestamp: str
    message: str
    tab_id: str
    interface: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dict for JSON serialization."""
        result = {
            "seq": self.seq,
            "timestamp": self.timestamp,
            "message": self.message,
            "tabId": self.tab_id,
        }
        if self.interface is not None:
            result["interface"] = self.interface
        return result


@dataclass
class Run:
    """Information about a test run."""
    id: str
    profile_id: Optional[str]
    started_utc: str
    finished_utc: Optional[str] = None
    exit_code: Optional[int] = None  # Legacy single exit code
    exit_codes: Optional[List[Optional[int]]] = None  # Multi-interface exit codes
    cancelled: bool = False
    error: Optional[str] = None
    # Multi-interface fields
    commands: Optional[List[str]] = None
    filenames_bases: Optional[List[str]] = None
    capture_ids: Optional[List[str]] = None
    main_capture_id: Optional[str] = None
    pids: Optional[List[int]] = None
    interfaces: Optional[List[str]] = None
    ring_file_size_mb: Optional[int] = None
    ring_file_count: Optional[int] = None
    bpf_filter: Optional[str] = None
    # Legacy single-interface fields (for backwards compatibility)
    command: Optional[str] = None
    filename_base: Optional[str] = None
    capture_id: Optional[str] = None
    pid: Optional[int] = None
    interface: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dict for JSON serialization."""
        result = {
            "id": self.id,
            "profileId": self.profile_id,
            "startedUtc": self.started_utc,
            "finishedUtc": self.finished_utc,
            "exitCode": self.exit_code,
            "cancelled": self.cancelled,
            "error": self.error,
        }
        # Add optional multi-interface fields if present
        if self.exit_codes is not None:
            result["exitCodes"] = self.exit_codes
        if self.commands is not None:
            result["commands"] = self.commands
        if self.filenames_bases is not None:
            result["filenamesBases"] = self.filenames_bases
        if self.capture_ids is not None:
            result["capture_ids"] = self.capture_ids
        if self.main_capture_id is not None:
            result["main_capture_id"] = self.main_capture_id
        if self.pids is not None:
            result["pids"] = self.pids
        if self.interfaces is not None:
            result["interfaces"] = self.interfaces
        if self.ring_file_size_mb is not None:
            result["ringFileSizeMb"] = self.ring_file_size_mb
        if self.ring_file_count is not None:
            result["ringFileCount"] = self.ring_file_count
        if self.bpf_filter is not None:
            result["bpfFilter"] = self.bpf_filter
        # Legacy fields
        if self.command is not None:
            result["command"] = self.command
        if self.filename_base is not None:
            result["filenameBase"] = self.filename_base
        if self.capture_id is not None:
            result["capture_id"] = self.capture_id
        if self.pid is not None:
            result["pid"] = self.pid
        if self.interface is not None:
            result["interface"] = self.interface
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> Run:
        """Create Run from dict (e.g., from JSON)."""
        return cls(
            id=data.get("id", ""),
            profile_id=data.get("profileId"),
            started_utc=data.get("startedUtc", utcnow_iso()),
            finished_utc=data.get("finishedUtc"),
            exit_code=data.get("exitCode"),
            exit_codes=data.get("exitCodes"),
            cancelled=data.get("cancelled", False),
            error=data.get("error"),
            commands=data.get("commands"),
            filenames_bases=data.get("filenamesBases"),
            capture_ids=data.get("capture_ids"),
            main_capture_id=data.get("main_capture_id"),
            pids=data.get("pids"),
            interfaces=data.get("interfaces"),
            ring_file_size_mb=data.get("ringFileSizeMb"),
            ring_file_count=data.get("ringFileCount"),
            bpf_filter=data.get("bpfFilter"),
            command=data.get("command"),
            filename_base=data.get("filenameBase"),
            capture_id=data.get("capture_id"),
            pid=data.get("pid"),
            interface=data.get("interface"),
        )


@dataclass
class Tab:
    """A test tab with its state and logs."""
    id: str
    title: str
    status: str
    created_utc: str
    updated_utc: str
    profile_id: Optional[str] = None
    run: Optional[Run] = None
    logs: Deque[LogEntry] = field(default_factory=deque)
    log_seq: int = 0
    last_message: Optional[str] = None
    profile: Optional[Dict[str, Any]] = None  # Complete profile for reference

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dict for JSON serialization."""
        return {
            "id": self.id,
            "title": self.title,
            "profileId": self.profile_id,
            "status": self.status,
            "createdUtc": self.created_utc,
            "updatedUtc": self.updated_utc,
            "run": self.run.to_dict() if self.run else None,
            "logs": [log.to_dict() for log in self.logs],
            "logSeq": self.log_seq,
            "lastMessage": self.last_message,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any], max_log_entries: int = 500) -> Tab:
        """Create Tab from dict (e.g., from JSON)."""
        # Parse run if present
        run = None
        if data.get("run") and isinstance(data["run"], dict):
            run = Run.from_dict(data["run"])
        
        # Parse logs
        logs_deque: Deque[LogEntry] = deque(maxlen=max_log_entries)
        raw_logs = data.get("logs", [])
        if isinstance(raw_logs, list):
            for log_data in raw_logs[-max_log_entries:]:
                if isinstance(log_data, dict):
                    logs_deque.append(LogEntry(
                        seq=log_data.get("seq", 0),
                        timestamp=log_data.get("timestamp", utcnow_iso()),
                        message=log_data.get("message", ""),
                        tab_id=log_data.get("tabId", ""),
                        interface=log_data.get("interface"),
                    ))
        
        return cls(
            id=data.get("id", ""),
            title=data.get("title", "Neuer Test"),
            profile_id=data.get("profileId"),
            status=data.get("status", TabStatus.IDLE.value),
            created_utc=data.get("createdUtc", utcnow_iso()),
            updated_utc=data.get("updatedUtc", utcnow_iso()),
            run=run,
            logs=logs_deque,
            log_seq=data.get("logSeq", 0),
            last_message=data.get("lastMessage"),
            profile=data.get("profile"),
        )
