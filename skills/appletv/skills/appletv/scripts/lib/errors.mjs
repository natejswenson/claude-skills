/**
 * The error taxonomy — every code the driver can return, mapped to what it
 * means and what fixes it. The message names the fix, never just the fault;
 * "pairing failed" teaches nothing, "set Allow Access to Everyone" does.
 * references/errors.md is the human-readable copy of this table.
 */
export const ERRORS = Object.freeze({
  no_pyatv: {
    message: 'pyatv is not installed in the skill venv',
    fix: 'run `appletv doctor --install` (creates .venv and installs pyatv; needs python3 ≥ 3.9)',
  },
  no_python: {
    message: 'no python3 found on PATH',
    fix: 'install Python 3 (brew install python) and re-run `appletv doctor --install`',
  },
  pyatv_import_failed: {
    message: 'pyatv is installed but does not import',
    fix: 'delete .venv and run `appletv doctor --install` again; check the Python version is ≥ 3.9',
  },
  scan_empty: {
    message: 'no Apple TV answered the scan',
    fix: 'most often this Mac is on a different Wi-Fi than the TV — check both are on the same network; otherwise wake the TV with its remote and rescan, or use `appletv scan --hosts <ip>`',
  },
  device_not_found: {
    message: 'that device did not answer',
    fix: 'wake it with the remote (deep sleep drops it off the network), or rescan with `--hosts <its ip>`; if the name changed, run `appletv scan` and alias it again',
  },
  multiple_devices: {
    message: 'more than one Apple TV matched',
    fix: 'name one with --device <name|alias|ip>, or set a default: `appletv alias <room> --device <name> --default`',
  },
  no_device: {
    message: 'no device named and no default set',
    fix: 'run `appletv scan`, then `appletv alias <room> --device <name> --default` so later runs need no name',
  },
  not_paired: {
    message: 'this Apple TV has no stored credentials',
    fix: 'run `appletv pair --device <name>` and read the PIN off the screen; credentials persist in ~/.pyatv.conf',
  },
  pairing_refused: {
    message: 'the Apple TV refused to start pairing',
    fix: 'on the TV: Settings › AirPlay and HomeKit › Allow Access → "Everyone" (or "Anyone on the Same Network"); if no PIN ever appears, assign the TV to a room in the Home app',
  },
  pairing_disabled: {
    message: 'this protocol cannot be paired on this tvOS',
    fix: 'expected for MRP on tvOS 15+ (it rides inside AirPlay) — pair airplay and companion instead',
  },
  pairing_failed: {
    message: 'pairing did not complete',
    fix: 'the PIN was probably wrong — the code on the screen changes each attempt; leading zeros count. Run pair again',
  },
  pairing_backoff: {
    message: 'the Apple TV is rate-limiting pairing after too many attempts',
    fix: 'wait a few minutes (or restart the Apple TV) before trying again',
  },
  pin_required: {
    message: 'the TV is showing a PIN but none was supplied',
    fix: 'run `appletv pair` in the background, then deliver the code with `appletv pair --pin <code>`',
  },
  pin_timeout: {
    message: 'no PIN arrived before the pairing window closed',
    fix: 'run `appletv pair` again and deliver the code within two minutes with `appletv pair --pin <code>`',
  },
  connection_failed: {
    message: 'could not connect to the Apple TV',
    fix: 'wake it with the remote; if it just updated tvOS, re-pair (`appletv pair --device <name> --force`); Companion drops on tvOS 26.5 gen-3 (pyatv #2845) — AirPlay still works',
  },
  blocked_state: {
    message: 'the connection is up but the protocol that owns this command is not',
    fix: 're-pair the missing protocol: `appletv pair --device <name> --protocol companion`',
  },
  unsupported_command: {
    message: 'this Apple TV (or the app in front) does not support that command',
    fix: 'check `appletv state` for what it reports; some apps ignore stop/next; power needs Companion',
  },
  command_refused: {
    message: 'the Apple TV rejected the command',
    fix: 'read `appletv state` — the wrong app may be in front, or nothing is playing',
  },
  no_text_focus: {
    message: 'no text field is focused on the TV',
    fix: 'navigate to a search or login field first (its keyboard must be on screen), then type again',
  },
  non_local_subnet: {
    message: 'that address is on a different subnet',
    fix: 'the Apple TV ignores packets from other subnets — run from a Mac on the same network, or add an mDNS repeater',
  },
  network_unreachable: {
    message: 'the network path to the device failed',
    fix: 'check Wi-Fi/Ethernet on this Mac and that the TV is awake',
  },
  timeout: {
    message: 'the Apple TV did not answer in time',
    fix: 'wake it and retry; if it keeps happening on Companion, re-pair that protocol',
  },
  protocol_error: {
    message: 'the Apple TV answered something pyatv did not expect',
    fix: 'a tvOS update may have changed the protocol — update pyatv (`appletv doctor --install`) and check pyatv issues',
  },
  no_service: {
    message: 'the device does not offer that protocol',
    fix: 'run `appletv scan` to see which protocols it advertises',
  },
  no_tunnel: {
    message: 'no developer tunnel is running, so the skill cannot see the screen',
    fix: 'a Terminal window has been opened with the command — type your Mac password there once; or install it for good with `appletv screen --install-tunnel`',
  },
  no_dev_pairing: {
    message: 'the tunnel is up but the Apple TV is not developer-paired',
    fix: 'on the TV open Settings › Remotes and Devices › Remote App and Devices, then `appletv screen --pair`',
  },
  not_advertising: {
    message: 'no Apple TV is advertising developer pairing',
    fix: 'put the TV on Settings › Remotes and Devices › Remote App and Devices and stay on that screen, then retry',
  },
  screen_failed: {
    message: 'the screenshot did not come back',
    fix: 'the tunnel may have dropped — check `appletv doctor`; re-pair with `screen --pair` after a tvOS update',
  },
  deep_link_unsupported: {
    message: 'this service ignores deep links on tvOS',
    fix: 'Netflix disabled them in Sept 2025 — use `appletv open netflix` and navigate with `appletv screen` between presses',
  },
  not_an_apple_tv: {
    message: 'that device is an AirPlay receiver, not an Apple TV',
    fix: 'it cannot be paired or controlled by this skill; pick a device with tvOS from `appletv scan`',
  },
  on_hold: {
    message: 'the TV is on hold — someone is watching',
    fix: 'ask before touching it; lift the hold with `appletv pref hold off`',
  },
  interrupted: { message: 'interrupted', fix: 'run it again' },
  usage: { message: 'bad arguments', fix: 'see `appletv --help`' },
});

export function explain(code, detail) {
  const known = ERRORS[code];
  if (known) return { code, message: known.message, fix: known.fix, detail: detail ?? null };
  return {
    code,
    message: `unexpected error (${code})`,
    fix: 'run again with --debug and file the output against the appletv skill',
    detail: detail ?? null,
  };
}
