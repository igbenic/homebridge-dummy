import fs from 'fs';
import path from 'path';
import TailFile from 'tail-file';

import { strings } from '../i18n/i18n.js';
import { Log } from '../tools/log.js';
import { ComputedValueSource, SUPPORTED_COMPUTED_CHARACTERISTICS, computedRefKey, toFiniteNumber } from './computed-temperature.js';
import { HKCharacteristicKey } from './homekit.js';
import { ComputedCharacteristicRef } from './types.js';

export type CachedHomebridgeCharacteristic = {
  constructorName?: string,
  value?: unknown,
}

export type CachedHomebridgeService = {
  displayName?: string,
  constructorName?: string,
  subtype?: string | null,
  characteristics?: CachedHomebridgeCharacteristic[],
}

export type CachedHomebridgeAccessory = {
  displayName?: string,
  UUID?: string,
  plugin?: string,
  platform?: string,
  context?: Record<string, unknown>,
  services?: CachedHomebridgeService[],
}

export type TclTemperatureReadings = {
  currentTemperature?: number,
  targetTemperature?: number,
}

type HomebridgeSourceSubscription = {
  ref: ComputedCharacteristicRef,
  onValue: (value: number) => void,
}

export function parseTclTemperatureLine(line: string): TclTemperatureReadings | undefined {
  if (!line.includes('[TCL Home]')) {
    return undefined;
  }

  const readings: TclTemperatureReadings = {};

  for (const match of line.matchAll(/\b(room|target)=\s*([+-]?\d+(?:\.\d+)?)\s*°?C?/gi)) {
    const value = Number(match[2]);
    if (!Number.isFinite(value)) {
      continue;
    }

    if (match[1].toLowerCase() === 'room') {
      readings.currentTemperature = value;
    } else {
      readings.targetTemperature = value;
    }
  }

  return readings.currentTemperature === undefined && readings.targetTemperature === undefined
    ? undefined
    : readings;
}

function findCachedHomebridgeAccessory(
  ref: ComputedCharacteristicRef,
  cachedAccessories: CachedHomebridgeAccessory[],
): CachedHomebridgeAccessory | undefined {
  return cachedAccessories.find(accessory => {
    return accessory.UUID === ref.accessoryId
      || accessory.displayName === ref.accessoryId
      || accessory.context?.identifier === ref.accessoryId;
  });
}

function isTclAccessory(accessory: CachedHomebridgeAccessory): boolean {
  return accessory.plugin === 'homebridge-tcl-split-ac' || accessory.platform === 'TclHome';
}

export function findCachedHomebridgeCharacteristic(
  ref: ComputedCharacteristicRef,
  cachedAccessories: CachedHomebridgeAccessory[],
): CachedHomebridgeCharacteristic | undefined {
  const accessory = findCachedHomebridgeAccessory(ref, cachedAccessories);
  if (accessory === undefined) {
    return undefined;
  }

  const service = (accessory.services ?? []).find(service => {
    if (ref.serviceType !== undefined && service.constructorName !== ref.serviceType) {
      return false;
    }

    if (ref.serviceSubtype !== undefined && (service.subtype ?? undefined) !== ref.serviceSubtype) {
      return false;
    }

    return service.characteristics?.some(characteristic => characteristic.constructorName === ref.characteristic) === true;
  });

  return service?.characteristics?.find(characteristic => characteristic.constructorName === ref.characteristic);
}

export function isSupportedHomebridgeCharacteristicSource(
  ref: ComputedCharacteristicRef,
  cachedAccessories: CachedHomebridgeAccessory[],
): boolean {
  const accessory = findCachedHomebridgeAccessory(ref, cachedAccessories);
  if (accessory === undefined) {
    return false;
  }

  return isTclAccessory(accessory)
    && findCachedHomebridgeCharacteristic(ref, cachedAccessories) !== undefined
    && SUPPORTED_COMPUTED_CHARACTERISTICS.includes(ref.characteristic as HKCharacteristicKey);
}

class HomebridgeCharacteristicValueSource implements ComputedValueSource {
  public constructor(
    private readonly ref: ComputedCharacteristicRef,
    private readonly manager: HomebridgeCharacteristicSourceManager,
  ) {}

  public read(): number | undefined {
    return this.manager.read(this.ref);
  }

