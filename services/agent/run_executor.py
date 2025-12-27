"""Test execution and run management."""

from __future__ import annotations

import asyncio
import logging
import shlex
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

from services.agent.capture_manager import write_capture_metadata
from services.agent.filter_builder import (
    build_bpf_filter,
    validate_bpf_filter,
    validate_interface_name,
)
from services.agent.process_manager import (
    InterfaceProcess,
    RunningTest,
    format_exit_codes,
    terminate_process_safely,
    watch_interface_process,
)
from services.agent.tab_models import Run, TabStatus, slugify, utcnow_iso

logger = logging.getLogger(__name__)


# ================================================================================
# Constants
# ================================================================================

DEFAULT_INTERFACE = "eth0"
DEFAULT_RING_FILE_SIZE_MB = 100
DEFAULT_RING_FILE_COUNT = 10
DEFAULT_HEADER_SNAPLEN = 96
DEFAULT_BUFFER_SIZE_KB = 2


# ================================================================================
# Exceptions
# ================================================================================

class TestExecutionError(RuntimeError):
    """Base exception for test execution errors."""
    pass


class InvalidConfigurationError(TestExecutionError):
    """Raised when profile configuration is invalid."""
    pass


# ================================================================================
# Run Executor Class
# ================================================================================

class RunExecutor:
    """Executes test runs and manages running processes."""

    def __init__(
        self,
        capture_dir: Path,
        *,
        tcpdump_bin: str = "tcpdump",
    ) -> None:
        """
        Initialize the run executor.
        
        Args:
            capture_dir: Directory for capture files
            tcpdump_bin: Path to tcpdump binary
        """
        self.capture_dir = capture_dir
        self.tcpdump_bin = tcpdump_bin
        
        self.capture_dir.mkdir(parents=True, exist_ok=True)
        
        self._lock = asyncio.Lock()
        self._runs: Dict[str, RunningTest] = {}

    # ------------------------------------------------------------------
    # Run State Management
    # ------------------------------------------------------------------

    async def is_running(self, tab_id: str) -> bool:
        """Check if a test is running for the given tab."""
        async with self._lock:
            return tab_id in self._runs

    async def get_running_tab_ids(self) -> set[str]:
        """Get set of all running tab IDs."""
        async with self._lock:
            return set(self._runs.keys())

    async def remove_run(self, tab_id: str) -> Optional[RunningTest]:
        """Remove and return running test state."""
        async with self._lock:
            return self._runs.pop(tab_id, None)

    # ------------------------------------------------------------------
    # Test Execution
    # ------------------------------------------------------------------

    async def start_test(
        self,
        tab_id: str,
        profile: dict[str, Any],
        tab_name: str,
        log_callback: Any,  # Async callable for logging
    ) -> dict[str, Any]:
        """
        Start a test run.
        
        Args:
            tab_id: Tab ID
            profile: Profile configuration
            tab_name: Tab name for metadata
            log_callback: Async function for logging (receives message and interface)
            
        Returns:
            Dict with run context information
            
        Raises:
            InvalidConfigurationError: If profile configuration is invalid
            TestExecutionError: If execution fails
        """
        async with self._lock:
            if tab_id in self._runs:
                raise TestExecutionError(f"Test läuft bereits in Tab '{tab_id}'")

        try:
            run_context = self._build_run_context(profile)
        except ValueError as exc:
            message = f"Konfiguration ungültig: {exc}"
            raise InvalidConfigurationError(message) from exc

        interface_contexts = run_context["interface_contexts"]
        warnings = run_context["warnings"]
        interfaces = run_context["interfaces"]
        ring_file_size_mb = run_context["ring_file_size_mb"]
        ring_file_count = run_context["ring_file_count"]
        bpf_filter = run_context["bpf_filter"]

        # Log warnings and start messages
        for warn in warnings:
            await log_callback(warn)

        if len(interfaces) > 1:
            await log_callback(f"Starte tcpdump auf {len(interfaces)} Interfaces: {', '.join(interfaces)}")
        
        for ctx in interface_contexts:
            await log_callback(f"[{ctx['interface']}] Starte: {ctx['command_display']}", interface=ctx['interface'])

        # Get metadata for capture tracking
        profile_id = profile.get("id")
        profile_name = profile.get("name")
        start_timestamp = utcnow_iso()
        run_id = str(uuid4())
        main_capture_id = str(uuid4())
        
        # Check if per-test metadata file generation is enabled
        profile_settings = profile.get("settings", {})
        generate_test_metadata = profile_settings.get("generateTestMetadataFile", False)
        test_metadata_file: Optional[Path] = None
        
        # Start tcpdump processes for all interfaces
        interface_processes: List[InterfaceProcess] = []
        all_pids: List[int] = []
        all_capture_ids: List[str] = []
        all_filename_bases: List[str] = []
        
        for ctx in interface_contexts:
            command = ctx["command"]
            interface = ctx["interface"]
            filename_base: Path = ctx["filename_base"]
            
            # Generate unique capture_id for each interface
            interface_capture_id = str(uuid4())
            all_capture_ids.append(interface_capture_id)
            all_filename_bases.append(str(filename_base))
            
            try:
                process = await asyncio.create_subprocess_exec(
                    *command,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                )
            except FileNotFoundError as exc:
                await self._cleanup_started_processes(interface_processes)
                message = f"tcpdump nicht gefunden: {exc}"
                await log_callback(message)
                raise TestExecutionError(message) from exc
            except (PermissionError, OSError) as exc:
                await self._cleanup_started_processes(interface_processes)
                message = f"Start fehlgeschlagen für {interface}: {exc}"
                await log_callback(message)
                raise TestExecutionError(message) from exc
            except Exception as exc:
                await self._cleanup_started_processes(interface_processes)
                message = f"Start fehlgeschlagen für {interface}: {exc}"
                await log_callback(message)
                raise TestExecutionError(message) from exc

            pid = process.pid or -1
            all_pids.append(pid)
            
            # Calculate test-specific metadata file path (based on first interface's filename)
            if generate_test_metadata and test_metadata_file is None:
                test_metadata_file = filename_base.parent / f"{filename_base.stem}_meta.csv"
            
            # Write capture metadata for this interface
            write_capture_metadata(
                self.capture_dir,
                {
                    "event": "start",
                    "utc": start_timestamp,
                    "capture_id": interface_capture_id,
                    "main_capture_id": main_capture_id,
                    "interface": interface,
                    "interfaces": interfaces,
                    "ring_file_size_mb": ring_file_size_mb,
                    "ring_file_count": ring_file_count,
                    "filename_base": str(filename_base),
                    "pid": pid,
                    "bpf_filter": bpf_filter,
                    "test_name": tab_name,
                    "profile_id": profile_id,
                    "profile_name": profile_name,
                },
                test_metadata_file=test_metadata_file,
            )

            # Note: Watcher will be created by the caller with proper exit callback
            interface_processes.append(InterfaceProcess(
                process=process,
                task=None,  # Will be set by caller
                filename_base=filename_base,
                interface=interface,
                capture_id=interface_capture_id,
                pid=pid,
            ))
            
            await log_callback(f"[{interface}] Gestartet (PID {pid}, Capture-ID: {interface_capture_id[:8]}…)", interface=interface)

        # Store running test state
        async with self._lock:
            self._runs[tab_id] = RunningTest(
                run_id=run_id,
                interfaces=interfaces,
                ring_file_size_mb=ring_file_size_mb,
                ring_file_count=ring_file_count,
                bpf_filter=bpf_filter,
                processes=interface_processes,
                test_metadata_file=test_metadata_file,
            )

        # Return context for caller to create Run object
        return {
            "run_id": run_id,
            "start_timestamp": start_timestamp,
            "commands": [ctx["command_display"] for ctx in interface_contexts],
            "filenames_bases": all_filename_bases,
            "capture_ids": all_capture_ids,
            "main_capture_id": main_capture_id,
            "pids": all_pids,
            "interfaces": interfaces,
            "ring_file_size_mb": ring_file_size_mb,
            "ring_file_count": ring_file_count,
            "bpf_filter": bpf_filter,
            "interface_processes": interface_processes,
        }

    async def _cleanup_started_processes(self, interface_processes: List[InterfaceProcess]) -> None:
        """Kill already started processes on error."""
        for iproc in interface_processes:
            try:
                iproc.process.kill()
            except (ProcessLookupError, PermissionError):
                pass

    async def stop_test(
        self,
        tab_id: str,
        log_callback: Any,  # Async callable for logging
    ) -> dict[str, Any]:
        """
        Stop a running test.
        
        Args:
            tab_id: Tab ID
            log_callback: Async function for logging
            
        Returns:
            Dict with stop information (run_id, exit_codes, test_metadata_file)
        """
        async with self._lock:
            state = self._runs.get(tab_id)
            if not state:
                return {"stopped": False}
            
            # Remove from _runs immediately to prevent re-entry
            self._runs.pop(tab_id, None)
            
            interfaces = state.interfaces
            processes = state.processes
            run_id = state.run_id
            test_metadata_file = state.test_metadata_file
        
        # Cancel all watcher tasks first
        for iproc in processes:
            if iproc.task and not iproc.task.done():
                iproc.task.cancel()
        
        # Wait for tasks to be cancelled
        for iproc in processes:
            if iproc.task:
                try:
                    await asyncio.wait_for(asyncio.shield(iproc.task), timeout=1)
                except (asyncio.CancelledError, asyncio.TimeoutError):
                    pass
                except Exception as e:
                    logger.warning("Fehler beim Warten auf Task-Cancellation: %s", e)
        
        # Log stop message
        if len(interfaces) > 1:
            await log_callback(f"Stoppsignal an {len(processes)} tcpdump-Prozesse senden…")
        else:
            await log_callback("Stoppsignal an tcpdump senden…")
        
        # Terminate all processes safely
        for iproc in processes:
            await terminate_process_safely(iproc.process, log_callback, iproc.interface)
        
        # Write stop metadata for all processes
        for iproc in processes:
            meta: dict[str, Any] = {
                "event": "stop",
                "utc": utcnow_iso(),
                "pid": iproc.pid,
                "capture_id": iproc.capture_id,
                "interface": iproc.interface,
            }
            write_capture_metadata(self.capture_dir, meta, test_metadata_file=test_metadata_file)
        
        exit_codes = [iproc.process.returncode for iproc in processes]
        exit_codes_display = format_exit_codes(exit_codes)
        await log_callback(f"Testlauf {run_id} gestoppt (Exit-Codes: [{exit_codes_display}]).")
        
        return {
            "stopped": True,
            "run_id": run_id,
            "exit_codes": exit_codes,
            "test_metadata_file": test_metadata_file,
        }

    async def abort_all(self, log_callback: Any) -> None:
        """
        Abort all running tests.
        
        Args:
            log_callback: Async function for logging
        """
        async with self._lock:
            running = list(self._runs.items())
            self._runs.clear()
        
        # Cancel all watcher tasks
        for tab_id, state in running:
            if isinstance(state, RunningTest):
                for iproc in state.processes:
                    if iproc.task and not iproc.task.done():
                        iproc.task.cancel()
        
        await asyncio.sleep(0.1)
        
        # Terminate all processes
        for tab_id, state in running:
            if isinstance(state, RunningTest):
                for iproc in state.processes:
                    try:
                        iproc.process.terminate()
                    except (ProcessLookupError, PermissionError):
                        pass
                
                # Write stop metadata
                for iproc in state.processes:
                    meta: dict[str, Any] = {
                        "event": "stop",
                        "utc": utcnow_iso(),
                        "pid": iproc.pid,
                        "capture_id": iproc.capture_id,
                        "interface": iproc.interface,
                    }
                    write_capture_metadata(
                        self.capture_dir, 
                        meta, 
                        test_metadata_file=state.test_metadata_file
                    )

    async def check_all_processes_done(self, tab_id: str) -> tuple[bool, List[Optional[int]]]:
        """
        Check if all processes for a tab are done.
        
        Args:
            tab_id: Tab ID
            
        Returns:
            Tuple of (all_done, exit_codes)
        """
        async with self._lock:
            state = self._runs.get(tab_id)
            if not state or not isinstance(state, RunningTest):
                return False, []
            
            all_done = all(iproc.process.returncode is not None for iproc in state.processes)
            exit_codes = [iproc.process.returncode for iproc in state.processes]
            
            return all_done, exit_codes

    async def get_test_metadata_file(self, tab_id: str) -> Optional[Path]:
        """Get test metadata file path for a running test."""
        async with self._lock:
            state = self._runs.get(tab_id)
            if not state or not isinstance(state, RunningTest):
                return None
            return state.test_metadata_file

    async def set_watcher_task(self, tab_id: str, interface: str, task: asyncio.Task) -> None:
        """Set watcher task for an interface process."""
        async with self._lock:
            state = self._runs.get(tab_id)
            if not state or not isinstance(state, RunningTest):
                return
            for iproc in state.processes:
                if iproc.interface == interface:
                    iproc.task = task
                    break

    # ------------------------------------------------------------------
    # Build and Validation
    # ------------------------------------------------------------------

    def _build_run_context(self, profile: dict[str, Any]) -> dict[str, Any]:
        """Build context for test run execution from profile settings."""
        settings = profile.get("settings")
        if not isinstance(settings, dict):
            settings = {}

        warnings: list[str] = []
        
        # Gather capture parameters
        interfaces = self._select_interfaces(settings, warnings)
        ring_file_size_mb = self._calculate_ring_file_size_mb(settings, warnings)
        ring_file_count = self._coerce_positive_int(
            settings.get("ringFileCount"),
            default=DEFAULT_RING_FILE_COUNT,
            minimum=1,
            field="Ring-Dateianzahl",
            warnings=warnings,
        )
        snap_length = self._determine_snap_length(settings, warnings)
        bpf_filter = build_bpf_filter(settings)
        
        # Validate BPF filter syntax if provided
        if bpf_filter:
            if not validate_bpf_filter(bpf_filter):
                warnings.append(f"BPF-Filter könnte ungültig sein: '{bpf_filter}'")
                logger.warning("Potenziell ungültiger BPF-Filter: %s", bpf_filter)

        # Build tcpdump commands for each interface
        profile_name = str(profile.get("name") or "").strip() or "capture"
        filename_prefix = settings.get("filenamePrefix") or slugify(profile_name)
        timestamp = utcnow_iso()
        
        interface_contexts = self._build_interface_commands(
            interfaces=interfaces,
            settings=settings,
            filename_prefix=filename_prefix,
            timestamp=timestamp,
            snap_length=snap_length,
            ring_file_size_mb=ring_file_size_mb,
            ring_file_count=ring_file_count,
            bpf_filter=bpf_filter,
        )

        return {
            "interface_contexts": interface_contexts,
            "warnings": warnings,
            "interfaces": interfaces,
            "ring_file_size_mb": ring_file_size_mb,
            "ring_file_count": ring_file_count,
            "bpf_filter": bpf_filter,
        }
    
    def _determine_snap_length(self, settings: dict[str, Any], warnings: list[str]) -> int:
        """Determine packet snapshot length from settings."""
        if settings.get("headerOnly"):
            return self._coerce_positive_int(
                settings.get("headerSnaplen"),
                default=DEFAULT_HEADER_SNAPLEN,
                minimum=64,
                field="Header-Snaplen",
                warnings=warnings,
            )
        elif settings.get("snapLength"):
            return int(settings.get("snapLength", 0))
        return 0  # 0 means full packet
    
    def _build_interface_commands(
        self,
        interfaces: List[str],
        settings: dict[str, Any],
        filename_prefix: str,
        timestamp: str,
        snap_length: int,
        ring_file_size_mb: int,
        ring_file_count: int,
        bpf_filter: str,
    ) -> list[dict[str, Any]]:
        """Build tcpdump command for each interface."""
        interface_contexts: list[dict[str, Any]] = []
        
        for interface in interfaces:
            filename_base = self.capture_dir / f"{filename_prefix}_{interface}_{timestamp}.pcap"
            command = self._build_tcpdump_command(
                interface=interface,
                settings=settings,
                filename_base=filename_base,
                snap_length=snap_length,
                ring_file_size_mb=ring_file_size_mb,
                ring_file_count=ring_file_count,
                bpf_filter=bpf_filter,
            )
            
            interface_contexts.append({
                "command": command,
                "command_display": shlex.join([str(part) for part in command]),
                "interface": interface,
                "filename_base": filename_base,
            })
        
        return interface_contexts
    
    def _build_tcpdump_command(
        self,
        interface: str,
        settings: dict[str, Any],
        filename_base: Path,
        snap_length: int,
        ring_file_size_mb: int,
        ring_file_count: int,
        bpf_filter: str,
    ) -> list[str]:
        """Build complete tcpdump command with all flags."""
        command: list[str] = [self.tcpdump_bin, "-i", interface, "-nn"]
        
        # Print link-level header (Ethernet header)
        if settings.get("printLinkLevelHeader"):
            command.append("-e")
        
        # Snapshot length
        if snap_length > 0:
            command.extend(["-s", str(snap_length)])
        else:
            command.extend(["-s", "0"])  # Full packet
        
        # Buffer size in KiB
        buffer_size = settings.get("bufferSize", DEFAULT_BUFFER_SIZE_KB)
        if buffer_size and buffer_size != DEFAULT_BUFFER_SIZE_KB:
            command.extend(["-B", str(int(buffer_size) * 1024)])
        
        # Timestamp precision
        if settings.get("timestampPrecision") == "nano":
            command.append("--time-stamp-precision=nano")
        
        # Immediate mode
        if settings.get("immediateMode"):
            command.append("--immediate-mode")
        
        # Promiscuous mode (disabled with -p flag)
        if not settings.get("promiscuousMode", True):
            command.append("-p")
        
        # Direction filter
        if settings.get("filterDirection"):
            command.extend(["-Q", settings.get("filterDirection")])
        
        # Ring buffer settings
        command.extend(["-w", str(filename_base), "-C", str(ring_file_size_mb), "-W", str(ring_file_count)])
        
        # Packet count limit
        if settings.get("stopPacketCount"):
            command.extend(["-c", str(settings.get("stopPacketCount"))])
        
        # BPF filter (must be at the end)
        if bpf_filter:
            command.extend(shlex.split(bpf_filter))
        
        return command

    def _select_interfaces(self, settings: dict[str, Any], warnings: list[str]) -> list[str]:
        """Select all configured interfaces (multi-interface support) with validation."""
        interfaces = settings.get("interfaces")
        if isinstance(interfaces, list) and len(interfaces) > 0:
            selected = []
            for i in interfaces:
                if isinstance(i, str) and i.strip():
                    iface = i.strip()
                    if validate_interface_name(iface):
                        selected.append(iface)
                    else:
                        warnings.append(f"Ungültiger Interface-Name '{iface}' ignoriert.")
                        logger.warning("Ungültiger Interface-Name: %s", iface)
            if selected:
                return selected

        # Fallback: check for single interface setting
        manual_iface = settings.get("interface")
        if isinstance(manual_iface, str) and manual_iface.strip():
            iface = manual_iface.strip()
            if validate_interface_name(iface):
                return [iface]
            else:
                warnings.append(f"Ungültiger Interface-Name '{iface}', verwende {DEFAULT_INTERFACE}.")
                logger.warning("Ungültiger Interface-Name: %s", iface)

        # Default
        warnings.append(f"Kein Interface angegeben, verwende {DEFAULT_INTERFACE}.")
        return [DEFAULT_INTERFACE]

    def _coerce_positive_int(
        self,
        value: Any,
        *,
        default: int,
        minimum: int,
        field: str,
        warnings: list[str],
    ) -> int:
        """Coerce value to positive integer with validation."""
        try:
            ivalue = int(value)
        except (TypeError, ValueError):
            warnings.append(f"{field} ungültig, verwende {default}.")
            return default
        if ivalue < minimum:
            warnings.append(f"{field} zu klein ({ivalue}), verwende {default}.")
            return default
        return ivalue

    def _calculate_ring_file_size_mb(
        self,
        settings: dict[str, Any],
        warnings: list[str],
    ) -> int:
        """Calculate ring file size in MB from new schema (value + unit) or legacy schema."""
        size_value = settings.get("ringFileSizeValue")
        size_unit = settings.get("ringFileSizeUnit", "megabytes")
        
        if size_value is not None:
            try:
                value = float(size_value)
                if value <= 0:
                    warnings.append(f"Ringpuffergröße muss positiv sein, verwende {DEFAULT_RING_FILE_SIZE_MB} MB.")
                    return DEFAULT_RING_FILE_SIZE_MB
                
                unit_multipliers = {
                    "bytes": 1 / (1024 * 1024),
                    "kilobytes": 1 / 1024,
                    "megabytes": 1,
                    "gigabytes": 1024,
                }
                multiplier = unit_multipliers.get(size_unit, 1)
                result_mb = value * multiplier
                
                return max(1, round(result_mb))
            except (TypeError, ValueError):
                warnings.append(f"Ringpuffergröße ungültig, verwende {DEFAULT_RING_FILE_SIZE_MB} MB.")
                return DEFAULT_RING_FILE_SIZE_MB
        
        # Legacy fallback
        legacy_mb = settings.get("ringFileSizeMB")
        if legacy_mb is not None:
            return self._coerce_positive_int(
                legacy_mb,
                default=DEFAULT_RING_FILE_SIZE_MB,
                minimum=1,
                field="Ringpuffergröße",
                warnings=warnings,
            )
        
        return DEFAULT_RING_FILE_SIZE_MB

    def convert_duration_to_seconds(self, value: int, unit: str) -> int:
        """Convert duration value to seconds based on unit."""
        unit_lower = unit.lower()
        if unit_lower == "seconds":
            return value
        elif unit_lower == "minutes":
            return value * 60
        elif unit_lower == "hours":
            return value * 3600
        else:
            return value
