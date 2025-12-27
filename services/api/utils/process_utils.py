"""Process-related utility functions"""

from __future__ import annotations

import os


def is_process_running(pid: int | None) -> bool:
    """
    Check if a process with the given PID is running.
    
    Args:
        pid: Process ID to check
        
    Returns:
        True if the process is running, False otherwise
    """
    if pid is None:
        return False
    
    try:
        os.kill(pid, 0)  # Signal 0 doesn't kill, just checks if process exists
        return True
    except ProcessLookupError:
        return False  # Process doesn't exist
    except PermissionError:
        return True  # Process exists but we don't have permission to signal it
    except Exception:
        return False
