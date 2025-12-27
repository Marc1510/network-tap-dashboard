"""
Test execution manager - orchestrates test tabs, runs, and process execution.

This module has been refactored into smaller, focused modules:
- tab_models.py: Data models (Tab, Run, LogEntry)
- tab_manager.py: Tab CRUD operations  
- run_executor.py: Test execution and process management
- process_manager.py: Process lifecycle management
- filter_builder.py: BPF filter generation and validation
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from services.agent.capture_manager import write_capture_metadata
from services.agent.run_executor import (
    InvalidConfigurationError,
    RunExecutor,
    TestExecutionError,
)
from services.agent.tab_manager import (
    TabManager,
    TabNotFoundError,
    TestAlreadyRunningError,
)
from services.agent.tab_models import Run, TabStatus, utcnow_iso
from services.agent.process_manager import (
    format_exit_codes,
    watch_interface_process,
)

logger = logging.getLogger(__name__)

# Re-export exceptions for backwards compatibility
__all__ = [
    "TestExecutionManager",
    "TestExecutionError",
    "InvalidConfigurationError",
    "TestAlreadyRunningError",
    "TabNotFoundError",
]


class TestExecutionManager:
    """Orchestrates test tabs, executes runs and streams log events to listeners."""

    def __init__(
        self,
        runtime_dir: Path,
        capture_dir: Path,
        *,
        tcpdump_bin: str = "tcpdump",
        max_log_entries: int = 500,
    ) -> None:
        """
        Initialize the test execution manager.
        
        Args:
            runtime_dir: Directory for runtime state files
            capture_dir: Directory for capture files
            tcpdump_bin: Path to tcpdump binary
            max_log_entries: Maximum number of log entries per tab
        """
        self.runtime_dir = runtime_dir
        self.capture_dir = capture_dir
        self.tcpdump_bin = tcpdump_bin
        self.max_log_entries = max_log_entries

        # Initialize sub-managers
        self.tab_manager = TabManager(
            runtime_dir=runtime_dir,
            max_log_entries=max_log_entries,
        )
        self.run_executor = RunExecutor(
            capture_dir=capture_dir,
            tcpdump_bin=tcpdump_bin,
        )

        # Event broadcasting
        self._lock = asyncio.Lock()
        self._listeners: set[asyncio.Queue[dict[str, Any]]] = set()

    # ------------------------------------------------------------------
    # Listener management
    # ------------------------------------------------------------------

    async def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        """Subscribe to test execution events."""
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=1000)
        async with self._lock:
            self._listeners.add(queue)
        return queue

    async def unsubscribe(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        """Unsubscribe from test execution events."""
        async with self._lock:
            self._listeners.discard(queue)

    async def _broadcast(self, event: dict[str, Any]) -> None:
        """Broadcast event to all listeners."""
        async with self._lock:
            listeners = list(self._listeners)
        for queue in listeners:
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                pass  # Drop events for slow consumers

    async def notify_shutdown(self) -> None:
        """Notify all listener queues about server shutdown."""
        async with self._lock:
            listeners = list(self._listeners)
        for queue in listeners:
            with contextlib.suppress(Exception):
                queue.put_nowait({"type": "server_shutdown"})

    # ------------------------------------------------------------------
    # Tab CRUD (delegated to TabManager)
    # ------------------------------------------------------------------

    async def list_tabs(self) -> List[dict[str, Any]]:
        """Get list of all tabs."""
        return await self.tab_manager.list_tabs()

    async def get_tab(self, tab_id: str) -> dict[str, Any]:
        """Get a specific tab by ID."""
        return await self.tab_manager.get_tab(tab_id)

    async def create_tab(
        self, 
        *, 
        title: Optional[str] = None, 
        profile_id: Optional[str] = None
    ) -> dict[str, Any]:
        """Create a new tab."""
        tab_data = await self.tab_manager.create_tab(title=title, profile_id=profile_id)
        await self._broadcast({"type": "tab_created", "tab": tab_data})
        return tab_data

    async def update_tab(
        self, 
        tab_id: str, 
        *, 
        title: Optional[str] = None, 
        profile_id: Optional[str] = None
    ) -> dict[str, Any]:
        """Update an existing tab."""
        tab_data = await self.tab_manager.update_tab(tab_id, title=title, profile_id=profile_id)
        await self._broadcast({"type": "tab_updated", "tab": tab_data})
        return tab_data

    async def delete_tab(self, tab_id: str) -> None:
        """Delete a tab."""
        running_tabs = await self.run_executor.get_running_tab_ids()
        await self.tab_manager.delete_tab(tab_id, running_tabs)
        await self._broadcast({"type": "tab_deleted", "tabId": tab_id})

    # ------------------------------------------------------------------
    # Log handling (delegated to TabManager)
    # ------------------------------------------------------------------

    async def get_logs(self, tab_id: str, *, after: Optional[int] = None) -> dict[str, Any]:
        """Get logs for a tab."""
        return await self.tab_manager.get_logs(tab_id, after=after)

    async def _append_log(
        self, 
        tab_id: str, 
        message: str, 
        interface: str | None = None
    ) -> Optional[dict[str, Any]]:
        """Append a log entry to a tab."""
        entry_dict = await self.tab_manager.append_log(tab_id, message, interface)
        if entry_dict:
            await self._broadcast({"type": "log_entry", "tabId": tab_id, "entry": entry_dict})
            tab_snapshot = await self.tab_manager.get_tab_snapshot(tab_id)
            if tab_snapshot:
                await self._broadcast({"type": "tab_updated", "tab": tab_snapshot})
        return entry_dict

    # ------------------------------------------------------------------
    # Test execution (orchestrated with RunExecutor)
    # ------------------------------------------------------------------

    async def start_test(self, tab_id: str, profile: dict[str, Any]) -> dict[str, Any]:
        """Start a test run."""
        # Update tab to STARTING status
        tab = await self.tab_manager.get_tab_object(tab_id)
        if not tab:
            raise TabNotFoundError(f"Tab '{tab_id}' nicht gefunden")
        
        if await self.run_executor.is_running(tab_id):
            raise TestAlreadyRunningError(f"Test läuft bereits in Tab '{tab_id}'")

        # Update tab status to STARTING
        tab_snapshot = await self.tab_manager.update_tab_status(
            tab_id,
            TabStatus.STARTING.value,
            run=Run(
                id="",  # Will be set later
                profile_id=profile.get("id"),
                started_utc=utcnow_iso(),
            ),
            save=True,
        )
        if tab_snapshot:
            await self._broadcast({"type": "tab_updated", "tab": tab_snapshot})

        # Create log callback wrapper for this tab
        async def log_callback(message: str, interface: str | None = None) -> None:
            await self._append_log(tab_id, message, interface)
        
        # Start test execution
        try:
            run_context = await self.run_executor.start_test(
                tab_id=tab_id,
                profile=profile,
                tab_name=tab.title or "Test",
                log_callback=log_callback,
            )
        except (InvalidConfigurationError, TestExecutionError) as exc:
            # Mark as failed
            await self._mark_run_failed(tab_id, "", str(exc))
            raise

        # Create watchers for all interface processes
        interface_processes = run_context["interface_processes"]
        for iproc in interface_processes:
            watcher = asyncio.create_task(
                self._watch_and_handle_exit(
                    tab_id=tab_id,
                    run_id=run_context["run_id"],
                    iproc=iproc,
                )
            )
            await self.run_executor.set_watcher_task(tab_id, iproc.interface, watcher)

        # Update tab with full run information
        run = Run(
            id=run_context["run_id"],
            profile_id=profile.get("id"),
            started_utc=run_context["start_timestamp"],
            commands=run_context["commands"],
            filenames_bases=run_context["filenames_bases"],
            capture_ids=run_context["capture_ids"],
            main_capture_id=run_context["main_capture_id"],
            pids=run_context["pids"],
            interfaces=run_context["interfaces"],
            ring_file_size_mb=run_context["ring_file_size_mb"],
            ring_file_count=run_context["ring_file_count"],
            bpf_filter=run_context["bpf_filter"],
            # Legacy fields
            command=run_context["commands"][0] if run_context["commands"] else "",
            filename_base=run_context["filenames_bases"][0] if run_context["filenames_bases"] else "",
            capture_id=run_context["capture_ids"][0] if run_context["capture_ids"] else "",
            pid=run_context["pids"][0] if run_context["pids"] else -1,
            interface=run_context["interfaces"][0] if run_context["interfaces"] else "",
        )

        tab_snapshot = await self.tab_manager.update_tab_status(
            tab_id,
            TabStatus.RUNNING.value,
            run=run,
            save=True,
        )
        if tab_snapshot:
            await self._broadcast({"type": "tab_updated", "tab": tab_snapshot})

        pids_display = ", ".join(str(p) for p in run_context["pids"])
        await self._append_log(
            tab_id,
            f"Testlauf {run_context['run_id']} gestartet "
            f"({len(run_context['interfaces'])} Interface(s), PIDs: {pids_display})."
        )

        # Start duration timer if configured
        settings = profile.get("settings", {})
        stop_condition = settings.get("stopCondition", "manual")
        if stop_condition == "duration":
            duration_value = settings.get("stopDurationValue", 60)
            duration_unit = settings.get("stopDurationUnit", "seconds")
            duration_seconds = self.run_executor.convert_duration_to_seconds(duration_value, duration_unit)
            
            await self._append_log(
                tab_id,
                f"Automatischer Stop nach {duration_value} {duration_unit} ({duration_seconds}s)."
            )
            asyncio.create_task(
                self._auto_stop_after_duration(tab_id, run_context["run_id"], duration_seconds)
            )

        return tab_snapshot or {}

    async def _watch_and_handle_exit(
        self,
        tab_id: str,
        run_id: str,
        iproc: Any,  # InterfaceProcess
    ) -> None:
        """Watch an interface process and handle its exit."""
        # Create log callback wrapper
        async def log_callback(message: str, interface: str | None = None) -> None:
            await self._append_log(tab_id, message, interface)
        
        async def exit_handler(returncode: Optional[int], error: Optional[str] = None) -> None:
            await self._handle_interface_process_exit(
                tab_id=tab_id,
                run_id=run_id,
                interface=iproc.interface,
                capture_id=iproc.capture_id,
                pid=iproc.pid,
                returncode=returncode,
                error=error,
            )

        await watch_interface_process(
            process=iproc.process,
            interface=iproc.interface,
            capture_id=iproc.capture_id,
            log_callback=log_callback,
            exit_callback=exit_handler,
        )

    async def _handle_interface_process_exit(
        self,
        tab_id: str,
        run_id: str,
        interface: str,
        capture_id: str,
        pid: int,
        returncode: Optional[int],
        *,
        error: Optional[str] = None,
    ) -> None:
        """Handle exit of a single interface's tcpdump process."""
        # Write stop metadata
        test_metadata_file = await self.run_executor.get_test_metadata_file(tab_id)
        meta: dict[str, Any] = {
            "event": "stop",
            "utc": utcnow_iso(),
            "pid": pid,
            "capture_id": capture_id,
            "interface": interface,
        }
        write_capture_metadata(self.capture_dir, meta, test_metadata_file=test_metadata_file)
        
        await self._append_log(
            tab_id,
            f"[{interface}] tcpdump beendet (Exit-Code: {returncode if returncode is not None else '—'})",
            interface=interface
        )
        
        # Check if all interface processes have finished
        all_done, exit_codes = await self.run_executor.check_all_processes_done(tab_id)
        
        if all_done:
            # Update tab with completion status
            tab = await self.tab_manager.get_tab_object(tab_id)
            if not tab or not tab.run or tab.run.id != run_id:
                return
            if tab.run.finished_utc:
                return
            
            # Update run completion
            tab.run.finished_utc = utcnow_iso()
            tab.run.exit_codes = exit_codes
            tab.run.exit_code = exit_codes[0] if exit_codes else None
            tab.run.error = error
            
            # Determine status
            if error:
                tab.status = TabStatus.FAILED.value
            elif any(code and code != 0 for code in exit_codes):
                tab.status = TabStatus.FAILED.value
            else:
                tab.status = TabStatus.COMPLETED.value
            
            # Remove from running tests
            await self.run_executor.remove_run(tab_id)
            
            # Save and broadcast
            await self.tab_manager.save_state()
            tab_snapshot = tab.to_dict()
            await self._broadcast({"type": "tab_updated", "tab": tab_snapshot})
            
            exit_codes_display = format_exit_codes(exit_codes)
            await self._append_log(
                tab_id,
                f"Testlauf {run_id} beendet (Status: {tab.status}, Exit-Codes: [{exit_codes_display}])."
            )

    async def stop_test(self, tab_id: str) -> dict[str, Any]:
        """Stop a running test."""
        # Create log callback wrapper
        async def log_callback(message: str, interface: str | None = None) -> None:
            await self._append_log(tab_id, message, interface)
        
        stop_result = await self.run_executor.stop_test(tab_id, log_callback=log_callback)
        
        if not stop_result.get("stopped"):
            tab = await self.tab_manager.get_tab_object(tab_id)
            if tab:
                return tab.to_dict()
            raise TabNotFoundError(f"Tab '{tab_id}' nicht gefunden")
        
        # Update tab state
        tab = await self.tab_manager.get_tab_object(tab_id)
        if not tab:
            raise TabNotFoundError(f"Tab '{tab_id}' nicht gefunden")
        
        run = tab.run
        if run and not run.finished_utc:
            exit_codes = stop_result.get("exit_codes", [])
            run.finished_utc = utcnow_iso()
            run.exit_codes = exit_codes
            run.exit_code = exit_codes[0] if exit_codes else None
            
            # Determine status
            if any(code and code != 0 for code in exit_codes):
                tab.status = TabStatus.FAILED.value
            else:
                tab.status = TabStatus.COMPLETED.value
            
            await self.tab_manager.save_state()
        
        tab_snapshot = tab.to_dict()
        await self._broadcast({"type": "tab_updated", "tab": tab_snapshot})
        
        return tab_snapshot

    async def abort_all(self) -> None:
        """Abort all running tests."""
        await self.run_executor.abort_all(log_callback=self._append_log)

    async def _mark_run_failed(self, tab_id: str, run_id: str, message: str) -> None:
        """Mark a run as failed."""
        await self._append_log(tab_id, message)
        
        tab = await self.tab_manager.get_tab_object(tab_id)
        if not tab:
            return
        
        run = tab.run
        if not run or (run_id and run.id != run_id):
            return
        
        await self.run_executor.remove_run(tab_id)
        
        run.finished_utc = utcnow_iso()
        run.exit_codes = [None]
        run.exit_code = None
        run.error = message
        tab.status = TabStatus.FAILED.value
        
        await self.tab_manager.save_state()
        tab_snapshot = tab.to_dict()
        await self._broadcast({"type": "tab_updated", "tab": tab_snapshot})

    async def _auto_stop_after_duration(
        self, 
        tab_id: str, 
        run_id: str, 
        duration_seconds: int
    ) -> None:
        """Automatically stop test after specified duration."""
        try:
            await asyncio.sleep(duration_seconds)
            
            # Check if test is still running with same run_id
            tab = await self.tab_manager.get_tab_object(tab_id)
            if not tab:
                return
            run = tab.run
            if not run or run.id != run_id:
                return
            if run.finished_utc:
                return
            if not await self.run_executor.is_running(tab_id):
                return
            
            # Still running → stop it
            await self._append_log(
                tab_id,
                f"Duration-Timer abgelaufen ({duration_seconds}s) - stoppe Test automatisch."
            )
            await self.stop_test(tab_id)
            
        except asyncio.CancelledError:
            pass
