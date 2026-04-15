import { PlatformConfig } from 'homebridge';

/**
 * Plugin configuration schema.
 */
export interface AtombergFanPlatformConfig extends PlatformConfig {
  apiKey: string;
  refreshToken: string;
  /**
   * When true, use the legacy 5-speed mapping (0..100% → 0..5 in 20% steps)
   * instead of the default 6-speed mapping (0..100% → 0..6, continuous). Enable
   * only for older fans that physically lack the Boost / turbo (6th) speed.
   */
  legacy5Speed?: boolean;
}

export interface AtombergFanDevice {
  device_id: string;
  color: string;
  series: string;
  model: string;
  room: string;
  name: string;
  metadata: AtombergFanDeviceMetadata;
}

export interface AtombergFanDeviceMetadata {
  ssid: string;
}

export interface AtombergFanDeviceState {
  device_id: string;
  is_online: boolean;
  power: boolean;
  led: boolean;
  sleep_mode: boolean;
  last_recorded_speed: number;
  timer_hours: number;
  timer_time_elapsed_mins: number;
  ts_epoch_seconds: number;
  last_recorded_brightness: number; // Aris Starlight / I1 / M1
  last_recorded_color: string;      // Aris Starlight / I1 ('Warm' | 'Cool' | 'Daylight')
}

export interface AtombergFanCommandData {
  device_id: string;
  command: AtombergFanCommandType;
}

/**
 * Command payload. Every field is optional — send only what you want to change.
 */
export interface AtombergFanCommandType {
  power?: boolean;
  speed?: number;        // 1..6 (6 = Boost)
  speedDelta?: number;   // -5..+5
  sleep?: boolean;
  timer?: number;        // 0..4 (0=1h, 1=1h, 2=2h, 3=3h, 4=6h per Atomberg docs)
  led?: boolean;
  brightness?: number;       // 10..100 (I1/M1/Aris)
  brightnessDelta?: number;  // -90..+90
  light_mode?: string;       // 'cool' | 'warm' | 'daylight' (I1/Aris)
}
