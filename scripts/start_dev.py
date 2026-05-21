#!/usr/bin/env python3
"""
Start backend (uvicorn) and frontend (npm) in parallel and forward their output.

Usage:
  python scripts/start_dev.py
  python scripts/start_dev.py --backend-port 8000 --frontend-dir services/ui/dashboard
"""
from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import threading
import time
from typing import Optional
import shutil


def stream_output(prefix: str, stream) -> None:
    try:
        for line in iter(stream.readline, ""):
            if not line:
                break
            print(f"{prefix} {line.rstrip()}")
    except Exception:
        pass


def start_process(cmd, cwd: Optional[str] = None, env: Optional[dict] = None):
    return subprocess.Popen(
        cmd,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )


def terminate_process(p: subprocess.Popen, name: str) -> None:
    if p is None:
        return
    try:
        if p.poll() is None:
            p.terminate()
            # give it a short time, then kill
            try:
                p.wait(timeout=3)
            except Exception:
                p.kill()
    except Exception:
        pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Start backend (uvicorn) and frontend (npm) in parallel")
    parser.add_argument("--frontend-dir", default="services/ui/dashboard", help="Path to frontend project")
    parser.add_argument("--frontend-cmd", default=None, help="Frontend command (default: npm run dev)")
    parser.add_argument("--backend-host", default="0.0.0.0", help="Backend host for uvicorn")
    parser.add_argument("--backend-port", default=8000, type=int, help="Backend port for uvicorn")
    parser.add_argument("--no-install-check", action="store_true", help="Skip checking for npm/node/python availability")
    args = parser.parse_args()

    frontend_cmd = ["npm", "run", "dev"] if not args.frontend_cmd else args.frontend_cmd.split()

    backend_cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "services.api.main:app",
        "--host",
        args.backend_host,
        "--port",
        str(args.backend_port),
        "--reload",
    ]

    def ensure_backend_env() -> str:
        """Ensure backend Python has required modules.

        Returns path to Python executable to run the backend (possibly venv python).
        """
        venv_dir = os.path.join("services", "api", ".venv")
        venv_python = os.path.join(venv_dir, "Scripts" if os.name == "nt" else "bin", "python")

        def test_import(python: str, module: str) -> bool:
            try:
                subprocess.run([python, "-c", f"import {module}"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return True
            except Exception:
                return False

        # If current interpreter already has apscheduler, use it
        if test_import(sys.executable, "apscheduler"):
            return sys.executable

        # If venv exists and works, use it
        if os.path.exists(venv_python) and test_import(venv_python, "apscheduler"):
            return venv_python

        # Create venv and install requirements
        print("Creating virtualenv and installing backend requirements in services/api/.venv ...")
        try:
            subprocess.run([sys.executable, "-m", "venv", venv_dir], check=True)
            # upgrade pip and install requirements
            subprocess.run([venv_python, "-m", "pip", "install", "--upgrade", "pip"], check=True)
            req_file = os.path.join("services", "api", "requirements.txt")
            subprocess.run([venv_python, "-m", "pip", "install", "-r", req_file], check=True)
        except subprocess.CalledProcessError as e:
            print("Failed to create venv or install backend requirements:", e)
            return sys.executable

        if test_import(venv_python, "apscheduler"):
            return venv_python
        return sys.executable

    # ensure backend environment and use its python if created
    backend_python = ensure_backend_env()
    backend_cmd[0] = backend_python

    if not args.no_install_check:
        # quick availability checks
        if shutil_which("node") is None and shutil_which("npm") is None:
            print("Warning: 'node' or 'npm' not found in PATH. Frontend may fail to start.")
        if shutil_which(sys.executable) is None:
            print(f"Warning: Python executable {sys.executable} not found in PATH.")

    # Validate frontend dir
    if not os.path.isdir(args.frontend_dir):
        print(f"Frontend directory not found: {args.frontend_dir}")
        return 2

    # Resolve frontend executable on Windows (npm -> npm.cmd) if needed
    # and ensure the command exists before starting processes.
    frontend_exec = frontend_cmd[0]
    found_exec = None
    candidates = [frontend_exec]
    if os.name == "nt":
        candidates.extend([f"{frontend_exec}.cmd", f"{frontend_exec}.exe"])
    for c in candidates:
        p = shutil_which(c)
        if p:
            found_exec = p
            break
    if not found_exec:
        print(f"ERROR: frontend executable not found (tried: {', '.join(candidates)}). Please install Node/npm and ensure it's in PATH.")
        return 3
    # replace with full path if available
    frontend_cmd[0] = found_exec

    env = os.environ.copy()

    backend_proc = None
    frontend_proc = None

    def handle_exit(signum, frame):
        print("Shutting down child processes...")
        terminate_process(frontend_proc, "frontend")
        terminate_process(backend_proc, "backend")
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_exit)
    signal.signal(signal.SIGTERM, handle_exit)

    try:
        print("Starting backend:", " ".join(backend_cmd))
        backend_proc = start_process(backend_cmd)
        backend_thread = threading.Thread(target=stream_output, args=("BACKEND|", backend_proc.stdout), daemon=True)
        backend_thread.start()

        print("Starting frontend in:", args.frontend_dir)
        frontend_proc = start_process(frontend_cmd, cwd=args.frontend_dir, env=env)
        frontend_thread = threading.Thread(target=stream_output, args=("FRONTEND|", frontend_proc.stdout), daemon=True)
        frontend_thread.start()

        # Monitor processes: if one exits, stop the other.
        while True:
            time.sleep(0.5)
            b_ret = backend_proc.poll()
            f_ret = frontend_proc.poll()
            if b_ret is not None:
                print(f"Backend exited with {b_ret}, terminating frontend...")
                terminate_process(frontend_proc, "frontend")
                return b_ret
            if f_ret is not None:
                print(f"Frontend exited with {f_ret}, terminating backend...")
                terminate_process(backend_proc, "backend")
                return f_ret

    except KeyboardInterrupt:
        handle_exit(None, None)
    except Exception as e:
        print("Error while starting processes:", e)
        handle_exit(None, None)

    return 0


def shutil_which(cmd: str) -> Optional[str]:
    """Minimal wrapper around shutil.which to avoid importing at top for clarity."""
    try:
        import shutil

        return shutil.which(cmd)
    except Exception:
        return None


if __name__ == "__main__":
    raise SystemExit(main())
