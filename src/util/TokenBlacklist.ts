import { BLACKLIST_TOKEN_CACHE_PREFIX } from '../vars';
import { SystemAccessTokenPayload, AccessTokenPayload } from '../types/Token';
import TokenStore from '../models/TokenStore';
import RedisCacheManager from './RedisCacheManager';

export default class TokenBlacklist extends RedisCacheManager {
	public constructor() {
		super(BLACKLIST_TOKEN_CACHE_PREFIX);
	}

	public async isBlacklisted(token: string): Promise<boolean> {
		return this.getKey(token).then(
			(payload: AccessTokenPayload | SystemAccessTokenPayload | null): boolean => {
				return payload !== null;
			}
		);
	}

	public async blacklistToken(token: string, secs: number): Promise<void> {
		await TokenStore.findOneAndUpdate({ access_token: token }, { revoked: true });
		return this.setKey(token, {}, secs);
	}

	public async blacklistAllUserTokens(userID: string): Promise<void> {
		const stores: any = await TokenStore.find({
			user_id: userID,
			revoked: false,
			access_token_exp_date: { $gte: new Date() }
		});

		const storeArr: Array<any> = Array.isArray(stores) ? stores : [stores];

		for (const store of storeArr) {
			const isBlacklisted: boolean = await this.isBlacklisted(store.access_token);

			if (!isBlacklisted) {
				const createdDate: Date = store.created_at;
				const expDate: Date = store.access_token_exp_date;
				const ms: number = createdDate.getTime() - expDate.getTime();
				const ttlSecs: number = Math.ceil(ms / 1000);
				await this.blacklistToken(store.access_token, ttlSecs);
				await store.update({
					revoked: true,
					revoked_at: new Date()
				});
			}
		}
	}
}
