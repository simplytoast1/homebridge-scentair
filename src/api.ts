import axios, { AxiosInstance } from 'axios';
import * as jwt from 'jsonwebtoken';
import { Logger } from 'homebridge';

// Constants from original code
const FIREBASE_API_KEY = 'AIzaSyAMBHmmor0ccNy_AZjKAJo5GEJG86ZInWA';
const AUTH_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
const REFRESH_URL = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;
const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/scentconnect/databases/(default)/documents';

export class ScentAirAPI {
    private session: AxiosInstance;
    private idToken: string | null = null;
    private refreshToken: string | null = null;
    private orgId: string | null = null;

    constructor(
        private readonly log: Logger,
        private readonly username: string,
        private readonly password: string,
    ) {
        this.session = axios.create();
    }

    async login(): Promise<void> {
        const payload = {
            email: this.username,
            password: this.password,
            returnSecureToken: true,
        };

        try {
            const resp = await this.session.post(AUTH_URL, payload);
            const data = resp.data;

            this.idToken = data.idToken;
            this.refreshToken = data.refreshToken;

            // Decode token to get Organization ID
            // We perform a non-verified decode as we trust the IDP response for this internal flow
            const decoded: any = jwt.decode(this.idToken!);
            const claims = decoded.claims || {};
            this.orgId = claims.orgId;

            if (!this.orgId) {
                throw new Error('Could not find Organization ID in token claims');
            }

            this.log.debug(`Logged in. Org ID: ${this.orgId}`);

        } catch (error: any) {
            this.log.error('Login failed:', error.message);
            throw error;
        }
    }

    async refreshAuthToken(): Promise<void> {
        const payload = {
            grant_type: 'refresh_token',
            refresh_token: this.refreshToken,
        };

        try {
            const resp = await this.session.post(REFRESH_URL, payload);
            this.idToken = resp.data.id_token;
            this.refreshToken = resp.data.refresh_token;
            this.log.debug('Token refreshed');
        } catch (error: any) {
            this.log.error('Token refresh failed:', error.message);
            throw error;
        }
    }

    async request(method: string, url: string, data?: any): Promise<any> {
        if (!this.idToken) {
            await this.login();
        }

        const config = {
            method,
            url,
            headers: {
                Authorization: `Bearer ${this.idToken}`,
            },
            data,
        };

        try {
            const response = await this.session.request(config);
            return response.data;
        } catch (error: any) {
            if (error.response && error.response.status === 401) {
                this.log.debug('Token expired, refreshing...');
                await this.refreshAuthToken();
                config.headers.Authorization = `Bearer ${this.idToken}`;
                const response = await this.session.request(config);
                return response.data;
            }
            throw error;
        }
    }

    async getLocations(): Promise<any[]> {
        const url = `${FIRESTORE_BASE}/organizations/${this.orgId}/locations`;
        const data = await this.request('GET', url);
        return data.documents || [];
    }

    async getAssets(locationId: string): Promise<any[]> {
        const url = `${FIRESTORE_BASE}/organizations/${this.orgId}/locations/${locationId}/assets`;
        const data = await this.request('GET', url);
        return data.documents || [];
    }

    async controlAsset(locationId: string, assetId: string, changes: Record<string, any>): Promise<void> {
        const url = `${FIRESTORE_BASE}/organizations/${this.orgId}/locations/${locationId}/assets/${assetId}`;

        const fields: Record<string, any> = {};
        const updateMask: string[] = [];

        for (const [key, value] of Object.entries(changes)) {
            const fieldPath = `config.${key}`;
            updateMask.push(`updateMask.fieldPaths=${fieldPath}`);

            if (typeof value === 'boolean') {
                fields[key] = { booleanValue: value };
            } else if (typeof value === 'number') {
                fields[key] = { integerValue: value.toString() };
            }
            // Add other types if needed
        }

        const payload = {
            fields: {
                config: {
                    mapValue: {
                        fields: fields,
                    },
                },
            },
        };

        const query = updateMask.join('&');
        const fullUrl = `${url}?${query}`;

        await this.request('PATCH', fullUrl, payload);
    }
}