  public subscribe(onValue: (value: number) => void): () => void {
    return this.manager.subscribe(this.ref, onValue);
  }
}

export class HomebridgeCharacteristicSourceManager {

  private tailFile?: TailFile;
  private readonly subscriptions = new Map<string, HomebridgeSourceSubscription[]>();

  public constructor(
    private readonly log: Log,
    private readonly storagePath: string,
  ) {}

  public createSource(ref: ComputedCharacteristicRef): ComputedValueSource | undefined {
    const cachedAccessories = this.loadCachedAccessories();

    if (!isSupportedHomebridgeCharacteristicSource(ref, cachedAccessories)) {
      this.log.warning(strings.computed.unsupportedHomebridgeSource, ref.accessoryId, ref.serviceType ?? '', ref.characteristic);
      return undefined;
    }

    return new HomebridgeCharacteristicValueSource(ref, this);
  }

  public read(ref: ComputedCharacteristicRef): number | undefined {
    const characteristic = findCachedHomebridgeCharacteristic(ref, this.loadCachedAccessories());
    return toFiniteNumber(characteristic?.value);
  }

  public subscribe(ref: ComputedCharacteristicRef, onValue: (value: number) => void): () => void {
    const key = computedRefKey(ref);
    const subscription = { ref, onValue };
    const subscriptions = this.subscriptions.get(key) ?? [];
    subscriptions.push(subscription);
    this.subscriptions.set(key, subscriptions);
    this.startTclLogWatcher();

    return () => {
      const subscriptions = this.subscriptions.get(key);
      if (subscriptions !== undefined) {
        const index = subscriptions.indexOf(subscription);
        if (index !== -1) {
          subscriptions.splice(index, 1);
        }

        if (subscriptions.length === 0) {
          this.subscriptions.delete(key);
        }
      }

      if (this.subscriptions.size === 0) {
        void this.tailFile?.stop();
        this.tailFile = undefined;
      }
    };
  }

  public teardown() {
    this.subscriptions.clear();
    void this.tailFile?.stop();
    this.tailFile = undefined;
  }

  private loadCachedAccessories(): CachedHomebridgeAccessory[] {
    const accessoriesPath = path.join(this.storagePath, 'accessories');

    if (!fs.existsSync(accessoriesPath)) {
      return [];
    }

    const accessories: CachedHomebridgeAccessory[] = [];

    for (const fileName of fs.readdirSync(accessoriesPath)) {
      if (!fileName.startsWith('cachedAccessories')) {
        continue;
      }

      try {
        const contents = fs.readFileSync(path.join(accessoriesPath, fileName), 'utf8');
        const parsed = JSON.parse(contents) as unknown;
        if (Array.isArray(parsed)) {
          accessories.push(...parsed as CachedHomebridgeAccessory[]);
        }
      } catch (err) {
        this.log.warning(strings.computed.unreadableHomebridgeCache, fileName, String(err));
      }
    }

    return accessories;
  }

  private startTclLogWatcher() {
    if (this.tailFile !== undefined) {
      return;
    }

    const logFilePath = path.join(this.storagePath, 'homebridge.log');
    if (!fs.existsSync(logFilePath)) {
      this.log.warning(strings.logWatcher.missingFile, `'${logFilePath}'`);
      return;
    }

    this.tailFile = new TailFile(logFilePath, { startPos: 'end' });
    this.tailFile.on('line', line => this.handleLogLine(line));
    this.tailFile.on('error', err => this.log.error(strings.logWatcher.error, String(err)));
    void this.tailFile.start();
  }

  private handleLogLine(line: string) {
    const readings = parseTclTemperatureLine(line);
    if (readings === undefined) {
      return;
    }

    if (readings.currentTemperature !== undefined) {
      this.publishTclTemperature(HKCharacteristicKey.CurrentTemperature, readings.currentTemperature);
    }

    if (readings.targetTemperature !== undefined) {
      this.publishTclTemperature(HKCharacteristicKey.TargetTemperature, readings.targetTemperature);
    }
  }

  private publishTclTemperature(characteristic: HKCharacteristicKey, value: number) {
    for (const subscriptions of this.subscriptions.values()) {
      for (const subscription of subscriptions) {
        if (subscription.ref.characteristic === characteristic) {
          subscription.onValue(value);
        }
      }
    }
  }
}
