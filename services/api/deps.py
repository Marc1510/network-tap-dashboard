from services.agent.capture_manager import TcpdumpCaptureManager
from services.agent.test_manager import TestExecutionManager
from services.api.config import CAPTURE_DIR, PROFILES_DIR, TEST_RUNTIME_DIR, TSN_SECURITY_DIR
from services.api.tsn_security_service import TsnSecurityManager


# Manager-Instanzen
capture_manager = TcpdumpCaptureManager(output_directory=CAPTURE_DIR)
tests_manager = TestExecutionManager(runtime_dir=TEST_RUNTIME_DIR, capture_dir=CAPTURE_DIR)
tsn_security_manager = TsnSecurityManager(artifact_root=TSN_SECURITY_DIR)


