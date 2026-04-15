import dgram from 'dgram';
import { Logger } from 'homebridge';
import { EventEmitter } from 'events';
import { AtombergFanDeviceState } from './model';

/**
 * BroadcastListener
 * Listens to UDP broadcasts emitted by Atomberg fans on the local network.
 *
 * Two packet flavours are observed in the wild:
 *   1. Full state broadcasts — JSON with `device_id` + `state_string`, used to
 *      update every characteristic in real time.
 *   2. Heartbeat/presence packets — short JSON with just `device_id`, emitted by
 *      newer firmwares periodically so we know the device is still on-network
 *      even when its state is unchanged.
 *
 * We also accept two encodings: plain UTF-8 JSON (newer firmware) and
 * hex-encoded UTF-8 JSON (older firmware).
 */
class BroadcastListener extends EventEmitter {
  private static instance: BroadcastListener;
  public readonly socket = dgram.createSocket('udp4');
  private readonly bindPort = 5625;
  private readonly log: Logger;

  private constructor(log: Logger) {
    super();
    this.log = log;
  }

  public static getInstance(log: Logger): BroadcastListener {
    if (!BroadcastListener.instance) {
      BroadcastListener.instance = new BroadcastListener(log);
    }
    return BroadcastListener.instance;
  }

  private onListen() {
    const address = this.socket.address();
    this.log.debug(`UDP socket listening on ${address.address}:${address.port}`);
  }

  private onMessage(message: Buffer, remote: dgram.RemoteInfo) {
    const jsonMessage = this.decodeMessage(message);
    if (!jsonMessage) {
      // Not a recognised Atomberg packet — silently ignore instead of spamming logs.
      return;
    }

    const deviceId = jsonMessage['device_id'] as string | undefined;
    if (!deviceId) {
      return;
    }

    if (jsonMessage['state_string']) {
      const state = this.parseState(jsonMessage);
      if (state) {
        this.log.debug(`Broadcast state from ${remote.address}:${remote.port} - ${JSON.stringify(state)}`);
        this.emit('stateChange', state);
      }
    } else {
      // Heartbeat — emit presence so the platform can refresh its lastSeen timer.
      this.emit('deviceSeen', deviceId);
    }
  }

  /**
   * Try plain UTF-8 JSON first; if that fails, try hex-decoded UTF-8 JSON.
   * Returns null on any parse failure.
   */
  private decodeMessage(message: Buffer): Record<string, unknown> | null {
    const raw = message.toString('utf8');
    try {
      return JSON.parse(raw);
    } catch {
      // fall through
    }
    try {
      const decoded = Buffer.from(raw, 'hex').toString('utf8');
      return JSON.parse(decoded);
    } catch {
      return null;
    }
  }

  private parseState(jsonMessage: Record<string, unknown>): AtombergFanDeviceState | null {
    try {
      const stateStringRaw = jsonMessage['state_string'] as string;
      const stateCodeStr = stateStringRaw.split(',')[0];
      // Unsigned 32-bit interpretation — older signed math produced negative
      // fanTimerElapsedMins values when the high bit was set.
      const stateCode = (parseInt(stateCodeStr, 10) >>> 0);

      const power = (stateCode & 0x10) > 0;
      const led = (stateCode & 0x20) > 0;
      const sleep = (stateCode & 0x80) > 0;
      const speed = stateCode & 0x07;
      const fanTimer = (stateCode >>> 16) & 0x0F;
      const fanTimerElapsedMins = ((stateCode >>> 24) & 0xFF) * 4;
      // Aris Starlight specific
      const brightness = (stateCode >>> 8) & 0x7F;
      const cool = (stateCode & 0x08) > 0;
      const warm = (stateCode & 0x8000) > 0;

      return {
        device_id: jsonMessage['device_id'] as string,
        is_online: true,
        power,
        led,
        sleep_mode: sleep,
        last_recorded_speed: speed,
        timer_hours: fanTimer,
        timer_time_elapsed_mins: fanTimerElapsedMins,
        ts_epoch_seconds: Math.floor(Date.now() / 1000),
        last_recorded_brightness: brightness,
        last_recorded_color: cool ? (warm ? 'Daylight' : 'Cool') : 'Warm',
      };
    } catch (error) {
      this.log.debug('Error parsing broadcast state_string: ', error);
      return null;
    }
  }

  public listen() {
    this.log.debug(`Listening for broadcast messages on port ${this.bindPort}`);
    this.socket.on('listening', this.onListen.bind(this));
    this.socket.on('message', this.onMessage.bind(this));
    this.socket.on('error', (err) => {
      this.log.error('UDP socket error:', err.message);
    });
    this.socket.bind(this.bindPort);
  }

  public close() {
    this.socket.close();
  }
}

export default BroadcastListener;
