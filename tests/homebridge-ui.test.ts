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
        type: HomeKitType.TemperatureSensor,
      },
      {
        id: 'wanted-temp',
        name: 'Wanted temperature',
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
        type: HomeKitType.Switch,
      },
    ],
  );
});

test('computed temperature source schema only exposes supported dummy sources', () => {
  const schema = JSON.parse(readFileSync('config.schema.json', 'utf8'));

  assert.deepEqual(
    schema.schema.definitions.computedCharacteristicRef.properties.source.enum,
    ['dummy'],
  );
});
