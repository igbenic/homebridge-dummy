import { CharacteristicValue } from 'homebridge';

import { DummyAccessory, DummyAccessoryDependency } from '../base.js';

import { strings } from '../../i18n/i18n.js';

import {
  ComputedValueSource,
  computeTemperatureDelta,
  computedRefKey,
  DummyCharacteristicValueSource,
  isComputedTemperatureConfigured,
  normalizeComputedRefSource,
  SUPPORTED_COMPUTED_CHARACTERISTICS,
  toFiniteNumber,
} from '../../model/computed-temperature.js';
import { TemperatureUnits } from '../../model/enums.js';
import { HistoryType } from '../../model/history.js';
import { HKCharacteristicKey, HomeKitType } from '../../model/homekit.js';
import { ComputedCharacteristicRef, ComputedTemperatureConfig, TemperatureSensorConfig } from '../../model/types.js';
import { Range, Webhook } from '../../model/webhook.js';
import { Storage } from '../../tools/storage.js';
import { fromCelsius, toCelsius } from '../../tools/temperature.js';
import { isValid, printableValues } from '../../tools/validation.js';

const MIN_TEMP = -270;
const MAX_TEMP = 100;

export class TemperatureSensorAccessory extends DummyAccessory<TemperatureSensorConfig> {

  private temperature: CharacteristicValue;
  private readonly computedSourceValues = new Map<string, number>();
  private readonly unsubscribeComputed: (() => void)[] = [];
  private activeComputedConfig?: ComputedTemperatureConfig;

  constructor(dependency: DummyAccessoryDependency<TemperatureSensorConfig>) {
    super(dependency);

    if (!isValid(TemperatureUnits, dependency.config.temperatureUnits)) {
      this.log.warning(strings.sensor.badTemperatureUnits, this.displayName, `'${dependency.config.temperatureUnits}'`, printableValues(TemperatureUnits));
    }

    this.service.getCharacteristic(this.homekit.Characteristic.CurrentTemperature)
      .onGet(this.getTemperature.bind(this));

    const persistedTemperature = this.isStateful ? this.getProperty(HKCharacteristicKey.CurrentTemperature) : undefined;
    this.temperature = persistedTemperature ?? 0;

    if (!isComputedTemperatureConfigured(this.config.computed)) {
      if (persistedTemperature !== undefined) {
        this.publishCharacteristic(HKCharacteristicKey.CurrentTemperature, this.temperature);
      }
    } else {
      this.setupComputed();
    }
  }

  override getHomeKitType(): HomeKitType {
    return HomeKitType.TemperatureSensor;
  }

  override get webhooks(): Webhook[] {
    if (this.config.computed !== undefined) {
      return [];
    }

    return [
      new Webhook(this, HKCharacteristicKey.CurrentTemperature,
        new Range(fromCelsius(MIN_TEMP, this.units), fromCelsius(MAX_TEMP, this.units)),
        () => this.temperature,
        (value, syncOnly) => {
          value = toCelsius(value as number, this.units);
          this.setTemperature(value, syncOnly);
          return this.temperatureLogTemplateForCV(value).replace('%s', this.displayName);
        },
        this.config.disableLogging),
    ];
  }

  private get units(): TemperatureUnits {
    return this.config.temperatureUnits ?? TemperatureUnits.CELSIUS;
  }

  private async getTemperature(): Promise<CharacteristicValue> {
    return this.temperature;
  }

  private async setTemperature(value: CharacteristicValue, syncOnly: boolean = false) {
    await this.updateTemperature(value, !syncOnly);
  }

  private async setComputedTemperature(value: CharacteristicValue) {
    await this.updateTemperature(value, false);
  }

  private async updateTemperature(value: CharacteristicValue, executeCommand: boolean) {

    const changed = this.temperature !== value;

    if (changed) {
      this.logTemperature(value);

      this.setProperty(HKCharacteristicKey.CurrentTemperature, value);

      if (executeCommand && this.config.commandTemperature) {
        this.executeCommand(this.config.commandTemperature);
      }

      this.recordHistory(HistoryType.WEATHER, { temp: value as number } );
    }

    this.temperature = value;

    this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, this.temperature);

