#!/usr/bin/env python3
"""
appletv driver — the only file that talks to pyatv.

Every subcommand prints exactly one JSON object on stdout and exits 0, even on
failure: the failure is *in* the JSON (`ok: false, error: <code>`), because the
node CLI on top maps codes to messages and fixes and a shell exit code cannot
carry either. Nothing here formats a table or decides a verdict — that is the
node half's job, so the verdict logic can be re-run offline over a frozen
capture in CI, where pyatv is never installed.

Runs from the venv `appletv doctor` creates. pyatv's own `atvremote` script is
not used: it calls `asyncio.get_event_loop()` at import time and crashes on
Python 3.12+; the library API is fine.
"""
import asyncio
import json
import os
import sys
import time
from datetime import datetime, timezone

USAGE = "driver.py <doctor|scan|pair|state|press|apps|launch|text> [--key value ...]"


def out(obj):
    sys.stdout.write(json.dumps(obj, default=str) + "\n")
    sys.stdout.flush()


def fail(error, detail=None, **extra):
    o = {"ok": False, "error": error}
    if detail is not None:
        o["detail"] = str(detail)
    extra.pop("ok", None)
    o.update(extra)
    out(o)
    return 0


def parse(argv):
    args = {"_": []}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a.startswith("--"):
            key = a[2:]
            if "=" in key:
                k, v = key.split("=", 1)
                args[k] = v
            elif i + 1 < len(argv) and not argv[i + 1].startswith("--"):
                args[key] = argv[i + 1]
                i += 1
            else:
                args[key] = True
        else:
            args["_"].append(a)
        i += 1
    return args


STORAGE_PATH = os.path.join(os.path.expanduser("~"), ".pyatv.conf")


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# doctor never imports pyatv at module level: its whole job is to say whether
# the import works.
# ---------------------------------------------------------------------------
def cmd_doctor(_args):
    info = {"ok": True, "python": sys.version.split()[0], "executable": sys.executable}
    try:
        from importlib.metadata import version

        info["pyatv"] = version("pyatv")
    except Exception as e:  # noqa: BLE001
        return fail("no_pyatv", e, python=info["python"], executable=sys.executable)
    try:
        import pyatv  # noqa: F401
        from pyatv.storage.file_storage import FileStorage

        FileStorage.default_storage(asyncio.new_event_loop())
        info["storage"] = STORAGE_PATH
    except Exception as e:  # noqa: BLE001
        return fail("pyatv_import_failed", e, **info)
    out(info)
    return 0


# ---------------------------------------------------------------------------
# pyatv helpers
# ---------------------------------------------------------------------------
def _pyatv():
    import pyatv
    from pyatv import exceptions
    from pyatv.const import FeatureName, FeatureState, Protocol
    from pyatv.storage.file_storage import FileStorage

    return pyatv, exceptions, FeatureName, FeatureState, Protocol, FileStorage


def _error_code(exc, exceptions):
    """Map a pyatv exception to a stable code the node side can explain."""
    name = type(exc).__name__
    msg = str(exc)
    if isinstance(exc, exceptions.DeviceIdMissingError):
        return "device_id_missing"
    if isinstance(exc, exceptions.NoServiceError):
        return "no_service"
    if isinstance(exc, exceptions.AuthenticationError):
        return "not_paired"
    if isinstance(exc, exceptions.PairingError):
        if "backoff" in msg.lower() or "too many" in msg.lower():
            return "pairing_backoff"
        return "pairing_failed"
    if isinstance(exc, exceptions.DeviceAuthenticationError):
        return "pairing_refused"
    if isinstance(exc, exceptions.ConnectionFailedError) or isinstance(exc, exceptions.ConnectionLostError):
        return "connection_failed"
    if isinstance(exc, exceptions.NotSupportedError) or isinstance(exc, NotImplementedError):
        return "unsupported_command"
    if isinstance(exc, exceptions.CommandError):
        return "command_refused"
    if isinstance(exc, exceptions.BlockedStateError):
        return "blocked_state"
    if isinstance(exc, exceptions.NonLocalSubnetError):
        return "non_local_subnet"
    if isinstance(exc, exceptions.ProtocolError):
        return "protocol_error"
    if isinstance(exc, (asyncio.TimeoutError, TimeoutError)):
        return "timeout"
    if isinstance(exc, OSError):
        return "network_unreachable"
    return f"unexpected:{name}"


