import { ClientOpts, RedisClient, RedisError, createClient } from "redis";


interface cacheManagerOpts extends ClientOpts {
	prefix: string
} 

class RedisCacheManager {
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
				if (cacheError) {
					reject(cacheError);
				}
				resolve(JSON.parse(cachedVal));
			});
		});
	}

	public getTTL(key: string): Promise<number> {
		return new Promise((resolve, reject) => {
			this._client.ttl(key, (cacheError: RedisError, num: number) => {
				if (cacheError) {
					reject(cacheError);
				}
				resolve(num);
			});
		});
	}

	public deleteKey(key: string): Promise<void> {
		return new Promise((resolve, reject) => {
			this._client.del(key, (cacheError, n) => {
				if (cacheError) {
					reject(cacheError);
				}
				resolve();
			});
		});
	}

	public deleteAllKeys(): Promise<void | RedisError> {
		return new Promise((resolve, reject) => {
			this._client.keys(this._opts.prefix + "*", (err, rows) => {
				this._client.del(
					rows.map((row) => row.replace(this._opts.prefix, "")),
					(cacheError, n) => {
						if (cacheError) {
							reject(cacheError);
						}
						resolve();
					}
				);
			});
		});
	}
}

export default RedisCacheManager;
