#!/usr/bin/env python3
"""Find an Ampler bike over BLE and list its GATT services and characteristics.

Read-only by design: it scans, connects and discovers services, and never
reads, writes or subscribes to a characteristic. The output includes the
bike's address, which is private data: keep any saved output in private/.

Usage:
    python tools/scan.py                 # scan, list bikes, connect to the first one found
    python tools/scan.py --list          # scan and list bikes only, no connection
    python tools/scan.py --address ADDR  # connect to this address
"""

import argparse
import asyncio
import sys

from bleak import BleakClient, BleakScanner
from bleak.exc import BleakBluetoothNotAvailableError, BleakError

NAME_PREFIX = "AMPLER"
# Names the official app 3.0.9 and 3.1.7 give these UUIDs (docs/protocol.md, "GATT map").
KNOWN = {
    "fa5b81a0": "auth (service)",
    "fa5b81a1": "bike (service)",
    "fa5b81c0": "owner (service)",
    "fa5b81a2": "GNSS enabled",
    "fa5b81a3": "assist mode",
    "fa5b81a4": "assist levels",
    "fa5b81a5": "lights control",
    "fa5b81a6": "battery",
    "fa5b81a7": "firmware version",
    "fa5b81a8": "lock control",
    "fa5b81ab": "errors",
    "fa5b81ac": "battery extended",
    "fa5b81ad": "GSM enabled",
    "fa5b81af": "ASI faults",
    "fa5b81b0": "ASI metrics",
    "fa5b81b1": "range",
    "fa5b81b2": "reset",
    "fa5b81b5": "recaps",
    "fa5b81b6": "time synchronisation",
    "fa5b81c3": "factory reset",
    "fa5b81c4": "state management",
    "fa5b81c7": "IoT state",
    "fa5b81c8": "battery management system firmware status",
    "fa5b81c9": "battery management system firmware update progress",
    "fa5b81d2": "motor calibration",
}
BASE_SUFFIX = "-9b7b-452e-9a46-0a3313cbab03"
G1_SERVICE = "340d1528-a89e-4d4e-9078-06d21096ea36"


def label(uuid: str) -> str:
    uuid = uuid.lower()
    if uuid == G1_SERVICE:
        return "the official app treats a bike with this service as G1"
    if uuid.endswith(BASE_SUFFIX):
        return KNOWN.get(uuid[:8], "not named by the official app")
    return ""


async def scan(timeout: float):
    found = await BleakScanner.discover(timeout=timeout, return_adv=True)
    bikes = []
    for device, adv in found.values():
        name = adv.local_name or device.name or ""
        if name.upper().startswith(NAME_PREFIX):
            bikes.append((device, adv))
    for device, adv in bikes:
        print(f"{adv.local_name or device.name}  {device.address}  RSSI {adv.rssi} dBm")
        for uuid in adv.service_uuids:
            print(f"  advertised service {uuid}  {label(uuid)}")
        for company, data in adv.manufacturer_data.items():
            print(f"  manufacturer data, company 0x{company:04x}: {data.hex(' ')}")
        for uuid, data in adv.service_data.items():
            print(f"  service data {uuid}: {data.hex(' ')}")
    return [device for device, _ in bikes]


async def discover(address: str, timeout: float):
    print(f"\nConnecting to {address}…")
    async with BleakClient(address, timeout=timeout) as client:
        print(f"Connected. MTU {client.mtu_size}.\n")
        generation = "G2"
        for service in client.services:
            if service.uuid.lower() == G1_SERVICE:
                generation = "G1"
            print(f"Service {service.uuid}  {label(service.uuid)}")
            for char in service.characteristics:
                props = ", ".join(char.properties)
                print(f"  {char.uuid}  handle 0x{char.handle:04x}  [{props}]  {label(char.uuid)}")
        print(f"\nBy the official app's rule, this bike is {generation}.")


async def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--address", help="connect to this address instead of scanning")
    parser.add_argument("--list", action="store_true", help="scan only, do not connect")
    parser.add_argument("--timeout", type=float, default=10.0, help="scan and connection timeout in seconds")
    args = parser.parse_args()

    address = args.address
    if not address:
        print(f"Scanning {args.timeout:.0f} s for names starting with {NAME_PREFIX}…")
        bikes = await scan(args.timeout)
        if not bikes:
            print("No bike found. Is it awake, near, and the official app closed?")
            return 1
        if args.list:
            return 0
        address = bikes[0].address
    await discover(address, args.timeout)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except BleakBluetoothNotAvailableError as error:
        print(f"Bluetooth is not available: {error.args[0]} (on the host: rfkill unblock bluetooth, then bluetoothctl power on)")
        sys.exit(2)
    except BleakError as error:
        print(f"Connection failed: {error}")
        sys.exit(3)
