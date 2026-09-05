"""
Power telemetry simulator.

Generates IT power and facility power readings per server, standing in for
smart PDUs / UPS management interfaces / BMS power meters.

Facility power = IT power + cooling overhead + UPS/other losses.

S6 is included as a deliberately idle Compute server so that the
Consolidation What-if calculation produces a visible energy,
carbon, and cost saving.

Usage:
    python power_monitor.py
"""

import random
import time
import requests


API_BASE = "http://localhost:8000"

# S6 added
SERVER_IDS = ["S1", "S2", "S3", "S4", "S5", "S6"]

INTERVAL_SECONDS = 15


def generate_reading(server_id):
    """
    Generate IT and facility power.

    S6 has a lower power range because it represents the deliberately
    underutilized server used for the consolidation demo.
    """

    if server_id == "S6":
        # Deliberately low but non-zero power consumption.
        # This makes the Consolidate What-if meaningful.
        it_power = round(random.uniform(1.2, 1.8), 2)

    else:
        it_power = round(
            random.uniform(1.5, 4.5),
            2
        )

    # Facility overhead factor -> PUE
    overhead_ratio = random.uniform(
        1.15,
        1.55
    )

    facility_power = round(
        it_power * overhead_ratio,
        2
    )

    return {
        "server_id": server_id,
        "it_power_kw": it_power,
        "facility_power_kw": facility_power,
    }


def main():

    print("=" * 60)
    print("GreenOps Power Telemetry Simulator")
    print("=" * 60)

    print(
        f"\nPower monitor running."
        f" Posting every {INTERVAL_SECONDS}s."
    )

    print(
        "Servers:",
        ", ".join(SERVER_IDS)
    )

    print(
        "\nS6 is configured as the low-utilization "
        "consolidation demo server."
    )

    print("\nPress Ctrl+C to stop.\n")

    while True:

        for sid in SERVER_IDS:

            reading = generate_reading(sid)

            try:

                response = requests.post(
                    f"{API_BASE}/telemetry/power",
                    json=reading,
                    timeout=5,
                )

                if response.status_code != 200:

                    print(
                        f"[power] {sid} -> "
                        f"{response.status_code} "
                        f"{response.text}"
                    )

                else:

                    print(
                        f"[power] {sid} -> "
                        f"IT {reading['it_power_kw']:.2f} kW | "
                        f"Facility {reading['facility_power_kw']:.2f} kW"
                    )

            except requests.exceptions.ConnectionError:

                print(
                    "[power] Backend not reachable, "
                    "retrying next cycle..."
                )

        time.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    main()