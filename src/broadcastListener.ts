import dgram from 'dgram';
import { Logger } from 'homebridge';
import { EventEmitter } from 'events';
import { AtombergFanDeviceState } from './model';

/**
 * BroadcastListener
 * This class is responsible for listening to broadcast messages from the Atomberg Fan devices.
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
    this.log.debug('UDP socket listening on ' + address.address + ':' + address.port);
  }

  private onMessage(message: Buffer, remote: dgram.RemoteInfo) {
    if (remote.size > 100) {
      try {
        const res = this.parseMessage(message) as AtombergFanDeviceState;
        this.log.debug('Received message from ' + remote.address + ':' + remote.port + ' - ' + JSON.stringify(res));
        if (res) {
          this.emit('stateChange', res);
        }
      } catch (error) {
        this.log.error('Error parsing broadcast message: ', error);
      }
    }
  }

  private parseMessage(message: Buffer): AtombergFanDeviceState | null {
    try {
      const hexString = message.toString();
      const stringMessage = Buffer.from(hexString, 'hex').toString('utf8');
      const jsonMessage = JSON.parse(stringMessage);
      // state_string is a numeric string; parse explicitly and force unsigned 32-bit
      // so bit 31 (high byte of fan-timer-elapsed) doesn't flip the value negative.
      const stateCode = (Number(jsonMessage['state_string'].split(',')[0]) >>> 0);

      const power = (stateCode & 0x10) > 0;
      const led = (stateCode & 0x20) > 0;
      const sleep = (stateCode & 0x80) > 0;
      const speed = stateCode & 0x07;
      const fanTimer = (stateCode & 0x0F0000) >>> 16;
      const fanTimerElapsedMins = ((stateCode >>> 24) & 0xFF) * 4;
      // Aris Starlight Specific
      const brightness = (stateCode & 0x7F00) >>> 8;
      const cool = (stateCode & 0x08) > 0;
      const warm = (stateCode & 0x8000) > 0;

      // Keep casing consistent with the Atomberg API's `light_mode` values
      // (`warm` / `cool` / `daylight`) so the refresh path can round-trip it.
      const color = cool ? (warm ? 'daylight' : 'cool') : 'warm';

      return {
        'device_id': jsonMessage['device_id'],
        'is_online': true,
        'power': power,
        'led': led,
        'sleep_mode': sleep,
        'last_recorded_speed': speed,
        'timer_hours': fanTimer,
        'timer_time_elapsed_mins': fanTimerElapsedMins,
        'last_recorded_brightness': brightness,  // aris starlight only
        'last_recorded_color': color,  // aris starlight only
      } as AtombergFanDeviceState;
    } catch (error) {
      this.log.error('Error parsing broadcast message: ', error);
      return null;
    }
  }

  public listen() {
    this.log.debug('Listening for broadcast messages on port ' + this.bindPort);
    this.socket.bind(this.bindPort);
    this.socket.on('listening', this.onListen.bind(this));
    this.socket.on('message', this.onMessage.bind(this));
  }

  public close() {
    this.socket.close();
  }
}

export default BroadcastListener;
