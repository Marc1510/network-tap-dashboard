from fastapi import FastAPI
from services.api.config import API_TITLE, API_VERSION, TEST_RUNTIME_DIR
from services.api.deps import tests_manager
from services.api.middleware import setup_cors
from services.api.routes import register_all_routers
from services.api.profile_service import load_profile, utcnow_iso
from services.api.lifecycle import create_startup_handler, create_shutdown_handler
from services.api.scheduling import ScheduleManager, create_scheduling_router  # noqa: E402

app = FastAPI(title=API_TITLE, version=API_VERSION)
setup_cors(app)

register_all_routers(app, tests_manager=tests_manager, load_profile=load_profile)

schedule_manager = ScheduleManager(
    runtime_dir=TEST_RUNTIME_DIR,
    load_profile=load_profile,
    utcnow_iso=utcnow_iso,
    tests_manager=tests_manager,
)
app.include_router(create_scheduling_router(schedule_manager))

app.on_event("startup")(create_startup_handler(schedule_manager, tests_manager))
app.on_event("shutdown")(create_shutdown_handler(schedule_manager, tests_manager))
