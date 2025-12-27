"""Process management for tcpdump execution."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, List, Optional

logger = logging.getLogger(__name__)


# ================================================================================
# Constants
# ================================================================================

# Timeouts (seconds)
TIMEOUT_TERM_WAIT = 5
TIMEOUT_KILL_WAIT = 3


# ================================================================================
# Enums
# ================================================================================

class SignalType(str, Enum):
    """Process termination signals."""
    TERM = "SIGTERM"
    KILL = "SIGKILL"


# ================================================================================
# Dataclasses
# ================================================================================

@dataclass
class InterfaceProcess:
    """Represents a single tcpdump process for one interface."""
    process: asyncio.subprocess.Process
    task: asyncio.Task[Any]
    filename_base: Path
    interface: str
    capture_id: str
    pid: int


@dataclass
class RunningTest:
    """Represents a running test with potentially multiple interface processes."""
    run_id: str
    interfaces: List[str]
    ring_file_size_mb: int
    ring_file_count: int
    bpf_filter: str
    processes: List[InterfaceProcess]
    test_metadata_file: Optional[Path] = None  # Per-test metadata CSV file


# ================================================================================
# Process Management Functions
# ================================================================================

async def terminate_process_safely(
    process: asyncio.subprocess.Process,
    log_callback: Any,  # Callable for logging
    interface: str,
) -> None:
    """
    Safely terminate a process with SIGTERM → SIGKILL escalation.
    
    Args:
        process: The subprocess to terminate
        log_callback: Async function to call for logging (receives message and interface)
        interface: Interface name for logging context
    """
    if process.returncode is not None:
        return  # Already terminated
    
    # Send SIGTERM
    await log_callback(f"[{interface}] Sende {SignalType.TERM.value}…", interface=interface)
    try:
        process.terminate()
    except ProcessLookupError:
        return  # Process already dead
    except Exception as exc:
        await log_callback(
            f"[{interface}] Warnung beim {SignalType.TERM.value}: {exc}", 
            interface=interface
        )
    
    # Wait for termination
    try:
        await asyncio.wait_for(process.wait(), timeout=TIMEOUT_TERM_WAIT)
        return  # Successfully terminated
    except asyncio.TimeoutError:
        pass  # Continue to SIGKILL
    
    # Escalate to SIGKILL
    await log_callback(
        f"[{interface}] Timeout nach {SignalType.TERM.value}, sende {SignalType.KILL.value}…", 
        interface=interface
    )
    try:
        process.kill()
    except ProcessLookupError:
        return
    except Exception as exc:
        await log_callback(
            f"[{interface}] Warnung beim {SignalType.KILL.value}: {exc}", 
            interface=interface
        )
    
    # Wait after SIGKILL
    try:
        await asyncio.wait_for(process.wait(), timeout=TIMEOUT_KILL_WAIT)
    except asyncio.TimeoutError:
        await log_callback(
            f"[{interface}] Prozess reagiert nicht, wird als beendet markiert", 
            interface=interface
        )


async def watch_interface_process(
    process: asyncio.subprocess.Process,
    interface: str,
    capture_id: str,
    log_callback: Any,  # Async callable for logging
    exit_callback: Any,  # Async callable for exit handling
) -> None:
    """
    Watch a single interface's tcpdump process for output and exit.
    
    Args:
        process: The subprocess to watch
        interface: Interface name for logging context
        capture_id: Capture ID for this process
        log_callback: Async function for logging (receives message and interface)
        exit_callback: Async function to call on process exit (receives returncode)
    """
    try:
        if process.stdout is not None:
            while True:
                try:
                    line = await process.stdout.readline()
                except asyncio.CancelledError:
                    raise
                except (OSError, IOError) as e:
                    logger.warning("I/O-Fehler beim Lesen von %s: %s", interface, e)
                    break
                except Exception as e:
                    logger.error("Fehler beim Lesen von %s: %s", interface, e)
                    break
                if not line:
                    break
                message = line.decode(errors="replace").rstrip("\n")
                try:
                    await log_callback(message, interface=interface)
                except Exception as e:
                    logger.warning("Fehler beim Logging für %s: %s", interface, e)
                    pass
        
        returncode = await process.wait()
        # Call exit handler if still being tracked
        await exit_callback(returncode)
        
    except asyncio.CancelledError:
        # Watcher was cancelled (e.g., by stop_test), don't call exit handler
        raise
    except (OSError, IOError) as exc:
        # I/O error during process watch
        try:
            await log_callback(f"[{interface}] I/O-Fehler beim Wachen: {exc}", interface=interface)
        except Exception:
            pass
        try:
            await exit_callback(process.returncode, error=str(exc))
        except Exception:
            pass
    except Exception as exc:
        # Unexpected error
        try:
            await log_callback(f"[{interface}] Fehler beim Lesen der Ausgabe: {exc}", interface=interface)
        except Exception:
            pass
        try:
            await exit_callback(process.returncode, error=str(exc))
        except Exception:
            pass


def format_exit_codes(exit_codes: List[Optional[int]]) -> str:
    """
    Format exit codes for display.
    
    Args:
        exit_codes: List of exit codes (can contain None)
        
    Returns:
        Formatted string like "0, 0, 1" or "0, —, 1"
    """
    return ", ".join(str(c) if c is not None else "—" for c in exit_codes)
