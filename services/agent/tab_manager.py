"""Tab management operations (CRUD, logging, state persistence)."""

from __future__ import annotations

import asyncio
import json
import logging
from collections import deque
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

from services.agent.tab_models import LogEntry, Tab, TabStatus, utcnow_iso

logger = logging.getLogger(__name__)


# ================================================================================
# Exceptions
# ================================================================================

class TabNotFoundError(KeyError):
    """Raised when a tab with the specified ID doesn't exist."""
    pass


class TestAlreadyRunningError(RuntimeError):
    """Raised when attempting to start a test that's already running."""
    pass


# ================================================================================
# Tab Manager Class
# ================================================================================

class TabManager:
    """Manages test tabs, logs, and persistence."""

    def __init__(
        self,
        runtime_dir: Path,
        *,
        max_log_entries: int = 500,
    ) -> None:
        """
        Initialize the tab manager.
        
        Args:
            runtime_dir: Directory for storing state files
            max_log_entries: Maximum number of log entries per tab
        """
        self.runtime_dir = runtime_dir
        self.max_log_entries = max_log_entries
        
        self.runtime_dir.mkdir(parents=True, exist_ok=True)
        self._tabs_file = self.runtime_dir / "tabs.json"
        
        self._lock = asyncio.Lock()
        self._tabs: Dict[str, Tab] = {}
        
        self._load_state()

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------
    
    def _load_state(self) -> None:
        """Load tabs from persistent storage."""
        if not self._tabs_file.exists():
            return
        try:
            with self._tabs_file.open("r", encoding="utf-8") as f:
                raw = json.load(f)
        except (OSError, IOError) as e:
            logger.warning("Konnte State-Datei nicht laden: %s", e)
            return
        except json.JSONDecodeError as e:
            logger.warning("State-Datei ist beschädigt: %s", e)
            return
        except Exception as e:
            logger.error("Unerwarteter Fehler beim Laden: %s", e, exc_info=True)
            return

        tabs = raw.get("tabs") if isinstance(raw, dict) else None
        if not isinstance(tabs, list):
            return

        for tab_data in tabs:
            if not isinstance(tab_data, dict):
                continue
            tab_id = str(tab_data.get("id") or "").strip()
            if not tab_id:
                continue
            
            try:
                tab = Tab.from_dict(tab_data, max_log_entries=self.max_log_entries)
                # Clean up statuses that cannot be resumed after restart
                if tab.status in {TabStatus.RUNNING.value, TabStatus.STARTING.value}:
                    tab.status = TabStatus.IDLE.value
                    tab.run = None
                self._tabs[tab_id] = tab
            except (KeyError, ValueError, TypeError) as e:
                logger.warning("Tab '%s' konnte nicht geladen werden: %s", tab_id, e)
                continue
            except Exception as e:
                logger.error("Unerwarteter Fehler beim Laden von Tab '%s': %s", tab_id, e, exc_info=True)
                continue

    async def save_state(self) -> None:
        """Save tabs to persistent storage (async, requires lock)."""
        async with self._lock:
            await self._save_state_locked()

    async def _save_state_locked(self) -> None:
        """Save state (must be called with lock held)."""
        tabs_data = [tab.to_dict() for tab in self._tabs.values()]
        data = {"tabs": tabs_data}
        tmp = self._tabs_file.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        tmp.replace(self._tabs_file)

    # ------------------------------------------------------------------
    # Tab CRUD Operations
    # ------------------------------------------------------------------

    async def list_tabs(self) -> List[dict[str, Any]]:
        """Get list of all tabs."""
        async with self._lock:
            return [tab.to_dict() for tab in self._tabs.values()]

    async def get_tab(self, tab_id: str) -> dict[str, Any]:
        """
        Get a specific tab by ID.
        
        Args:
            tab_id: Tab ID
            
        Returns:
            Tab data as dict
            
        Raises:
            TabNotFoundError: If tab doesn't exist
        """
        async with self._lock:
            tab = self._tabs.get(tab_id)
            if not tab:
                raise TabNotFoundError(f"Tab '{tab_id}' nicht gefunden")
            return tab.to_dict()

    async def create_tab(
        self, 
        *, 
        title: Optional[str] = None, 
        profile_id: Optional[str] = None
    ) -> dict[str, Any]:
        """
        Create a new tab.
        
        Args:
            title: Tab title (optional)
            profile_id: Associated profile ID (optional)
            
        Returns:
            Created tab data as dict
        """
        tab_id = uuid4().hex
        now = utcnow_iso()
        tab = Tab(
            id=tab_id,
            title=(title or "").strip() or "Neuer Test",
            profile_id=profile_id,
            status=TabStatus.IDLE.value,
            created_utc=now,
            updated_utc=now,
            logs=deque(maxlen=self.max_log_entries),
        )
        async with self._lock:
            self._tabs[tab_id] = tab
            await self._save_state_locked()
        return tab.to_dict()

    async def update_tab(
        self, 
        tab_id: str, 
        *, 
        title: Optional[str] = None, 
        profile_id: Optional[str] = None
    ) -> dict[str, Any]:
        """
        Update an existing tab.
        
        Args:
            tab_id: Tab ID
            title: New title (optional)
            profile_id: New profile ID (optional)
            
        Returns:
            Updated tab data as dict
            
        Raises:
            TabNotFoundError: If tab doesn't exist
        """
        async with self._lock:
            tab = self._tabs.get(tab_id)
            if not tab:
                raise TabNotFoundError(f"Tab '{tab_id}' nicht gefunden")
            if title is not None:
                tab.title = title.strip() or "Neuer Test"
            if profile_id is not None:
                tab.profile_id = profile_id
            tab.updated_utc = utcnow_iso()
            await self._save_state_locked()
            data = tab.to_dict()
        return data

    async def delete_tab(self, tab_id: str, running_tab_ids: set[str]) -> None:
        """
        Delete a tab.
        
        Args:
            tab_id: Tab ID
            running_tab_ids: Set of currently running tab IDs (for validation)
            
        Raises:
            TestAlreadyRunningError: If test is still running
            TabNotFoundError: If tab doesn't exist
        """
        async with self._lock:
            if tab_id in running_tab_ids:
                raise TestAlreadyRunningError(f"Test läuft noch in Tab '{tab_id}', zuerst stoppen")
            tab = self._tabs.pop(tab_id, None)
            if tab is None:
                raise TabNotFoundError(f"Tab '{tab_id}' nicht gefunden")
            await self._save_state_locked()

    # ------------------------------------------------------------------
    # Tab State Access and Modification
    # ------------------------------------------------------------------

    async def get_tab_object(self, tab_id: str) -> Optional[Tab]:
        """
        Get tab object (for internal use, requires lock).
        
        Args:
            tab_id: Tab ID
            
        Returns:
            Tab object or None if not found
        """
        async with self._lock:
            return self._tabs.get(tab_id)

    async def update_tab_status(
        self,
        tab_id: str,
        status: str,
        run: Any = None,
        save: bool = True,
    ) -> Optional[dict[str, Any]]:
        """
        Update tab status and optionally run information.
        
        Args:
            tab_id: Tab ID
            status: New status
            run: Run object (optional)
            save: Whether to save state
            
        Returns:
            Updated tab data as dict or None if not found
        """
        async with self._lock:
            tab = self._tabs.get(tab_id)
            if not tab:
                return None
            tab.status = status
            if run is not None:
                tab.run = run
            tab.updated_utc = utcnow_iso()
            if save:
                await self._save_state_locked()
            return tab.to_dict()

    # ------------------------------------------------------------------
    # Log Operations
    # ------------------------------------------------------------------

    async def get_logs(self, tab_id: str, *, after: Optional[int] = None) -> dict[str, Any]:
        """
        Get logs for a tab, optionally filtered by sequence number.
        
        Args:
            tab_id: Tab ID
            after: Only return logs with seq > after (optional)
            
        Returns:
            Dict with logs and metadata
            
        Raises:
            TabNotFoundError: If tab doesn't exist
        """
        async with self._lock:
            tab = self._tabs.get(tab_id)
            if not tab:
                raise TabNotFoundError(f"Tab '{tab_id}' nicht gefunden")
            logs = list(tab.logs)
            if after is not None:
                logs = [entry for entry in logs if entry.seq > after]
            return {
                "tabId": tab_id,
                "entries": [log.to_dict() for log in logs],
                "lastSeq": tab.log_seq,
            }

    async def append_log(
        self, 
        tab_id: str, 
        message: str, 
        interface: str | None = None
    ) -> Optional[dict[str, Any]]:
        """
        Append a log entry to a tab.
        
        Args:
            tab_id: Tab ID
            message: Log message
            interface: Interface name (optional, for multi-interface logging)
            
        Returns:
            Log entry as dict or None if tab not found
        """
        async with self._lock:
            tab = self._tabs.get(tab_id)
            if not tab:
                return None
            seq = tab.log_seq + 1
            tab.log_seq = seq
            entry = LogEntry(
                seq=seq,
                timestamp=utcnow_iso(),
                message=message,
                tab_id=tab_id,
                interface=interface,
            )
            tab.logs.append(entry)
            tab.last_message = message
            tab.updated_utc = utcnow_iso()
            await self._save_state_locked()
            return entry.to_dict()

    async def get_tab_snapshot(self, tab_id: str) -> Optional[dict[str, Any]]:
        """
        Get a snapshot of tab state (for broadcasting).
        
        Args:
            tab_id: Tab ID
            
        Returns:
            Tab data as dict or None if not found
        """
        async with self._lock:
            tab = self._tabs.get(tab_id)
            if not tab:
                return None
            return tab.to_dict()
