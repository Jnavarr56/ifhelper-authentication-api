import { RedisClient } from 'redis';
import RedisClientSingleton from './RedisSingleton';

export default class RedisCacheManager {
	private client: RedisClient;
	private prefix: string;

	public constructor(prefix: string) {
		this.client = new RedisClientSingleton().getInstance();
		this.prefix = prefix;
	}

	private prefixKey(key: string): string {
		return this.prefix + key;
	}

	protected setKey(key: string, value: unknown, secs: number): Promise<void> {
		return new Promise((resolve, reject) => {
			this.client.set(
				this.prefixKey(key),
				JSON.stringify(value),
				'EX',
				secs,
				(error: Error | null) => {
					if (error) reject(error);
					resolve();
				}
			);
		});
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	protected getKey(key: string): Promise<any> {
		return new Promise((resolve, reject) => {
			this.client.get(
				this.prefixKey(key),
				(error: Error | null, cachedValStr: string) => {
					if (error) reject(error);
					resolve(JSON.parse(cachedValStr));
				}
			);
		});
	}

	public getTTL(key: string): Promise<number> {
		return new Promise((resolve, reject) => {
			this.client.ttl(this.prefixKey(key), (error: Error | null, secs: number) => {
				if (error) reject(error);
				resolve(secs);
			});
		});
	}

	protected deleteKey(key: string): Promise<number> {
		return new Promise((resolve, reject) => {
			this.client.del(
				this.prefixKey(key),
				(error: Error | null, numItemsDeleted: number) => {
					if (error) reject(error);
					resolve(numItemsDeleted);
				}
			);
		});
	}

	protected deleteAllKeys(): Promise<number | void> {
		return new Promise((resolve, reject) => {
			this.client.keys(
				this.prefixKey('*'),
				(error: Error | null, rows: string[]) => {
					if (error) reject(error);

					if (rows.length > 0) {
						// const keysWithoutPrefix: string[] = rows.map((row: string): string => {
						// 	return row.replace(this._prefix, '');
						// });
						this.client.del(rows, (error: Error | null, numItemsDeleted: number) => {
							if (error) reject(error);
							resolve(numItemsDeleted);
						});
					} else {
						resolve();
					}
				}
			);
		});
	}
}
