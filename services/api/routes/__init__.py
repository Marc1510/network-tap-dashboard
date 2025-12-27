from fastapi import FastAPI

from services.api.routes.system import router as system_router
from services.api.routes.license import router as license_router
from services.api.routes.captures import router as captures_router
from services.api.routes.profiles import router as profiles_router
from services.api.routes.ssh import router as ssh_router
from services.api.routes.tabs import create_tabs_router


def register_all_routers(app: FastAPI, *, tests_manager, load_profile):
	app.include_router(system_router)
	app.include_router(license_router)
	app.include_router(captures_router)
	app.include_router(profiles_router)
	app.include_router(ssh_router)
	app.include_router(create_tabs_router(tests_manager, load_profile))


