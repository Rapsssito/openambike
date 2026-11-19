#!/usr/bin/env python3
"""Talk to a paired Ampler G2 bike: authenticate, read live data, send documented commands.

Implements docs/protocol.md for the Stellar of 2022 (G2, firmware 3.9.0). The
computer must already be paired with the bike (tools/pair.py), and the
official app must not be connected. Every write asks for confirmation on the
terminal first. The owner key is read from private/keys/owner-key.txt and is
never printed.

Usage:
    python tools/cli.py status                 # authenticate and read the current values
    python tools/cli.py live [SECONDS]         # print battery and ride data as the bike notifies them
    python tools/cli.py iot                    # request the IoT state; private fields are masked
    python tools/cli.py assist 0|1|2           # no assist, mode 1 or mode 2
    python tools/cli.py lights on|off
    python tools/cli.py lock | unlock
    python tools/cli.py gnss on|off
    python tools/cli.py gsm on|off
    python tools/cli.py levels MODE SPEED AMOUNT   # mode 1 or 2; speed 10-25 km/h; amount 40-100 %
    python tools/cli.py restart                # restart the bike's firmware
    python tools/cli.py sleep                  # put the bike to sleep; only the charger wakes it
    python tools/cli.py calibrate              # torque sensor calibration ("Calibrate Sensor" in the official app)

Not offered: firmware updates, speed pedelec settings, factory reset, factory
motor calibration, time synchronisation and recaps, whose formats or conditions the
specification does not give.
"""

import argparse
import asyncio
import json
import re
import struct
import sys
from pathlib import Path

from bleak import BleakClient, BleakScanner
from bleak.exc import BleakError

NAME_PREFIX = "AMPLER"
KEY_FILE = Path(__file__).resolve().parent.parent / "private" / "keys" / "owner-key.txt"


def uuid(short: str) -> str:
    return f"fa5b81{short}-9b7b-452e-9a46-0a3313cbab03"


AUTH = uuid("a0")
GNSS = uuid("a2")
ASSIST_MODE = uuid("a3")
ASSIST_LEVELS = uuid("a4")
LIGHTS = uuid("a5")
BATTERY = uuid("a6")
FIRMWARE = uuid("a7")
LOCK = uuid("a8")
BATTERY_EXTENDED = uuid("ac")
GSM = uuid("ad")
ASI_METRICS = uuid("b0")
RANGE = uuid("b1")
RESET = uuid("b2")
STATE_MANAGEMENT = uuid("c4")
IOT_STATE = uuid("c7")
CALIBRATION = uuid("d2")
BMS_STATUS = uuid("c8")

AUTH_OK = b"owner ok"
IOT_END = b"EOM"
# The bike reports a new lights state up to about 0.7 s after the write; a read sooner returns the old one.
SETTLE_SECONDS = 1.5
IOT_PRIVATE = ("serial_number", "owner_key", "latitude", "longitude")


# Decoding (docs/protocol.md, "Data read from the bike"). Little-endian throughout.

def decode_battery(data: bytes) -> dict:
    millivolts, milliamps, percent = struct.unpack_from("<IhB", data, 0)
    out = {"voltage_V": millivolts / 1000, "current_mA": milliamps, "charge_pct": percent}
    if len(data) >= 11:
        out["absolute_soc"] = struct.unpack_from("<I", data, 7)[0]
    return out


def decode_battery_extended(data: bytes) -> dict:
    t1, t2 = struct.unpack_from("<hh", data, 2)
    return {"pack_temps_C": (t1 / 10, t2 / 10), "raw": data.hex(" ")}


def decode_asi_metrics(data: bytes) -> dict:
    odometer, motor_w, speed, factor_a, factor_b = struct.unpack_from("<IHHHH", data, 0)
    return {"odometer_km": odometer / 100, "speed_kmh": speed / 10, "motor_W": motor_w,
            "rider_W": round(factor_a * factor_b / 9.5488), "raw": data.hex(" ")}


def decode_levels(data: bytes) -> dict:
    def mode(speed, power, gain):
        return {"speed_kmh": round(10 + speed / 17, 1), "power_pct": round(40 + power * 60 / 255), "gain_pct": round(40 + gain * 60 / 255)}
    return {"mode1": mode(*data[0:3]), "mode2": mode(*data[3:6]), "raw": data.hex(" ")}


# Encoding (docs/protocol.md, "Commands sent to the bike").

