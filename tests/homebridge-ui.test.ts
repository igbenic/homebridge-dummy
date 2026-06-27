import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  computedSourceAccessories,
  conditionOperandAccessories,
} from '../src/homebridge-ui/accessory-select.js';
import { HomeKitType } from '../src/model/homekit.js';

const configs = [
  {
    accessories: [
      {
        id: 'switch',
        name: 'Switch',
        type: HomeKitType.Switch,
      },
      {
        id: 'room-temp',
        name: 'AC Room Temp Input',
        type: HomeKitType.TemperatureSensor,
      },
      {
        id: 'wanted-temp',
        name: 'Wanted temperature',
        type: HomeKitType.Thermostat,
      },
      {
        id: 'humidity',
        name: 'Humidity',
        type: HomeKitType.HumiditySensor,
      },
    ],
  },
];

test('computed source accessory picker includes dummy temperature sensors and thermostats only', () => {
  assert.deepEqual(
    computedSourceAccessories(configs),
    [
      {
        id: 'room-temp',
        name: 'AC Room Temp Input',
        source: 'dummy',
        type: HomeKitType.TemperatureSensor,
      },
      {
        id: 'wanted-temp',
        name: 'Wanted temperature',
        source: 'dummy',
        type: HomeKitType.Thermostat,
      },
    ],
  );
});

test('computed source accessory picker includes cached Homebridge temperature services', () => {
  assert.deepEqual(
    computedSourceAccessories(configs, [
      {
        displayName: 'Split AC',
        UUID: 'e921608f-2394-464f-81c8-f36c965e4c47',
        plugin: 'homebridge-tcl-split-ac',
        platform: 'TclHome',
        services: [
          {
            constructorName: 'Thermostat',
            subtype: null,
            characteristics: [
              { constructorName: 'CurrentTemperature' },
              { constructorName: 'TargetTemperature' },
            ],
          },
        ],
      },
    ]),
    [
      {
        id: 'room-temp',
        name: 'AC Room Temp Input',
        source: 'dummy',
        type: HomeKitType.TemperatureSensor,
      },
      {
        id: 'wanted-temp',
        name: 'Wanted temperature',
        source: 'dummy',
        type: HomeKitType.Thermostat,
      },
      {
        id: 'e921608f-2394-464f-81c8-f36c965e4c47',
        name: 'Split AC Thermostat (Homebridge)',
        platform: 'TclHome',
        plugin: 'homebridge-tcl-split-ac',
        serviceType: 'Thermostat',
        source: 'homebridge',
        type: HomeKitType.Thermostat,
      },
    ],
  );
});

test('condition operand accessory picker keeps temperature-only accessories out', () => {
  assert.deepEqual(
    conditionOperandAccessories(configs),
    [
      {
        id: 'switch',
        name: 'Switch',
        source: 'dummy',
        type: HomeKitType.Switch,
      },
    ],
  );
});

test('computed temperature source schema exposes dummy and Homebridge sources', () => {
  const schema = JSON.parse(readFileSync('config.schema.json', 'utf8'));

  assert.deepEqual(
    schema.schema.definitions.computedCharacteristicRef.properties.source.enum,
    ['dummy', 'homebridge'],
  );
});

test('computed temperature schema allows half-degree precision', () => {
  const schema = JSON.parse(readFileSync('config.schema.json', 'utf8'));

  assert.equal(
    schema.schema.definitions.computedTemperature.properties.precision.type,
    'number',
  );
});