def _device_json(conf, storage_names):
    services = []
    for s in conf.services:
        services.append(
            {
                "protocol": s.protocol.name.lower(),
                "port": s.port,
                "pairing": s.pairing.name,
                "paired": bool(s.credentials),
            }
        )
    di = conf.device_info
    return {
        "name": conf.name,
        "address": str(conf.address),
        "identifier": conf.identifier,
        "all_identifiers": list(conf.all_identifiers),
        "model": di.model_str,
        "raw_model": getattr(di, "raw_model", None),
        "os": di.operating_system.name if di.operating_system else None,
        "version": di.version,
        "build": di.build_number,
        "mac": di.mac,
        "deep_sleep": bool(conf.deep_sleep),
        "services": services,
    }


async def _scan(loop, storage, hosts=None, identifier=None, timeout=5):
    pyatv, *_ = _pyatv()
    kwargs = {"timeout": timeout, "storage": storage}
    if hosts:
        kwargs["hosts"] = hosts
    if identifier:
        kwargs["identifier"] = identifier
    return await pyatv.scan(loop, **kwargs)


def _is_apple_tv(conf):
    # A Mac advertises AirPlay too; only devices where some protocol can be or
    # is paired are things we can control.
    return any(s.pairing.name not in ("Unsupported",) for s in conf.services)


async def a_scan(args):
    pyatv, exceptions, *_rest, FileStorage = _pyatv()
    loop = asyncio.get_running_loop()
    storage = FileStorage.default_storage(loop)
    await storage.load()
    hosts = [h.strip() for h in str(args.get("hosts", "")).split(",") if h.strip()] or None
    timeout = int(args.get("timeout", 5))
    started = time.monotonic()
    try:
        found = await _scan(loop, storage, hosts=hosts, timeout=timeout)
    except Exception as e:  # noqa: BLE001
        return fail(_error_code(e, exceptions), e)
    devices = [_device_json(c, storage) for c in found if _is_apple_tv(c)]
    ignored = [c.name for c in found if not _is_apple_tv(c)]
    out(
        {
            "ok": True,
            "captured_at": now(),
            "mode": "unicast" if hosts else "multicast",
            "hosts": hosts or [],
            "timeout": timeout,
            "seconds": round(time.monotonic() - started, 1),
            "devices": devices,
            "ignored": ignored,
        }
    )
    return 0


async def _find(loop, storage, args):
    """Resolve --id (identifier) or --address to one config, or raise."""
    pyatv, exceptions, *_ = _pyatv()
    identifier = args.get("id")
    address = args.get("address")
    hosts = [address] if address else None
    found = await _scan(loop, storage, hosts=hosts, identifier=identifier, timeout=int(args.get("timeout", 5)))
    found = [c for c in found if _is_apple_tv(c)]
    if identifier:
        found = [c for c in found if identifier in c.all_identifiers]
    if not found:
        raise LookupError("device_not_found")
    if len(found) > 1:
        raise LookupError("multiple_devices")
    return found[0]


async def _connect(loop, storage, conf):
    pyatv, *_ = _pyatv()
    return await pyatv.connect(conf, loop, storage=storage)


def _feature_state(atv, name, FeatureName, FeatureState):
    try:
        return atv.features.get_feature(getattr(FeatureName, name)).state.name
    except Exception:  # noqa: BLE001
        return "Unknown"


