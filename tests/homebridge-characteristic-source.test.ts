import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  findCachedHomebridgeCharacteristic,
  HomebridgeCharacteristicSourceManager,
  isSupportedHomebridgeCharacteristicSource,
  parseTclTemperatureLine,
} from '../src/model/homebridge-characteristic-source.js';
import { HKCharacteristicKey } from '../src/model/homekit.js';

const splitAcAccessory = {
  displayName: 'Split AC',
  UUID: 'e921608f-2394-464f-81c8-f36c965e4c47',
  plugin: 'homebridge-tcl-split-ac',
  platform: 'TclHome',
  services: [
    {
      constructorName: 'Thermostat',
      subtype: null,
      characteristics: [
        {
          constructorName: 'CurrentTemperature',
          value: 28,
        },
        {
          constructorName: 'TargetTemperature',
          value: 25,
        },
      ],
    },
  ],
};

test('TCL temperature log parser extracts room and target temperatures', () => {
  assert.deepEqual(
    parseTclTemperatureLine('[TCL Home] 📈 power=0 mode=1 wind=4 room=28°C target=25°C'),
    {
      currentTemperature: 28,
      targetTemperature: 25,
    },
  );
});

test('TCL temperature log parser handles target before room', () => {
  assert.deepEqual(
    parseTclTemperatureLine('[TCL Home] target=24.5°C room=27.25°C'),
    {
      currentTemperature: 27.25,
      targetTemperature: 24.5,
    },
  );
});

test('cached Homebridge characteristic lookup reads the TCL thermostat current temperature', () => {
  const characteristic = findCachedHomebridgeCharacteristic(
    {
      source: 'homebridge',
      accessoryId: 'e921608f-2394-464f-81c8-f36c965e4c47',
      serviceType: 'Thermostat',
      characteristic: HKCharacteristicKey.CurrentTemperature,
    },
    [splitAcAccessory],
  );

  assert.equal(characteristic?.value, 28);
});

test('TCL thermostat temperature source is supported for event-driven Homebridge computed input', () => {
  assert.equal(
    isSupportedHomebridgeCharacteristicSource(
      {
        source: 'homebridge',
        accessoryId: 'e921608f-2394-464f-81c8-f36c965e4c47',
        serviceType: 'Thermostat',
        characteristic: HKCharacteristicKey.CurrentTemperature,
      },
      [splitAcAccessory],
    ),
    true,
  );
});

test('TCL temperature updates notify every subscriber to the same Homebridge source', async () => {
  const storagePath = mkdtempSync(join(tmpdir(), 'homebridge-dummy-test-'));
  mkdirSync(join(storagePath, 'accessories'));
  writeFileSync(join(storagePath, 'accessories', 'cachedAccessories.test'), JSON.stringify([splitAcAccessory]));
  writeFileSync(join(storagePath, 'homebridge.log'), '');

  const manager = new HomebridgeCharacteristicSourceManager({
    warning() {},
    error() {},
  } as never, storagePath);

  const ref = {
    source: 'homebridge' as const,
    accessoryId: 'e921608f-2394-464f-81c8-f36c965e4c47',
    serviceType: 'Thermostat',
    characteristic: HKCharacteristicKey.CurrentTemperature,
  };

  const firstSource = manager.createSource(ref);
  const secondSource = manager.createSource(ref);
  assert.ok(firstSource);
  assert.ok(secondSource);

  const firstValues: number[] = [];
  const secondValues: number[] = [];

  const testManager = manager as unknown as {
    handleLogLine(line: string): void,
    tailFile?: { stop(): Promise<void> },
  };

  try {
    firstSource.subscribe(value => firstValues.push(value));
    secondSource.subscribe(value => secondValues.push(value));

    testManager.handleLogLine('[TCL Home] 📈 power=1 mode=1 wind=6 room=25°C target=25°C');
  } finally {
    await testManager.tailFile?.stop();
    manager.teardown();
  }

  assert.deepEqual(firstValues, [25]);
  assert.deepEqual(secondValues, [25]);
});
