import * as dotenv from 'dotenv';
import redis, { RedisClient } from 'redis';
import { REDIS_PORT, REDIS_URL } from '../vars';

dotenv.config();

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
				url: REDIS_URL,
				password: process.env.AUTH_CACHE_PASSWORD
			});
		}
	}
}