async def _read_state(atv, FeatureName, FeatureState):
    """Read everything observable. A field that cannot be read says why."""
    state = {"captured_at": now()}
    unsupported = {}

    async def field(key, coro_factory, feature=None):
        if feature is not None:
            fs = _feature_state(atv, feature, FeatureName, FeatureState)
            if fs in ("Unsupported", "Unavailable"):
                unsupported[key] = fs.lower()
                state[key] = None
                return
        try:
            state[key] = await asyncio.wait_for(coro_factory(), timeout=8)
        except Exception as e:  # noqa: BLE001
            unsupported[key] = f"{type(e).__name__}: {e}"[:120]
            state[key] = None

    async def power():
        return atv.power.power_state.name.lower()

    async def app():
        a = atv.metadata.app
        return None if a is None else {"name": a.name, "id": a.identifier}

    async def focus():
        return atv.keyboard.text_focus_state.name.lower()

    async def volume():
        return atv.audio.volume

    async def playing():
        p = await atv.metadata.playing()
        return {
            "media_type": p.media_type.name.lower(),
            "device_state": p.device_state.name.lower(),
            "title": p.title,
            "artist": p.artist,
            "album": p.album,
            "genre": p.genre,
            "series_name": p.series_name,
            "season_number": p.season_number,
            "episode_number": p.episode_number,
            "position": p.position,
            "total_time": p.total_time,
            "repeat": p.repeat.name.lower() if p.repeat else None,
            "shuffle": p.shuffle.name.lower() if p.shuffle else None,
            "content_identifier": p.content_identifier,
        }

    await field("power", power, "PowerState")
    await field("app", app, "App")
    await field("focus", focus, "TextFocusState")
    await field("volume", volume, "Volume")
    await field("playing", playing)
    # Power reads 'unknown' on tvOS 26.5 gen-3 (pyatv #2845): say so rather than blank.
    if state.get("power") == "unknown":
        unsupported.setdefault("power", "reported unknown by the device")
    state["unsupported"] = unsupported
    return state


async def _with_device(args, fn):
    pyatv, exceptions, FeatureName, FeatureState, Protocol, FileStorage = _pyatv()
    loop = asyncio.get_running_loop()
    storage = FileStorage.default_storage(loop)
    await storage.load()
    try:
        conf = await _find(loop, storage, args)
    except LookupError as e:
        return fail(str(e), id=args.get("id"), address=args.get("address"))
    except Exception as e:  # noqa: BLE001
        return fail(_error_code(e, exceptions), e)
    if not any(s.credentials for s in conf.services):
        return fail("not_paired", device=_device_json(conf, storage))
    atv = None
    try:
        atv = await asyncio.wait_for(_connect(loop, storage, conf), timeout=20)
        return await fn(atv, conf, FeatureName, FeatureState, Protocol)
    except Exception as e:  # noqa: BLE001
        return fail(_error_code(e, exceptions), e, device=_device_json(conf, storage))
    finally:
        if atv is not None:
            atv.close()
            await asyncio.sleep(0.1)


async def a_state(args):
    async def go(atv, conf, FeatureName, FeatureState, Protocol):
        st = await _read_state(atv, FeatureName, FeatureState)
        out({"ok": True, "device": _device_json(conf, None), "state": st})
        return 0

    return await _with_device(args, go)


def _settle(args):
    return float(args.get("settle", 1.5))


async def _read_until(atv, FeatureName, FeatureState, tries, settle):
    """Read state up to `tries` times, `settle` seconds apart; return every read."""
    reads = []
    for _ in range(tries):
        await asyncio.sleep(settle)
        reads.append(await _read_state(atv, FeatureName, FeatureState))
    return reads


REMOTE_COMMANDS = {
    "up", "down", "left", "right", "select", "menu", "home", "home_hold", "top_menu",
    "play", "pause", "play_pause", "stop", "next", "previous",
    "skip_forward", "skip_backward", "set_position", "set_shuffle", "set_repeat",
    "volume_up", "volume_down", "channel_up", "channel_down", "screensaver",
    "suspend", "wakeup", "guide", "control_center",
}
POWER_COMMANDS = {"turn_on", "turn_off"}
AUDIO_COMMANDS = {"set_volume"}


