from fastapi import APIRouter
import psutil
import shutil
import socket

from services.api.enums import ErrorMessages
from services.api.utils.error_handling import handle_generic_error, raise_internal_error
from services.api.utils.system_utils import get_cpu_temperature

router = APIRouter()

# Cache for network IO statistics
_network_stats_cache = {}


@router.get("/health")
def health():
	return {"status": "ok"}


@router.get("/system/info")
@handle_generic_error(500, ErrorMessages.SYSTEM_INFO_ERROR)
def get_system_info():
	"""
	Returns basic system information (hostname, uptime, etc.)
	"""
	hostname = socket.gethostname()
	
	# Get IP address
	try:
		# Connect to a dummy address to determine the IP
		s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
		s.connect(('8.8.8.8', 80))
		ip_address = s.getsockname()[0]
		s.close()
	except Exception:
		ip_address = None
	
	# Boot time for uptime calculation
	boot_time = psutil.boot_time()
	
	# CPU temperature
	cpu_temp = get_cpu_temperature()
	
	return {
		"hostname": hostname,
		"ip_address": ip_address,
		"boot_time": boot_time,
		"cpu_temperature": round(cpu_temp, 1) if cpu_temp else None
	}


@router.get("/system/resources")
@handle_generic_error(500, ErrorMessages.SYSTEM_RESOURCES_ERROR)
def get_system_resources():
	"""
	Returns current system resources (CPU, RAM, storage) of the Raspberry Pi.
	"""
	cpu_percent = psutil.cpu_percent(interval=1)

	memory = psutil.virtual_memory()
	memory_percent = memory.percent
	memory_used_gb = memory.used / (1024**3)
	memory_total_gb = memory.total / (1024**3)

	disk = shutil.disk_usage('/')
	disk_total_gb = disk.total / (1024**3)
	disk_used_gb = disk.used / (1024**3)
	disk_free_gb = disk.free / (1024**3)
	disk_percent = (disk.used / disk.total) * 100

	# CPU temperature
	cpu_temp = get_cpu_temperature()

	try:
		load_avg = psutil.getloadavg()
	except AttributeError:
		load_avg = None

	return {
		"cpu": {
			"percent": round(cpu_percent, 1),
			"temperature": round(cpu_temp, 1) if cpu_temp else None,
			"load_average": [round(x, 2) for x in load_avg] if load_avg else None
		},
		"memory": {
			"percent": round(memory_percent, 1),
			"used_gb": round(memory_used_gb, 2),
			"total_gb": round(memory_total_gb, 2),
			"free_gb": round(memory_total_gb - memory_used_gb, 2)
		},
		"disk": {
			"percent": round(disk_percent, 1),
			"used_gb": round(disk_used_gb, 2),
			"total_gb": round(disk_total_gb, 2),
			"free_gb": round(disk_free_gb, 2)
		},
		"timestamp": psutil.boot_time()
	}


@router.get("/system/interfaces")
@handle_generic_error(500, ErrorMessages.NETWORK_INTERFACES_ERROR)
def get_network_interfaces():
	"""
	Returns information about all network interfaces.
	"""
	import time
	
	interfaces: list[dict] = []
	net_if_addrs = psutil.net_if_addrs()
	net_if_stats = psutil.net_if_stats()
	
	# Current IO statistics
	current_io = psutil.net_io_counters(pernic=True)
	current_time = time.time()
	
	if not _network_stats_cache:
		# First request - initialize cache
		for iface_name in current_io.keys():
			_network_stats_cache[iface_name] = {
				"last_update": current_time,
				"prev_bytes_sent": current_io[iface_name].bytes_sent,
				"prev_bytes_recv": current_io[iface_name].bytes_recv
			}
		
		# Don't calculate rates immediately after initialization
		for iface_name in current_io.keys():
			stats = net_if_stats.get(iface_name)
			addrs = net_if_addrs.get(iface_name)
			
			iface_info: dict = {
				"name": iface_name,
				"is_up": stats.isup if stats else False,
				"mtu": stats.mtu if stats else None,
				"speed": stats.speed if stats else None,
				"rate_sent_mbps": 0.0,
				"rate_recv_mbps": 0.0,
				"total_bytes_sent": current_io[iface_name].bytes_sent,
				"total_bytes_recv": current_io[iface_name].bytes_recv,
				"addresses": []
			}
			
			if addrs:
				for addr in addrs:
					iface_info["addresses"].append({
						"family": str(addr.family),
						"address": addr.address,
						"netmask": addr.netmask if addr.netmask else None,
						"broadcast": addr.broadcast if addr.broadcast else None
					})
			
			interfaces.append(iface_info)
		
		return {"interfaces": interfaces}
	
	# Calculate rates based on elapsed time
	for iface_name in current_io.keys():
		stats = net_if_stats.get(iface_name)
		addrs = net_if_addrs.get(iface_name)
		current_bytes_sent = current_io[iface_name].bytes_sent
		current_bytes_recv = current_io[iface_name].bytes_recv
		
		# Calculate rate
		rate_sent_mbps = 0.0
		rate_recv_mbps = 0.0
		
		if iface_name in _network_stats_cache:
			cache = _network_stats_cache[iface_name]
			time_diff = current_time - cache["last_update"]
			
			if time_diff > 0:
				bytes_sent_diff = max(0, current_bytes_sent - cache["prev_bytes_sent"])
				bytes_recv_diff = max(0, current_bytes_recv - cache["prev_bytes_recv"])
				
				# Convert from bytes to Mbps
				rate_sent_mbps = (bytes_sent_diff * 8) / (1024 * 1024) / time_diff
				rate_recv_mbps = (bytes_recv_diff * 8) / (1024 * 1024) / time_diff
			
			# Update cache
			cache["last_update"] = current_time
			cache["prev_bytes_sent"] = current_bytes_sent
			cache["prev_bytes_recv"] = current_bytes_recv
		else:
			# New interface
			_network_stats_cache[iface_name] = {
				"last_update": current_time,
				"prev_bytes_sent": current_bytes_sent,
				"prev_bytes_recv": current_bytes_recv
			}
		
		iface_info: dict = {
			"name": iface_name,
			"is_up": stats.isup if stats else False,
			"mtu": stats.mtu if stats else None,
			"speed": stats.speed if stats else None,
			"rate_sent_mbps": round(rate_sent_mbps, 3),
			"rate_recv_mbps": round(rate_recv_mbps, 3),
			"total_bytes_sent": current_bytes_sent,
			"total_bytes_recv": current_bytes_recv,
			"addresses": []
		}
		
		if addrs:
			for addr in addrs:
				iface_info["addresses"].append({
					"family": str(addr.family),
					"address": addr.address,
					"netmask": addr.netmask if addr.netmask else None,
					"broadcast": addr.broadcast if addr.broadcast else None
				})
		
		interfaces.append(iface_info)
	
	return {"interfaces": interfaces, "timestamp": current_time}


