#!/usr/bin/env python3
"""List the GATT map and the ATT reads, writes and notifications of a Bluetooth capture.

Reads an Android btsnoop_hci.log (HCI UART, H4) directly. The GATT map is
rebuilt from the service and characteristic discovery found in the capture,
so each handle is shown with its UUID. Captures hold private data: run this
on files in private/ and keep its output there.

Usage:
    python tools/sniff_parse.py CAPTURE                 # every ATT read, write and notification
    python tools/sniff_parse.py CAPTURE --map           # the GATT map only
    python tools/sniff_parse.py CAPTURE --uuid fa5b81a6 # only handles whose UUID starts with this
    python tools/sniff_parse.py CAPTURE --hide fa5b81a6 # also replace the bytes of these UUIDs with their length
    python tools/sniff_parse.py CAPTURE --show-private  # show auth and IoT state bytes, hidden by default

Auth (fa5b81a0) and IoT state (fa5b81c7) bytes are hidden by default: they
carry key material, the owner key, the serial number and the bike's position.
"""

import argparse
import datetime
import struct
import sys
import uuid as uuidlib

BTSNOOP_MAGIC = b"btsnoop\x00"
# Microseconds between 0000-01-01 and 1970-01-01, as btsnoop timestamps count.
BTSNOOP_EPOCH_DELTA = 0x00DCDDB30F2F8000
H4_ACL = 0x02
ATT_CID = 0x0004
BASE_UUID_SUFFIX = "-0000-1000-8000-00805f9b34fb"

OPCODES = {
    0x01: "error",
    0x02: "mtu-req",
    0x03: "mtu-rsp",
    0x04: "find-info-req",
    0x05: "find-info-rsp",
    0x08: "read-by-type-req",
    0x09: "read-by-type-rsp",
    0x0A: "read-req",
    0x0B: "read-rsp",
    0x0C: "read-blob-req",
    0x0D: "read-blob-rsp",
    0x10: "read-by-group-req",
    0x11: "read-by-group-rsp",
    0x12: "write-req",
    0x13: "write-rsp",
    0x1B: "notify",
    0x1D: "indicate",
    0x1E: "confirm",
    0x52: "write-cmd",
}
PROPERTIES = [
    (0x01, "broadcast"),
    (0x02, "read"),
    (0x04, "write-no-rsp"),
    (0x08, "write"),
    (0x10, "notify"),
    (0x20, "indicate"),
    (0x40, "signed-write"),
    (0x80, "extended"),
]
CCCD = "00002902" + BASE_UUID_SUFFIX
# Hidden unless --show-private: auth (key material) and IoT state (owner key,
# serial number and last GNSS position).
PRIVATE_UUIDS = ["fa5b81a0", "fa5b81c7"]


def read_btsnoop(source):
    """Yield (time, received, h4_packet) for each record of a btsnoop file, given its path or an open binary file."""
    with open(source, "rb") if isinstance(source, (str, bytes)) or hasattr(source, "__fspath__") else source as f:
        header = f.read(16)
        if header[:8] != BTSNOOP_MAGIC:
            raise SystemExit(f"{getattr(f, 'name', source)}: not a btsnoop file")
        while True:
            record = f.read(24)
            if len(record) < 24:
                return
            _, included, flags, _, ts = struct.unpack(">IIIIq", record)
            data = f.read(included)
            when = datetime.datetime(1970, 1, 1) + datetime.timedelta(microseconds=ts - BTSNOOP_EPOCH_DELTA)
            yield when, bool(flags & 1), data


def att_pdus(source):
    """Yield (time, received, connection, pdu) for each ATT PDU, reassembling ACL fragments."""
    pending = {}
    for when, received, packet in read_btsnoop(source):
        if not packet or packet[0] != H4_ACL or len(packet) < 5:
            continue
        handle_flags, length = struct.unpack_from("<HH", packet, 1)
        connection = handle_flags & 0x0FFF
        boundary = (handle_flags >> 12) & 0x3
        payload = packet[5 : 5 + length]
        key = (connection, received)
        if boundary in (0x0, 0x2):  # first fragment
            pending[key] = bytearray(payload)
        elif key in pending:  # continuation
            pending[key] += payload
        else:
            continue
        buffer = pending[key]
        if len(buffer) < 4:
            continue
        l2cap_length, cid = struct.unpack_from("<HH", buffer, 0)
        if len(buffer) < 4 + l2cap_length:
            continue
        del pending[key]
        if cid == ATT_CID:
            yield when, received, connection, bytes(buffer[4 : 4 + l2cap_length])


def uuid_str(raw):
    if len(raw) == 2:
        return f"{struct.unpack('<H', raw)[0]:08x}" + BASE_UUID_SUFFIX
    return str(uuidlib.UUID(bytes=raw[::-1]))


