"""File operations utilities"""

from __future__ import annotations

import tempfile
import zipfile
from pathlib import Path
from typing import Callable

from fastapi import HTTPException
from fastapi.responses import FileResponse

from services.api.enums import ErrorMessages


def validate_file_path(
    base_dir: Path,
    filename: str,
    base_name: str | None = None
) -> Path:
    """
    Validate and resolve a file path, protecting against path traversal attacks.
    
    Args:
        base_dir: Base directory that the file must be within
        filename: Name of the file to validate
        base_name: Optional base name that the file must start with
        
    Returns:
        Resolved Path object
        
    Raises:
        HTTPException: If validation fails
    """
    try:
        # Resolve the path to prevent path traversal
        candidate = (base_dir / filename).resolve()
        
        # Ensure the file is within the base directory
        if base_dir not in candidate.parents and candidate != base_dir:
            raise HTTPException(
                status_code=403,
                detail="Zugriff verweigert: Datei außerhalb des erlaubten Verzeichnisses"
            )
        
        # Ensure the file starts with the expected base name
        if base_name and not candidate.name.startswith(base_name):
            raise HTTPException(
                status_code=403,
                detail="Zugriff verweigert: Dateiname entspricht nicht dem erwarteten Muster"
            )
        
        # Check if file exists
        if not candidate.exists() or not candidate.is_file():
            raise HTTPException(status_code=404, detail=ErrorMessages.FILE_NOT_FOUND)
        
        return candidate
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Fehler bei Dateipfad-Validierung: {exc}")


def create_zip_file(
    zip_name: str,
    add_files_callback: Callable[[zipfile.ZipFile], None]
) -> Path:
    """
    Create a ZIP file in a temporary directory with the provided files.
    
    Args:
        zip_name: Name of the ZIP file to create
        add_files_callback: Callback function that receives a ZipFile object and adds files to it
        
    Returns:
        Path to the created ZIP file
        
    Raises:
        HTTPException: If ZIP creation fails
    """
    try:
        tmp_dir = Path(tempfile.gettempdir())
        zip_path = tmp_dir / zip_name
        
        with zipfile.ZipFile(zip_path, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            add_files_callback(zf)
        
        return zip_path
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"{ErrorMessages.ZIP_CREATION_FAILED}: {exc}"
        )


def create_zip_response(
    files: list[Path],
    zip_name: str,
    arcname_callback: Callable[[Path], str] | None = None
) -> FileResponse:
    """
    Create a ZIP file response with the given files.
    
    Args:
        files: List of file paths to include in the ZIP
        zip_name: Name of the ZIP file
        arcname_callback: Optional callback to generate archive names for files
        
    Returns:
        FileResponse with the ZIP file
    """
    def add_files(zf: zipfile.ZipFile) -> None:
        for file_path in files:
            arcname = arcname_callback(file_path) if arcname_callback else file_path.name
            zf.write(file_path, arcname=arcname)
    
    zip_path = create_zip_file(zip_name, add_files)
    
    return FileResponse(
        path=str(zip_path),
        media_type="application/zip",
        filename=zip_name,
    )


def get_file_media_type(file_path: Path) -> str:
    """
    Determine the media type based on file extension.
    
    Args:
        file_path: Path to the file
        
    Returns:
        Media type string
    """
    suffix = file_path.suffix.lower()
    
    if suffix == ".csv":
        return "text/csv"
    elif suffix in (".pcap", ".pcapng"):
        return "application/vnd.tcpdump.pcap"
    else:
        return "application/octet-stream"
