export const PLATFORM_NAME = 'AtombergFanV2';

export const PLUGIN_NAME = 'homebridge-atomberg-fan-v2';

export const LOGIN_RETRY_DELAY = 360 * 1000;

export const LOGIN_TOKEN_REFRESH_INTERVAL = 60 * 60 * 23 * 1000;

export const ATOMBERG_API_HOST = 'https://api.developer.atomberg-iot.com';

export const ATOMBERG_API_ENDPOINTS = {
  GET_ACCESS_TOKEN: '/v1/get_access_token',
  GET_DEVICES: '/v1/get_list_of_devices',
  SEND_COMMAND: '/v1/send_command',
  GET_DEVICE_STATE: '/v1/get_device_state',
};

export const ATOMBERG_ERROR_CODES: { [code: number]: string } = {
  401: 'Access token expired',
  403: 'Forbidden, please make sure Developer mode is enabled and correct token is provided',
  404: 'Device not found',
  429: 'API limit Reached',
};

// Atomberg publishes a documented rate cap of 5 calls/sec and 100 calls/day
// per API key; a 200 ms floor between sendCommand calls keeps us well inside it.
export const MIN_SEND_COMMAND_INTERVAL_MS = 200;

// Debounce for rapid speed changes (e.g. a HomeKit slider drag).
export const SPEED_DEBOUNCE_MS = 100;

// Per-accessory throttle to coalesce consecutive command bursts.
export const ACCESSORY_THROTTLE_MS = 250;

// Offline-tracking window: mark a device offline when we have not seen a UDP
// broadcast from it for this long. Checked every OFFLINE_CHECK_INTERVAL_MS.
export const OFFLINE_CHECK_INTERVAL_MS = 60 * 1000;
export const OFFLINE_THRESHOLD_MS = 5 * 60 * 1000;

// When UDP says a device is offline but HomeKit asks us to set a characteristic,
// we fall back to a single-device API probe. Rate-limited to avoid burning quota.
export const STATE_PROBE_COOLDOWN_MS = 30 * 1000;
