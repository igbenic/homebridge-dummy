import { HomeKitType } from '../model/homekit.js';
import { DummyConfig, DummyPlatformConfig } from '../model/types.js';

export type AccessorySelectOption = {
  id: string,
  name: string,
  type: HomeKitType,
};

function isSelectableAccessory(accessory: Partial<DummyConfig>): accessory is AccessorySelectOption {
  return typeof accessory.id === 'string'
    && accessory.id.length > 0
    && typeof accessory.name === 'string'
    && accessory.name.length > 0
    && Object.values(HomeKitType).includes(accessory.type as HomeKitType);
}

function configuredAccessories(configs: Array<Pick<DummyPlatformConfig, 'accessories'>>): AccessorySelectOption[] {
  const accessories: AccessorySelectOption[] = [];

  for (const config of configs) {
    for (const accessory of config.accessories ?? []) {
      if (isSelectableAccessory(accessory)) {
        accessories.push({
          id: accessory.id,
          name: accessory.name,
          type: accessory.type,
        });
      }
    }
  }

  return accessories;
}

export function conditionOperandAccessories(configs: Array<Pick<DummyPlatformConfig, 'accessories'>>): AccessorySelectOption[] {
  return configuredAccessories(configs)
    .filter(accessory => ![
      HomeKitType.HumiditySensor,
      HomeKitType.StatelessProgrammableSwitch,
      HomeKitType.TemperatureSensor,
      HomeKitType.Thermostat,
    ].includes(accessory.type));
}

export function computedSourceAccessories(configs: Array<Pick<DummyPlatformConfig, 'accessories'>>): AccessorySelectOption[] {
  return configuredAccessories(configs)
    .filter(accessory => [
      HomeKitType.TemperatureSensor,
      HomeKitType.Thermostat,
    ].includes(accessory.type));
}