def speed_byte(kmh: float) -> int:
    if not 10 <= kmh <= 25:
        raise SystemExit("Assist speed must be between 10 and 25 km/h.")
    return max(0, min(255, _round_half_up((kmh - 10) * 17)))


def _round_half_up(x: float) -> int:
    return int(x + 0.5) if x >= 0 else -int(-x + 0.5)


def amount_bytes(percent: float) -> tuple:
    """Power byte and gain byte for an assist amount, rounded as the bike's own app does (50 % gives 43 and 42)."""
    if not 40 <= percent <= 100:
        raise SystemExit("Assist amount must be between 40 and 100 %.")
    share = (percent - 40) / 60
    power = _round_half_up(share * 150 * 1.7)
    gain = _round_half_up(share * 100 * 2.55)
    return max(0, min(255, power)), max(0, min(255, gain))


def mask_iot(text: str) -> str:
    for field in IOT_PRIVATE:
        text = re.sub(rf'("{field}":)("[^"]*"|[-0-9.]+)', r'\1"<hidden>"', text)
    return text


def confirm(what: str, uuid_: str, value: bytes) -> bool:
    print(f"About to write to {uuid_[:8]}: {value.hex(' ')}  ({what})")
    print("Send it? Type yes, then Enter:", flush=True)
    answer = sys.stdin.readline().strip().lower()
    return answer in ("y", "yes")


class Bike:
    def __init__(self, client: BleakClient):
        self.client = client

    async def authenticate(self, key: bytes):
        reply = asyncio.get_running_loop().create_future()

        def on_auth(_, data: bytearray):
            if not reply.done():
                reply.set_result(bytes(data))

        await self.client.start_notify(AUTH, on_auth)
        await self.client.write_gatt_char(AUTH, key, response=True)
        try:
            answer = await asyncio.wait_for(reply, 5)
        except asyncio.TimeoutError:
            raise SystemExit("The bike did not answer the authentication.")
        finally:
            await self.client.stop_notify(AUTH)
        if answer != AUTH_OK:
            raise SystemExit(f"Authentication refused ({len(answer)} bytes answered).")
        print("Authenticated.")

    async def read(self, char: str) -> bytes:
        return bytes(await self.client.read_gatt_char(char))

    async def write(self, what: str, char: str, value: bytes) -> bool:
        if not confirm(what, char, value):
            print("Not sent.")
            return False
        await self.client.write_gatt_char(char, value, response=True)
        print("Sent.")
        await asyncio.sleep(SETTLE_SECONDS)
        return True

    async def iot_state(self) -> str:
        chunks = bytearray()
        done = asyncio.get_running_loop().create_future()

        def on_iot(_, data: bytearray):
            if bytes(data) == IOT_END:
                if not done.done():
                    done.set_result(None)
            else:
                chunks.extend(data)

        await self.client.start_notify(IOT_STATE, on_iot)
        try:
            if not await self.write("request the IoT state", IOT_STATE, b"\x00"):
                return ""
            await asyncio.wait_for(done, 10)
        finally:
            await self.client.stop_notify(IOT_STATE)
        return chunks.decode("utf-8", errors="replace")


async def status(bike: Bike):
    print("Battery:", decode_battery(await bike.read(BATTERY)))
    print("Battery extended:", decode_battery_extended(await bike.read(BATTERY_EXTENDED)))
    print("ASI metrics:", decode_asi_metrics(await bike.read(ASI_METRICS)))
    print("Range (raw):", (await bike.read(RANGE)).hex(" "))
    print("Assist mode:", (await bike.read(ASSIST_MODE))[0])
    print("Assist levels:", decode_levels(await bike.read(ASSIST_LEVELS)))
    lights = await bike.read(LIGHTS)
    print("Lights:", "on" if lights[1] else "off", f"(raw {lights.hex(' ')})")
    print("Lock:", "locked" if (await bike.read(LOCK))[0] else "unlocked")
    print("GNSS:", "on" if (await bike.read(GNSS))[0] else "off")
    print("GSM:", "on" if (await bike.read(GSM))[0] else "off")
    print("Firmware:", (await bike.read(FIRMWARE)).rstrip(b"\x00").decode("ascii", errors="replace"))
    print("Battery firmware status:", (await bike.read(BMS_STATUS)).decode("ascii", errors="replace"))


