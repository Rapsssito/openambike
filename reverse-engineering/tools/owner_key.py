#!/usr/bin/env python3
"""Find a bike's owner key in a Bluetooth capture of the official app connecting to it.

Reads an Android bug report (the .zip that "Take bug report" or `adb bugreport`
makes) or a btsnoop_hci.log taken from one, and prints the owner key the
official app wrote to the bike's auth characteristic (fa5b81a0) when the bike
answered "owner ok" (docs/protocol.md, "Connection and authentication").
Nothing is sent anywhere and nothing is written to disk.

The key is printed on the terminal because that is what this tool is for: type
it into OpenAMBike, then delete the bug report, which holds the key and other
private data. Anyone with the key controls the bike.

Usage:
    python tools/owner_key.py BUGREPORT.zip
    python tools/owner_key.py btsnoop_hci.log
"""

import argparse
import io
import struct
import sys
import zipfile

from sniff_parse import Gatt, att_pdus

AUTH_UUID = "fa5b81a0-9b7b-452e-9a46-0a3313cbab03"
OWNER_OK = b"owner ok"
KEY_LENGTH = 28
OPCODE_READ_BY_TYPE_REQ = 0x08
OPCODE_WRITE_REQ = 0x12
OPCODE_NOTIFY = 0x1B
OPCODE_INDICATE = 0x1D


def snoop_logs(path):
    """Yield (name, binary file) for each btsnoop log in a bug report, or the file itself."""
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as bugreport:
            names = [n for n in bugreport.namelist() if n.rsplit("/", 1)[-1].startswith("btsnoop_hci.log")]
            for name in names:
                yield name, io.BytesIO(bugreport.read(name))
    else:
        yield path, open(path, "rb")


def accepted_keys(log):
    """Return (accepted keys, auth writes seen, whether the auth characteristic was found) for one log."""
    pdus = list(att_pdus(log))
    gatt = Gatt()
    request_type = {}
    for _, received, connection, pdu in pdus:
        if not received and pdu[0] == OPCODE_READ_BY_TYPE_REQ and len(pdu) >= 7:
            request_type[connection] = struct.unpack_from("<H", pdu, 5)[0]
        if received:
            gatt.learn(pdu, request_type.get(connection))
    auth_handles = {h for h, (uuid, _) in gatt.characteristics.items() if uuid == AUTH_UUID}

    keys = []
    writes = 0
    pending = {}  # connection -> key written, waiting for the bike's answer
    for _, received, connection, pdu in pdus:
        if len(pdu) < 3 or struct.unpack_from("<H", pdu, 1)[0] not in auth_handles:
            continue
        value = pdu[3:]
        if not received and pdu[0] == OPCODE_WRITE_REQ:
            writes += 1
            pending[connection] = value
        elif received and pdu[0] in (OPCODE_NOTIFY, OPCODE_INDICATE) and value == OWNER_OK:
            key = pending.pop(connection, None)
            if key is not None and len(key) == KEY_LENGTH and key not in keys:
                keys.append(key)
    return keys, writes, bool(auth_handles)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("capture", help="a bug report .zip or a btsnoop_hci.log")
    args = parser.parse_args()

    keys, writes, found_auth, logs = [], 0, False, 0
    for _, log in snoop_logs(args.capture):
        logs += 1
        with log:
            log_keys, log_writes, log_found = accepted_keys(log)
        keys += [k for k in log_keys if k not in keys]
        writes += log_writes
        found_auth = found_auth or log_found

    if logs == 0:
        print("No Bluetooth log in this bug report. Turn on \"Bluetooth HCI snoop log\" in the developer options, "
              "turn Bluetooth off and on, connect with the official app, then take the bug report again.", file=sys.stderr)
        return 1
    if not keys:
        if not found_auth:
            print("The log does not show the official app connecting to the bike. Connect with the official app after "
                  "turning on the snoop log, and set the snoop log to \"Enabled\", not \"Enabled Filtered\".", file=sys.stderr)
        elif writes:
            print("The official app wrote to the bike, but the bike accepted no 28-character key in this log. "
                  "If the snoop log is \"Enabled Filtered\", set it to \"Enabled\" and capture again.", file=sys.stderr)
        else:
            print("The log shows the bike, but no key written to it. Connect with the official app again and "
                  "take a new bug report.", file=sys.stderr)
        return 1

    for key in keys:
        try:
            print(key.decode("ascii"))
        except UnicodeDecodeError:
            print(key.hex(" "))
    if len(keys) > 1:
        print("More than one bike, or more than one owner, accepted a key in this log: each key is on its own line.",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
