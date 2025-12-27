#!/usr/bin/env python3
"""
Test script to validate TSN filter generation logic.
Simulates the corrected _build_bpf_filter() behavior.
"""

from typing import Any


def build_bpf_filter(settings: dict[str, Any]) -> str:
    """Simuliert die korrigierte Filter-Generierung aus test_manager.py"""
    filters: list[str] = []
    
    # TSN-specific filters
    tsn_filters: list[str] = []
    
    capture_tsn_sync = settings.get("captureTsnSync", False)
    capture_ptp = settings.get("capturePtp", False)
    capture_vlan = settings.get("captureVlanTagged", False)
    
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
    
    return " and ".join(filters) if filters else ""


def test_scenarios():
    """Test verschiedene TSN-Filter-Szenarien"""
    
    print("=" * 80)
    print("TSN BPF Filter Generation Tests")
    print("=" * 80)
    
    scenarios = [
        {
            "name": "Standard TSN Profile (ALT - FEHLERHAFT)",
            "settings": {
                "captureTsnSync": True,
                "capturePtp": True,
                "captureVlanTagged": True,
            },
            "old_result": "ether proto 0x88f7 and (udp port 319 or udp port 320) and vlan",
            "expected": "(vlan and ether proto 0x88f7)",
            "reason": "gPTP mit VLAN-Anforderung (PTPv2-UDP meist untagged)",
        },
        {
            "name": "Nur gPTP (IEEE 802.1AS)",
            "settings": {
                "captureTsnSync": True,
                "capturePtp": False,
                "captureVlanTagged": False,
            },
            "expected": "ether proto 0x88f7",
            "reason": "Layer-2 gPTP ohne VLAN-Anforderung",
        },
        {
            "name": "Nur gPTP mit VLAN",
            "settings": {
                "captureTsnSync": True,
                "capturePtp": False,
                "captureVlanTagged": True,
            },
            "expected": "(vlan and ether proto 0x88f7)",
            "reason": "gPTP nur auf VLAN-getaggten Frames",
        },
        {
            "name": "Nur PTPv2 über UDP/IP",
            "settings": {
                "captureTsnSync": False,
                "capturePtp": True,
                "captureVlanTagged": False,
            },
            "expected": "(udp port 319 or udp port 320)",
            "reason": "PTPv2 über UDP (nicht TSN-Standard)",
        },
        {
            "name": "Mixed Mode: gPTP ODER PTPv2-UDP",
            "settings": {
                "captureTsnSync": True,
                "capturePtp": True,
                "captureVlanTagged": False,
            },
            "expected": "(ether proto 0x88f7 or (udp port 319 or udp port 320))",
            "reason": "Beide PTP-Varianten mit OR-Verknüpfung",
        },
        {
            "name": "Nur VLAN-Tagged Frames",
            "settings": {
                "captureTsnSync": False,
                "capturePtp": False,
                "captureVlanTagged": True,
            },
            "expected": "vlan",
            "reason": "Alle VLAN-getaggten Frames ohne Protokoll-Filter",
        },
        {
            "name": "Keine TSN-Filter",
            "settings": {
                "captureTsnSync": False,
                "capturePtp": False,
                "captureVlanTagged": False,
            },
            "expected": "",
            "reason": "Kein Filter (alle Pakete)",
        },
    ]
    
    for i, scenario in enumerate(scenarios, 1):
        print(f"\n{i}. {scenario['name']}")
        print("-" * 80)
        
        result = build_bpf_filter(scenario["settings"])
        expected = scenario["expected"]
        
        print(f"   Settings:")
        for key, value in scenario["settings"].items():
            print(f"      {key}: {value}")
        
        print(f"\n   Expected: {expected or '(kein Filter)'}")
        print(f"   Got:      {result or '(kein Filter)'}")
        
        if "old_result" in scenario:
            print(f"   OLD (❌): {scenario['old_result']}")
        
        print(f"\n   Reason:   {scenario['reason']}")
        
        if result == expected:
            print("   Status:   ✅ PASS")
        else:
            print("   Status:   ❌ FAIL")
    
    print("\n" + "=" * 80)


if __name__ == "__main__":
    test_scenarios()