async def live(bike: Bike, seconds: float):
    def show(name, decoder):
        return lambda _, data: print(f"{name}: {decoder(bytes(data))}", flush=True)
    await bike.client.start_notify(BATTERY, show("battery", decode_battery))
    await bike.client.start_notify(ASI_METRICS, show("ride", decode_asi_metrics))
    print(f"Listening {seconds:.0f} s…")
    await asyncio.sleep(seconds)


async def run(args, key: bytes):
    print(f"Scanning for names starting with {NAME_PREFIX}…")
    device = await BleakScanner.find_device_by_filter(
        lambda d, adv: (adv.local_name or d.name or "").upper().startswith(NAME_PREFIX), timeout=20)
    if device is None:
        raise SystemExit("No bike found. Is it awake, near, and the official app disconnected?")
    async with BleakClient(device, timeout=20) as client:
        bike = Bike(client)
        await bike.authenticate(key)
        c = args.command
        if c == "status":
            await status(bike)
        elif c == "live":
            await live(bike, args.value and float(args.value) or 30)
        elif c == "iot":
            text = await bike.iot_state()
            if text:
                try:
                    print(json.dumps(json.loads(mask_iot(text)), indent=2))
                except json.JSONDecodeError:
                    print(mask_iot(text))
        elif c == "assist":
            if args.value not in ("0", "1", "2"):
                raise SystemExit("Assist mode must be 0, 1 or 2.")
            await bike.write(f"assist mode {args.value}", ASSIST_MODE, bytes([int(args.value)]))
            print("Assist mode now:", (await bike.read(ASSIST_MODE))[0])
        elif c == "lights":
            if args.value not in ("on", "off"):
                raise SystemExit("Lights must be on or off.")
            await bike.write(f"lights {args.value}", LIGHTS, bytes([1, 1 if args.value == "on" else 0]))
            print("Lights now:", (await bike.read(LIGHTS)).hex(" "))
        elif c in ("lock", "unlock"):
            await bike.write(c, LOCK, bytes([1 if c == "lock" else 0]))
            print("Lock now:", "locked" if (await bike.read(LOCK))[0] else "unlocked")
        elif c in ("gnss", "gsm"):
            if args.value not in ("on", "off"):
                raise SystemExit(f"{c.upper()} must be on or off.")
            char = GNSS if c == "gnss" else GSM
            await bike.write(f"{c.upper()} {args.value}", char, bytes([1 if args.value == "on" else 0]))
            print(f"{c.upper()} now:", "on" if (await bike.read(char))[0] else "off")
        elif c == "levels":
            if args.value not in ("1", "2") or len(args.extra) != 2:
                raise SystemExit("Usage: levels MODE SPEED AMOUNT, with MODE 1 or 2.")
            speed, amount = float(args.extra[0]), float(args.extra[1])
            current = await bike.read(ASSIST_LEVELS)
            print("Current:", decode_levels(current))
            new = bytearray(current[:6])
            at = 0 if args.value == "1" else 3
            new[at:at + 3] = bytes([speed_byte(speed), *amount_bytes(amount)])
            print("New:    ", decode_levels(bytes(new)))
            await bike.write(f"mode {args.value}: {speed:g} km/h, {amount:g} %", ASSIST_LEVELS, bytes(new))
            print("Now:    ", decode_levels(await bike.read(ASSIST_LEVELS)))
        elif c == "restart":
            await bike.write("restart the bike's firmware", RESET, b"reset")
        elif c == "calibrate":
            await bike.write("start torque sensor calibration", CALIBRATION, b"\x00")
        elif c == "sleep":
            await bike.write("put the bike to sleep; only the charger wakes it", STATE_MANAGEMENT, b"shutdown")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=["status", "live", "iot", "assist", "lights", "lock", "unlock", "gnss", "gsm", "levels", "restart", "sleep", "calibrate"])
    parser.add_argument("value", nargs="?")
    parser.add_argument("extra", nargs="*")
    parser.add_argument("--key", type=Path, default=KEY_FILE, help="file holding the owner key")
    args = parser.parse_args()
    key = args.key.read_text().strip().encode("ascii")
    if len(key) != 28:
        raise SystemExit(f"{args.key}: expected a 28-character owner key.")
    try:
        asyncio.run(run(args, key))
    except BleakError as error:
        raise SystemExit(f"Bluetooth error: {error}")


if __name__ == "__main__":
    main()
