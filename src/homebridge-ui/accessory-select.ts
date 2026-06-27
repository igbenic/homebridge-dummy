import { HomeKitType } from '../model/homekit.js';
import { DummyConfig, DummyPlatformConfig } from '../model/types.js';

export type AccessorySelectOption = {
  id: string,
  name: string,
  source: 'dummy' | 'homebridge',
  type: HomeKitType,
  serviceType?: string,
  serviceSubtype?: string,
  plugin?: string,
  platform?: string,
};

export type CachedHomebridgeCharacteristic = {
  constructorName?: string,
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
  services?: CachedHomebridgeService[],
}

const COMPUTED_ACCESSORY_TYPES = [
  HomeKitType.TemperatureSensor,
  HomeKitType.Thermostat,
];

const COMPUTED_CHARACTERISTICS = [
  'CurrentTemperature',
  'TargetTemperature',
];

function isSelectableAccessory(accessory: Partial<DummyConfig>): accessory is DummyConfig {
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
          source: 'dummy',
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

function cachedComputedSourceAccessories(cachedHomebridgeAccessories: CachedHomebridgeAccessory[]): AccessorySelectOption[] {
  const options: AccessorySelectOption[] = [];

  for (const accessory of cachedHomebridgeAccessories) {
    if (typeof accessory.UUID !== 'string' || accessory.UUID.length === 0) {
      continue;
    }

    const accessoryName = accessory.displayName?.trim() || accessory.UUID;

    for (const service of accessory.services ?? []) {
      const type = service.constructorName as HomeKitType;
      if (!COMPUTED_ACCESSORY_TYPES.includes(type)) {
        continue;
      }

      if (!service.characteristics?.some(characteristic => {
        return characteristic.constructorName !== undefined && COMPUTED_CHARACTERISTICS.includes(characteristic.constructorName);
      })) {
        continue;
      }

      const serviceName = service.displayName?.trim() || service.constructorName;
      const name = `${accessoryName} ${serviceName} (Homebridge)`;

      options.push({
        id: accessory.UUID,
        name,
        source: 'homebridge',
        type,
        serviceType: service.constructorName,
        ...(service.subtype ? { serviceSubtype: service.subtype } : {}),
        plugin: accessory.plugin,
        platform: accessory.platform,
      });
    }
  }

  return options;
}

export function computedSourceAccessories(
  configs: Array<Pick<DummyPlatformConfig, 'accessories'>>,
  cachedHomebridgeAccessories: CachedHomebridgeAccessory[] = [],
): AccessorySelectOption[] {
  return [
    ...configuredAccessories(configs)
      .filter(accessory => COMPUTED_ACCESSORY_TYPES.includes(accessory.type)),
    ...cachedComputedSourceAccessories(cachedHomebridgeAccessories),
  ];
}
