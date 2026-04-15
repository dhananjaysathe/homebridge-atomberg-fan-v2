import axios, { AxiosError } from 'axios';
import { Logger } from 'homebridge';
import {
  LOGIN_RETRY_DELAY,
  LOGIN_TOKEN_REFRESH_INTERVAL,
  ATOMBERG_ERROR_CODES,
  ATOMBERG_API_HOST,
  ATOMBERG_API_ENDPOINTS,
  MIN_SEND_COMMAND_INTERVAL_MS,
} from './settings';
import {
  AtombergFanPlatformConfig,
  AtombergFanDevice,
  AtombergFanDeviceState,
  AtombergFanCommandData,
} from './model';


/**
 * AtombergApi — thin wrapper around Atomberg's developer REST API.
 *
 * Notes:
 *  - Access tokens are refreshed every 23h.
 *  - sendCommand() is globally throttled to MIN_SEND_COMMAND_INTERVAL_MS to
 *    respect Atomberg's documented 5 calls/sec / 100 calls/day quota.
 *  - getDeviceStateForDevice() is used as a fallback when UDP state is stale.
 */
export default class AtombergApi {
  private accessToken: string;
  private _loginRefreshInterval: NodeJS.Timeout | undefined;
  private _loginRetryTimeouts: NodeJS.Timeout[] = [];
  private _lastCommandSentAt = 0;

  constructor(
    private readonly logger: Logger,
    private readonly config: AtombergFanPlatformConfig,
  ) {
    this.accessToken = '';
  }

  public getAccessToken(): string {
    return this.accessToken;
  }

  public async login(): Promise<boolean> {
    // Clear any pending retries and the refresh interval.
    for (const timeoutId of this._loginRetryTimeouts) {
      clearTimeout(timeoutId);
    }
    this._loginRetryTimeouts = [];
    if (this._loginRefreshInterval) {
      clearInterval(this._loginRefreshInterval);
    }

    const headers = {
      'accept': 'application/json',
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'Authorization': `Bearer ${this.config.refreshToken}`,
    };

    try {
      const response = await axios.request({
        method: 'get',
        url: ATOMBERG_API_HOST + ATOMBERG_API_ENDPOINTS.GET_ACCESS_TOKEN,
        headers,
      });
      if (response.data.status !== 'Success') {
        this.accessToken = '';
        this.retryLogin(JSON.stringify(response.data.message));
        return false;
      }
      this.accessToken = response.data.message.access_token;
      this._loginRefreshInterval = setInterval(
        this.login.bind(this),
        LOGIN_TOKEN_REFRESH_INTERVAL,
      );
      return true;
    } catch (error) {
      this.handleNetworkRequestError(error as AxiosError);
      return false;
    }
  }

  public retryLogin(error: string) {
    this.logger.debug('AtombergFanApi: login failed');
    this.logger.debug(error);
    this.logger.error(
      `Login failed. Homebridge will try again in ${LOGIN_RETRY_DELAY / 1000} s. ` +
      'Check your API Key and Refresh Token. Restart Homebridge after changing config. ' +
      'If the problem persists open an issue at ' +
      'https://github.com/dhananjaysathe/homebridge-atomberg-fan-v2/issues.',
    );
    this._loginRetryTimeouts.push(setTimeout(this.login.bind(this), LOGIN_RETRY_DELAY));
  }

  public async getAllDevices(): Promise<AtombergFanDevice[]> {
    this.logger.debug('AtombergFanApi: fetching device list');

    if (!this.accessToken) {
      return Promise.reject('No auth token available. Check credentials and restart Homebridge.');
    }

    try {
      const response = await axios.request({
        method: 'get',
        url: ATOMBERG_API_HOST + ATOMBERG_API_ENDPOINTS.GET_DEVICES,
        headers: this.authedHeaders(),
      });
      this.logger.debug(JSON.stringify(response.data));
      if (response.data.status !== 'Success') {
        return Promise.reject(response.data?.message ?? response.data);
      }
      return response.data.message.devices_list as AtombergFanDevice[];
    } catch (error) {
      this.logger.debug('AtombergFanApi: getAllDevices failed');
      this.handleNetworkRequestError(error as AxiosError);
      return Promise.reject();
    }
  }

