from __future__ import annotations

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any


class TestProfileSettings(BaseModel):
	"""
	Profile settings for tcpdump-based network capture.
	Based on tcpdump documentation and TSN requirements.
	"""
	# --- Capture Interfaces ---
	# List of interface names to capture on (dynamically fetched from system)
	interfaces: List[str] = Field(default_factory=lambda: ["eth0"])
	promiscuousMode: bool = True  # -p flag disables promiscuous mode
	
	# --- Trigger & Duration ---
	# Note: startCondition removed - timing is controlled via schedule
	stopCondition: str = "manual"  # manual, duration, packetCount, fileSize
	stopDurationValue: int = 60
	stopDurationUnit: str = "seconds"  # seconds, minutes, hours
	stopPacketCount: Optional[int] = None  # -c count
	stopFileSizeValue: Optional[int] = 100  # File size value for fileSize stopCondition
	stopFileSizeUnit: str = "megabytes"  # bytes, kilobytes, megabytes, gigabytes
	
	# --- Capture Options (tcpdump) ---
	snapLength: int = 0  # -s snaplen (0 = full packet, 262144 bytes)
	bufferSize: int = 2  # -B buffer_size in MiB (kernel buffer)
	timestampPrecision: str = "micro"  # micro, nano (--time-stamp-precision)
	timestampType: str = ""  # -j tstamp_type (adapter_unsynced, host, etc.)
	immediateMode: bool = False  # --immediate-mode (don't buffer)
	
	# --- Output & Ring Buffer ---
	ringFileSizeValue: int = 100  # File size value for ring buffer rotation
	ringFileSizeUnit: str = "megabytes"  # bytes, kilobytes, megabytes, gigabytes
	ringFileSizeMB: Optional[int] = None  # Deprecated: kept for backwards compatibility
	ringFileCount: int = 10  # -W filecount (max number of files to keep)
	outputFormat: str = "pcap"  # pcap (standard)
	filenamePrefix: str = "capture"
	
	# --- Filtering (BPF) ---
	bpfFilter: str = ""  # Custom BPF filter expression
	
	# Protocol shortcuts (translated to BPF)
	filterProtocols: List[str] = Field(default_factory=list)  # tcp, udp, icmp, arp, etc.
	filterHosts: str = ""  # host filter (IP or MAC)
	filterPorts: str = ""  # port filter
	filterVlanId: Optional[int] = None  # vlan <id>
	filterDirection: str = ""  # inout, in, out (-Q direction)
	
	# --- TSN-Specific Options ---
	# Wichtig: captureTsnSync (gPTP, Layer-2) und capturePtp (UDP/IP) schließen sich gegenseitig aus!
	# Der Filter wird so generiert, dass bei beiden Flags eine OR-Verknüpfung entsteht.
	captureTsnSync: bool = False  # 802.1AS / gPTP (ether proto 0x88f7) - Layer-2 only
	capturePtp: bool = False  # PTPv2 over UDP/IP (udp port 319 or udp port 320)
	captureVlanTagged: bool = False  # VLAN tagged frames (802.1Q)
	tsnPriorityFilter: Optional[int] = None  # VLAN priority (0-7)
	printLinkLevelHeader: bool = False  # Print link-level header (-e flag)
	
	# --- Post-Processing Options ---
	headerOnly: bool = False  # Only capture headers (reduced snaplen)
	headerSnaplen: int = 96  # Snaplen when headerOnly is true
	generateTestMetadataFile: bool = True  # Generate per-test metadata file in capture directory (CSV)
	generateStatistics: bool = False  # Generate basic statistics after capture
	
	# --- Resource Management ---
	cpuPriority: str = "normal"  # normal, high (nice level)
	maxDiskUsageMB: int = 1000  # Maximum disk space for captures


class TestProfile(BaseModel):
	id: str
	name: str
	description: Optional[str] = None
	isDefault: bool = False
	createdUtc: str
	updatedUtc: str
	settings: TestProfileSettings


class CreateTestTabPayload(BaseModel):
	title: Optional[str] = None
	profileId: Optional[str] = None


class UpdateTestTabPayload(BaseModel):
	title: Optional[str] = None
	profileId: Optional[str] = None


class StartTestTabPayload(BaseModel):
	profileId: Optional[str] = None


class CreateSshUserPayload(BaseModel):
	username: str


class UpdateCaptureSessionPayload(BaseModel):
	test_name: str


class DownloadSelectedFilesPayload(BaseModel):
	files: list[str]


class BulkDownloadPayload(BaseModel):
	capture_ids: list[str]


class DeleteCaptureSessionsPayload(BaseModel):
	capture_ids: list[str]


