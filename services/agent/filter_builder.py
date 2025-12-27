"""BPF filter generation and validation."""

from __future__ import annotations

import re
from typing import Any


def build_bpf_filter(settings: dict[str, Any]) -> str:
    """
    Build a BPF filter string from profile settings.
    
    Args:
        settings: Profile settings dictionary containing filter configuration
        
    Returns:
        Complete BPF filter string (can be empty if no filters configured)
    """
    filters: list[str] = []

    # Protocol filter (new schema: filterProtocols)
    protocols_raw = settings.get("filterProtocols") or settings.get("protocols")
    if isinstance(protocols_raw, list):
        protocol_map = {
            "tcp": "tcp",
            "udp": "udp",
            "icmp": "icmp",
            "arp": "arp",
            "ip": "ip",
            "ip6": "ip6",
            # Legacy uppercase mappings
            "TCP": "tcp",
            "UDP": "udp",
            "ICMP": "icmp",
            "ARP": "arp",
            "PTP": "udp port 319 or udp port 320",
            "PROFINET": "ether proto 0x8892",
        }
        translated = []
        for item in protocols_raw:
            if not isinstance(item, str):
                continue
            key = item.strip()
            mapped = protocol_map.get(key) or protocol_map.get(key.upper())
            if mapped:
                translated.append(mapped)
            elif key:
                translated.append(key.lower())
        if translated:
            filters.append(f"({' or '.join(translated)})")

    # Host filter (new schema: filterHosts)
    host_filter = settings.get("filterHosts") or settings.get("macIpFilter")
    if isinstance(host_filter, str) and host_filter.strip():
        filters.append(f"host {host_filter.strip()}")

    # Port filter (new schema: filterPorts)
    port_filter = settings.get("filterPorts")
    if isinstance(port_filter, str) and port_filter.strip():
        filters.append(f"port {port_filter.strip()}")

    # VLAN filter (new schema: filterVlanId)
    vlan_id = settings.get("filterVlanId") or settings.get("vlanId")
    try:
        vlan_int = int(vlan_id)
    except (TypeError, ValueError):
        vlan_int = None
    if vlan_int and vlan_int > 0:
        filters.append(f"vlan {vlan_int}")

    # TSN-specific filters (new schema)
    # Wichtig: gPTP (ether proto 0x88f7) und PTPv2 über UDP schließen sich aus!
    # gPTP ist Layer-2, PTPv2-UDP erfordert IP-Stack
    tsn_filters: list[str] = []
    
    capture_tsn_sync = settings.get("captureTsnSync") or settings.get("tsn8021as")
    capture_ptp = settings.get("capturePtp") or settings.get("ptpStatus")
    capture_vlan = settings.get("captureVlanTagged") or settings.get("qbuPreemption")
    
    # Wenn beide PTP-Optionen aktiv sind, kombiniere sie mit OR (nicht AND!)
    if capture_tsn_sync and capture_ptp:
        # gPTP (Layer-2) ODER PTPv2 über UDP/IP
        if capture_vlan:
            # Mit VLAN-Anforderung: nur gPTP mit VLAN (PTPv2-UDP läuft meist untagged)
            tsn_filters.append("(vlan and ether proto 0x88f7)")
        else:
            # Ohne VLAN: beide Varianten erlauben
            tsn_filters.append("(ether proto 0x88f7 or (udp port 319 or udp port 320))")
    elif capture_tsn_sync:
        # Nur gPTP (802.1AS)
        if capture_vlan:
            tsn_filters.append("(vlan and ether proto 0x88f7)")
        else:
            tsn_filters.append("ether proto 0x88f7")
    elif capture_ptp:
        # Nur PTPv2 über UDP/IP
        tsn_filters.append("(udp port 319 or udp port 320)")
    elif capture_vlan:
        # Nur VLAN-getaggte Frames (kein spezifisches Protokoll)
        tsn_filters.append("vlan")
    
    # TSN-Filter zu Gesamt-Filterliste hinzufügen
    filters.extend(tsn_filters)

    # TSN priority filter
    tsn_priority = settings.get("tsnPriorityFilter")
    if tsn_priority is not None:
        try:
            prio = int(tsn_priority)
            if 0 <= prio <= 7:
                filters.append(f"vlan and ether[14:2] & 0xe000 = {prio << 13}")
        except (TypeError, ValueError):
            pass

    # Custom BPF filter
    custom_filter = settings.get("bpfFilter")
    if isinstance(custom_filter, str) and custom_filter.strip():
        filters.append(f"({custom_filter.strip()})")

    return " and ".join(filters)


def validate_bpf_filter(bpf_filter: str) -> bool:
    """
    Basic BPF filter validation (checks for suspicious patterns).
    
    This is a simple heuristic check, not a full BPF parser.
    
    Args:
        bpf_filter: BPF filter string to validate
        
    Returns:
        True if filter looks valid, False otherwise
    """
    # Check for common BPF keywords that indicate valid syntax
    bpf_keywords = [
        'host', 'net', 'port', 'src', 'dst', 'and', 'or', 'not',
        'tcp', 'udp', 'icmp', 'ip', 'ip6', 'arp', 'ether', 'vlan',
        'portrange', 'proto', 'broadcast', 'multicast', 'less', 'greater'
    ]
    
    # Strip and check length
    bpf_filter = bpf_filter.strip()
    if not bpf_filter or len(bpf_filter) > 1000:  # Reasonable limit
        return False
    
    # Check for balanced parentheses
    if bpf_filter.count('(') != bpf_filter.count(')'):
        return False
    
    # Check if at least one keyword is present (basic sanity check)
    lower_filter = bpf_filter.lower()
    has_keyword = any(keyword in lower_filter for keyword in bpf_keywords)
    
    # Also allow simple numeric expressions like "port 80" or IP addresses
    has_port_or_ip = re.search(r'\d+', bpf_filter) is not None
    
    return has_keyword or has_port_or_ip


def validate_interface_name(name: str) -> bool:
    """
    Validate interface name (basic check for reasonable characters).
    
    Args:
        name: Interface name to validate
        
    Returns:
        True if name looks valid, False otherwise
    """
    # Allow alphanumeric, dash, underscore, dot (common in interface names)
    # e.g., eth0, wlan0, enp0s3, br-lan, vlan.100, tap0
    if not name or len(name) > 15:  # Linux interface names max 15 chars
        return False
    # Check for reasonable characters only
    return re.match(r'^[a-zA-Z0-9._-]+$', name) is not None
