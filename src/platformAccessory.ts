import { Service, PlatformAccessory, CharacteristicValue, HAPStatus } from 'homebridge';

import AtombergApi from './atombergApi';
import { AtombergFanPlatform } from './platform';
import { AtombergFanCommandData, AtombergFanDeviceState } from './model';
import {
  SPEED_DEBOUNCE_MS,
  ACCESSORY_THROTTLE_MS,
  STATE_PROBE_COOLDOWN_MS,
} from './settings';

/**
 * AtombergFanPlatformAccessory — one instance per Atomberg device.
 *
 * Speed mapping
 * -------------
 * Atomberg fans expose 6 physical speeds (1..6). Speed 6 is the "Boost" / turbo
 * step. By default we map HomeKit's 0..100% RotationSpeed to 0..6 with a
 * continuous slider (minStep = 1). Set `legacy5Speed: true` in the config to
 * fall back to the old 0..5 behaviour (minStep = 20, 5 discrete stops) for
 * older fans that don't physically support Boost.
 */

type HapStatusErrorCtor = new (status: HAPStatus) => Error;

export class AtombergFanPlatformAccessory {
  private fanService: Service;
  private lightbulbService: Service;

  private readonly deviceId: string;
  private readonly maxSpeed: number;
  private readonly legacy5Speed: boolean;

  // Debounce / throttle / dedupe state.
  private pendingSpeedTimer: NodeJS.Timeout | undefined;
  private lastSendAt = 0;
  private lastPowerCmd: boolean | undefined;
  private lastSpeedCmd: number | undefined;
  private lastLedCmd: boolean | undefined;
  private lastBrightnessCmd: number | undefined;
  private lastLightModeCmd: string | undefined;

  // Offline-recovery probe state.
  private lastProbeAt = 0;