  /**
   * Fetch state for all devices. Kept for the initial discovery snapshot only;
   * ongoing state updates come from the UDP BroadcastListener.
   */
  public async getDeviceState(): Promise<AtombergFanDeviceState[]> {
    this.logger.debug('AtombergFanApi: fetching device state (all)');

    if (!this.accessToken) {
      return Promise.reject('No auth token available. Check credentials and restart Homebridge.');
    }

    try {
      const response = await axios.request({
        method: 'get',
        url: ATOMBERG_API_HOST + ATOMBERG_API_ENDPOINTS.GET_DEVICE_STATE,
        headers: this.authedHeaders(),
        params: { device_id: 'all' },
      });
      if (response.data.status !== 'Success') {
        return Promise.reject(response.data?.message ?? response.data);
      }
      return response.data.message.device_state as AtombergFanDeviceState[];
    } catch (error) {
      this.logger.debug('AtombergFanApi: getDeviceState failed');
      this.handleNetworkRequestError(error as AxiosError);
      return Promise.reject();
    }
  }

  /**
   * Fetch state for a single device. Used by the offline-recovery probe when
   * UDP silence exceeds the threshold but HomeKit still wants to talk to the device.
   *
   * Handles both response shapes observed from the API: an array (one entry for
   * the requested device_id) and a plain object.
   */
  public async getDeviceStateForDevice(deviceId: string): Promise<AtombergFanDeviceState | null> {
    if (!this.accessToken) {
      return null;
    }

    try {
      const response = await axios.request({
        method: 'get',
        url: ATOMBERG_API_HOST + ATOMBERG_API_ENDPOINTS.GET_DEVICE_STATE,
        headers: this.authedHeaders(),
        params: { device_id: deviceId },
      });
      if (response.data.status !== 'Success') {
        return null;
      }
      const payload = response.data.message?.device_state ?? response.data.message;
      if (Array.isArray(payload)) {
        return (payload.find((s: AtombergFanDeviceState) => s.device_id === deviceId) as AtombergFanDeviceState) ?? null;
      }
      if (payload && typeof payload === 'object') {
        return payload as AtombergFanDeviceState;
      }
      return null;
    } catch (error) {
      this.logger.debug(`AtombergFanApi: getDeviceStateForDevice(${deviceId}) failed`);
      this.handleNetworkRequestError(error as AxiosError);
      return null;
    }
  }

  public async sendCommand(data: AtombergFanCommandData): Promise<boolean> {
    if (!this.accessToken) {
      return Promise.reject('No auth token available. Check credentials and restart Homebridge.');
    }

    // Global throttle: never issue two sendCommand calls closer than
    // MIN_SEND_COMMAND_INTERVAL_MS apart.
    const now = Date.now();
    const wait = this._lastCommandSentAt + MIN_SEND_COMMAND_INTERVAL_MS - now;
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this._lastCommandSentAt = Date.now();

    this.logger.debug('AtombergFanApi: sending command', data);
    try {
      const response = await axios.request({
        method: 'post',
        url: ATOMBERG_API_HOST + ATOMBERG_API_ENDPOINTS.SEND_COMMAND,
        headers: this.authedHeaders(),
        data,
      });
      if (response.data.status !== 'Success') {
        return Promise.reject(response.data?.message ?? response.data);
      }
      return true;
    } catch (error) {
      this.logger.error('AtombergFanApi: sendCommand failed');
      this.handleNetworkRequestError(error as AxiosError);
      return Promise.reject();
    }
  }

  private authedHeaders() {
    return {
      'accept': 'application/json',
      'Content-Type': 'application/json',
      'x-api-key': this.config.apiKey,
      'Authorization': `Bearer ${this.accessToken}`,
    };
  }

  private handleNetworkRequestError(error: AxiosError) {
    if (error.response) {
      this.logger.debug(JSON.stringify(error.response.data ?? 'Some error occurred'));
      const status = error.response.status;
      if (status === 401) {
        this._loginRetryTimeouts.push(setTimeout(this.login.bind(this), LOGIN_RETRY_DELAY));
      } else if (ATOMBERG_ERROR_CODES[status]) {
        this.logger.error(ATOMBERG_ERROR_CODES[status]);
      }
    } else if (error.request) {
      this.logger.debug('No response received for request');
    } else if (error.message) {
      this.logger.debug(error.message);
    }
  }
}
