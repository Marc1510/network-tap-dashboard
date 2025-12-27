"""Capture-related utility functions"""

from __future__ import annotations

import re
from pathlib import Path

from fastapi import HTTPException

from services.api.enums import ErrorMessages, FileType


def list_capture_files(start_row: dict) -> list[Path]:
    """
    List all files belonging to a capture session.
    Finds both .pcap files and related metadata like _summary.csv.
    
    Args:
        start_row: Start event dictionary from metadata
        
    Returns:
        List of Path objects for all related files
    """
    filename_base = start_row.get("filename_base")
    if not filename_base:
        return []
    
    try:
        base_path = Path(filename_base)
        parent_dir = base_path.parent
        
        if not parent_dir.exists():
            return []
        
        # Use stem (without .pcap extension) to find all related files
        # This matches: .pcap, .pcap00, .pcap01, ... as well as _summary.csv
        stem = base_path.stem
        return [p for p in sorted(parent_dir.glob(stem + "*")) if p.is_file()]
    except Exception:
        return []


def get_session_dir_and_base(start_row: dict) -> tuple[Path, str]:
    """
    Get the base directory and file stem for a capture session.
    
    Args:
        start_row: Start event dictionary from metadata
        
    Returns:
        Tuple of (base_directory, file_stem)
        
    Raises:
        HTTPException: If no base file is available
    """
    filename_base = start_row.get("filename_base")
    if not filename_base:
        raise HTTPException(status_code=404, detail=ErrorMessages.NO_BASE_FILE)
    
    base_path = Path(filename_base)
    # Use stem (without .pcap extension) so that related files like _summary.csv are matched
    return base_path.parent.resolve(), base_path.stem


def is_metadata_file(file_path: Path) -> bool:
    """
    Check if a file is a metadata file (e.g., _meta.csv, _summary.csv).
    
    Args:
        file_path: Path to check
        
    Returns:
        True if the file is a metadata file, False otherwise
    """
    return file_path.suffix == ".csv" and ("_meta" in file_path.stem or "_summary" in file_path.stem)


def categorize_capture_files(
    files: list[Path],
    interface: str,
    capture_id: str
) -> tuple[list[dict], list[dict]]:
    """
    Categorize files into capture files and metadata files.
    
    Args:
        files: List of file paths
        interface: Interface name for the capture
        capture_id: Capture ID
        
    Returns:
        Tuple of (all_files, metadata_files) as lists of file info dicts
    """
    all_files: list[dict] = []
    metadata_files: list[dict] = []
    
    for file_path in files:
        try:
            size = file_path.stat().st_size
        except OSError:
            size = None
        
        is_meta = is_metadata_file(file_path)
        
        file_entry = {
            "name": file_path.name,
            "size_bytes": size,
            "path": str(file_path),
            "interface": interface,
            "capture_id": capture_id,
            "file_type": FileType.METADATA.value if is_meta else FileType.CAPTURE.value,
        }
        
        all_files.append(file_entry)
        
        if is_meta:
            metadata_files.append(file_entry)
    
    return all_files, metadata_files


def make_safe_filename(test_name: str) -> str:
    """
    Convert a test name into a safe filename by replacing invalid characters.
    
    Args:
        test_name: Original test name
        
    Returns:
        Safe filename string
    """
    return re.sub(r'[<>:"/\\|?*]', '_', test_name)
