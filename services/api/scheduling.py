from __future__ import annotations

from pathlib import Path
from typing import Callable
from uuid import uuid4
from datetime import datetime, timezone, timedelta
import asyncio
import contextlib
import json
import re

from apscheduler.jobstores.base import JobLookupError
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.date import DateTrigger

from fastapi import APIRouter, Body, HTTPException
from services.api.enums import ScheduleType, RunStatus


ScheduleRule = dict  # {'type': 'once'|'weekly', ...}


class ScheduleManager:
    def __init__(
        self,
        runtime_dir: Path,
        *,
        load_profile: Callable[[str], dict],
        utcnow_iso: Callable[[], str],
        tests_manager,
    ) -> None:
        self.runtime_dir = runtime_dir
        self.file = self.runtime_dir / "schedules.json"
        self._lock = asyncio.Lock()
        self._tz = datetime.now().astimezone().tzinfo or timezone.utc
        self._schedules: dict[str, dict] = {}
        # Hinweis: AsyncIOScheduler darf nicht vor dem Start der Eventloop gebunden werden,
        # sonst hängt er ggf. an einer falschen Loop und führt keine Jobs aus.
        # Wir erstellen ihn daher erst in start() mit der aktuellen running loop.
        self._scheduler = None  # type: ignore[assignment]
        self._sync_job_id = "__schedule_sync__"
        self._load_profile = load_profile
        self._utcnow_iso = utcnow_iso
        self.tests_manager = tests_manager
        self._load()
        print(f"ScheduleManager initialized with {len(self._schedules)} schedules")

    def _load(self) -> None:
        self.runtime_dir.mkdir(parents=True, exist_ok=True)
        if not self.file.exists():
            return
        try:
            with self.file.open("r", encoding="utf-8") as f:
                raw = json.load(f)
        except Exception as e:
            print(f"Error loading schedules: {e}")
            return
        if isinstance(raw, dict) and isinstance(raw.get("items"), list):
            for it in raw["items"]:
                if not isinstance(it, dict):
                    continue
                sid = str(it.get("id") or "").strip()
                if not sid:
                    continue
                inprog_str = it.get("inProgressUntilUtc")
                if inprog_str:
                    try:
                        inprog = self._parse_utc(inprog_str)
                        now = datetime.now()
                        if inprog and inprog < now - timedelta(minutes=5):
                            it["inProgressUntilUtc"] = None
                            print(f"Cleared stale inProgressUntilUtc for schedule {sid}")
                    except Exception:
                        it["inProgressUntilUtc"] = None
                if it.get("currentTabId"):
                    it["currentTabId"] = None
                    it["currentTabStatus"] = None
                it["nextRunUtc"] = None
                if it.get("skipIfRunning") is None:
                    it["skipIfRunning"] = True
                # Internal flag for queued run when overlapping
                if it.get("_queuedRun") is None:
                    it["_queuedRun"] = False
                self._schedules[sid] = it

    async def _save_locked(self) -> None:
        tmp = self.file.with_suffix(".tmp")
        data = {"items": list(self._schedules.values())}
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        tmp.replace(self.file)

    async def list(self) -> list[dict]:
        async with self._lock:
            items = [self._with_next(self._schedules[sid]) for sid in sorted(self._schedules.keys())]
        return items

    async def create(self, payload: dict) -> dict:
        profile_id = str(payload.get("profileId") or "").strip()
        if not profile_id:
            raise HTTPException(status_code=400, detail="profileId ist erforderlich")
        _ = self._load_profile(profile_id)
        rule = payload.get("rule")
        if not isinstance(rule, dict):
            raise HTTPException(status_code=400, detail="Ungültige Regel")
        try:
            _ = ScheduleType(rule.get("type"))
        except Exception:
            raise HTTPException(status_code=400, detail="Ungültige Regel")
        skip_if_running = bool(payload.get("skipIfRunning", True))
        now = self._utcnow_iso()
        sid = uuid4().hex
        doc = {
            "id": sid,
            "profileId": profile_id,
            "title": (str(payload.get("title")) or None),
            "enabled": bool(payload.get("enabled", True)),
            "createdUtc": now,
            "updatedUtc": now,
            "rule": rule,
            "skipIfRunning": skip_if_running,
            "_queuedRun": False,
            "lastRunUtc": None,
            "lastCaptureId": None,
            "lastRunStatus": None,
            "inProgressUntilUtc": None,
            "currentTabId": None,
            "currentTabStatus": None,
        }
        next_dt = self._next_run_datetime(doc)
        if not next_dt:
            raise HTTPException(status_code=400, detail="Zeitpunkt liegt in der Vergangenheit oder Regel ohne zukünftige Ausführung")
        doc["nextRunUtc"] = self._to_utc_iso(next_dt)
        async with self._lock:
            self._schedules[sid] = doc
            await self._save_locked()
        print(f"Created schedule {sid}, next run at {next_dt.astimezone(self._tz).isoformat()}")
        self._configure_job(sid, next_dt)
        return dict(doc)

    async def update(self, sid: str, payload: dict) -> dict:
        async with self._lock:
            current = self._schedules.get(sid)
            if not current:
                raise HTTPException(status_code=404, detail="Eintrag nicht gefunden")
        profile_id = str(payload.get("profileId") or current.get("profileId") or "").strip()
        if not profile_id:
            raise HTTPException(status_code=400, detail="profileId ist erforderlich")
        _ = self._load_profile(profile_id)
        rule = payload.get("rule") or current.get("rule")
        if not isinstance(rule, dict):
            raise HTTPException(status_code=400, detail="Ungültige Regel")
        try:
            _ = ScheduleType(rule.get("type"))
        except Exception:
            raise HTTPException(status_code=400, detail="Ungültige Regel")
        skip_if_running = bool(payload.get("skipIfRunning") if payload.get("skipIfRunning") is not None else current.get("skipIfRunning", True))
        updated = {
            **current,
            "profileId": profile_id,
            "title": (str(payload.get("title") if payload.get("title") is not None else current.get("title")) or None),
            "enabled": bool(payload.get("enabled") if payload.get("enabled") is not None else current.get("enabled", True)),
            "rule": rule,
            "updatedUtc": self._utcnow_iso(),
            "skipIfRunning": skip_if_running,
        }
        next_dt = self._next_run_datetime(updated)
        if not next_dt:
            raise HTTPException(status_code=400, detail="Zeitpunkt liegt in der Vergangenheit oder Regel ohne zukünftige Ausführung")
        updated["nextRunUtc"] = self._to_utc_iso(next_dt)
        async with self._lock:
            self._schedules[sid] = updated
            await self._save_locked()
        print(f"Updated schedule {sid}, next run at {next_dt.astimezone(self._tz).isoformat()}")
        self._configure_job(sid, next_dt)
        return dict(updated)

    async def delete(self, sid: str) -> None:
        async with self._lock:
            if sid not in self._schedules:
                raise HTTPException(status_code=404, detail="Eintrag nicht gefunden")
            self._schedules.pop(sid)
            await self._save_locked()
        with contextlib.suppress(JobLookupError):
            self._scheduler.remove_job(self._job_id(sid))

    def start(self) -> None:
        # Scheduler mit der aktuell laufenden Eventloop initialisieren
        if self._scheduler is None:
            loop = asyncio.get_running_loop()
            from apscheduler.schedulers.asyncio import AsyncIOScheduler as _AsyncIOScheduler
            self._scheduler = _AsyncIOScheduler(
                event_loop=loop,
                timezone=self._tz,
                job_defaults={
                    "coalesce": True,
                    "max_instances": 1,
                    "misfire_grace_time": 180,
                },
            )
        if not getattr(self._scheduler, "running", False):
            self._scheduler.start()
            print("APScheduler started")
        print("Schedule manager started using APScheduler")
        # Nach dem Start alle bekannten Schedules neu berechnen und als Jobs registrieren
        # Wichtig: im FastAPI-Startup läuft bereits eine Eventloop
        try:
            coro = self._refresh_all_jobs()
            task = asyncio.create_task(coro)
            task.add_done_callback(lambda t: None)
        except RuntimeError:
            # falls kein laufender Loop in seltenen Fällen verfügbar ist
            loop = asyncio.get_event_loop()
            loop.create_task(self._refresh_all_jobs())

    async def stop(self) -> None:
        if self._scheduler is not None and getattr(self._scheduler, "running", False):
            result = self._scheduler.shutdown(wait=False)
            if asyncio.iscoroutine(result):
                await result
            with contextlib.suppress(Exception):
                self._scheduler.remove_all_jobs()
        print("Schedule manager stopped")
        with contextlib.suppress(JobLookupError):
            if self._scheduler is not None:
                self._scheduler.remove_job(self._sync_job_id)

    def _with_next(self, item: dict) -> dict:
        data = dict(item)
        data["nextRunUtc"] = self._compute_next(item)
        return data

    def _compute_next(self, item: dict) -> str | None:
        next_dt = self._next_run_datetime(item)
        return self._to_utc_iso(next_dt) if next_dt else None

    def _job_id(self, sid: str) -> str:
        return f"sched:{sid}"

    async def _refresh_all_jobs(self) -> None:
        print("Refreshing all scheduled jobs...")
        async with self._lock:
            updates: dict[str, datetime | None] = {}
            changed = False
            for sid, item in self._schedules.items():
                next_dt = self._next_run_datetime(item)
                next_str = self._to_utc_iso(next_dt) if next_dt else None
                if item.get("nextRunUtc") != next_str:
                    item["nextRunUtc"] = next_str
                    changed = True
                updates[sid] = next_dt
                if next_dt:
                    print(f"  Schedule {sid}: next run at {next_dt.astimezone(self._tz).isoformat()}")
                else:
                    print(f"  Schedule {sid}: no future runs")
            if changed:
                await self._save_locked()
        for sid, run_at in updates.items():
            self._configure_job(sid, run_at)
        self._ensure_sync_job()
        print(f"Job refresh complete. Active jobs: {len([j for j in self._scheduler.get_jobs() if j.id != self._sync_job_id])}")

    def _configure_job(self, sid: str, run_at: datetime | None) -> None:
        job_id = self._job_id(sid)
        if self._scheduler is None or not getattr(self._scheduler, "running", False):
            print("Scheduler not running, cannot schedule job now (will be refreshed later)")
            return
        with contextlib.suppress(JobLookupError):
            self._scheduler.remove_job(job_id)
        if not run_at:
            print(f"No run_at time for schedule {sid}, job removed")
            self._ensure_sync_job()
            return
        if run_at.tzinfo is None:
            run_at = run_at.replace(tzinfo=self._tz)
        trigger = DateTrigger(run_date=run_at.astimezone(self._tz))
        try:
            self._scheduler.add_job(
                self._execute_schedule,
                trigger=trigger,
                id=job_id,
                args=[sid],
                replace_existing=True,
                max_instances=1,
                misfire_grace_time=180,
            )
            print(f"Job {job_id} scheduled for {run_at.astimezone(self._tz).isoformat()}")
        except Exception as e:
            print(f"Error adding job {job_id}: {e}")
            import traceback
            traceback.print_exc()
        self._ensure_sync_job()

    def _ensure_sync_job(self) -> None:
        if self._scheduler is None or not getattr(self._scheduler, "running", False):
            print("Scheduler not running, cannot ensure sync job")
            return
        if self._scheduler.get_job(self._sync_job_id) is None:
            self._scheduler.add_job(
                self._sync_tabs,
                trigger="interval",
                seconds=10,
                id=self._sync_job_id,
                coalesce=True,
                max_instances=1,
                misfire_grace_time=30,
            )
            print("Sync job added (runs every 10 seconds)")

    def _next_run_datetime(self, item: dict) -> datetime | None:
        if not item.get("enabled", True):
            return None
        rule = item.get("rule") or {}
        try:
            rule_type = ScheduleType(rule.get("type"))
        except Exception:
            return None
        tz = self._tz
        now_local = datetime.now(self._tz)
        last_run = self._parse_utc(item.get("lastRunUtc"))
        last_run = last_run.astimezone(self._tz) if last_run else None
        exclude_dates = set((rule.get("excludeDates") or []) if isinstance(rule.get("excludeDates"), list) else [])
        if rule_type == ScheduleType.ONCE:
            dt = self._get_once_dt(rule)
            if dt:
                if last_run and last_run >= dt:
                    return None
                if dt > now_local:
                    return dt
            return None
        if rule_type == ScheduleType.DAILY:
            interval_days = max(1, int(rule.get("interval") or 1))
            start_date = rule.get("startDate")
            end_date = rule.get("endDate")
            time_str = rule.get("time")
            dt = self._next_daily_occurrence(now_local, interval_days, start_date, end_date, time_str, self._tz, exclude_dates)
            return dt
        if rule_type == ScheduleType.WEEKLY:
            weekdays = rule.get("weekdays") or []
            interval = int(rule.get("interval") or 1)
            start_date = rule.get("startDate")
            end_date = rule.get("endDate")
            time_str = rule.get("time")
            dt = self._next_weekly_occurrence(now_local, weekdays, interval, start_date, end_date, time_str, self._tz, exclude_dates)
            return dt
        return None


    def _get_once_dt(self, rule: dict) -> datetime | None:
        return self._local_datetime(rule.get("date"), rule.get("time"), self._tz)

    def _next_daily_occurrence(
        self,
        after: datetime,
        interval_days: int,
        start_date: str | None,
        end_date: str | None,
        time_str: str | None,
        tz: timezone,
        exclude_dates: set[str],
    ) -> datetime | None:
        if not time_str:
            return None
        try:
            hh, mm = [int(x) for x in time_str.split(":")]
        except Exception:
            return None
        start_dt = self._local_datetime(start_date, "00:00", tz) if start_date else None
        end_dt = self._local_datetime(end_date, "23:59", tz) if end_date else None
        after_local = after.astimezone(tz)
        anchor_date = start_dt.date() if start_dt else after_local.date()
        cursor = after_local.replace(hour=0, minute=0, second=0, microsecond=0)
        for _ in range(0, 732):
            day = cursor.date()
            if start_dt and day < start_dt.date():
                cursor += timedelta(days=1)
                continue
            if end_dt and day > end_dt.date():
                return None
            if day.isoformat() in exclude_dates:
                cursor += timedelta(days=1)
                continue
            candidate = cursor.replace(hour=hh, minute=mm, second=0, microsecond=0)
            if candidate <= after_local:
                cursor += timedelta(days=1)
                continue
            delta_days = (day - anchor_date).days
            if delta_days < 0:
                cursor += timedelta(days=1)
                continue
            if (delta_days % max(1, interval_days)) == 0:
                return candidate
            cursor += timedelta(days=1)
        return None

    def _most_recent_weekly_occurrence(
        self,
        now_local: datetime,
        weekdays: list,
        interval_weeks: int,
        start_date: str | None,
        end_date: str | None,
        time_str: str | None,
        tz: timezone,
        exclude_dates: set[str],
    ) -> datetime | None:
        map_wd = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}
        selected = sorted({map_wd.get(str(w).upper(), -1) for w in weekdays if map_wd.get(str(w).upper(), -1) >= 0})
        if not selected or not time_str:
            return None
        try:
            hh, mm = [int(x) for x in time_str.split(":")]
        except Exception:
            return None
        interval = max(1, int(interval_weeks or 1))
        start_dt = self._local_datetime(start_date, "00:00", tz) if start_date else None
        end_dt = self._local_datetime(end_date, "23:59", tz) if end_date else None
        anchor_date = start_dt.date() if start_dt else None
        today_local = now_local.astimezone(tz)
        base = today_local.replace(hour=hh, minute=mm, second=0, microsecond=0)
        for i in range(0, 15):
            candidate = base - timedelta(days=i)
            if start_dt and candidate < start_dt:
                break
            if end_dt and candidate > end_dt:
                continue
            if candidate.date().isoformat() in exclude_dates:
                continue
            if candidate.weekday() not in selected:
                continue
            if anchor_date is not None:
                delta_days = (candidate.date() - anchor_date).days
                if delta_days < 0:
                    break
                weeks = delta_days // 7
                if weeks % interval != 0:
                    continue
            if candidate <= today_local:
                return candidate
        return None

    def _parse_utc(self, s: str | None) -> datetime | None:
        if not s:
            return None
        m = re.match(r"^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$", s)
        if not m:
            return None
        y, mo, d, h, mi, sec = map(int, m.groups())
        dt_utc = datetime(y, mo, d, h, mi, sec, tzinfo=timezone.utc)
        return dt_utc.astimezone(self._tz)

    def _is_same_day(self, dt1: datetime | None, dt2: datetime | None) -> bool:
        if not dt1 or not dt2:
            return False
        return dt1.astimezone(self._tz).date() == dt2.astimezone(self._tz).date()

    def _local_datetime(self, date_str: str | None, time_str: str | None, tz: timezone | None = None) -> datetime | None:
        if not date_str or not time_str:
            return None
        try:
            y, mo, d = [int(x) for x in date_str.split("-")]
            hh, mm = [int(x) for x in time_str.split(":")]
            return datetime(y, mo, d, hh, mm, tzinfo=(tz or self._tz))
        except Exception:
            return None

    def _to_utc_iso(self, dt_local: datetime) -> str:
        if dt_local.tzinfo is None:
            dt_local = dt_local.replace(tzinfo=self._tz)
        dt_utc = dt_local.astimezone(timezone.utc)
        return dt_utc.strftime("%Y%m%dT%H%M%SZ")

    def _next_weekly_occurrence(
        self,
        after: datetime,
        weekdays: list,
        interval_weeks: int,
        start_date: str | None,
        end_date: str | None,
        time_str: str | None,
        tz: timezone,
        exclude_dates: set[str],
    ) -> datetime | None:
        map_wd = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}
        selected = sorted({map_wd.get(str(w).upper(), -1) for w in weekdays if map_wd.get(str(w).upper(), -1) >= 0})
        if not selected or not time_str:
            return None
        try:
            hh, mm = [int(x) for x in time_str.split(":")]
        except Exception:
            return None
        interval = max(1, int(interval_weeks or 1))
        start_dt = self._local_datetime(start_date, "00:00", tz) if start_date else None
        end_dt = self._local_datetime(end_date, "23:59", tz) if end_date else None
        after_local = after.astimezone(tz)
        anchor_date = start_dt.date() if start_dt else after_local.date()
        cursor = after_local.replace(hour=0, minute=0, second=0, microsecond=0)
        for _ in range(0, 366):
            day = cursor.date()
            if start_dt and day < start_dt.date():
                cursor += timedelta(days=1)
                continue
            if end_dt and day > end_dt.date():
                return None
            if day.isoformat() in exclude_dates:
                cursor += timedelta(days=1)
                continue
            if cursor.weekday() not in selected:
                cursor += timedelta(days=1)
                continue
            candidate = cursor.replace(hour=hh, minute=mm, second=0, microsecond=0)
            if candidate <= after_local:
                cursor += timedelta(days=1)
                continue
            delta_days = (day - anchor_date).days
            if delta_days < 0:
                cursor += timedelta(days=1)
                continue
            weeks = delta_days // 7
            if weeks % interval == 0:
                return candidate
            cursor += timedelta(days=1)
        return None

    async def _execute_schedule(self, schedule_id: str, force: bool = False) -> None:
        schedule_copy: dict | None = None
        next_dt: datetime | None = None
        schedule_enabled = True
        async with self._lock:
            item = self._schedules.get(schedule_id)
            if not item:
                print(f"Schedule {schedule_id} not found in _execute_schedule")
                return
            schedule_enabled = bool(item.get("enabled", True))
            if not schedule_enabled and not force:
                print(f"Schedule {schedule_id} is disabled, skipping execution")
                return
            if item.get("currentTabId"):
                if not force:
                    print(f"Schedule {schedule_id} already running (tab: {item.get('currentTabId')})")
                    if not bool(item.get("skipIfRunning", True)):
                        item["_queuedRun"] = True
                        print(f"Queued a follow-up run for schedule {schedule_id}")
                next_dt = self._next_run_datetime(item) if schedule_enabled else None
                item["nextRunUtc"] = self._to_utc_iso(next_dt) if next_dt else None
                await self._save_locked()
            else:
                now_utc = datetime.now(timezone.utc)
                print(f"Executing schedule {schedule_id} at {now_utc}")
                item["lastRunUtc"] = now_utc.strftime("%Y%m%dT%H%M%SZ")
                item["lastRunStatus"] = None
                item["updatedUtc"] = item["lastRunUtc"]
                item["inProgressUntilUtc"] = (now_utc + timedelta(minutes=3)).strftime("%Y%m%dT%H%M%SZ")
                schedule_copy = dict(item)
                if schedule_enabled:
                    next_dt = self._next_run_datetime(item)
                    if next_dt:
                        print(f"Next run for {schedule_id} scheduled at {next_dt}")
                    else:
                        print(f"No future runs for {schedule_id}")
                else:
                    next_dt = None
                item["nextRunUtc"] = self._to_utc_iso(next_dt) if next_dt else None
                await self._save_locked()
        if schedule_enabled:
            self._configure_job(schedule_id, next_dt)
        else:
            self._configure_job(schedule_id, None)
        if schedule_copy is None:
            return
        try:
            await self._start_scheduled_run(schedule_copy)
        except Exception as exc:  # noqa: BLE001
            print(f"Error executing schedule {schedule_id}: {exc}")
            import traceback
            traceback.print_exc()
            async with self._lock:
                stored = self._schedules.get(schedule_id)
                if stored:
                    stored["inProgressUntilUtc"] = None
                    stored["lastRunStatus"] = RunStatus.FAILED.value
                    stored["updatedUtc"] = self._utcnow_iso()
                    await self._save_locked()

    async def _sync_tabs(self) -> None:
        try:
            tabs = await self.tests_manager.list_tabs()
            tabs_by_id: dict[str, dict] = {str(t.get("id")): t for t in tabs if isinstance(t, dict) and t.get("id")}
        except Exception:
            tabs_by_id = {}
        changed = False
        async with self._lock:
            for sid, item in list(self._schedules.items()):
                tab_id = item.get("currentTabId")
                if not tab_id:
                    # if a run was queued and nothing is running, trigger now
                    if item.get("_queuedRun"):
                        item["_queuedRun"] = False
                        # trigger outside lock
                        asyncio.create_task(self._execute_schedule(str(item.get("id")), force=True))
                    continue
                tab = tabs_by_id.get(str(tab_id)) or {}
                status = tab.get("status")
                try:
                    status_enum = RunStatus(status) if status is not None else None
                except Exception:
                    status_enum = None
                if status_enum not in {RunStatus.RUNNING, RunStatus.STARTING}:
                    run = tab.get("run") if isinstance(tab.get("run"), dict) else None
                    capture_id = run.get("capture_id") if run else None
                    if capture_id:
                        item["lastCaptureId"] = capture_id
                    elif run and run.get("pid") is not None:
                        try:
                            item["lastCaptureId"] = f"pid-{int(run.get('pid'))}"
                        except Exception:
                            pass
                    if status_enum in {RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED}:
                        item["lastRunStatus"] = status
                    now_utc = datetime.now(timezone.utc)
                    item["lastRunUtc"] = now_utc.strftime("%Y%m%dT%H%M%SZ")
                    item["currentTabId"] = None
                    item["currentTabStatus"] = None
                    item["inProgressUntilUtc"] = None
                    item["updatedUtc"] = self._utcnow_iso()
                    changed = True
                else:
                    if item.get("currentTabStatus") != status:
                        item["currentTabStatus"] = status
                        item["updatedUtc"] = self._utcnow_iso()
                        changed = True
            if changed:
                await self._save_locked()

    async def trigger(self, schedule_id: str) -> tuple[bool, str]:
        async with self._lock:
            item = self._schedules.get(schedule_id)
            if not item:
                raise HTTPException(status_code=404, detail="Schedule nicht gefunden")
            if item.get("currentTabId"):
                return False, f"Schedule läuft bereits (Tab: {item.get('currentTabId')})"
        await self._execute_schedule(schedule_id, force=True)
        return True, "Schedule wurde manuell gestartet"

    async def debug(self, window_before: int = 15, window_after: int = 60) -> dict:
        async with self._lock:
            items = [dict(item) for item in self._schedules.values()]
        now_local_default = datetime.now(self._tz)
        schedules: list[dict] = []
        for item in items:
            now_local = datetime.now(self._tz)
            rule = item.get("rule", {})
            try:
                rule_type = ScheduleType(rule.get("type"))
            except Exception:
                rule_type = None
            last_run = self._parse_utc(item.get("lastRunUtc"))
            inprog = self._parse_utc(item.get("inProgressUntilUtc"))
            eligible = False
            reason = "unknown"
            if not item.get("enabled", True):
                reason = "disabled"
            elif item.get("currentTabId"):
                reason = f"already running (tab: {item.get('currentTabId')})"
            elif inprog and inprog > now_local:
                reason = f"in progress until {inprog.isoformat()}"
            else:
                if rule_type == ScheduleType.ONCE:
                    dt_local = self._get_once_dt(rule)
                    if dt_local:
                        if last_run and last_run >= dt_local:
                            reason = f"already ran at {last_run.isoformat()}"
                        else:
                            delta = (now_local - dt_local).total_seconds()
                            if -window_before <= delta <= window_after:
                                eligible = True
                                reason = f"eligible (delta: {delta:.0f}s)"
                            else:
                                reason = (
                                    f"outside time window (delta: {delta:.0f}s, "
                                    f"need: -{window_before}s to +{window_after}s)"
                                )
                    else:
                        reason = "invalid date/time"
                elif rule_type == ScheduleType.DAILY:
                    occ = self._next_daily_occurrence(
                        now_local,
                        max(1, int(rule.get("interval") or 1)),
                        rule.get("startDate"),
                        rule.get("endDate"),
                        rule.get("time"),
                        self._tz,
                        set((rule.get("excludeDates") or []) if isinstance(rule.get("excludeDates"), list) else []),
                    )
                    if occ:
                        if last_run and self._is_same_day(last_run, occ):
                            reason = f"already ran today at {last_run.isoformat()}"
                        else:
                            delta = (now_local - occ).total_seconds()
                            if -window_before <= delta <= window_after:
                                eligible = True
                                reason = f"eligible (delta: {delta:.0f}s, occurrence: {occ.isoformat()})"
                            else:
                                reason = (
                                    f"outside time window (delta: {delta:.0f}s, occurrence: {occ.isoformat()}, "
                                    f"need: -{window_before}s to +{window_after}s)"
                                )
                    else:
                        reason = "no valid occurrence found"
                elif rule_type == ScheduleType.WEEKLY:
                    occ = self._most_recent_weekly_occurrence(
                        now_local,
                        rule.get("weekdays") or [],
                        int(rule.get("interval") or 1),
                        rule.get("startDate"),
                        rule.get("endDate"),
                        rule.get("time"),
                        self._tz,
                        set((rule.get("excludeDates") or []) if isinstance(rule.get("excludeDates"), list) else []),
                    )
                    if occ:
                        if last_run and self._is_same_day(last_run, occ):
                            reason = f"already ran today at {last_run.isoformat()}"
                        else:
                            delta = (now_local - occ).total_seconds()
                            if -window_before <= delta <= window_after:
                                eligible = True
                                reason = f"eligible (delta: {delta:.0f}s, occurrence: {occ.isoformat()})"
                            else:
                                reason = (
                                    f"outside time window (delta: {delta:.0f}s, occurrence: {occ.isoformat()}, "
                                    f"need: -{window_before}s to +{window_after}s)"
                                )
                    else:
                        reason = "no valid occurrence found"
                else:
                    reason = "unknown rule"

            schedules.append(
                {
                    "id": item.get("id"),
                    "title": item.get("title"),
                    "enabled": item.get("enabled", True),
                    "rule": rule,
                    "lastRunUtc": item.get("lastRunUtc"),
                    "lastRunLocal": last_run.isoformat() if last_run else None,
                    "inProgressUntilUtc": item.get("inProgressUntilUtc"),
                    "currentTabId": item.get("currentTabId"),
                    "currentTabStatus": item.get("currentTabStatus"),
                    "nextRunUtc": item.get("nextRunUtc"),
                    "eligible": eligible,
                    "reason": reason,
                    "nowLocal": now_local.isoformat(),
                }
            )
        return {"now": now_local_default.isoformat(), "schedules": schedules}

    async def _start_scheduled_run(self, item: dict) -> None:
        try:
            profile = self._load_profile(item.get("profileId"))
            title = item.get("title") or f"Plan: {profile.get('name') or 'Test'}"
            tab = await self.tests_manager.create_tab(title=title, profile_id=profile.get("id"))
            started = await self.tests_manager.start_test(tab.get("id"), profile)
            async with self._lock:
                sid = str(item.get("id"))
                stored = self._schedules.get(sid)
                if stored:
                    stored["currentTabId"] = tab.get("id")
                    stored["currentTabStatus"] = (started.get("status") if isinstance(started, dict) else "running")
                    stored["inProgressUntilUtc"] = None
                    stored["updatedUtc"] = self._utcnow_iso()
                    await self._save_locked()
        except Exception:
            try:
                async with self._lock:
                    sid = str(item.get("id"))
                    stored = self._schedules.get(sid)
                    if stored:
                        stored["inProgressUntilUtc"] = None
                        stored["updatedUtc"] = self._utcnow_iso()
                        await self._save_locked()
            except Exception:
                pass


