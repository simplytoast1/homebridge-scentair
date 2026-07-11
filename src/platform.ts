import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { ScentAirPlatformAccessory } from './platformAccessory';
import { ScentAirAPI } from './api';

// How often to re-fetch device state so changes made outside HomeKit
// (e.g. from the ScentAir app) are reflected in the Home app.
const POLL_INTERVAL_MS = 60000;

// Backoff bounds for retrying a failed initial discovery.
const INITIAL_DISCOVERY_BACKOFF_MS = 15000;
const MAX_DISCOVERY_BACKOFF_MS = 300000;

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

    // Active accessory wrappers, keyed by UUID, so polling can push state updates.
    private readonly managedAccessories: Map<string, ScentAirPlatformAccessory> = new Map();

    private discoveryTimer?: NodeJS.Timeout;
    private pollTimer?: NodeJS.Timeout;
    private discoveryBackoff = INITIAL_DISCOVERY_BACKOFF_MS;

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

        // Clean up timers so a shutdown/restart doesn't leak intervals.
        this.api.on('shutdown', () => {
            if (this.discoveryTimer) {
                clearTimeout(this.discoveryTimer);
                this.discoveryTimer = undefined;
            }
            if (this.pollTimer) {
                clearInterval(this.pollTimer);
                this.pollTimer = undefined;
            }
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
     * Fetch every controllable asset across all locations, keyed by the stable
     * accessory UUID derived from the asset's Firestore document name.
     */
    private async fetchAssets(): Promise<Map<string, { asset: any; locationId: string }>> {
        const result = new Map<string, { asset: any; locationId: string }>();

        const locations = await this.scentAirApi.getLocations();
        for (const location of locations) {
            const locId = location.name.split('/').pop(); // Extract location ID
            const assets = await this.scentAirApi.getAssets(locId);

            for (const asset of assets) {
                // Check if it's a valid device (has config)
                if (asset.fields && asset.fields.config) {
                    const uuid = this.api.hap.uuid.generate(asset.name);
                    result.set(uuid, { asset, locationId: locId });
                }
            }
        }

        return result;
    }

    async discoverDevices() {
        if (!this.config.email || !this.config.password) {
            this.log.error('No email or password configured.');
            return;
        }

        if (!this.scentAirApi) {
            this.scentAirApi = new ScentAirAPI(this.log, this.config.email, this.config.password);
        }

        try {
            await this.scentAirApi.login();

            const discovered = await this.fetchAssets();

            for (const [uuid, { asset, locationId }] of discovered) {
                const assetId = asset.name.split('/').pop();
                const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

                if (existingAccessory) {
                    this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

                    existingAccessory.context.device = asset;
                    existingAccessory.context.locationId = locationId;
                    this.api.updatePlatformAccessories([existingAccessory]);

                    this.managedAccessories.set(uuid, new ScentAirPlatformAccessory(this, existingAccessory));
                } else {
                    this.log.info('Adding new accessory:', assetId);

                    const accessory = new this.api.platformAccessory(`ScentAir ${assetId}`, uuid);
                    accessory.context.device = asset;
                    accessory.context.locationId = locationId;

                    this.managedAccessories.set(uuid, new ScentAirPlatformAccessory(this, accessory));

                    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
                    this.accessories.push(accessory);
                }
            }

            // Remove cached accessories that no longer exist in the account. Guard on a
            // non-empty discovery so a transient empty response can't wipe every accessory.
            if (discovered.size > 0) {
                const stale = this.accessories.filter(accessory => !discovered.has(accessory.UUID));
                if (stale.length > 0) {
                    this.log.info(`Removing ${stale.length} accessory(ies) no longer present in the ScentAir account`);
                    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
                    for (const accessory of stale) {
                        const idx = this.accessories.indexOf(accessory);
                        if (idx >= 0) {
                            this.accessories.splice(idx, 1);
                        }
                        this.managedAccessories.delete(accessory.UUID);
                    }
                }
            }

            // Discovery succeeded: reset backoff and begin polling for external changes.
            this.discoveryBackoff = INITIAL_DISCOVERY_BACKOFF_MS;
            this.startPolling();

        } catch (error: any) {
            this.log.error('Failed to discover devices:', error.message);
            this.scheduleDiscoveryRetry();
        }
    }

    /**
     * Retry a failed initial discovery with exponential backoff. Without this a
     * transient failure at startup (e.g. network not up yet) would leave every
     * accessory permanently unresponsive until a manual restart.
     */
    private scheduleDiscoveryRetry() {
        if (this.discoveryTimer) {
            return;
        }
        const delay = this.discoveryBackoff;
        this.log.info(`Retrying device discovery in ${Math.round(delay / 1000)}s`);
        this.discoveryTimer = setTimeout(() => {
            this.discoveryTimer = undefined;
            this.discoverDevices();
        }, delay);
        this.discoveryBackoff = Math.min(this.discoveryBackoff * 2, MAX_DISCOVERY_BACKOFF_MS);
    }

    private startPolling() {
        if (this.pollTimer) {
            return;
        }
        this.pollTimer = setInterval(() => {
            this.refreshDevices().catch(error => this.log.debug('Device poll failed:', error.message));
        }, POLL_INTERVAL_MS);
    }

    /**
     * Re-fetch device state and push any externally-made changes into HomeKit.
     */
    private async refreshDevices() {
        const discovered = await this.fetchAssets();
        for (const [uuid, { asset, locationId }] of discovered) {
            const wrapper = this.managedAccessories.get(uuid);
            if (wrapper) {
                wrapper.updateState(asset, locationId);
            }
        }
    }
}
