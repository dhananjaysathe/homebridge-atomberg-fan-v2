import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';

import { AtombergFanPlatformConfig, AtombergFanDevice, AtombergFanDeviceState } from './model';
import { AtombergFanPlatformAccessory } from './platformAccessory';
import { PLATFORM_NAME, PLUGIN_NAME, OFFLINE_CHECK_INTERVAL_MS, OFFLINE_THRESHOLD_MS } from './settings';
import BroadcastListener from './broadcastListener';
import AtombergApi from './atombergApi';

type LoggerWithSuccess = Logger & { success?: (message: string, ...parameters: unknown[]) => void };

export class AtombergFanPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: PlatformAccessory[] = [];
  public readonly atombergApi: AtombergApi;
  public readonly broadcastListener: BroadcastListener;
  public readonly platformConfig: AtombergFanPlatformConfig;
  private readonly accessoryInstances: Map<string, AtombergFanPlatformAccessory> = new Map();
  private readonly lastBroadcastTime: Map<string, number> = new Map();
  private offlineCheckInterval: NodeJS.Timeout | undefined;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.log.debug('Finished initializing platform:', this.config.name);
    this.platformConfig = config as AtombergFanPlatformConfig;
    this.atombergApi = new AtombergApi(this.log, this.platformConfig);
    this.broadcastListener = BroadcastListener.getInstance(this.log);

    // Homebridge 1.8.0+ has log.success; polyfill for older installs.
    const lg = log as LoggerWithSuccess;
    if (!lg.success) {
      lg.success = log.info.bind(log);
    }

    this.api.on('didFinishLaunching', () => {
      log.debug('didFinishLaunching');
      if (!this.platformConfig.apiKey) {
        this.log.error('apiKey is not configured — aborting. Set `API Key` in the plugin config.');
        return;
      }
      if (!this.platformConfig.refreshToken) {
        this.log.error('refreshToken is not configured — aborting. Set `Refresh Token` in the plugin config.');
        return;
      }

      this.log.info('Attempting to log into Atomberg platform.');
      this.atombergApi.login()
        .then((ok) => {
          if (!ok) {
            this.log.error('Login failed. Skipping device discovery.');
            return;
          }
          this.log.info('Successfully logged in.');
          this.discoverDevices();
        })
        .catch((error) => {
          this.log.error('Login failed. Skipping device discovery.');
          this.log.debug(error);
        });
    });

    // Clean up timers/sockets when Homebridge is shutting down.
    this.api.on('shutdown', () => {
      this.log.debug('Homebridge shutdown — cleaning up');
      if (this.offlineCheckInterval) {
        clearInterval(this.offlineCheckInterval);
        this.offlineCheckInterval = undefined;
      }
      try {
        this.broadcastListener.close();
      } catch {
        // ignore
      }
    });

    this.broadcastListener.listen();

    this.broadcastListener.on('stateChange', (state: AtombergFanDeviceState) => {
      this.lastBroadcastTime.set(state.device_id, Date.now());
      this.handleStateChange(state);
    });

    this.broadcastListener.on('deviceSeen', (deviceId: string) => {
      this.lastBroadcastTime.set(deviceId, Date.now());
    });

    // Periodically sweep the lastBroadcastTime map and mark silent devices offline.
    this.offlineCheckInterval = setInterval(() => {
      this.reconcileOfflineDevices();
    }, OFFLINE_CHECK_INTERVAL_MS);
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  async discoverDevices() {
    this.log.info('Discovering devices on Atomberg platform.');
    try {
      const devices: AtombergFanDevice[] = await this.atombergApi.getAllDevices();
      if (!devices) {
        this.log.info('No devices found on Atomberg platform.');
        return;
      }

      let deviceStates: AtombergFanDeviceState[] = [];
      try {
        deviceStates = await this.atombergApi.getDeviceState();
      } catch {
        this.log.debug('Initial getDeviceState failed; continuing with empty snapshot.');
      }

      for (const device of devices) {
        const uuid = this.api.hap.uuid.generate(device.device_id);
        const existingAccessory = this.accessories.find((acc) => acc.UUID === uuid);
        const deviceState = (deviceStates.find((dvc) => dvc.device_id === device.device_id)
          ?? { device_id: device.device_id, is_online: false } as AtombergFanDeviceState);

        if (existingAccessory) {
          this.log.info(`Restoring accessory '${existingAccessory.displayName}' (${device.device_id})`);
          existingAccessory.context.device = device;
          existingAccessory.context.deviceDisplayName = device.name;

          // Build the accessory first so the constructor can add any missing
          // services (e.g. Lightbulb for users upgrading from a pre-LED build),
          // then persist the updated definition in one go.
          const atombergAccessory = new AtombergFanPlatformAccessory(
            this, this.atombergApi, existingAccessory, deviceState,
          );
          this.accessoryInstances.set(device.device_id, atombergAccessory);
          this.api.updatePlatformAccessories([existingAccessory]);
        } else {
          this.log.info('Adding new accessory:', device.name);
          const accessory = new this.api.platformAccessory(device.name, uuid);
          accessory.context.device = device;

          const atombergAccessory = new AtombergFanPlatformAccessory(
            this, this.atombergApi, accessory, deviceState,
          );
          this.accessoryInstances.set(device.device_id, atombergAccessory);

          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }

        if (deviceState.is_online) {
          this.lastBroadcastTime.set(device.device_id, Date.now());
        }
      }

      // Remove cached accessories that have been deleted from the Atomberg account.
      for (const cachedAccessory of this.accessories) {
        const deviceId = cachedAccessory.context.device?.device_id;
        if (!deviceId) {
          continue;
        }
        const stillExists = devices.find((d) => d.device_id === deviceId);
        if (!stillExists) {
          this.log.info(`Removing accessory '${cachedAccessory.displayName}' (${deviceId}) — no longer on account.`);
          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [cachedAccessory]);
        }
      }
    } catch (error) {
      this.log.error('An error occurred during device discovery. Enable debug for details.');
      this.log.debug(JSON.stringify(error));
    }
  }

  handleStateChange(state: AtombergFanDeviceState) {
    const instance = this.accessoryInstances.get(state.device_id);
    if (instance) {
      this.log.debug('Updating state for accessory:', state.device_id);
      instance.refreshDeviceStatus(state);
    }
  }

  public getLastBroadcastTime(deviceId: string): number | undefined {
    return this.lastBroadcastTime.get(deviceId);
  }

  /**
   * Sweep every known device: if its last UDP broadcast is older than the
   * offline threshold, tell the accessory to reflect that in HomeKit.
   */
  private reconcileOfflineDevices() {
    const now = Date.now();
    for (const [deviceId, instance] of this.accessoryInstances) {
      const lastSeen = this.lastBroadcastTime.get(deviceId);
      if (lastSeen === undefined) {
        // Never seen via UDP — don't churn HomeKit based on a cold start.
        continue;
      }
      if (now - lastSeen > OFFLINE_THRESHOLD_MS) {
        instance.markOffline();
      }
    }
  }
}