def create_scheduling_router(schedule_manager: ScheduleManager) -> APIRouter:
    router = APIRouter()

    @router.get("/schedules")
    async def api_list_schedules():
        return await schedule_manager.list()

    @router.post("/schedules")
    async def api_create_schedule(payload: dict = Body()):  # type: ignore[type-arg]
        return await schedule_manager.create(payload)

    @router.put("/schedules/{schedule_id}")
    async def api_update_schedule(schedule_id: str, payload: dict = Body()):  # type: ignore[type-arg]
        return await schedule_manager.update(schedule_id, payload)

    @router.delete("/schedules/{schedule_id}")
    async def api_delete_schedule(schedule_id: str):
        await schedule_manager.delete(schedule_id)
        return {"deleted": True}

    @router.get("/schedules/debug")
    async def api_debug_schedules():
        return await schedule_manager.debug()

    @router.get("/schedules/jobs")
    async def api_list_scheduler_jobs():
        jobs = schedule_manager._scheduler.get_jobs()
        return {
            "scheduler_running": schedule_manager._scheduler.running,
            "jobs": [
                {
                    "id": job.id,
                    "name": job.name,
                    "next_run_time": job.next_run_time.isoformat() if job.next_run_time else None,
                    "trigger": str(job.trigger),
                }
                for job in jobs
            ],
        }

    @router.post("/schedules/{schedule_id}/trigger")
    async def api_trigger_schedule(schedule_id: str):
        triggered, message = await schedule_manager.trigger(schedule_id)
        return {"triggered": triggered, "message": message}

    return router


