# Getting your owner key

OpenAMBike needs your bike's owner key to connect: a fixed text of 28 characters that the official Ampler app wrote to your bike when you first paired it, and sends again on every connection. It is the identifier of your Ampler account ([protocol.md](protocol.md), "Connection and authentication"). Neither the bike nor any screen of the official app shows it, but a Bluetooth log of the official app connecting to the bike holds it. This guide gets it from that log, with OpenAMBike itself or with a script on a computer.

## Contents

- [Before you start](#before-you-start)
- [1. Record the official app connecting](#1-record-the-official-app-connecting)
- [2. Take a bug report](#2-take-a-bug-report)
- [3. Read the key from the bug report](#3-read-the-key-from-the-bug-report)
- [4. Clean up](#4-clean-up)
- [If it does not work](#if-it-does-not-work)

## Before you start

You need:

- **An Android phone where the official app still connects to your bike.** The official app sends the key it keeps on the phone, with no call to Ampler's servers, so it works as long as the app still opens and connects. With an iPhone, this guide does not apply: recording Bluetooth on an iPhone has not been tried.
- **OpenAMBike** on the phone (the Android app, or the web app in Chrome), to read the key from the log. Instead, a computer with Python 3, on Linux, macOS or Windows, and a copy of [the repository](https://github.com/Rapsssito/openambike) can read it.

Keep the key secret: anyone who has it can unlock and control your bike. OpenAMBike keeps it encrypted on your device and can export an encrypted backup.

If you no longer have the official app or your Ampler account, there is no known way to get the key yet; whether a bike accepts a new one is the first item of the [roadmap](roadmap.md).

## 1. Record the official app connecting

1. On the phone, turn on the developer options: Settings, About phone, tap "Build number" seven times. Where it is depends on the phone's maker.
2. In Settings, System, Developer options, set "Bluetooth HCI snoop log" to **Enabled**. "Enabled Filtered" may leave the key out of the log.
3. Turn Bluetooth off and on again, so that the phone starts recording.
4. Near the bike, open the official app and wait until it shows the bike connected. Then close the official app.

## 2. Take a bug report

The phone saves the Bluetooth log inside a bug report, a `.zip` file. Either:

- **On the phone:** in Developer options, "Take bug report", then "Full report". After a few minutes a notification offers to share it; save it to the phone's files, or send it to your computer to read it there.
- **With ADB:** connected to the phone, run `adb bugreport bugreport.zip` on the computer.

## 3. Read the key from the bug report

### With OpenAMBike

1. Close the official app, and open OpenAMBike.
2. On the connect screen, tap "Read from a bug report" and choose the bug report's `.zip`.
3. OpenAMBike fills in the owner key. Tap "Connect": once the bike accepts it, OpenAMBike keeps it on that device.

OpenAMBike reads the file on the phone only: it sends nothing anywhere and keeps nothing of the bug report but the key, once the bike accepts it. In the web app, the bug report can also be read on a computer, in Chrome or Edge.

### With a computer

From the `reverse-engineering/` folder of a copy of [the repository](https://github.com/Rapsssito/openambike) (`git clone https://github.com/Rapsssito/openambike.git`), run:

```sh
python3 tools/owner_key.py path/to/bugreport.zip
```

On Windows, the command may be `python` or `py` instead of `python3`.

It prints the owner key: 28 characters on one line. Type it into OpenAMBike's connect screen; once the bike accepts it, OpenAMBike keeps it on that device. The script reads the file on your computer only, sends nothing anywhere and saves nothing.

### Then

Use "Export the key", in OpenAMBike's Settings, with or without the bike connected, to keep an encrypted backup somewhere safe.

## 4. Clean up

- Delete the bug report from the phone, and from the computer if you sent it there: it holds your owner key, and also your phone's logs, addresses and possibly your location.
- Set "Bluetooth HCI snoop log" back to **Disabled**.

## If it does not work

OpenAMBike and the script say what they found:

- **No Bluetooth log in the bug report:** the snoop log was off, or Bluetooth was not turned off and on after turning it on. Repeat steps 1 and 2.
- **The log does not show the official app connecting:** the official app connected before the recording started, or the log was "Enabled Filtered". Repeat steps 1 and 2.
- **The bike accepted no key:** the official app did not authenticate in that recording. Repeat from step 1, step 4.
- **More than one key:** the log holds more than one bike or more than one account. Try each one in OpenAMBike; only the right one is accepted.
