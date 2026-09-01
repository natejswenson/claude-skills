#!/usr/bin/env python3
"""
appletv screenshot — one PNG from the Apple TV over the developer tunnel.

Uses pymobiledevice3's DVT screenshot service in-process instead of its CLI,
for one reason found on a real run: the CLI's DTX reader refuses any message
over 30 MiB, and a detailed frame (an aerial screensaver, a busy app screen)
encodes to more than that, so busy screens failed while black ones succeeded.
The cap is a module constant; raising it here is the whole fix.

    python screenshot.py <out.png>

Prints one JSON line. Exit 0 with ok:true on success; ok:false with a code the
node side maps to a message otherwise.
"""
import asyncio
import json
import sys


def out(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


async def main(path):
    try:
        import pymobiledevice3.dtx._reader as reader
        from pymobiledevice3.exceptions import TunneldConnectionError
        from pymobiledevice3.services.dvt.instruments.dvt_provider import DvtProvider
        from pymobiledevice3.services.dvt.instruments.screenshot import Screenshot
        from pymobiledevice3.tunneld.api import get_tunneld_devices
    except Exception as e:  # noqa: BLE001
        out({"ok": False, "error": "no_pymobiledevice3", "detail": str(e)[:200]})
        return 1
    reader.MAX_BUFFERED_SIZE = 256 * 1024 * 1024  # a 4K PNG of a busy frame is ~40 MiB
    try:
        rsds = await get_tunneld_devices()
    except TunneldConnectionError:
        out({"ok": False, "error": "no_tunnel"})
        return 1
    if not rsds:
        out({"ok": False, "error": "no_dev_pairing"})
        return 1
    rsd = rsds[0]
    try:
        async with DvtProvider(rsd) as dvt:
            async with Screenshot(dvt) as shot:
                png = await asyncio.wait_for(shot.get_screenshot(), timeout=20)
        with open(path, "wb") as fh:
            fh.write(png)
        out({"ok": True, "path": path, "bytes": len(png)})
        return 0
    except Exception as e:  # noqa: BLE001
        out({"ok": False, "error": "screen_failed", "detail": f"{type(e).__name__}: {e}"[:200]})
        return 1
    finally:
        try:
            await rsd.close()
        except Exception:  # noqa: BLE001
            pass


if __name__ == "__main__":
    if len(sys.argv) < 2:
        out({"ok": False, "error": "usage", "detail": "screenshot.py <out.png>"})
        sys.exit(2)
    sys.exit(asyncio.run(main(sys.argv[1])))