async def _dispatch(atv, command, arg, Protocol):
    if command in POWER_COMMANDS:
        # await_new_state would block on tvOS versions that never report; we
        # verify by read-back ourselves instead.
        return await getattr(atv.power, command)(await_new_state=False)
    if command in AUDIO_COMMANDS:
        return await atv.audio.set_volume(float(arg))
    if command == "launch_app":
        return await atv.apps.launch_app(arg)
    if command in ("skip_forward", "skip_backward"):
        return await getattr(atv.remote_control, command)(float(arg)) if arg else await getattr(atv.remote_control, command)()
    if command == "set_position":
        return await atv.remote_control.set_position(int(float(arg)))
    if command == "set_shuffle":
        from pyatv.const import ShuffleState

        return await atv.remote_control.set_shuffle(ShuffleState[arg.capitalize()])
    if command == "set_repeat":
        from pyatv.const import RepeatState

        return await atv.remote_control.set_repeat(RepeatState[arg.capitalize()])
    if command in REMOTE_COMMANDS:
        return await getattr(atv.remote_control, command)()
    raise NotImplementedError(f"unknown command {command}")


async def a_press(args):
    command = args["_"][1] if len(args["_"]) > 1 else None
    if not command:
        return fail("usage", "press <command> [--arg value]")
    arg = args.get("arg")
    tries = int(args.get("tries", 3))

    async def go(atv, conf, FeatureName, FeatureState, Protocol):
        before = await _read_state(atv, FeatureName, FeatureState)
        sent_at = now()
        try:
            await asyncio.wait_for(_dispatch(atv, command, arg, Protocol), timeout=15)
            sent = {"ok": True}
        except Exception as e:  # noqa: BLE001
            from pyatv import exceptions

            sent = {"ok": False, "error": _error_code(e, exceptions), "detail": str(e)[:200]}
        reads = await _read_until(atv, FeatureName, FeatureState, tries, _settle(args))
        out(
            {
                "ok": True,
                "device": _device_json(conf, None),
                "command": command,
                "arg": arg,
                "sent_at": sent_at,
                "sent": sent,
                "before": before,
                "reads": reads,
                "after": reads[-1],
            }
        )
        return 0

    return await _with_device(args, go)


async def a_apps(args):
    async def go(atv, conf, FeatureName, FeatureState, Protocol):
        try:
            apps = await asyncio.wait_for(atv.apps.app_list(), timeout=15)
        except Exception as e:  # noqa: BLE001
            from pyatv import exceptions

            return fail(_error_code(e, exceptions), e, device=_device_json(conf, None))
        current = atv.metadata.app
        out(
            {
                "ok": True,
                "device": _device_json(conf, None),
                "captured_at": now(),
                "current": None if current is None else {"name": current.name, "id": current.identifier},
                "apps": sorted(({"name": a.name, "id": a.identifier} for a in apps), key=lambda a: a["name"].lower()),
            }
        )
        return 0

    return await _with_device(args, go)


async def a_text(args):
    op = args["_"][1] if len(args["_"]) > 1 else None
    text = args.get("text", "")
    if op not in ("get", "set", "append", "clear"):
        return fail("usage", "text <get|set|append|clear> [--text value]")

    async def go(atv, conf, FeatureName, FeatureState, Protocol):
        kb = atv.keyboard
        focus = kb.text_focus_state.name.lower()
        before = None
        try:
            before = await asyncio.wait_for(kb.text_get(), timeout=8)
        except Exception:  # noqa: BLE001
            pass
        if op != "get" and focus != "focused":
            out({"ok": False, "error": "no_text_focus", "focus": focus, "before": before, "device": _device_json(conf, None)})
            return 0
        sent = {"ok": True}
        if op != "get":
            try:
                if op == "set":
                    await asyncio.wait_for(kb.text_set(text), timeout=10)
                elif op == "append":
                    await asyncio.wait_for(kb.text_append(text), timeout=10)
                else:
                    await asyncio.wait_for(kb.text_clear(), timeout=10)
            except Exception as e:  # noqa: BLE001
                from pyatv import exceptions

                sent = {"ok": False, "error": _error_code(e, exceptions), "detail": str(e)[:200]}
        await asyncio.sleep(_settle(args))
        after = None
        try:
            after = await asyncio.wait_for(kb.text_get(), timeout=8)
        except Exception:  # noqa: BLE001
            pass
        out(
            {
                "ok": True,
                "device": _device_json(conf, None),
                "op": op,
                "text": text if op in ("set", "append") else None,
                "focus": focus,
                "sent": sent,
                "before": before,
                "after": after,
                "captured_at": now(),
            }
        )
        return 0

    return await _with_device(args, go)


