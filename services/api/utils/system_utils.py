"""System-related utility functions"""

from __future__ import annotations

import psutil


def get_cpu_temperature() -> float | None:
    """
    Get the current CPU temperature.
    
    Returns:
        CPU temperature in Celsius, or None if not available
    """
    try:
        temp = psutil.sensors_temperatures()
        if 'cpu_thermal' in temp:
            return temp['cpu_thermal'][0].current
        elif 'coretemp' in temp:
            return temp['coretemp'][0].current
        return None
    except (AttributeError, KeyError, IndexError):
        return None
