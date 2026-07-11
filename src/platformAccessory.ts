import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';

import { ScentAirHomebridgePlatform } from './platform';

// HomeKit sends the components of a single user action (On + RotationSpeed, or
// Hue + Saturation) as separate characteristic writes in quick succession. We
// coalesce them within this window so we issue one correct device write instead
// of racing writes that clobber each other or compute a color from stale state.
const WRITE_DEBOUNCE_MS = 120;

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

    // Pending fan write intent (coalesced across On + RotationSpeed).
    private pendingOn?: boolean;
    private pendingSpeed?: number;
    private fanTimer?: NodeJS.Timeout;

    // Pending accent-light write intent (coalesced across On + Hue + Saturation).
    private pendingAccentOn?: boolean;
    private pendingHue?: number;
    private pendingSat?: number;
    private colorTimer?: NodeJS.Timeout;

    // Number of device writes currently awaiting the network. Used to keep the
    // poll from clobbering context or pushing stale state mid-write.
    private writeInFlight = 0;

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
        // Current state is read from the asset document captured at discovery and
        // refreshed by the platform poll.
        try {
            const fields = this.accessory.context.device.fields.config.mapValue.fields;
            if (!fields[key]) {
                return undefined;
            }
            if (fields[key].booleanValue !== undefined) {
                return fields[key].booleanValue;
            }
            if (fields[key].integerValue !== undefined) {
                return parseInt(fields[key].integerValue);
            }
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

    /**
     * Convert a failed device write into a HAP error so the Home app shows the
     * accessory as unreachable, instead of surfacing a raw axios error (or, from
     * an un-awaited handler, an unhandled rejection that crashes Homebridge).
     */
    private communicationError(error: any): Error {
        this.platform.log.error('ScentAir communication error:', error?.message ?? error);
        const hap = this.platform.api.hap;
        return new hap.HapStatusError(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    /**
     * True while a user action is being coalesced, is debouncing, or its device
     * write is in flight. The poll consults this so it never overwrites the
     * context that a pending flush reads from, nor pushes state that fights an
     * optimistic value.
     */
    private isBusy(): boolean {
        return this.writeInFlight > 0 ||
            this.pendingOn !== undefined || this.pendingSpeed !== undefined || this.fanTimer !== undefined ||
            this.pendingAccentOn !== undefined || this.pendingHue !== undefined ||
            this.pendingSat !== undefined || this.colorTimer !== undefined;
    }

    /**
     * Push the latest device state into HomeKit. Called by the platform poll so
     * changes made outside HomeKit are reflected. Skips the whole accessory while
     * a user write is pending/in flight to avoid clobbering the context the
     * coalesced flush reads or reverting a just-sent change; the next poll
     * reconciles once the write settles.
     */
    updateState(asset: any, locationId: string) {
        if (this.isBusy()) {
            return;
        }

        this.accessory.context.device = asset;
        this.accessory.context.locationId = locationId;
        this.locationId = locationId;

        const c = this.platform.Characteristic;

        const speed = this.getConfigValue('fanSpeed') || 0;
        this.fanService.updateCharacteristic(c.On, speed > 0);
        this.fanService.updateCharacteristic(c.RotationSpeed, speed * 10);

        if (this.backlightService) {
            this.backlightService.updateCharacteristic(c.On, this.getConfigValue('isBacklightOn') || false);
        }

        if (this.accentLightService) {
            this.pushAccentState(this.getRgbLightValue());
        }
    }

    // === Fan Handlers ===
    async setFanOn(value: CharacteristicValue) {
        this.pendingOn = value as boolean;
        this.scheduleFanWrite();
    }

    async getFanOn(): Promise<CharacteristicValue> {
        const speed = this.getConfigValue('fanSpeed') || 0;
        return speed > 0;
    }

    async setRotationSpeed(value: CharacteristicValue) {
        // Value 0-100. Map 1-100 to 1-10.
        const pct = value as number;
        this.pendingSpeed = pct > 0 ? Math.ceil(pct / 10) : 0;
        this.scheduleFanWrite();
    }

    async getRotationSpeed(): Promise<CharacteristicValue> {
        const speed = this.getConfigValue('fanSpeed') || 0;
        return speed * 10;
    }

    private scheduleFanWrite() {
        if (this.fanTimer) {
            clearTimeout(this.fanTimer);
        }
        this.fanTimer = setTimeout(() => {
            this.fanTimer = undefined;
            this.flushFanWrite().catch(error =>
                this.platform.log.error('Fan write failed:', error?.message ?? error));
        }, WRITE_DEBOUNCE_MS);
    }

    private async flushFanWrite() {
        const on = this.pendingOn;
        const explicit = this.pendingSpeed;
        this.pendingOn = undefined;
        this.pendingSpeed = undefined;

        let target: number;
        if (explicit !== undefined) {
            // An explicit speed always wins over the On default; On=false forces off.
            target = on === false ? 0 : explicit;
        } else if (on !== undefined) {
            if (on) {
                const current = this.getConfigValue('fanSpeed') || 0;
                target = current > 0 ? current : 5;
            } else {
                target = 0;
            }
        } else {
            return;
        }

        await this.setFanSpeed(target);
    }

    private async setFanSpeed(speed: number) {
        this.platform.log.debug(`Set Fan Speed: ${speed}`);
        this.writeInFlight++;
        try {
            await this.platform.scentAirApi.controlAsset(this.locationId, this.assetId, { fanSpeed: speed });
            this.updateConfigValue('fanSpeed', speed);
            const c = this.platform.Characteristic;
            this.fanService.updateCharacteristic(c.On, speed > 0);
            this.fanService.updateCharacteristic(c.RotationSpeed, speed * 10);
        } catch (error) {
            throw this.communicationError(error);
        } finally {
            this.writeInFlight--;
        }
    }

    // === Backlight Handlers ===
    async setBacklightOn(value: CharacteristicValue) {
        const isOn = value as boolean;
        this.platform.log.debug(`Set Backlight: ${isOn}`);
        this.writeInFlight++;
        try {
            await this.platform.scentAirApi.controlAsset(this.locationId, this.assetId, { isBacklightOn: isOn });
            this.updateConfigValue('isBacklightOn', isOn);
        } catch (error) {
            throw this.communicationError(error);
        } finally {
            this.writeInFlight--;
        }
    }

    async getBacklightOn(): Promise<CharacteristicValue> {
        return this.getConfigValue('isBacklightOn') || false;
    }

    private getRgbLightValue(): number {
        const val = this.getConfigValue('rgbLight');
        // If undefined, defaults to 7 (Off)
        if (val === undefined) {
            return 7;
        }
        return val as number;
    }

    // === Accent Light Handlers ===
    async setAccentLightOn(value: CharacteristicValue) {
        // Route both On and Off through the debounce so a Hue/Saturation write in
        // the same transaction (picking a color) takes precedence over the plain
        // on-default, and so a quick Off-then-On coalesces to a single final
        // intent instead of the Off write racing its own network round-trip.
        this.pendingAccentOn = value as boolean;
        this.scheduleColorWrite();
    }

    async getAccentLightOn(): Promise<CharacteristicValue> {
        const val = this.getRgbLightValue();
        // 7 means Off. 0 is Aqua (On).
        return val !== 7;
    }

    async setAccentLightHue(value: CharacteristicValue) {
        this.pendingHue = value as number;
        this.scheduleColorWrite();
    }

    async getAccentLightHue(): Promise<CharacteristicValue> {
        const val = this.getRgbLightValue();
        if (val === 7) {
            return 0; // Off logic
        }
        return this.COLORS[val]?.hue || 0;
    }

    async setAccentLightSaturation(value: CharacteristicValue) {
        this.pendingSat = value as number;
        this.scheduleColorWrite();
    }

    async getAccentLightSaturation(): Promise<CharacteristicValue> {
        const val = this.getRgbLightValue();
        if (val === 7) {
            return 0;
        }
        return this.COLORS[val]?.saturation || 0;
    }

    private scheduleColorWrite() {
        if (this.colorTimer) {
            clearTimeout(this.colorTimer);
        }
        this.colorTimer = setTimeout(() => {
            this.colorTimer = undefined;
            this.flushColorWrite().catch(error =>
                this.platform.log.error('Accent light write failed:', error?.message ?? error));
        }, WRITE_DEBOUNCE_MS);
    }

    private async flushColorWrite() {
        const hue = this.pendingHue;
        const sat = this.pendingSat;
        const turnOn = this.pendingAccentOn;
        this.pendingHue = undefined;
        this.pendingSat = undefined;
        this.pendingAccentOn = undefined;

        const currentVal = this.getRgbLightValue();

        let match: number;
        if (turnOn === false) {
            // Explicit Off wins over any color pending in the same window.
            match = 7;
        } else if (hue !== undefined || sat !== undefined) {
            // Compute the target from the values HomeKit actually sent, filling any
            // missing component from the current color (defaulting to full-saturation
            // when the light is currently Off) rather than from stale device state.
            const base = this.COLORS[currentVal] || { hue: 0, saturation: 100 };
            const targetHue = hue !== undefined ? hue : base.hue;
            const targetSat = sat !== undefined ? sat : base.saturation;
            match = this.matchColor(targetHue, targetSat);
        } else if (turnOn === true) {
            // Plain On with no color: default Off -> White (8), otherwise keep current.
            match = currentVal === 7 ? 8 : currentVal;
        } else {
            return;
        }

        if (match !== currentVal) {
            await this.writeAccentColor(match);
        }
    }

    private matchColor(hue: number, sat: number): number {
        if (sat < 20) {
            return 8; // White
        }
        // Red=0/360, Orange=30, Yellow=60, Green=120, Aqua=180, Blue=240, Purple=270
        if (hue >= 15 && hue < 45) {
            return 2; // Orange
        } else if (hue >= 45 && hue < 90) {
            return 3; // Yellow
        } else if (hue >= 90 && hue < 150) {
            return 4; // Green
        } else if (hue >= 150 && hue < 210) {
            return 0; // Aqua (180 deg) - Mapped to 0
        } else if (hue >= 210 && hue < 260) {
            return 5; // Blue
        } else if (hue >= 260 && hue < 315) {
            return 6; // Purple
        }
        return 1; // Red
    }

    private async writeAccentColor(val: number) {
        this.platform.log.debug(`Set Accent Light: ${val}`);
        this.writeInFlight++;
        try {
            await this.platform.scentAirApi.controlAsset(this.locationId, this.assetId, { rgbLight: val });
            this.updateConfigValue('rgbLight', val);
            this.pushAccentState(val);
        } catch (error) {
            throw this.communicationError(error);
        } finally {
            this.writeInFlight--;
        }
    }

    private pushAccentState(val: number) {
        if (!this.accentLightService) {
            return;
        }
        const c = this.platform.Characteristic;
        this.accentLightService.updateCharacteristic(c.On, val !== 7);
        if (val !== 7) {
            const color = this.COLORS[val] || { hue: 0, saturation: 0 };
            this.accentLightService.updateCharacteristic(c.Hue, color.hue);
            this.accentLightService.updateCharacteristic(c.Saturation, color.saturation);
        }
    }
}
