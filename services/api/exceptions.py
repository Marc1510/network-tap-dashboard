from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import logging


class BA_TAP_Exception(Exception):
	def __init__(self, message: str, status_code: int = 400):
		self.message = message
		self.status_code = status_code
		super().__init__(message)


def setup_exception_handlers(app: FastAPI) -> None:
	@app.exception_handler(BA_TAP_Exception)
	async def handle_ba_tap_exception(request: Request, exc: BA_TAP_Exception):  # noqa: ANN001
		logging.getLogger(__name__).warning(f"BA_TAP_Exception: {exc.message}")
		return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})