  constructor(
    private readonly platform: AtombergFanPlatform,
    private readonly atombergApi: AtombergApi,
    private readonly accessory: PlatformAccessory,
    private fanState: AtombergFanDeviceState,
  ) {
    this.deviceId = accessory.context.device.device_id;
    this.legacy5Speed = platform.platformConfig.legacy5Speed === true;
    this.maxSpeed = this.legacy5Speed ? 5 : 6;

    let modelName = accessory.context.device.model || '';
    if (accessory.context.device.series) {
      if (modelName !== '') {
        modelName += ' ';
      }
      modelName += accessory.context.device.series;
    } else if (modelName === '') {
      modelName = 'Unknown';
    }

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Atomberg')
      .setCharacteristic(this.platform.Characteristic.Model, modelName)
      .setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name || 'Unknown')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.deviceId);

    this.fanService = this.accessory.getService(this.platform.Service.Fanv2)
      ?? this.accessory.addService(this.platform.Service.Fanv2);
    this.fanService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name || 'Unknown Fan');

    this.fanService.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setActive.bind(this));

    this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({
        minValue: 0,
        maxValue: 100,
        minStep: this.legacy5Speed ? 20 : 1,
      })
      .onSet(this.setRotationSpeed.bind(this));

    this.lightbulbService = this.accessory.getService(this.platform.Service.Lightbulb)
      ?? this.accessory.addService(this.platform.Service.Lightbulb);
    this.lightbulbService.setCharacteristic(
      this.platform.Characteristic.Name,
      (accessory.context.device.name ? `${accessory.context.device.name} LED` : 'LED'),
    );

    this.lightbulbService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setLED.bind(this));

    const series = accessory.context.device.series;

    // Brightness is only controllable on I1 and M1 series LEDs.
    if (series === 'I1' || series === 'M1') {
      this.lightbulbService.getCharacteristic(this.platform.Characteristic.Brightness)
        .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
        .onSet(this.setLEDBrightness.bind(this));
    }

    // Colour temperature is only controllable on I1.
    if (series === 'I1') {
      this.lightbulbService.getCharacteristic(this.platform.Characteristic.ColorTemperature)
        .setProps({ minValue: 300, maxValue: 500, minStep: 100 })
        .onSet(this.setLEDTemperature.bind(this));
    }

    this.refreshDeviceStatus(this.fanState);
  }

  // ---------------------------------------------------------------------------
  // HomeKit SET handlers
  // ---------------------------------------------------------------------------

  async setActive(value: CharacteristicValue) {
    await this.ensureOnlineOrThrow();

    const powerState = value === this.platform.Characteristic.Active.ACTIVE;
    this.fanState.power = powerState;

    if (this.lastPowerCmd === powerState) {
      return;
    }
    this.lastPowerCmd = powerState;

    this.platform.log.debug('Set Active ->', powerState);

    const command: Record<string, unknown> = { power: powerState };
    if (powerState) {
      // When turning on, restore last known speed (>=1) to avoid the device
      // starting at speed 0.
      const restoreSpeed = Math.max(1, Math.min(this.maxSpeed, this.fanState.last_recorded_speed || 1));
      command.speed = restoreSpeed;
      this.lastSpeedCmd = restoreSpeed;
    }

    await this.sendDeviceUpdate({ device_id: this.deviceId, command } as AtombergFanCommandData);
  }

  async setRotationSpeed(value: CharacteristicValue) {
    await this.ensureOnlineOrThrow();

    const percent = value as number;
    const speed = this.percentToSpeed(percent);
    this.fanState.last_recorded_speed = speed;

    // Debounce rapid slider movements.
    if (this.pendingSpeedTimer) {
      clearTimeout(this.pendingSpeedTimer);
    }
    this.pendingSpeedTimer = setTimeout(() => {
      this.pendingSpeedTimer = undefined;
      if (this.lastSpeedCmd === speed) {
        return;
      }
      this.lastSpeedCmd = speed;

      this.platform.log.debug('Set RotationSpeed -> percent=%d speed=%d', percent, speed);
      const cmd: AtombergFanCommandData = {
        device_id: this.deviceId,
        command: { speed } as AtombergFanCommandData['command'],
      };
      this.sendDeviceUpdate(cmd).catch(() => { /* already logged */ });
    }, SPEED_DEBOUNCE_MS);
  }

  async setLED(value: CharacteristicValue) {
    await this.ensureOnlineOrThrow();

    const led = value as boolean;
    this.fanState.led = led;

    if (this.lastLedCmd === led) {
      return;
    }
    this.lastLedCmd = led;

    this.platform.log.debug('Set LED ->', led);
    await this.sendDeviceUpdate({
      device_id: this.deviceId,
      command: { led } as AtombergFanCommandData['command'],
    });
  }

  async setLEDBrightness(value: CharacteristicValue) {
    await this.ensureOnlineOrThrow();

    const brightness = value as number;
    this.fanState.last_recorded_brightness = brightness;

    if (this.lastBrightnessCmd === brightness) {
      return;
    }
    this.lastBrightnessCmd = brightness;

    this.platform.log.debug('Set LED Brightness ->', brightness);
    await this.sendDeviceUpdate({
      device_id: this.deviceId,
      command: { brightness } as AtombergFanCommandData['command'],
    });
  }

  async setLEDTemperature(value: CharacteristicValue) {
    await this.ensureOnlineOrThrow();

    const mireds = value as number;
    const colorMode = AtombergFanPlatformAccessory.miredsToColorMode(mireds);
    this.fanState.last_recorded_color = colorMode;

    if (this.lastLightModeCmd === colorMode) {
      return;
    }
    this.lastLightModeCmd = colorMode;

    this.platform.log.debug('Set LED ColorTemperature -> mireds=%d mode=%s', mireds, colorMode);
    await this.sendDeviceUpdate({
      device_id: this.deviceId,
      command: { light_mode: colorMode } as AtombergFanCommandData['command'],
    });
  }

  // ---------------------------------------------------------------------------
  // Refresh from broadcast listener (UDP) or initial snapshot
  // ---------------------------------------------------------------------------

  public refreshDeviceStatus(deviceState: AtombergFanDeviceState): void {
    try {
      // Preserve the online flag we received.
      this.fanState = { ...this.fanState, ...deviceState };

      if (!deviceState.is_online) {
        this.pushOfflineCharacteristics();
        return;
      }

      this.platform.log.debug(`Refreshing '${this.accessory.displayName}'`);

      // Active
      const active = deviceState.power
        ? this.platform.Characteristic.Active.ACTIVE
        : this.platform.Characteristic.Active.INACTIVE;
      this.fanService.updateCharacteristic(this.platform.Characteristic.Active, active);

      // Rotation speed
      const percent = this.speedToPercent(deviceState.last_recorded_speed ?? 0);
      this.fanService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, percent);

      // LED on/off
      this.lightbulbService.updateCharacteristic(this.platform.Characteristic.On, !!deviceState.led);

      // LED brightness (I1/M1 only; no-op on other series because the characteristic isn't registered)
      const series = this.accessory.context.device.series;
      if ((series === 'I1' || series === 'M1') && typeof deviceState.last_recorded_brightness === 'number') {
        this.lightbulbService.updateCharacteristic(
          this.platform.Characteristic.Brightness,
          Math.max(0, Math.min(100, deviceState.last_recorded_brightness)),
        );
      }

      // LED colour temperature (I1 only)
      if (series === 'I1' && deviceState.last_recorded_color) {
        const mireds = AtombergFanPlatformAccessory.colorModeToMireds(deviceState.last_recorded_color);
        this.lightbulbService.updateCharacteristic(this.platform.Characteristic.ColorTemperature, mireds);
      }
    } catch (error) {
      this.platform.log.error('An error occurred while refreshing device status. Enable debug for details.');
      this.platform.log.debug(JSON.stringify(error));
    }
  }

  /**
   * Called by the platform when a device has been silent on UDP for longer than
   * the offline threshold. Pushes the "off" state to HomeKit so the Home app
   * mirrors reality.
   */
  public markOffline(): void {
    if (this.fanState.is_online === false) {
      return;
    }
    this.platform.log.info(`Device '${this.accessory.displayName}' appears offline — no UDP broadcast received.`);
    this.fanState.is_online = false;
    this.pushOfflineCharacteristics();
  }

  private pushOfflineCharacteristics(): void {
    this.fanService.updateCharacteristic(
      this.platform.Characteristic.Active,
      this.platform.Characteristic.Active.INACTIVE,
    );
    this.fanService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, 0);
    this.lightbulbService.updateCharacteristic(this.platform.Characteristic.On, false);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private percentToSpeed(percent: number): number {
    const clamped = Math.max(0, Math.min(100, percent));
    const raw = Math.round((clamped / 100) * this.maxSpeed);
    return Math.max(0, Math.min(this.maxSpeed, raw));
  }

  private speedToPercent(speed: number): number {
    const clamped = Math.max(0, Math.min(this.maxSpeed, speed));
    return Math.round((clamped / this.maxSpeed) * 100);
  }

  private static miredsToColorMode(mireds: number): string {
    if (mireds >= 450) {
      return 'warm';
    }
    if (mireds >= 350) {
      return 'daylight';
    }
    return 'cool';
  }

  private static colorModeToMireds(mode: string): number {
    switch ((mode || '').toLowerCase()) {
      case 'warm': return 500;
      case 'daylight': return 400;
      case 'cool': return 300;
      default: return 400;
    }
  }

  /**
   * Verify the device is online before sending any command. If UDP marks it
   * offline, fall back to a rate-limited single-device API probe; if that
   * confirms the device is reachable, proceed. Otherwise throw a HAP
   * SERVICE_COMMUNICATION_FAILURE so HomeKit surfaces the error.
   */
  private async ensureOnlineOrThrow(): Promise<void> {
    if (this.fanState.is_online) {
      return;
    }

    const now = Date.now();
    if (now - this.lastProbeAt < STATE_PROBE_COOLDOWN_MS) {
      this.throwOffline();
    }
    this.lastProbeAt = now;

    this.platform.log.debug(`Device '${this.accessory.displayName}' marked offline — probing API.`);
    const probed = await this.atombergApi.getDeviceStateForDevice(this.deviceId);
    if (probed && probed.is_online) {
      this.platform.log.info(`Device '${this.accessory.displayName}' reachable via API — recovering.`);
      this.fanState = { ...this.fanState, ...probed };
      return;
    }

    this.throwOffline();
  }

  private throwOffline(): never {
    const HapStatusError = (this.platform.api.hap as unknown as { HapStatusError: HapStatusErrorCtor }).HapStatusError;
    throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  private async sendDeviceUpdate(commandData: AtombergFanCommandData): Promise<void> {
    // Per-accessory minimum gap between outgoing commands.
    const now = Date.now();
    const wait = this.lastSendAt + ACCESSORY_THROTTLE_MS - now;
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.lastSendAt = Date.now();

    try {
      this.platform.log.debug('Sending command: ', commandData);
      const ok = await this.atombergApi.sendCommand(commandData);
      if (ok) {
        this.platform.log.debug(`sendDeviceUpdate ok for '${this.accessory.displayName}'`);
      }
    } catch (error) {
      this.platform.log.error('An error occurred while sending a device update. Enable debug for details.');
      if (error) {
        this.platform.log.debug(JSON.stringify(error));
      }
    }
  }
}
