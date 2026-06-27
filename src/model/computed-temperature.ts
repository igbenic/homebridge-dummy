import { CharacteristicEventBus } from './characteristic-events.js';
import { HKCharacteristicKey } from './homekit.js';
import { ComputedCharacteristicRef, ComputedTemperatureConfig } from './types.js';

export interface ComputedValueSource {
  read(): number | undefined;
  subscribe(onValue: (value: number) => void, onInvalidValue?: (value: unknown) => void): () => void;
}

export type StoredComputedValueReader = (accessoryId: string, characteristic: HKCharacteristicKey) => unknown;

export const SUPPORTED_COMPUTED_CHARACTERISTICS = [
  HKCharacteristicKey.CurrentTemperature,
  HKCharacteristicKey.TargetTemperature,
];

export function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isComputedRefConfigured(ref: Partial<ComputedCharacteristicRef> | undefined): boolean {
  return ref !== undefined
    && (
      ref.accessoryId !== undefined
      || ref.serviceType !== undefined
      || ref.serviceSubtype !== undefined
      || ref.characteristic !== undefined
    );
}

export function isComputedTemperatureConfigured(config: Partial<ComputedTemperatureConfig> | undefined): boolean {
  if (config === undefined) {
    return false;
  }

  return config.type !== undefined
    || isComputedRefConfigured(config.minuend)
    || isComputedRefConfigured(config.subtrahend)
    || config.precision !== undefined
    || config.offset !== undefined
    || config.clampMinimum !== undefined
    || config.clampMaximum !== undefined;
}

export function normalizeComputedRefSource(ref: Partial<ComputedCharacteristicRef>): void {
  if (ref.source !== undefined) {
    return;
  }

  ref.source = ref.serviceType !== undefined || ref.serviceSubtype !== undefined ? 'homebridge' : 'dummy';
}

export class DummyCharacteristicValueSource implements ComputedValueSource {
  public constructor(
    private readonly ref: ComputedCharacteristicRef,
    private readonly characteristicEventBus: CharacteristicEventBus,
    private readonly readStoredValue: StoredComputedValueReader,
  ) {}

  public read(): number | undefined {
    const latestValue = this.characteristicEventBus.getLastValue(this.ref.accessoryId, this.ref.characteristic);
    return toFiniteNumber(latestValue) ?? toFiniteNumber(this.readStoredValue(this.ref.accessoryId, this.ref.characteristic));
  }

  public subscribe(onValue: (value: number) => void, onInvalidValue?: (value: unknown) => void): () => void {
    return this.characteristicEventBus.subscribe(this.ref.accessoryId, this.ref.characteristic, event => {
      const value = toFiniteNumber(event.value);
      if (value !== undefined) {
        onValue(value);
      } else {
        onInvalidValue?.(event.value);
      }
    });
  }
}

export function computedRefKey(ref: ComputedCharacteristicRef): string {
  return [
    ref.source,
    ref.accessoryId,
    ref.serviceType ?? '',
    ref.serviceSubtype ?? '',
    ref.characteristic,
  ].join(':');
}

function roundComputedTemperature(value: number, precision: number): number {
  if (precision > 0 && precision < 1) {
    return Math.round(value / precision) * precision;
  }

  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function computeTemperatureDelta(config: ComputedTemperatureConfig, sourceValues: Map<string, number>): number | undefined {
  const minuend = sourceValues.get(computedRefKey(config.minuend));
  const subtrahend = sourceValues.get(computedRefKey(config.subtrahend));

  if (minuend === undefined || subtrahend === undefined) {
    return undefined;
  }

  const precision = config.precision ?? 1;

  let value = minuend - subtrahend + (config.offset ?? 0);
  value = roundComputedTemperature(value, precision);

  if (config.clampMinimum !== undefined) {
    value = Math.max(value, config.clampMinimum);
  }

  if (config.clampMaximum !== undefined) {
    value = Math.min(value, config.clampMaximum);
  }

  return value;
}
