import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { ScentAirPlatformAccessory } from './platformAccessory';
import { ScentAirAPI } from './api';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class ScentAirHomebridgePlatform implements DynamicPlatformPlugin {
    public readonly Service: typeof Service = this.api.hap.Service;
    public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

    // this is used to track restored cached accessories
    public readonly accessories: PlatformAccessory[] = [];
    public scentAirApi!: ScentAirAPI;

    constructor(
        public readonly log: Logger,
        public readonly config: PlatformConfig,
        public readonly api: API,
    ) {
        this.log.debug('Finished initializing platform:', this.config.name);

        // When this event is fired it means Homebridge has restored all cached accessories from disk.
        // Dynamic Platform plugins should only register new accessories after this event was fired,
        // in order to ensure they weren't added to homebridge already. This event can also be used
        // to start discovery of new accessories.
        this.api.on('didFinishLaunching', () => {
            log.debug('Executed didFinishLaunching callback');
            // run the method to discover / register your devices as accessories
            this.discoverDevices();
        });
    }

    /**
     * This function is invoked when homebridge restores cached accessories from disk at startup.
     * It should be used to setup event handlers for characteristics and update respective values.
     */
    configureAccessory(accessory: PlatformAccessory) {
        this.log.info('Loading accessory from cache:', accessory.displayName);

        // add the restored accessory to the accessories cache so we can track if it has already been registered
        this.accessories.push(accessory);
    }

    /**
     * This is an example method showing how to register discovered accessories.
     * Accessories must only be registered once, previously created accessories
     * must not be registered again to prevent "duplicate UUID" errors.
     */
    async discoverDevices() {

        if (!this.config.email || !this.config.password) {
            this.log.error('No email or password configured.');
            return;
        }

        this.scentAirApi = new ScentAirAPI(this.log, this.config.email, this.config.password);

        try {
            await this.scentAirApi.login();

            const locations = await this.scentAirApi.getLocations();

            for (const location of locations) {
                const locId = location.name.split('/').pop(); // Extract location ID
                const assets = await this.scentAirApi.getAssets(locId);

                for (const asset of assets) {
                    // Check if it's a valid device (has config)
                    if (asset.fields && asset.fields.config) {
                        const assetId = asset.name.split('/').pop();
                        const uuid = this.api.hap.uuid.generate(asset.name);

                        // Check if existing
                        const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

                        if (existingAccessory) {
                            this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

                            existingAccessory.context.device = asset;
                            existingAccessory.context.locationId = locId;
                            this.api.updatePlatformAccessories([existingAccessory]);

                            new ScentAirPlatformAccessory(this, existingAccessory);
                        } else {
                            this.log.info('Adding new accessory:', assetId);

                            const accessory = new this.api.platformAccessory(`ScentAir ${assetId}`, uuid);
                            accessory.context.device = asset;
                            accessory.context.locationId = locId;

                            new ScentAirPlatformAccessory(this, accessory);

                            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
                        }
                    }
                }
            }

        } catch (error: any) {
            this.log.error('Failed to discover devices:', error.message);
        }
    }
}
