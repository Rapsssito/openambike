#!/usr/bin/env python3
"""Pair (bond) this computer's Bluetooth adapter with an Ampler bike.

Bluetooth pairing only, through BlueZ: it registers a pairing agent, asks the
bike to pair, and asks for the code the bike shows on its display. It reads,
writes and subscribes to no characteristic. The bike's address and the bond
are private data: keep any saved output in private/.

Usage:
    python tools/pair.py                 # scan for the bike, then pair
    python tools/pair.py --address ADDR  # pair with this address
    python tools/pair.py --remove ADDR   # remove this computer's bond with ADDR
"""

import argparse
import asyncio
import sys

from bleak import BleakScanner
from dbus_fast import BusType, DBusError
from dbus_fast.aio import MessageBus
from dbus_fast.service import ServiceInterface, method

NAME_PREFIX = "AMPLER"
BLUEZ = "org.bluez"
AGENT_PATH = "/org/openambike/agent"


def ask(prompt: str) -> str:
    print(prompt, flush=True)
    line = sys.stdin.readline()
    if not line:
        raise SystemExit("No answer on standard input.")
    return line.strip()


class Agent(ServiceInterface):
    """BlueZ pairing agent that shows or asks for the code on the terminal."""

    def __init__(self):
        super().__init__("org.bluez.Agent1")

    @method()
    def Release(self):
        pass

    @method()
    def RequestPasskey(self, device: "o") -> "u":
        return int(ask("Type the code the bike shows on its display, then Enter:"))

    @method()
    def RequestPinCode(self, device: "o") -> "s":
        return ask("Type the PIN the bike shows on its display, then Enter:")

    @method()
    def DisplayPasskey(self, device: "o", passkey: "u", entered: "q"):
        print(f"Code to enter on the bike: {passkey:06d}", flush=True)

    @method()
    def DisplayPinCode(self, device: "o", pincode: "s"):
        print(f"PIN to enter on the bike: {pincode}", flush=True)

    @method()
    def RequestConfirmation(self, device: "o", passkey: "u"):
        answer = ask(f"Does the bike show the code {passkey:06d}? Type yes or no, then Enter:")
        if answer.lower() not in ("y", "yes"):
            raise DBusError("org.bluez.Error.Rejected", "Code not confirmed")

    @method()
    def RequestAuthorization(self, device: "o"):
        pass

    @method()
    def AuthorizeService(self, device: "o", uuid: "s"):
        pass

    @method()
    def Cancel(self):
        print("Pairing cancelled by the bike or by BlueZ.", flush=True)


async def find_bike(timeout: float) -> str:
    print(f"Scanning {timeout:.0f} s for names starting with {NAME_PREFIX}…", flush=True)
    found = await BleakScanner.discover(timeout=timeout, return_adv=True, scanning_mode="active")
    for device, adv in found.values():
        if (adv.local_name or device.name or "").upper().startswith(NAME_PREFIX):
            print(f"Found {adv.local_name or device.name}, RSSI {adv.rssi} dBm.", flush=True)
            return device.address
    raise SystemExit("No bike found. Is it awake, near, and not connected to the phone?")


async def device_interface(bus: MessageBus, address: str):
    path = f"/org/bluez/hci0/dev_{address.upper().replace(':', '_')}"
    introspection = await bus.introspect(BLUEZ, path)
    obj = bus.get_proxy_object(BLUEZ, path, introspection)
    return obj.get_interface("org.bluez.Device1"), path


async def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--address", help="pair with this address instead of scanning")
    parser.add_argument("--remove", metavar="ADDR", help="remove this computer's bond with this address")
    parser.add_argument("--timeout", type=float, default=15.0, help="scan timeout in seconds")
    args = parser.parse_args()

    bus = await MessageBus(bus_type=BusType.SYSTEM).connect()

    if args.remove:
        path = f"/org/bluez/hci0/dev_{args.remove.upper().replace(':', '_')}"
        adapter = bus.get_proxy_object(BLUEZ, "/org/bluez/hci0", await bus.introspect(BLUEZ, "/org/bluez/hci0"))
        await adapter.get_interface("org.bluez.Adapter1").call_remove_device(path)
        print("Bond removed from this computer.")
        return 0

    address = args.address or await find_bike(args.timeout)
    agent = Agent()
    bus.export(AGENT_PATH, agent)
    manager_obj = bus.get_proxy_object(BLUEZ, "/org/bluez", await bus.introspect(BLUEZ, "/org/bluez"))
    manager = manager_obj.get_interface("org.bluez.AgentManager1")
    await manager.call_register_agent(AGENT_PATH, "KeyboardDisplay")
    await manager.call_request_default_agent(AGENT_PATH)
    try:
        device, _ = await device_interface(bus, address)
        if await device.get_paired():
            print("Already paired with this computer.")
            return 0
        print("Pairing… watch the bike's display.", flush=True)
        await device.call_pair()
        await device.set_trusted(True)
        print(f"Paired: {await device.get_paired()}.")
        try:
            await device.call_disconnect()
        except DBusError:
            pass
        return 0
    except DBusError as error:
        print(f"Pairing failed: {error.type}: {error.text}")
        return 3
    finally:
        await manager.call_unregister_agent(AGENT_PATH)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
