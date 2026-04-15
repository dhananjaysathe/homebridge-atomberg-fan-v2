# Changelog

## 2.0.0 — 2026-04-15

First release of the maintained fork `homebridge-atomberg-fan-v2`.

### Added
- **Homebridge v2.0 compatibility** (upstream [#5](https://github.com/shadow5688/homebridge-atomberg-fan/issues/5)). Engines now declare `homebridge: ^1.8.0 || ^2.0.0-beta.0` and `node: ^18.20.4 || ^20.15.1 || ^22 || ^24`.
- **6-speed / Boost support** (upstream [#1](https://github.com/shadow5688/homebridge-atomberg-fan/issues/1)). HomeKit `RotationSpeed` 0–100 % maps continuously to Atomberg speeds 0–6; 100 % = Boost.
- **`legacy5Speed` config option** to restore the old 5-speed 20 %-step behaviour for fans that physically lack Boost.
- **LED state sync in `refreshDeviceStatus`** — physical-remote or Atomberg-app changes now reflect in the Home app without user interaction.
- **Single-device API probe** (`getDeviceStateForDevice`) used as an offline-recovery fallback when UDP is silent.
- **Offline detection**: devices silent on UDP for > 5 min are marked offline in HomeKit via a per-minute sweep.
- **Per-accessory throttle (250 ms)**, **speed-slider debounce (100 ms)**, and **duplicate-command suppression** to avoid API spam.
- **Global 200 ms `sendCommand` throttle** to stay inside Atomberg's documented quota.
- **Shutdown cleanup** — clears the offline-check interval and closes the UDP socket when Homebridge stops.

### Fixed
- **LED control** — the upstream LED PR was merged to git but never published to npm; this build includes it.
- **UDP parser** — replaced signed bitmask math with unsigned shifts (`>>> 0`), fixing negative `timer_time_elapsed_mins` values on older firmware.
- **UDP payload encoding** — now accepts plain-UTF-8 JSON (newer firmware) in addition to hex-encoded JSON.
- **Log spam** — non-state UDP packets no longer log as parse errors; they're treated as device-seen heartbeats.

### Changed
- Platform alias renamed to `AtombergFanV2` so the new plugin coexists with the original during migration.
- `AtombergFanCommandType` fields are now optional (consistent with the API's partial-update semantics).
- Project TS target bumped to ES2022.
- Axios upgraded to `^1.7.7`.

### Credits
Carried forward work by **Sangwan5688** (original plugin), **gurmeherchawla** (LED control), and incorporated ideas from the **Kevin-Deason** and **Vishalcj17** forks. See README for details.
