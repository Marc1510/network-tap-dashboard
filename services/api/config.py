from __future__ import annotations

import os
from pathlib import Path


# Basisverzeichnis des Repos (overridebar via BA_TAP_ROOT)
REPO_ROOT = Path(os.getenv("BA_TAP_ROOT", Path(__file__).resolve().parents[2]))

# Pfade (via Env überschreibbar)
CAPTURE_DIR = Path(os.getenv("BA_TAP_CAPTURE_DIR", REPO_ROOT / "capture" / "exports"))
PROFILES_DIR = Path(os.getenv("BA_TAP_PROFILES_DIR", REPO_ROOT / "capture" / "profiles"))
TEST_RUNTIME_DIR = Path(os.getenv("BA_TAP_TEST_RUNTIME_DIR", REPO_ROOT / "capture" / "tmp" / "test_runtime"))

# Weitere Settings (können bei Bedarf ergänzt werden)
API_TITLE = os.getenv("BA_TAP_API_TITLE", "ba-tap API")
API_VERSION = os.getenv("BA_TAP_API_VERSION", "0.1.0")


