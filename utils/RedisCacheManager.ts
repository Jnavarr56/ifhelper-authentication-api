import cryptoRandomString from "crypto-random-string";
import { ClientOpts, RedisClient, RedisError, createClient } from "redis";
import {
	REDIS_PORT,
	REDIS_URL,
	AUTH_TOKEN_CACHE_PREFIX,
	ACCESS_TOKEN_LIFE_SECS,
	BLACKLIST_TOKEN_CACHE_PREFIX
} from "../vars";
import { SystemAccessTokenPayload, CachedPayload } from "../types";
import { TokenStore } from "../db/models";

interface cacheManagerOpts extends ClientOpts {
	prefix: string;
}

export class RedisCacheManager {
	private _client: RedisClient;
	private _opts: cacheManagerOpts;

	public constructor(opts: cacheManagerOpts) {
		this._opts = opts;
		this._client = createClient(opts);
	}

	public get client(): RedisClient {
		return this._client;
	}

	public setKey(key: string, value: any, secs: number): Promise<void> {
		return new Promise((resolve, reject) => {
			this._client.set(
				key,
				JSON.stringify(value),
				"EX",
				secs,
				(cacheError: RedisError) => {
					if (cacheError) reject(cacheError);
					resolve();
				}
			);
		});
	}

	public getKey(key: string): Promise<any> {
		return new Promise((resolve, reject) => {
			this._client.get(key, (cacheError: RedisError, cachedVal: any) => {
				if (cacheError) reject(cacheError);
				resolve(JSON.parse(cachedVal));
			});
		});
	}

	public getTTL(key: string): Promise<number> {
		return new Promise((resolve, reject) => {
			this._client.ttl(key, (cacheError: RedisError, secs: number) => {
				if (cacheError) reject(cacheError);
				resolve(secs);
			});
		});
	}

	public deleteKey(key: string): Promise<void> {
		return new Promise((resolve, reject) => {
			this._client.del(key, (cacheError: RedisError) => {
				if (cacheError) reject(cacheError);
				resolve();
			});
		});
	}

	public deleteAllKeys(): Promise<void> {
		return new Promise((resolve, reject) => {
			this._client.keys(this._opts.prefix + "*", (error, rows: string[]) => {
				if (error) reject(error);

				if (rows.length > 0) {
					const keysWithoutPrefix: string[] = rows.map((row: string) => {
						return row.replace(this._opts.prefix, "");
					});

					this._client.del(keysWithoutPrefix, (error) => {
						if (error) reject(error);
						resolve();
					});
				} else {
					resolve();
				}
			});
		});
	}
}

export class AuthTokenCacheManager extends RedisCacheManager {
	public constructor() {
		super({
			port: REDIS_PORT,
			url: REDIS_URL,
			prefix: AUTH_TOKEN_CACHE_PREFIX
		});
	}

	public async cacheToken(
		token: string,
		payload: CachedPayload,
		secs: number
	): Promise<void> {
		return this.setKey(token, payload, secs);
	}

	public async getCachedPayload(token: string): Promise<CachedPayload> {
		return this.getKey(token).then(
			async (payload: CachedPayload): Promise<CachedPayload> => {
				if (payload.access_type === "SYSTEM") await this.deleteKey(token);
				return payload;
			}
		);
	}

	public async generateSystemAuthToken(): Promise<string> {
		const token: string = cryptoRandomString({ length: 10, type: "base64" });
		const payload: SystemAccessTokenPayload = { access_type: "SYSTEM" };
		return new Promise((resolve) => {
			this.cacheToken(token, payload, ACCESS_TOKEN_LIFE_SECS).then(() =>
				resolve(token)
			);
		});
	}
}

export class TokenBlacklistCacheManager extends RedisCacheManager {
	public constructor() {
		super({
			port: REDIS_PORT,
			url: REDIS_URL,
			prefix: BLACKLIST_TOKEN_CACHE_PREFIX
		});
	}

	public async isBlacklisted(token: string): Promise<boolean> {
		return this.getKey(token).then((payload: CachedPayload): boolean => {
			return payload !== null;
		});
	}

	public async blacklistToken(token: string, secs: number): Promise<void> {
		return this.setKey(token, {}, secs);
	}

	public async blacklistAllUserTokens(userID: string): Promise<void> {
		const stores: any = await TokenStore.find({
			user_id: userID,
			access_token_exp_date: { $gte: new Date() }
		});
		const storeArr: Array<any> = Array.isArray(stores) ? stores : [stores];
		for (const store of storeArr) {
			const isBlacklisted: boolean = await this.isBlacklisted(store.access_token);
			if (!isBlacklisted) {
				const createdDate: Date = store.createdAt;
				const expDate: Date = store.access_token_exp_date;
				const ms: number = createdDate.getTime() - expDate.getTime();
				const ttlSecs: number = Math.ceil(ms / 1000);
				await this.blacklistToken(store.access_token, ttlSecs);
			}
		}
	}
}
