from __future__ import annotations

from enum import Enum


class ScheduleType(str, Enum):
    ONCE = "once"
    WEEKLY = "weekly"
    DAILY = "daily"


class RunStatus(str, Enum):
    RUNNING = "running"
    STARTING = "starting"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class CaptureEvent(str, Enum):
    """Events for capture metadata"""
    START = "start"
    STOP = "stop"


class StopCondition(str, Enum):
    """Stop conditions for captures"""
    MANUAL = "manual"
    DURATION = "duration"
    PACKET_COUNT = "packetCount"
    FILE_SIZE = "fileSize"


class FileType(str, Enum):
    """File types for capture files"""
    CAPTURE = "capture"
    METADATA = "metadata"


class ErrorMessages:
    """Centralized error messages"""
    TAB_NOT_FOUND = "Tab nicht gefunden"
    TAB_STILL_RUNNING = "Tab läuft noch"
    SESSION_NOT_FOUND = "Session mit ID {capture_id} nicht gefunden"
    SESSION_ALREADY_STOPPED = "Session bereits gestoppt"
    NO_METADATA = "Keine Metadaten vorhanden"
    NO_BASE_FILE = "Keine Basisdatei vorhanden"
    NO_PCAP_FILES = "Keine PCAP-Dateien gefunden"
    FILE_NOT_FOUND = "Datei nicht gefunden"
    NO_FILES_SELECTED = "Keine Dateien ausgewählt"
    NO_CAPTURE_IDS = "Keine capture_ids übergeben"
    PROFILE_ID_REQUIRED = "profileId ist erforderlich"
    TEST_NAME_REQUIRED = "test_name ist erforderlich"
    SYSTEM_INFO_ERROR = "Fehler beim Abrufen der Systeminformationen"
    SYSTEM_RESOURCES_ERROR = "Fehler beim Abrufen der Systemressourcen"
    NETWORK_INTERFACES_ERROR = "Fehler beim Abrufen der Netzwerk-Interfaces"
    ZIP_CREATION_FAILED = "ZIP-Erstellung fehlgeschlagen"
    
    @staticmethod
    def session_not_found(capture_id: str) -> str:
        return f"Session mit ID {capture_id} nicht gefunden"
    
    @staticmethod
    def file_not_found(filename: str) -> str:
        return f"Datei nicht gefunden: {filename}"


