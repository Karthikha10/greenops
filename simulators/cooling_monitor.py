"""
Cooling telemetry simulator.

Generates inlet temperature and cooling efficiency readings, standing in
for CRAC/chiller controllers and BMS environmental sensors.

Usage:
    python cooling_monitor.py
"""

import random
import time
import requests


API_BASE = "http://localhost:8000"


# ---------------------------------------------------------------------------
# Cooling configuration for each server
# ---------------------------------------------------------------------------

SERVER_COOLING = {
    "S1": "Air",
    "S2": "Air",
    "S3": "Evaporative",
    "S4": "Liquid",
    "S5": "Air",

    # S6 added
    "S6": "Air",
}


INTERVAL_SECONDS = 15


# ---------------------------------------------------------------------------
# Generate cooling telemetry
# ---------------------------------------------------------------------------

def generate_reading(server_id, cooling_type):

    # Inlet temperature in °C
    temperature = round(
        random.uniform(19, 27),
        2
    )

    # Cooling efficiency
    #
    # Higher value = better cooling efficiency.
    #
    # This is a simulated efficiency metric for the prototype.
    efficiency = round(
        max(
            0.4,
            min(
                0.99,
                random.gauss(0.82, 0.06)
            )
        ),
        3
    )

    return {
        "server_id": server_id,

        "inlet_temperature_c": temperature,

        "cooling_efficiency": efficiency,

        "cooling_type": cooling_type,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():

    print("=" * 60)
    print("GreenOps Cooling Telemetry Simulator")
    print("=" * 60)

    print(
        f"\nCooling monitor running."
        f" Posting every {INTERVAL_SECONDS}s."
    )

    print(
        "\nServers:",
        ", ".join(SERVER_COOLING.keys())
    )

    print("\nPress Ctrl+C to stop.\n")

    while True:

        for sid, cooling_type in SERVER_COOLING.items():

            reading = generate_reading(
                sid,
                cooling_type
            )

            try:

                response = requests.post(
                    f"{API_BASE}/telemetry/cooling",
                    json=reading,
                    timeout=5,
                )

                if response.status_code != 200:

                    print(
                        f"[cooling] {sid} -> "
                        f"{response.status_code} "
                        f"{response.text}"
                    )

                else:

                    print(
                        f"[cooling] {sid} -> "
                        f"Type {cooling_type} | "
                        f"Temperature "
                        f"{reading['inlet_temperature_c']:.1f} °C | "
                        f"Efficiency "
                        f"{reading['cooling_efficiency']:.3f}"
                    )

            except requests.exceptions.ConnectionError:

                print(
                    "[cooling] Backend not reachable, "
                    "retrying next cycle..."
                )

        time.sleep(INTERVAL_SECONDS)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    main()