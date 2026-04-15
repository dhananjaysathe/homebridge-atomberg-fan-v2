<span align="center">

# Homebridge Atomberg Fan v2

</span>

[![npm version](https://img.shields.io/npm/v/homebridge-atomberg-fan-v2?color=%23cb3837&label=npm)](https://www.npmjs.com/package/homebridge-atomberg-fan-v2)
[![GitHub version](https://img.shields.io/github/package-json/v/dhananjaysathe/homebridge-atomberg-fan-v2?label=GitHub)](https://github.com/dhananjaysathe/homebridge-atomberg-fan-v2)

Homebridge plugin that exposes [Atomberg smart fans](https://atomberg.com/) to HomeKit. A maintained fork of [`homebridge-atomberg-fan`](https://github.com/Sangwan5688/homebridge-atomberg-fan) with Homebridge v2.0 support, the 6th (Boost) fan speed, working LED / brightness / colour-temperature control, and a hardened local UDP state loop.

## What's different from the original

This fork ships a working v2.0-compatible build with feature and stability work that was never published upstream.

- **Homebridge v2.0 compatibility.** Dual peer-dep range (`^1.8.0 || ^2.0.0-beta.0`), Node 18 / 20 / 22 engines, modern HAP characteristic patterns. Fixes upstream [shadow5688/homebridge-atomberg-fan#5](https://github.com/shadow5688/homebridge-atomberg-fan/issues/5).
- **6-speed Boost support.** HomeKit's 0–100 % rotation slider now maps to Atomberg's full 6-speed range, so 100 % triggers Boost as it should. Fixes upstream [shadow5688/homebridge-atomberg-fan#1](https://github.com/shadow5688/homebridge-atomberg-fan/issues/1). Set `legacy5Speed: true` in config to restore the old 5-speed behaviour.
- **LED control actually published.** Upstream's LED PR was merged to git but never released to npm — this build includes it, plus two-way state sync so physical-remote or Atomberg-app changes reflect in the Home app.
  - All series: LED on/off.
  - I1 and M1 series: brightness (0–100 %).
  - I1 series: colour temperature (warm / daylight / cool).
- **Hardened local UDP listener.**
  - Accepts both plain-UTF-8 and hex-encoded JSON payloads (newer firmware sends plain JSON).
  - Unsigned bitmask math — fixes negative-valued `timer_time_elapsed_mins` on older firmwares.
  - Heartbeat packets ("device seen") keep offline-detection accurate.
  - No more log spam from non-state broadcast packets.
- **API hygiene.** Global 200 ms throttle on outgoing commands keeps the plugin inside Atomberg's documented 5 req/s quota; slider drags are debounced (100 ms) and per-accessory throttled (250 ms); duplicate commands are suppressed.
- **Offline detection.** If a device stops broadcasting for 5 minutes, the accessory reflects "off" in HomeKit instead of a stale on-state. A single API probe (rate-limited to once per 30 s) attempts recovery when you poke the device from HomeKit.

## How it works

Atomberg fans broadcast their state on the local network over UDP port 5625 and accept commands via a cloud REST API. The plugin listens to the broadcasts for instant state updates, and uses the REST API only for control commands and login. All devices on your Atomberg account appear in the Home app automatically.

## Setup

### Step 1 — Get your API credentials

Open the Atomberg Home app and enable **Developer Options** to obtain your **API Key** and **Refresh Token**. Details: [Atomberg developer portal](https://developer.atomberg-iot.com/#overview).

### Step 2 — Install the plugin

In the Homebridge UI, search for **Homebridge Atomberg Fan v2** (or install via `npm i -g homebridge-atomberg-fan-v2`).

> **Migrating from `homebridge-atomberg-fan`?** This plugin uses a different platform alias (`AtombergFanV2`), so it installs cleanly alongside the older plugin. Remove the old platform block from `config.json` once you've confirmed v2 is working.

### Step 3 — Configure

```json
{
  "platforms": [
    {
      "platform": "AtombergFanV2",
      "name": "Homebridge Atomberg Fan v2",
      "apiKey": "tw******",
      "refreshToken": "ey******",
      "legacy5Speed": false
    }
  ]
}
```

| Option         | Type    | Required | Description                                                                                        |
|----------------|---------|----------|----------------------------------------------------------------------------------------------------|
| `apiKey`       | string  | yes      | From the Atomberg Home app's Developer Options.                                                    |
| `refreshToken` | string  | yes      | From the Atomberg Home app's Developer Options.                                                    |
| `legacy5Speed` | boolean | no       | Set to `true` for older fans that physically lack the Boost (6th) speed. Default `false`.          |

### Step 4 — Restart

Restart Homebridge. Your Atomberg fans appear in the Accessories tab and can be added to the Home app.

## Supported devices

Any Atomberg fan exposed by the Atomberg developer API. Brightness is controllable on **I1** and **M1** LED series; colour temperature on **I1**. Boost (6th speed) is available on all fans that physically support it.

## Troubleshooting

- **"Device is offline" but the fan is fine.** The plugin now probes the REST API once per 30 s when UDP is silent; if your network drops multicast/broadcast traffic (common on mesh Wi-Fi with client isolation), turn broadcast traffic back on.
- **Boost speed isn't available / 100 % feels like speed 5.** Set `legacy5Speed: false` (the default). If your fan physically tops out at speed 5, set `legacy5Speed: true`.
- **HomeKit LED brightness/colour won't budge.** Only the **I1** (brightness + colour temp) and **M1** (brightness) series support this via the Atomberg API.

## Credits

Built on top of substantial work by:

- **[Sangwan5688](https://github.com/Sangwan5688)** — original [`homebridge-atomberg-fan`](https://github.com/Sangwan5688/homebridge-atomberg-fan) plugin.
- **[gurmeherchawla](https://github.com/gurmeherchawla)** — LED control PR.
- **[Kevin-Deason](https://github.com/Kevin-Deason/homebridge-atomberg-smart-fans)** — raised the 6-speed mapping idea.
- **[Vishalcj17](https://github.com/Vishalcj17/homebridge-atomberg-fan)** — UDP hardening, debounce / throttle, offline detection.

## Disclaimer

All product and company names are trademarks™ or registered® trademarks of their respective holders. Use of them does not imply any affiliation with or endorsement by them. This plugin is not affiliated with, endorsed by, or sponsored by Atomberg Technologies.
