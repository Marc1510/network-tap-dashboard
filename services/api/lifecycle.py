from __future__ import annotations

import contextlib


def create_startup_handler(schedule_manager, tests_manager):
	async def on_startup():  # pragma: no cover
		# start background schedule loop
		schedule_manager.start()
		# Now refresh all jobs in the async context
		await schedule_manager._refresh_all_jobs()

	return on_startup


def create_shutdown_handler(schedule_manager, tests_manager):
	async def on_shutdown():
		# Wake any websocket listeners so their queue.get() unblocks
		with contextlib.suppress(Exception):
			await tests_manager.notify_shutdown()
		# Abort running tests and wait briefly for cleanup
		await tests_manager.abort_all()
		# Stop scheduler
		with contextlib.suppress(Exception):
			await schedule_manager.stop()

	return on_shutdown