async def _wait_for_pin(pin_file, timeout):
    """Poll a file for the PIN. The session must stay alive across the wait."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if os.path.exists(pin_file):
            with open(pin_file, encoding="utf8") as fh:
                pin = fh.read().strip()
            os.remove(pin_file)
            if pin:
                return pin
        await asyncio.sleep(0.5)
    return None


async def a_pair(args):
    pyatv, exceptions, FeatureName, FeatureState, Protocol, FileStorage = _pyatv()
    loop = asyncio.get_running_loop()
    storage = FileStorage.default_storage(loop)
    await storage.load()
    proto_name = str(args.get("protocol", "")).lower()
    proto = {"airplay": Protocol.AirPlay, "companion": Protocol.Companion, "mrp": Protocol.MRP, "raop": Protocol.RAOP, "dmap": Protocol.DMAP}.get(proto_name)
    if proto is None:
        return fail("usage", "pair --protocol <airplay|companion> --id <identifier> [--pin-file path] [--pin 1234]")
    try:
        conf = await _find(loop, storage, args)
    except LookupError as e:
        return fail(str(e), id=args.get("id"))
    except Exception as e:  # noqa: BLE001
        return fail(_error_code(e, exceptions), e)
    service = conf.get_service(proto)
    if service is None:
        return fail("no_service", f"{proto_name} not offered by {conf.name}", device=_device_json(conf, None))
    pairing_req = service.pairing.name
    if pairing_req == "Disabled":
        return fail("pairing_disabled", protocol=proto_name, device=_device_json(conf, None))
    if pairing_req == "NotNeeded":
        out({"ok": True, "protocol": proto_name, "device": _device_json(conf, None), "paired": True, "note": "no pairing needed"})
        return 0
    pairing = None
    try:
        pairing = await pyatv.pair(conf, proto, loop, storage=storage)
        await asyncio.wait_for(pairing.begin(), timeout=20)
        if pairing.device_provides_pin:
            pin = args.get("pin")
            if not pin:
                pin_file = args.get("pin-file")
                if not pin_file:
                    return fail("pin_required", "device shows a PIN; pass --pin or --pin-file")
                sys.stderr.write(json.dumps({"phase": "pin_needed", "protocol": proto_name, "device": conf.name, "pin_file": pin_file}) + "\n")
                sys.stderr.flush()
                pin = await _wait_for_pin(pin_file, int(args.get("pin-timeout", 120)))
                if pin is None:
                    return fail("pin_timeout", protocol=proto_name, device=_device_json(conf, None))
            pairing.pin(str(pin))
        else:
            # The client provides the PIN and the user types it on the TV.
            pin = str(args.get("pin", "1234"))
            pairing.pin(pin)
            sys.stderr.write(json.dumps({"phase": "enter_on_device", "pin": pin}) + "\n")
        await asyncio.wait_for(pairing.finish(), timeout=30)
        paired = bool(pairing.has_paired)
        if paired:
            await storage.save()
        out(
            {
                "ok": paired,
                "error": None if paired else "pairing_failed",
                "protocol": proto_name,
                "device": _device_json(conf, None),
                "paired": paired,
                "credentials_stored": paired,
                "storage": STORAGE_PATH,
            }
        )
        return 0
    except Exception as e:  # noqa: BLE001
        return fail(_error_code(e, exceptions), e, protocol=proto_name, device=_device_json(conf, None))
    finally:
        if pairing is not None:
            try:
                await pairing.close()
            except Exception:  # noqa: BLE001
                pass


ASYNC = {"scan": a_scan, "state": a_state, "press": a_press, "apps": a_apps, "text": a_text, "pair": a_pair}


def main(argv):
    args = parse(argv)
    cmd = args["_"][0] if args["_"] else None
    if cmd == "doctor":
        return cmd_doctor(args)
    if cmd not in ASYNC:
        return fail("usage", USAGE)
    try:
        return asyncio.run(ASYNC[cmd](args))
    except KeyboardInterrupt:
        return fail("interrupted")
    except Exception as e:  # noqa: BLE001
        return fail(f"unexpected:{type(e).__name__}", e)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