def properties_str(value):
    return ", ".join(name for bit, name in PROPERTIES if value & bit)


class Gatt:
    """GATT map rebuilt from discovery responses."""

    def __init__(self):
        self.services = {}  # start handle -> (end handle, uuid)
        self.characteristics = {}  # value handle -> (uuid, properties)
        self.descriptors = {}  # handle -> uuid

    def learn(self, pdu, request_type):
        opcode = pdu[0]
        if opcode == 0x11 and len(pdu) > 2:
            size = pdu[1]
            for i in range(2, len(pdu) - size + 1, size):
                start, end = struct.unpack_from("<HH", pdu, i)
                self.services[start] = (end, uuid_str(pdu[i + 4 : i + size]))
        elif opcode == 0x09 and len(pdu) > 2 and request_type == 0x2803:
            size = pdu[1]
            for i in range(2, len(pdu) - size + 1, size):
                props = pdu[i + 2]
                value_handle = struct.unpack_from("<H", pdu, i + 3)[0]
                self.characteristics[value_handle] = (uuid_str(pdu[i + 5 : i + size]), props)
        elif opcode == 0x05 and len(pdu) > 2:
            size = 4 if pdu[1] == 1 else 18
            for i in range(2, len(pdu) - size + 1, size):
                handle = struct.unpack_from("<H", pdu, i)[0]
                self.descriptors[handle] = uuid_str(pdu[i + 2 : i + size])

    def name(self, handle):
        """UUID of a handle, a CCCD as 'cccd of <uuid>', or '?' when not discovered."""
        if handle in self.characteristics:
            return self.characteristics[handle][0]
        if self.descriptors.get(handle) == CCCD:
            owner = max((h for h in self.characteristics if h < handle), default=None)
            return f"cccd of {self.characteristics[owner][0]}" if owner is not None else "cccd"
        return self.descriptors.get(handle, "?")

    def service_of(self, handle):
        for start, (end, uuid) in self.services.items():
            if start <= handle <= end:
                return uuid
        return "?"


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("capture")
    parser.add_argument("--map", action="store_true", help="print the GATT map only")
    parser.add_argument("--uuid", action="append", default=[], help="only handles whose UUID starts with this (repeatable)")
    parser.add_argument("--hide", action="append", default=[], help="also hide the bytes of handles whose UUID starts with this (repeatable)")
    parser.add_argument("--show-private", action="store_true", help="show the bytes of the characteristics hidden by default")
    args = parser.parse_args()
    if not args.show_private:
        args.hide += PRIVATE_UUIDS

    gatt = Gatt()
    pdus = list(att_pdus(args.capture))
    request_type = {}
    for _, received, connection, pdu in pdus:
        if not received and pdu[0] == 0x08 and len(pdu) >= 7:
            request_type[connection] = struct.unpack_from("<H", pdu, 5)[0]
        if received:
            gatt.learn(pdu, request_type.get(connection))

    if args.map:
        for start, (end, uuid) in sorted(gatt.services.items()):
            print(f"service 0x{start:04x}-0x{end:04x}  {uuid}")
            for handle, (cuuid, props) in sorted(gatt.characteristics.items()):
                if start <= handle <= end:
                    print(f"  0x{handle:04x}  {cuuid}  [{properties_str(props)}]")
        return 0

    start_time = pdus[0][0] if pdus else None
    last_read = {}
    for when, received, connection, pdu in pdus:
        opcode = pdu[0]
        handle = None
        value = b""
        if opcode in (0x12, 0x52, 0x1B, 0x1D) and len(pdu) >= 3:
            handle = struct.unpack_from("<H", pdu, 1)[0]
            value = pdu[3:]
        elif opcode in (0x0A, 0x0C) and len(pdu) >= 3:
            handle = struct.unpack_from("<H", pdu, 1)[0]
            last_read[connection] = handle
        elif opcode in (0x0B, 0x0D):
            handle = last_read.get(connection)
            value = pdu[1:]
        elif opcode == 0x01 and len(pdu) >= 5:
            handle = struct.unpack_from("<H", pdu, 2)[0]
            value = pdu[4:5]
        else:
            continue
        if handle is None:
            continue
        name = gatt.name(handle)
        if args.uuid and not any(name.removeprefix("cccd of ").startswith(u) for u in args.uuid):
            continue
        shown = value.hex(" ")
        if any(name.removeprefix("cccd of ").startswith(h) for h in args.hide):
            shown = f"<{len(value)} bytes hidden>"
        direction = "bike→phone" if received else "phone→bike"
        elapsed = (when - start_time).total_seconds()
        print(f"{when:%H:%M:%S.%f}"[:-3] + f"  +{elapsed:8.3f}s  conn {connection:#05x}  {direction}  "
              f"{OPCODES.get(opcode, hex(opcode)):<9}  0x{handle:04x}  {name}  {shown}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
