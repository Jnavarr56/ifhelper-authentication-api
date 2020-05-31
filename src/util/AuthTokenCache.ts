import cryptoRandomString from 'crypto-random-string';
import RedisCacheManager from './RedisCacheManager';
import { AUTH_TOKEN_CACHE_PREFIX, ACCESS_TOKEN_LIFE_SECS } from '../vars';
import { AccessTokenPayload, SystemAccessTokenPayload } from '../types/Token';

export default class AuthTokenCache extends RedisCacheManager {
	public constructor() {
		super(AUTH_TOKEN_CACHE_PREFIX);
	}

	public async cacheToken(
		token: string,
		payload: AccessTokenPayload | SystemAccessTokenPayload,
		secs: number
	): Promise<void> {
		return this.setKey(token, payload, secs);
	}

	public async getCachedPayload(
		token: string
	): Promise<AccessTokenPayload | SystemAccessTokenPayload | null> {
		const cachedVal: AccessTokenPayload | SystemAccessTokenPayload | null =
			(await this.getKey(token)) || null;

		if (cachedVal && cachedVal.access_type === 'SYSTEM') {
			await this.deleteKey(token);
		}

		return cachedVal;
	}

	public async generateSystemAuthToken(): Promise<string> {
		const token: string = cryptoRandomString({
			length: 10,
			type: 'base64'
		});
		const payload: SystemAccessTokenPayload = { access_type: 'SYSTEM' };
		await this.cacheToken(token, payload, ACCESS_TOKEN_LIFE_SECS);

		return token;
	}
}
