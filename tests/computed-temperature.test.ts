import assert from 'node:assert/strict';
import test from 'node:test';

import { CharacteristicEventBus } from '../src/model/characteristic-events.js';
import {
  computeTemperatureDelta,
  computedRefKey,
  DummyCharacteristicValueSource,
  isComputedTemperatureConfigured,
  normalizeComputedRefSource,
} from '../src/model/computed-temperature.js';
import { HKCharacteristicKey, HomeKitType } from '../src/model/homekit.js';
import { ComputedCharacteristicRef, ComputedTemperatureConfig } from '../src/model/types.js';

const actualRef: ComputedCharacteristicRef = {
  source: 'dummy',
  accessoryId: 'actual',
  characteristic: HKCharacteristicKey.CurrentTemperature,
};

const targetRef: ComputedCharacteristicRef = {
  source: 'dummy',
  accessoryId: 'target',
  characteristic: HKCharacteristicKey.TargetTemperature,
};

test('CharacteristicEventBus only notifies matching accessory characteristic subscribers', () => {
  const bus = new CharacteristicEventBus();
  const received: number[] = [];

  const unsubscribe = bus.subscribe('actual', HKCharacteristicKey.CurrentTemperature, event => {
    received.push(event.value as number);
  });

  bus.publish({ accessoryId: 'actual', characteristic: HKCharacteristicKey.TargetTemperature, value: 20 });
  bus.publish({ accessoryId: 'other', characteristic: HKCharacteristicKey.CurrentTemperature, value: 21 });
  bus.publish({ accessoryId: 'actual', characteristic: HKCharacteristicKey.CurrentTemperature, value: 22 });
  unsubscribe();
  bus.publish({ accessoryId: 'actual', characteristic: HKCharacteristicKey.CurrentTemperature, value: 23 });

  assert.deepEqual(received, [22]);
  assert.equal(bus.getLastValue('actual', HKCharacteristicKey.CurrentTemperature), 23);
});

test('computeTemperatureDelta applies delta formula, precision, offset, and clamps', () => {
  const config: ComputedTemperatureConfig = {
    type: 'DELTA',
    minuend: actualRef,
    subtrahend: targetRef,
    precision: 1,
    offset: 0.05,
    clampMinimum: -2,
    clampMaximum: 2,
  };

  const values = new Map<string, number>([
    [computedRefKey(actualRef), 27.14],
    [computedRefKey(targetRef), 25],
  ]);

  assert.equal(computeTemperatureDelta(config, values), 2);
  values.set(computedRefKey(actualRef), 24.64);
  assert.equal(computeTemperatureDelta(config, values), -0.3);
  values.delete(computedRefKey(targetRef));
  assert.equal(computeTemperatureDelta(config, values), undefined);
});

test('computeTemperatureDelta supports half-degree precision steps', () => {
  const config: ComputedTemperatureConfig = {
    type: 'DELTA',
    minuend: actualRef,
    subtrahend: targetRef,
    precision: 0.5,
  };

  const values = new Map<string, number>([
    [computedRefKey(actualRef), 29.2],
    [computedRefKey(targetRef), 25.5],
  ]);

  assert.equal(computeTemperatureDelta(config, values), 3.5);
});

test('computeTemperatureDelta can expose absolute delta magnitude', () => {
  const config: ComputedTemperatureConfig = {
    type: 'DELTA',
    minuend: actualRef,
    subtrahend: targetRef,
    precision: 0.5,
    absolute: true,
  };

  const values = new Map<string, number>([
    [computedRefKey(actualRef), 24.2],
    [computedRefKey(targetRef), 26],
  ]);

  assert.equal(computeTemperatureDelta(config, values), 2);
});

test('source-only computed defaults are not treated as configured computed temperature', () => {
  assert.equal(isComputedTemperatureConfigured({
    minuend: { source: 'dummy' },
    subtrahend: { source: 'dummy' },
  }), false);

  assert.equal(isComputedTemperatureConfigured({
    type: 'DELTA',
    minuend: { source: 'dummy' },
    subtrahend: { source: 'dummy' },
  }), true);
});

test('missing computed source is inferred from service metadata', () => {
  const ref: Partial<ComputedCharacteristicRef> = {
    accessoryId: 'homebridge-accessory',
    serviceType: HomeKitType.Thermostat,
    characteristic: HKCharacteristicKey.CurrentTemperature,
  };

  normalizeComputedRefSource(ref);

  assert.equal(ref.source, 'homebridge');
});

test('DummyCharacteristicValueSource reads stored values and emits event-driven updates', () => {
  const bus = new CharacteristicEventBus();
  const source = new DummyCharacteristicValueSource(actualRef, bus, (accessoryId, characteristic) => {
    assert.equal(accessoryId, 'actual');
    assert.equal(characteristic, HKCharacteristicKey.CurrentTemperature);
    return 25.6;
  });
  const received: number[] = [];

  assert.equal(source.read(), 25.6);

  const unsubscribe = source.subscribe(value => {
    received.push(value);
  });

  bus.publish({ accessoryId: 'actual', characteristic: HKCharacteristicKey.CurrentTemperature, value: 26.3 });
  bus.publish({ accessoryId: 'actual', characteristic: HKCharacteristicKey.TargetTemperature, value: 24 });
  bus.publish({ accessoryId: 'actual', characteristic: HKCharacteristicKey.CurrentTemperature, value: 'bad' });
  unsubscribe();
  bus.publish({ accessoryId: 'actual', characteristic: HKCharacteristicKey.CurrentTemperature, value: 27.1 });

  assert.deepEqual(received, [26.3]);
});
