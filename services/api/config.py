from __future__ import annotations

import os
from pathlib import Path


# Basisverzeichnis des Repos (overridebar via BA_TAP_ROOT)
REPO_ROOT = Path(os.getenv("BA_TAP_ROOT", Path(__file__).resolve().parents[2]))

# Pfade (via Env überschreibbar)
CAPTURE_DIR = Path(os.getenv("BA_TAP_CAPTURE_DIR", REPO_ROOT / "capture" / "exports"))
PROFILES_DIR = Path(os.getenv("BA_TAP_PROFILES_DIR", REPO_ROOT / "capture" / "profiles"))
TEST_RUNTIME_DIR = Path(os.getenv("BA_TAP_TEST_RUNTIME_DIR", REPO_ROOT / "capture" / "tmp" / "test_runtime"))
TSN_SECURITY_DIR = Path(os.getenv("BA_TAP_TSN_SECURITY_DIR", REPO_ROOT / "capture" / "tsn_security"))

# Isolated TSN laboratory scope. These values deliberately cannot be supplied
# by an API request. A deployment must opt into a different scope through its
# environment.
TSN_SECURITY_TARGET = os.getenv("BA_TAP_TSN_SECURITY_TARGET", "192.168.1.4")
TSN_SECURITY_OBSERVER = os.getenv("BA_TAP_TSN_SECURITY_OBSERVER", "10.10.0.77")
TSN_SECURITY_OBSERVER_USER = os.getenv("BA_TAP_TSN_SECURITY_OBSERVER_USER", "marc")
TSN_SECURITY_GENERATOR_INTERFACE = os.getenv("BA_TAP_TSN_SECURITY_GENERATOR_INTERFACE", "eth0.10")
TSN_SECURITY_INTERFACES = tuple(
	item.strip()
	for item in os.getenv("BA_TAP_TSN_SECURITY_INTERFACES", "RT0,RT2,eth0").split(",")
	if item.strip()
)

# Weitere Settings (können bei Bedarf ergänzt werden)
API_TITLE = os.getenv("BA_TAP_API_TITLE", "ba-tap API")
API_VERSION = os.getenv("BA_TAP_API_VERSION", "0.1.0")


