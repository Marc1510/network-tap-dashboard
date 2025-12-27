from services.agent.capture_manager import TcpdumpCaptureManager
from services.agent.test_manager import TestExecutionManager
from services.api.config import CAPTURE_DIR, PROFILES_DIR, TEST_RUNTIME_DIR


# Manager-Instanzen
capture_manager = TcpdumpCaptureManager(output_directory=CAPTURE_DIR)
tests_manager = TestExecutionManager(runtime_dir=TEST_RUNTIME_DIR, capture_dir=CAPTURE_DIR)


