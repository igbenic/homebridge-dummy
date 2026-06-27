import fs from 'fs';
import path from 'path';

import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';

type CachedHomebridgeCharacteristic = {
  constructorName?: string,
}

type CachedHomebridgeService = {
  displayName?: string,
  constructorName?: string,
  subtype?: string | null,
  characteristics?: CachedHomebridgeCharacteristic[],
}

type CachedHomebridgeAccessory = {
  displayName?: string,
  UUID?: string,
  plugin?: string,
  platform?: string,
  services?: CachedHomebridgeService[],
}

function summarizeCachedAccessory(accessory: CachedHomebridgeAccessory): CachedHomebridgeAccessory {
  return {
    displayName: accessory.displayName,
    UUID: accessory.UUID,
    plugin: accessory.plugin,
    platform: accessory.platform,
    services: (accessory.services ?? []).map(service => ({
      displayName: service.displayName,
      constructorName: service.constructorName,
      subtype: service.subtype,
      characteristics: (service.characteristics ?? []).map(characteristic => ({
        constructorName: characteristic.constructorName,
      })),
    })),
  };
}

function readCachedAccessories(storagePath: string | undefined): CachedHomebridgeAccessory[] {
  if (storagePath === undefined) {
    return [];
  }

  const accessoriesPath = path.join(storagePath, 'accessories');
  if (!fs.existsSync(accessoriesPath)) {
    return [];
  }

  const accessories: CachedHomebridgeAccessory[] = [];

  for (const fileName of fs.readdirSync(accessoriesPath)) {
    if (!fileName.startsWith('cachedAccessories')) {
      continue;
    }

    const parsed = JSON.parse(fs.readFileSync(path.join(accessoriesPath, fileName), 'utf8')) as unknown;
    if (Array.isArray(parsed)) {
      accessories.push(...(parsed as CachedHomebridgeAccessory[]).map(summarizeCachedAccessory));
    }
  }

  return accessories;
}

class DummyUiServer extends HomebridgePluginUiServer {
  public constructor() {
    super();

    this.onRequest('/homebridge-accessories', () => readCachedAccessories(this.homebridgeStoragePath));

    this.ready();
  }
}

(() => new DummyUiServer())();
