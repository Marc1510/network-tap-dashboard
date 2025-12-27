from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


def setup_cors(app: FastAPI) -> None:
	app.add_middleware(
		CORSMiddleware,
		allow_origins=[
			"http://localhost:5173",
			"http://127.0.0.1:5173",
			"http://localhost:3000",
			"http://127.0.0.1:3000",
			"http://localhost:8080",
			"http://127.0.0.1:8080",
			"http://localhost:4173",
			"http://127.0.0.1:4173",
		],
		allow_credentials=True,
		allow_methods=["*"],
		allow_headers=["*"],
	)


