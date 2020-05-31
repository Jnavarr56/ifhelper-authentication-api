import redis, { RedisClient } from 'redis';
import { REDIS_PORT, REDIS_URL } from '../vars';

export default class RedisClientSingleton {
	private static instance: RedisClient | null = null;

	public getInstance(): RedisClient {
		if (!RedisClientSingleton.instance) {
			throw new Error('Singleton must be constructed first.');
		}

		return RedisClientSingleton.instance;
	}

	public constructor() {
		if (!RedisClientSingleton.instance) {
			RedisClientSingleton.instance = redis.createClient({
				port: REDIS_PORT,
				url: REDIS_URL
			});
		}
	}
}