    if (changed) {
      this.publishCharacteristic(HKCharacteristicKey.CurrentTemperature, value);
    }
  }

  override async trigger(): Promise<void> {
    throw new Error(`${this.trigger.name} is unsupported for ${TemperatureSensorAccessory.name}`);
  }

  override async reset(): Promise<void> {
    throw new Error(`${this.reset.name} is unsupported for ${TemperatureSensorAccessory.name}`);
  }

  private temperatureLogTemplateForCV(value: CharacteristicValue): string {
    const message = this.units === TemperatureUnits.FAHRENHEIT ? strings.sensor.temperatureF : strings.sensor.temperatureC;
    const temperature = fromCelsius(value as number, this.config.temperatureUnits);
    return message.replace('%d', temperature.toString());
  }

  protected logTemperature(value: CharacteristicValue) {
    this.logIfDesired(this.temperatureLogTemplateForCV(value));
  }

  private setupComputed() {
    const computedConfig = this.validateComputedConfig();
    if (computedConfig === undefined) {
      return;
    }

    this.activeComputedConfig = computedConfig;

    for (const ref of [computedConfig.minuend, computedConfig.subtrahend]) {
      const source = this.createComputedSource(ref);
      if (source === undefined) {
        continue;
      }

      const initial = source.read();
      const key = computedRefKey(ref);

      if (initial !== undefined) {
        this.computedSourceValues.set(key, initial);
      }

      const unsubscribe = source.subscribe(
        value => {
          this.computedSourceValues.set(key, value);
          this.recomputeComputedTemperature();
        },
        value => {
          this.log.warning(strings.computed.nonNumericInput, this.displayName, ref.accessoryId, `'${String(value)}'`);
        },
      );

      this.unsubscribeComputed.push(unsubscribe);
    }

    this.recomputeComputedTemperature();
  }

  private createComputedSource(ref: ComputedCharacteristicRef): ComputedValueSource | undefined {
    if (ref.source === 'dummy') {
      return new DummyCharacteristicValueSource(ref, this.characteristicEventBus, Storage.get);
    }

    return this.homebridgeCharacteristicSourceManager?.createSource(ref);
  }

  private recomputeComputedTemperature() {
    if (this.activeComputedConfig === undefined) {
      return;
    }

    const value = computeTemperatureDelta(this.activeComputedConfig, this.computedSourceValues);
    if (value === undefined) {
      return;
    }

    this.setComputedTemperature(value);
  }

  private validateComputedConfig(): ComputedTemperatureConfig | undefined {
    const computed = this.config.computed as Partial<ComputedTemperatureConfig> | undefined;
    if (computed === undefined) {
      return undefined;
    }

    if (computed.type !== 'DELTA') {
      this.log.error(strings.computed.badType, this.displayName, `'${computed.type}'`);
      return undefined;
    }

    if (!this.validateComputedRef('minuend', computed.minuend)) {
      return undefined;
    }

    if (!this.validateComputedRef('subtrahend', computed.subtrahend)) {
      return undefined;
    }

    if (computed.precision !== undefined && toFiniteNumber(computed.precision) === undefined) {
      this.log.error(strings.computed.nonNumericConfig, this.displayName, '`computed.precision`');
      return undefined;
    }

    if (computed.offset !== undefined && toFiniteNumber(computed.offset) === undefined) {
      this.log.error(strings.computed.nonNumericConfig, this.displayName, '`computed.offset`');
      return undefined;
    }

    if (computed.clampMinimum !== undefined && toFiniteNumber(computed.clampMinimum) === undefined) {
      this.log.error(strings.computed.nonNumericConfig, this.displayName, '`computed.clampMinimum`');
      return undefined;
    }

    if (computed.clampMaximum !== undefined && toFiniteNumber(computed.clampMaximum) === undefined) {
      this.log.error(strings.computed.nonNumericConfig, this.displayName, '`computed.clampMaximum`');
      return undefined;
    }

    return computed as ComputedTemperatureConfig;
  }

  private validateComputedRef(name: 'minuend' | 'subtrahend', ref: Partial<ComputedCharacteristicRef> | undefined): ref is ComputedCharacteristicRef {
    const path = `computed.${name}`;

    if (ref === undefined) {
      this.log.error(strings.computed.missingField, this.displayName, this.configPath(path));
      return false;
    }

    if (typeof ref.accessoryId !== 'string' || ref.accessoryId.length === 0) {
      this.log.error(strings.computed.missingField, this.displayName, this.configPath(`${path}.accessoryId`));
      return false;
    }

    normalizeComputedRefSource(ref);

    if (ref.source !== 'dummy' && ref.source !== 'homebridge') {
      this.log.error(strings.computed.unsupportedSource, this.displayName, this.configPath(`${path}.source`), '\'dummy\', \'homebridge\'');
      return false;
    }

    if (!SUPPORTED_COMPUTED_CHARACTERISTICS.includes(ref.characteristic as HKCharacteristicKey)) {
      this.log.error(
        strings.computed.unsupportedCharacteristic,
        this.displayName,
        this.configPath(`${path}.characteristic`),
        `'${ref.characteristic}'`,
        SUPPORTED_COMPUTED_CHARACTERISTICS.map(characteristic => `'${characteristic}'`).join(', '),
      );
      return false;
    }

    if (ref.source === 'dummy' && ref.accessoryId === this.identifier && ref.characteristic === HKCharacteristicKey.CurrentTemperature) {
      this.log.error(strings.computed.selfReference, this.displayName, this.configPath(path));
      return false;
    }

    return true;
  }

  private configPath(path: string): string {
    return '`' + path + '`';
  }

  override teardown() {
    this.unsubscribeComputed.forEach(unsubscribe => {
      unsubscribe();
    });
    this.unsubscribeComputed.length = 0;
    super.teardown();
  }
}
