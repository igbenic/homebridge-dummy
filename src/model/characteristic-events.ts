import { CharacteristicValue } from 'homebridge';

import { HKCharacteristicKey } from './homekit.js';

export type CharacteristicEventValue = CharacteristicValue;

export type CharacteristicEvent = {
  accessoryId: string,
  characteristic: HKCharacteristicKey,
  value: CharacteristicEventValue,
}

export type CharacteristicEventListener = (event: CharacteristicEvent) => void | Promise<void>;

export class CharacteristicEventBus {
  private readonly listeners = new Map<string, Set<CharacteristicEventListener>>();
  private readonly latestValues = new Map<string, CharacteristicEventValue>();

  public subscribe(accessoryId: string, characteristic: HKCharacteristicKey, listener: CharacteristicEventListener): () => void {
    const key = this.key(accessoryId, characteristic);
    const listeners = this.listeners.get(key) ?? new Set<CharacteristicEventListener>();
    listeners.add(listener);
    this.listeners.set(key, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(key);
      }
    };
  }

  public publish(event: CharacteristicEvent): void {
    const key = this.key(event.accessoryId, event.characteristic);
    this.latestValues.set(key, event.value);

    for (const listener of this.listeners.get(key) ?? []) {
      void listener(event);
    }
  }

  public getLastValue(accessoryId: string, characteristic: HKCharacteristicKey): CharacteristicEventValue | undefined {
    return this.latestValues.get(this.key(accessoryId, characteristic));
  }

  private key(accessoryId: string, characteristic: HKCharacteristicKey): string {
    return `${accessoryId}:${characteristic}`;
  }
}
