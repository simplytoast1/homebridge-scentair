import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { ScentAirHomebridgePlatform } from './platform';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class ScentAirPlatformAccessory {
    private fanService: Service;
    private backlightService?: Service;
    private accentLightService?: Service;

    // Colors map from Python code (Updated by User Traffic Analysis)
    // 0=Aqua, 1=Red, 2=Orange, 3=Yellow, 4=Green, 5=Blue, 6=Purple, 7=Off, 8=White
    private readonly COLORS: { [key: number]: { hue: number; saturation: number } } = {
        0: { hue: 180, saturation: 100 },  // Aqua (User confirmed 0 is Aqua)
        1: { hue: 0, saturation: 100 },    // Red
        2: { hue: 30, saturation: 100 },   // Orange
        3: { hue: 60, saturation: 100 },   // Yellow
        4: { hue: 120, saturation: 100 },  // Green
        5: { hue: 240, saturation: 100 },  // Blue
        6: { hue: 270, saturation: 100 },  // Purple
        // 7 is Off, not mapped
        8: { hue: 0, saturation: 0 },      // White (User confirmed 8 is White)
    };

    private assetId: string;
    private locationId: string;

    constructor(
        private readonly platform: ScentAirHomebridgePlatform,
        private readonly accessory: PlatformAccessory,
    ) {
        this.assetId = accessory.context.device.name.split('/').pop();
        this.locationId = accessory.context.locationId;

        // set accessory information
        this.accessory.getService(this.platform.Service.AccessoryInformation)!
            .setCharacteristic(this.platform.Characteristic.Manufacturer, 'ScentAir')
            .setCharacteristic(this.platform.Characteristic.Model, 'Diffuser')
            .setCharacteristic(this.platform.Characteristic.SerialNumber, this.assetId);

        // === Fan Service ===
        this.fanService = this.accessory.getService('Fan') ||
            this.accessory.addService(this.platform.Service.Fan, 'Fan', 'fan');

        this.fanService.setCharacteristic(this.platform.Characteristic.Name, 'Fan');

        this.fanService.getCharacteristic(this.platform.Characteristic.On)
            .onSet(this.setFanOn.bind(this))
            .onGet(this.getFanOn.bind(this));

        this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
            .onSet(this.setRotationSpeed.bind(this))
            .onGet(this.getRotationSpeed.bind(this));


        // === Backlight Service ===
        if (this.platform.config.showBacklight !== false) {
            this.backlightService = this.accessory.getService('Backlight') ||
                this.accessory.addService(this.platform.Service.Lightbulb, 'Backlight', 'backlight');

            this.backlightService.setCharacteristic(this.platform.Characteristic.Name, 'Backlight');

            this.backlightService.getCharacteristic(this.platform.Characteristic.On)
                .onSet(this.setBacklightOn.bind(this))
                .onGet(this.getBacklightOn.bind(this));
        } else {
            // Remove if disabled
            const service = this.accessory.getService('Backlight');
            if (service) {
                this.accessory.removeService(service);
            }
        }


        // === Accent Light Service ===
        if (this.platform.config.showAccentLight !== false) {
            this.accentLightService = this.accessory.getService('Accent Light') ||
                this.accessory.addService(this.platform.Service.Lightbulb, 'Accent Light', 'accent');

            this.accentLightService.setCharacteristic(this.platform.Characteristic.Name, 'Accent Light');

            this.accentLightService.getCharacteristic(this.platform.Characteristic.On)
                .onSet(this.setAccentLightOn.bind(this))
                .onGet(this.getAccentLightOn.bind(this));

            this.accentLightService.getCharacteristic(this.platform.Characteristic.Hue)
                .onSet(this.setAccentLightHue.bind(this))
                .onGet(this.getAccentLightHue.bind(this));

            this.accentLightService.getCharacteristic(this.platform.Characteristic.Saturation)
                .onSet(this.setAccentLightSaturation.bind(this))
                .onGet(this.getAccentLightSaturation.bind(this));
        } else {
            // Remove if disabled
            const service = this.accessory.getService('Accent Light');
            if (service) {
                this.accessory.removeService(service);
            }
        }
    }

    // --- Helpers ---
    private getConfigValue(key: string): any {
        // Current state is stored in context during discovery/update
        // But we might want to fetch fresh state? 
        // For now, we rely on what discovery gave us, but we should probably implement a poll or just read from what we have.
        // However, the Platform only gets devices once. 
        // Ideally we should refactor to allowing fetching state.
        // But since `controlAsset` is write-only, we should update our local context.

        // Let's assume we update context.device when we write.
        // But for reading, we read from context.device.fields.config.mapValue.fields
        try {
            const fields = this.accessory.context.device.fields.config.mapValue.fields;
            if (!fields[key]) return undefined;
            // Check types
            if (fields[key].booleanValue !== undefined) return fields[key].booleanValue;
            if (fields[key].integerValue !== undefined) return parseInt(fields[key].integerValue);
            return undefined;
        } catch (e) {
            return undefined;
        }
    }

    private updateConfigValue(key: string, value: any) {
        if (!this.accessory.context.device.fields) {
            this.accessory.context.device.fields = { config: { mapValue: { fields: {} } } };
        }
        const fields = this.accessory.context.device.fields.config.mapValue.fields;

        if (typeof value === 'boolean') {
            fields[key] = { booleanValue: value };
        } else if (typeof value === 'number') {
            fields[key] = { integerValue: value.toString() };
        }
    }

    // === Fan Handlers ===
    async setFanOn(value: CharacteristicValue) {
        const isOn = value as boolean;
        const currentSpeed = this.getConfigValue('fanSpeed') || 0;

        // If turning on, set to 50% (speed 5) if it was 0, or keep current.
        // Actually if it was 0, we can default to 5.
        let targetSpeed = currentSpeed;
        if (isOn && currentSpeed === 0) {
            targetSpeed = 5;
        } else if (!isOn) {
            targetSpeed = 0;
        }

        await this.setFanSpeed(targetSpeed);
    }

    async getFanOn(): Promise<CharacteristicValue> {
        const speed = this.getConfigValue('fanSpeed') || 0;
        return speed > 0;
    }

    async setRotationSpeed(value: CharacteristicValue) {
        // Value 0-100
        const pct = value as number;
        let targetSpeed = 0;
        if (pct > 0) {
            // Map 1-100 to 1-10
            targetSpeed = Math.ceil(pct / 10);
        }
        await this.setFanSpeed(targetSpeed);
    }

    async getRotationSpeed(): Promise<CharacteristicValue> {
        const speed = this.getConfigValue('fanSpeed') || 0;
        return speed * 10;
    }

    async setFanSpeed(speed: number) {
        this.platform.log.debug(`Set Fan Speed: ${speed}`);
        await this.platform.scentAirApi.controlAsset(this.locationId, this.assetId, { fanSpeed: speed });
        this.updateConfigValue('fanSpeed', speed);
    }

    // === Backlight Handlers ===
    async setBacklightOn(value: CharacteristicValue) {
        const isOn = value as boolean;
        this.platform.log.debug(`Set Backlight: ${isOn}`);
        await this.platform.scentAirApi.controlAsset(this.locationId, this.assetId, { isBacklightOn: isOn });
        this.updateConfigValue('isBacklightOn', isOn);
    }

    async getBacklightOn(): Promise<CharacteristicValue> {
        return this.getConfigValue('isBacklightOn') || false;
    }

    private getRgbLightValue(): number {
        const val = this.getConfigValue('rgbLight');
        // If undefined, defaults to 7 (Off)
        if (val === undefined) return 7;
        return val as number;
    }

    // === Accent Light Handlers ===
    async setAccentLightOn(value: CharacteristicValue) {
        const isOn = value as boolean;
        if (!isOn) {
            // User requested OFF -> Set to 7 (Off)
            await this.setAccentLightValue(7);
        } else {
            // User requested ON
            const current = this.getRgbLightValue();
            // If current is 7 (Off), default to White (8) or Aqua (0)? 
            // Previous default was White (8). Let's stick to White (8).
            if (current === 7) {
                await this.setAccentLightValue(8);
            } else {
                // Already on a color, do nothing
            }
        }
    }

    async getAccentLightOn(): Promise<CharacteristicValue> {
        const val = this.getRgbLightValue();
        // 7 means Off. 0 is Aqua (On).
        return val !== 7;
    }

    async setAccentLightHue(value: CharacteristicValue) {
        // We wait for saturation to be set typically, but HomeKit sends them separately. 
        // We can store a pending state or just calculate nearest neighbor immediately.
        // Simplest is to check the current logic or just wait?
        // Actually, we can just infer from Hue assuming Saturation is high, unless it's white.
        // But let's check current saturation.
        const hue = value as number;
        // We'll process this in setAccentLightColor to avoid duplicate calls if possible, 
        // but simpler to just calc and set.
        this.checkAndSetColor(hue, undefined);
    }

    async getAccentLightHue(): Promise<CharacteristicValue> {
        const val = this.getRgbLightValue();
        if (val === 7) return 0; // Off logic
        return this.COLORS[val]?.hue || 0;
    }

    async setAccentLightSaturation(value: CharacteristicValue) {
        const sat = value as number;
        this.checkAndSetColor(undefined, sat);
    }

    async getAccentLightSaturation(): Promise<CharacteristicValue> {
        const val = this.getRgbLightValue();
        if (val === 7) return 0;
        return this.COLORS[val]?.saturation || 0;
    }

    private async checkAndSetColor(hue?: number, sat?: number) {
        // Get current values if not provided
        const currentVal = this.getRgbLightValue();
        // If currentVal is 7 (Off), we need defaults. Default to White (0,0) for calc.
        const currentColors = this.COLORS[currentVal] || { hue: 0, saturation: 0 };

        const targetHue = hue !== undefined ? hue : currentColors.hue;
        const targetSat = sat !== undefined ? sat : currentColors.saturation;

        // Find closest match
        let match = 8; // Default White

        if (targetSat < 20) {
            match = 8; // White
        } else {
            // Map hue
            // Red=0/360, Orange=30, Yellow=60, Green=120, Aqua=180, Blue=240, Purple=270
            if (targetHue >= 15 && targetHue < 45) match = 2; // Orange
            else if (targetHue >= 45 && targetHue < 90) match = 3; // Yellow
            else if (targetHue >= 90 && targetHue < 150) match = 4; // Green
            else if (targetHue >= 150 && targetHue < 210) match = 0; // Aqua (180 deg) - Mapped to 0
            else if (targetHue >= 210 && targetHue < 260) match = 5; // Blue
            else if (targetHue >= 260 && targetHue < 315) match = 6; // Purple
            else match = 1; // Red
        }

        if (match !== currentVal) {
            await this.setAccentLightValue(match);
        }
    }

    async setAccentLightValue(val: number) {
        this.platform.log.debug(`Set Accent Light: ${val}`);
        await this.platform.scentAirApi.controlAsset(this.locationId, this.assetId, { rgbLight: val });
        this.updateConfigValue('rgbLight', val);
    }

}
